import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseLevel,
  rotateWord,
  faceNibble,
  canPass,
  stepForward,
  blit,
  renderView,
  VIEW_BPR,
  VIEW_H,
  type ViewTables,
  type Bt3Level,
  type DungeonArt,
} from '../../bardstale3/amiga/dungeon.ts';
import { stairsTarget, type LevelIndexEntry } from '../games-bardstale3.ts';
import { buildBardsTale3Dungeon } from '../../bardstale3/amiga/export-dungeon.ts';

/** Synthetic record: W x H, rows stored last-first like the shipped data, empty special list. */
function makeRecord(w: number, h: number, cell: (x: number, y: number) => number[], specials: number[][] = []): Uint8Array {
  const rows = 0x24 + 2 * h;
  const grid = rows;
  const sp = grid + w * h * 5;
  const scripts = sp + 1 + 4 * specials.length;
  const rec = new Uint8Array(scripts + specials.length * 4 + 4);
  rec.fill(0xff, 0, 16);
  rec[0x1e] = w;
  rec[0x1f] = h;
  rec[0x22] = sp & 0xff;
  rec[0x23] = sp >> 8;
  for (let y = 0; y < h; y++) {
    const ro = grid + (h - 1 - y) * w * 5;
    rec[0x24 + 2 * y] = ro & 0xff;
    rec[0x25 + 2 * y] = ro >> 8;
    for (let x = 0; x < w; x++) rec.set(cell(x, y), ro + 5 * x);
  }
  rec[sp] = specials.length;
  specials.forEach((s, i) => {
    const so = scripts + 4 * i;
    rec.set([s[0]!, s[1]!, so & 0xff, so >> 8], sp + 1 + 4 * i);
    rec.set(s.slice(2), so);
  });
  return rec;
}

// move classes as read from bard3 0x20c32 (also asserted against the real executable below)
const MOVE = [0, 0xff, 1, 1, 2, 0xff, 0xff, 1, 3, 0xff, 1, 1, 2, 0xff, 0xff, 1];
const tables = { moveClass: MOVE } as unknown as ViewTables;

describe('bardstale3 wall word + movement (synthetic)', () => {
  // 3x3, centre cell (1,1) has a wall (1) to the north and a door (2) to the east
  const lv = parseLevel(makeRecord(3, 3, (x, y) => (x === 1 && y === 1 ? [0x12, 0x00, 0, 0, 0] : [0, 0, 0, 0, 0])));
  it('byte 0 = E | N<<4, byte 1 = W | S<<4; rows read through the reversed row table', () => {
    expect(faceNibble(lv, 1, 1, 0)).toBe(1);
    expect(faceNibble(lv, 1, 1, 1)).toBe(2);
    expect(faceNibble(lv, 1, 1, 2)).toBe(0);
    expect(faceNibble(lv, 1, 2, 0)).toBe(0); // null control: neighbour row is open
  });
  it('rotation puts the facing face in bits 4-7', () => {
    const w = 0x1234; // S=1 W=2 N=3 E=4
    expect((rotateWord(w, 0) >> 4) & 15).toBe(3);
    expect((rotateWord(w, 1) >> 4) & 15).toBe(4);
    expect((rotateWord(w, 2) >> 4) & 15).toBe(1);
    expect((rotateWord(w, 3) >> 4) & 15).toBe(2);
  });
  it('walls block both commands, doors pass only the kick command, open faces pass both', () => {
    expect(canPass(tables, lv, 1, 1, 0, false)).toBe(false);
    expect(canPass(tables, lv, 1, 1, 0, true)).toBe(false);
    expect(canPass(tables, lv, 1, 1, 1, false)).toBe(false);
    expect(canPass(tables, lv, 1, 1, 1, true)).toBe(true);
    expect(canPass(tables, lv, 1, 1, 2, false)).toBe(true);
  });
  it('forward is +y for north and wraps modulo W/H', () => {
    expect(stepForward(lv, 1, 2, 0)).toEqual([1, 0]);
    expect(stepForward(lv, 0, 1, 3)).toEqual([2, 1]);
    expect(stepForward(lv, 1, 1, 1)).toEqual([2, 1]);
  });
  it('stairs: op 1 goes to links[index+1] with the offset shift; op 0 from level 0 leaves', () => {
    const rec = makeRecord(3, 3, () => [0, 0, 0, 0, 0], [[1, 1, 0x01], [0, 0, 0x00]]);
    rec[0x11] = 0;
    rec.set([7, 8, 0xff], 0x12);
    rec[0x20] = 1; // ox
    const l = parseLevel(rec);
    const idx = new Map<number, LevelIndexEntry>([[8, { id: 8, name: 'b', levelIndex: 1, w: 3, h: 3, ox: 0, oy: 0 }]]);
    expect(stairsTarget(l, 1, 1, idx)).toEqual({ level: 8, x: 2, y: 1 });
    expect(stairsTarget(l, 0, 0, idx)).toBe('exit');
    expect(stairsTarget(l, 2, 2, idx)).toBeNull();
  });
});

describe('bardstale3 scaled blit (synthetic)', () => {
  const src = Uint8Array.from([0x12, 0x34, 0x56, 0x78]); // one row, 8 pixels
  it('scale 64 copies, colour 5 keeps the destination', () => {
    const v = new Uint8Array(VIEW_BPR * VIEW_H).fill(0xaa);
    blit(v, src, 0, 0, 0, 3, 4, 1, 64, false);
    expect(Array.from(v.subarray(0, 4))).toEqual([0x12, 0x34, 0xa6, 0x78]);
  });
  it('mirror reverses pixel order', () => {
    const v = new Uint8Array(VIEW_BPR * VIEW_H);
    blit(v, src, 0, 0, 0, 1, 4, 1, 64, true);
    expect(Array.from(v.subarray(0, 2))).toEqual([0x87, 0x60]); // 8 7 | 6 (5 kept = 0)
  });
  it('scale 32 keeps every other pixel (1,3,5=key,7) (and the wrong scale does not)', () => {
    const v = new Uint8Array(VIEW_BPR * VIEW_H);
    blit(v, src, 0, 0, 0, 1, 4, 1, 32, false);
    expect(Array.from(v.subarray(0, 2))).toEqual([0x13, 0x07]);
    const w = new Uint8Array(VIEW_BPR * VIEW_H);
    blit(w, src, 0, 0, 0, 1, 4, 1, 64, false);
    expect(Array.from(w.subarray(0, 2))).not.toEqual([0x13, 0x07]);
  });
});

const D = 'data/_unexplored_/BardsTale3/data';
describe.skipIf(!existsSync(resolve(D, 'bard3')))('bardstale3 real data', () => {
  const ex = buildBardsTale3Dungeon(D);
  const art: DungeonArt = { tables: ex.tables, entries: ex.entries.map((e) => (e ? { bpr: e.bpr, h: e.h, data: Uint8Array.from(e.data) } : null)) };
  const byId = new Map(ex.levels.map((l) => [l.id, l.level] as [number, Bt3Level]));
  it('tables come out of bard3 as traced', () => {
    expect(ex.tables.moveClass).toEqual(MOVE);
    expect(ex.tables.pieceOfNibble).toEqual([0, 1, 2, 2, 2, 0, 3, 4, 3, 3, 4, 4, 4, 0, 3, 4]);
    expect(ex.tables.palette[15]).toBe(0x0fff);
    expect(ex.entries.slice(0, 10).map((e) => e && `${e.bpr * 2}x${e.h}`)).toEqual(
      ['24x97', '64x55', '24x97', '64x55', '24x97', '64x55', '24x97', '64x55', '112x44', '112x45'],
    );
  });
  it('61 levels; shared faces agree between neighbours on >= 98% of the large maps (orientation check)', () => {
    expect(ex.levels).toHaveLength(61);
    let ok = 0;
    let alt = 0;
    let n = 0;
    for (const lv of byId.values()) {
      if (lv.w * lv.h < 100) continue;
      for (let y = 0; y < lv.h; y++)
        for (let x = 0; x < lv.w; x++) {
          ok += +(faceNibble(lv, x, y, 0) === faceNibble(lv, x, y + 1, 2));
          ok += +(faceNibble(lv, x, y, 1) === faceNibble(lv, x + 1, y, 3));
          alt += +(faceNibble(lv, x, y, 2) === faceNibble(lv, x, y + 1, 0)); // wrong orientation
          n += 2;
        }
    }
    expect(ok / n).toBeGreaterThan(0.98); // measured 0.990 (one-way walls exist)
    expect((alt * 2) / n).toBeLessThan(0.8);
  });
  it('Tower level 1 links to dungeons 3..6 and every link resolves to a level', () => {
    const t = byId.get(3)!;
    expect(t.name).toBe('Tower');
    expect(t.links.slice(0, 4)).toEqual([3, 4, 5, 6]);
    for (const lv of byId.values()) for (const l of lv.links) if (l !== 0xff) expect(byId.has(l)).toBe(true);
  });
  it('renders a non-degenerate view that changes with facing', () => {
    const lv = byId.get(40)!; // Catacombs
    const a = renderView(art, lv, 2, 12, 0);
    const b = renderView(art, lv, 2, 12, 1);
    expect(new Set(a).size).toBeGreaterThan(6);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
  });
});
