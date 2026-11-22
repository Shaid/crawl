/**
 * Walker side of `sweep.py`: renders crawl's W6 view (view-model ->
 * @seer-project/dungeon) for a pose list. Writes the 176x112 viewport crops
 * (one palette index per byte, 19,712 B per pose) back to back to OUT, and
 * one line per pose to OUT.lists with the walker's draw list in the game's
 * DrawMazePiece terms (`src,mode,dst`, dst -1 = direct) or `cel<slot>:<cel>`.
 * Usage (from the repo root): npx tsx tools/wizardry6/oracle/walker-frames.mts POSES.json OUT
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildViewItems } from '../view-model.ts';
import { renderThroughDungeon, loadIndexedBank, loadSlots } from '../render-through-dungeon.ts';

const [posesPath, outPath] = process.argv.slice(2);
const poses: { level: number; x: number; y: number; f: number }[] = JSON.parse(readFileSync(posesPath!, 'utf8'));
const slots = loadSlots();
const bank = loadIndexedBank();
const cache = new Map<number, any>();
function level(id: number) {
  if (!cache.has(id)) {
    const d = JSON.parse(readFileSync(resolve('public/assets/wizardry6/amiga/dungeon', `level${String(id).padStart(2, '0')}.json`), 'utf8'));
    const u = d.units[0];
    cache.set(id, {
      planes: { width: d.cellSpace.width, height: d.cellSpace.height, wallA: u.planes.wallA, wallB: u.planes.wallB, feature: u.planes.feature, orient: u.planes.orient, flagP: u.planes.flagP, flagQ: u.planes.flagQ, region: u.planes.region, level: id },
      origin: d.origin ?? { x: 0, y: 0 },
    });
  }
  return cache.get(id);
}
const out = Buffer.alloc(poses.length * 19712);
const lists: string[] = [];
const parse = (d: any) => {
  const c = /^\.PIC cel (\d+) of resource slot (\d+)/.exec(d.origin ?? '');
  if (c) return `cel${c[2]}:${c[1]}`;
  const m = /composelist\[(\d+)\](?: mirrored onto \[(\d+)\])?/.exec(d.origin ?? '');
  if (!m) return `?${d.origin}`;
  return `${m[1]},${d.blend === 'or' ? 1 : 0},${m[2] ?? -1}`;
};
poses.forEach((p, i) => {
  const L = level(p.level);
  const s = renderThroughDungeon(L.planes, p.x, p.y, p.f, slots, bank, L.origin);
  lists.push(buildViewItems(L.planes, p.x, p.y, p.f, slots, L.origin).map(parse).join(' '));
  for (let r = 0; r < 112; r++) out.set(s.data.subarray((32 + r) * 320 + 72, (32 + r) * 320 + 248), i * 19712 + r * 176);
});
writeFileSync(outPath!, out);
writeFileSync(outPath! + '.lists', lists.join('\n'));
console.log(`wrote ${poses.length} frames`);
