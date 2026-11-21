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
 *  - doors (CODE+0x17c50 door tile, CODE+0x178d8 door panel, CODE+0x176ea frames):
 *    a door square seen across its passage axis ((attr bit 3) != (facing & 1)) on a
 *    cell whose door-visible byte is set draws: the "before" frames for that cell
 *    (roof slit at its rect; left pillar at creature rect cell*25+10 anchored
 *    bottom-left; right pillar at cell*25+14, mirrored, anchored bottom-right; on
 *    flipped squares the pillars come from the partner cell, swapped), then the door
 *    type's panel S = distance-1 at the cell's door rect when the door is not open,
 *    then the "after" frames. A door square seen along its axis at D1 shows the
 *    wallset's side-on frame S=6 scaled 43/64 at creature rect 3*25+2.
 *
 * Not yet drawn (TODO `dm2-viewport-objects`): door ornaments, door buttons, the
 * D0 (party on the door square) panel, stairs, pits, wall/floor ornaments,
 * outdoor sky elements, items and creatures. Lighting: palette bank 0 only.
 * The 43/64 scaling uses nearest-neighbour with size = (n*s+32)>>6 (hypothesis).
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
  doorVisible: number[]; doorRect: number[]; slitPiece: number[]; slitRect: number[]; framePieces: number[];
}
export interface VpDoorType { id: number; colorKey: number; noFrames: boolean; pieces: Record<string, VpPiece> }

/** Door-frame flags per cell (SKUL.FTL door-tile switch, CODE+0x17d18): 1 slit, 2 left pillar, 4 right pillar. */
export const DOOR_FRAMES_BEFORE: Record<number, number> = { 0: 6, 3: 7, 4: 1, 5: 1, 6: 7, 7: 1, 8: 1, 11: 6, 12: 2, 13: 4, 14: 0, 15: 0 };
export const DOOR_FRAMES_AFTER: Record<number, number> = { 4: 4, 5: 2, 7: 4, 8: 2, 12: 4, 13: 2 };
const creatureRect = (cell: number, pos: number) => 5000 + cell * 25 + pos;
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
  /**
   * Blit a piece with its anchor on the rect point; `key` < 0 = opaque. `align`
   * overrides the rect's anchor code; `scale` (64 = 1:1) shrinks the piece.
   */
  draw(p: VpPiece, rr: ResolvedRect, mirror: boolean, key: number, align = rr.align, scale = 64): void {
    const nib = pieceNibbles(p);
    const sz = (n: number) => (scale === 64 ? n : Math.max(1, (n * scale + 32) >> 6));
    const w = sz(p.w), h = sz(p.h);
    const offX = scale === 64 ? p.offX : Math.round((p.offX * scale) / 64);
    const offY = scale === 64 ? p.offY : Math.round((p.offY * scale) / 64);
    const [ax, ay] = anchorIn(align, w, h);
    const x0 = rr.x + (mirror ? -offX : offX) - ax;
    const y0 = rr.y + offY - ay;
    for (let y = 0; y < h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= VIEW_H) continue;
      const ry = scale === 64 ? y : Math.min(p.h - 1, Math.floor((y * p.h) / h));
      for (let x = 0; x < w; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= VIEW_W) continue;
        const dx = mirror ? w - 1 - x : x;
        const rx = scale === 64 ? dx : Math.min(p.w - 1, Math.floor((dx * p.w) / w));
        const c = nib[ry * p.w + rx]!;
        if (c === key) continue;
        const rgb = this.pal[c]!;
        const o = (sy * VIEW_W + sx) * 4;
        this.rgba[o] = rgb[0]; this.rgba[o + 1] = rgb[1]; this.rgba[o + 2] = rgb[2];
      }
    }
  }
}

export interface ViewportFrameInfo { wallset: number; parity: number; walls: number[]; doors?: number[] }

function doorTypeOf(asset: ViewportAsset, map: Dm2Map, idx: number): VpDoorType | undefined {
  const kind = map.doorKinds?.[idx] ?? 0;
  return asset.doors[map.doorTypes?.[kind] ?? -1];
}

/** DRAW_DOOR_FRAMES: roof slit (1), left pillar (2), right pillar (4). */
function drawDoorFrames(cv: Canvas, asset: ViewportAsset, ws: VpWallset, type: VpDoorType | undefined, cell: number, flags: number, flipped: boolean): void {
  if (!flags || !type || type.noFrames) return;
  const t = asset.tables;
  if (flags & 1 && cell < 14 && t.slitPiece[cell] !== 255) {
    const p = ws.pieces[t.slitPiece[cell]!];
    const rr = asset.rects[t.slitRect[cell]!];
    if (p && rr) cv.draw(p, rr, false, ws.colorKey);
  }
  const local = flipped ? t.flipPartner[cell]! : cell;
  const [li, ri] = flipped ? [1, 0] : [0, 1];
  if (local >= 14) return;
  if (flags & 2) {
    const s = t.framePieces[local * 2 + li]!;
    const p = ws.pieces[s];
    const rr = asset.rects[creatureRect(cell, 10)];
    if (s !== 255 && p && rr) cv.draw(p, rr, false, ws.colorKey, 4);
  }
  if (flags & 4) {
    const s = t.framePieces[local * 2 + ri]!;
    const p = ws.pieces[s];
    const rr = asset.rects[creatureRect(cell, 14)];
    if (s !== 255 && p && rr) cv.draw(p, rr, true, ws.colorKey, 3);
  }
}

/** Door square handling for a viewport cell; true when the square was a door square (nothing else to draw). */
function drawDoor(cv: Canvas, asset: ViewportAsset, ws: VpWallset, map: Dm2Map, pose: Pose4, cell: number, x: number, y: number, flipped: boolean, doors?: DoorStates): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const idx = y * map.width + x;
  const raw = map.raw[idx]!;
  if (sqType(raw) !== SQ.DOOR) return false;
  const type = doorTypeOf(asset, map, idx);
  if (((raw >> 3) & 1) === (pose.facing & 1)) {
    // seen along its axis (class 0x10): only the D1 side-on frame
    const p = ws.pieces[6];
    const rr = asset.rects[creatureRect(3, 2)];
    if (cell === 3 && type && !type.noFrames && p && rr) cv.draw(p, rr, flipped, ws.colorKey, rr.align, 0x2b);
    return true;
  }
  const t = asset.tables;
  if (!t.doorVisible[cell]) return true;
  drawDoorFrames(cv, asset, ws, type, cell, DOOR_FRAMES_BEFORE[cell] ?? 0, flipped);
  const state = doors ? doors.get(map, idx) : raw & 7;
  const dist = t.yDist[cell]!;
  const rectId = t.doorRect[cell]!;
  if (state !== 0 && dist >= 1 && dist <= 3 && rectId >= 0) {
    const p = type?.pieces[dist - 1];
    const rr = asset.rects[rectId + (state < 4 ? state : 0)];
    if (type && p && rr) cv.draw(p, rr, false, type.colorKey);
  }
  drawDoorFrames(cv, asset, ws, type, cell, DOOR_FRAMES_AFTER[cell] ?? 0, flipped);
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
    if (cell < 16 && drawDoor(cv, asset, ws, map, pose, cell, sq.x, sq.y, parity === 1, doors)) continue;
    if (!isWallSquare(map, sq.x, sq.y)) continue;
    const { piece, mirror } = wallPieceFor(t, cell, parity === 1);
    const p = ws.pieces[piece];
    const rr = asset.rects[RECT_CELL_BASE + cell];
    if (!p || !rr) continue;
    cv.draw(p, rr, mirror, ws.colorKey);
    walls.push(cell);
  }
  // party standing in a door square: its pillars (DRAW_DOOR(0, 6, ...)); the D0 panel is not drawn
  const here = pose.y * map.width + pose.x;
  if (sqType(map.raw[here] ?? 0) === SQ.DOOR && ((map.raw[here]! >> 3) & 1) !== (pose.facing & 1)) {
    drawDoorFrames(cv, asset, ws, doorTypeOf(asset, map, here), 0, DOOR_FRAMES_BEFORE[0]!, parity === 1);
  }
  if (info) { info.wallset = ws.id; info.parity = parity; info.walls = walls; }
  return cv.rgba;
}
