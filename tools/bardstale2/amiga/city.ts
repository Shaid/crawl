/**
 * Bard's Tale II (Amiga): the six cities (Tangramayne, Ephesus, Philippi, Colosse, Corinth, Thessalonica).
 *
 * Ported from the game's own code: `data/bard` overlay group 2 (the city loop; its data hunk names `citys` and
 * `big_city`). Addresses are in the same flattened image as the dungeon notes (root hunks from 0x10000, overlay
 * groups appended; group 2 code at 0x54100 / 0x59300, data at 0x57800 / 0x5a100; `data/bard` file offset of the
 * 0x5a100 hunk = flat - 0x5a100 + 0x2d818).
 *
 *   - grid        `0x5413e`: `citys` record <city> (1..6; record 0 is the 48x48 wilderness) -> 0x224de, 512 B:
 *                 16x16 cells (index row*16+col, `asl #4`) then a 16x16 street-name grid (row+16).
 *                 Cell: high nibble = building type (`0x54834` jump table), low nibble = facade art (1..4; >4 ->
 *                 (v & 3) + 1, `0x59316`; 0 = nothing drawn).
 *   - pose        row 0x22346, col 0x22348, facing 0x2234a (0..3 = north, east, south, west; strings 0x3c670),
 *                 step tables 0x3daf6 (dRow -1,0,1,0) / 0x3dafe (dCol 0,1,0,-1). City index 0x22337.
 *   - move        `0x542ce`: leaving the 16x16 grid exits to the wilderness (0x3bd24/0x3bd2b); 0 = street, move;
 *                 else the building handler (`0x54834`): 1 = move in, 0 = turn round, 0xff = guild,
 *                 4 = the city's dungeon (`0x549c0`, dungeon id 0x57800[city]).
 *   - view rows   `0x5956e` -> `0x595ee`: as BT1 but bounds-checked (outside = 0) and the sides masked to the facade.
 *   - compositor  `0x59826` (frame 0): sky/ground fill `0x59ba8`, street-wall slices `0x593b2` (13 slots, rects
 *                 0x5a2d0, dest 0x5a268), cross-street side faces `0x59300` (9 slots, 0x5a148 / 0x5a100),
 *                 right-hand cells drawn at x+56 then the right half flipped (`0x44ee0`), then the centre front
 *                 `0x59464` (8 slots, 0x5a4b0 / 0x5a470) or, for a special building straight ahead, a `pics`
 *                 picture (`0x59b58`, table 0x5a5b0).
 *   - art         `big_city` (`0x59c10`): 32 B palette, then the 13 slice + 9 side bitmaps (0xe318 B), then the 8
 *                 front bitmaps (0x8710 B); each bitmap 4 sequential planes, bpr = ((x1 of variant 4) + 16) / 16 * 2,
 *                 rows = y1 + 1, the four facades side by side.
 */

export const CITY_N = 16;
export const VIEW_W = 112;
export const VIEW_H = 88;
export const STEP: ReadonlyArray<readonly [number, number]> = [[-1, 0], [0, 1], [1, 0], [0, -1]];
export const FACING_NAMES = ['north', 'east', 'south', 'west'] as const;

/** 0x3a27a: city names by city index. */
export const CITY_NAMES = ['Wilderness', 'Tangramayne', 'Ephesus', 'Philippi', 'Colosse', 'Corinth', 'Thessalonica'];
/** 0x57800: dungeon id entered from each city's dungeon building. */
export const CITY_DUNGEON = [0, 1, 2, 4, 8, 6, 5];
/** 0x18b5c: levs record base per dungeon id (record = base + level - 1, root 0x1881c). */
export const DUNGEON_BASE = [0, 0, 4, 7, 8, 13, 16, 20, 22];
/** Guild exit pose per city: row 0x3bd40, col 0x3bd47, facing 0x3bd4e (group 1, 0x51f84). */
export const GUILD_EXIT: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], [7, 1, 3], [2, 8, 2], [13, 7, 2], [8, 8, 3], [13, 2, 3], [8, 10, 2],
];
/** Wilderness-to-city arrival square: row 0x3bd32, col 0x3bd39 (group 3, 0x5b74c). */
export const WILD_ARRIVAL: ReadonlyArray<readonly [number, number]> = [[-1, -1], [7, 0], [0, 4], [15, 7], [9, 0], [15, 6], [7, 15]];

/** 0x3c46a: street names (name-grid values 0..0x2b; anything else = "the Plaza"). */
export const STREET_NAMES = [
  'Alley', 'Main', 'Traveller', 'Scimitar', 'Claymore', 'Denizen', 'Battleaxe', 'Lowshield', 'Scepter', 'Spunspell',
  'Bluesteel', 'Ybarra', 'Brazen', 'Bogster', 'Corwin', 'Gordon', 'Flyblade', 'Shortspell', 'Mycroft', 'Masterstroke',
  'Jade Fist', 'Jabberwock', 'Knollglen', 'Crossblade', 'Riposte', 'Twister', 'Masonry', 'Craggy', 'Lower', 'Stoney',
  'Crafty', 'Balk', 'Far Archer', 'Apollo', 'Odin', 'Mithril', 'Mesmerizer', 'Tapestry', 'Trickster', 'Malarky',
  'Crescent', 'Zender', 'Bein', 'Marakesh',
];

export interface Bt2City {
  index: number;
  name: string;
  /** 512 B citys record: cells 0..255, street names 256..511 */
  grid: Uint8Array;
}

export function inside(row: number, col: number): boolean {
  return row >= 0 && row < CITY_N && col >= 0 && col < CITY_N;
}
export function cell(c: Bt2City, row: number, col: number): number {
  return inside(row, col) ? c.grid[row * CITY_N + col]! : 0;
}

// ───────────────────────────── movement ─────────────────────────────

export type CityAction =
  | { kind: 'move'; row: number; col: number }
  | { kind: 'turn'; message: string }
  | { kind: 'exit'; message: string }
  | { kind: 'dungeon'; dungeonId: number; record: number; message: string };

const DUNGEON_TEXT: Record<number, string> = {
  1: 'the Magician to the King ("Take the stairway") -> the Dark Domain',
  2: 'the Temple of Darkness ("Take the passage") -> the Tombs',
  4: "Dargoth's Tower",
  5: 'the Maze of Dread (the voice wants "DREAD")',
  6: "Oscon's Fortress (needs the right item)",
  8: 'the Rock (the Strange Mage wants "FREEZE PLEASE") -> the Destiny Stone',
};

/** What walking into a non-street cell does (`0x54834`). */
export function buildingAction(c: Bt2City, v: number): CityAction {
  const t = v >> 4;
  const turn = (message: string): CityAction => ({ kind: 'turn', message });
  switch (t) {
    case 0:
      return turn("You're in an empty building."); // 1 in 4: an encounter first (0x5486c)
    case 1:
      return turn('a tavern');
    case 2:
      return turn('a temple');
    case 3:
      return turn("the Adventurers' Guild (the game leaves the city for the guild menu)");
    case 4:
      return turn('the Review Board');
    case 5:
      return turn("Roscoe's Energy Emporium");
    case 6:
      return turn('a locked iron gate (opens for the item 0x6e, the Master Key)');
    case 8:
      return turn("Garth's Equipment Shoppe");
    case 9:
      return turn("the casino (Lagoth Zanta has stolen all the casino's gold)");
    case 10:
      return turn("Bedder's Bank for the Bold");
    case 12:
    case 14:
    case 15: {
      const id = CITY_DUNGEON[c.index] ?? 0;
      return { kind: 'dungeon', dungeonId: id, record: DUNGEON_BASE[id]!, message: DUNGEON_TEXT[id] ?? `dungeon ${id}` };
    }
    default:
      return turn(`I don't know. code == ${t}`);
  }
}

export function cityMove(c: Bt2City, row: number, col: number, facing: number): CityAction {
  const [dr, dc] = STEP[facing & 3]!;
  const r = row + dr;
  const k = col + dc;
  if (!inside(r, k)) return { kind: 'exit', message: `out of ${c.name} into the wilderness (not in the walker)` };
  const v = cell(c, r, k);
  if (v === 0) return { kind: 'move', row: r, col: k };
  return buildingAction(c, v);
}

export function locationText(c: Bt2City, row: number, col: number, facing: number): string {
  const n = c.grid[256 + row * CITY_N + col] ?? 0xff;
  const where = n <= 0x2b ? `You are on ${STREET_NAMES[n]} Street,` : "You're in the Plaza,";
  return `${where} facing ${FACING_NAMES[facing & 3]}.`;
}

// ───────────────────────────── view rows ─────────────────────────────

const VIEW_PARAMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -1, -1, 0],
  [-1, 0, 0, 1],
  [0, 1, 1, 0],
  [1, 0, 0, -1],
];

/** `0x595ee`: rows[d*3 + s]; sides masked to the facade nibble, centre kept whole except at distance 2 and 3. */
export function buildCityRows(c: Bt2City, row: number, col: number, facing: number): Uint8Array {
  const [sr, dr, sc, dc] = VIEW_PARAMS[facing & 3]!;
  const out = new Uint8Array(15);
  for (let d = 0; d < 5; d++) {
    const r = row + d * dr;
    const k = col + d * dc;
    out[d * 3] = cell(c, r + sr, k + sc) & 0xf;
    out[d * 3 + 1] = cell(c, r, k);
    out[d * 3 + 2] = cell(c, r - sr, k - sc) & 0xf;
  }
  out[7]! &= 0xf; // 0x597c0
  out[10]! &= 0xf;
  return out;
}

// ───────────────────────────── art ─────────────────────────────

export type Rect = [number, number, number, number];

/** 0x5a2d0 / 0x5a268: street-wall slices; slot 1..4 distance 2, 5..8 distance 1, 9..12 distance 0 (+ walk frame). */
export const SLICE_SRC: Rect[][] = [[[6,0,10,17],[14,0,18,17],[22,0,26,17],[30,0,34,17]],[[4,0,8,22],[12,0,16,22],[20,0,24,22],[28,0,32,22]],[[3,0,9,25],[11,0,17,25],[19,0,25,25],[27,0,33,25]],[[0,0,8,31],[16,0,24,31],[32,0,40,31],[48,0,56,31]],[[5,0,15,37],[21,0,31,37],[37,0,47,37],[53,0,63,37]],[[3,0,15,43],[18,0,30,43],[34,0,46,43],[50,0,62,43]],[[7,0,21,50],[23,0,37,50],[39,0,53,50],[55,0,69,50]],[[6,0,25,66],[30,0,49,66],[54,0,73,66],[78,0,97,66]],[[0,0,23,80],[24,0,47,80],[48,0,71,80],[72,0,95,80]],[[0,0,33,87],[40,0,73,87],[80,0,113,87],[120,0,153,87]],[[0,0,30,87],[32,0,62,87],[64,0,94,87],[96,0,126,87]],[[0,0,21,87],[24,0,45,87],[48,0,69,87],[72,0,93,87]],[[0,0,15,87],[16,0,31,87],[32,0,47,87],[48,0,63,87]]];
export const SLICE_DEST: Array<[number, number]> = [[46,35],[45,32],[44,29],[40,26],[35,23],[32,20],[29,17],[20,9],[13,2],[0,0],[0,0],[0,0],[0,0]];
/** 0x5a148 / 0x5a100: cross-street side faces; slot 1..4 distance 2, 5..8 distance 1. */
export const SIDE_SRC: Rect[][] = [[[8,0,31,17],[40,0,63,17],[74,0,95,17],[104,0,127,17]],[[4,0,31,21],[36,0,63,21],[68,0,95,21],[100,0,127,21]],[[5,0,39,25],[45,0,79,25],[86,0,119,25],[125,0,159,25]],[[7,0,47,31],[55,0,95,31],[103,0,143,31],[152,0,191,31]],[[0,0,39,37],[40,0,79,37],[80,0,119,37],[120,0,159,37]],[[0,0,39,44],[40,0,79,44],[80,0,119,44],[120,0,159,44]],[[0,0,31,51],[32,0,63,51],[64,0,95,51],[96,0,126,51]],[[0,0,23,66],[24,0,47,66],[48,0,71,66],[72,0,94,66]],[[0,0,15,80],[16,0,31,80],[32,0,47,80],[48,0,62,80]]];
export const SIDE_DEST: Array<[number, number]> = [[24,35],[20,32],[13,29],[8,26],[0,23],[0,19],[0,16],[0,9],[0,2]];
/** 0x5a4b0 / 0x5a470: fronts; slot 0 distance 3, 3 distance 2, 7 distance 1 (0x59464 takes slot - 1 when nonzero). */
export const FRONT_SRC: Rect[][] = [[[2,0,14,11],[18,0,30,11],[34,0,46,11],[50,0,62,11]],[[0,0,18,18],[24,0,42,18],[48,0,66,18],[72,0,90,18]],[[6,0,27,22],[38,0,59,22],[70,0,91,22],[102,0,123,22]],[[3,0,30,25],[35,0,62,25],[67,0,94,25],[99,0,126,25]],[[0,0,33,31],[40,0,73,31],[80,0,113,31],[120,0,153,31]],[[5,0,44,37],[53,0,92,37],[101,0,140,37],[149,0,188,37]],[[2,0,47,43],[50,0,95,43],[98,0,143,43],[146,0,191,43]],[[0,0,111,87],[112,0,223,87],[224,0,335,87],[336,0,447,87]]];
export const FRONT_DEST: Array<[number, number]> = [[50,38],[48,32],[46,30],[43,29],[40,26],[37,23],[34,20],[0,0]];
/** 0x5a5b0: `pics` picture for a special building straight ahead, by type (v >> 4); 0 = none. */
export const SPECIAL_PICS = [0, 17, 16, 21, 51, 44, 0, 0, 18, 0, 0, 0, 16, 15, 0, 0];

export const BIG_CITY_SIZE = 92744;
const SLICE_SIDE_BYTES = 0xe318;
const FRONT_BYTES = 0x8710;

export interface Bitmap {
  offset: number;
  bpr: number;
  rows: number;
}
export interface CityLayout {
  slice: Bitmap[];
  side: Bitmap[];
  front: Bitmap[];
}

/** `0x59c10`: carve the three bitmap sets out of big_city; throws unless each buffer is filled exactly. */
export function bigCityLayout(): CityLayout {
  let cur = 32;
  const carve = (src: Rect[][]) =>
    src.map((v) => {
      const bpr = ((v[3]![2] + 16) >> 4) << 1;
      const rows = v[3]![3] + 1;
      const bm = { offset: cur, bpr, rows };
      cur += bpr * rows * 4;
      return bm;
    });
  const slice = carve(SLICE_SRC);
  const side = carve(SIDE_SRC);
  if (cur !== 32 + SLICE_SIDE_BYTES) throw new Error(`big_city slice+side bitmaps end at ${cur}, expected ${32 + SLICE_SIDE_BYTES}`);
  const front = carve(FRONT_SRC);
  if (cur !== 32 + SLICE_SIDE_BYTES + FRONT_BYTES || cur !== BIG_CITY_SIZE) throw new Error(`big_city front bitmaps end at ${cur}`);
  return { slice, side, front };
}

export interface CityArt {
  palette: number[];
  data: Uint8Array;
  pictures: Record<number, { px: Uint8Array; palette: number[] }>;
}

/** `0x44e00`: opaque copy of an inclusive source rect from a 4-plane bitmap to (dx, dy), clipped to the view. */
function blit(dst: Uint8Array, data: Uint8Array, bm: Bitmap, src: Rect, dx: number, dy: number): void {
  const ps = bm.bpr * bm.rows;
  for (let j = 0; j <= src[3] - src[1]; j++) {
    const y = dy + j;
    const sy = src[1] + j;
    if (y < 0 || y >= VIEW_H || sy >= bm.rows) continue;
    for (let i = 0; i <= src[2] - src[0]; i++) {
      const x = dx + i;
      const sx = src[0] + i;
      if (x < 0 || x >= VIEW_W || sx >= bm.bpr * 8) continue;
      let v = 0;
      for (let p = 0; p < 4; p++) v |= ((data[bm.offset + p * ps + sy * bm.bpr + (sx >> 3)]! >> (7 - (sx & 7))) & 1) << p;
      dst[y * VIEW_W + x] = v;
    }
  }
}

const facade = (v: number) => (v > 4 ? (v & 3) + 1 : v);

function draw(art: CityArt, dst: Uint8Array, bms: Bitmap[], srcs: Rect[][], dests: Array<[number, number]>, v: number, slot: number, xoff: number): void {
  const f = facade(v);
  if (f < 1 || f > 4) return;
  blit(dst, art.data, bms[slot]!, srcs[slot]![f - 1]!, dests[slot]![0] + xoff, dests[slot]![1]);
}

/** `0x44ee0`: mirror the right half (x 56..111) in place. */
function flipRightHalf(f: Uint8Array): void {
  for (let y = 0; y < VIEW_H; y++)
    for (let i = 0; i < 28; i++) {
      const a = y * VIEW_W + 56 + i;
      const b = y * VIEW_W + 111 - i;
      const t = f[a]!;
      f[a] = f[b]!;
      f[b] = t;
    }
}

export interface CityFrame {
  px: Uint8Array;
  palette: number[];
  picture?: number;
}

/** `0x59826` with frame 0 (standing still). */
export function renderCityView(art: CityArt, lay: CityLayout, c: Bt2City, row: number, col: number, facing: number): CityFrame {
  const v = buildCityRows(c, row, col, facing);
  const out = new Uint8Array(VIEW_W * VIEW_H);
  for (let i = 0; i < out.length; i++) out[i] = i < 46 * VIEW_W ? 1 : 2; // 0x59ba8
  const slice = (val: number, slot: number, x: number) => draw(art, out, lay.slice, SLICE_SRC, SLICE_DEST, val, slot, x);
  const side = (val: number, slot: number, x: number) => draw(art, out, lay.side, SIDE_SRC, SIDE_DEST, val, slot, x);
  const front = (val: number, slot: number) =>
    draw(art, out, lay.front, FRONT_SRC, FRONT_DEST, val, slot ? slot - 1 : 0, 0);
  const frame = 0;
  // (frame 3 only: distance-3 sides, slot 0)
  if (v[6]) {
    if (!v[3]) side(v[6]!, frame + 1, 0);
    slice(v[6]!, frame + 1, 0);
  }
  if (v[8]) {
    if (!v[5]) side(v[8]!, frame + 1, 56);
    slice(v[8]!, frame + 1, 56);
  }
  if (v[3]) {
    if (!v[0]) side(v[3]!, frame + 5, 0);
    slice(v[3]!, frame + 5, 0);
  }
  if (v[5]) {
    if (!v[2]) side(v[5]!, frame + 5, 56);
    slice(v[5]!, frame + 5, 56);
  }
  if (v[0]) slice(v[0]!, frame + 9, 0);
  if (v[2]) slice(v[2]!, frame + 9, 56);
  flipRightHalf(out);
  const ahead = v[4]! & 0xf;
  if (ahead) {
    const pic = SPECIAL_PICS[v[4]! >> 4] ?? 0;
    if (pic && art.pictures[pic]) return { px: art.pictures[pic]!.px, palette: art.pictures[pic]!.palette, picture: pic };
    front(ahead, 8);
  } else if (v[7]) front(v[7]!, frame + 4);
  else if (v[10]) front(v[10]!, frame);
  return { px: out, palette: art.palette };
}
