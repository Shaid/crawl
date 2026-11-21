/**
 * Zombi (Amiga) per-cell map export: `plan` + `i-lieux` + `LIEUX.SEQ` frame
 * offsets -> `public/assets/zombi/amiga/data/map.json` (6 floor levels, each a
 * 7x8 grid of per-cell faces + picture reference). Wired into the zombi
 * `buildAssets` hook (tools/shared/game-config.ts).
 *
 * Usage: npx tsx tools/zombi/amiga/export-map.ts [dataDir]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { parseSeq } from '../../shared/cyberpaint-seq.ts';
import { locationFrame, resolveDataDir } from './export-data.ts';
import { buildMap, parseLieux, parsePlan, type ZombiMap } from './map.ts';

export function buildZombiMap(dir: string): ZombiMap {
  const plan = parsePlan(new Uint8Array(readFileSync(resolve(dir, 'plan'))));
  const recs = parseLieux(new Uint8Array(readFileSync(resolve(dir, 'i-lieux'))));
  const seq = parseSeq(new Uint8Array(readFileSync(resolve(dir, 'LIEUX.SEQ'))));
  return buildMap(plan, recs, (id) => {
    const frame = locationFrame(id, recs[id - 1].pictureOverride);
    const f = seq.frames[frame];
    // The game blits the frame at (8 + frame.x, 48 + frame.y) — `zombi` S_0 +0x299E, call `+0x0A94`.
    return { frame, ox: f.x, oy: f.y };
  });
}

export function exportZombiMap(dataDirArg: string): { levels: number; cells: number } | null {
  const dir = resolveDataDir(dataDirArg);
  if (!existsSync(resolve(dir, 'plan')) || !existsSync(resolve(dir, 'i-lieux')) || !existsSync(resolve(dir, 'LIEUX.SEQ'))) return null;
  const map = buildZombiMap(dir);
  writeJson(resolve(assetDir('data', 'zombi', 'amiga'), 'map.json'), map, false);
  const cells = map.levels.reduce((n, l) => n + l.cells.filter(Boolean).length, 0);
  console.log(`zombi/amiga: map.json — ${map.levels.length} floors, ${cells} cells`);
  return { levels: map.levels.length, cells };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportZombiMap(resolve(process.argv[2] ?? 'data/zombi/amiga/data'));
}
