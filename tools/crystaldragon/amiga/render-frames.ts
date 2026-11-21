/**
 * Headless check frames of the Crystal Dragon walker -> build/cache/crystaldragon/walker-frames/.
 *   npx tsx tools/crystaldragon/amiga/render-frames.ts [level area x y facing]...
 * Reads the exported walker JSON (run export-walker.ts first). 3x scaled PNGs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { renderView, paletteRGB, VIEW_W, VIEW_H, type CdArea, type CdSlots, type CdFacing } from './view-model.ts';
import type { SlotTable } from './sets.ts';

const W = resolve('public/assets/crystaldragon/amiga/walker');
const J = (p: string) => JSON.parse(readFileSync(resolve(W, p), 'utf8'));

interface LevelJson { level: number; slots: Array<{ set: number; remap: boolean } | null>; areas: Array<Omit<CdArea, 'cells'> & { cells: string; start: { x: number; y: number; facing: number } }> }

export function loadSlots(lv: LevelJson): CdSlots {
  return lv.slots.map((s) => {
    if (!s) return null;
    const j = J(`sets/${(s.set >= 0x100 ? '1' : '') + (s.set & 0xff).toString(16).padStart(2, '0')}.json`) as { table: SlotTable; frames: Array<{ w: number; h: number; stride: number; px: string }> };
    return { remap: s.remap, table: j.table, frames: j.frames.map((f) => ({ ...f, px: new Uint8Array(Buffer.from(f.px, 'base64')) })) };
  });
}
export function decodeArea(a: LevelJson['areas'][number]): CdArea {
  const b = Buffer.from(a.cells, 'base64');
  return { ...a, cells: Array.from(new Uint16Array(b.buffer, b.byteOffset, b.length / 2)) };
}

function main() {
  const levels = J('levels.json') as LevelJson[];
  const pal = paletteRGB((J('palette.json') as { words: number[] }).words);
  const out = resolve('build/cache/crystaldragon/walker-frames');
  mkdirSync(out, { recursive: true });
  const args = process.argv.slice(2).map(Number);
  const shots: number[][] = [];
  for (let i = 0; i + 4 < args.length + 1 && args.length; i += 5) shots.push(args.slice(i, i + 5));
  if (!shots.length) for (const L of [0, 7, 15]) { const a = levels[L]!.areas[0]!; shots.push([L, 0, a.start.x, a.start.y, a.start.facing]); }
  const S = 3;
  for (const [L, ai, x, y, f] of shots) {
    const lv = levels[L!]!;
    const area = decodeArea(lv.areas[ai!]!);
    const px = renderView(area, loadSlots(lv), x!, y!, f as CdFacing);
    const png = new PNG({ width: VIEW_W * S, height: VIEW_H * S });
    for (let yy = 0; yy < VIEW_H * S; yy++) for (let xx = 0; xx < VIEW_W * S; xx++) {
      const c = pal[px[Math.floor(yy / S) * VIEW_W + Math.floor(xx / S)]!]!;
      const o = (yy * VIEW_W * S + xx) * 4;
      png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
    }
    const name = `L${L}_a${ai}_${x}_${y}_f${f}.png`;
    writeFileSync(resolve(out, name), PNG.sync.write(png));
    console.log(resolve(out, name));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
