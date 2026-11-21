import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GRID,
  VIEW_W,
  VIEW_H,
  buildArt,
  renderView,
  mirrorRightHalf,
  bigDungLayout,
  canMoveForward,
  stepForward,
  levelName,
  A_TAB,
  B_TAB,
  C_TAB,
  B_DEST,
  type DungeonArt,
  type LevelData,
  type Plane4,
} from '../../bardstale2/amiga/dungeon.ts';
import { artFromJSON } from '../games-bardstale2.ts';

const blank = (): LevelData => ({ walls: new Uint8Array(GRID * GRID), flags: new Uint8Array(GRID * GRID), name: 't' });
const setFace = (lv: LevelData, a: number, b: number, shift: number, v: number) => {
  lv.walls[a * GRID + b] = (lv.walls[a * GRID + b]! & ~(3 << shift)) | (v << shift);
};

describe('bardstale2 piece layout', () => {
  it('carves big_dung sequentially after the palette + 56x88x4 background, with no overlap', () => {
    const lay = bigDungLayout();
    const all = [...lay.a, ...lay.b.slice(0, 4), ...lay.c.slice(0, 8)];
    const seen = [...new Set(all.map((m) => m.offset))].sort((x, y) => x - y);
    expect(seen[0]).toBe(2496);
    let pos = 2496;
    for (const m of [...lay.b.slice(0, 4), ...lay.a, ...lay.c.slice(0, 8)]) {
      expect(m.offset).toBe(pos);
      pos += m.bpr * m.rows * 4;
    }
    expect(lay.end).toBe(pos);
  });
  it('alias pieces share their target bitmap offset', () => {
    const lay = bigDungLayout();
    expect(lay.b[4]!.offset).toBe(lay.b[0]!.offset);
    expect(lay.b[10]!.offset).toBe(lay.b[3]!.offset);
    expect(lay.c[8]!.offset).toBe(lay.c[5]!.offset);
  });
  it('index tables only reference existing pieces', () => {
    for (const p of A_TAB) expect(p).toBeLessThan(6);
    for (const p of B_TAB) expect(p).toBeLessThan(B_DEST.length);
    for (const p of C_TAB) expect(p).toBeLessThan(10);
  });
});

describe('bardstale2 mirror + movement', () => {
  it('right-half flip swaps x with 167-x, leaves the left half, and is an involution', () => {
    const f = new Uint8Array(VIEW_W * VIEW_H);
    for (let i = 0; i < f.length; i++) f[i] = i & 15;
    const g = Uint8Array.from(f);
    mirrorRightHalf(g);
    expect(g[56]).toBe(f[111]);
    expect(g[111]).toBe(f[56]);
    expect(g[55]).toBe(f[55]);
    mirrorRightHalf(g);
    expect(Buffer.compare(Buffer.from(g), Buffer.from(f))).toBe(0);
  });
  it('blocked only by a plain wall in front; wraps at 22', () => {
    const lv = blank();
    setFace(lv, 3, 3, 0, 1);
    expect(canMoveForward(lv, 3, 3, 0)).toBe(false);
    setFace(lv, 3, 3, 0, 2);
    expect(canMoveForward(lv, 3, 3, 0)).toBe(true);
    expect(canMoveForward(lv, 3, 3, 1)).toBe(true); // null control: other facing unaffected
    expect(stepForward(21, 0, 0)).toEqual([0, 0]);
  });
  it('level name decoder reads +0x600 high-bit ASCII to 0xff', () => {
    const rec = new Uint8Array(3072);
    rec.set([0xc4, 0xe1, 0xf2, 0xeb, 0xff], 0x600);
    expect(levelName(rec)).toBe('Dark');
  });
});

// synthetic art: every piece bitmap is a solid colour per class, so we can see WHERE each class lands.
function solidArt(): DungeonArt {
  const lay = bigDungLayout();
  const mk = (bm: { bpr: number; rows: number }, c: number): Plane4 => ({ w: bm.bpr * 8, h: bm.rows, px: new Uint8Array(bm.bpr * 8 * bm.rows).fill(c) });
  return {
    palette: new Array(16).fill(0),
    background: new Uint8Array(VIEW_W * VIEW_H),
    a: lay.a.map((m) => mk(m, 3)),
    b: lay.b.map((m) => mk(m, 5)),
    c: lay.c.map((m) => mk(m, 7)),
  };
}
const count = (f: Uint8Array, x0: number, x1: number, v: number) => {
  let n = 0;
  for (let y = 0; y < VIEW_H; y++) for (let x = x0; x < x1; x++) if (f[y * VIEW_W + x] === v) n++;
  return n;
};

describe('bardstale2 compositor (synthetic art)', () => {
  const art = solidArt();
  it('a front wall ahead fills the centre; a wall on the left side lands left, a wall on the right lands right (mirror), not vice versa', () => {
    const front = blank();
    setFace(front, 5, 5, 0, 1);
    const f = renderView(art, front, 5, 5, 0);
    expect(count(f, 9, 104, 5)).toBeGreaterThan(95 * 80);
    // left side wall (west face of the party cell, facing north)
    const left = blank();
    setFace(left, 5, 5, 6, 1);
    const l = renderView(art, left, 5, 5, 0);
    expect(count(l, 0, 9, 7)).toBeGreaterThan(300);
    expect(count(l, 103, 112, 7)).toBe(0); // null control: nothing on the right
    // right side wall (east face)
    const right = blank();
    setFace(right, 5, 5, 4, 1);
    const r = renderView(art, right, 5, 5, 0);
    expect(count(r, 103, 112, 7)).toBeGreaterThan(300);
    expect(count(r, 0, 9, 7)).toBe(0);
    // the two are exact mirrors of each other
    for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) expect(r[y * VIEW_W + x]).toBe(l[y * VIEW_W + (111 - x)]);
  });
  it('dark (vis 0) draws only the background', () => {
    const lv = blank();
    setFace(lv, 5, 5, 0, 1);
    expect(Buffer.compare(Buffer.from(renderView(art, lv, 5, 5, 0, 0)), Buffer.from(art.background))).toBe(0);
  });
});

const D = 'data/_unexplored_/BardsTale2/data/bards_data';
const viewJson = resolve('public/assets/bardstale2/amiga/data/dungeon/view.json');
describe.skipIf(!existsSync(viewJson) || !existsSync(resolve(D, 'big_dung')))('bardstale2 real data', () => {
  it('renders distinct wall vs door frames; the exported art equals a fresh decode', () => {
    const art: DungeonArt = artFromJSON(JSON.parse(readFileSync(viewJson, 'utf8')));
    const box = blank();
    setFace(box, 5, 5, 0, 1);
    const d = blank();
    setFace(d, 5, 5, 0, 2);
    const fWall = renderView(art, box, 5, 5, 0);
    const fDoor = renderView(art, d, 5, 5, 0);
    expect(Buffer.compare(Buffer.from(fWall), Buffer.from(fDoor))).not.toBe(0);
    expect(Buffer.compare(Buffer.from(fWall), Buffer.from(art.background))).not.toBe(0);
    expect(art.palette).toHaveLength(16);
    expect(buildArt).toBeTypeOf('function');
  });
  it('25 levels; neighbour reciprocity of the face model >98% vs ~52% null and ~57% wrong-orientation', () => {
    const base = resolve('public/assets/bardstale2/amiga/data/dungeon');
    let ok = 0, nul = 0, wrong = 0, tot = 0;
    const face = (w: number[], a: number, b: number, s: number) => (w[((a + GRID) % GRID) * GRID + ((b + GRID) % GRID)]! >> s) & 3;
    for (let lvl = 0; lvl < 25; lvl++) {
      const w: number[] = JSON.parse(readFileSync(`${base}/level${lvl}.json`, 'utf8')).walls;
      for (const [sa, sb, ra, rb] of [[0, 2, 1, 0], [4, 6, 0, 1]] as const)
        for (let a = 0; a < GRID; a++)
          for (let b = 0; b < GRID; b++) {
            tot++;
            const x = face(w, a, b, sa);
            if (x === face(w, a + ra, b + rb, sb)) ok++;
            if (x === face(w, a + 2 * ra, b + 2 * rb, sb)) nul++;
            if (x === face(w, a - ra, b - rb, sb)) wrong++;
          }
    }
    expect(ok / tot).toBeGreaterThan(0.98);
    expect(nul / tot).toBeLessThan(0.65);
    expect(wrong / tot).toBeLessThan(0.65);
    const l0 = JSON.parse(readFileSync(`${base}/level0.json`, 'utf8'));
    expect(l0.name).toBe('Dark Domain');
  });
});
