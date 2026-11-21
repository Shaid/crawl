/**
 * Bard's Tale I (Amiga) dungeon: level grid, view art and the view compositor.
 *
 * Everything here is ported from the game's own code (overlay hunk group 2 of
 * `bardstale.dat`, the dungeon loop at overlay+0x80000..):
 *   - `levs` record: 22x22 wall bytes at +0x000 (index `a*22+b`), flag bytes at
 *     +0x200 (NOT +484), level header/name at +0x400.
 *   - view-row builder  `0x80dea`/`0x813aa`/`0x81358`/`0x8142c`,
 *   - draw loop         `0x814a0`/`0x81526`,
 *   - A/B/C draw fns    `0x82b9e` (floor/ceiling marks), `0x82d6c` (front wall/door),
 *     `0x82eba` (side wall/door),
 *   - piece layout      `0x8226c` (buffer carve-up) + `0x8277a` (big_dung reads).
 * Addresses are in the flattened overlay-2 image used for the disassembly (see
 * docs/bardstale1/amiga/data-structure.md "Dungeon").
 *
 * Coordinates: the game's `0x21022` is `a` (the *row* index of the 22x22
 * grid, +a = "north") and `0x21026` is `b` (the column, +b = "east").
 * Facing 0..3 = +a, +b, -a, -b (N, E, S, W).  Turn right = facing+1.
 */

export const GRID = 22;
export const VIEW_W = 112;
export const VIEW_H = 88;

/** Wall-face shift (bits >> shift & 3): 0 = +a (N), 2 = -a (S), 4 = +b (E), 6 = -b (W). */
export const FACE_SHIFT = { N: 0, S: 2, E: 4, W: 6 } as const;

export interface LevelData {
  /** 484 bytes, index a*22+b; 2 bits per face (see FACE_SHIFT): 0 open, 1 wall, 2 door, 3 secret door. */
  walls: Uint8Array;
  /** 484 bytes, index a*22+b. 0x20 = floor mark, 0x40 = ceiling mark (view-drawn); other bits unresolved. */
  flags: Uint8Array;
  name: string;
}

export function wrap(v: number): number {
  return ((v % GRID) + GRID) % GRID;
}

/** `0x813aa`: face value of cell (a,b) at `shift`. */
export function faceValue(lv: LevelData, a: number, b: number, shift: number): number {
  return (lv.walls[wrap(a) * GRID + wrap(b)]! >> shift) & 3;
}

export function cellFlags(lv: LevelData, a: number, b: number): number {
  return lv.flags[wrap(a) * GRID + wrap(b)]!;
}

/** Facing -> (A,B) step and the three face shifts (p10 = toward col-1, p14 = front, p18 = toward col+1). */
export const FACING_PARAMS = [
  { A: 1, B: 0, p10: 6, p14: 0, p18: 4 },
  { A: 0, B: 1, p10: 0, p14: 4, p18: 2 },
  { A: -1, B: 0, p10: 4, p14: 2, p18: 6 },
  { A: 0, B: -1, p10: 2, p14: 6, p18: 0 },
] as const;

/**
 * `0x80dea`: the 5x7 view-row table (`0x82248`, index row*7+col). Row = distance
 * 0..4, col 0..6 = left..right with col 3 on the party's line.
 */
export function buildViewRows(lv: LevelData, a: number, b: number, facing: number): Uint8Array {
  const { A, B, p10, p14, p18 } = FACING_PARAMS[facing & 3]!;
  const rows = new Uint8Array(35);
  const front = (x: number, y: number) => {
    const v = faceValue(lv, x, y, p14);
    return v ? v | 0x80 : 0;
  };
  const fl = (x: number, y: number) => cellFlags(lv, x, y) & 0x60;
  for (let r = 0; r < 5; r++) {
    const P = (c: number): [number, number] => [
      wrap(a + r * A + (3 - c) * B),
      wrap(b + r * B - (3 - c) * A),
    ];
    const row = (c: number, v: number) => {
      rows[r * 7 + c] = v;
    };
    for (let c = 0; c < 3; c++) {
      const [x, y] = P(c);
      const [x1, y1] = P(c + 1);
      const t = front(x, y) | fl(x, y);
      const side = faceValue(lv, x1, y1, p10);
      row(c, side !== 0 ? side : t);
    }
    {
      const [x, y] = P(3);
      row(3, faceValue(lv, x, y, p14) | fl(x, y));
    }
    for (let c = 4; c < 7; c++) {
      const [x, y] = P(c);
      const [xp, yp] = P(c - 1);
      const t = front(x, y) | fl(x, y);
      const side = faceValue(lv, xp, yp, p18);
      row(c, side !== 0 ? side : t);
    }
  }
  return rows;
}

/** Forward move rule at overlay+0x802c4: blocked iff view[0][3] & 3 == 1 (secret doors pass). Wraps at 22. */
export function canMoveForward(lv: LevelData, a: number, b: number, facing: number): boolean {
  return faceValue(lv, a, b, FACING_PARAMS[facing & 3]!.p14) !== 1;
}

export function stepForward(a: number, b: number, facing: number): [number, number] {
  const { A, B } = FACING_PARAMS[facing & 3]!;
  return [wrap(a + A), wrap(b + B)];
}

// ───────────────────────── big_dung piece layout ─────────────────────────

export interface Piece {
  /** pixel width (bytesPerRow*8) */
  w: number;
  h: number;
  /** palette indices, w*h */
  px: Uint8Array;
}

export interface PieceSource {
  offset: number;
  bpr: number;
  h: number;
}

/** front wall / door bitmaps, depth 0..3: bytes-per-row, rows. (BitMaps at 0x8322a..0x8334a) */
export const FRONT_DIMS = [
  { bpr: 12, h: 83 },
  { bpr: 8, h: 53 },
  { bpr: 6, h: 32 },
  { bpr: 4, h: 17 },
];
export const FRONT_OFFSETS = {
  wall: [0, 3984, 5680, 6448],
  door: [6720, 10704, 12400, 13168],
};
/** `0x834c0` table (centre-line side walls). [b][variant: wallL, doorL, wallR, doorR]; dims (w,h,bpr) per b. */
export const SIDE_C_OFFSETS = [
  [13440, 13440, 17864, 17864],
  [14152, 22288, 18576, 26000],
  [15480, 23616, 19904, 27328],
  [15888, 24024, 20312, 27736],
  [16128, 24264, 20552, 27976],
];
export const SIDE_C_DIMS = [
  { w: 10, h: 89, bpr: 2 },
  { w: 19, h: 83, bpr: 4 },
  { w: 11, h: 51, bpr: 2 },
  { w: 8, h: 30, bpr: 2 },
  { w: 4, h: 16, bpr: 2 },
];
/** `0x834a0` table (off-centre side walls, depth 2,3). */
export const SIDE_O_OFFSETS = [
  [16256, 24392, 20680, 28104],
  [17384, 25520, 21808, 29232],
];
export const SIDE_O_DIMS = [
  { w: 33, h: 47, bpr: 6 },
  { w: 24, h: 30, bpr: 4 },
];
/** `0x83558` (floor mark, flag 0x20) and `0x8357c` (ceiling mark, flag 0x40): [d][col] file offsets; -1 = 8-byte zero buffer. */
export const MARK_OFFSETS = {
  floor: [[30008, 30064, 30176], [30232, 30256, 30280], [-1, -1, -1]],
  ceiling: [[29712, 29768, 29880], [29936, 29960, 29984], [-1, -1, -1]],
};

export function decodePiece(data: Uint8Array, offset: number, bpr: number, h: number): Piece {
  const w = bpr * 8;
  const px = new Uint8Array(w * h);
  if (offset < 0) return { w, h, px };
  const planeSize = bpr * h;
  for (let p = 0; p < 4; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (data[offset + p * planeSize + y * bpr + (x >> 3)]! >> (7 - (x & 7))) & 1;
        px[y * w + x]! |= bit << p;
      }
    }
  }
  return { w, h, px };
}

export interface DungeonArt {
  palette: number[]; // 16 12-bit Amiga words
  background: Uint8Array; // 112x88 indices
  front: { wall: Piece[]; door: Piece[] };
  sideC: Piece[][];
  sideO: Piece[][];
  marks: { floor: Piece[][]; ceiling: Piece[][] };
}

/** Build the art set from the decoded big_dung bytes + dung_blank (palette + 4-plane background). */
export function buildArt(bigDung: Uint8Array, palette: number[], backgroundPlanar: Uint8Array): DungeonArt {
  const dp = (o: number, bpr: number, h: number) => decodePiece(bigDung, o, bpr, h);
  const bg = new Uint8Array(VIEW_W * VIEW_H);
  const bpr = VIEW_W / 8;
  const plane = bpr * VIEW_H;
  for (let p = 0; p < 4; p++)
    for (let y = 0; y < VIEW_H; y++)
      for (let x = 0; x < VIEW_W; x++)
        bg[y * VIEW_W + x]! |= ((backgroundPlanar[p * plane + y * bpr + (x >> 3)]! >> (7 - (x & 7))) & 1) << p;
  return {
    palette,
    background: bg,
    front: {
      wall: FRONT_DIMS.map((d, i) => dp(FRONT_OFFSETS.wall[i]!, d.bpr, d.h)),
      door: FRONT_DIMS.map((d, i) => dp(FRONT_OFFSETS.door[i]!, d.bpr, d.h)),
    },
    sideC: SIDE_C_OFFSETS.map((vs, b) => vs.map((o) => dp(o, SIDE_C_DIMS[b]!.bpr, SIDE_C_DIMS[b]!.h))),
    sideO: SIDE_O_OFFSETS.map((vs, i) => vs.map((o) => dp(o, SIDE_O_DIMS[i]!.bpr, SIDE_O_DIMS[i]!.h))),
    marks: {
      floor: MARK_OFFSETS.floor.map((r, d) => r.map((o) => dp(o, 2 + (d === 0 && r.indexOf(o) === 1 ? 2 : 0), [7, 3, 1][d]!))),
      ceiling: MARK_OFFSETS.ceiling.map((r, d) => r.map((o) => dp(o, 2 + (d === 0 && r.indexOf(o) === 1 ? 2 : 0), [7, 3, 1][d]!))),
    },
  };
}

/** Every byte range of big_dung that the loader consumes, for the tiling check (offset, length). */
export function pieceRanges(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const add = (o: number, bpr: number, h: number) => out.push([o, bpr * h * 4]);
  FRONT_DIMS.forEach((d, i) => {
    add(FRONT_OFFSETS.wall[i]!, d.bpr, d.h);
    add(FRONT_OFFSETS.door[i]!, d.bpr, d.h);
  });
  const seen = new Set<number>();
  SIDE_C_OFFSETS.forEach((vs, b) => vs.forEach((o) => {
    if (!seen.has(o)) { seen.add(o); add(o, SIDE_C_DIMS[b]!.bpr, SIDE_C_DIMS[b]!.h); }
  }));
  SIDE_O_OFFSETS.forEach((vs, i) => vs.forEach((o) => add(o, SIDE_O_DIMS[i]!.bpr, SIDE_O_DIMS[i]!.h)));
  const widths = [[2, 4, 2], [2, 2, 2]];
  for (const set of [MARK_OFFSETS.floor, MARK_OFFSETS.ceiling])
    for (let d = 0; d < 2; d++) for (let c = 0; c < 3; c++) add(set[d]![c]!, widths[d]![c]!, [7, 3][d]!);
  return out;
}

// ───────────────────────────── compositor ─────────────────────────────

/** `0x83172` -> BltBitMapRastPort minterm 0xC0: opaque rectangle copy clipped to the 112x88 view. */
function blit(dst: Uint8Array, p: Piece, srcX: number, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= VIEW_H || j >= p.h) continue;
    for (let i = 0; i < w; i++) {
      const dx = x + i;
      const sx = srcX + i;
      if (dx < 0 || dx >= VIEW_W || sx >= p.w) continue;
      dst[dy * VIEW_W + dx] = p.px[j * p.w + sx]!;
    }
  }
}

const A_X = [1, 0x2b, 0x63, 9, 0x31, 0x58, 0x18, 0x35, 0x53];
const A_Y_CEIL = [0, 0x12, 0x1c];
const A_Y_FLOOR = [0x47, 0x3c, 0x35];
const A_W = [0x0b, 0x1a, 0x0d, 0x0d, 0x0c, 0x0e, 5, 5, 5];
const A_H = [7, 3, 1];

/** `0x82b9e` */
function drawMark(art: DungeonArt, dst: Uint8Array, depth: number, col: number, v: number): void {
  if (depth < 1 || depth > 3 || col < 2 || col > 4) return;
  const d0 = depth - 1;
  const cc = col - 2;
  const ceiling = (v & 0x40) !== 0;
  const piece = (ceiling ? art.marks.ceiling : art.marks.floor)[d0]![cc]!;
  blit(dst, piece, 0, A_X[d0 * 3 + cc]!, (ceiling ? A_Y_CEIL : A_Y_FLOOR)[d0]!, A_W[d0 * 3 + cc]!, A_H[d0]!);
}

const B_REC = [
  [2, 0x09, 0x5f, 0x53, 4, 0],
  [2, 0x1d, 0x37, 0x35, 4, 0x0e],
  [1, 0x07, 0x21, 0x20, 5, 0x19],
  [0, 0x0e, 0x11, 0x11, 6, 0x21],
];

/** `0x82d6c` front-facing wall/door at distance `depth`, column `col`. */
function drawFront(art: DungeonArt, dst: Uint8Array, depth: number, col: number, door: boolean): void {
  if (depth > 3) return;
  const [c0, r1, w0, h, c4, y] = B_REC[depth]!;
  if (col < c0! || col > c4!) return;
  let w = w0!;
  let x = w0! * (col - c0!) - (w0! - r1!);
  let srcX = 0;
  if (x < 0) {
    w = r1!;
    srcX = w0! - r1!;
    x = 0;
  }
  if (x + w > VIEW_W) w -= x + w - VIEW_W;
  blit(dst, (door ? art.front.door : art.front.wall)[depth]!, srcX, x, y!, w, h!);
}

const T1 = [0, 0x0e, 0x1f, 0x30, 0x3d, 0x4e, 0x5f];
const C_Y = [0, 0, 0x0d, 0x18, 0x21];
const C_W = [0x0a, 0x13, 0x0b, 0x08, 0x04];
const C_H = [0x59, 0x53, 0x33, 0x1e, 0x10];
const C_LEFT = [0x30, 0x26, 0x13, 0x08, 0x00];
const C_RIGHT = [0x2a, 0x17, 0x0c, 0x04, 0x00];
const O_Y = [0x10, 0x1a];
const O_W = [0x21, 0x18];
const O_H = [0x2f, 0x1e];

/** `0x82eba` side wall/door; `col` is the view column 0..6 (pre-increment). Returns false if nothing drawn. */
function drawSide(art: DungeonArt, dst: Uint8Array, b: number, col: number, door: boolean): void {
  let k = col;
  if (k <= 3) k++;
  let x0 = T1[k]!;
  let srcX = 0;
  let y: number, w: number, h: number;
  let piece: Piece;
  const v = (k & 4) >> 1 | (door ? 1 : 0);
  if (k === 3 || k === 4 || b === 4) {
    y = C_Y[b]!;
    w = C_W[b]!;
    h = C_H[b]!;
    piece = art.sideC[b]![v]!;
  } else {
    if (b < 2) return;
    y = O_Y[b - 2]!;
    w = O_W[b - 2]!;
    h = O_H[b - 2]!;
    piece = art.sideO[b - 2]![v]!;
    if (b === 3 && k < 3) x0 -= 0x10;
    if (b === 2) x0 += k < 3 ? -0x26 : 0x10;
  }
  if (k <= 3) {
    x0 -= C_LEFT[b]!;
    if (x0 < 0) {
      if (x0 + w < 0) return;
      srcX = -x0;
      w -= -x0;
      x0 = 0;
    }
  } else {
    x0 += C_RIGHT[b]!;
    if (x0 > VIEW_W) return;
    if (x0 + w > VIEW_W) w -= x0 + w - VIEW_W;
  }
  blit(dst, piece, srcX, x0, y, w, h);
}

function drawRow(art: DungeonArt, dst: Uint8Array, rows: Uint8Array, r: number): void {
  const at = (c: number) => rows[r * 7 + c]!;
  for (let c = 2; c >= 0; c--) {
    const v = at(c);
    if (!v) continue;
    if (v & 0x60) drawMark(art, dst, r, c, v);
    if (!(v & 0x9f)) continue;
    if (v & 0x80) drawFront(art, dst, r, c, (v & 0xf) === 2);
    else {
      drawSide(art, dst, r, c, (v & 0xf) === 2);
      break;
    }
  }
  const m = at(3);
  if (m) {
    if (m & 0x60) drawMark(art, dst, r, 3, m);
    if (m & 0x9f) drawFront(art, dst, r, 3, (m & 0xf) === 2);
  }
  for (let c = 4; c <= 6; c++) {
    const v = at(c);
    if (!v) continue;
    if (v & 0x60) drawMark(art, dst, r, c, v);
    if (!(v & 0x9f)) continue;
    if (v & 0x80) drawFront(art, dst, r, c, (v & 0xf) === 2);
    else {
      drawSide(art, dst, r, c, (v & 0xf) === 2);
      break;
    }
  }
}

/** `0x814a0`: far-to-near draw, limited by the centre-line wall and visibility (`0x20492`, default 4). */
export function renderView(art: DungeonArt, lv: LevelData, a: number, b: number, facing: number, vis = 4): Uint8Array {
  const out = new Uint8Array(art.background);
  if (vis === 0) return out;
  const rows = buildViewRows(lv, a, b, facing);
  let k = 0;
  while (k < 4 && (rows[k * 7 + 3]! & 0x9f) === 0) k++;
  if (k >= vis) k = vis - 1;
  for (let r = k; r >= 0; r--) drawRow(art, out, rows, r);
  return out;
}

export function indexedToRGBA(frame: Uint8Array, palette: number[]): Uint8Array {
  const rgba = new Uint8Array(frame.length * 4);
  for (let i = 0; i < frame.length; i++) {
    const w = palette[frame[i]!]!;
    rgba[i * 4] = ((w >> 8) & 0xf) * 17;
    rgba[i * 4 + 1] = ((w >> 4) & 0xf) * 17;
    rgba[i * 4 + 2] = (w & 0xf) * 17;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
