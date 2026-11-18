import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDirectWall, resolveWallFlatId, wallTypeFor, type Direction, type GeoLevel } from '../goldbox-geo.ts';
import { resolveFlatWalldefId, SLICES_PER_WALLSET } from '../goldbox-walltiles.ts';

// Reads the exporter's own output (regenerate: npx tsx tools/deathknightsofkrynn/amiga/export-data.ts).
const DIR = resolve(__dirname, '../../../public/assets/deathknightsofkrynn/amiga/dungeon');

describe.skipIf(!existsSync(resolve(DIR, 'levels-index.json')))('Death Knights direct-slice wall model (exported data)', () => {
  const idx = JSON.parse(readFileSync(resolve(DIR, 'levels-index.json'), 'utf8')) as { levels: { file: string }[] };
  const levels = idx.levels.map((l) => JSON.parse(readFileSync(resolve(DIR, '..', l.file), 'utf8')) as GeoLevel);
  const walls = (JSON.parse(readFileSync(resolve(DIR, 'wall-index.json'), 'utf8')) as { walls: { id: number; wallNumber: number }[] }).walls;
  const has = (id: number, n: number) => walls.some((w) => w.id === id && w.wallNumber === n);
  const maxN = new Map<number, number>();
  for (const w of walls) maxN.set(w.id, Math.max(maxN.get(w.id) ?? -1, w.wallNumber));
  const flat = [...maxN].map(([id, m]) => ({ id, wallsetCount: Math.ceil((m + 1) / SLICES_PER_WALLSET) }));
  const bound = levels.filter((l) => l.wallsetBinding?.directWalldefId !== undefined);

  it('resolved levels carry directWalldefId (16 of 19)', () => expect(bound.length).toBe(16));

  it('direct model resolves every wall face; the old per-slot model leaves slots 2/3 unbound', () => {
    let faces = 0;
    let direct = 0;
    let old = 0;
    for (const l of bound)
      for (const c of l.cells)
        for (const d of [0, 2, 4, 6] as Direction[]) {
          if (wallTypeFor(c, d) === 0) continue;
          faces++;
          const r = resolveDirectWall(c, d, l.wallsetBinding);
          if (r && has(r.walldefId, r.wallNumber)) direct++;
          const f = resolveWallFlatId(c, d, l.wallsetBinding);
          const e = f && resolveFlatWalldefId(flat, f.flatId);
          if (e && has(e.baseId, e.wallsetIndex * SLICES_PER_WALLSET + f.slice)) old++;
        }
    expect(faces).toBeGreaterThan(7000);
    expect(direct).toBe(faces);
    // Null control: the old model must NOT reach the same coverage, else this test could not discriminate.
    expect(old).toBeLessThan(faces * 0.8);
  });
});
