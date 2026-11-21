import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { DoorStates, SQ, blocker, tryStep, type Dm2Map } from '../../dungeonmaster2/amiga/model.ts';
import { renderPlaceholder, VIEW_W, VIEW_H } from '../../dungeonmaster2/amiga/render.ts';
import { buildBundle } from '../../dungeonmaster2/amiga/export-walker.ts';
import { buildViewportAsset } from '../../dungeonmaster2/amiga/export-viewport.ts';
import {
  backgroundMirror, cellSquare, renderViewport, sceneParity, wallPieceFor,
  type ViewportAsset, type ViewportTables, type VpPiece,
} from '../../dungeonmaster2/amiga/viewport.ts';

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

// --- Viewport compositor (tools/dungeonmaster2/amiga/viewport.ts) ---

/** The SKUL.FTL cell tables (as read by readViewportTables) -- the synthetic asset reuses their shape. */
const TABLES: ViewportTables = {
  xDist: [0, -1, 1, 0, -1, 1, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, 0, -1, 1, -2, 2, -3, 3],
  yDist: [0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4],
  flipPartner: [0, 2, 1, 3, 5, 4, 6, 8, 7, 10, 9, 11, 13, 12, 15, 14, 16, 18, 17, 20, 19, 22, 21],
  ornateClass: new Array(23).fill(0),
  drawOrder: [19, 20, 17, 18, 16, 14, 15, 12, 13, 11, 9, 10, 7, 8, 6, 4, 5, 3, 1, 2],
  doorVisible: [1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1],
  doorRect: new Array(16).fill(-1),
};

/** w x h piece filled with colour `c`, except column 0 which is colour `edge` (makes mirroring visible). */
function solid(w: number, h: number, c: number, edge = c): VpPiece {
  const bytes = new Uint8Array((w * h + 1) >> 1);
  for (let i = 0; i < w * h; i++) { const v = i % w === 0 ? edge : c; bytes[i >> 1] |= i & 1 ? v : v << 4; }
  return { w, h, offX: 0, offY: 0, px: Buffer.from(bytes).toString('base64') };
}

function synthAsset(): ViewportAsset {
  const pal = Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 255 - i * 16] as [number, number, number]);
  const pieces: Record<string, VpPiece> = { 0: solid(224, 97, 1), 1: solid(224, 39, 2) };
  for (let s = 35; s <= 50; s++) pieces[s] = solid(20, 40, 3 + (s % 10), 15);
  const rects: ViewportAsset['rects'] = { 700: { x: 0, y: 0, align: 1 }, 701: { x: 0, y: 135, align: 4 } };
  for (let c = 0; c < 21; c++) rects[702 + c] = { x: 112 + TABLES.xDist[c]! * 40, y: 68, align: 0 };
  return { tables: TABLES, rects, wallsets: { 3: { id: 3, palettes: [pal], colorKey: 9, sceneFlags: 0, pieces } }, doors: {} };
}

describe('DM2 viewport compositor (synthetic)', () => {
  it('cell squares follow the facing (cell 3 = one ahead, cell 1 = ahead-left... no: same row, left)', () => {
    const pose = { mapIndex: 0, x: 5, y: 5, facing: 1 }; // east
    expect(cellSquare(TABLES, pose, 3)).toEqual({ x: 6, y: 5 });
    expect(cellSquare(TABLES, pose, 1)).toEqual({ x: 5, y: 4 }); // left of an east-facing party is north
    expect(cellSquare(TABLES, pose, 2)).toEqual({ x: 5, y: 6 });
    expect(cellSquare(TABLES, { ...pose, facing: 0 }, 1)).toEqual({ x: 4, y: 5 }); // north-facing: left is west
  });

  it('DRAW_WALL piece/mirror rules: left/right share a left-facing piece; flipped squares swap partners', () => {
    expect(wallPieceFor(TABLES, 1, false)).toEqual({ piece: 35, mirror: false });
    expect(wallPieceFor(TABLES, 2, false)).toEqual({ piece: 36, mirror: true });
    expect(wallPieceFor(TABLES, 3, false)).toEqual({ piece: 37, mirror: false });
    expect(wallPieceFor(TABLES, 1, true)).toEqual({ piece: 36, mirror: false });
    expect(wallPieceFor(TABLES, 2, true)).toEqual({ piece: 35, mirror: true });
    expect(wallPieceFor(TABLES, 3, true)).toEqual({ piece: 37, mirror: true });
    expect(wallPieceFor(TABLES, 16, false)).toEqual({ piece: 50, mirror: false });
    expect(wallPieceFor(TABLES, 18, false)).toEqual({ piece: 50, mirror: true });
    expect(wallPieceFor(TABLES, 20, true)).toEqual({ piece: 50, mirror: true }); // |x|=2 never mirrors, then ^ flip
  });

  it('scene parity and background mirror flags', () => {
    const m = { offsetX: 1, offsetY: 0, level: 2 };
    expect(sceneParity(m, { mapIndex: 0, x: 0, y: 0, facing: 0 })).toBe(1);
    expect(sceneParity(m, { mapIndex: 0, x: 1, y: 0, facing: 0 })).toBe(0);
    expect(backgroundMirror(0x28, 1, 0)).toEqual({ floor: true, ceiling: false }); // bit3 floor=parity, bit5 ceiling=facing&1
    expect(backgroundMirror(0x28, 0, 1)).toEqual({ floor: false, ceiling: true });
    expect(backgroundMirror(0, 1, 1)).toEqual({ floor: false, ceiling: false });
  });

  it('render: wall ahead vs open corridor differ; same pose twice is identical; right wall is the mirror of the left', () => {
    const asset = synthAsset();
    const w = 5, h = 5;
    const raw = new Array<number>(w * h).fill(sq(SQ.FLOOR));
    const m: Dm2Map = { index: 0, level: 0, width: w, height: h, offsetX: 0, offsetY: 0, mapGraphicsStyle: 3, floorCeilingStyle: 0, raw, teleporters: {} };
    const open = renderViewport(asset, m, { mapIndex: 0, x: 2, y: 2, facing: 0 })!;
    raw[1 * w + 2] = sq(SQ.WALL);
    const wall = renderViewport(asset, m, { mapIndex: 0, x: 2, y: 2, facing: 0 })!;
    const wall2 = renderViewport(asset, m, { mapIndex: 0, x: 2, y: 2, facing: 0 })!;
    expect(Buffer.compare(Buffer.from(wall), Buffer.from(wall2))).toBe(0);
    expect(Buffer.compare(Buffer.from(wall), Buffer.from(open))).not.toBe(0);
    // walls at D0 left (cell 1) and D0 right (cell 2) on an even-parity square: right uses piece 36 mirrored,
    // so its marked column (colour 15) lands on the right edge of its box
    raw.fill(sq(SQ.FLOOR));
    raw[2 * w + 1] = sq(SQ.WALL);
    raw[2 * w + 3] = sq(SQ.WALL);
    const lr = renderViewport(asset, m, { mapIndex: 0, x: 2, y: 2, facing: 0 })!; // parity (2+2+0)&1 = 0
    const px = (x: number, y: number) => lr[(y * 224 + x) * 4]!;
    expect(px(72 - 10, 68)).toBe(15 * 16); // left box spans 62..81, marked column first
    expect(px(152 + 9, 68)).toBe(15 * 16); // right box spans 142..161, mirrored: marked column last
    expect(px(152 - 10, 68)).not.toBe(15 * 16);
  });

  it('a map whose wallset is not exported falls back (null)', () => {
    const asset = synthAsset();
    const m = synth();
    expect(renderViewport(asset, { ...m, mapGraphicsStyle: 9 }, { mapIndex: 0, x: 1, y: 1, facing: 0 })).toBeNull();
  });
});

const GFX = 'data/dungeonmaster2/amiga/GRAPHICS.DAT';
const SKUL = 'data/dungeonmaster2/amiga/SKUL.FTL';
describe.skipIf(!existsSync(DAT) || !existsSync(GFX) || !existsSync(SKUL))('DM2 real viewport', () => {
  const bundle = existsSync(DAT) ? buildBundle(new Uint8Array(readFileSync(DAT))) : null!;
  const asset = existsSync(GFX) && existsSync(SKUL)
    ? buildViewportAsset(new Uint8Array(readFileSync(GFX)), new Uint8Array(readFileSync(SKUL)))
    : null!;

  it('every map style used by the dungeon has an exported wallset with floor, ceiling and the 16 wall pieces', () => {
    for (const m of bundle.maps) {
      const ws = asset.wallsets[m.mapGraphicsStyle]!;
      expect(ws, `map ${m.index}`).toBeTruthy();
      for (const s of [0, 1, ...Array.from({ length: 16 }, (_, i) => 35 + i)]) expect(ws.pieces[s], `map ${m.index} S=${s}`).toBeTruthy();
    }
    // every door type a map references exists in category 14
    for (const m of bundle.maps) for (const k of Object.values(m.doorKinds ?? {})) expect(asset.doors[m.doorTypes![k]!], `map ${m.index}`).toBeTruthy();
  });

  it('renders real frames (start corridor, front wall, a closed door) and writes them to build/cache', async () => {
    const dir = resolve('build/cache/dungeonmaster2/walker-frames');
    mkdirSync(dir, { recursive: true });
    const ds = new DoorStates();
    const frames = [
      { name: 'vp-map0-start-corridor', pose: { ...bundle.start } },
      { name: 'vp-map0-front-wall', pose: { mapIndex: 0, x: 3, y: 6, facing: 0 } },
      { name: 'vp-map6-door-d1', pose: { mapIndex: 6, x: 11, y: 8, facing: 0 } },
      { name: 'vp-map14-outdoor', pose: { mapIndex: 14, x: 3, y: 14, facing: 3 } },
    ];
    const out: Uint8ClampedArray[] = [];
    for (const { name, pose } of frames) {
      const m = bundle.maps.find((x) => x.index === pose.mapIndex)!;
      const rgba = renderViewport(asset, m, pose, undefined, ds)!;
      expect(rgba).not.toBeNull();
      const colours = new Set<number>();
      for (let i = 0; i < rgba.length; i += 4) colours.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
      expect(colours.size, name).toBeGreaterThanOrEqual(5); // blank-frame control: 1 colour
      out.push(rgba);
      await writePNG(resolve(dir, `${name}.png`), new Uint8Array(rgba), VIEW_W, VIEW_H);
    }
    expect(Buffer.compare(Buffer.from(out[0]!), Buffer.from(out[1]!))).not.toBe(0);
    // opening the door changes the frame; the door square ahead is (11,7)
    const m6 = bundle.maps.find((x) => x.index === 6)!;
    const cell = 7 * m6.width + 11;
    expect((m6.raw[cell]! >> 5) & 7).toBe(SQ.DOOR);
    ds.set(m6, cell, 0);
    const opened = renderViewport(asset, m6, frames[2]!.pose, undefined, ds)!;
    expect(Buffer.compare(Buffer.from(opened), Buffer.from(out[2]!))).not.toBe(0);
  });
});
