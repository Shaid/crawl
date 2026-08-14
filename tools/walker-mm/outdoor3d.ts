/**
 * MM2 outdoor first-person scene builder.
 *
 * Port of Vairn/MM2's `wiki/maze-walker/outdoor3d.js` (itself a port of
 * `tools/view3d_outdoor.py` — traced from the game's outdoor 3D view).
 * Overland screens use terrain-id page encoding (low 5 bits of each cell),
 * not wall codes, so they render with a different pipeline: horizon lanes
 * (outdoor1-3.32 sheets) + per-biome decor bands (desert/ocean/swamp/
 * tundra .32 sheets), placed by the game's outdoor blit tables.
 */
import { MAP_GRID, MAP_PAGE_SIZE, ORIGIN_X } from './maze3d.ts';
import type { ScreenLike } from './maze3d.ts';

export interface OutdoorBlit {
  sheet: string;
  frame: number;
  x: number;
  y: number;
}

export interface OutdoorScene {
  decor: OutdoorBlit[];
  horizon: OutdoorBlit[];
}

const BUNDLE_N = [0, 1, 255, 0, 1, 0];
const BUNDLE_E = [1, 0, 0, 1, 0, 255];
const BUNDLE_S = [0, 255, 1, 0, 255, 0];
const BUNDLE_W = [255, 0, 0, 255, 0, 1];
const BUNDLES = [BUNDLE_N, BUNDLE_E, BUNDLE_S, BUNDLE_W];

const HORIZON_SHEETS = ['outdoor1', 'outdoor2', 'outdoor3'];

/** Terrain id -> horizon class (0 none, 1-3 = outdoor1-3 lanes). Vendored from Vairn's walker bundle. */
export const TERRAIN_LOOKUP = [
  0, 1, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0,
  0, 0, 0, 0, 6, 60, 15, 92, 18, 134, 24, 68, 30, 128, 253, 0, 0, 64, 0, 32, 255, 255, 48, 48,
  46, 97, 110, 109, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 48, 48, 48, 75, 0, 0, 0, 156, 174, 0, 0, 156, 204,
  0, 0, 156, 235, 0, 0, 157, 18, 0, 0, 157, 57, 0, 0, 157, 84, 0, 2, 0, 0, 1, 0, 0, 0, 0, 200,
  0, 0, 5, 220, 0, 0, 1, 244, 0, 0, 7, 208, 0, 0, 19, 136, 0, 0, 11, 184, 0, 0, 27, 88, 0, 0,
  58, 152, 0, 0, 39, 16, 0, 0, 78, 32, 0, 0, 195, 80, 0, 0, 117, 48, 5, 5, 5, 5, 5, 5, 6, 6,
  6, 6, 6, 6, 1, 2, 4, 8, 16, 32, 32, 64, 1, 2, 4, 8, 10, 17, 24, 10, 17, 24, 20, 20, 20, 21,
  21, 21, 5, 9, 12, 15, 6, 10, 13, 16, 7, 11, 14, 38, 8, 34, 36, 39, 33, 35, 37, 40, 0, 20, 0,
  40, 0, 60, 0, 80, 0, 93, 0, 94, 0, 100, 0, 120, 0, 130,
];

const TERRAIN_BIOME: Record<number, string> = { 2: 'ocean', 3: 'ocean' };
/** Vairn: the game's biome labels point at different art than their names. */
const BIOME_REMAP: Record<string, string> = { desert: 'ocean', ocean: 'tundra', tundra: 'desert' };

const DECOR_Y = [0x80 - 20, 0x80 - 35, 0x80 - 50, 0x80 - 60];
const DECOR_X = 8;
const DECOR_X_112 = 0x70;
const DECOR_X_BDE = [184, 160, 136, 112];

const L1_Y = [21, 21, 42, 50];
const L1_X = [40, 40, 64, 88];
const L1_FRAME = [0, 0, 1, 2];
const L2_Y = [36, 46, 50, 58];
const L2_X = [8, 16, 32, 88];
const L2_FRAME = [4, 5, 2, 3];
const L3_Y = [36, 46, 50, 58];
const L3_X = [176, 152, 136, 120];
const L3_FRAME = [6, 7, 2, 3];

function sb(bundle: number[], i: number): number {
  const v = bundle[i] & 0xff;
  return v > 127 ? v - 256 : v;
}

function facingMask(facing: number): number {
  return [0xc0, 0x30, 0x0c, 0x03][facing & 3];
}

function remapBiome(sheet: string): string {
  return BIOME_REMAP[sheet] ?? sheet;
}

/** Stitched outdoor grid: reads the terrain page across neighbour screens. */
export class StitchedOutdoor {
  private readonly screen: number;
  private readonly screens: ScreenLike[];
  private readonly pageByScreen: Record<number, Uint8Array | number[]> = {};

  constructor(screens: ScreenLike[], screenId: number) {
    this.screen = screenId;
    this.screens = screens;
    this.pageByScreen[screenId] = screens[screenId].visual;
    const rec = screens[screenId];
    for (let slot = 0; slot < 4; slot++) {
      const n = this.neighborId(rec, slot);
      if (n >= 0 && n < screens.length) this.pageByScreen[n] = screens[n].visual;
    }
  }

  private neighborId(rec: ScreenLike, slot: number): number {
    const n = rec.neighbors[slot];
    return n >= 0 && n < this.screens.length ? n : rec.index;
  }

  private neighborOf(screen: number, slot: number): number {
    const n = this.screens[screen].neighbors[slot];
    return n >= 0 && n < this.screens.length ? n : screen;
  }

  private resolve(x: number, y: number): { page: Uint8Array | number[]; screen: number; lx: number; ly: number } {
    let screen = this.screen;
    let lx = x;
    let ly = y;
    if (lx < 0) {
      screen = this.neighborOf(screen, 3);
      lx += MAP_GRID;
    } else if (lx >= MAP_GRID) {
      screen = this.neighborOf(screen, 1);
      lx -= MAP_GRID;
    }
    if (ly < 0) {
      screen = this.neighborOf(screen, 2);
      ly += MAP_GRID;
    } else if (ly >= MAP_GRID) {
      screen = this.neighborOf(screen, 0);
      ly -= MAP_GRID;
    }
    const page = this.pageByScreen[screen] ?? new Array<number>(MAP_PAGE_SIZE).fill(0);
    return { page, screen, lx, ly };
  }

  screenIdAt(x: number, y: number): number {
    return this.resolve(x, y).screen;
  }

  at(x: number, y: number): number {
    const { page, lx, ly } = this.resolve(x, y);
    if (lx < 0 || ly < 0 || lx >= MAP_GRID || ly >= MAP_GRID) return 0;
    return page[(ly << 4) | lx];
  }
}

function refreshOutdoorHood(grid: StitchedOutdoor, px: number, py: number, facing: number): number[] {
  const hood = new Array<number>(13).fill(0);
  const b = BUNDLES[facing & 3];
  const dx = sb(b, 0);
  const dy = sb(b, 1);

  function row(sx: number, sy: number, outOff: number): void {
    let x = sx;
    let y = sy;
    for (let i = 0; i < 5; i++) {
      hood[outOff + i] = grid.at(x, y);
      x += dx;
      y += dy;
    }
  }

  row(px, py, 0);
  row(px + sb(b, 2), py + sb(b, 3), 4);
  row(px + sb(b, 4), py + sb(b, 5), 8);
  return hood;
}

function processTerrainRows(rows: number[][], currentCell: number, facing: number): [number[], number[], number[]] {
  const c6 = rows[0].map((b) => TERRAIN_LOOKUP[b & 0x1f] ?? 0);
  const c2 = rows[1].map((b) => TERRAIN_LOOKUP[b & 0x1f] ?? 0);
  const be = rows[2].map((b) => TERRAIN_LOOKUP[b & 0x1f] ?? 0);
  const near = c6[0];
  if (near >= 1 && near <= 3) {
    const fwd = facingMask(facing);
    const left = fwd === 0xc0 ? 0x03 : (fwd << 2) & 0xff;
    const right = fwd === 0x03 ? 0xc0 : fwd >> 2;
    if ((currentCell & left & 0x55) !== 0) c2[0] = near;
    if ((currentCell & right & 0x55) !== 0) be[0] = near;
    if ((currentCell & fwd & 0x55) === 0) c6[0] = 0;
  }
  return [c6, c2, be];
}

/** Per-screen biome sheet from the attrib surface byte (0xCC ocean, 0x99 tundra, 0xBB swamp, else desert). */
export function biomeForSurface(surface: number): string {
  if (surface === 0xcc) return 'ocean';
  if (surface === 0x99) return 'tundra';
  if (surface === 0xbb) return 'swamp';
  return 'desert';
}

function biomeForCell(mapByte: number, surface: number): string {
  const tid = mapByte & 0x1f;
  if (tid in TERRAIN_BIOME) return remapBiome(TERRAIN_BIOME[tid]);
  return remapBiome(biomeForSurface(surface));
}

function columnBiomes(grid: StitchedOutdoor, px: number, py: number, facing: number, screens: ScreenLike[]): string[] {
  const b = BUNDLES[facing & 3];
  const dx = sb(b, 0);
  const dy = sb(b, 1);
  const out: string[] = [];
  for (let col = 0; col < 4; col++) {
    const wx = px + col * dx;
    const wy = py + col * dy;
    const sid = grid.screenIdAt(wx, wy);
    const cell = grid.at(wx, wy);
    out.push(biomeForCell(cell, screens[sid].surface ?? 0));
  }
  return out;
}

function buildDecorBlits(c6: number[], laneL2: number[], laneL3: number[], colBiomes: string[]): OutdoorBlit[] {
  const blits: OutdoorBlit[] = [];
  for (let col = 3; col >= 0; col--) {
    const biome = colBiomes[col] ?? 'desert';
    const mainA = c6[col] > 3;
    const mainB = laneL2[col] > 3;
    const mainC = laneL3[col] > 3;
    const y = DECOR_Y[col];
    if (mainA) {
      blits.push({ sheet: biome, frame: col, x: DECOR_X, y });
      if (mainB) blits.push({ sheet: biome, frame: col + 12, x: DECOR_X, y });
      if (mainC) blits.push({ sheet: biome, frame: col + 16, x: DECOR_X_BDE[col] - ORIGIN_X, y });
    } else {
      if (mainB) blits.push({ sheet: biome, frame: col + 4, x: DECOR_X, y });
      if (mainC) blits.push({ sheet: biome, frame: col + 8, x: DECOR_X_112, y });
    }
  }
  return blits;
}

function horizonIndex(terrainClass: number): number {
  if (terrainClass <= 0 || terrainClass > 3) return 0xff;
  return terrainClass - 1;
}

function horizonSprite(idx: number, frame: number, x: number, y: number): OutdoorBlit | null {
  if (idx === 0xff || idx < 0 || idx >= HORIZON_SHEETS.length) return null;
  return { sheet: HORIZON_SHEETS[idx], frame, x, y };
}

function buildHorizonBlits(c6: number[], laneL2: number[], laneL3: number[]): OutdoorBlit[] {
  const l1 = c6.slice(0, 4).map((c) => horizonIndex(c));
  const l2 = laneL2.slice(0, 4).map((c) => horizonIndex(c));
  const l3 = laneL3.slice(0, 4).map((c) => horizonIndex(c));
  let start = 4;
  for (let col = 0; col < 4; col++) {
    if (l1[col] !== 0xff) {
      start = col;
      break;
    }
  }
  let pivot = start === 3 && l1[start] === 0xff ? 3 : start;
  const blits: OutdoorBlit[] = [];

  if (start < 4 && l1[start] !== 0xff) {
    const b = horizonSprite(l1[start], L1_FRAME[start], L1_X[start], L1_Y[start]);
    if (b) blits.push(b);
  } else if (start === 4) {
    pivot = 3;
  }

  function passL2(col: number, piv: number): void {
    const special = col !== 0 && col === piv && l1[col] !== 0xff;
    if (special && l2[col - 1] !== 0xff) l2[col] = 0xff;
    if (l2[col] === 0xff) return;
    let frame = L2_FRAME[col];
    let x = L2_X[col];
    let y = L2_Y[col];
    if (special && l2[piv] !== 0xff) {
      frame = L2_FRAME[piv - 1];
      x = L2_X[piv - 1];
      y = L1_Y[piv];
    }
    if (col === 1 && l2[0] === 0xff) x = 8;
    if (col === 1 || (col === 2 && col === piv)) x = 8;
    const b = horizonSprite(l2[col], frame, x, y);
    if (b) blits.push(b);
  }

  function passL3(col: number, piv: number): void {
    const special = col !== 0 && col === piv && l1[col] !== 0xff;
    if (special && l3[col - 1] !== 0xff) l3[col] = 0xff;
    if (l3[col] === 0xff) return;
    let frame = L3_FRAME[col];
    let x = L3_X[col];
    let y = L3_Y[col];
    if (special && l3[piv] !== 0xff) {
      frame = L3_FRAME[piv - 1];
      x = L3_X[piv - 1];
      y = L1_Y[piv];
    }
    if (col === 1 && l3[0] === 0xff) x = col === piv ? 0xb0 : 0x98;
    const b = horizonSprite(l3[col], frame, x, y);
    if (b) blits.push(b);
  }

  for (let col = pivot; col >= 0; col--) passL2(col, pivot);
  for (let col = pivot; col >= 0; col--) passL3(col, pivot);
  return blits;
}

export function buildOutdoorScene(
  grid: StitchedOutdoor,
  px: number,
  py: number,
  facing: number,
  screens: ScreenLike[],
): OutdoorScene {
  const hood = refreshOutdoorHood(grid, px, py, facing);
  const rows = [hood.slice(0, 5), hood.slice(4, 9), hood.slice(8, 13)];
  const [c6, laneL2, laneL3] = processTerrainRows(rows, grid.at(px, py), facing);
  const colBio = columnBiomes(grid, px, py, facing, screens);
  return {
    decor: buildDecorBlits(c6, laneL2, laneL3, colBio),
    horizon: buildHorizonBlits(c6, laneL2, laneL3),
  };
}
