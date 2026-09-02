import { describe, expect, it } from 'vitest';
import {
  simonDecr,
  loadPalette,
  readAnimTable,
  decodeImage,
  unpackIndices,
  indicesToRGBA,
  discoverZones,
  pkdFilename,
} from '../agos-vga.ts';

/**
 * Minimal companion bit-writer for `simon_decr` fixtures — mirrors the
 * decoder's own bit-packing convention (LSB-first per 32-bit BE word, a
 * sentinel bit marking the seed word's valid payload length) so tests don't
 * depend on real `data/` files (gitignored, not guaranteed present).
 *
 * `simonDecr` itself is also verified end-to-end against all 628 real
 * `.pkd` files across the Elvira/Elvira 2/Waxworks corpora (zero decode
 * errors) — see docs/agos-pkd-format.md §1. This is a regression fence,
 * not the primary verification.
 */
class SimonDecrFixtureBuilder {
  private bits: number[] = []; // consumption order

  private pushBits(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  /** Encode a literal run using the short `0,0` token (up to 8 bytes/run). */
  literal(bytes: number[]): this {
    if (bytes.length < 1 || bytes.length > 8) throw new Error('short literal token covers 1-8 bytes');
    this.pushBits(0, 1); // not-match
    this.pushBits(0, 1); // literal-short
    this.pushBits(bytes.length - 1, 3); // extra (y=0 base, count = extra+1)
    for (const b of bytes) this.pushBits(b, 8);
    return this;
  }

  build(): Uint8Array {
    // Pack payload bits into 32-bit BE words: the seed word gets up to 31
    // payload bits plus a sentinel bit at position `len` (bit 31 is reserved
    // for the sentinel so the decoder's highest-set-bit scan can find it).
    // Every SUBSEQUENT word carries no sentinel and is refilled with a fixed
    // `bits = 31` by simonDecr's getbit() — but that refill call itself
    // *also* consumes local bit 0 without a decrement first, so a non-seed
    // word actually yields 32 usable bits (positions 0..31), not 31. Confirmed
    // by tracing simonDecr's own getbit() refill branch instruction-by-
    // instruction (tools/shared/agos-vga.ts's `getbit`): the refill sets
    // `bits = 31` and reads a bit in the same call, then 31 more
    // decrement-then-read calls follow before the next refill — 32 reads
    // total per non-seed word.
    const words: number[] = [];
    let i = 0;
    let first = true;
    while (i < this.bits.length || first) {
      const cap = first ? 31 : 32;
      const chunk = this.bits.slice(i, i + cap);
      i += chunk.length;
      let word = 0;
      for (let k = 0; k < chunk.length; k++) word |= chunk[k] << k;
      if (first) word |= 1 << chunk.length; // sentinel
      words.push(word >>> 0);
      first = false;
      if (chunk.length < cap) break;
    }
    // File layout: [...earlier words in reverse...] [seed word] [destlen u32 BE]
    // Words are consumed seed-first then toward the file start, so on disk
    // the seed word comes last (right before destlen) and later-consumed
    // words precede it.
    const wordBytes: number[] = [];
    for (let w = words.length - 1; w >= 0; w--) {
      const word = words[w];
      wordBytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
    }
    return new Uint8Array(wordBytes);
  }
}

describe('simonDecr (AGOS "old bundle" LZ77)', () => {
  // simonDecr writes the destination buffer BACKWARD (each decoded byte
  // goes to a decreasing index) and reads the bitstream forward through
  // tokens in stream order — so the overall output is the reverse of the
  // decode order. Feed literal() bytes in reverse of the desired final
  // buffer to build a fixture (confirmed against extract_agos.cpp's
  // `*--d = x` write pattern).
  it('decodes a synthetic all-literal stream built from the same bit convention', () => {
    const fixture = new SimonDecrFixtureBuilder().literal([0xef, 0xbe, 0xad, 0xde]).build();
    const destLen = 4;
    const trailer = new Uint8Array(4);
    new DataView(trailer.buffer).setUint32(0, destLen, false);
    const src = new Uint8Array(fixture.length + 4);
    src.set(fixture, 0);
    src.set(trailer, fixture.length);

    const out = simonDecr(src);
    expect(Array.from(out)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('decodes a longer synthetic stream spanning multiple literal tokens', () => {
    const builder = new SimonDecrFixtureBuilder();
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const reversed = [...expected].reverse();
    builder.literal(reversed.slice(0, 8)).literal(reversed.slice(8));
    const fixture = builder.build();
    const trailer = new Uint8Array(4);
    new DataView(trailer.buffer).setUint32(0, expected.length, false);
    const src = new Uint8Array(fixture.length + 4);
    src.set(fixture, 0);
    src.set(trailer, fixture.length);

    const out = simonDecr(src);
    expect(Array.from(out)).toEqual(expected);
  });
});

describe('pkdFilename / discoverZones', () => {
  it('builds Elvira (2-digit zone) and Waxworks (3-digit zone) filenames', () => {
    expect(pkdFilename('elvira', 1, 1)).toBe('011.pkd');
    expect(pkdFilename('elvira', 64, 2)).toBe('642.pkd');
    expect(pkdFilename('waxworks', 1, 1)).toBe('0011.pkd');
    expect(pkdFilename('waxworks', 0, 2)).toBe('0002.pkd');
  });

  it('groups a directory listing into zones by scheme', () => {
    const elviraFiles = ['011.pkd', '012.pkd', '013.out', '021.pkd', '1tune', 'gameamiga'];
    const zones = discoverZones(elviraFiles, 'elvira');
    expect(zones).toEqual([
      { zone: 1, type1: '011.pkd', type2: '012.pkd', type3: '013.out' },
      { zone: 2, type1: '021.pkd' },
    ]);

    const waxworksFiles = ['0001.pkd', '0002.pkd', '0033.OUT'];
    const wwZones = discoverZones(waxworksFiles, 'waxworks');
    expect(wwZones).toEqual([
      { zone: 0, type1: '0001.pkd', type2: '0002.pkd' },
      { zone: 3, type3: '0033.OUT' },
    ]);
  });
});

describe('loadPalette', () => {
  it('reads BE16 Amiga 12-bit RGB words at vga1 + BE16(vga1+6), scaled nibble*32 truncated', () => {
    const vga1 = new Uint8Array(6 + 2 + 3 * 2);
    const view = new DataView(vga1.buffer);
    view.setUint16(6, 8, false); // palette pointer -> offset 8
    view.setUint16(8, 0x0f96, false); // color 0: r=15 g=9 b=6
    view.setUint16(10, 0x0700, false); // color 1: r=7 g=0 b=0
    view.setUint16(12, 0x0000, false); // color 2: black

    const pal = loadPalette(vga1, 0, 3);
    expect(pal[0]).toEqual({ r: (15 * 32) & 0xff, g: (9 * 32) & 0xff, b: (6 * 32) & 0xff });
    expect(pal[1]).toEqual({ r: (7 * 32) & 0xff, g: 0, b: 0 });
    expect(pal[2]).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('readAnimTable + decodeImage', () => {
  it('parses an 8-byte-entry anim table and decodes a small uncompressed image', () => {
    // 4x8 image, colorDepth=4 (16 colours), uncompressed (flags=0):
    // interleaved per-word-position plane storage, 1 word column (width<=16).
    const width = 16;
    const height = 2;
    const colorDepth = 4;
    // Pick plane words so bitplaneToChunky produces a known 8-byte packed row.
    // Set only plane 0's bit 15 (leftmost pixel) high for row0, nothing else.
    const planeWordsRow0 = [0x8000, 0x0000, 0x0000, 0x0000];
    const planeWordsRow1 = [0x0000, 0x0000, 0x0000, 0x0000];

    const imgData = new Uint8Array(colorDepth * 2 * height);
    const iv = new DataView(imgData.buffer);
    let p = 0;
    for (const w of planeWordsRow0) { iv.setUint16(p, w, false); p += 2; }
    for (const w of planeWordsRow1) { iv.setUint16(p, w, false); p += 2; }

    // Table: entry 0 reserved (zero), entry 1 = this image.
    const table = new Uint8Array(16);
    const tv = new DataView(table.buffer);
    tv.setUint32(8, 16, false); // entry1.offset — also table's own span (offsEnd)
    table[12] = 0; // flags (uncompressed)
    table[13] = height;
    tv.setUint16(14, width, false); // width field (already a multiple of 16)

    const full = new Uint8Array(table.length + imgData.length);
    full.set(table, 0);
    full.set(imgData, table.length);

    const entries = readAnimTable(full);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ index: 1, offset: 16, width, height, flags: 0, compressed: false });

    const img = decodeImage(full.subarray(entries[0].offset), width, height, false, colorDepth);
    const indices = unpackIndices(img);
    // Row 0: leftmost pixel gets bit 0 of colorDepth set (plane0 bit15) -> index 1; rest 0.
    expect(indices.slice(0, width)).toEqual(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(indices.slice(width, width * 2)).toEqual(new Uint8Array(width));

    const rgba = indicesToRGBA(indices, [{ r: 0, g: 0, b: 0 }, { r: 255, g: 128, b: 64 }]);
    expect(rgba.slice(0, 4)).toEqual(new Uint8Array([255, 128, 64, 255]));
    expect(rgba.slice(4, 8)).toEqual(new Uint8Array([0, 0, 0, 255]));
  });
});
