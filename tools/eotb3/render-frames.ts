/** Headless frame dump: build/cache/eotb3/walker-frames/*.png (a look-at-it check, not a test). */
import { readFileSync, mkdirSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { Eotb3Engine, VIEW_W, VIEW_H, type WalkerPack } from './engine.ts';

const d = 'public/assets/eotb3/dosvga/data/walker/';
const j = (f: string) => JSON.parse(readFileSync(d + f, 'utf8'));
const pack: WalkerPack = { classes: j('aesop-classes.json').classes, levels: j('levels.json').levels, palettes: j('palettes.json'),
  vfxIndex: j('vfx-index.json'), vfx: new Uint8Array(readFileSync(d + 'vfx.bin')) };
const out = 'build/cache/eotb3/walker-frames/';
mkdirSync(out, { recursive: true });
const e = new Eotb3Engine(pack);

async function shot(tag: string, lv: number, x: number, y: number, f: number) {
  e.loadLevel(lv);
  const dl = e.drawList(x, y, f);
  const ix = e.composite(dl);
  const rgba = new Uint8Array(VIEW_W * VIEW_H * 4);
  for (let i = 0; i < ix.length; i++) { const c = e.rgb(ix[i]!); rgba.set([c[0], c[1], c[2], 255], i * 4); }
  await writePNG(`${out}${tag}_l${lv}_${x}_${y}_f${f}.png`, rgba, VIEW_W, VIEW_H);
  console.log(tag, lv, x, y, f, `${dl.length} draws`);
}

async function main() {
  await shot('quickstart', 3, 7, 24, 1);
  // stand two cells back from the first door/feature on a few levels, facing it
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [lv, re] of [[1, /door/], [6, /door|gate/], [11, /door|altar|statue/], [5, /gate|plaque/]] as Array<[number, RegExp]>) {
    e.loadLevel(lv);
    let done = false;
    for (let y = 0; y < 32 && !done; y++) for (let x = 0; x < 32 && !done; x++) {
      if (!e.cellObjects(x, y).some((id) => re.test(e.classNameOf(id)))) continue;
      for (let f = 0; f < 4 && !done; f++) {
        const sx = x - 2 * D[f]![0]!, sy = y - 2 * D[f]![1]!;
        if (e.isOpen(sx, sy) && e.isOpen(x - D[f]![0]!, y - D[f]![1]!)) {
          await shot(e.cellObjects(x, y).map((i) => e.classNameOf(i)).join('+').replace(/\W+/g, '_'), lv, sx, sy, f);
          done = true;
        }
      }
    }
  }
}
main();
