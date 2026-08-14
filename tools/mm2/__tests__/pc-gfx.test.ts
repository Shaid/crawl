import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  lzwDecompress,
  parseWallSheet,
  parseMonstersAtlas,
  decodeMonsterSprite,
  EGA_RGB,
  rowBytes,
  CGA_PALETTE_1,
} from '../pc-gfx.ts';

// --- synthetic / structural tests (no retail data required) -----------------

describe('rowBytes / palettes', () => {
  it('computes CGA (2bpp, 4 px/byte) and EGA (4bpp, 2 px/byte) row strides', () => {
    expect(rowBytes(4, 2)).toBe(1); // 4 px @ 4 px/byte
    expect(rowBytes(5, 2)).toBe(2); // rounds up
    expect(rowBytes(320, 2)).toBe(80);
    expect(rowBytes(4, 4)).toBe(2); // 4 px @ 2 px/byte
    expect(rowBytes(320, 4)).toBe(160);
  });
  it('exposes the documented CGA palette 1 and 16-colour EGA palette', () => {
    expect(CGA_PALETTE_1[1]).toEqual({ r: 85, g: 255, b: 255 }); // cyan
    expect(CGA_PALETTE_1[3]).toEqual({ r: 255, g: 255, b: 255 }); // white
    expect(EGA_RGB.length).toBe(16);
    expect(EGA_RGB[7]).toEqual({ r: 170, g: 170, b: 170 }); // light grey
  });
});

// --- real-data tests (retail files must be present; skipped otherwise) ------

const DOSEGA = resolve('data/mm2/dosega');
const hasData = existsSync(resolve(DOSEGA, 'MONSTERS.16')) && existsSync(resolve(DOSEGA, 'THROW.16'));

function sha(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe.skipIf(!hasData)('PC DOS .4/.16 codec — retail data', () => {
  it('decompresses every wall sheet to its declared size and parses frames', () => {
    const files = readdirSync(DOSEGA).filter((n) => /\.(4|16)$/i.test(n) && !/^MONSTERS\./i.test(n));
    expect(files.length).toBeGreaterThanOrEqual(58);
    let frames = 0;
    for (const name of files) {
      const raw = readFileSync(resolve(DOSEGA, name));
      const decSize = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
      const dec = lzwDecompress(raw.subarray(4), decSize);
      expect(dec.length).toBe(decSize); // LZW produces exactly the declared size
      const sheet = parseWallSheet(name, raw);
      expect(sheet.frames.length).toBeGreaterThan(0);
      frames += sheet.frames.length;
      for (const f of sheet.frames) {
        expect(f.width).toBeGreaterThanOrEqual(4);
        expect(f.height).toBeGreaterThanOrEqual(1);
        const expectRows = rowBytes(f.width, sheet.bpp);
        expect(f.pixels.length).toBe(expectRows * f.height);
      }
    }
    expect(frames).toBeGreaterThan(700); // reference round-trip documents 756/756 frames
  }, 20000);

  it('THROW.16 LZW payload hash matches the reference-decoder known answer', () => {
    const raw = readFileSync(resolve(DOSEGA, 'THROW.16'));
    const decSize = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
    const dec = lzwDecompress(raw.subarray(4), decSize);
    // Produced by Vairn's reference mm2_lzw.py on this same GOG file.
    expect(sha(dec)).toBe('e24909dbc156f9bdf0ceb3f47fa626b8f08f48bbd7dd23b6d086c6440de6f76f');
  });

  it('parses MONSTERS.16/4: 75-slot header, document-counted pictures, spider = pic 1', () => {
    for (const name of ['MONSTERS.16', 'MONSTERS.4']) {
      const raw = readFileSync(resolve(DOSEGA, name));
      const tableEnd = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
      expect(tableEnd).toBe(300); // 75 × u32
      const atlas = parseMonstersAtlas(name, raw);
      expect(atlas.offsets.length).toBe(75);
      // doc: MONSTERS.16 = 59/74 non-empty, MONSTERS.4 = 53/74
      const expected = name.endsWith('16') ? 59 : 53;
      const nonEmpty = atlas.offsets.filter((o) => o >= tableEnd && o + 8 <= raw.length).length;
      expect(nonEmpty).toBe(expected);
      const pic1 = atlas.pictures.get(1);
      expect(pic1).toBeDefined(); // spider
      expect(pic1!.frames.length).toBeGreaterThan(0);
      for (const pic of atlas.pictures.values()) {
        expect(pic.frames.length).toBeGreaterThan(0);
        expect(Array.isArray(pic.scripts)).toBe(true);
        for (const s of pic.scripts) expect(s.length % 2).toBe(0);
      }
    }
  }, 20000);

  it('decodeMonsterSprite produces exactly height rows with valid indices', () => {
    const raw = readFileSync(resolve(DOSEGA, 'MONSTERS.16'));
    const atlas = parseMonstersAtlas('MONSTERS.16', raw);
    let frames = 0;
    let invalid = 0;
    for (const pic of atlas.pictures.values()) {
      for (const f of pic.frames) {
        const grid = decodeMonsterSprite(f.width, f.height, f.stream, f.bpp);
        expect(grid.length).toBe(f.height);
        for (const row of grid) {
          if (row.length !== f.width) throw new Error(`row width mismatch`);
          for (const v of row) {
            if (v !== null && (v < 0 || v > 15)) invalid += 1;
          }
        }
        frames += 1;
      }
    }
    expect(invalid).toBe(0);
    expect(frames).toBeGreaterThan(100);
  });
});
