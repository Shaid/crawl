/**
 * Hired Guns (Amiga) first-person view compositor — browser-safe.
 *
 * Re-implements the game's `blit_view` (retail exe, RNC1-unpacked `Hired Guns`, file
 * 0x85FC; the CD32 dev-archive `Sources/Drawviews.s` is the readable oracle) from the
 * game's own tables, which the exporter copies out of the retail executable:
 *
 *  - 67 view positions per facing (`north`/`east`/`south`/`west`, file 0x188FC, 4 x 67
 *    longs of byte deltas): far-to-near rows at depth 4..0, each row = 5 cells of the
 *    layer above (z+1), 5 of the layer below (z-1), then 7/7/5/3/3 cells of the eye layer,
 *    outermost columns first. Position 66 is the party's own cell.
 *  - `view_offsets` (file 0x1740A): view position -> placement index in a graphic record.
 *    Placements 0..20 are the layer above (drawn from the record's "above" branch),
 *    21..45 the eye layer, 46..66 the layer below (the same images, vertically flipped).
 *  - `block_removal` (file 0x17624): per position, up to 8 lists of positions that, when
 *    all opaque, hide it (`scan_view`).
 *  - `block_rotations`/`aux_rotations` (file 0x8E8E / 0x8FA2): facing-relative graphic
 *    choice for directional blocks (doors, stairs, monsters) and aux objects.
 *  - the gap tables of `blit_block`'s split path (lifts/fields), and the 32-colour
 *    `game_palette` (file 0x1F996).
 *
 * Graphic selection (retail `gamegfx` table offsets in blit_view): floor type f ->
 * Style entry f, block b -> 4+b (b <= 21), panel p -> 28+p, aux a -> 31+a;
 * water level w -> Misc.gfx entry 16+w drawn into bitplane 4 only (the blue re-tint).
 *
 * Not drawn (TODO hg-view-objects): players' heads (blocks 32..47), grenades/explosions
 * (Misc/exgfx), skeleton remains (aux 7), the text-panel overlay, horizons and the planet.
 * Monster blocks (8..15) draw only if their figure was loaded into the bank.
 */
import { type GfxBank, type GfxRecord, type Placement, VIEW_POSITIONS } from './gfxbank.ts';
import {
  AUX_HERE, BLOCK_HERE, CELLS, FLOOR_HERE, INVISIBLE, OPAQUE, PANEL_HERE, WATER_HERE,
  auxOf, blockOf, floorOf, panelOf, variantOf, waterOf,
} from './map.ts';

export const VIEW_W = 142;
export const VIEW_H = 84;
/** Rows the sky backdrop covers (skyline_window: 56 lines from the window top, view starts 14 lower). */
export const SKY_ROWS = 42;
const PLANES_NORMAL = 0x1f; // retail redraw_temp for blocks/floors/aux (5 bitplanes)
const PLANES_WATER = 0x30;

/** Style-bank entry bases (retail `gamegfx`: floor 0x46A08, block +0x10, panel +0x70, aux +0x7C). */
export const ENTRY = { FLOOR: 0, BLOCK: 4, PANEL: 28, AUX: 31 } as const;
/** Misc.gfx water entry base (retail miscgfx 0x15CF0, water_addresses 0x15D30). */
export const MISC_WATER = 16;

export interface HgViewTables {
  /** view position -> placement index (67). */
  viewBob: number[];
  /** [facing][position] signed cell delta (byte delta / 4). */
  dirOffsets: number[][];
  /** [position][case][4] view positions (-1 = end), from block_removal. */
  removal: number[][][];
  /** 4 x 64 block rotation bytes. */
  blockRot: number[];
  /** 4 x 16 aux rotation bytes. */
  auxRot: number[];
  /** blit_block split gaps by distance: [dist1, dist2, dist3, dist4], 11 bytes each. */
  gapDist: number[][];
  /** 32 colours as Amiga $0RGB words. */
  palette: number[];
}

export interface HgViewInputs {
  cells: Uint32Array;
  sky4: Uint8Array;
  style: GfxBank;
  misc?: GfxBank | null;
  tables: HgViewTables;
}

export interface HgFrame {
  /** 5-bit colour index per pixel. */
  index: Uint8Array;
  /** true where the sky backdrop shows (index is 6 there, recoloured by the copper sky). */
  sky: boolean;
}

/** Cell value at a flat index, 0 outside the cube (the files' zero "safety nets"). */
function at(cells: Uint32Array, i: number): number {
  return i >= 0 && i < CELLS ? cells[i]! : 0;
}

/** The 67 view cells for a pose after `scan_view` hidden-block removal (exported for tests). */
export function scanView(inp: HgViewInputs, cellIdx: number, facing: number): number[] {
  const offs = inp.tables.dirOffsets[facing & 3]!;
  const view = offs.map((d) => at(inp.cells, cellIdx + d));
  const opaque = (p: number) => (view[p]! & OPAQUE) !== 0;
  for (let i = 0; i < VIEW_POSITIONS; i++) {
    for (const cs of inp.tables.removal[i] ?? []) {
      if (cs[0]! < 0) break; // end of this position's cases: stays visible
      let hidden = true;
      for (let k = 0; k < 4; k++) {
        const p = cs[k]!;
        if (p < 0) break; // all listed so far opaque -> invisible
        if (!opaque(p)) { hidden = false; break; }
      }
      if (hidden) { view[i] = INVISIBLE; break; }
    }
  }
  return view;
}

class Painter {
  readonly index = new Uint8Array(VIEW_W * VIEW_H);
  clipTop = 0;
  clipBottom = VIEW_H;
  readonly tables: HgViewTables;
  constructor(tables: HgViewTables) { this.tables = tables; }

  private bobPixels(bank: GfxBank, rec: GfxRecord, b: Placement, x: number, y: number, flip: boolean, planes: number): void {
    const bpr = b.w >> 3;
    const psize = bpr * b.h;
    const base = rec.offset + b.data;
    const d = bank.data;
    if (base + psize > d.length) return;
    const ops = rec.planeOps;
    const mp = rec.maskPlane;
    const bit = (plane: number, row: number, col: number): number => {
      const o = base + plane * psize + row * bpr + (col >> 3);
      return o < d.length ? (d[o]! >> (7 - (col & 7))) & 1 : 0;
    };
    for (let r = 0; r < b.h; r++) {
      const dy = y + r;
      if (dy < this.clipTop || dy >= this.clipBottom || dy < 0 || dy >= VIEW_H) continue;
      const sr = flip ? b.h - 1 - r : r;
      for (let c = 0; c < b.w; c++) {
        const dx = x + c;
        if (dx < 0 || dx >= VIEW_W) continue;
        if (mp < 6 && !bit(mp, sr, c)) continue;
        const pi = dy * VIEW_W + dx;
        let v = this.index[pi]!;
        for (let k = 0; k < 5; k++) {
          if (!((planes >> k) & 1)) continue;
          const op = ops[k]!;
          if (op === 1) v = bit(k, sr, c) ? v | (1 << k) : v & ~(1 << k);
          else if (op === 2 || op === 4) v &= ~(1 << k);
          else if (op === 3) v |= 1 << k;
        }
        this.index[pi] = v;
      }
    }
  }

  /** blit_block: placement control decides plain / flipped / mirrored pair / split pair. */
  blit(bank: GfxBank, rec: GfxRecord, b: Placement, cell: number, pos: number, planes = PLANES_NORMAL): void {
    const c = b.control;
    if (c === 3 || b.w <= 0 || b.h <= 0) return;
    let y = b.y;
    const x = b.x;
    if (c === -1) { this.bobPixels(bank, rec, b, x, y, false, planes); return; } // random flip: drawn unflipped here
    if (c <= 3) {
      if (c === 2) { this.bobPixels(bank, rec, b, x, y, false, planes); this.bobPixels(bank, rec, b, x, y + b.h, true, planes); }
      else this.bobPixels(bank, rec, b, x, y, c === 1, planes);
      return;
    }
    const saved = [this.clipTop, this.clipBottom];
    let gap = 0;
    const variant = (cell & 0xff) !== 0 ? variantOf(cell) : 0;
    if (variant !== 0) {
      let bottom = y + 52;
      const g = this.tables.gapDist;
      let tab: number[];
      if (pos <= 16) { tab = g[3]!; bottom -= 38; } else if (pos <= 33) { tab = g[2]!; bottom -= 30; } else if (pos <= 48) { tab = g[1]!; bottom -= 22; } else tab = g[0]!;
      gap = tab[Math.min(variant, tab.length - 1)] ?? 0;
      this.clipTop = Math.max(this.clipTop, y);
      this.clipBottom = Math.min(this.clipBottom, bottom);
    }
    y -= gap;
    this.bobPixels(bank, rec, b, x, y, false, planes);
    this.bobPixels(bank, rec, b, x, y + c + 2 * gap, true, planes);
    [this.clipTop, this.clipBottom] = saved as [number, number];
  }
}

function draw(p: Painter, bank: GfxBank | null | undefined, entry: number, bobIdx: number, cell: number, pos: number, planes?: number): void {
  const rec = bank?.records[entry];
  if (!bank || !rec) return;
  const b = rec.bobs[bobIdx];
  if (!b) return;
  p.blit(bank, rec, b, cell, pos, planes);
}

/** Compose one first-person view. `cellIdx` = party cell (z*529+y*23+x). */
export function renderView(inp: HgViewInputs, cellIdx: number, facing: number): HgFrame {
  const t = inp.tables;
  const dir = facing & 3;
  const view = scanView(inp, cellIdx, dir);
  const p = new Painter(t);
  const sky = cellIdx >= 0 && cellIdx < CELLS && ((inp.sky4[cellIdx]! >> dir) & 1) === 1;
  if (sky) p.index.fill(6, 0, SKY_ROWS * VIEW_W); // skyline_window: colour 6 down to the horizon, black below
  const S = inp.style;
  const auxRot = (a: number) => t.auxRot[dir * 16 + a] ?? a;
  const blockRot = (b: number) => t.blockRot[dir * 64 + b] ?? b;
  for (let i = 0; i < VIEW_POSITIONS; i++) {
    const v = view[i]!;
    if (v & INVISIBLE) continue;
    const bob = t.viewBob[i]!;
    const a = auxOf(v);
    if (bob <= 20) {
      // layer above: aux, block, panel, water, floor
      if (v & AUX_HERE && a !== 7) draw(p, S, ENTRY.AUX + auxRot(a), bob, 0, i);
      if (v & BLOCK_HERE) { const b = blockRot(blockOf(v)); if (b <= 21) draw(p, S, ENTRY.BLOCK + b, bob, v, i); }
      if (v & PANEL_HERE) draw(p, S, ENTRY.PANEL + blockRot(panelOf(v)), bob, 0, i);
      if (v & WATER_HERE) draw(p, inp.misc, MISC_WATER + waterOf(v), bob, 0, i, PLANES_WATER);
      if (v & FLOOR_HERE) draw(p, S, ENTRY.FLOOR + floorOf(v), bob, v, i);
      continue;
    }
    // eye layer and layer below: floor, aux, shallow water, block, panel, own-cell objects, deep water
    if (v & FLOOR_HERE) draw(p, S, ENTRY.FLOOR + floorOf(v), bob, v, i);
    const ownCellObject = i === VIEW_POSITIONS - 1 && a >= 2 && a <= 7;
    if (v & AUX_HERE && !ownCellObject && a !== 7) draw(p, S, ENTRY.AUX + auxRot(a), bob, 0, i);
    if (v & WATER_HERE && waterOf(v) !== 3) draw(p, inp.misc, MISC_WATER + waterOf(v), bob, 0, i, PLANES_WATER);
    if (v & BLOCK_HERE) { const b = blockRot(blockOf(v)); if (b <= 21) draw(p, S, ENTRY.BLOCK + b, bob, v, i); }
    if (v & PANEL_HERE) draw(p, S, ENTRY.PANEL + panelOf(v), bob, 0, i);
    if (v & AUX_HERE && ownCellObject && a !== 7) draw(p, S, ENTRY.AUX + auxRot(a), bob, 0, i);
    if (v & WATER_HERE && waterOf(v) === 3) draw(p, inp.misc, MISC_WATER + 3, bob, 0, i, PLANES_WATER);
  }
  return { index: p.index, sky };
}

/** Amiga $0RGB -> [r,g,b] (nibble x 17). */
export function rgb12(w: number): [number, number, number] {
  return [((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17];
}

/**
 * Sky gradient for colour 6 on the sky rows. HYPOTHESIS: the floppy copper sky table is
 * not decoded (TODO hg-sky-copper); this is a neutral blue ramp, not the game's colours.
 */
export function skyColour(row: number): [number, number, number] {
  const t = row / (SKY_ROWS - 1);
  return [Math.round(60 + 90 * t), Math.round(90 + 90 * t), Math.round(170 + 60 * t)];
}

export function frameToRGBA(f: HgFrame, palette: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(VIEW_W * VIEW_H * 4);
  const pal = palette.map(rgb12);
  for (let i = 0; i < f.index.length; i++) {
    const ix = f.index[i]!;
    const row = (i / VIEW_W) | 0;
    const c = f.sky && ix === 6 && row < SKY_ROWS ? skyColour(row) : pal[ix] ?? [255, 0, 255];
    out[4 * i] = c[0]; out[4 * i + 1] = c[1]; out[4 * i + 2] = c[2]; out[4 * i + 3] = 255;
  }
  return out;
}
