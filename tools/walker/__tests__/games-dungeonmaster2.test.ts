import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { DoorStates, SQ, blocker, tryStep, type Dm2Map } from '../../dungeonmaster2/amiga/model.ts';
import { renderPlaceholder, VIEW_W, VIEW_H } from '../../dungeonmaster2/amiga/render.ts';
import { buildBundle } from '../../dungeonmaster2/amiga/export-walker.ts';

const sq = (type: number, attr = 0) => (type << 5) | attr;

/** 5x3: floor, floor, door (E-W axis, closed), floor, stairs along row 1; teleporter at (0,2)... */
function synth(): Dm2Map {
  const w = 6;
  const h = 3;
  const raw = new Array<number>(w * h).fill(sq(SQ.WALL));
  raw[1 * w + 0] = sq(SQ.FLOOR);
  raw[1 * w + 1] = sq(SQ.FLOOR);
  raw[1 * w + 2] = sq(SQ.DOOR, 4); // closed, E-W axis (attr bit 3 clear)
  raw[1 * w + 3] = sq(SQ.FLOOR);
  raw[1 * w + 4] = sq(SQ.TELEPORTER);
  raw[1 * w + 5] = sq(SQ.EMPTY);
  return { index: 0, level: 1, width: w, height: h, offsetX: 0, offsetY: 0, mapGraphicsStyle: 3, floorCeilingStyle: 0, raw, teleporters: { [1 * w + 4]: { map: 0, x: 0, y: 1, rot: 2, relative: false } } };
}

describe('DM2 walker model (synthetic)', () => {
  it('walls, empty and map edge block; floor is enterable', () => {
    const m = synth();
    const ds = new DoorStates();
    expect(blocker(m, ds, 0, 0, 0)).toBe('wall');
    expect(blocker(m, ds, 5, 1, 1)).toBe('wall'); // EMPTY is solid
    expect(blocker(m, ds, -1, 1, 3)).toBe('edge');
    expect(blocker(m, ds, 1, 1, 1)).toBeNull();
  });
  it('closed door blocks along its axis; opens; side entry is always blocked', () => {
    const m = synth();
    const ds = new DoorStates();
    expect(blocker(m, ds, 2, 1, 1)).toBe('door-closed');
    expect(blocker(m, ds, 2, 1, 0)).toBe('door-side'); // entering N-S into an E-W door
    ds.set(m, 1 * m.width + 2, 0);
    expect(blocker(m, ds, 2, 1, 1)).toBeNull();
  });
  it('teleporter square relocates and sets facing', () => {
    const m = synth();
    const ds = new DoorStates();
    const r = tryStep(m, ds, { mapIndex: 0, x: 3, y: 1, facing: 1 }, 1);
    expect(r.moved).toBe(true);
    expect(r.pose).toEqual({ mapIndex: 0, x: 0, y: 1, facing: 2 });
  });
  it('render: a wall ahead differs from an open corridor ahead (null control: same pose twice is identical)', () => {
    const m = synth();
    const ds = new DoorStates();
    const a = renderPlaceholder(m, ds, { mapIndex: 0, x: 0, y: 1, facing: 0 }); // wall right ahead
    const b = renderPlaceholder(m, ds, { mapIndex: 0, x: 0, y: 1, facing: 1 }); // corridor ahead
    const a2 = renderPlaceholder(m, ds, { mapIndex: 0, x: 0, y: 1, facing: 0 });
    expect(Buffer.compare(Buffer.from(a), Buffer.from(a2))).toBe(0);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
    expect(a.length).toBe(VIEW_W * VIEW_H * 4);
  });
});

const DAT = 'data/dungeonmaster2/amiga/DUNGEON.DAT';
describe.skipIf(!existsSync(DAT))('DM2 real DUNGEON.DAT', () => {
  const bundle = buildBundle(new Uint8Array(readFileSync(DAT)));
  const open = (m: Dm2Map, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    const t = (m.raw[y * m.width + x]! >> 5) & 7;
    return t !== SQ.WALL && t !== SQ.EMPTY;
  };

  it('44 maps; start pose is an enterable cell', () => {
    expect(bundle.maps).toHaveLength(44);
    const m = bundle.maps[bundle.start.mapIndex]!;
    expect(open(m, bundle.start.x, bundle.start.y)).toBe(true);
  });

  it('door passage axis (attr bit 3) matches the corridor around all 53 doors; flipped axis matches none', () => {
    let agree = 0, flipped = 0, n = 0;
    for (const m of bundle.maps) {
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        const r = m.raw[y * m.width + x]!;
        if (((r >> 5) & 7) !== SQ.DOOR) continue;
        n++;
        const ns = (r & 8) !== 0;
        const along = ns ? open(m, x, y - 1) && open(m, x, y + 1) : open(m, x - 1, y) && open(m, x + 1, y);
        const across = ns ? open(m, x - 1, y) && open(m, x + 1, y) : open(m, x, y - 1) && open(m, x, y + 1);
        if (along && !across) agree++;
        if (across && !along) flipped++;
      }
    }
    expect(n).toBe(53);
    expect(agree).toBe(53);
    expect(flipped).toBe(0);
  });

  it('EMPTY (type 7) cells are never adjacent to floor cells (solid filler); walls are', () => {
    let emptyNextToFloor = 0, wallNextToFloor = 0;
    for (const m of bundle.maps) for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      if (((m.raw[y * m.width + x]! >> 5) & 7) !== SQ.FLOOR) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const t = (m.raw[ny * m.width + nx]! >> 5) & 7;
        if (t === SQ.EMPTY) emptyNextToFloor++;
        if (t === SQ.WALL) wallNextToFloor++;
      }
    }
    expect(emptyNextToFloor).toBe(0);
    expect(wallNextToFloor).toBeGreaterThan(1000);
  });

  it('216 teleporter destinations all land on enterable cells of the target map (swapped X/Y control fails many)', () => {
    let n = 0, good = 0, goodSwapped = 0;
    for (const m of bundle.maps) for (const [cell, t] of Object.entries(m.teleporters)) {
      n++;
      void cell;
      const tm = bundle.maps[t.map];
      if (tm && open(tm, t.x, t.y)) good++;
      if (tm && open(tm, t.y, t.x)) goodSwapped++;
    }
    expect(n).toBe(216);
    expect(good).toBe(216);
    expect(goodSwapped).toBeLessThan(216);
  });

  it('writes representative placeholder frames to build/cache/dungeonmaster2/walker-frames/', async () => {
    const dir = resolve('build/cache/dungeonmaster2/walker-frames');
    mkdirSync(dir, { recursive: true });
    const ds = new DoorStates();
    const m0 = bundle.maps[0]!;
    const poses = [
      { name: 'map0-start', m: m0, pose: { ...bundle.start } },
      { name: 'map1-a', m: bundle.maps[1]!, pose: { mapIndex: 1, x: 9, y: 5, facing: 0 } },
    ];
    for (const { name, m, pose } of poses) {
      const rgba = renderPlaceholder(m, ds, pose);
      const colours = new Set<number>();
      for (let i = 0; i < rgba.length; i += 4) colours.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
      expect(colours.size).toBeGreaterThan(8);
      await writePNG(resolve(dir, `${name}.png`), new Uint8Array(rgba), VIEW_W, VIEW_H);
    }
  });
});
