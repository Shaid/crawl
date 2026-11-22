/**
 * The Bard's Tale I (Amiga): Skara Brae, the city.
 *
 * Everything here is ported from the game's own code: overlay hunk group 1 of `bardstale.dat` (the city loop;
 * the only overlay that names `big_city`). Addresses are in the flattened overlay-1 image (root hunks at 0x10000,
 * overlay group 1 at 0x80000; same flattener as the dungeon overlay, see docs/bardstale1/amiga/data-structure.md).
 *
 *   - grids       `0x80042`/`0x8005e`: CITY/CITY.PATH -> 0x208f8, CITY/CITY.NAME -> 0x20c7c; 30x30 bytes each,
 *                 index row*30+col (`muls #30`). No bounds check anywhere: the two grids are one 1,800-byte block,
 *                 so row 30.. of the path grid reads the name grid.
 *   - pose        row 0x20834, col 0x20838, facing 0x2083c. New game (root 0x13bbc): (14,25) facing 0.
 *                 Facing 0..3 = north, east, south, west (the "facing north." strings at 0x84642, index = facing);
 *                 north = row-1, east = col+1 (`0x8021c`).
 *   - move        `0x8021c..0x803a0`: target cell 0 = street, move (and (27,25) puts you at row 22, `0x802b0`);
 *                 nonzero = a building / gate: `0x80650` runs its handler (type = byte>>3, `0x8073e` jump table);
 *                 result 1 = move in, >2 = leave the city (0xff guild, 3 dungeon), else the party turns round.
 *   - view rows   `0x85dce` -> `0x85ed8`: 5 distances x (left, centre, right) bytes at 0x20840, plus two patches.
 *   - compositor  `0x85fea` (frame 0 = standing still): sky/ground fill `0x8694c`, building fronts `0x863a8`
 *                 (word rects 0x22002 / offsets 0x21ff0), street-wall slices `0x86366` -> `0x87484` (column ranges
 *                 from 0x8715c, right half mirrored), cross-street side faces `0x86552` (rects 0x8719e / 0x8718c).
 *                 A special building straight ahead (distance 1) shows a `pics` picture instead (`0x86504`, 0x8729a).
 *   - art         `big_city` (loader `0x869bc`): 32 B palette, 16 x 2,464 B street-wall halves (56x88 4-plane,
 *                 [type-1][frame]), 4 x 9,480 B fronts, 4 x 14,656 B side faces (word-interleaved planes).
 */

export const CITY_W = 30;
export const CITY_H = 30;
export const VIEW_W = 112;
export const VIEW_H = 88;

/** Facing 0..3 = N, E, S, W; step (dRow, dCol) from `0x8021c`. */
export const STEP: ReadonlyArray<readonly [number, number]> = [[-1, 0], [0, 1], [1, 0], [0, -1]];
export const FACING_NAMES = ['north', 'east', 'south', 'west'] as const;

/** New-game pose (root 0x13bbc). */
export const START = { row: 14, col: 25, facing: 0 } as const;

export interface Bt1City {
  /** CITY.PATH, 900 B: 0 = street; else (type << 3) | facade, facade 1..4 = which big_city house art, 0 = none drawn. */
  path: Uint8Array;
  /** CITY.NAME, 900 B: street-name index (0..19, table 0x845d8) where < 0x14; bit 7 = "the Grand Plaza". */
  name: Uint8Array;
  streetNames: string[];
}

/**
 * Byte at (row, col) as the game reads it: path grid then name grid as one block, no bounds check. Reads before the
 * path grid hit unrelated variables; the walker treats them as a plain house (`0x01`, **hypothesis**, only reachable
 * looking off the closed north edge).
 */
export function cityByte(c: Bt1City, row: number, col: number): number {
  const i = row * CITY_W + col;
  if (i >= 0 && i < 900) return c.path[i]!;
  if (i >= 900 && i < 1800) return c.name[i - 900]!;
  return 0x01;
}

// ───────────────────────────── buildings / movement ─────────────────────────────

export type CityAction =
  | { kind: 'move'; row: number; col: number; message?: string }
  | { kind: 'turn'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'dungeon'; dungeon: number; level: number; message: string; cityRow?: number; cityCol?: number }
  | { kind: 'leave'; message: string };

/** Taverns by 29-row (`0x80ef2`). Only the Scarlet Bard at (24,28) serves wine, and wine leads to the cellar (`0x80ae0`). */
const TAVERNS: Record<number, string> = {
  0x12: 'Drawnblade',
  0x08: 'Skull Tavern',
  0x01: 'Archmage Inn',
  0x06: "Ask Y'Mother",
  0x07: 'Dragonbreath',
  0x13: 'Sinister Inn',
  0x05: 'Scarlet Bard',
};

/** Guardian statues (type 12): (row, col) from 0x22b64 (stored as 29-row) and the facing that walks past freely (0x22b82). */
export const GUARDIANS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 4, 3], [3, 6, 3], [5, 6, 1], [7, 6, 2], [15, 3, 0], [23, 3, 0], [23, 6, 0], [23, 27, 0], [26, 22, 0], [27, 21, 3],
];
/** Iron gates (type 13): (row, col, facing) that pass one-way without the key item (0x84fd8 / 0x84fe0). */
export const IRON_GATE_EXITS: ReadonlyArray<readonly [number, number, number]> = [
  [2, 25, 3], [4, 27, 2], [25, 2, 0], [27, 4, 1],
];

/**
 * Root 0x17260: levs record = 0x17492[dungeon] + level - 1 (bases 0,0,1,4,7,10,11). Dungeon ids are the values the
 * city handlers store in 0x20824 (level in 0x20857).
 */
export const DUNGEON_BASE = [0, 0, 1, 4, 7, 10, 11];
export function levsRecord(dungeon: number, level: number): number {
  return DUNGEON_BASE[dungeon]! + level - 1;
}

/** What the building / gate handler for `v` at (row, col) does when walked into facing `facing` (`0x80650`). */
export function buildingAction(v: number, row: number, col: number, facing: number): CityAction {
  const type = v >> 3;
  const turn = (message: string): CityAction => ({ kind: 'turn', message });
  switch (type) {
    case 0:
      return turn("You're in an empty building."); // 0x8070a (1 in 4: a random encounter first, 0x8068a)
    case 1:
      return { kind: 'leave', message: "The Adventurers' Guild (leaves the city for the guild menu)" }; // 0x80796
    case 2: {
      const n = TAVERNS[29 - row] ?? 'Tavern';
      if (29 - row === 5 && col === 0x1c)
        return { kind: 'dungeon', dungeon: 1, level: 1, message: `${n}: order wine, "go down to the cellar" (0x80cae)` };
      return turn(`${n} (tavern)`);
    }
    case 3:
      return turn("Garth's Equipment Shoppe");
    case 4:
      return turn('a temple ("Who needeth healing?")');
    case 5:
      return turn('the Review Board');
    case 12: {
      const g = GUARDIANS.find(([r, c]) => r === row && c === col);
      if (g && g[2] === facing) return { kind: 'move', row, col, message: 'past the guardian statue' }; // 0x819e8
      return { kind: 'blocked', message: 'a gate guarded by a statue (fight it to pass)' };
    }
    case 13: {
      if (IRON_GATE_EXITS.some(([r, c, f]) => r === row && c === col && f === facing)) return { kind: 'move', row, col, message: 'through the iron gate' };
      return { kind: 'blocked', message: 'an iron gate (needs the key item to pass this way)' };
    }
    case 14:
      return { kind: 'dungeon', dungeon: 3, level: 1, message: 'the temple of the Mad God -> the catacombs (needs the right word)' };
    case 15:
      return { kind: 'dungeon', dungeon: 1, level: 4, message: 'an entrance to the city sewers', cityRow: 24, cityCol: 27 };
    case 16:
      return turn('the Bard\'s Hall ("Bard\'s Tale")');
    case 17:
      return turn("Roscoe's Energy Emporium");
    case 18:
      return { kind: 'dungeon', dungeon: 5, level: 1, message: "Kylearan's Amber Tower" };
    case 19:
      return { kind: 'dungeon', dungeon: 4, level: 1, message: "Harkyn's Castle" };
    case 20:
      return { kind: 'dungeon', dungeon: 6, level: 1, message: "Mangar's Tower (the magic mouth wants the right word)" };
    case 21:
      return turn('The city gates, blocked by a gigantic snow drift.');
    default:
      return turn(`I don't know. code == ${type}`); // 0x8087a
  }
}

/** One forward key in the city (`0x8021c`). */
export function cityMove(c: Bt1City, row: number, col: number, facing: number): CityAction {
  const [dr, dc] = STEP[facing & 3]!;
  const r = row + dr;
  const k = col + dc;
  const v = cityByte(c, r, k);
  if (v === 0) {
    if (r === 0x1b && k === 0x19) return { kind: 'move', row: 0x16, col: k }; // 0x802b0
    return { kind: 'move', row: r, col: k };
  }
  return buildingAction(v, r, k, facing & 3);
}

// ───────────────────────────── view rows ─────────────────────────────

/**
 * `0x85dce` / `0x85ed8`: rows[d*3 + s], d = distance 0..4, s = 0 left, 1 centre, 2 right.
 * Per facing the routine gets (side dRow, step dRow, side dCol, step dCol); left = +side, right = -side.
 */
const VIEW_PARAMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -1, -1, 0],
  [-1, 0, 0, 1],
  [0, 1, 1, 0],
  [1, 0, 0, -1],
];

export function buildCityRows(c: Bt1City, row: number, col: number, facing: number): Uint8Array {
  const [sr, dr, sc, dc] = VIEW_PARAMS[facing & 3]!;
  const out = new Uint8Array(15);
  for (let d = 0; d < 5; d++) {
    const r = row + d * dr;
    const k = col + d * dc;
    out[d * 3] = cityByte(c, r + sr, k + sc);
    out[d * 3 + 1] = cityByte(c, r, k);
    out[d * 3 + 2] = cityByte(c, r - sr, k - sc);
  }
  if (facing === 2 && row === 0x1a && col === 0x19) {
    out[12] = 3; // 0x85e38
    out[13] = 0;
    out[14] = 4;
  }
  if (facing === 3 && row === 0x0e) {
    // 0x85e88: looking west at the city gate, clear the cells off the map
    if (col <= 3) out.fill(0, 12, 15);
    if (col <= 2) out.fill(0, 9, 12);
    if (col <= 1) out.fill(0, 6, 9);
  }
  return out;
}

// ───────────────────────────── art ─────────────────────────────

export const BIG_CITY_SIZE = 136000;
export const HALF_BYTES = 0x9a0;
export const FRONT_BYTES = 0x2508;
export const SIDE_BYTES = 0x3940;
export const HALF_OFF = 32;
export const FRONT_OFF = HALF_OFF + 16 * HALF_BYTES;
export const SIDE_OFF = FRONT_OFF + 4 * FRONT_BYTES;

/** 0x8715c: per walk frame, the street-wall column boundaries (only frame 0 is drawn by the walker). */
export const SLICE_X = [
  [0, 34, 44, 51, 61, 68, 78, 111],
  [0, 31, 43, 51, 61, 69, 82, 111],
  [0, 22, 40, 49, 63, 72, 89, 111],
  [0, 16, 37, 46, 66, 75, 96, 111],
];
/** 0x21ff0: word offsets of the 9 front rects inside a front image. */
export const FRONT_WORDS = [0, 48, 176, 416, 692, 992, 1352, 1784, 2276];
/** 0x22002: front rects (screen x0, y0, x1, y1; the view sits at screen (16,15)); index depth*4 + frame. */
export const FRONT_RECTS = [
  [67, 52, 77, 63], [65, 49, 79, 64], [62, 47, 82, 66], [60, 46, 84, 68], [59, 45, 85, 69],
  [56, 42, 88, 71], [53, 39, 91, 74], [50, 36, 94, 76], [17, 15, 127, 102],
];
/** 0x8718c: word offsets of the 9 side-face pairs inside a side image. */
export const SIDE_WORDS = [0, 400, 848, 1568, 2456, 3512, 4712, 5608, 6712];
/** 0x8719e: side faces (left x0, y0, x1, y1, right x0, right x1, right-part word offset); index pos*4 + frame - 3. */
export const SIDE_RECTS = [
  [40, 43, 61, 67, 83, 104, 200], [35, 41, 59, 68, 85, 109, 224], [29, 40, 58, 69, 86, 116, 360],
  [24, 36, 55, 72, 89, 121, 444], [17, 31, 52, 74, 92, 127, 528], [17, 28, 49, 77, 95, 127, 600],
  [17, 24, 46, 79, 99, 127, 448], [17, 17, 37, 85, 106, 127, 552], [17, 15, 31, 91, 113, 127, 308],
];
/** 0x8729a: `pics` picture shown for a special building straight ahead, by type (byte >> 3); 0 = none. */
export const SPECIAL_PICS = [0, 52, 43, 45, 42, 0, 0, 0, 0, 0, 0, 0, 37, 36, 42, 0, 0, 0, 0, 35, 0, 38];

export interface CityArt {
  palette: number[];
  /** decoded big_city (136,000 B) */
  data: Uint8Array;
  /** pics index -> 112x88 indexed picture + its own palette */
  pictures: Record<number, { px: Uint8Array; palette: number[] }>;
}

/** Word-rect sizes (in words) of each front / side entry, for the tiling check. */
export function frontRectWords(i: number): number {
  const [x0, y0, x1, y1] = FRONT_RECTS[i]!;
  return (((x1! - 16) >> 4) - ((x0! - 16) >> 4) + 1) * (y1! - y0! + 1) * 4;
}
export function sideRectWords(i: number, right: boolean): number {
  const r = SIDE_RECTS[i]!;
  const x0 = (right ? r[4]! : r[0]!) - 16;
  const x1 = (right ? r[5]! : r[2]!) - 16;
  return ((x1 >> 4) - (x0 >> 4) + 1) * (r[3]! - r[1]! + 1) * 4;
}

/** Screen = 4 sequential planes of 14 B x 88 rows (`0x2316c`, planes 0x4d0 apart). */
class Screen {
  readonly planes = new Uint8Array(4 * 1232);
  getWord(p: number, row: number, w: number): number {
    const o = p * 1232 + row * 14 + w * 2;
    return (this.planes[o]! << 8) | this.planes[o + 1]!;
  }
  setWord(p: number, row: number, w: number, v: number): void {
    const o = p * 1232 + row * 14 + w * 2;
    this.planes[o] = (v >> 8) & 0xff;
    this.planes[o + 1] = v & 0xff;
  }
  toIndexed(): Uint8Array {
    const out = new Uint8Array(VIEW_W * VIEW_H);
    for (let p = 0; p < 4; p++)
      for (let y = 0; y < VIEW_H; y++)
        for (let x = 0; x < VIEW_W; x++)
          out[y * VIEW_W + x]! |= ((this.planes[p * 1232 + y * 14 + (x >> 3)]! >> (7 - (x & 7))) & 1) << p;
    return out;
  }
}

const w16 = (d: Uint8Array, o: number) => (d[o]! << 8) | d[o + 1]!;

/** `0x8694c`: rows 0..45 colour 1 (sky), rows 46..87 colour 2 (ground). */
function clearView(s: Screen): void {
  s.planes.fill(0);
  s.planes.fill(0xff, 0, 644);
  s.planes.fill(0xff, 1232 + 644, 2464);
}

/** `0x863a8`: a front-facing building, whole words, no mask. depth 0..2 = distance 3..1. */
function drawFront(art: CityArt, s: Screen, type: number, depth: number, frame = 0): void {
  const i = depth * 4 + frame;
  const [x0, y0, x1, y1] = FRONT_RECTS[i]!;
  let src = FRONT_OFF + (type - 1) * FRONT_BYTES + 2 * FRONT_WORDS[i]!;
  for (let y = y0! - 15; y <= y1! - 15; y++)
    for (let w = (x0! - 16) >> 4; w <= (x1! - 16) >> 4; w++)
      for (let p = 0; p < 4; p++, src += 2) s.setWord(p, y, w, w16(art.data, src));
}

/** `0x86552`: the side face of a building seen across an empty neighbour; pos 0..2 = distance 3..1. */
function drawSide(art: CityArt, s: Screen, type: number, pos: number, right: boolean, frame = 0): void {
  const i = pos * 4 + frame - 3;
  if (i < 0 || i > 8) return;
  const r = SIDE_RECTS[i]!;
  let src = SIDE_OFF + (type - 1) * SIDE_BYTES + 2 * SIDE_WORDS[i]! + (right ? 2 * r[6]! : 0);
  const x0 = (right ? r[4]! : r[0]!) - 16;
  const x1 = (right ? r[5]! : r[2]!) - 16;
  const w0 = x0 >> 4;
  const w1 = x1 >> 4;
  const m0 = 0xffff >> (x0 & 15);
  const m1 = (0xffff << (15 - (x1 & 15))) & 0xffff;
  for (let y = r[1]! - 15; y <= r[3]! - 15; y++)
    for (let w = w0; w <= w1; w++) {
      const m = w0 === w1 ? m0 & m1 : w === w0 ? m0 : w === w1 ? m1 : 0xffff;
      for (let p = 0; p < 4; p++, src += 2) s.setWord(p, y, w, (s.getWord(p, y, w) & ~m) | (w16(art.data, src) & m));
    }
}

/**
 * `0x86366` -> `0x87484`: columns x0..x1 of the 56x88 street-wall half image for `type`. Left of x 56 the image is
 * used as is; from x 56 on, the routine draws the image mirrored (bit-reversed bytes, reversed order, shifted right
 * one pixel) at x - 56 of the right half, i.e. screen x uses source column 112 - x.
 */
function drawSlice(art: CityArt, s: Screen, type: number, x0: number, x1: number, frame = 0): void {
  const base = HALF_OFF + ((type - 1) * 4 + frame) * HALF_BYTES;
  const mirror = x0 >= 56;
  for (let p = 0; p < 4; p++)
    for (let y = 0; y < VIEW_H; y++)
      for (let x = x0; x <= x1; x++) {
        const sx = mirror ? 112 - x : x;
        const bit = sx >= 0 && sx < 56 ? (art.data[base + p * 616 + y * 7 + (sx >> 3)]! >> (7 - (sx & 7))) & 1 : 0;
        const o = p * 1232 + y * 14 + (x >> 3);
        const m = 0x80 >> (x & 7);
        s.planes[o] = bit ? s.planes[o]! | m : s.planes[o]! & ~m;
      }
}

export interface CityFrame {
  /** 112x88 palette indices */
  px: Uint8Array;
  palette: number[];
  /** set when a special building straight ahead replaced the street view with a `pics` picture */
  picture?: number;
}

/** `0x85fea` with frame 0 (the party standing still). */
export function renderCityView(art: CityArt, c: Bt1City, row: number, col: number, facing: number): CityFrame {
  const v = buildCityRows(c, row, col, facing);
  const f = 0;
  const X = SLICE_X[f]!;
  const X0 = SLICE_X[0]!;
  const t = (i: number) => v[i]! & 7;
  const s = new Screen();
  clearView(s);
  if (t(4)) {
    // 0x86340: a building right ahead fills the view (or shows its picture)
    const pic = v[4]! & 0xf8 ? SPECIAL_PICS[v[4]! >> 3] ?? 0 : 0;
    if (pic && art.pictures[pic]) return { px: art.pictures[pic]!.px, palette: art.pictures[pic]!.palette, picture: pic };
    drawFront(art, s, t(4), 2, f);
    return { px: s.toIndexed(), palette: art.palette };
  }
  const ahead2 = t(7);
  const ahead3 = t(10);
  if (ahead2) drawFront(art, s, ahead2, 1, f); // 0x861fe
  else {
    if (ahead3) drawFront(art, s, ahead3, 0, f); // 0x8612e
    else if (f !== 0) {
      // 0x8606e: distance-3 sides only during the walk animation
      if (t(9)) {
        if (!t(6)) drawSide(art, s, t(9), 0, false, f);
        drawSlice(art, s, t(9), X[3]!, X0[3]! - 1, f);
      }
      if (t(11)) {
        if (!t(8)) drawSide(art, s, t(11), 0, true, f);
        drawSlice(art, s, t(11), X0[4]!, X[4]!, f);
      }
    }
    // 0x86140: distance-2 sides
    if (t(6)) {
      if (!t(3)) drawSide(art, s, t(6), 1, false, f);
      drawSlice(art, s, t(6), X[2]!, X[3]! - 1, f);
    }
    if (t(8)) {
      if (!t(5)) drawSide(art, s, t(8), 1, true, f);
      drawSlice(art, s, t(8), X[4]! + 1, X[5]!, f);
    }
  }
  // 0x86212: distance-1 and distance-0 sides
  if (t(3)) {
    if (!t(0)) drawSide(art, s, t(3), 2, false, f);
    drawSlice(art, s, t(3), X[1]!, X[2]! - 1, f);
  }
  if (t(5)) {
    if (!t(2)) drawSide(art, s, t(5), 2, true, f);
    drawSlice(art, s, t(5), X[5]! + 1, X[6]!, f);
  }
  if (t(0)) drawSlice(art, s, t(0), X[0]!, X[1]! - 1, f);
  if (t(2)) drawSlice(art, s, t(2), X[6]! + 1, X[7]!, f);
  return { px: s.toIndexed(), palette: art.palette };
}

/** "You are on <street> facing <dir>." / "You're in the Grand Plaza." (`0x804c6`) */
export function locationText(c: Bt1City, row: number, col: number, facing: number): string {
  const n = c.name[row * CITY_W + col] ?? 0;
  if (n & 0x80 || n > 0x13) return "You're in the Grand Plaza.";
  return `You are on ${c.streetNames[n]} facing ${FACING_NAMES[facing & 3]}.`;
}

export function indexedToRGBA(frame: Uint8Array, palette: number[]): Uint8Array {
  const rgba = new Uint8Array(frame.length * 4);
  for (let i = 0; i < frame.length; i++) {
    const w = palette[frame[i]!] ?? 0;
    rgba[i * 4] = ((w >> 8) & 0xf) * 17;
    rgba[i * 4 + 1] = ((w >> 4) & 0xf) * 17;
    rgba[i * 4 + 2] = (w & 0xf) * 17;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
