/**
 * Eye of the Beholder (Amiga) first-person view compositor.
 *
 * **Where this sits relative to `@seer-project/dungeon`'s slot-table
 * family (the hypothesis `docs/walker-map-format-future-decision.md`
 * asked to test):** the LOW-level raster primitive (`IndexedSurface`,
 * `blend: 'mask'` blitting) generalises to EOB fine and is reused
 * directly below. The HIGH-level `SlotTableFile`/`compositeDrawList`
 * schema does NOT fit cleanly: that schema assumes one whole pre-composed
 * piece per depth/lateral slot (`front:<lateral>:<depth>`), but EOB's
 * `.VMP` format is a **per-8x8-tile mosaic** -- each of the 25 fixed
 * screen positions (`decode-vmp.ts`'s `WALL_RENDER_SLOTS`) is itself
 * built from a small grid of individually-indexed tiles (`widthBlocks` x
 * `heightBlocks`, with a `skip` stride between VMP-array rows), not one
 * placeable image. Baking each (position, wallType) combination into a
 * pre-composed atlas frame ahead of time was considered and rejected: it
 * would just be this same per-tile loop run once at export time instead
 * of once per render, for no real benefit, since the tile blit here is
 * already cheap (25 positions x <=96 tiles worst case). So this renders
 * directly from the decoded `.VCN` tile array + `.VMP` index table every
 * frame, using `IndexedSurface.blit`'s `mask` blend (tile index 0 =
 * transparent, per `docs/eotb/amiga/eotb-vcn-spec.md` "A palette index of
 * 0 is treated as transparent") as the one piece of shared-package reuse.
 *
 * Not modelled (documented gaps, not silent guesses): VMP's per-tile
 * `zMask` flag ("only draw onto transparent pixels below" -- an
 * intra-layer seam-avoidance hint, drawing every tile unconditionally in
 * strict back-to-front order gets visually close but isn't verified
 * pixel-identical); door open/closed state (the `.MAZ` wallType byte is
 * static per this pass, see `decode-maze.ts`'s module doc).
 *
 * **Wall decorations (`drawWallDecorations`, 2026-08-29): real,
 * verified, but intentionally partial.** `EoBCoreEngine::
 * drawDecorations` (`engines/kyra/engine/scene_eob.cpp:667-716`) draws
 * TWO roles per visible cell per frame: `i=0` ("Down", the wall directly
 * facing the viewer -- this project's `role: 'front'` / `-south`-suffixed
 * slots) and `i=1` ("Right"/"Left", the side walls of cells further down
 * the corridor -- this project's `-east`/`-west` slots). This port
 * implements **`i=0` only**. Also not ported: the `ix<0` mirror-flip
 * (driven by `flags & 1` or `flags & 2 && _wllProcessFlag`, `scene_eob.
 * cpp:684-685`) and the `flags & 4` alternate-coordinate path
 * (`_dscShapeCoords[(index*5+4)<<1]` instead of the general `_dscShapeX
 * [index]` translation). All three are real, cited mechanisms with known
 * table locations (`dsc-tables.ts`), just out of this pass's time budget
 * -- see `docs/eotb/TODO.md`. What's real and verified: the `.DAT`
 * decoration-property/rect format (`decode-decorations.ts`, 0 residue
 * against all 5 real files), which decoration-load's `.CPS`/`.DAT` pair
 * is active for a given wall-mapping record (`decode-inf.ts`'s
 * `resolveWallDecorationAssignments`, using real interleaved record
 * order -- not the file's simple presence), and the depth-slot selection
 * + on-screen X translation tables (`DSC_SHAPE_INDEX`/`DSC_SHAPE_X`,
 * ScummVM's own literal Amiga-extracted `create_kyradat` byte arrays).
 */
import { IndexedSurface, type BlitSource } from '@seer-project/dungeon';
import type { VcnData } from './decode-vcn.ts';
import type { VmpData, VmpTileRef } from './decode-vmp.ts';
import { WALL_RENDER_SLOTS } from './decode-vmp.ts';
import { resolveWallTypes, type Facing } from './view-model.ts';
import type { MazeData } from './decode-maze.ts';
import type { DecorationData } from './decode-decorations.ts';
import { decorationChain } from './decode-decorations.ts';
import type { WallDecorationAssignment } from './decode-inf.ts';
import { DSC_SHAPE_INDEX, DSC_SHAPE_X, CELL_LETTERS } from './dsc-tables.ts';

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

/** Draw the 22x15 backdrop (ceiling/floor), optionally horizontally mirrored per-cell (`docs/eotb/amiga/eotb-vmp-spec.md` "background is horizontally flipped when party.x & party.y & party.direction == 1"). */
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

/**
 * Draw one of the 25 fixed wall positions for a given wallType (1-6; 0 =
 * no wall, caller should skip).
 *
 * **`flipX` sense -- inverted from a literal reading of the ModdingWiki
 * pseudocode, confirmed by tracing its own local-variable reuse.**
 * `drawWall`'s pseudocode reassigns `flipX = wallRenderData[pos].flipFlag
 * ? 0 : 0x4000` and then branches on *that local* being zero -- so
 * `flipFlag == true` (this repo's `slot.flipX`) actually selects the
 * *simple* (non-mirrored) placement formula, and `flipFlag == false`
 * selects the mirrored one; the same local value then XORs against each
 * tile's own stored mirror bit for the final blit-mirror decision. A
 * first pass here read `slot.flipX` as directly selecting the mirrored
 * placement (the natural reading of "flipFlag" as a name) and produced a
 * scrambled, non-repeating render for every wall position -- this
 * corrected version was verified by re-rendering and visually confirming
 * coherent, repeating brick/stone structure appears (see
 * `docs/eotb/TODO.md`'s walker row for the before/after).
 */
export function drawWallSlot(surface: IndexedSurface, vcn: VcnData, vmp: VmpData, slotIndex: number, wallType: number): void {
  if (wallType < 1 || wallType > 6) return;
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

/** A decoded decoration shape sheet -- one wallset-referenced `.CPS` file, 320x200 palette indices (`decode-cps.ts`'s `CpsImage.indices`, same shape). */
export interface DecorationSheet {
  width: number;
  height: number;
  indices: Uint8Array;
}

/**
 * Draw the front/"Down"-role wall decorations for one resolved pose --
 * `EoBCoreEngine::drawDecorations`'s `i=0` half (`engines/kyra/engine/
 * scene_eob.cpp:667-716`), restricted to that half: see this module's
 * doc comment for why (the `i=1` "Right"/"Left" side-decoration roles,
 * `.DEC`-array `next`-chain, an `ix<0` mirror-flip driven by `flags &
 * 1`/`flags & 2`, and the `flags & 4` alternate-coordinate path are all
 * real, cited, but not implemented this pass -- `docs/eotb/TODO.md`).
 *
 * `wallDecorations` is the level's `wallIndex -> {cpsFile, decIndex}`
 * table (`decode-inf.ts`'s `resolveWallDecorationAssignments`);
 * `decorations`/`sheets` are the active wall-set's decoration property/
 * rect table and decoded `.CPS` shape sheets (both from
 * `export-dungeon.ts`'s per-wall-set export).
 */
export function drawWallDecorations(
  surface: IndexedSurface,
  resolved: ReturnType<typeof resolveWallTypes>,
  wallDecorations: Record<number, WallDecorationAssignment>,
  decorations: DecorationData,
  sheets: Record<string, DecorationSheet>,
): void {
  for (const { slot, rawWallIndex, cellLetter } of resolved) {
    if (!slot.label.endsWith('-south')) continue; // only the front/"Down" role -- see module doc.
    const cellIndex = CELL_LETTERS.indexOf(cellLetter);
    if (cellIndex < 0) continue;
    const assignment = wallDecorations[rawWallIndex];
    if (!assignment) continue;
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

/** Render one full pose (backdrop + all populated wall slots, farthest-first) onto a fresh viewport-sized surface. `wallTypeMap` is the level's real `rawWallIndex -> vmpIndex` table (`decode-inf.ts`'s `buildWallTypeMap`). Decoration overlay params are optional -- omit to render walls only (unchanged pre-decoration behaviour). */
export function renderView(
  maze: MazeData,
  x: number,
  y: number,
  facing: Facing,
  vcn: VcnData,
  vmp: VmpData,
  wallTypeMap: Uint8Array,
  decorationParams?: {
    wallDecorations: Record<number, WallDecorationAssignment>;
    decorations: DecorationData;
    sheets: Record<string, DecorationSheet>;
  },
): IndexedSurface {
  const surface = new IndexedSurface(VIEWPORT_W, VIEWPORT_H);
  surface.clear(0);
  const xflip = (x & y & facing) === 1;
  drawBackdrop(surface, vcn, vmp, xflip);
  const resolved = resolveWallTypes(maze, x, y, facing, wallTypeMap);
  // WALL_RENDER_SLOTS is already authored back-to-front (A-G, then H-L, then M-O, then P/Q last).
  resolved.forEach(({ wallType }, i) => drawWallSlot(surface, vcn, vmp, i, wallType));
  if (decorationParams) {
    drawWallDecorations(surface, resolved, decorationParams.wallDecorations, decorationParams.decorations, decorationParams.sheets);
  }
  return surface;
}
