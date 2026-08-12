/**
 * Shared per-pose corridor-frame compositor for Wizardry 6 (Amiga) --
 * factored out of `render-cell-driven-corridor.ts` so `render-walk-
 * sequence.ts` (and any future caller) doesn't duplicate the same
 * confirmed formulas. See `render-cell-driven-corridor.ts`'s own history
 * for the full derivation of each piece; this module is the mechanism,
 * not new material.
 *
 * ## Wall dispatch formula (dispatch value 0/2/5, `data-structure.md` §4.7.1)
 *
 * `CODE+0x9b58`'s per-call-site literal `baseIndex` constants: front
 * `wall=0`/`door=0xb2`; left1/left2 `wall=3`/`6`; right1/right2
 * `wall=9`/`0xc` (right's the exact mirror of left's). `wall`/`door` are
 * self-identical pairs at every extracted call site, so direct
 * (unmirrored) placement applies uniformly -- compose-list index =
 * baseIndex+depth, `mode:1`/OR blend.
 *
 * > **Superseded (2026-08-12):** this module is no longer a faithful
 * > reference. Three things it gets wrong, all fixed in the package-driven
 * > path (`export-dungeon-slots.ts` + `view-model.ts`):
 * >
 * > 1. It gates the receding side-wall texture strips (static calls 4-9,
 * >    dirIndex 4-10) on `evalCellFace(cell, facing, ∓1)` — the *lateral
 * >    neighbour's forward face*. The game draws those strips from the
 * >    *perpendicular* evaluators `0x969a`/`0x9876`, dispatched through
 * >    `LAB_0506` (`data-structure.md` §4.7.6), instead. The two reads
 * >    disagree on 29.9% of side-wall draw decisions across the 14 levels.
 * > 2. Even given the right gate, this module only ever draws the single
 * >    "plain wall" side-strip variant. `LAB_0506`'s dispatch has 6 more
 * >    variants (partial walls, doors, two feature families) selected by
 * >    the perpendicular evaluator's 0-13 code, §4.7.6.2.
 * > 3. It has no occlusion: it runs all three depths unconditionally, so
 * >    with `blend: 'or'` the hidden geometry bleeds through the nearer
 * >    wall. The game gates every draw on a per-depth visibility lane,
 * >    §4.7.6.5.
 * >
 * > Kept as the derivation record for the compose-list placement formulas,
 * > which are still correct and still pixel-verified. Use
 * > `render-through-dungeon.ts` for any visual reference.
 *
 * ## Ceiling/floor: reused from the confirmed static-corridor sequence
 *
 * Pose-independent, no evaluator call feeds them -- reuses `static-
 * corridor-calls.ts`'s already disassembly-confirmed, visually-verified
 * entries (calls 1-3 = ceiling, 10-12 = floor, by `destY`), same
 * mirrored-path resolution and OR blend as every other piece here.
 *
 * ## Draw order
 *
 * Ceiling/floor first, then walls nearest-depth-first/farthest-last
 * (matching `@seer-project/dungeon`'s own nested-frame convention); at
 * each depth, side walls before the front wall (matching `@seer-project/
 * dungeon`'s `raster/composite.ts` same-depth ordering convention for
 * Black Crypt).
 */
import { IndexedSurface } from '@seer-project/dungeon';
import type { MazeData } from './decode-maze.ts';
import { evalCellFace, stepForward, type CellPlanes } from './evaluate-cell.ts';
import { STATIC_CORRIDOR_CALLS, type DrawMazePieceCall } from './static-corridor-calls.ts';

const CEILING_CALLS = STATIC_CORRIDOR_CALLS.slice(0, 3);
const FLOOR_CALLS = STATIC_CORRIDOR_CALLS.slice(9, 12);

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

export type DecodedSource = { data: Uint8Array; width: number; height: number };
export type DecodeCache = (dirIndex: number) => DecodedSource;

/**
 * One `CODE+0x9b58` call site's confirmed baseIndex constants. `wall` is
 * the `0x16(a5)`/`0x18(a5)` pair used for the dispatch==2/wall preamble
 * draw; `door` (front only, so far) is the `44(a5)`/`46(a5)` pair used
 * for dispatch==5. Left/right's door baseIndex constants haven't been
 * extracted, so they fall back to a plain wall for dispatch==5.
 */
interface WallCallSite {
  label: string;
  lateral: -1 | 0 | 1;
  wall: number;
  door?: number;
}

const FRONT: WallCallSite = { label: 'front', lateral: 0, wall: 0, door: 0xb2 };
const LEFT: WallCallSite[] = [
  { label: 'left1', lateral: -1, wall: 3 },
  { label: 'left2', lateral: -1, wall: 6 },
];
const RIGHT: WallCallSite[] = [
  { label: 'right1', lateral: 1, wall: 9 },
  { label: 'right2', lateral: 1, wall: 12 },
];

function resolveDirectPiece(maze: MazeData, baseIndex: number, depth: number) {
  const rec = maze.composeList[baseIndex + depth]!;
  const gfx = maze.dirRecords[rec.dirIndex]!;
  return {
    dirIndex: rec.dirIndex,
    destXPx: (rec.destXByte + rec.srcClip) * 8,
    destY: rec.destY,
    widthPx: rec.widthBytes * 8,
    heightPx: gfx.heightPx,
  };
}

/** Resolve one fixed `DrawMazePiece(srcIdx, mode, dstIdx)` call (ceiling/floor) into pixel-space placement -- same logic as render-static-corridor.ts's resolveCall. */
function resolveStaticCall(maze: MazeData, call: DrawMazePieceCall) {
  const direct = call.dstIdx === 0xffff;
  const placementRec = direct ? maze.composeList[call.srcIdx]! : maze.composeList[call.dstIdx]!;
  const graphicRec = maze.composeList[call.srcIdx]!;
  const gfx = maze.dirRecords[graphicRec.dirIndex]!;
  const widthPx = placementRec.widthBytes * 8;
  const srcByteStart = direct ? placementRec.srcClip : gfx.widthUnits - placementRec.srcClip - placementRec.widthBytes;
  return {
    dirIndex: graphicRec.dirIndex,
    srcXPx: srcByteStart * 8,
    widthPx,
    destXPx: (placementRec.destXByte + placementRec.srcClip) * 8,
    destY: placementRec.destY,
    heightPx: gfx.heightPx,
    mirror: !direct,
  };
}

export function indicesToRGBA(indices: Uint8Array, width: number, height: number, palette: readonly { r: number; g: number; b: number }[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const color = palette[indices[i]!]!;
    rgba[i * 4] = color.r;
    rgba[i * 4 + 1] = color.g;
    rgba[i * 4 + 2] = color.b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Composite one full pose (ceiling, floor, front + both side walls) onto a fresh `IndexedSurface`. `log`, if given, receives one line per drawn/skipped element -- pass a no-op to silence it. */
export function renderCorridorFrame(
  maze: MazeData,
  planes: CellPlanes,
  x: number,
  y: number,
  facing: number,
  decodeCache: DecodeCache,
  log: (line: string) => void = () => {},
): IndexedSurface {
  const surface = new IndexedSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
  surface.clear(0);

  for (const call of [...CEILING_CALLS, ...FLOOR_CALLS]) {
    const piece = resolveStaticCall(maze, call);
    const src = decodeCache(piece.dirIndex);
    surface.blit(src, piece.srcXPx, 0, piece.widthPx, piece.heightPx, piece.destXPx, piece.destY, piece.mirror, 'or');
  }

  const drawWallCallSite = (site: WallCallSite, depth: number, dispatch: number) => {
    if (dispatch === 0) return; // open -- no draw
    // Honest fallback: dispatch 0/2 (every call site) and 5/door (front
    // only) have extracted baseIndex formulas -- anything else (secret,
    // other facing-matched features, or door on a side wall) is logged
    // and rendered as a plain wall rather than silently guessed at.
    let baseIndex: number;
    if (dispatch === 2) {
      baseIndex = site.wall;
    } else if (dispatch === 5 && site.door !== undefined) {
      baseIndex = site.door;
    } else {
      log(`  ${site.label} depth ${depth}: dispatch=${dispatch} (not yet implemented for this call site) -- treating as wall (2)`);
      baseIndex = site.wall;
    }
    const piece = resolveDirectPiece(maze, baseIndex, depth);
    if (piece.widthPx === 0) return; // compose-list's own "draw nothing" padding record
    const src = decodeCache(piece.dirIndex);
    surface.blit(src, 0, 0, piece.widthPx, piece.heightPx, piece.destXPx, piece.destY, false, 'or');
  };

  // Nearest first, farthest last; at each depth, side walls before front.
  for (let depth = 0; depth <= 2; depth++) {
    const cell = stepForward(x, y, facing, depth);

    const leftDispatch = evalCellFace(planes, cell.x, cell.y, facing, -1);
    log(`depth ${depth}: left dispatch=${leftDispatch} at (${cell.x},${cell.y}) lateral=-1`);
    for (const site of LEFT) drawWallCallSite(site, depth, leftDispatch);

    const rightDispatch = evalCellFace(planes, cell.x, cell.y, facing, 1);
    log(`depth ${depth}: right dispatch=${rightDispatch} at (${cell.x},${cell.y}) lateral=+1`);
    for (const site of RIGHT) drawWallCallSite(site, depth, rightDispatch);

    const frontDispatch = evalCellFace(planes, cell.x, cell.y, facing, 0);
    log(`depth ${depth}: front dispatch=${frontDispatch} at (${cell.x},${cell.y})`);
    drawWallCallSite(FRONT, depth, frontDispatch);
  }

  return surface;
}
