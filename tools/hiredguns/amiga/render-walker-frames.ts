/**
 * Headless check of the Hired Guns walker view: renders frames from the exported walker
 * assets into build/cache/hiredguns/walker-frames/ (PNG, 3x nearest-neighbour).
 *
 *   npx tsx tools/hiredguns/amiga/render-walker-frames.ts [map=1] [x y z facing]...
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { decodeBankAsset, decodeMapAsset, type HgMapAsset } from './assets.ts';
import { cellIndex } from './map.ts';
import { frameToRGBA, renderView, VIEW_H, VIEW_W, type HgViewTables } from './view.ts';

const root = resolve('public/assets/hiredguns/amiga/walker');
const out = resolve('build/cache/hiredguns/walker-frames');
mkdirSync(out, { recursive: true });
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;

const tables = json<HgViewTables>('tables.json');
const misc = decodeBankAsset(json('misc.json'));

export async function shot(mapNum: number, x: number, y: number, z: number, facing: number, scale = 3): Promise<string> {
  const m = decodeMapAsset(json<HgMapAsset>(`maps/${String(mapNum).padStart(2, '0')}.json`));
  const style = decodeBankAsset(json(`style${m.style}.json`));
  const f = renderView({ cells: m.cells, sky4: m.sky4, style, misc, tables }, cellIndex(x, y, z), facing);
  const rgba = frameToRGBA(f, tables.palette);
  const W = VIEW_W * scale, H = VIEW_H * scale;
  const big = new Uint8Array(W * H * 4);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const s = (((yy / scale) | 0) * VIEW_W + ((xx / scale) | 0)) * 4;
    big.set(rgba.subarray(s, s + 4), (yy * W + xx) * 4);
  }
  const name = `map${String(mapNum).padStart(2, '0')}-x${x}y${y}z${z}-f${'NESW'[facing & 3]}.png`;
  await writePNG(resolve(out, name), big, W, H);
  return resolve(out, name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2).map(Number);
  const mapNum = a[0] || 1;
  const m = decodeMapAsset(json<HgMapAsset>(`maps/${String(mapNum).padStart(2, '0')}.json`));
  const poses = a.length >= 5 ? [[a[1], a[2], a[3], a[4]]] : [0, 1, 2, 3].map((f) => [m.players[0]!.x, m.players[0]!.y, m.players[0]!.z, f]);
  for (const [x, y, z, f] of poses) console.log(await shot(mapNum, x!, y!, z!, f!));
}
