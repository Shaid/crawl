/**
 * Dungeon Master II (Amiga) first-person viewport compositor (224x136).
 *
 * Original code. It reproduces what SKUL.FTL's view code does, read from the
 * Amiga disassembly (CODE offsets; flat address = CODE + 0x10000):
 *
 *  - background (CODE+0x18bb0): floor = wallset picture S=0 at rect 701, ceiling
 *    = S=1 at rect 700, both opaque; each mirrored according to the scene flags
 *    (wallset word S=101) and the position parity routine at CODE+0x187d0:
 *    parity = (x + y + facing + map.offsetX + map.offsetY + map.level) & 1;
 *  - tiles (CODE+0x18006): the 20 cells in the draw order from SKUL.FTL's data,
 *    far to near; a cell whose square is a wall gets DRAW_WALL (CODE+0x17e4a):
 *    piece = cell + 0x22 (cells 1-15) or 0x32 (D4 cells 16-20), rect = cell + 702,
 *    mirrored when the cell is right of centre; on "flipped" squares (parity 1)
 *    a near cell takes its mirror partner's piece instead and the mirror bit
 *    covers the centre column too; pixels equal to the wallset colour key
 *    (word S=100) are transparent.
 *
 *  - doors (CODE+0x17c50 door tile, CODE+0x178d8 door panel): a door square seen
 *    across its passage axis ((attr bit 3) != (facing & 1)) on a cell whose
 *    door-visible byte is set draws the door type's panel S = distance-1 at the
 *    cell's door rect (+state for half-open states), keyed by the door colour key.
 *
 * Not yet drawn (TODO `dm2-viewport-objects`): door frames/pillars and door
 * ornaments, the D0 (party on the door square) panel, stairs, pits,
 * wall/floor ornaments, outdoor sky elements, items and creatures.
 * Lighting: palette bank 0 (full light) only.
 */
import { DX, DY, sqType, SQ, type DoorStates, type Dm2Map, type Pose4 } from './model.ts';

export const VIEW_W = 224;
export const VIEW_H = 136;

export interface ResolvedRect { x: number; y: number; align: number }
export interface VpPiece { w: number; h: number; offX: number; offY: number; px: string }
export interface VpWallset {
  id: number;
  palettes: Array<Array<[number, number, number]>>;
  colorKey: number;
  sceneFlags: number;
  pieces: Record<string, VpPiece>;
}
export interface ViewportTables {
  xDist: number[]; yDist: number[]; flipPartner: number[]; ornateClass: number[]; drawOrder: number[];
  doorVisible: number[]; doorRect: number[];
}
export interface VpDoorType { id: number; colorKey: number; pieces: Record<string, VpPiece> }
export interface ViewportAsset { tables: ViewportTables; rects: Record<string, ResolvedRect>; wallsets: Record<string, VpWallset>; doors: Record<string, VpDoorType> }

const RECT_CEILING = 700;
const RECT_FLOOR = 701;
const RECT_CELL_BASE = 702;

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const nibbleCache = new WeakMap<VpPiece, Uint8Array>();
/** Piece pixels as one colour nibble per byte. */
export function pieceNibbles(p: VpPiece): Uint8Array {
  let n = nibbleCache.get(p);
  if (!n) {
    const packed = b64(p.px);
    n = new Uint8Array(p.w * p.h);
    for (let i = 0; i < n.length; i++) n[i] = i & 1 ? packed[i >> 1]! & 15 : packed[i >> 1]! >> 4;
    nibbleCache.set(p, n);
  }
  return n;
}

/** Point inside a w x h box for anchor code 0-8 (0 centre, 1 TL, 2 TR, 3 BR, 4 BL, 5 top, 6 right, 7 bottom, 8 left). */
export function anchorIn(code: number, w: number, h: number): [number, number] {
  const cx = (w + 1) >> 1, cy = (h + 1) >> 1;
  switch (code) {
    case 0: return [cx, cy];
    case 1: return [0, 0];
    case 2: return [w - 1, 0];
    case 3: return [w - 1, h - 1];
    case 4: return [0, h - 1];
    case 5: return [cx, 0];
    case 6: return [w - 1, cy];
    case 7: return [cx, h - 1];
    default: return [0, cy];
  }
}

/** Position parity used for the alternating (mirrored) scene graphics. */
export function sceneParity(map: Pick<Dm2Map, 'offsetX' | 'offsetY' | 'level'>, pose: Pose4): number {
  return (pose.x + pose.y + pose.facing + map.offsetX + map.offsetY + map.level) & 1;
}

/** Floor / ceiling mirror bits from the scene flags (tick-animated variants use tick 0). */
export function backgroundMirror(flags: number, parity: number, facing: number): { floor: boolean; ceiling: boolean } {
  let floor = false;
  if (flags & 8) floor = flags & 0x10 ? false : parity === 1;
  else if (flags & 0x40) floor = (facing & 1) === 1;
  let ceiling = false;
  if (flags & 2) ceiling = flags & 4 ? true : parity === 0;
  else if (flags & 0x20) ceiling = (facing & 1) === 1;
  return { floor, ceiling };
}

/** Which wall piece and mirror bit DRAW_WALL uses for viewport cell `cell`. */
export function wallPieceFor(t: ViewportTables, cell: number, flipped: boolean): { piece: number; mirror: boolean } {
  const xd = t.xDist[cell]!;
  if (cell >= 16) {
    let m = xd > 0;
    if (xd === 2 || xd === -2) m = false;
    return { piece: 0x32, mirror: m !== flipped };
  }
  if (flipped) return { piece: t.flipPartner[cell]! + 0x22, mirror: xd >= 0 };
  return { piece: cell + 0x22, mirror: xd > 0 };
}

/** Map square for a viewport cell, relative to the party. */
export function cellSquare(t: ViewportTables, pose: Pose4, cell: number): { x: number; y: number } {
  const f = pose.facing & 3;
  const r = (f + 1) & 3;
  const fwd = t.yDist[cell]!, lat = t.xDist[cell]!;
  return { x: pose.x + DX[f]! * fwd + DX[r]! * lat, y: pose.y + DY[f]! * fwd + DY[r]! * lat };
}

/** True when the square renders as a wall block (outside the map counts as wall). */
export function isWallSquare(map: Dm2Map, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const raw = map.raw[y * map.width + x]!;
  const t = sqType(raw);
  return t === SQ.WALL || (t === SQ.TRICKWALL && (raw & 4) === 0);
}

export class Canvas {
  readonly rgba = new Uint8ClampedArray(VIEW_W * VIEW_H * 4);
  private readonly pal: Array<[number, number, number]>;
  constructor(pal: Array<[number, number, number]>) {
    this.pal = pal;
    for (let i = 0; i < VIEW_W * VIEW_H; i++) this.rgba[i * 4 + 3] = 255;
  }
  /** Blit a piece with its `align` anchor on the rect point; `key` < 0 = opaque. */
  draw(p: VpPiece, rr: ResolvedRect, mirror: boolean, key: number): void {
    const nib = pieceNibbles(p);
    const offX = mirror ? -p.offX : p.offX;
    const [ax, ay] = anchorIn(rr.align, p.w, p.h);
    const x0 = rr.x + offX - ax;
    const y0 = rr.y + p.offY - ay;
    for (let y = 0; y < p.h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= VIEW_H) continue;
      for (let x = 0; x < p.w; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= VIEW_W) continue;
        const c = nib[y * p.w + (mirror ? p.w - 1 - x : x)]!;
        if (c === key) continue;
        const rgb = this.pal[c]!;
        const o = (sy * VIEW_W + sx) * 4;
        this.rgba[o] = rgb[0]; this.rgba[o + 1] = rgb[1]; this.rgba[o + 2] = rgb[2];
      }
    }
  }
}

export interface ViewportFrameInfo { wallset: number; parity: number; walls: number[]; doors?: number[] }

/** Draw a door panel for a door square facing the party; true when the square was a door square. */
function drawDoor(cv: Canvas, asset: ViewportAsset, map: Dm2Map, pose: Pose4, cell: number, x: number, y: number, doors?: DoorStates): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const idx = y * map.width + x;
  const raw = map.raw[idx]!;
  if (sqType(raw) !== SQ.DOOR) return false;
  if (((raw >> 3) & 1) === (pose.facing & 1)) return true; // seen along the wall: door frame only (not drawn yet)
  const t = asset.tables;
  if (!t.doorVisible[cell]) return true;
  const state = doors ? doors.get(map, idx) : raw & 7;
  const dist = t.yDist[cell]!;
  const rectId = t.doorRect[cell]!;
  if (state === 0 || dist < 1 || dist > 3 || rectId < 0) return true;
  const kind = map.doorKinds?.[idx] ?? 0;
  const type = asset.doors[map.doorTypes?.[kind] ?? -1];
  const p = type?.pieces[dist - 1];
  const rr = asset.rects[rectId + (state < 4 ? state : 0)];
  if (!type || !p || !rr) return true;
  cv.draw(p, rr, false, type.colorKey);
  return true;
}

/** Compose the first-person view. Returns null when the map's wallset is not in the asset. */
export function renderViewport(asset: ViewportAsset, map: Dm2Map, pose: Pose4, info?: ViewportFrameInfo, doors?: DoorStates): Uint8ClampedArray | null {
  const ws = asset.wallsets[map.mapGraphicsStyle];
  if (!ws) return null;
  const t = asset.tables;
  const cv = new Canvas(ws.palettes[0]!);
  const parity = sceneParity(map, pose);
  const bg = backgroundMirror(ws.sceneFlags, parity, pose.facing);
  const floor = ws.pieces[0];
  const ceil = ws.pieces[1];
  if (floor) cv.draw(floor, asset.rects[RECT_FLOOR]!, bg.floor, -1);
  if (ceil) cv.draw(ceil, asset.rects[RECT_CEILING]!, bg.ceiling, -1);
  const walls: number[] = [];
  for (const cell of t.drawOrder) {
    const sq = cellSquare(t, pose, cell);
    if (cell < 16 && drawDoor(cv, asset, map, pose, cell, sq.x, sq.y, doors)) continue;
    if (!isWallSquare(map, sq.x, sq.y)) continue;
    const { piece, mirror } = wallPieceFor(t, cell, parity === 1);
    const p = ws.pieces[piece];
    const rr = asset.rects[RECT_CELL_BASE + cell];
    if (!p || !rr) continue;
    cv.draw(p, rr, mirror, ws.colorKey);
    walls.push(cell);
  }
  if (info) { info.wallset = ws.id; info.parity = parity; info.walls = walls; }
  return cv.rgba;
}
