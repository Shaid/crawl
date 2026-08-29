import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { decodeSpecialAmigaCps, usesSpecialAmigaCodec } from '../decode-special-cps.ts';

const AMIGA_DIR = resolve('data/eotb/amiga');

describe('usesSpecialAmigaCodec', () => {
  it('is false for the real corpus TEXT.CPS -- confirmed a standard Kyra-bitmap file instead', () => {
    const p = join(AMIGA_DIR, 'TEXT.CPS');
    if (!existsSync(p)) return;
    const data = new Uint8Array(readFileSync(p));
    expect(usesSpecialAmigaCodec(data)).toBe(false);
  });

  it('is false for every LEVELn.INF in the corpus -- all 12 use the ordinary LCW path instead', () => {
    for (let i = 1; i <= 12; i++) {
      const p = join(AMIGA_DIR, `LEVEL${i}.INF`);
      if (!existsSync(p)) continue;
      const data = new Uint8Array(readFileSync(p));
      expect(usesSpecialAmigaCodec(data)).toBe(false);
    }
  });

  it('finds zero files anywhere in data/eotb/amiga/ that satisfy the codec-selection gate', () => {
    if (!existsSync(AMIGA_DIR)) return;
    const hits: string[] = [];
    for (const name of readdirSync(AMIGA_DIR)) {
      const p = join(AMIGA_DIR, name);
      if (!statSync(p).isFile()) continue;
      const data = new Uint8Array(readFileSync(p));
      if (usesSpecialAmigaCodec(data)) hits.push(name);
    }
    // Confirms the module doc's claim: this EOB1 (English) Amiga corpus
    // never actually exercises this codec -- everything decodes via the
    // ordinary LCW path (../lcw.ts) instead.
    expect(hits).toEqual([]);
  });
});

describe('decodeSpecialAmigaCps', () => {
  it('decodes a from-first-principles hand-built literal-path vector to the expected byte with a zero checksum', () => {
    // Bit-level derivation (see module doc for the full trace): a single
    // compressed word W = 0x40001040 drives the decoder down the
    // "else -> else -> para=3 (literal)" path with a 3-bit count of 0
    // (exactly 1 output byte) and 8 literal bits 0,1,0,0,0,0,0,1 = 0x41
    // ('A'), extracted from W's bits 0..12 in order (bit 30 set purely to
    // keep the shift register nonzero until all 13 bits are consumed, so
    // no refill -- and thus no out-of-bounds read past this one word --
    // is ever attempted).
    const inSize = 4;
    const outSize = 1;
    const W = (1 << 6) | (1 << 12) | (1 << 30);
    const chk = W >>> 0; // header chk XOR W must land on 0 with no further refills

    const data = new Uint8Array(16);
    const view = new DataView(data.buffer);
    view.setUint32(0, inSize, false);
    view.setUint32(4, outSize, false);
    view.setUint32(8, chk, false);
    view.setUint32(12, W, false);

    // Confirms this synthetic file takes the "no embedded palette" branch,
    // matching how it was constructed.
    expect(usesSpecialAmigaCodec(data)).toBe(true);

    const result = decodeSpecialAmigaCps(data);
    expect(result.palette).toBeUndefined();
    expect(Array.from(result.pixels)).toEqual([0x41]);
  });

  it('throws a checksum error when the header chk field is wrong', () => {
    const data = new Uint8Array(16);
    const view = new DataView(data.buffer);
    view.setUint32(0, 4, false);
    view.setUint32(4, 1, false);
    view.setUint32(8, 0, false); // wrong -- should be W itself
    view.setUint32(12, (1 << 6) | (1 << 12) | (1 << 30), false);
    expect(() => decodeSpecialAmigaCps(data)).toThrow(/checksum error/);
  });
});
