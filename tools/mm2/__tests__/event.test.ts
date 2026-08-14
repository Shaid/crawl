import { describe, expect, it } from 'vitest';
import {
  decodeEventFile,
  encodeEventFile,
  decodeEventLocation,
  verifyEventContiguity,
  EVENT_LOCATION_COUNT,
  EVENT_MAX_RECORD,
} from '../event.ts';

/** Build a standard location record: triplets + string-offset word + script + 0xFF-terminated strings. */
function buildStandardRecord(): Uint8Array {
  const triplets = [0x74, 0x2a, 0x10, 0x00, 0x00, 0x00]; // pos (7,4), handler 42, cond 0x10, then terminator
  const script = [0x01, 0x05, 0xff]; // some bytes then 0xFF script terminator
  const strings = [0x41, 0x42, 0xff, 0x43, 0xff]; // "AB" and "C", 0xFF-terminated
  // String-offset word: relative from its own position to the string table.
  const wordPos = triplets.length;
  const stringStart = wordPos + 2 + script.length;
  const wordValue = stringStart - wordPos;
  return Uint8Array.from([
    ...triplets,
    wordValue & 0xff, (wordValue >> 8) & 0xff,
    ...script,
    ...strings,
  ]);
}

describe('event.dat codec', () => {
  it('parses a standard location: triplets, script, strings', () => {
    const loc = decodeEventLocation(0, buildStandardRecord());
    expect(loc.kind).toBe('standard');
    expect(loc.triplets).toEqual([{ pos: 0x74, handlerId: 0x2a, cond: 0x10 }]);
    expect([...loc.script]).toEqual([0x01, 0x05, 0xff]);
    expect(loc.strings).toEqual(['AB', 'C']);
  });

  it('classifies records without a 00 00 00 terminator as castle-blob', () => {
    const blob = Uint8Array.from([0x01, 0x02, 0x03, 0xff, 0x00, 0x41, 0x42]);
    const loc = decodeEventLocation(63, blob);
    expect(loc.kind).toBe('castle-blob');
  });

  it('decodes and re-encodes a whole file with header round-trip', () => {
    const standard = buildStandardRecord();
    const locations = new Array<Uint8Array>(EVENT_LOCATION_COUNT);
    for (let i = 0; i < EVENT_LOCATION_COUNT; i++) {
      locations[i] = i === 0 ? standard : Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]);
    }
    const header = new Uint8Array(EVENT_LOCATION_COUNT * 6);
    const w = new DataView(header.buffer);
    let cursor = EVENT_LOCATION_COUNT * 6;
    for (let i = 0; i < EVENT_LOCATION_COUNT; i++) {
      w.setUint32(i * 6, cursor);
      w.setUint16(i * 6 + 4, locations[i].length);
      cursor += locations[i].length;
    }
    const file = new Uint8Array(cursor);
    file.set(header, 0);
    let off = EVENT_LOCATION_COUNT * 6;
    for (const loc of locations) {
      file.set(loc, off);
      off += loc.length;
    }

    const parsed = decodeEventFile(file);
    expect(parsed.locations.length).toBe(EVENT_LOCATION_COUNT);
    expect(parsed.locations[0].triplets).toEqual([{ pos: 0x74, handlerId: 0x2a, cond: 0x10 }]);
    expect(parsed.locations[0].strings).toEqual(['AB', 'C']);

    const violations = verifyEventContiguity(file, parsed.header);
    expect(violations).toEqual([]);

    expect([...encodeEventFile(parsed)]).toEqual([...file]);
  });

  it('clamps a header data_length beyond EVENT_MAX_RECORD (matches the runtime clamp)', () => {
    // One location whose declared length is EVENT_MAX_RECORD + 100, filled
    // with non-zero bytes so an unclamped read would visibly overrun.
    const declaredLength = EVENT_MAX_RECORD + 100;
    const locations = new Array<Uint8Array>(EVENT_LOCATION_COUNT);
    for (let i = 0; i < EVENT_LOCATION_COUNT; i++) {
      locations[i] = i === 0 ? new Uint8Array(declaredLength).fill(0x41) : Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]);
    }
    const header = new Uint8Array(EVENT_LOCATION_COUNT * 6);
    const w = new DataView(header.buffer);
    let cursor = EVENT_LOCATION_COUNT * 6;
    for (let i = 0; i < EVENT_LOCATION_COUNT; i++) {
      w.setUint32(i * 6, cursor);
      w.setUint16(i * 6 + 4, locations[i].length & 0xffff);
      cursor += locations[i].length;
    }
    const file = new Uint8Array(cursor);
    file.set(header, 0);
    let off = EVENT_LOCATION_COUNT * 6;
    for (const loc of locations) {
      file.set(loc, off);
      off += loc.length;
    }

    const parsed = decodeEventFile(file);
    expect(parsed.locations[0].raw.length).toBe(EVENT_MAX_RECORD);
  });
});
