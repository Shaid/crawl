import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadBard12Picture,
  loadBard3Picture,
  decodeBardstaleRLE,
  BARDSTALE_PICTURE_WIDTH,
  BARDSTALE_PICTURE_HEIGHT,
  type Cursor,
} from '../bardstale-codecs.ts';

// Synthetic, hand-built fixtures (format grammar only — no real corpus data needed).

describe('decodeBardstaleRLE', () => {
  it('decodes a literal run (0x80 | count) followed by the stop byte', () => {
    // 0x82 = literal run of 2 raw bytes: 0xAA, 0xBB, then 0x00 stops.
    const data = new Uint8Array([0x82, 0xaa, 0xbb, 0x00]);
    const at: Cursor = { v: 0 };
    expect(Array.from(decodeBardstaleRLE(data, at))).toEqual([0xaa, 0xbb]);
  });

  it('decodes a fill run (plain count) followed by the stop byte', () => {
    // 0x03 = fill run of 3 repeats of the next byte (0x7f), then 0x00 stops.
    const data = new Uint8Array([0x03, 0x7f, 0x00]);
    const at: Cursor = { v: 0 };
    expect(Array.from(decodeBardstaleRLE(data, at))).toEqual([0x7f, 0x7f, 0x7f]);
  });

  it('stops immediately on a leading zero byte (empty output)', () => {
    const data = new Uint8Array([0x00]);
    const at: Cursor = { v: 0 };
    expect(Array.from(decodeBardstaleRLE(data, at))).toEqual([]);
  });
});

describe('picture dimensions', () => {
  it('are the confirmed 112x88 view-window size', () => {
    expect(BARDSTALE_PICTURE_WIDTH).toBe(112);
    expect(BARDSTALE_PICTURE_HEIGHT).toBe(88);
  });
});

// Real-corpus regression tests (data/ is gitignored -- guarded, skipped when absent).
// See docs/bardstale-picture-format.md for the byte-exact ground-truth oracle
// (Kroah's C# Picture Viewer source, whose bundled Files/ dir is cmp-identical
// to these corpus files) this codec was ported from.

const BT1_PICS = resolve('data/_unexplored_/BardsTaleNTSC/data/bards_data/pics');
const BT2_PICS = resolve('data/_unexplored_/BardsTale2/data/bards_data/pics');
const BT3_ALL_PIC = resolve('data/_unexplored_/BardsTale3/data/all.pic');
const BT3_BARD3 = resolve('data/_unexplored_/BardsTale3/data/bard3');

describe('loadBard12Picture, real corpus', () => {
  it('BT1: every one of the 55 confirmed real pictures decodes to a 4928-byte 4bpp-planar base picture', () => {
    if (!existsSync(BT1_PICS)) return;
    const dump = new Uint8Array(readFileSync(BT1_PICS));
    for (let i = 0; i < 55; i++) {
      const pic = loadBard12Picture(dump, i, 1);
      expect(pic.basePicture.length).toBe((BARDSTALE_PICTURE_WIDTH * BARDSTALE_PICTURE_HEIGHT) / 2);
      expect(pic.paletteWords.length).toBe(16);
    }
  });

  it('BT1: index 55 (one past the real directory) throws rather than hanging or returning garbage', () => {
    if (!existsSync(BT1_PICS)) return;
    const dump = new Uint8Array(readFileSync(BT1_PICS));
    expect(() => loadBard12Picture(dump, 55, 1)).toThrow();
  });

  it('BT2: every one of the 61 real pictures decodes; the 3 confirmed placeholder slots (25, 30, 52) throw', () => {
    if (!existsSync(BT2_PICS)) return;
    const dump = new Uint8Array(readFileSync(BT2_PICS));
    const placeholders = new Set([25, 30, 52]);
    let ok = 0;
    for (let i = 0; i < 64; i++) {
      if (placeholders.has(i)) {
        expect(() => loadBard12Picture(dump, i, 2)).toThrow();
        continue;
      }
      const pic = loadBard12Picture(dump, i, 2);
      expect(pic.basePicture.length).toBe((BARDSTALE_PICTURE_WIDTH * BARDSTALE_PICTURE_HEIGHT) / 2);
      ok++;
    }
    expect(ok).toBe(61);
  });
});

describe('loadBard3Picture, real corpus', () => {
  it('every one of the 84 confirmed real pictures decodes to 4 x 4928-byte chunky sub-frames with a resolved palette', () => {
    if (!existsSync(BT3_ALL_PIC) || !existsSync(BT3_BARD3)) return;
    const allPic = new Uint8Array(readFileSync(BT3_ALL_PIC));
    const bard3 = new Uint8Array(readFileSync(BT3_BARD3));
    for (let i = 0; i < 84; i++) {
      const pic = loadBard3Picture(allPic, bard3, i);
      expect(pic.subFrames.length).toBe(4 * ((BARDSTALE_PICTURE_WIDTH * BARDSTALE_PICTURE_HEIGHT) / 2));
      expect(pic.paletteWords.length).toBe(16);
    }
  });

  it('the directory sentinel at index 85 equals the real file length (NOT index 84 -- see docs/bardstale-picture-format.md §2 correction)', () => {
    if (!existsSync(BT3_ALL_PIC)) return;
    const allPic = new Uint8Array(readFileSync(BT3_ALL_PIC));
    const sentinel = (allPic[85 * 4]! << 24) | (allPic[85 * 4 + 1]! << 16) | (allPic[85 * 4 + 2]! << 8) | allPic[85 * 4 + 3]!;
    expect(sentinel >>> 0).toBe(allPic.length);
  });

  it('directory slot 84 (the 85th record, between the last real picture and the sentinel) declares a plausible uncompressedSize but its LZ77 stream runs past EOF', () => {
    if (!existsSync(BT3_ALL_PIC) || !existsSync(BT3_BARD3)) return;
    const allPic = new Uint8Array(readFileSync(BT3_ALL_PIC));
    const bard3 = new Uint8Array(readFileSync(BT3_BARD3));
    expect(() => loadBard3Picture(allPic, bard3, 84)).toThrow(/read past end of buffer/);
  });
});
