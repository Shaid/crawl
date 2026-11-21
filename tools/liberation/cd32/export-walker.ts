/**
 * Liberation: Captive II (CD32): walker data. The city is generated, not
 * stored, so this runs the game's own PlotGen + CityGen (and captiveII's wall-
 * set / CMAP pickers) under the musashi oracle in `emu/` (built by
 * `emu/build.sh` into build/cache/liberation/gen), then emits to
 * public/assets/liberation/cd32/walker/:
 *   engine.json      city view-composer tables + view backdrop read out of captiveII (engine-tables.ts)
 *   zones.json       the exported zones: world, zone, VGM wall set, CityGen start pose
 *   zone-w<W>z<Z>.json   3 x 4096-byte cell planes (base64) + the 64-colour view palette
 *   walls/<NN>.json  bank 0 (static view) of WallNN.VGM: 42 AmSp sprites (4 planes + mask)
 *
 *   npx tsx tools/liberation/cd32/export-walker.ts
 * Spec: docs/liberation/cd32/data-structure.md.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { splitCaptive, readEngineTables, readBackdrop, viewPalette } from './engine-tables.ts';
import { parseVgm } from './view-model.ts';
import { runGen } from './verify-view.ts';

/** Exported zones: world 0 (a new game's world word; +0x22756 path leaves it 0), zones 0..8 (CityGen's 9-entry zone table; 9+ do not terminate). Zone 8 is where a new game starts (+0x227A0). */
export const EXPORT_ZONES: Array<{ world: number; zone: number }> = Array.from({ length: 9 }, (_, z) => ({ world: 0, zone: z }));

const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64');

export function ensureOracle(): void {
  if (existsSync(resolve('build/cache/liberation/gen'))) return;
  execFileSync('bash', [resolve('tools/liberation/cd32/emu/build.sh')], { stdio: 'inherit' });
}

export function exportWalker(): { zones: number; walls: number } {
  const dataDir = resolve('data/liberation/cd32/data');
  ensureOracle();
  const img = splitCaptive(new Uint8Array(readFileSync(resolve(dataDir, 'captiveII'))));
  const t = readEngineTables(img.code);
  const out = resolve(assetRoot('liberation', 'cd32'), 'walker');
  mkdirSync(resolve(out, 'walls'), { recursive: true });
  writeJson(resolve(out, 'engine.json'), { ...t, textures: t.textures.map(b64), backdrop: b64(readBackdrop(img)) }, false);
  const walls = new Set<number>();
  const zones = EXPORT_ZONES.map(({ world, zone }, id) => {
    const g = runGen(world, zone);
    walls.add(g.wall);
    writeJson(resolve(out, `zone-w${world}z${zone}.json`), { planes: b64(g.zone.planes), palette: viewPalette(img, g.cmap) }, false);
    return { id, world, zone, wall: g.wall, cmap: g.cmap, start: g.zone.start, label: `World ${world}, zone ${zone}${world === 0 && zone === 8 ? ' (new-game start)' : ''} — Wall${String(g.wall).padStart(2, '0')}` };
  });
  writeJson(resolve(out, 'zones.json'), zones);
  for (const w of walls) {
    const name = `Wall${String(w).padStart(2, '0')}.VGM`;
    const bank0 = parseVgm(new Uint8Array(readFileSync(resolve(dataDir, name))))[0]!;
    writeJson(resolve(out, 'walls', `${String(w).padStart(2, '0')}.json`), bank0.map((s) => ({
      wb: s.wb, h: s.h,
      planes: b64(Uint8Array.from(s.planes.flatMap((p) => Array.from(p)))),
      mask: b64(s.mask),
    })), false);
  }
  return { zones: zones.length, walls: walls.size };
}

if (process.argv[1]?.endsWith('export-walker.ts')) {
  const r = exportWalker();
  console.log(`liberation/cd32 walker: ${r.zones} zones, ${r.walls} wall sets`);
}
