/**
 * Headless check frames for the BT2 city walker: the four facings (N/E/S/W) at each city's guild-exit square
 * (or the squares given as city:row,col). Usage: npx tsx tools/bardstale2/amiga/render-city-frames.ts [c:r,k ...]
 * Writes build/cache/bardstale2/walker-frames/city<c>-r<row>c<col>.png.
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { renderCityView, bigCityLayout, locationText, VIEW_W, VIEW_H, type Bt2City, type CityArt } from './city.ts';
import { indexedToRGBA } from '../../bardstale1/amiga/city.ts';

const base = 'public/assets/bardstale2/amiga/data/city';
const out = resolve('build/cache/bardstale2/walker-frames');
mkdirSync(out, { recursive: true });
const idx = JSON.parse(readFileSync(resolve(base, 'cities.json'), 'utf-8')).cities as Array<{ index: number; start: { row: number; col: number } }>;
const vj = JSON.parse(readFileSync(resolve(base, 'view.json'), 'utf-8'));
const pictures: CityArt['pictures'] = {};
for (const [k, v] of Object.entries(vj.pictures as Record<string, { px: number[]; palette: number[] }>))
  pictures[Number(k)] = { px: Uint8Array.from(v.px), palette: v.palette };
const art: CityArt = { palette: vj.palette, data: Uint8Array.from(vj.bigCity), pictures };
const lay = bigCityLayout();
const S = 3;
const jobs = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => s.split(/[:,]/).map(Number) as [number, number, number])
  : idx.map((c) => [c.index, c.start.row, c.start.col] as [number, number, number]);
for (const [ci, row, col] of jobs) {
  const cj = JSON.parse(readFileSync(resolve(base, `city${ci}.json`), 'utf-8'));
  const city: Bt2City = { index: ci, name: cj.name, grid: Uint8Array.from(cj.grid) };
  const W = VIEW_W * 4 * S + 12;
  const H = VIEW_H * S;
  const img = new Uint8Array(W * H * 4);
  for (let f = 0; f < 4; f++) {
    const fr = renderCityView(art, lay, city, row, col, f);
    const rgba = indexedToRGBA(fr.px, fr.palette);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < VIEW_W * S; xx++) {
        const si = (((yy / S) | 0) * VIEW_W + ((xx / S) | 0)) * 4;
        const di = (yy * W + f * (VIEW_W * S + 4) + xx) * 4;
        for (let k = 0; k < 4; k++) img[di + k] = rgba[si + k]!;
      }
    console.log(`${city.name} (${row},${col}) f${f}: ${locationText(city, row, col, f)}${fr.picture ? ` [pics ${fr.picture}]` : ''}`);
  }
  await writePNG(resolve(out, `city${ci}-r${row}c${col}.png`), img, W, H);
}
