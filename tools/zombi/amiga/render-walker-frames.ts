/**
 * Headless check of the Zombi walker view: drives `ZombiView` with a software
 * canvas (pngjs-backed) and writes PNG frames to build/cache/zombi/walker-frames/.
 * Also prints the BFS-reachable cell count from the start under the game's
 * own movement rule.
 *
 * Usage: npx tsx tools/zombi/amiga/render-walker-frames.ts [dataDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ZombiView, startPose } from '../../walker/games-zombi.ts';
import { buildZombiMap } from './export-map.ts';
import { ARROWS, cellAt, moveArrow, moveVertical, type Pos } from './map.ts';

const dir = resolve(process.argv[2] ?? 'data/zombi/amiga/data');
const assets = resolve('public/assets/zombi/amiga');
const out = resolve('build/cache/zombi/walker-frames');
mkdirSync(out, { recursive: true });

interface Img { w: number; h: number; data: Uint8Array }
const load = (p: string): Img => { const png = PNG.sync.read(readFileSync(p)); return { w: png.width, h: png.height, data: png.data }; };
const screen = load(resolve(assets, 'screens/screen.png'));
const lieux = load(resolve(assets, 'sprites/lieux.png'));
const atlas = JSON.parse(readFileSync(resolve(assets, 'sprites/lieux.json'), 'utf8')).frames;

function makeCtx() {
  const canvas = { width: 320, height: 200 };
  let buf = new Uint8Array(320 * 200 * 4);
  const ctx = {
    canvas,
    set fillStyle(_v: string) {},
    set imageSmoothingEnabled(_v: boolean) {},
    fillRect() { buf = new Uint8Array(320 * 200 * 4); for (let i = 3; i < buf.length; i += 4) buf[i] = 255; },
    drawImage(img: Img, ...a: number[]) {
      const [sx, sy, sw, sh, dx, dy] = a.length === 2 ? [0, 0, img.w, img.h, a[0], a[1]] : a;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const s = ((sy + y) * img.w + sx + x) * 4;
        const d = ((dy + y) * 320 + dx + x) * 4;
        buf[d] = img.data[s]; buf[d + 1] = img.data[s + 1]; buf[d + 2] = img.data[s + 2]; buf[d + 3] = 255;
      }
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, get: () => buf };
}

const map = buildZombiMap(resolve(dir));
const view = new ZombiView(map, atlas, { screen, lieux } as unknown as ConstructorParameters<typeof ZombiView>[2], startPose(map));

function shot(name: string): void {
  const c = makeCtx();
  view.renderCanvas(c.ctx);
  const png = new PNG({ width: 320, height: 200 });
  png.data = Buffer.from(c.get());
  writeFileSync(resolve(out, `${name}.png`), PNG.sync.write(png));
  console.log(`${name}: floor ${view.pose.level} (${view.pose.x},${view.pose.y}) location ${view.locationId}`);
}

// BFS under the game's rule.
const key = (p: Pos) => `${p.level},${p.x},${p.y}`;
const start = startPose(map);
const seen = new Map<string, Pos>([[key(start), start]]);
const q: Pos[] = [start];
while (q.length) {
  const p = q.shift()!;
  const nexts: Pos[] = [];
  for (const a of ARROWS) { const o = moveArrow(map, p, a); if (o.ok) nexts.push(o.to); }
  for (const d of ['up', 'down'] as const) { const o = moveVertical(map, p, d); if (o.ok) nexts.push(o.to); }
  for (const n of nexts) if (!seen.has(key(n)) && cellAt(map, n)) { seen.set(key(n), n); q.push(n); }
}
const total = map.levels.reduce((n, l) => n + l.cells.filter(Boolean).length, 0);
console.log(`reachable from start under move(): ${seen.size} / ${total} cells`);

shot('00-start-helicopter');
const want = [41, 25, 1, 70];
for (const id of want) {
  const hit = [...seen.values()].find((p) => cellAt(map, p)!.id === id);
  if (!hit) { console.log(`location ${id} not reachable`); continue; }
  view.setPose({ ...hit, facing: 0 });
  shot(`loc-${String(id).padStart(2, '0')}`);
}

for (const l of map.levels) l.cells.forEach((c, i) => {
  if (c && !seen.has(key({ level: l.id, x: i % l.width, y: Math.floor(i / l.width) }))) console.log(`unreachable: location ${c.id} floor ${l.id} (${i % l.width},${Math.floor(i / l.width)})`);
});
