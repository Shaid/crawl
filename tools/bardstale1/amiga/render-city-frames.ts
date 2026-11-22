/**
 * Headless check frames for the BT1 Skara Brae walker: the four facings (N/E/S/W) at a few squares, from the
 * exported city.json / view.json. Usage: npx tsx tools/bardstale1/amiga/render-city-frames.ts [row,col ...]
 * Writes build/cache/bardstale1/walker-frames/city-r<row>c<col>.png.
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { renderCityView, indexedToRGBA, locationText, VIEW_W, VIEW_H, type Bt1City, type CityArt } from './city.ts';

const base = 'public/assets/bardstale1/amiga/data/city';
const out = resolve('build/cache/bardstale1/walker-frames');
mkdirSync(out, { recursive: true });
const cj = JSON.parse(readFileSync(resolve(base, 'city.json'), 'utf-8'));
const vj = JSON.parse(readFileSync(resolve(base, 'view.json'), 'utf-8'));
const city: Bt1City = { path: Uint8Array.from(cj.path), name: Uint8Array.from(cj.nameGrid), streetNames: cj.streetNames };
const pictures: CityArt['pictures'] = {};
for (const [k, v] of Object.entries(vj.pictures as Record<string, { px: number[]; palette: number[] }>))
  pictures[Number(k)] = { px: Uint8Array.from(v.px), palette: v.palette };
const art: CityArt = { palette: vj.palette, data: Uint8Array.from(vj.bigCity), pictures };
const S = 3;
const squares = (process.argv.slice(2).length ? process.argv.slice(2) : ['14,25', '20,15', '24,27']).map((s) => s.split(',').map(Number));
for (const [row, col] of squares) {
  const W = VIEW_W * 4 * S + 3 * 4;
  const H = VIEW_H * S;
  const img = new Uint8Array(W * H * 4);
  for (let f = 0; f < 4; f++) {
    const fr = renderCityView(art, city, row!, col!, f);
    const rgba = indexedToRGBA(fr.px, fr.palette);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < VIEW_W * S; xx++) {
        const si = (((yy / S) | 0) * VIEW_W + ((xx / S) | 0)) * 4;
        const di = (yy * W + f * (VIEW_W * S + 4) + xx) * 4;
        for (let k = 0; k < 4; k++) img[di + k] = rgba[si + k]!;
      }
    console.log(`(${row},${col}) f${f}: ${locationText(city, row!, col!, f)}${fr.picture ? ` [pics ${fr.picture}]` : ''}`);
  }
  await writePNG(resolve(out, `city-r${row}c${col}.png`), img, W, H);
}
