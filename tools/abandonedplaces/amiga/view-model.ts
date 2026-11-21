/**
 * Abandoned Places 1 (Amiga) first-person view model. Port of the dungeon view in the unpacked
 * `module` (HUNK offsets): backdrop blit 0xDDE4 (ceiling/floor, parity-selected half of backgndN),
 * then the wall pass 0xAE3A: 41 draw-list entries far -> near, each `(piece, view-cell)`; a piece
 * of `moduleN` is blitted (0xD590 -> 0xD740, cookie-cut with its mask plane) when its view cell is
 * solid (grid bit 0x0001) or an illusory wall (bit 0x2000, drawn unless the detect flag 0x8ED8 is set).
 * View window = screen (32,4) 144x96. Pieces carry screen coordinates, so a few spill past the window
 * and are clipped here (the original covers the spill with the frame redrawn afterwards, 0xDED6/0xDFCE).
 * NOT drawn: wall-mounted objects, doors/gates, stairs art, monsters, items (see TODO ap1-entities).
 * Pure: no DOM, no fs.
 */
export const VIEW_W = 144;
export const VIEW_H = 96;
const WIN_X = 32, WIN_Y = 4;

export interface Piece { w: number; h: number; x: number; y: number }
export interface Ap1Tables {
  pieces: (Piece & { off: number })[];
  viewOffsets: number[][];
  drawList: { piece: number; cell: number }[];
  backdropParity: number[];
  palette: number[];
}
export interface Ap1Area { words: number[] }
export interface Teleport { type: number; x: number; y: number; dx: number; dy: number; facing: number; area: number; level: number }
export interface Ap1Level {
  id: number; label: string; index: number; file: string;
  grid: Uint16Array; areas: number[][]; teleports: Teleport[]; doors: { type: number; x: number; y: number; orient: number; state: number }[];
  start: { x: number; y: number; facing: number; area: number };
}
export type Facing = 0 | 1 | 2 | 3; // 0 = north (-y), 1 = east, 2 = south, 3 = west (move tables 0xAD62)
export const DELTAS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Indexed art of one theme: the 25 module pieces and the two backdrop halves. */
export interface Theme { pieces: Uint8Array[]; halves: Uint8Array[] }

export function decodeLevel(j: { id: number; label: string; index: number; file: string; grid: number[]; areas: number[][]; teleports: Teleport[]; doors: Ap1Level['doors']; start: Ap1Level['start'] }): Ap1Level {
  return { ...j, grid: Uint16Array.from(j.grid) };
}
export function fromB64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

export const SOLID = 0x0001, ILLUSORY = 0x2000, MONSTER_BLOCK = 0x4000;

/** Out-of-map cells read as 0 (0xAEF6: coordinate >= 32 unsigned). */
export function cellAt(l: Ap1Level, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= 32 || y >= 32) return 0;
  return l.grid[y * 32 + x];
}
export function isWallView(v: number, seeIllusions = false): boolean {
  return (v & SOLID) !== 0 || (!seeIllusions && (v & ILLUSORY) !== 0);
}
export function teleportAt(l: Ap1Level, x: number, y: number): Teleport | undefined {
  return l.teleports.find((t) => t.x === x && t.y === y);
}
/**
 * Party can-step test (0x5C0C): grid bit 0 blocks; 0x2000 and 0x4000 do not (0x4000 only stops monsters,
 * 0x6890). Monsters (bit 3) and closed doors (list 6, state&7 < 2) are not modelled.
 */
export function canEnter(l: Ap1Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= 32 || y >= 32) return false;
  return (cellAt(l, x, y) & SOLID) === 0;
}

export interface RenderOpts { seeIllusions?: boolean; trace?: number[] }

export function areaIds(l: Ap1Level, area: number): { backgnd: number; module: number } {
  const w = l.areas[area] ?? l.areas[0];
  return { backgnd: w[0], module: w[3] }; // 1-based file numbers (0x1155C loader: word - 1 indexes the name list)
}

export function renderView(l: Ap1Level, t: Ap1Tables, th: Theme, px: number, py: number, facing: Facing, opts: RenderOpts = {}): Uint8Array {
  const out = new Uint8Array(VIEW_W * VIEW_H);
  // backdrop: table 0xDE96 indexed (x&1) + 2*(y&1) + 4*facing
  const half = t.backdropParity[(px & 1) + 2 * (py & 1) + 4 * facing] & 1;
  out.set(th.halves[half]);
  const offs = t.viewOffsets[facing];
  for (const e of t.drawList) {
    const vx = px + offs[(e.cell - 1) * 2], vy = py + offs[(e.cell - 1) * 2 + 1];
    if (!isWallView(cellAt(l, vx, vy), opts.seeIllusions)) continue;
    opts.trace?.push(e.piece);
    const g = t.pieces[e.piece], pix = th.pieces[e.piece], pw = g.w * 8;
    for (let y = 0; y < g.h; y++) {
      const wy = g.y + y - WIN_Y;
      if (wy < 0 || wy >= VIEW_H) continue;
      for (let x = 0; x < pw; x++) {
        const wx = g.x + x - WIN_X;
        if (wx < 0 || wx >= VIEW_W) continue;
        const v = pix[y * pw + x];
        if (v !== 255) out[wy * VIEW_W + wx] = v;
      }
    }
  }
  return out;
}

/** 12-bit Amiga RGB -> 8-bit. */
export function paletteRGB(words: number[]): [number, number, number][] {
  return words.map((w) => [((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]);
}
