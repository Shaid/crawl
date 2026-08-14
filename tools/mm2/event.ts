/**
 * MM2 `event.dat` codec — 71 location records (interactions/scripts).
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/06-event-dat-format.md`;
 * structural record classification follows `EXTRACTED/decomp/mm2_event_codec.h`).
 *
 *   +0x000  71 × 6-byte header entries (big-endian):
 *              +0 u32be  data_offset  absolute file offset
 *              +4 u16be  data_length  (clamped to 0x8AC at runtime)
 *            All 71 entries are contiguous
 *            (entry[n].offset + entry[n].length == entry[n+1].offset).
 *   +0x1AA  per-location data, variable length.
 *
 * Standard per-location record:
 *   Tile Event Table  3-byte triplets { pos=(y<<4)|x, handler_id, cond }
 *                      terminated by 00 00 00
 *   String offset      u16le word; relative offset from the word's own
 *                      position to the start of the string table
 *                      (string_table_offset = pos_of_word + word_value)
 *   Script bytecodes   opcode interpreter (~51 opcodes), 0xFF-terminated
 *   String table       0xFF-terminated strings; `@` (0x40) = line break
 *
 * Locations 60–70 use alternate layouts (string banks, castle blobs without a
 * `00 00 00` terminator, mixed text/script pools) — those are classified and
 * returned with their raw bytes rather than forced through the standard
 * parser.
 */

export const EVENT_LOCATION_COUNT = 71;
export const EVENT_HEADER_SIZE = EVENT_LOCATION_COUNT * 6;
export const EVENT_MAX_RECORD = 0x8ac;

export interface EventHeaderEntry {
  index: number;
  offset: number;
  length: number;
}

export type EventRecordKind = 'standard' | 'string-bank' | 'castle-blob' | 'mixed-pool' | 'unknown';

export interface EventTriplet {
  /** Packed tile position `(y << 4) | x` in the 16×16 grid. */
  pos: number;
  handlerId: number;
  cond: number;
}

export interface EventLocation {
  id: number;
  kind: EventRecordKind;
  header: EventHeaderEntry;
  triplets: EventTriplet[];
  /** 0xFF-terminated script bytecodes (may be empty for non-standard kinds). */
  script: Uint8Array;
  /** Decoded 0xFF-terminated strings (trailing 0xFF stripped). */
  strings: string[];
  /** Raw record bytes (bytes after the 6-byte-per-location slice header). */
  raw: Uint8Array;
}

export interface EventFile {
  header: EventHeaderEntry[];
  locations: EventLocation[];
}

export function decodeEventHeader(data: Uint8Array): EventHeaderEntry[] {
  if (data.length < EVENT_HEADER_SIZE) {
    throw new Error(`event.dat: too small for header (${data.length})`);
  }
  const header: EventHeaderEntry[] = [];
  for (let i = 0; i < EVENT_LOCATION_COUNT; i++) {
    const o = i * 6;
    const offset = ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
    const length = (data[o + 4] << 8) | data[o + 5];
    header.push({ index: i, offset, length });
  }
  return header;
}

/** Verify the documented contiguous-partition invariant across all 71 entries. Returns violations (empty = clean). */
export function verifyEventContiguity(data: Uint8Array, header: EventHeaderEntry[]): string[] {
  const violations: string[] = [];
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const next = header[i + 1];
    const actualEnd = next ? next.offset : data.length;
    if (h.offset + h.length !== actualEnd) {
      violations.push(
        `entry ${i}: offset+length ${h.offset + h.length} != next offset/EOF ${actualEnd}`,
      );
    }
  }
  return violations;
}

function classifyRecord(terminated: boolean, scriptLength: number, stringCount: number, tripletCount: number): EventRecordKind {
  if (terminated && scriptLength > 0 && stringCount > 0) return 'standard';
  if (terminated && tripletCount === 0 && stringCount > 0) return 'string-bank';
  if (!terminated) return 'castle-blob';
  return 'mixed-pool';
}

/**
 * Parse one location record. `data` spans exactly this location's bytes.
 * Non-standard layouts are classified and returned raw.
 */
export function decodeEventLocation(id: number, record: Uint8Array): EventLocation {
  const triplets: EventTriplet[] = [];
  let cursor = 0;
  let terminatorAt = -1;
  while (cursor + 3 <= record.length) {
    if (record[cursor] === 0 && record[cursor + 1] === 0 && record[cursor + 2] === 0) {
      terminatorAt = cursor;
      break;
    }
    triplets.push({ pos: record[cursor], handlerId: record[cursor + 1], cond: record[cursor + 2] });
    cursor += 3;
  }

  if (terminatorAt < 0) {
    return {
      id,
      kind: classifyRecord(false, 0, 0, triplets.length),
      header: { index: id, offset: 0, length: record.length },
      triplets,
      script: new Uint8Array(0),
      strings: [],
      raw: Uint8Array.from(record),
    };
  }

  const wordPos = terminatorAt + 3;
  if (wordPos + 2 > record.length) {
    return { id, kind: 'unknown', header: { index: id, offset: 0, length: record.length }, triplets, script: new Uint8Array(0), strings: [], raw: Uint8Array.from(record) };
  }
  const stringOffsetRel = record[wordPos] | (record[wordPos + 1] << 8);
  const stringTableStart = wordPos + stringOffsetRel;

  const script = Uint8Array.from(record.subarray(wordPos + 2, Math.max(wordPos + 2, stringTableStart)));

  const strings: string[] = [];
  let s = stringTableStart;
  let current = '';
  while (s < record.length) {
    const b = record[s++];
    if (b === 0xff) {
      strings.push(current);
      current = '';
    } else {
      current += String.fromCharCode(b);
    }
  }
  if (current.length > 0) strings.push(current);

  const kind = classifyRecord(true, script.length, strings.length, triplets.length);
  return {
    id,
    kind,
    header: { index: id, offset: 0, length: record.length },
    triplets,
    script,
    strings,
    raw: Uint8Array.from(record),
  };
}

export function decodeEventFile(data: Uint8Array): EventFile {
  const header = decodeEventHeader(data);
  const locations: EventLocation[] = [];
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const end = i + 1 < header.length ? header[i + 1].offset : data.length;
    // The game clamps data_length to EVENT_MAX_RECORD at runtime (see the
    // header doc comment); mirror that so a corrupt/oversized length field
    // can't read past what the real engine would ever have loaded.
    const length = Math.min(h.length, EVENT_MAX_RECORD);
    const record = data.subarray(h.offset, Math.min(end, h.offset + length));
    locations.push(decodeEventLocation(i, record));
  }
  return { header, locations };
}

export function encodeEventFile(event: EventFile): Uint8Array {
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(EVENT_HEADER_SIZE);
  const w = new DataView(header.buffer);
  let cursor = EVENT_HEADER_SIZE;
  for (const loc of event.locations) {
    w.setUint32(loc.id * 6, cursor);
    w.setUint16(loc.id * 6 + 4, loc.raw.length);
    parts.push(loc.raw);
    cursor += loc.raw.length;
  }
  const out = new Uint8Array(EVENT_HEADER_SIZE + parts.reduce((a, p) => a + p.length, 0));
  out.set(header, 0);
  let off = EVENT_HEADER_SIZE;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
