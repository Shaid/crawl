import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GRID,
  buildViewRows,
  canMoveForward,
  stepForward,
  renderView,
  pieceRanges,
  type LevelData,
  type DungeonArt,
} from '../../bardstale1/amiga/dungeon.ts';
import { artFromJSON } from '../games-bardstale1.ts';

const blank = (): LevelData => ({ walls: new Uint8Array(GRID * GRID), flags: new Uint8Array(GRID * GRID), name: 't' });
const setFace = (lv: LevelData, a: number, b: number, shift: number, v: number) => {
  lv.walls[a * GRID + b] = (lv.walls[a * GRID + b]! & ~(3 << shift)) | (v << shift);
};

describe('bardstale1 movement', () => {
  it('blocked only by a plain wall on the front face; doors and secret doors pass', () => {
    const lv = blank();
    setFace(lv, 5, 5, 0, 1);
    expect(canMoveForward(lv, 5, 5, 0)).toBe(false);
    setFace(lv, 5, 5, 0, 2);
    expect(canMoveForward(lv, 5, 5, 0)).toBe(true);
    setFace(lv, 5, 5, 0, 3);
    expect(canMoveForward(lv, 5, 5, 0)).toBe(true);
    // wrong-orientation control: a wall on the +b face does not block facing +a
    const lv2 = blank();
    setFace(lv2, 5, 5, 4, 1);
    expect(canMoveForward(lv2, 5, 5, 0)).toBe(true);
    expect(canMoveForward(lv2, 5, 5, 1)).toBe(false);
  });
  it('wraps at 22', () => {
    expect(stepForward(21, 0, 0)).toEqual([0, 0]);
    expect(stepForward(0, 0, 2)).toEqual([21, 0]);
    expect(stepForward(3, 0, 3)).toEqual([3, 21]);
  });
});

describe('bardstale1 view rows', () => {
  it('centre column sees the front wall at the right distance, per facing', () => {
    const lv = blank();
    setFace(lv, 8, 4, 0, 1); // wall on +a face of (8,4): facing N from (5,4) sees it at distance 3
    expect(buildViewRows(lv, 5, 4, 0)[3 * 7 + 3]! & 3).toBe(1);
    expect(buildViewRows(lv, 5, 4, 0)[2 * 7 + 3]! & 3).toBe(0);
    // same wall seen facing east from the wrong place is absent (null control)
    expect(buildViewRows(lv, 5, 4, 1)[3 * 7 + 3]! & 3).toBe(0);
  });
  it('side wall to the left of the centre line appears in column 2 (facing N: -b side)', () => {
    const lv = blank();
    setFace(lv, 5, 4, 6, 1); // west face of (5,4)
    expect(buildViewRows(lv, 5, 4, 0)[0 * 7 + 2]).toBe(1);
    expect(buildViewRows(lv, 5, 4, 0)[0 * 7 + 4]).toBe(0);
    expect(buildViewRows(lv, 5, 4, 2)[0 * 7 + 4]).toBe(1); // facing S, west is on the right
  });
});

describe('bardstale1 piece table', () => {
  it('tiles big_dung (30,304 B) with no gap or overlap', () => {
    let pos = 0;
    for (const [o, l] of pieceRanges().sort((x, y) => x[0] - y[0])) {
      expect(o).toBe(pos);
      pos += l;
    }
    expect(pos).toBe(30304);
  });
});

const viewJson = resolve('public/assets/bardstale1/amiga/data/dungeon/view.json');
describe.skipIf(!existsSync(viewJson))('bardstale1 real data', () => {
  it('renders distinct frames, wall vs door differs, and a closed box fills the view', () => {
    const art: DungeonArt = artFromJSON(JSON.parse(readFileSync(viewJson, 'utf8')));
    const open = blank();
    const box = blank();
    setFace(box, 5, 5, 0, 1);
    const d = blank();
    setFace(d, 5, 5, 0, 2);
    const fOpen = renderView(art, open, 5, 5, 0);
    const fWall = renderView(art, box, 5, 5, 0);
    const fDoor = renderView(art, d, 5, 5, 0);
    expect(Buffer.compare(Buffer.from(fOpen), Buffer.from(fWall))).not.toBe(0);
    expect(Buffer.compare(Buffer.from(fWall), Buffer.from(fDoor))).not.toBe(0);
    // an adjacent wall covers the central 96x83 area: rows 0..82, x 9..104 differ from the background
    let diff = 0;
    for (let y = 0; y < 83; y++) for (let x = 9; x < 104; x++) if (fWall[y * 112 + x] !== art.background[y * 112 + x]) diff++;
    expect(diff).toBeGreaterThan(95 * 83 * 0.8);
  });
  it('level 0 decodes: 16 levels, Cellars first, grid reciprocity >99%', () => {
    const base = resolve('public/assets/bardstale1/amiga/data/dungeon');
    const l0 = JSON.parse(readFileSync(`${base}/level0.json`, 'utf8'));
    expect(l0.name).toBe('Cellars');
    let ok = 0, tot = 0;
    for (let lvl = 0; lvl < 16; lvl++) {
      const j = JSON.parse(readFileSync(`${base}/level${lvl}.json`, 'utf8'));
      const w: number[] = j.walls;
      for (let a = 0; a < GRID; a++)
        for (let b = 0; b < GRID; b++) {
          tot += 2;
          if (((w[a * GRID + b]! >> 4) & 3) === ((w[a * GRID + ((b + 1) % GRID)]! >> 6) & 3)) ok++;
          if (((w[a * GRID + b]! >> 0) & 3) === ((w[((a + 1) % GRID) * GRID + b]! >> 2) & 3)) ok++;
        }
    }
    expect(ok / tot).toBeGreaterThan(0.99);
  });
});
