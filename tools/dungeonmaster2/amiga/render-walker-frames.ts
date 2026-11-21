/**
 * Headless DM2 walker frames: renders the viewport for a few poses to
 * `build/cache/dungeonmaster2/walker-frames/*.png` (2x scale) for eyeballing.
 *
 * Usage: `npx tsx tools/dungeonmaster2/amiga/render-walker-frames.ts [map x y facing ...]`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import type { Dm2Bundle, Pose4 } from './model.ts';
import { renderViewport, VIEW_H, VIEW_W, type ViewportAsset, type ViewportFrameInfo } from './viewport.ts';

const assets = resolve('public', 'assets', 'dungeonmaster2', 'amiga', 'data');
const bundle = JSON.parse(readFileSync(resolve(assets, 'walker-maps.json'), 'utf8')) as Dm2Bundle;
const vp = JSON.parse(readFileSync(resolve(assets, 'viewport.json'), 'utf8')) as ViewportAsset;
const out = resolve('build', 'cache', 'dungeonmaster2', 'walker-frames');
mkdirSync(out, { recursive: true });

const args = process.argv.slice(2).map(Number);
const poses: Pose4[] = [];
for (let i = 0; i + 3 < args.length; i += 4) poses.push({ mapIndex: args[i]!, x: args[i + 1]!, y: args[i + 2]!, facing: args[i + 3]! });
if (poses.length === 0) poses.push({ ...bundle.start });

for (const pose of poses) {
  const map = bundle.maps.find((m) => m.index === pose.mapIndex)!;
  const info: ViewportFrameInfo = { wallset: -1, parity: 0, walls: [] };
  const rgba = renderViewport(vp, map, pose, info);
  if (!rgba) { console.log(`map ${map.index}: wallset ${map.mapGraphicsStyle} not exported`); continue; }
  const png = new PNG({ width: VIEW_W * 2, height: VIEW_H * 2 });
  for (let y = 0; y < VIEW_H * 2; y++) for (let x = 0; x < VIEW_W * 2; x++) {
    const s = ((y >> 1) * VIEW_W + (x >> 1)) * 4;
    png.data.set(rgba.subarray(s, s + 4), (y * VIEW_W * 2 + x) * 4);
  }
  const name = `map${pose.mapIndex}-x${pose.x}-y${pose.y}-f${pose.facing}.png`;
  writeFileSync(resolve(out, name), PNG.sync.write(png));
  console.log(`${name}: wallset ${info.wallset} parity ${info.parity} wall cells [${info.walls.join(',')}]`);
}
