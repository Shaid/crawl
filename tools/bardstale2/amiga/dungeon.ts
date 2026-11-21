/**
 * Bard's Tale II (Amiga) dungeon: level records, view art and the view compositor.
 *
 * Everything is taken from the game's own code (`data/bard`, the HUNK_OVERLAY executable; the
 * dungeon loop lives in overlay group 4, hunks 150..161 of the overlay table, flattened by a
 * ~60-line hunk flattener the same way as BT1):
 *   - view-row builder   `0x5ec76` (+ helpers `0x5f2d4` front/side value, `0x5f32c` face value,
 *                        `0x5f3ae` flag read) -- the SAME algorithm as BT1's `0x80dea`, so the
 *                        shared `buildViewRows` / `canMoveForward` / `stepForward` of
 *                        `tools/bardstale1/amiga/dungeon.ts` are reused;
 *   - draw loop          `0x5f49a` (rows far->near; per row left cols 2..0, right cols 4..6,
 *                        centre column afterwards; a side wall stops that side's loop);
 *   - piece draw fns     marks `0x60700`, front wall/door `0x60826`, side wall/door `0x6092c`,
 *                        all table driven;
 *   - bitmap carve-up    `0x60a32` (sequential 4-plane bitmaps, aliases at `0x60b12`/`0x60c6c`);
 *   - background copy    `0x5f7a0` (7-byte half row duplicated to both halves).
 * Tables live in the overlay data hunk at flat `0x60e00` = `big_dung`-name table; file offsets below are
 * `data/bard` offsets (`flat - 0x60e00 + 0x355f0`).
 *
 * Level record = 3,072 B (25 per `levs`): walls @0x000 (22x22, `a*22+b`, 2 bits per face N,S,E,W as in
 * BT1), flags @0x200, second byte grid @0x400 (read together with the flags by `0x5f3ae`, high
 * byte ignored by the view), name @0x600 (high-bit ASCII, `0xff` terminated).
 */
import {
  GRID,
  VIEW_W,
  VIEW_H,
  type LevelData,
  buildViewRows,
  canMoveForward,
  stepForward,
  indexedToRGBA,
  wrap,
} from '../../bardstale1/amiga/dungeon.ts';

export { GRID, VIEW_W, VIEW_H, buildViewRows, canMoveForward, stepForward, indexedToRGBA, wrap };
export type { LevelData };

export const LEVEL_SIZE = 3072;
export const LEVEL_COUNT = 25;

/** Rect = [x0, y0, x1, y1] inclusive. */
export type Rect = [number, number, number, number];

// ---------------- data tables (data/bard overlay group 4, hunk "D" at flat 0x60e00) ----------------
// A = floor/ceiling marks (`0x60700`); index = col'*5 + depth, col' = 0..3 (mirrored), -1 = none.
export const A_TAB = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, 4, 5, -1, -1, 0, 1, 2, -1];
export const A_DEST: Rect[] = [[48, 72, 63, 78], [48, 61, 63, 63], [48, 52, 63, 53], [0, 72, 7, 77], [8, 60, 23, 62], [24, 52, 39, 53]];
export const A_SRC: Rect[] = [[0, 0, 15, 6], [0, 0, 15, 2], [0, 0, 15, 1], [0, 0, 7, 5], [0, 0, 15, 2], [0, 0, 15, 1]];
export const A_PAD = [16, 16, 16, 8, 16, 16]; // 0x60ef0: bitmap bpr pad AND x offset of the ceiling variant
export const A_YOFF = [69, 43, 24, 68, 41, 24]; // 0x60efc: dest y shift for ceiling (flag 0x40)

// B = front wall / door (`0x60826`).
export const B_TAB = [-1, -1, -1, 10, -1, -1, -1, 8, 9, -1, 4, 5, 6, 7, -1, 0, 1, 2, 3, -1];
export const B_DEST: Rect[] = [[9, 0, 103, 85], [29, 13, 83, 66], [40, 24, 72, 56], [48, 33, 64, 49], [0, 0, 8, 85], [0, 13, 28, 66], [7, 24, 39, 56], [31, 33, 47, 49], [0, 24, 6, 56], [14, 33, 30, 49], [0, 33, 13, 49]];
export const B_SRC: Rect[] = [[1, 0, 95, 85], [5, 0, 59, 53], [0, 0, 32, 32], [0, 0, 16, 16], [87, 0, 95, 85], [31, 0, 59, 53], [0, 0, 32, 32], [0, 0, 16, 16], [26, 0, 32, 32], [0, 0, 16, 16], [3, 0, 16, 16]];
export const B_PAD = [96, 56, 40, 24, 96, 56, 40, 24, 40, 24, 24]; // 0x60fe0: wall variant x offset (door at 0)
/** Alias map for pieces without their own bitmap (`0x60b12`): piece -> allocated piece. */
export const B_ALIAS = [0, 1, 2, 3, 0, 1, 2, 3, 2, 3, 3];

// C = side wall / door (`0x6092c`).
export const C_TAB = [-1, -1, -1, 8, 9, -1, -1, 7, 5, 6, 0, 1, 2, 3, 4];
export const C_DEST: Rect[] = [[0, 0, 8, 87], [9, 0, 28, 84], [29, 14, 39, 65], [40, 25, 47, 55], [48, 34, 51, 48], [8, 24, 29, 55], [30, 32, 42, 49], [0, 21, 7, 60], [0, 24, 13, 55], [14, 32, 26, 49]];
export const C_SRC: Rect[] = [[0, 0, 8, 87], [1, 0, 20, 84], [5, 0, 15, 51], [0, 0, 7, 30], [0, 0, 3, 14], [0, 0, 21, 31], [6, 0, 18, 17], [0, 0, 7, 39], [8, 0, 21, 31], [6, 0, 18, 17]];
export const C_PAD = [16, 24, 16, 8, 8, 24, 16, 8, 24, 16]; // 0x610be
export const C_ALIAS = [0, 1, 2, 3, 4, 5, 6, 7, 5, 6]; // 0x60c6c: 8 -> 5, 9 -> 6

/** Bytes per row of a piece bitmap (`0x60a4e..`): ((x1 + pad + 16) / 16) * 2. */
const bprOf = (r: Rect, pad: number) => (((r[2] + pad + 16) >> 4) << 1);

export const BG_OFFSET = 32; // big_dung: 32 B palette, then 56x88x4 background (7 B rows)
export const BG_SIZE = 7 * 88 * 4; // 2,464 = 0x9a0 (the initial carve-up cursor)
export const PIECES_OFFSET = BG_OFFSET + BG_SIZE; // 2,496

export interface Bitmap {
  /** file offset inside decoded big_dung */
  offset: number;
  bpr: number;
  rows: number;
}

export interface Layout {
  a: Bitmap[]; // marks, 6
  b: Bitmap[]; // front, 11 (aliases resolved)
  c: Bitmap[]; // side, 10 (aliases resolved)
  end: number;
}

/** Re-derive the sequential carve-up of `0x60a32` (order: front, marks, side). */
export function bigDungLayout(): Layout {
  let cur = PIECES_OFFSET;
  const alloc = (r: Rect, pad: number): Bitmap => {
    const bpr = bprOf(r, pad);
    const rows = r[3] + 1;
    const bm = { offset: cur, bpr, rows };
    cur += bpr * rows * 4;
    return bm;
  };
  const b: Bitmap[] = [];
  for (let i = 0; i < 4; i++) b[i] = alloc(B_SRC[i]!, B_PAD[i]!);
  const bAll = B_SRC.map((r, i) => ({ ...b[B_ALIAS[i]!]!, bpr: bprOf(r, B_PAD[i]!), rows: r[3] + 1 }));
  const a = A_SRC.map((r, i) => alloc(r, A_PAD[i]!));
  const cOwn: Bitmap[] = [];
  for (let i = 0; i < 8; i++) cOwn[i] = alloc(C_SRC[i]!, C_PAD[i]!);
  const cAll = C_SRC.map((r, i) => ({ ...cOwn[C_ALIAS[i]!]!, bpr: bprOf(r, C_PAD[i]!), rows: r[3] + 1 }));
  return { a, b: bAll, c: cAll, end: cur };
}

export interface Plane4 {
  w: number;
  h: number;
  px: Uint8Array;
}

function decode4(data: Uint8Array, bm: Bitmap): Plane4 {
  const w = bm.bpr * 8;
  const px = new Uint8Array(w * bm.rows);
  const ps = bm.bpr * bm.rows;
  for (let p = 0; p < 4; p++)
    for (let y = 0; y < bm.rows; y++)
      for (let x = 0; x < w; x++) px[y * w + x]! |= ((data[bm.offset + p * ps + y * bm.bpr + (x >> 3)]! >> (7 - (x & 7))) & 1) << p;
  return { w, h: bm.rows, px };
}

export interface DungeonArt {
  palette: number[];
  background: Uint8Array; // 112x88 indices
  a: Plane4[];
  b: Plane4[];
  c: Plane4[];
}

export function buildArt(bigDung: Uint8Array): DungeonArt {
  const palette: number[] = [];
  for (let i = 0; i < 16; i++) palette.push((bigDung[i * 2]! << 8) | bigDung[i * 2 + 1]!);
  const half = decode4(bigDung, { offset: BG_OFFSET, bpr: 7, rows: 88 });
  const background = new Uint8Array(VIEW_W * VIEW_H);
  for (let y = 0; y < VIEW_H; y++)
    for (let x = 0; x < 56; x++) {
      background[y * VIEW_W + x] = half.px[y * 56 + x]!;
      background[y * VIEW_W + 56 + x] = half.px[y * 56 + x]!;
    }
  const lay = bigDungLayout();
  return { palette, background, a: lay.a.map((m) => decode4(bigDung, m)), b: lay.b.map((m) => decode4(bigDung, m)), c: lay.c.map((m) => decode4(bigDung, m)) };
}

// ---------------------------- compositor ----------------------------

/** `0x44e00`: opaque copy of src rect (inclusive) to (dx,dy), clipped to the view. */
function blit(dst: Uint8Array, p: Plane4, src: Rect, dx: number, dy: number): void {
  const w = src[2] - src[0] + 1;
  const h = src[3] - src[1] + 1;
  for (let j = 0; j < h; j++) {
    const y = dy + j;
    if (y < 0 || y >= VIEW_H) continue;
    for (let i = 0; i < w; i++) {
      const x = dx + i;
      const sx = src[0] + i;
      if (x < 0 || x >= VIEW_W || sx >= p.w || src[1] + j >= p.h) continue;
      dst[y * VIEW_W + x] = p.px[(src[1] + j) * p.w + sx]!;
    }
  }
}

const mirror = (col: number) => (col > 3 ? { e: 6 - col, xs: 56 } : { e: col, xs: 0 });

/** `0x60700` */
function drawMark(art: DungeonArt, dst: Uint8Array, depth: number, col: number, v: number): void {
  const { e, xs } = mirror(col);
  const p = A_TAB[e * 5 + depth] ?? -1;
  if (p < 0) return;
  const ceil = (v & 0x40) !== 0;
  const sx = ceil ? A_PAD[p]! : 0;
  const yo = ceil ? A_YOFF[p]! : 0;
  const r = A_SRC[p]!;
  blit(dst, art.a[p]!, [r[0] + sx, r[1], r[2] + sx, r[3]], A_DEST[p]![0] + xs, A_DEST[p]![1] - yo);
}

/** `0x60826` */
function drawFront(art: DungeonArt, dst: Uint8Array, depth: number, col: number, door: boolean): void {
  const { e, xs } = mirror(col);
  const p = B_TAB[e * 5 + depth] ?? -1;
  if (p < 0) return;
  const sx = door ? 0 : B_PAD[p]!;
  const r = B_SRC[p]!;
  blit(dst, art.b[p]!, [r[0] + sx, r[1], r[2] + sx, r[3]], B_DEST[p]![0] + xs, B_DEST[p]![1]);
}

/** `0x6092c` */
function drawSide(art: DungeonArt, dst: Uint8Array, depth: number, col: number, door: boolean): void {
  const { e, xs } = mirror(col);
  const p = C_TAB[e * 5 + depth] ?? -1;
  if (p < 0) return;
  const sx = door ? 0 : C_PAD[p]!;
  const r = C_SRC[p]!;
  blit(dst, art.c[p]!, [r[0] + sx, r[1], r[2] + sx, r[3]], C_DEST[p]![0] + xs, C_DEST[p]![1]);
}

/**
 * `0x44ee0`: flips the right half (x 56..111) in place, bit-reversing each byte through the LUT at
 * `0x3d9ca` and swapping bytes 7..13 of every 14-byte row. Right-hand columns are drawn unmirrored at
 * x+56 (`mirror()` above) and end up on the right through this flip; the centre column is drawn after it.
 */
export function mirrorRightHalf(f: Uint8Array): void {
  for (let y = 0; y < VIEW_H; y++)
    for (let i = 0; i < 28; i++) {
      const a = y * VIEW_W + 56 + i;
      const b = y * VIEW_W + 111 - i;
      const t = f[a]!;
      f[a] = f[b]!;
      f[b] = t;
    }
}

/** `0x5f49a`: rows k..0; per row left 2..0 then right 4..6 (a side wall ends that side), centre column last. */
export function renderView(art: DungeonArt, lv: LevelData, a: number, b: number, facing: number, vis = 4): Uint8Array {
  const out = new Uint8Array(art.background);
  if (vis === 0) return out;
  const rows = buildViewRows(lv, a, b, facing);
  let k = 0;
  while (k < 4 && (rows[k * 7 + 3]! & 0x9f) === 0) k++;
  if (k >= vis) k = vis - 1;
  const at = (r: number, c: number) => rows[r * 7 + c]!;
  const side = (r: number, c: number): boolean => {
    const v = at(r, c);
    if (!v) return false;
    if (v & 0x60) drawMark(art, out, r, c, v);
    if (!(v & 0x9f)) return false;
    if (v & 0x80) {
      drawFront(art, out, r, c, (v & 0xf) === 2);
      return false;
    }
    drawSide(art, out, r, c, (v & 0xf) === 2);
    return true;
  };
  for (let r = k; r >= 0; r--) {
    for (let c = 2; c >= 0; c--) if (side(r, c)) break;
    for (let c = 4; c <= 6; c++) if (side(r, c)) break;
  }
  mirrorRightHalf(out);
  for (let r = k; r >= 0; r--) {
    const m = at(r, 3);
    if (!m) continue;
    if (m & 0x60) drawMark(art, out, r, 3, m);
    if (m & 0x9f) drawFront(art, out, r, 3, (m & 0xf) === 2);
  }
  return out;
}

/** Parse the level name at +0x600 (high-bit ASCII, 0xff terminated). */
export function levelName(rec: Uint8Array): string {
  let s = '';
  for (let o = 0x600; o < 0x610; o++) {
    if (rec[o] === 0xff) break;
    s += String.fromCharCode(rec[o]! & 0x7f);
  }
  return s.trim();
}
