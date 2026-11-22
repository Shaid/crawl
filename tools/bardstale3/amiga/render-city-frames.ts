/**
 * Headless check frames for the BT3 city walker: four facings per city at its start square, day palette, plus one
 * night strip. Usage: npx tsx tools/bardstale3/amiga/render-city-frames.ts [dataDir] [outDir]
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { buildBardsTale3Cities } from './export-city.ts';
import { readBard3 } from './export-dungeon.ts';
import { readViewTables } from './export-dungeon.ts';
import { renderCityView } from './city.ts';
import { indexedToRGBA, VIEW_W, VIEW_H } from './dungeon.ts';
import { readFileSync } from 'node:fs';

const dataDir = resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale3/data');
const out = resolve(process.argv[3] ?? 'build/cache/bardstale3/walker-frames');
mkdirSync(out, { recursive: true });
const ex = buildBardsTale3Cities(dataDir);
const view61 = readViewTables(readBard3(new Uint8Array(readFileSync(resolve(dataDir, 'bard3')))));
const S = 3;
async function strip(name: string, m: number, x: number, y: number, night: boolean) {
  const c = ex.cities[m]!;
  const entries = ex.grp[ex.grpOfSet[c.artSet]!]!.map((e) => (e ? { bpr: e.bpr, h: e.h, data: Uint8Array.from(e.data) } : null));
  const W = VIEW_W * 4 * S, H = VIEW_H * S;
  const img = new Uint8Array(W * H * 4);
  for (let f = 0; f < 4; f++) {
    const rgba = indexedToRGBA(renderCityView(ex.tables, view61, entries, c, x, y, f), night ? ex.tables.nightPalette : ex.tables.palette);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < VIEW_W * S; xx++) {
        const si = (((yy / S) | 0) * VIEW_W + ((xx / S) | 0)) * 4, di = (yy * W + f * VIEW_W * S + xx) * 4;
        for (let k = 0; k < 4; k++) img[di + k] = rgba[si + k]!;
      }
  }
  await writePNG(resolve(out, name), img, W, H);
  console.log(name, c.name, `x=${x} y=${y}`, 'N/E/S/W');
}
const pick = (process.argv[4] ?? '0,1,3,5').split(',').map(Number);
for (const m of pick) {
  const s = ex.starts[m]!;
  await strip(`city${m}.png`, m, s.x, s.y, false);
}
const s1 = ex.starts[1]!;
await strip('city1-night.png', 1, s1.x, s1.y, true);
