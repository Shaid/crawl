/**
 * Eye of the Beholder II (DOS/VGA) first-person view compositor -- same
 * mechanism and same "slot-table family doesn't fit" finding as `tools/
 * eotb/renderer.ts` (see that file's module doc for the full reasoning:
 * EOB's `.VMP` format is a per-8x8-tile mosaic per screen position, not a
 * placeable compose-list piece, so this renders directly from the decoded
 * `.VCN` tile array + `.VMP` index table every frame via `IndexedSurface`,
 * `blend: 'mask'`, tile index 0 = transparent).
 *
 * Kept as EOB2's own copy rather than importing EOB1's `renderer.ts`
 * because the two games' `VcnData` shapes genuinely differ (EOB2 DOS:
 * `{ numTiles, colMap, tiles }`; EOB1 Amiga: `{ numTiles, patchColors,
 * tiles }`) -- the only field this module actually reads is `tiles`, so
 * forcing a shared type here would mean padding EOB2's real data with a
 * dummy `patchColors` field just to satisfy EOB1's interface, which is
 * worse than this ~90-line duplication.
 *
 * **Wall decorations (`drawWallDecorations`, 2026-08-29): ported from
 * EOB1's `tools/eotb/renderer.ts`, front/"Down" role only** -- matching
 * that module's own current scope exactly (its module doc and
 * `drawWallDecorations` body still implement `i=0` only as of this
 * session, even though `../eotb/dsc-tables.ts` has separately gained
 * documentation for the `i=1` side role, an `ix<0` mirror-flip, and the
 * `flags & 4` alternate-coordinate path -- those are EOB1 follow-on work,
 * not yet wired into EOB1's own renderer, so this port doesn't reach for
 * them either). Genuinely new here: EOB2's own `.INF` record-stream parse
 * (`decode-inf.ts`'s `resolveWallDecorationAssignments`/
 * `buildWallTypeMap`, EOB2-specific offsets/field widths) and EOB2's own
 * chunky `.CPS` decoder (`decode-cps.ts` -- DOS/VGA is 8bpp chunky, not
 * Amiga's 5-bitplane). The decoration **format** itself (`.DEC` file
 * layout, `LevelDecorationProperty`/`EoBRect8`, the `next`-chain walk,
 * `DSC_SHAPE_INDEX`/`DSC_SHAPE_X` depth-slot selection) is confirmed
 * byte-identical shared `EoBCoreEngine` code and reused **read-only**
 * from `tools/eotb/decode-decorations.ts`/`tools/eotb/dsc-tables.ts` per
 * this session's task scope (that sibling directory belongs to a
 * concurrently-running EOB1 session) -- see `decode-inf.ts`'s module doc
 * for the full field-offset derivation and this session's byte-exact
 * verification (308/308 real wall-mapping-with-decoration records across
 * all 16 levels resolve in-range with 0 chain errors). `DSC_SHAPE_INDEX`/
 * `DSC_SHAPE_X`/`DSC_BLOCK_MAP` are independently confirmed
 * byte-identical between EOB1 Amiga and EOB2 DOS by cross-checking
 * against ScummVM's own freshly-fetched `devtools/create_kyradat/
 * resources/eob2_dos.h` (`kEoB2DscShapeIndexDOS`/`kEoB2DscXDOS`/
 * `kEoB2DscBlockMapDOS`) -- every one of the 36/18/12 entries matches the
 * Amiga table verbatim, so importing EOB1's tables directly (rather than
 * re-transcribing an EOB2-specific copy) is not a cross-platform guess,
 * it's a verified identity.
 */
import { IndexedSurface, type BlitSource } from '@seer-project/dungeon';
import type { VcnData } from './decode-vcn.ts';
import type { VmpData, VmpTileRef } from './decode-vmp.ts';
import { WALL_RENDER_SLOTS } from './decode-vmp.ts';
import { resolveWallTypes, type Facing } from './view-model.ts';
import type { MazeData } from './decode-maze.ts';
import type { DecorationData } from '../eotb/decode-decorations.ts';
import { decorationChain } from '../eotb/decode-decorations.ts';
import type { WallDecorationAssignment } from './decode-inf.ts';
import { DSC_SHAPE_INDEX, DSC_SHAPE_X, CELL_LETTERS } from '../eotb/dsc-tables.ts';

export const VIEWPORT_W = 176;
export const VIEWPORT_H = 120;
const TILE = 8;
const BACKDROP_W = 22;

function tileSource(vcn: VcnData, ref: VmpTileRef): BlitSource {
  const data = vcn.tiles[ref.tileIndex]!;
  return { data, width: TILE, height: TILE, mask: maskFor(data) };
}

const maskCache = new WeakMap<Uint8Array, Uint8Array>();
function maskFor(tile: Uint8Array): Uint8Array {
  let mask = maskCache.get(tile);
  if (!mask) {
    mask = new Uint8Array(tile.length);
    for (let i = 0; i < tile.length; i++) mask[i] = tile[i] === 0 ? 0 : 1;
    maskCache.set(tile, mask);
  }
  return mask;
}

/** Draw the 22x15 backdrop (ceiling/floor), optionally horizontally mirrored per-cell. */
export function drawBackdrop(surface: IndexedSurface, vcn: VcnData, vmp: VmpData, xflip: boolean): void {
  for (let bx = 0; bx < BACKDROP_W; bx++) {
    const col = vmp.backdrop[xflip ? BACKDROP_W - 1 - bx : bx]!;
    for (let by = 0; by < col.length; by++) {
      const ref = col[by]!;
      const mirror = ref.mirrorX !== xflip;
      surface.blit(tileSource(vcn, ref), 0, 0, TILE, TILE, bx * TILE, by * TILE, mirror, 'mask');
    }
  }
}

/** Draw one of the 25 fixed wall positions for a given wallType (1..vmp.wallTiles.length; 0 = no wall, caller should skip). Wall sets vary in how many wall-type runs their VMP carries (`decode-vmp.ts`'s module doc), so the bound is per-VMP, not a fixed 6. See `tools/eotb/renderer.ts`'s `drawWallSlot` doc for the `flipX`-sense derivation this reuses verbatim. */
export function drawWallSlot(surface: IndexedSurface, vcn: VcnData, vmp: VmpData, slotIndex: number, wallType: number): void {
  if (wallType < 1 || wallType > vmp.wallTiles.length) return;
  const slot = WALL_RENDER_SLOTS[slotIndex]!;
  const run = vmp.wallTiles[wallType - 1]!;
  let offset = slot.baseOffset;
  for (let row = 0; row < slot.heightBlocks; row++) {
    for (let col = 0; col < slot.widthBlocks; col++) {
      const blockIndex = slot.flipX
        ? col + row * BACKDROP_W + slot.offsetInViewport
        : slot.offsetInViewport + slot.widthBlocks - 1 - col + row * BACKDROP_W;
      const xpos = blockIndex % BACKDROP_W;
      const ypos = Math.floor(blockIndex / BACKDROP_W);
      const ref = run[offset]!;
      const mirror = ref.mirrorX === slot.flipX;
      surface.blit(tileSource(vcn, ref), 0, 0, TILE, TILE, xpos * TILE, ypos * TILE, mirror, 'mask');
      offset++;
    }
    offset += slot.skip;
  }
}

/** A decoded decoration shape sheet -- one wallset-referenced `.CPS` file, 320x200 palette indices (`decode-cps.ts`'s `CpsImage.indices`, same shape as EOB1's `tools/eotb/renderer.ts`'s `DecorationSheet`). */
export interface DecorationSheet {
  width: number;
  height: number;
  indices: Uint8Array;
}

/**
 * Draw the front/"Down"-role wall decorations for one resolved pose --
 * ported from EOB1's `tools/eotb/renderer.ts`'s `drawWallDecorations`
 * (same algorithm, same front-role-only scope; see this module's doc
 * comment for why). **One real deviation from EOB1's version, not a
 * simplification:** `decorations` is keyed by `decFile` (`Record<string,
 * DecorationData>`) rather than a single shared table. EOB1's wall sets
 * are 1:1 with their `.DAT` file, so one shared table is correct there;
 * EOB2's decoration-load `decFile` is genuinely **not** always the same
 * as the level's own navigable `wallSetStem` -- `LEVEL10`-`LEVEL14` are
 * `mezz`-tileset levels whose decoration-load records reference
 * `azure.dec`/`azure1.cps`/`azure2.cps` instead (see `decode-inf.ts`'s
 * module doc and `docs/eotb2/dosvga/data-structure.md`'s INF section for
 * the byte-exact evidence) -- so a single per-wall-set `DecorationData`
 * would silently resolve the wrong file for those 5 levels.
 */
export function drawWallDecorations(
  surface: IndexedSurface,
  resolved: ReturnType<typeof resolveWallTypes>,
  wallDecorations: Record<number, WallDecorationAssignment>,
  decorationsByFile: Record<string, DecorationData>,
  sheets: Record<string, DecorationSheet>,
): void {
  for (const { slot, rawWallIndex, cellLetter } of resolved) {
    if (!slot.label.endsWith('-south')) continue; // only the front/"Down" role -- see module doc.
    const cellIndex = CELL_LETTERS.indexOf(cellLetter);
    if (cellIndex < 0) continue;
    const assignment = wallDecorations[rawWallIndex];
    if (!assignment) continue;
    const decorations = decorationsByFile[assignment.decFile];
    if (!decorations) continue;
    const sheet = sheets[assignment.cpsFile];
    if (!sheet) continue;

    const s = cellIndex * 2; // i=0 (front/"Down" role).
    const ix = DSC_SHAPE_INDEX[s]!;
    const shpIx = Math.abs(ix) - 1;

    for (const prop of decorationChain(decorations, assignment.decIndex)) {
      const shapeIdx = prop.shapeIndex[shpIx];
      if (shapeIdx === undefined || shapeIdx === 0xffff) continue;
      const rect = decorations.rects[shapeIdx];
      if (!rect || rect.w === 0 || rect.h === 0) continue;

      const finalX = prop.shapeX[shpIx]! + DSC_SHAPE_X[cellIndex]!;
      const finalY = prop.shapeY[shpIx]!;
      const src: BlitSource = {
        data: sheet.indices,
        width: sheet.width,
        height: sheet.height,
        mask: maskForRegion(sheet, rect.x, rect.y, rect.w, rect.h),
      };
      surface.blit(src, rect.x, rect.y, rect.w, rect.h, finalX, finalY, false, 'mask');
    }
  }
}

const decorationMaskCache = new WeakMap<Uint8Array, Map<string, Uint8Array>>();
/** Palette index 0 = transparent, same convention as `maskFor` above -- built once per (sheet, rect) and cached, since the same rect is redrawn every pose. */
function maskForRegion(sheet: DecorationSheet, rx: number, ry: number, rw: number, rh: number): Uint8Array {
  let byRect = decorationMaskCache.get(sheet.indices);
  if (!byRect) {
    byRect = new Map();
    decorationMaskCache.set(sheet.indices, byRect);
  }
  const key = `${rx},${ry},${rw},${rh}`;
  let mask = byRect.get(key);
  if (!mask) {
    mask = new Uint8Array(sheet.width * sheet.height);
    for (let row = 0; row < rh; row++) {
      for (let col = 0; col < rw; col++) {
        const idx = (ry + row) * sheet.width + (rx + col);
        mask[idx] = sheet.indices[idx] === 0 ? 0 : 1;
      }
    }
    byRect.set(key, mask);
  }
  return mask;
}

/**
 * Render one full pose (backdrop + all populated wall slots, farthest-first) onto a fresh viewport-sized surface.
 *
 * `wallTypeMap` is the level's real `rawWallIndex -> vmpIndex` table
 * (`decode-inf.ts`'s `buildWallTypeMap`, EOB2's own `.INF` record parse)
 * -- this replaces the previous `resolveWallTypes(maze, x, y, facing)`
 * call (no map argument), which silently fell back to `view-model.ts`'s
 * raw-passthrough/clamp-to-1 approximation documented as a known gap in
 * that module's own doc comment ("EOB2's own `.INF`/wall-mapping format
 * is a separate, not-yet-verified decode"). That decode is no longer
 * unverified (`decode-inf.ts`'s module doc: 16/16 real levels, 0 parse
 * errors), so `export-dungeon.ts`/`render-through-dungeon.ts` now pass the
 * real per-level table through, matching EOB1's `tools/eotb/renderer.ts`.
 * `wallTypeMap` and `decorationParams` are both optional (omitting either
 * falls back to `view-model.ts`'s old raw-passthrough/clamp-to-1 default,
 * or walls-only rendering) so existing callers that predate this session
 * -- notably `tools/walker/games-eotb2.ts`, outside this session's scope
 * -- keep compiling and working unchanged; they transparently pick up the
 * new per-level `wallSet` bundle-key naming (`export-dungeon.ts`'s
 * palette-override paragraph) since that field is opaque to them, just
 * not the new wall-type-map/decoration data itself.
 */
export function renderView(
  maze: MazeData,
  x: number,
  y: number,
  facing: Facing,
  vcn: VcnData,
  vmp: VmpData,
  wallTypeMap?: Uint8Array,
  decorationParams?: {
    wallDecorations: Record<number, WallDecorationAssignment>;
    decorationsByFile: Record<string, DecorationData>;
    sheets: Record<string, DecorationSheet>;
  },
): IndexedSurface {
  const surface = new IndexedSurface(VIEWPORT_W, VIEWPORT_H);
  surface.clear(0);
  const xflip = (x & y & facing) === 1;
  drawBackdrop(surface, vcn, vmp, xflip);
  const resolved = resolveWallTypes(maze, x, y, facing, wallTypeMap);
  resolved.forEach(({ wallType }, i) => drawWallSlot(surface, vcn, vmp, i, wallType));
  if (decorationParams) {
    drawWallDecorations(surface, resolved, decorationParams.wallDecorations, decorationParams.decorationsByFile, decorationParams.sheets);
  }
  return surface;
}
