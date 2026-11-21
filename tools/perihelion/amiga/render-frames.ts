/**
 * Headless check frames of the Perihelion walker -> build/cache/perihelion/walker-frames/.
 *   npx tsx tools/perihelion/amiga/render-frames.ts [dungeon x y gameFacing]...
 * Reads the exported walker data (run export-walker.ts first). 3x scaled PNGs; with no arguments
 * renders every dungeon's start pose plus one turned view.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { renderView, paletteRGB, VIEW_W, VIEW_H, type GameFacing, type PeriMap, type ViewData } from './view-model.ts';
import type { WalkerJson } from './export-walker.ts';

const W = resolve('public/assets/perihelion/amiga/walker');

export function loadWalker(): { json: WalkerJson; map: (i: number) => PeriMap; view: (i: number) => ViewData } {
  const json = JSON.parse(readFileSync(resolve(W, 'walker.json'), 'utf8')) as WalkerJson;
  const d = (i: number) => json.dungeons.find((x) => x.index === i)!;
  return {
    json,
    map: (i) => ({ width: d(i).width, height: d(i).height, cells: [...d(i).cells] }),
    view: (i) => ({
      kind: d(i).kind,
      atlas: { w: d(i).atlas.w, h: d(i).atlas.h, px: new Uint8Array(readFileSync(resolve(W, d(i).atlas.file))) },
      composer: json.composers[d(i).kind],
      leaves: json.leaves,
    }),
  };
}

function main() {
  const { json, map, view } = loadWalker();
  const pal = paletteRGB(json.palette);
  const out = resolve('build/cache/perihelion/walker-frames');
  mkdirSync(out, { recursive: true });
  const args = process.argv.slice(2).map(Number);
  const shots: number[][] = [];
  for (let i = 0; i + 3 < args.length; i += 4) shots.push(args.slice(i, i + 4));
  if (!shots.length) for (const d of json.dungeons) {
    shots.push([d.index, d.start.x, d.start.y, d.start.facing]);
    shots.push([d.index, d.start.x, d.start.y, (d.start.facing + 1) & 3]);
  }
  const S = 3;
  for (const [D, x, y, f] of shots) {
    const px = renderView(map(D!), view(D!), x!, y!, f as GameFacing);
    const png = new PNG({ width: VIEW_W * S, height: VIEW_H * S });
    for (let yy = 0; yy < VIEW_H * S; yy++) for (let xx = 0; xx < VIEW_W * S; xx++) {
      const c = pal[px[Math.floor(yy / S) * VIEW_W + Math.floor(xx / S)]!]!;
      const o = (yy * VIEW_W * S + xx) * 4;
      png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
    }
    const name = `d${D}_${x}_${y}_f${f}.png`;
    writeFileSync(resolve(out, name), PNG.sync.write(png));
    console.log(resolve(out, name));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
