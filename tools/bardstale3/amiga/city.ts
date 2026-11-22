/**
 * The Bard's Tale III (Amiga): city / wilderness grid maps (maps 0-9), their move rule and first-person view.
 *
 * Browser-safe (no node imports). Every table is read out of the game program `bard3` by `export-city.ts`; the
 * code below is an original re-implementation of the routines those tables feed. Addresses are bard3 flat
 * addresses (CODE at 0, DATA at 0x1eb00), as in dungeon.ts. See docs/bardstale3/amiga/data-structure.md §5.
 *
 * City record (decoded maps.lo/maps.hi record, map index 0-9; loader 0x2332):
 *   0x00 name (16 B, high-bit ASCII, 0xff pad)
 *   0x10 width W (0x28c32)   0x11 height H (0x28c33)
 *   0x12 flags: bit 0 random encounters (1 in 32 per step, 0x2464), bit 1 coordinates wrap (0x28c34; else the edge
 *        stops the party, 0x262e)
 *   0x13 monster set (0x97d2)
 *   0x14 bits 6-7 wall-art file (filename table DATA 0x20698[v]: 0 wildwal.grp, 1/2 skara.grp, 3 gdung.grp),
 *        bits 0-2 encounter level (0x26947)
 *   0x15 u16LE offset of the special-square list (same layout as the dungeon one, matched by E9B6)
 *   0x17 u16LE[H] offset of row y (stored last row first); a cell is ONE byte at row[y] + x.
 * Cell byte: low nibble = art piece (0 none, n -> piece n-1 of the GRP); high nibble = function:
 *   0 open (passable whatever the piece), 0xe solid, 0xf passable special; 1..9 = building entered from the front
 *   (0x2780 jump table: 1 camp, 2 tavern, 3 temple, 4 empty building, 6 storage building, 7 review (guild elder),
 *   8 hall of wizards, 9 bard's hall; 5 = none) -- a building cell is passable only if its piece is 0 (0x2736).
 * Position: pose.y = row (0x268de), pose.x = column (0x268e0); facing 0..3 = N, E, S, W; forward =
 * row - DATA 0x20aa2[f], col + DATA 0x20aaa[f] (0x25ac), i.e. N = +row, E = +col -- the same frame as the dungeons.
 */
import { drawSlot, VIEW_W, VIEW_H, VIEW_BPR, type DungeonArt, type GrpPiece, type ViewTables } from './dungeon.ts';

export interface CityTables {
  /** DATA 0x20b5a -> 4 x 21 (dcol, drow) pairs: city view cell k for facing f */
  cellOffsets: Array<Array<[number, number]>>;
  /** DATA 0x20c21: 17 draw steps -> city view cell */
  stepCell: number[];
  /** DATA 0x20f33: 17 draw steps -> slot of the shared 61-slot geometry (x/y/width/GRP offset/scale/mirror) */
  stepSlot: number[];
  /** DATA 0x20aa2 / 0x20aaa: row is decremented by dRow[f], column incremented by dCol[f] on a step */
  dRow: number[];
  dCol: number[];
  /** 0x28fc / 0x2900 / 0x1d040: the view is cleared to `skyByte` for `skyLen` bytes, then `groundByte` for `groundLen` */
  skyByte: number;
  skyLen: number;
  groundByte: number;
  groundLen: number;
  /** DATA 0x20868 (day) / 0x208c8 (night: flag 0x28c36 = hour < 6 or > 18, 0x35e2 / 0x728a) */
  palette: number[];
  nightPalette: number[];
  /** directory byte limit for a city piece (0x9b92: 20 unless the dungeon flag 0x268e4 is set) */
  grpLimit: number;
  /** 0x2dda: a new game starts on map 0 at row 11, column 15, facing north */
  newGame: { map: number; y: number; x: number; facing: number };
}

export interface CitySpecial {
  /** 0x7f = any row; bit 7 set = matched only by the other E9B6 pass (not a step) */
  y: number;
  /** 0xff = any column */
  x: number;
  op: number;
  script: number;
  /** first opcode 3 (0xcff2) in a city: y, x, target (bit 7 = dungeon index, else city map) */
  teleport?: { y: number; x: number; target: number };
}

export interface Bt3City {
  map: number;
  name: string;
  w: number;
  h: number;
  flags: number;
  monsterSet: number;
  artSet: number;
  /** w*h bytes, row-major from row 0 (south) */
  cells: Uint8Array;
  specials: CitySpecial[];
}

const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);

export function cityName(rec: Uint8Array): string {
  let s = '';
  for (let k = 0; k < 16 && rec[k] !== 0xff; k++) s += String.fromCharCode(rec[k]! & 0x7f);
  return s.trim();
}

/** Parse a decoded city / wilderness record (maps 0-9). */
export function parseCity(rec: Uint8Array, map: number): Bt3City {
  const w = rec[0x10]!;
  const h = rec[0x11]!;
  if (!w || !h) throw new Error('not a city record');
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ro = u16le(rec, 0x17 + 2 * y);
    if (ro + w > rec.length) throw new Error(`city row ${y} offset ${ro} out of range`);
    cells.set(rec.subarray(ro, ro + w), y * w);
  }
  const so = u16le(rec, 0x15);
  const specials: CitySpecial[] = [];
  for (let i = 0; i < rec[so]!; i++) {
    const e = so + 1 + 4 * i;
    const script = u16le(rec, e + 2);
    const op = (rec[script] ?? 0xff) & 0x7f;
    const sp: CitySpecial = { y: rec[e]!, x: rec[e + 1]!, op, script };
    if (op === 3) sp.teleport = { y: rec[script + 1]!, x: rec[script + 2]!, target: rec[script + 3]! };
    specials.push(sp);
  }
  return {
    map,
    name: cityName(rec),
    w,
    h,
    flags: rec[0x12]!,
    monsterSet: rec[0x13]!,
    artSet: rec[0x14]! >> 6,
    cells,
    specials,
  };
}

export const cityWraps = (c: Bt3City) => (c.flags & 2) !== 0;
const wrap = (v: number, n: number) => ((v % n) + n) % n;

/** 0x2cec: the cell byte at (col, row); off-map = 0 (open, nothing drawn) unless the map wraps. */
export function cityCell(c: Bt3City, x: number, y: number): number {
  if (cityWraps(c)) return c.cells[wrap(y, c.h) * c.w + wrap(x, c.w)]!;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return 0;
  return c.cells[y * c.w + x]!;
}

/** 0x2736: may the party step onto a square holding this cell byte? */
export function cityPassable(cell: number): boolean {
  const hi = cell & 0xf0;
  if (hi === 0) return true;
  if (hi === 0xe0) return false;
  if (hi === 0xf0) return true;
  return (cell & 15) === 0;
}

/** 0x2780 jump table (high nibble -> handler); null = no building. */
export const BUILDINGS: Record<number, string> = {
  1: 'the Camp (0x4e62)',
  2: 'a tavern (0x5468)',
  3: 'a temple (0x5c00)',
  4: 'an empty building (0x65a6)',
  6: 'a storage building (0x6626)',
  7: 'the Review Board / guild elder (0x177b0)',
  8: 'the hall of wizards (0x19312)',
  9: "the Bard's Hall (0x1b37c)",
};
export function cityBuilding(cell: number): string | null {
  return BUILDINGS[cell >> 4] ?? null;
}

/**
 * 0x25ac..0x266e: the square one step ahead, or null when a bounded map stops the party at its edge.
 * Passability is checked separately (0x2736 on the cell ahead).
 */
export function cityStep(t: CityTables, c: Bt3City, x: number, y: number, facing: number): [number, number] | null {
  const ny = y - t.dRow[facing & 3]!;
  const nx = x + t.dCol[facing & 3]!;
  if (cityWraps(c)) return [wrap(nx, c.w), wrap(ny, c.h)];
  if (nx < 0 || ny < 0 || nx >= c.w || ny >= c.h) return null;
  return [nx, ny];
}

/** The cell byte straight ahead (city view cell 16, the byte 0x287e returns). */
export function cellAhead(t: CityTables, c: Bt3City, x: number, y: number, facing: number): number {
  const o = t.cellOffsets[facing & 3]![16]!;
  return cityCell(c, x + o[0], y + o[1]);
}

/** 0x287e: compose the 112x88 chunky city view (one palette index per pixel). */
export function renderCityView(
  t: CityTables,
  view61: ViewTables,
  entries: Array<GrpPiece | null>,
  c: Bt3City,
  x: number,
  y: number,
  facing: number,
): Uint8Array {
  const offs = t.cellOffsets[facing & 3]!;
  const cells = offs.map(([dx, dy]) => cityCell(c, x + dx, y + dy));
  const view = new Uint8Array(VIEW_BPR * VIEW_H);
  view.fill(t.skyByte, 0, t.skyLen);
  view.fill(t.groundByte, t.skyLen, t.skyLen + t.groundLen);
  const art: DungeonArt = { tables: view61, entries };
  for (let s = 0; s < t.stepCell.length; s++) {
    const piece = cells[t.stepCell[s]!]! & 15;
    if (piece) drawSlot(view, art, t.stepSlot[s]!, piece - 1, t.grpLimit);
  }
  const out = new Uint8Array(VIEW_W * VIEW_H);
  for (let i = 0; i < view.length; i++) {
    out[2 * i] = view[i]! >> 4;
    out[2 * i + 1] = view[i]! & 15;
  }
  return out;
}
