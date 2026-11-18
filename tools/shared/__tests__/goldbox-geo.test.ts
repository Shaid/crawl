import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGlibIndex, readBlock } from '../goldbox-glib.ts';
import { loadGlibFile } from '../goldbox-glib-codecs.ts';
import { decodeGeoLevel, decodeVariableGeoRecord, type GeoLevel } from '../goldbox-geo.ts';

const DQK_GEO = resolve(__dirname, '../../../data/ssi/DarkQueenOfKrynn/data/Disk3/GEO.GLB');

/** Fraction of interior edges where "wall present" agrees on both sides of the seam (S of a cell vs N of the one below, E vs W). */
function seamAgreement(l: GeoLevel): number {
  let ok = 0;
  let n = 0;
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      const c = l.cells[y * l.width + x];
      if (y + 1 < l.height) {
        n++;
        if ((c.wallS !== 0) === (l.cells[(y + 1) * l.width + x].wallN !== 0)) ok++;
      }
      if (x + 1 < l.width) {
        n++;
        if ((c.wallE !== 0) === (l.cells[y * l.width + x + 1].wallW !== 0)) ok++;
      }
    }
  return ok / n;
}

/** Re-decode with width/height swapped (the pre-2026-11-18 reading) -- the null control. */
function swapped(payload: Uint8Array): GeoLevel | undefined {
  const p = payload.slice();
  [p[0], p[1]] = [p[1], p[0]];
  return decodeVariableGeoRecord(p, 0);
}

describe('decodeVariableGeoRecord header order', () => {
  it('reads the header as (height, width), row-major', () => {
    const p = new Uint8Array(8 + 4 * 6);
    p[0] = 2; // height
    p[1] = 3; // width
    const l = decodeVariableGeoRecord(p, 1)!;
    expect(l.width).toBe(3);
    expect(l.height).toBe(2);
    expect(l.cells.length).toBe(6);
  });
});

describe.skipIf(!existsSync(DQK_GEO))('Dark Queen GEO.GLB (real data)', () => {
  const { data, container } = loadGlibFile(readFileSync(DQK_GEO));
  const levels = decodeGlibIndex(data, container)
    .map(({ id, blockIndex }) => ({ raw: readBlock(data, container.blocks[blockIndex]), id }))
    .map(({ raw, id }) => ({ raw, level: decodeGeoLevel(raw, id) }))
    .filter((x): x is { raw: Uint8Array; level: GeoLevel } => x.level !== undefined);

  it('decodes 20 levels', () => expect(levels.length).toBe(20));

  it('every level has seam agreement >= 0.90 (per level, not averaged)', () => {
    for (const { level } of levels) expect(seamAgreement(level), `level ${level.id}`).toBeGreaterThanOrEqual(0.9);
  });

  it('null control: the old (width,height) order collapses every non-square level', () => {
    const nonSquare = levels.filter((x) => x.level.width !== x.level.height);
    expect(nonSquare.length).toBeGreaterThanOrEqual(8);
    let sumGood = 0;
    let sumBad = 0;
    for (const { raw, level } of nonSquare) {
      const good = seamAgreement(level);
      const bad = seamAgreement(swapped(raw)!);
      expect(bad, `level ${level.id}`).toBeLessThan(good);
      sumGood += good;
      sumBad += bad;
    }
    expect((sumGood - sumBad) / nonSquare.length).toBeGreaterThan(0.1);
  });
});
