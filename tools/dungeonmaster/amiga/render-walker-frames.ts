/**
 * Headless viewport frames for eyeballing the compositor:
 *   npx tsx tools/dungeonmaster/amiga/render-walker-frames.ts dm|csb '[[map,x,y,facing,doorState?],...]'
 * -> build/cache/<game>/walker-frames/m<map>_<x>_<y>_<facing>[_d<state>].png (needs the exported walker assets).
 * `doorState` (0 open .. 4 closed) overrides the door directly ahead of the pose.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { loadGfx, DmViewport, paletteRgb, VIEWPORT_W, VIEWPORT_H, type WalkerGfxJson } from './viewport.ts';
import { DmLevelView, DoorStates, type DmMapData } from './model.ts';

const key = process.argv[2] === 'csb' ? 'chaosstrikesback' : 'dungeonmaster';
const base = resolve('public/assets', key, 'amiga/data');
const gj = JSON.parse(readFileSync(resolve(base, 'walker-gfx.json'), 'utf8')) as WalkerGfxJson;
const mj = JSON.parse(readFileSync(resolve(base, 'walker-maps.json'), 'utf8')) as { maps: DmMapData[] };
const vp = new DmViewport(loadGfx(gj));
const pal = paletteRgb(gj.palettes[0]!);
const out = resolve('build/cache', key, 'walker-frames');
mkdirSync(out, { recursive: true });
const poses = JSON.parse(process.argv[3] ?? '[]') as number[][];
for (const [mi, x, y, f, ds] of poses) {
  const m = mj.maps.find((q) => q.index === mi)!;
  const doors = new DoorStates();
  if (ds !== undefined) {
    const dx = [0, 1, 0, -1][f!]!;
    const dy = [-1, 0, 1, 0][f!]!;
    doors.set(m, (y! + dy) * m.width + x! + dx, ds);
  }
  const b = vp.render(new DmLevelView(m, mj.maps, doors), x!, y!, f!);
  const rgba = new Uint8Array(VIEWPORT_W * VIEWPORT_H * 4);
  for (let i = 0; i < b.length; i++) {
    const c = pal[b[i]!]!;
    rgba.set([c.r, c.g, c.b, 255], i * 4);
  }
  await writePNG(resolve(out, `m${mi}_${x}_${y}_${f}${ds !== undefined ? `_d${ds}` : ''}.png`), rgba, VIEWPORT_W, VIEWPORT_H);
}
console.log(`wrote ${poses.length} frame(s) to ${out}`);
