/**
 * Headless check frames of the Liberation city walker -> build/cache/liberation/walker-frames/.
 *   npx tsx tools/liberation/cd32/render-frames.ts [zoneId x y facing]...
 * Reads the exported walker JSON (run export-walker.ts first). 3x scaled PNGs.
 * With no arguments: each exported zone's CityGen start pose, plus a few steps.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { fillWindow, composeView, chunky, VIEW_W, VIEW_H } from './view-model.ts';
import { decodeEngine, decodeWall, decodeZone, type ZoneMeta } from './walker-data.ts';

const W = resolve('public/assets/liberation/cd32/walker');
const J = (p: string) => JSON.parse(readFileSync(resolve(W, p), 'utf8'));

function main() {
  const { tables, backdrop } = decodeEngine(J('engine.json'));
  const zones = J('zones.json') as ZoneMeta[];
  const args = process.argv.slice(2).map(Number);
  const poses: Array<[number, number, number, number]> = [];
  if (args.length >= 4) for (let i = 0; i + 3 < args.length; i += 4) poses.push([args[i]!, args[i + 1]!, args[i + 2]!, args[i + 3]!]);
  else for (const z of zones) poses.push([z.id, z.start.x, z.start.y, z.start.facing]);
  const out = resolve('build/cache/liberation/walker-frames');
  mkdirSync(out, { recursive: true });
  const S = 3;
  for (const [zid, x, y, f] of poses) {
    const meta = zones[zid]!;
    const zj = J(`zone-w${meta.world}z${meta.zone}.json`);
    const zone = decodeZone(meta, zj);
    const bank0 = decodeWall(J(`walls/${String(meta.wall).padStart(2, '0')}.json`));
    const px = chunky(composeView(tables, bank0, fillWindow(tables, zone, x, y, 1, f), 0, backdrop));
    const png = new PNG({ width: VIEW_W * S, height: VIEW_H * S });
    for (let yy = 0; yy < VIEW_H * S; yy++)
      for (let xx = 0; xx < VIEW_W * S; xx++) {
        const c = zj.palette[px[Math.floor(yy / S) * VIEW_W + Math.floor(xx / S)]!] as [number, number, number];
        const o = (yy * VIEW_W * S + xx) * 4;
        png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
      }
    const file = resolve(out, `z${zid}-${x}-${y}-${f}.png`);
    writeFileSync(file, PNG.sync.write(png));
    console.log(file);
  }
}
main();
