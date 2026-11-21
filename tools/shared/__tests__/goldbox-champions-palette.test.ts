import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAmigaDaaDirectory, readDosDaxDirectory, decompressDosDaxEntry } from '../goldbox-dosdax.ts';
import { daaTileIndices, decodeChampionsWallTileSurface, readChampionsWallPalette } from '../goldbox-daa-tiles.ts';

const D = resolve(__dirname, '../../../data/ssi/ChampionsOfKrynn/data');

describe.skipIf(!existsSync(resolve(D, '8X8D1.DAX')))('Champions wall tiles vs DOS 8X8D1.DAX (pixel-index oracle)', () => {
  const dax = readFileSync(resolve(D, '8X8D1.DAX'));
  const daa = readFileSync(resolve(D, '8X8D1.DAA'));
  const dd = readDosDaxDirectory(dax);
  const ad = readAmigaDaaDirectory(daa);

  function agreement(id: number, shuffle: boolean): number {
    const d = decompressDosDaxEntry(dax, dd.dataOffset, dd.entries.find((e) => e.id === id)!);
    const a = decompressDosDaxEntry(daa, ad.dataOffset, ad.entries.find((e) => e.id === id)!);
    const surf = decodeChampionsWallTileSurface(a);
    const body = d.subarray(17); // 9-byte LE header + 8-byte EGA->CGA map
    const n = Math.min(Math.floor(body.length / 32), surf.tileCount);
    let ok = 0;
    for (let t = 0; t < n; t++) {
      const idx = daaTileIndices(surf, shuffle ? (t * 7 + 3) % n : t);
      for (let r = 0; r < 8; r++)
        for (let x = 0; x < 8; x++) {
          const byte = body[t * 32 + r * 4 + (x >> 1)];
          if ((x & 1 ? byte & 15 : byte >> 4) === idx[r][x]) ok++;
        }
    }
    return ok / (n * 64);
  }

  it('Amiga DAA pixel indices equal DOS nibbles (identity mapping)', () => {
    for (const id of [11, 23, 202]) expect(agreement(id, false)).toBe(1);
    expect(agreement(203, false)).toBeGreaterThan(0.999);
  });
  it('null control: mismatched tile pairing collapses to chance', () => {
    for (const id of [11, 23]) expect(agreement(id, true)).toBeLessThan(0.5);
  });
  it('wall palette is the EGA default ramp (entries 0-15)', () => {
    const f = readAmigaDaaDirectory(readFileSync(resolve(D, 'DUNGCOM.DAA')));
    const raw = decompressDosDaxEntry(readFileSync(resolve(D, 'DUNGCOM.DAA')), f.dataOffset, f.entries[0]);
    const p = readChampionsWallPalette(raw);
    expect(p.length).toBe(16);
    expect(p.map((c) => c.toString(16).padStart(3, '0')).join(' ')).toBe('000 00a 0a0 0aa a00 a0a a50 aaa 555 55f 5f5 5ff f55 f5f ff5 fff');
  });
});
