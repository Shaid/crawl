import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCity, cityCell, cityPassable, cityBuilding, renderCityView, type CityTables } from '../../bardstale3/amiga/city.ts';
import { cityMove } from '../games-bardstale3.ts';
import { buildBardsTale3Cities } from '../../bardstale3/amiga/export-city.ts';
import { buildBardsTale3Dungeon } from '../../bardstale3/amiga/export-dungeon.ts';
import type { ViewTables } from '../../bardstale3/amiga/dungeon.ts';

/** Synthetic city record: W x H, rows stored last row first (like the shipped data), empty special list. */
function makeCity(w: number, h: number, cell: (x: number, y: number) => number, flags = 0): Uint8Array {
  const grid = 0x17 + 2 * h;
  const sp = grid + w * h;
  const rec = new Uint8Array(sp + 1);
  rec.fill(0xff, 0, 16);
  rec[0x10] = w;
  rec[0x11] = h;
  rec[0x12] = flags;
  rec[0x15] = sp & 0xff;
  rec[0x16] = sp >> 8;
  for (let y = 0; y < h; y++) {
    const ro = grid + (h - 1 - y) * w;
    rec[0x17 + 2 * y] = ro & 0xff;
    rec[0x18 + 2 * y] = ro >> 8;
    for (let x = 0; x < w; x++) rec[ro + x] = cell(x, y);
  }
  return rec;
}

// values as read from bard3 (asserted against the real executable below)
const DROW = [-1, 0, 1, 0];
const DCOL = [0, 1, 0, -1];
const OFFS0: Array<[number, number]> = [
  [-3, 3], [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3], [3, 3], [-3, 2], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 2],
  [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 0], [1, 0],
];
const rot = (o: Array<[number, number]>, f: number) =>
  o.map(([dx, dy]) => {
    let a = dx, b = dy;
    for (let i = 0; i < f; i++) [a, b] = [b, -a]; // turn right: forward (0,1) -> (1,0)
    return [a + 0, b + 0] as [number, number]; // no -0
  });
const tables = {
  cellOffsets: [0, 1, 2, 3].map((f) => rot(OFFS0, f)),
  dRow: DROW,
  dCol: DCOL,
} as unknown as CityTables;

describe('bardstale3 city record + move rule (synthetic)', () => {
  // 3x3; (1,2) = building 0x31 (temple, piece 1), (2,1) = solid 0xe3, (0,1) = open piece 0x04, (1,0) = empty-building 0x40
  const cells: Record<string, number> = { '1,2': 0x31, '2,1': 0xe3, '0,1': 0x04, '1,0': 0x40 };
  const c = parseCity(makeCity(3, 3, (x, y) => cells[`${x},${y}`] ?? 0), 1);
  const cw = parseCity(makeCity(3, 3, (x, y) => cells[`${x},${y}`] ?? 0, 2), 1);
  it('rows are read through the reversed u16LE row table at 0x17', () => {
    expect(cityCell(c, 1, 2)).toBe(0x31);
    expect(cityCell(c, 1, 0)).toBe(0x40); // null control: the mirrored row does not hold the temple
    expect(cityCell(c, 2, 1)).toBe(0xe3);
  });
  it('0x2736: high nibble 0 / f pass, e blocks, a building passes only with piece 0', () => {
    expect([0x00, 0x04, 0xf2, 0xf0, 0x40].map(cityPassable)).toEqual([true, true, true, true, true]);
    expect([0xe3, 0xe0, 0x43, 0x21].map(cityPassable)).toEqual([false, false, false, false]);
    expect(cityBuilding(0x31)).toMatch(/temple/);
    expect(cityBuilding(0x43)).toMatch(/empty building/);
    expect(cityBuilding(0x53)).toBeNull(); // 5 has no handler
    expect(cityBuilding(0xe3)).toBeNull();
  });
  it('forward = +row for north, +col for east; K enters the building ahead and turns round, W just bumps', () => {
    expect(cityMove(tables, c, 1, 1, 0, false)).toMatchObject({ x: 1, y: 1, facing: 0, moved: false });
    expect(cityMove(tables, c, 1, 1, 0, true)).toMatchObject({ x: 1, y: 1, facing: 2, moved: false });
    expect(cityMove(tables, c, 1, 1, 1, false)).toMatchObject({ moved: false }); // solid e3 to the east
    expect(cityMove(tables, c, 1, 1, 3, false)).toMatchObject({ x: 0, y: 1, moved: true }); // 0x04 is walkable
    expect(cityMove(tables, c, 1, 1, 2, false)).toMatchObject({ x: 1, y: 0, moved: true }); // 0x40: no piece
  });
  it('a bounded map stops at its edge, a wrapping one (flag bit 1) wraps; off-map cells read 0 unless wrapping', () => {
    expect(cityMove(tables, c, 0, 0, 3, false)).toMatchObject({ x: 0, y: 0, moved: false });
    expect(cityMove(tables, cw, 0, 0, 3, false)).toMatchObject({ x: 2, y: 0, moved: true });
    expect(cityCell(c, -1, 2)).toBe(0);
    expect(cityCell(cw, -1, 1)).toBe(0xe3);
  });
});

describe('bardstale3 city view (synthetic)', () => {
  // one step, slot 0 = a 2-byte-wide full-size piece at (0,0); GRP directory entry 1 = the front piece
  const view61 = {
    slotX: [0], slotY: [0], slotW: [1], slotGrp: [2], slotScale: [64], slotMirror: [0],
  } as unknown as ViewTables;
  const piece = { bpr: 2, h: 1, data: Uint8Array.from([0x12, 0x34]) };
  const t = { ...tables, stepCell: [16], stepSlot: [0], skyByte: 0xbb, skyLen: 56, groundByte: 0x44, groundLen: 56 * 87, grpLimit: 20 } as CityTables;
  it('clears sky / ground, then draws the piece of the cell ahead only when its low nibble is set', () => {
    const c = parseCity(makeCity(3, 3, (x, y) => (x === 1 && y === 2 ? 0xe1 : 0)), 0);
    const v = renderCityView(t, view61, [null, piece], c, 1, 1, 0);
    expect(Array.from(v.subarray(0, 6))).toEqual([1, 2, 3, 4, 11, 11]);
    expect(v[112 * 87]).toBe(4);
    const empty = renderCityView(t, view61, [null, piece], c, 1, 1, 2); // facing south: nothing ahead
    expect(Array.from(empty.subarray(0, 4))).toEqual([11, 11, 11, 11]);
  });
});

const D = 'data/_unexplored_/BardsTale3/data';
describe.skipIf(!existsSync(resolve(D, 'bard3')))('bardstale3 cities (real data)', () => {
  const ex = buildBardsTale3Cities(D);
  it('tables come out of bard3 as traced', () => {
    expect(ex.tables.dRow).toEqual(DROW);
    expect(ex.tables.dCol).toEqual(DCOL);
    expect(ex.tables.cellOffsets[0]).toEqual(OFFS0);
    for (let f = 1; f < 4; f++) expect(ex.tables.cellOffsets[f]).toEqual(rot(OFFS0, f));
    expect(ex.tables.stepCell).toEqual([1, 2, 3, 4, 5, 9, 11, 9, 10, 11, 15, 17, 15, 16, 17, 19, 20]);
    expect(ex.tables.stepSlot).toEqual([30, 31, 32, 33, 34, 42, 43, 45, 46, 47, 54, 55, 56, 57, 58, 59, 60]);
    expect([ex.tables.skyByte, ex.tables.skyLen, ex.tables.groundByte, ex.tables.groundLen]).toEqual([0xbb, 0xa10, 0x44, 0x930]);
    expect(ex.tables.grpLimit).toBe(20);
    expect(ex.tables.newGame).toEqual({ map: 0, y: 11, x: 15, facing: 0 });
    expect(ex.grpOfSet).toEqual(['wildwal.grp', 'skara.grp', 'skara.grp', 'gdung.grp']);
  });
  it('ten maps, names and sizes', () => {
    expect(ex.cities.map((c) => `${c.name} ${c.w}x${c.h}`)).toEqual([
      'Wilderness 20x20', 'Skara Brae 17x17', 'Arboria 12x12', 'Ciera Brannia 16x16', 'Gelidia 16x16',
      'Lucencia 12x12', 'Celaria Bree 16x16', 'Nowhere 11x11', 'Dark Copse 11x11', 'Black Scar 16x16',
    ]);
  });
  it('orientation: every dungeon exit and teleport arrival lands on a passable square; mirrored rows do not', () => {
    const dun = buildBardsTale3Dungeon(D);
    const pts: Array<[number, number, number]> = [];
    for (const { level } of dun.levels)
      if (level.levelIndex === 0 && (level.exit.x || level.exit.y)) pts.push([level.exit.city, level.exit.x, level.exit.y]);
    for (const c of ex.cities) for (const s of c.specials) if (s.teleport && s.teleport.target < 10 && s.y < 0x80) pts.push([s.teleport.target, s.teleport.x, s.teleport.y]);
    expect(pts.length).toBeGreaterThanOrEqual(16);
    const at = (m: number, x: number, y: number) => ex.cities[m]!.cells[y * ex.cities[m]!.w + x]!;
    const ok = pts.filter(([m, x, y]) => cityPassable(at(m, x, y))).length;
    const flipped = pts.filter(([m, x, y]) => cityPassable(at(m, x, ex.cities[m]!.h - 1 - y))).length;
    expect(ok).toBe(pts.length);
    expect(flipped).toBeLessThan(pts.length * 0.75);
    // 9 of the 11 dungeon exits sit on 0xf? special squares (the entrances; Mountain = 0x04, Sceadu's Demens = 0x00)
    const exits = dun.levels.filter(({ level }) => level.levelIndex === 0 && (level.exit.x || level.exit.y)).map(({ level }) => level.exit);
    expect(exits).toHaveLength(11);
    expect(exits.filter((e) => at(e.city, e.x, e.y) >> 4 === 0xf)).toHaveLength(9);
  });
  it('the Wilderness gate teleport lands on Skara Brae\'s west edge, and the game\'s start square is open', () => {
    const w = ex.cities[0]!;
    const gate = w.specials.find((s) => s.teleport && s.teleport.target === 1)!;
    expect(gate.teleport).toEqual({ y: 10, x: 0, target: 1 });
    expect(cityPassable(w.cells[11 * w.w + 15]!)).toBe(true);
    expect(ex.starts[0]).toMatchObject({ x: 15, y: 11 });
  });
});
