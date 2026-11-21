import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stepPose, STREET_Z } from '../games-liberation.ts';
import {
  fillWindow, applyVisibility, composeView, canEnter, cellValue, parseVgm, PLANE_BYTES,
  type EngineTables, type CityZone,
} from '../../liberation/cd32/view-model.ts';
import { splitCaptive, readEngineTables, readBackdrop, readCityWalls } from '../../liberation/cd32/engine-tables.ts';

/** Synthetic tables: plane-0 type 0x12 = road (open), 0x01 = building (solid), 0x10 = drop. */
function synthTables(): EngineTables {
  const id = Array.from({ length: 28 }, (_, i) => i);
  const flags = new Array(64).fill(0);
  flags[1] = 3; flags[0x0f] = 0x10; flags[0x1a] = 8;
  const z1 = id.slice(); z1[0x10] = 0x0f;
  return { layer: { m1: id, z0: id, z1, z2: id, z3: id }, flags, clip: [0, 1, 3, 4, 6, 10, 11, -1], slots: [], vis: [0], textures: [] };
}
/** rows north-up, y = row index; '.' road, '#' building, 'v' drop, 's' stairs */
function synthZone(rows: string[]): CityZone {
  const planes = new Uint8Array(3 * 4096).fill(0x01);
  rows.forEach((r, y) => [...r].forEach((c, x) => { planes[y * 64 + x] = c === '.' ? 0x12 : c === 'v' ? 0x10 : c === 's' ? 0x1a : 0x01; }));
  return { world: 0, zone: 0, planes, start: { x: 1, y: 1, z: 1, facing: 0 } };
}

describe('Liberation movement / collision (synthetic)', () => {
  const t = synthTables();
  const z = synthZone([
    '#####',
    '#...#', // y 1
    '#.#v#', // y 2
    '#.s.#', // y 3
    '#####',
  ]);
  it('facing 0 = N moves -y, 1 = E moves +x; buildings block', () => {
    expect(stepPose(t, z, { x: 1, y: 2, facing: 0 }, 'fwd')).toEqual({ x: 1, y: 1, facing: 0 });
    expect(stepPose(t, z, { x: 1, y: 1, facing: 0 }, 'fwd')).toBeNull();
    expect(stepPose(t, z, { x: 1, y: 1, facing: 1 }, 'fwd')).toEqual({ x: 2, y: 1, facing: 1 });
    expect(stepPose(t, z, { x: 1, y: 1, facing: 2 }, 'fwd')).toEqual({ x: 1, y: 2, facing: 2 });
    expect(stepPose(t, z, { x: 1, y: 1, facing: 3 }, 'fwd')).toBeNull();
  });
  it('turns go N -> E -> S -> W; strafes are perpendicular', () => {
    expect(stepPose(t, z, { x: 1, y: 1, facing: 0 }, 'turnR')!.facing).toBe(1);
    expect(stepPose(t, z, { x: 1, y: 1, facing: 0 }, 'turnL')!.facing).toBe(3);
    expect(stepPose(t, z, { x: 2, y: 1, facing: 0 }, 'right')).toEqual({ x: 3, y: 1, facing: 0 });
    expect(stepPose(t, z, { x: 2, y: 1, facing: 0 }, 'left')).toEqual({ x: 1, y: 1, facing: 0 });
    expect(stepPose(t, z, { x: 1, y: 2, facing: 1 }, 'back')).toBeNull();
  });
  it('drops (flags bit 4) and stairs (bit 3) are not entered; noclip only stops at the map edge', () => {
    expect(canEnter(t, z, 3, 2, STREET_Z)).toBe(false); // 0x10 -> 0x0f, flags 0x10
    expect(canEnter(t, z, 2, 3, STREET_Z)).toBe(false); // 0x1a, flags 8
    expect(canEnter(t, z, 3, 3, STREET_Z)).toBe(true);
    expect(stepPose(t, z, { x: 1, y: 1, facing: 0 }, 'fwd', true)).toEqual({ x: 1, y: 0, facing: 0 });
    expect(stepPose(t, z, { x: 1, y: 0, facing: 0 }, 'fwd', true)).toBeNull();
  });
});

describe('Liberation window orientation (synthetic)', () => {
  const t = synthTables();
  // a single road cell ahead of (10,10) in each direction carries a marker type
  const marks = [[10, 9], [11, 10], [10, 11], [9, 10]] as const;
  it('the cell one step forward lands on window row 3, column 2 (index 17 + 25) for every facing', () => {
    for (let f = 0; f < 4; f++) {
      const z = synthZone([]);
      const [mx, my] = marks[f]!;
      z.planes[my * 64 + mx] = 0x13;
      const w = fillWindow(t, z, 10, 10, 1, f);
      expect(w[25 + 17]).toBe(0x13);
      // control: the wrong-orientation window (facing + 1) must not see it there
      const wrong = fillWindow(t, z, 10, 10, 1, (f + 1) & 3);
      expect(wrong[25 + 17]).not.toBe(0x13);
    }
  });
  it('out-of-map window cells keep the 0x06 default', () => {
    const w = fillWindow(t, synthZone([]), 0, 0, 1, 0);
    expect(w[25 + 0]).toBe(0x06);
  });
  it('visibility script: a solid cell blanks the listed cells, an open one skips them', () => {
    const w = new Uint8Array(75).fill(0x12);
    w[42] = 1; // solid
    applyVisibility(w, [42, 3, 0xfe, 37, 32, 0]); // if cell 42 is solid: hide 37, 32
    expect(w[37]).toBe(8); expect(w[32]).toBe(8);
    const o = new Uint8Array(75).fill(0x12);
    applyVisibility(o, [42, 3, 0xfe, 37, 32, 0]);
    expect(o[37]).toBe(0x12);
  });
  it('building-height layer logic (+0x283C8): roof layer -> 16, above -> 15, below -> the wall type', () => {
    const tz: EngineTables = { ...t, layer: { ...t.layer, z2: t.layer.z2.map((v, i) => (i === 1 ? 0x81 : v)), z3: t.layer.z3.map((v, i) => (i === 1 ? 0x81 : v)) } };
    // plane 1 high nibble 1 -> floors = 3
    expect(cellValue(tz, 0x01, 0x10, 0, 3)!.v).toBe(16);
    expect(cellValue(tz, 0x01, 0x10, 0, 2)!.v).toBe(1);
    expect(cellValue(tz, 0x01, 0x00, 0, 3)!.v).toBe(15); // floors = 2 < layer 3
    expect(cellValue(tz, 0x01, 0x00, 0, -2)).toBeNull();
  });
});

const DATA = resolve('data/liberation/cd32/data');
const hasData = existsSync(resolve(DATA, 'captiveII'));

describe.skipIf(!hasData)('Liberation real data', () => {
  const img = hasData ? splitCaptive(new Uint8Array(readFileSync(resolve(DATA, 'captiveII')))) : null!;
  const t = hasData ? readEngineTables(img.code) : null!;
  it('reads the composer tables out of captiveII', () => {
    expect(t.slots.length).toBeGreaterThan(150);
    expect(t.slots.filter((s) => s.obj).length).toBeGreaterThan(40);
    expect(t.flags[0x12]).toBe(0); // road
    expect(t.flags[1] & 6).not.toBe(0); // building
    expect(t.clip.slice(0, 8)).toEqual([0, 1, 3, 4, 6, 10, 11, -1]);
    expect(readCityWalls(img.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(readBackdrop(img).length).toBe(14400);
  });
  it('every Wall*.VGM bank 0 parses to 42 sprites and the four banks end at EOF', () => {
    const buf = new Uint8Array(readFileSync(resolve(DATA, 'Wall01.VGM')));
    const banks = parseVgm(buf);
    expect(banks.map((b) => b.length)).toEqual([42, 45, 24, 41]);
  });
  const gen = resolve('build/cache/liberation/gen');
  it.skipIf(!existsSync(gen))('TS composer == captiveII composer (musashi oracle) on sampled poses', async () => {
    const { runGen } = await import('../../liberation/cd32/verify-view.ts');
    const poses: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 40; i++) poses.push([(i * 37) % 64, (i * 23 + 5) % 64, 1, i & 3]);
    const vout = resolve('build/cache/liberation/test-views.bin');
    const g = runGen(0, 8, poses.map((p) => p.join(',')).join(';'), vout);
    const ov = new Uint8Array(readFileSync(vout));
    const bank0 = parseVgm(new Uint8Array(readFileSync(resolve(DATA, `Wall${String(g.wall).padStart(2, '0')}.VGM`))))[0]!;
    const bd = readBackdrop(img);
    const rec = 75 + PLANE_BYTES * 6;
    let exact = 0, nullOk = 0;
    poses.forEach(([x, y, z, f], k) => {
      const w = fillWindow(t, g.zone, x, y, z, f);
      const v = composeView(t, bank0, w, 0, bd);
      const o = ov.subarray(k * rec + 75, (k + 1) * rec);
      if (v.every((b, i) => b === o[i])) exact++;
      // null control: a view composed for the opposite facing must differ somewhere
      const vw = composeView(t, bank0, fillWindow(t, g.zone, x, y, z, (f + 2) & 3), 0, bd);
      if (!vw.every((b, i) => b === o[i])) nullOk++;
    });
    expect(exact).toBe(poses.length);
    expect(nullOk).toBeGreaterThan(poses.length * 0.8);
    // the CityGen start cell is walkable
    expect(canEnter(t, g.zone, g.zone.start.x, g.zone.start.y, STREET_Z)).toBe(true);
  });
});
