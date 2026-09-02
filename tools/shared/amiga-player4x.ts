/**
 * "The Player" 4.0A/4.0B/4.1A — a proprietary Amiga module packer by Jarno
 * Paananen ("Guru"/Sahara Surfers). Never publicly released as a standalone
 * tool, but licensed/leaked to game studios and consequently one of the
 * most common packed-module formats found embedded in commercial Amiga
 * games (confirmed here: all 10 of Dungeon Master II's `music/*.MOD` files
 * are actually `P41A`-signed — despite the `.MOD` extension, they are NOT
 * standard ProTracker modules and won't play correctly in a generic MOD
 * player without unpacking first).
 *
 * This is a faithful TypeScript port of the real, public-domain-equivalent
 * (MIT-licensed) reference unpacker `depack_p4x()` from libxmp's ProWizard
 * loader collection — github.com/libxmp/libxmp,
 * `src/loaders/prowizard/p40.c` (fetched 2026-09-02) — ported statement-by-
 * statement (including its exact loop/branch structure) rather than
 * "cleaned up", to avoid the classic goto-to-loop iteration-shift trap when
 * porting a C depacker (see `decompressor-port-loop-condition-iteration-
 * shift.md`). `ptk_table` is copied verbatim from the same project's
 * `ptktable.c`. libxmp itself is a well-established, widely-used module
 * player library — chosen over hand-deriving the format from scratch per
 * this project's "standard codec, delegate to a trusted decoder" rule.
 *
 * Output: a byte-exact standard ProTracker `M.K.`-tagged `.mod` file,
 * playable in any generic tracker/player — see `convertPlayer4xToMod()`.
 *
 * **Verified**: applied to all 10 of DM2's real `music/*.MOD` files, every
 * one decodes with 0 exceptions to a well-formed `M.K.` module (in-range
 * sample/pattern counts, non-degenerate PCM sample data — real, varied
 * byte values, not flat/silent). Not verified by ear (no audio player
 * available in this environment) — see `docs/dungeonmaster2/TODO.md`.
 */

export const MAGIC_P40A = 0x50343041; // 'P40A'
export const MAGIC_P40B = 0x50343042; // 'P40B'
export const MAGIC_P41A = 0x50343141; // 'P41A'

/** ProTracker Amiga period table, indexed [semitone][0]=period-hi-nibble-ish byte, [1]=period-lo — copied verbatim from libxmp's `ptktable.c`. */
const PTK_TABLE: [number, number][] = [
  [0x00, 0x00],
  [0x03, 0x58], [0x03, 0x28], [0x02, 0xfa], [0x02, 0xd0], [0x02, 0xa6], [0x02, 0x80],
  [0x02, 0x5c], [0x02, 0x3a], [0x02, 0x1a], [0x01, 0xfc], [0x01, 0xe0], [0x01, 0xc5],
  [0x01, 0xac], [0x01, 0x94], [0x01, 0x7d], [0x01, 0x68], [0x01, 0x53], [0x01, 0x40],
  [0x01, 0x2e], [0x01, 0x1d], [0x01, 0x0d], [0x00, 0xfe], [0x00, 0xf0], [0x00, 0xe2],
  [0x00, 0xd6], [0x00, 0xca], [0x00, 0xbe], [0x00, 0xb4], [0x00, 0xaa], [0x00, 0xa0],
  [0x00, 0x97], [0x00, 0x8f], [0x00, 0x87], [0x00, 0x7f], [0x00, 0x78], [0x00, 0x71],
];

function ptkIsValidNote(n: number): boolean {
  return n >= 0 && n < PTK_TABLE.length;
}

/** A read cursor over a Uint8Array, mirroring libxmp's `HIO_HANDLE` (`hio_read8/16b/32b`, `hio_tell`, `hio_seek`). */
class Cursor {
  pos = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  u8(): number {
    return this.data[this.pos++] ?? 0;
  }
  u16be(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32be(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  seek(p: number) {
    this.pos = p;
  }
  tell(): number {
    return this.pos;
  }
}

export interface P4xSample {
  size: number; // in words (matches the standard MOD sample-length field convention)
  finetune: number; // 0-15
  volume: number;
  loopStart: number; // in words
  loopLength: number; // in words
  data: Uint8Array; // raw signed 8-bit PCM
}

export interface P4xModule {
  version: 'P40A' | 'P40B' | 'P41A';
  songLength: number; // == real pattern count (this format's pattern order is always sequential 0..songLength-1)
  samples: P4xSample[];
  /** `patterns[p][row]` is one 16-byte MOD row (4 channels x 4 bytes each). */
  patterns: Uint8Array[][];
}

function setEvent(c1: number, c2: number, c3: number): [number, number, number, number] {
  let note = c1 & 0x7f;
  let vc1 = c1, vc2 = c2, vc3 = c3;
  // "The Player 4.x may have junk data after Dxx, just dummy bad events for
  // now" — same guard as libxmp's port, needed because some titles' packed
  // modules contain trailing junk this format's own grammar can't bound.
  if (!ptkIsValidNote(note >> 1)) {
    note = vc1 = vc2 = vc3 = 0;
  }
  const period = PTK_TABLE[note >> 1]!;
  const b0 = ((vc1 << 4) & 0x10) | period[0];
  const b1 = period[1];
  // `b` is the effect nibble of the ORIGINAL (pre-adjustment) c2 — computed
  // before the 0x08 normalization below, matching the reference decoder's
  // exact evaluation order.
  const b = vc2 & 0x0f;
  if (b === 0x08) vc2 -= 0x08;
  let b3 = vc3;
  if (b === 0x05 || b === 0x06 || b === 0x0a) {
    b3 = vc3 > 0x7f ? (vc3 << 4) & 0xf0 : vc3;
  }
  return [b0, b1, vc2, b3];
}

/**
 * Decode a `P40A`/`P40B`/`P41A`-packed module into its logical structure.
 * Throws on malformed/unrecognized input rather than silently misreading —
 * mirrors libxmp's own `depack_p4x()` control flow (including its exact
 * loop/repeat/loop-back-reference branches for pattern-track decoding).
 */
export function decodePlayer4x(data: Uint8Array): P4xModule {
  const magicWord = ((data[0] ?? 0) << 24) | ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0);
  let version: P4xModule['version'];
  if (magicWord === MAGIC_P40A) version = 'P40A';
  else if (magicWord === MAGIC_P40B) version = 'P40B';
  else if ((magicWord >>> 0) === MAGIC_P41A) version = 'P41A';
  else throw new Error('not a P40A/P40B/P41A module (bad magic)');

  const cur = new Cursor(data);
  cur.seek(4);
  cur.u8(); // "Real number of pattern" — read but unused, matches the reference decoder exactly
  const len = cur.u8(); // number of patterns in the list == song length
  if (len >= 128) throw new Error('P4x: pattern list length out of range');
  const nsmp = cur.u8();
  if (nsmp > 31) throw new Error('P4x: sample count out of range');
  cur.u8(); // bypass empty byte
  const trkdatOfs = cur.u32be() + 4;
  const trktabOfs = cur.u32be() + 4;
  const smpOfs = cur.u32be() + 4;
  if (trkdatOfs < 4 || trktabOfs < 4 || smpOfs < 4) throw new Error('P4x: bad section offsets');
  if (trkdatOfs >= data.length || trktabOfs >= data.length || smpOfs >= data.length) {
    throw new Error('P4x: section offset past EOF');
  }

  interface RawSampleHeader {
    addr: number;
    size: number;
    loopAddr: number;
    loopSize: number;
    finetune: number;
    volume: number;
  }
  const rawSamples: RawSampleHeader[] = [];
  for (let i = 0; i < nsmp; i++) {
    const addr = cur.u32be();
    const size = cur.u16be();
    const loopAddr = cur.u32be();
    const loopSize = cur.u16be();
    let finetune = 0;
    if (version === 'P40A' || version === 'P40B') finetune = cur.u16be();
    cur.u8(); // bypass 0x00
    const volume = cur.u8();
    if (version === 'P41A') finetune = cur.u16be();
    if (addr < 0 || loopAddr < addr || addr > data.length - smpOfs) {
      throw new Error(`P4x: sample ${i} header out of range`);
    }
    rawSamples.push({ addr, size, loopAddr, loopSize, finetune, volume });
  }

  const samples: P4xSample[] = rawSamples.map((s) => ({
    size: s.size,
    finetune: Math.trunc(s.finetune / 74) & 0xff,
    volume: s.volume,
    loopStart: (s.loopAddr - s.addr) / 2,
    loopLength: s.loopSize,
    data: new Uint8Array(0), // filled below
  }));

  // Track (per pattern-slot, per channel) start addresses.
  cur.seek(trktabOfs);
  const trackAddr: number[][] = [];
  for (let i = 0; i < len; i++) {
    const row: number[] = [];
    for (let j = 0; j < 4; j++) row.push(cur.u16be() + trkdatOfs);
    trackAddr.push(row);
  }

  // Decode pattern track data — a faithful line-by-line port of
  // libxmp's depack_p4x() main track-decode loop. Each row is 16 bytes:
  // 4 channels x 4 bytes/event, the standard MOD pattern-row layout.
  const patterns: Uint8Array[][] = Array.from({ length: len }, () =>
    Array.from({ length: 64 }, () => new Uint8Array(16)),
  );

  for (let i = 0; i < len; i++) {
    for (let j = 0; j < 4; j++) {
      cur.seek(trackAddr[i]![j]!);
      for (let k = 0; k < 64; k++) {
        let c1 = cur.u8();
        let c2 = cur.u8();
        let c3 = cur.u8();
        let c4 = cur.u8();

        if (c1 !== 0x80) {
          writeEventIntoRow(patterns[i]!, k, j, setEvent(c1, c2, c3));

          if (c4 > 0x00 && c4 < 0x80) {
            k += c4;
          }
          if (c4 > 0x7f) {
            k++;
            for (let l = 256; l > c4; l--) {
              if (k >= 64) break;
              writeEventIntoRow(patterns[i]!, k, j, setEvent(c1, c2, c3));
              k++;
            }
            k--;
          }
          continue;
        }

        // c1 === 0x80: loop-back reference — read `c5+1` events starting
        // at absolute address `b`, then resume the original position `a`.
        const a = cur.tell();
        const c5 = c2;
        const b = (c3 << 8) + c4 + trkdatOfs;
        cur.seek(b);

        for (let c = 0; c <= c5; c++) {
          if (k >= 64) break;
          c1 = cur.u8();
          c2 = cur.u8();
          c3 = cur.u8();
          c4 = cur.u8();
          writeEventIntoRow(patterns[i]!, k, j, setEvent(c1, c2, c3));

          if (c4 > 0x00 && c4 < 0x80) {
            k += c4;
          }
          if (c4 > 0x7f) {
            k++;
            for (let l = 256; l > c4; l--) {
              if (k >= 64) break;
              writeEventIntoRow(patterns[i]!, k, j, setEvent(c1, c2, c3));
              k++;
            }
            k--;
          }
          k++;
        }
        k--;
        cur.seek(a);
      }
    }
  }

  // Sample PCM data.
  for (let i = 0; i < nsmp; i++) {
    const s = rawSamples[i]!;
    const byteSize = s.size * 2;
    const start = smpOfs + s.addr;
    samples[i]!.data = data.subarray(start, start + byteSize);
  }

  return { version, songLength: len, samples, patterns };
}

function writeEventIntoRow(rows: Uint8Array[], row: number, channel: number, event: [number, number, number, number]) {
  if (row < 0 || row >= rows.length) return;
  rows[row]!.set(event, channel * 4);
}

/** Build a standard ProTracker `M.K.`-tagged .mod file from a decoded `P4xModule`. */
export function player4xToProtrackerMod(mod: P4xModule): Uint8Array {
  const parts: Uint8Array[] = [];
  const push = (b: Uint8Array) => parts.push(b);
  const u8 = (v: number) => push(new Uint8Array([v & 0xff]));
  const u16be = (v: number) => push(new Uint8Array([(v >> 8) & 0xff, v & 0xff]));
  const zeros = (n: number) => push(new Uint8Array(n));

  zeros(20); // title

  for (let i = 0; i < 31; i++) {
    zeros(22); // sample name
    if (i < mod.samples.length) {
      const s = mod.samples[i]!;
      u16be(s.size);
      u8(s.finetune);
      u8(s.volume);
      u16be(s.loopStart);
      u16be(s.loopLength);
    } else {
      zeros(4); // size(2) + finetune(1) + volume(1)
      zeros(2); // loop start
      push(new Uint8Array([0x00, 0x01])); // loop length = 1 (standard "empty sample" convention)
    }
  }

  u8(mod.songLength);
  u8(0x7f); // "noisetracker byte" — standard ProTracker restart position convention
  const order = new Uint8Array(128);
  for (let i = 0; i < mod.songLength; i++) order[i] = i; // this format's order is always sequential
  push(order);
  push(new Uint8Array([0x4d, 0x2e, 0x4b, 0x2e])); // 'M.K.'

  for (const pattern of mod.patterns) {
    for (const row of pattern) push(row);
  }

  for (const s of mod.samples) push(s.data);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decode + re-encode in one call. */
export function convertPlayer4xToMod(data: Uint8Array): Uint8Array {
  return player4xToProtrackerMod(decodePlayer4x(data));
}

/** True if `data` starts with a recognized `P40A`/`P40B`/`P41A` magic. */
export function isPlayer4x(data: Uint8Array): boolean {
  const w = (((data[0] ?? 0) << 24) | ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0)) >>> 0;
  return w === MAGIC_P40A || w === MAGIC_P40B || (w >>> 0) === (MAGIC_P41A >>> 0);
}
