/**
 * Crystal Dragon (Amiga) first-person view: pure renderer + movement rules shared by the walker
 * view (tools/walker/games-crystaldragon.ts), the exporter and the tests.
 *
 * Sources (hunk-0 offsets in `Crystal_Dragon`; spec docs/crystaldragon/amiga/data-structure.md
 * "First-person renderer"):
 *   +0x1E0B4  view-cell builder: 12 cells, row-major 3 wide x 4 deep, row 0 = the party's row,
 *             column 0 = left. Facing 0..3 = N, S, E, W; north is +y, east is +x.
 *   +0x1E1A0  step parity `1158(A5)` = (facing>>1 + area id + x + y) & 1 picks the second view
 *             set of two-set slot tables.
 *   +0x1E518  floor (slot 4 + ((w0>>3)&3)) and ceiling (slot 8 + ((w0>>5)&3)) per open cell, 11..0.
 *   +0x1F972  wall face: table +0x205EC gives (cell, relative side) per wall position; the face's
 *             variant is (w0 >> (8 + 2*absFace)) & 3 -> slot 0..3 (empty slot falls back to 0).
 *   +0x14290  slot draw: frame from the slot table, blitted at (x, y) of the view.
 * Hypotheses (not traced, labelled in the walker): painter order instead of the game's occlusion
 * bitmasks (+0x1E3EC..+0x1E516); the 22 clipped alternates (positions 17-38) are not used; open
 * cell types; what lies beyond row 3 (drawn black).
 */
import type { CdFrame, SlotTable } from './sets.ts';
import { TRANSPARENT } from './sets.ts';

export const VIEW_X0 = 9;
export const VIEW_W = 146;
export const VIEW_H = 116;

/** Game facings: 0 = N (+y), 1 = S, 2 = E (+x), 3 = W. */
export type CdFacing = 0 | 1 | 2 | 3;
export const FWD: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** left of each facing (+0x1E12E `LAB_1594`) */
export const LEFT: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, 1], [0, -1]];
/** game facing after a right turn (N -> E -> S -> W) */
export const TURN_R: readonly CdFacing[] = [2, 3, 1, 0];
export const TURN_L: readonly CdFacing[] = [3, 2, 0, 1];

/** wall position -> (view cell, relative side), table at +0x205EC; 17 primary positions */
export const WALL_POS: ReadonlyArray<readonly [number, number]> = [
  [0, 2], [2, 3], [3, 1], [4, 1], [5, 1], [3, 2], [5, 3], [6, 1], [7, 1], [8, 1], [6, 2], [8, 3], [9, 1], [10, 1], [11, 1], [9, 2], [11, 3],
];
/** painter order: far row side faces, far row fronts, ... nearest side faces */
export const WALL_ORDER = [15, 16, 12, 13, 14, 10, 11, 7, 8, 9, 5, 6, 2, 3, 4, 0, 1];

export interface CdArea {
  id: number; x0: number; y0: number; w: number; h: number;
  /** effective word0 per cell (row-major from y0), redirect records already followed */
  cells: number[];
}

/** Cell word0 at absolute (x, y); undefined outside the area = solid (the lookup +0x146C8 fails). */
export function cellAt(area: CdArea, x: number, y: number): number | undefined {
  const cx = x - area.x0, cy = y - area.y0;
  if (cx < 0 || cy < 0 || cx >= area.w || cy >= area.h) return undefined;
  return area.cells[cy * area.w + cx];
}

/** Wall-drawn cell: outside, plain rock (word0 == 5), type 1/3 (classification +0x1E234). */
export function isWallCell(w0: number | undefined): boolean {
  if (w0 === undefined) return true;
  const t = w0 & 7;
  return t === 5 || t === 1 || t === 3;
}

/** Pillar-type cell (type 1 with bit 7): drawn through the wall positions but does not occlude
 *  (+0x1E242 skips the blocking bit), so floor/ceiling and farther cells stay visible. */
export function isSeeThrough(w0: number | undefined): boolean {
  return w0 !== undefined && (w0 & 7) === 1 && (w0 & 0x80) !== 0;
}

/** Movement: hypothesis = everything not drawn as a wall is walkable (doors are not modelled). */
export function canEnter(area: CdArea, x: number, y: number): boolean {
  return !isWallCell(cellAt(area, x, y));
}

/** Absolute face (0..3 = N, S, E, W) of a relative side seen while facing `facing` (+0x1F988). */
export function absFace(side: number, facing: number): number {
  let d3 = side ^ facing;
  if ((side & facing) & 2) d3 ^= 1;
  return d3;
}

export function viewCells(area: CdArea, x: number, y: number, facing: CdFacing): Array<number | undefined> {
  const [fx, fy] = FWD[facing]!, [lx, ly] = LEFT[facing]!;
  const out: Array<number | undefined> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const side = c - 1; // -1 left, +1 right
    out.push(cellAt(area, x + fx * r - lx * side, y + fy * r - ly * side));
  }
  return out;
}

export interface CdSlot { frames: CdFrame[]; table: SlotTable; remap: boolean }
/** slots 0-3 walls (wall/pillar sets), 4-7 floors, 8-11 ceilings; null = empty slot */
export type CdSlots = Array<CdSlot | null>;

/** Plane remap for a slot whose set name repeats an earlier slot of the level (+0x14446). */
function remapIndex(c: number): number { return (c & 3) | (((c >> 3) & 1) << 2) | 16; }

function blit(out: Uint8Array, slot: CdSlot, pos: number, parity: number): void {
  const t = slot.table;
  const p = t.sets === 2 && parity ? pos + t.npos : pos;
  const fw = t.frame[p];
  if (fw === undefined || fw < 0) return;
  const f = slot.frames[fw >> 2];
  if (!f) return;
  const ox = t.x[p]! - VIEW_X0, oy = t.y[p]!;
  for (let y = 0; y < f.h; y++) {
    const vy = oy + y;
    if (vy < 0 || vy >= VIEW_H) continue;
    for (let x = 0; x < f.stride; x++) {
      const c = f.px[y * f.stride + x]!;
      if (c === TRANSPARENT) continue;
      const vx = ox + x;
      if (vx < 0 || vx >= VIEW_W) continue;
      out[vy * VIEW_W + vx] = slot.remap ? remapIndex(c) : c;
    }
  }
}

function pick(slots: CdSlots, base: number, variant: number): CdSlot | null {
  return slots[base + variant] ?? slots[base] ?? null;
}

/** Render the 146x116 indexed view (palette indices 0-31). */
export function renderView(area: CdArea, slots: CdSlots, x: number, y: number, facing: CdFacing): Uint8Array {
  const out = new Uint8Array(VIEW_W * VIEW_H);
  const cells = viewCells(area, x, y, facing);
  const parity = ((facing >> 1) + area.id + x + y) & 1;
  for (let i = 11; i >= 0; i--) {
    const w0 = cells[i];
    if (isWallCell(w0) && !isSeeThrough(w0)) continue;
    const fs = pick(slots, 4, (w0! >> 3) & 3);
    if (fs) blit(out, fs, i, parity);
    const cs = pick(slots, 8, (w0! >> 5) & 3);
    if (cs) blit(out, cs, i, parity);
  }
  for (const p of WALL_ORDER) {
    const [ci, side] = WALL_POS[p]!;
    const w0 = cells[ci];
    if (!isWallCell(w0)) continue;
    const face = absFace(side, facing);
    const variant = w0 === undefined ? 0 : (w0 >> (8 + 2 * face)) & 3;
    const ws = pick(slots, 0, variant);
    if (ws) blit(out, ws, p, parity);
  }
  return out;
}

export function paletteRGB(words: number[]): Array<[number, number, number]> {
  return words.map((c) => [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17]);
}
