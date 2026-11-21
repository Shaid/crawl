/**
 * Headless walker frames for eyeballing: build/cache/evilsdoom/walker-frames/*.png (2x scale).
 *   npx tsx tools/evilsdoom/amigaaga/render-walker-frames.ts [id:x:y:facing ...]
 * Default poses: each dungeon's saved start, plus a few steps/turns from Belcoon's start.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { mirrorArt, mirrorPhase, paletteRGB, renderView, VIEW_H, VIEW_W, type Facing, type Slot } from './view-model.ts';

const ROOT = resolve('public/assets/evilsdoom/amigaaga/walker');
const OUT = resolve('build/cache/evilsdoom/walker-frames');

interface Lv { id: number; level: number; grid: string; start: { x: number; y: number; facing: number } }
interface Dn { tag: string; wal: string; palette: number[]; slots: Slot[]; levels: Lv[] }

export function renderFrames(poses?: Array<[number, number, number, number]>): string[] {
  const dungeons = JSON.parse(readFileSync(resolve(ROOT, 'dungeons.json'), 'utf8')) as Dn[];
  mkdirSync(OUT, { recursive: true });
  const list = poses ?? dungeons.map((d) => { const l = d.levels.find((v) => (v.start as { source?: string }).source === 'save') ?? d.levels[0]; return [l.id, l.start.x, l.start.y, l.start.facing] as [number, number, number, number]; });
  const written: string[] = [];
  for (const [id, x, y, f] of list) {
    const dn = dungeons.find((d) => d.levels.some((l) => l.id === id))!;
    const lv = dn.levels.find((l) => l.id === id)!;
    const normal = new Uint8Array(Buffer.from(JSON.parse(readFileSync(resolve(ROOT, `art/${dn.wal}.json`), 'utf8')).data, 'base64'));
    const art = { normal, mirror: mirrorArt(normal, dn.slots) };
    const grid = new Uint8Array(Buffer.from(lv.grid, 'base64'));
    const px = renderView({ grid }, dn.slots, art, x, y, f as Facing, mirrorPhase(x, y, f, lv.start));
    const pal = paletteRGB(dn.palette);
    const png = new PNG({ width: VIEW_W * 2, height: VIEW_H * 2 });
    for (let yy = 0; yy < VIEW_H * 2; yy++) for (let xx = 0; xx < VIEW_W * 2; xx++) {
      const [r, g, b] = pal[px[(yy >> 1) * VIEW_W + (xx >> 1)]];
      const o = (yy * VIEW_W * 2 + xx) * 4;
      png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b; png.data[o + 3] = 255;
    }
    const file = resolve(OUT, `${dn.tag}-L${lv.level}-${x}-${y}-f${f}.png`);
    writeFileSync(file, PNG.sync.write(png));
    written.push(file);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).map((a) => a.split(':').map(Number) as [number, number, number, number]);
  for (const f of renderFrames(args.length ? args : undefined)) console.log(f);
}
