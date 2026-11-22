/** Headless frame dump: build/cache/dungeonhack/walker-frames/*.png (a look-at-it check, not a test). */
import { readFileSync, mkdirSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { DhEngine, VIEW_W, VIEW_H, type DhPack } from './engine.ts';

const d = 'public/assets/dungeonhack/dosvga/data/walker/';
const j = (f: string) => JSON.parse(readFileSync(d + f, 'utf8'));
export function loadPack(): DhPack {
  return {
    classes: j('aesop-classes.json').classes, palettes: j('palettes.json'), bitmapIndex: j('bitmaps-index.json'),
    bitmaps: new Uint8Array(readFileSync(d + 'bitmaps.bin')), natives: j('natives.json'), dungeons: j('dungeons.json').dungeons,
  };
}

const out = 'build/cache/dungeonhack/walker-frames/';
export async function shot(e: DhEngine, tag: string, x: number, y: number, f: number): Promise<void> {
  const ix = e.frame(x, y, f);
  const rgba = new Uint8Array(VIEW_W * VIEW_H * 4);
  for (let i = 0; i < ix.length; i++) { const c = e.rgb(ix[i]!); rgba.set([c[0]!, c[1]!, c[2]!, 255], i * 4); }
  await writePNG(`${out}${tag}_${x}_${y}_f${f}.png`, rgba, VIEW_W, VIEW_H);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const e = new DhEngine(loadPack());
  e.trace = null;
  e.loadLevel(0, 0);
  console.log('objects', e.objectCount(), 'stubbed', [...e.stubbed.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('party', e.party());
}
if (process.argv[1]?.endsWith('render-frames.ts')) main();
