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
 * **Wall decorations (`drawWallDecorations`, 2026-08-29 -- extended to
 * both roles this session): real, verified.** `EoBCoreEngine::
 * drawDecorations` (`engines/kyra/engine/scene_eob.cpp:667-716`, fetched
 * fresh and re-verified line-by-line this session, not trusted from
 * paraphrase) draws TWO roles per visible cell per frame: `i=0` ("Down",
 * the wall directly facing the viewer -- this project's `-south`-suffixed
 * slots) and `i=1` ("Right"/"Left", the side walls of cells further down
 * the corridor -- this project's `-east`/`-west` slots). Both are now
 * implemented in one unified pass over `resolved` (see `dsc-tables.ts`'s
 * module doc for the full source excerpt and derivation).
 *
 * **Corrects this session's own starting assumption**: the `ix<0`
 * flag-driven mirror-flip (`flg & 1 || (flg & 2 && _wllProcessFlag)`) is
 * gated `(i == 0) &&` in the real source -- i.e. it is a FRONT-role-only
 * mechanism, not a side-role one. Side-role mirroring instead comes for
 * free from `DSC_SHAPE_INDEX`'s own static sign at `i=1` (negative for
 * every `-west`-suffixed cell, positive for every `-east`-suffixed one --
 * see `dsc-tables.ts`); the `ix<0` mirrored-DRAW formula itself is
 * unconditional on `i`, only the extra flag-driven negation is
 * front-role-only.
 *
 * `_wllProcessFlag` (gating `flg & 2`) has no static source in this game
 * and is omitted rather than defaulted: a whole-corpus census of all 5
 * real `.DAT` files' `DecorationProperty.flags` (198 properties total)
 * found bit `0x02` set on **zero** records (`0x01`: 18/198 -- BRICK 10,
 * BLUE 3, DROW 1, GREEN 0, XANATHA 4; `0x04`: 21/198 -- BRICK 6, BLUE 4,
 * DROW 3, GREEN 2, XANATHA 6), so `flg & 2` cannot fire on any real EOB1
 * Amiga decoration and isn't modelled at all (not left in as dead
 * inert-by-default code). The `flags & 4` alternate-coordinate path
 * (`_dscShapeCoords`, `dsc-tables.ts`'s `DSC_SHAPE_COORDS`, 180 real
 * `kEoB1DscShapeCoordsAmiga` entries) IS real and DOES occur in the
 * corpus (the 21/198 count above) and is implemented, front-role only
 * (side role never reaches this branch -- see `dsc-tables.ts`).
 *
 * A shape's real pixel width for the mirrored-draw formula (`176 -
 * shapeX[shpIx] - (shapeData[2] << 3)` in the real source, where
 * `shapeData[2]<<3` is the shape's own encoded-header pixel width) is
 * substituted here with `rect.w` directly -- this port never builds a
 * `shapeData`-style encoded runtime shape at all, it blits straight from
 * the decoded `.CPS` canvas using each `DecorationRect`'s own `w`/`h` as
 * literal pixel dimensions (already pixel-exact verified for the
 * non-mirrored case, see below), so `rect.w` and the source's
 * `shapeData[2]<<3` necessarily name the same real pixel width.
 *
 * What's real and verified: the `.DAT` decoration-property/rect format
 * (`decode-decorations.ts`, 0 residue against all 5 real files), which
 * decoration-load's `.CPS`/`.DAT` pair is active for a given wall-mapping
 * record (`decode-inf.ts`'s `resolveWallDecorationAssignments`, using
 * real interleaved record order -- not the file's simple presence), and
 * every table this rendering path reads (`DSC_SHAPE_INDEX`/`DSC_SHAPE_X`/
 * `DSC_SHAPE_COORDS`, all ScummVM's own literal Amiga-extracted
 * `create_kyradat` byte arrays). See `docs/eotb/amiga/data-structure.md`
 * § "Decoration overlays" for the pixel-diff verification evidence for
 * both roles.
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
import { DSC_SHAPE_INDEX, DSC_SHAPE_X, DSC_SHAPE_COORDS, CELL_LETTERS } from './dsc-tables.ts';

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
 * Which `drawDecorations` role (`i` in the real source) a resolved slot's
 * label suffix belongs to -- `-south` is `i=0` (front/"Down"), `-east`/
 * `-west` are `i=1` (side/"Right"-or-"Left"). `null` for a slot with
 * neither suffix (shouldn't happen for real `WALL_RENDER_SLOTS` entries,
 * defensive only).
 */
function decorationRole(label: string): 0 | 1 | null {
  if (label.endsWith('-south')) return 0;
  if (label.endsWith('-east') || label.endsWith('-west')) return 1;
  return null;
}

/**
 * Draw both wall-decoration roles for one resolved pose --
 * `EoBCoreEngine::drawDecorations` (`engines/kyra/engine/scene_eob.cpp:
 * 667-716`), both `i=0` (front/"Down") and `i=1` (side/"Right"-or-"Left")
 * -- see this module's doc comment for the full derivation, the flag-flip
 * front-role-only correction, and the `_wllProcessFlag`/`flags & 4`
 * findings.
 *
 * A single pass over `resolved` (rather than two separate passes, one per
 * role) preserves `WALL_RENDER_SLOTS`'s existing back-to-front authoring
 * order across both roles combined -- that order already interleaves a
 * cell's `-east`/`-west` and `-south` slots correctly (e.g. `B-east`
 * before `B-south`), so no extra per-cell grouping is needed.
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
    const role = decorationRole(slot.label);
    if (role === null) continue;
    const cellIndex = CELL_LETTERS.indexOf(cellLetter);
    if (cellIndex < 0) continue;
    const assignment = wallDecorations[rawWallIndex];
    if (!assignment) continue;
    const sheet = sheets[assignment.cpsFile];
    if (!sheet) continue;

    const s = cellIndex * 2 + role;
    const baseIx = DSC_SHAPE_INDEX[s];
    if (baseIx === undefined) continue;

    for (const prop of decorationChain(decorations, assignment.decIndex)) {
      // `ix` is recomputed fresh from the static table for every chained
      // property in the real source too (never accumulates across
      // iterations) -- the front-role-only flag-driven negation
      // (`_wllProcessFlag`'s `flags & 2` term omitted: never set in this
      // corpus, see module doc) is the only per-property mutation.
      let ix = baseIx;
      if (role === 0 && prop.flags & 1) ix = -ix;
      const shpIx = Math.abs(ix) - 1;
      if (shpIx < 0 || shpIx > 9) continue; // degenerate (cellIndex,role) combo with no real depth-slot entry (e.g. G's side role) -- defensive, matches the shapeIndex==0xFFFF "nothing to draw" treatment below.

      const shapeIdx = prop.shapeIndex[shpIx];
      if (shapeIdx === undefined || shapeIdx === 0xffff) continue;
      const rect = decorations.rects[shapeIdx];
      if (!rect || rect.w === 0 || rect.h === 0) continue;

      let x = 0;
      if (role === 0) {
        if (prop.flags & 4) {
          x += DSC_SHAPE_COORDS[cellIndex * 10 + 8]!; // (cellIndex*5+4)<<1, see dsc-tables.ts.
        } else {
          x += DSC_SHAPE_X[cellIndex]!;
        }
      }
      // else (role===1): x stays 0 -- side-role placement carries no
      // per-cell translation, it's entirely the property's own shapeX.

      let mirror = false;
      if (ix < 0) {
        x += VIEWPORT_W - prop.shapeX[shpIx]! - rect.w;
        mirror = true;
      } else {
        x += prop.shapeX[shpIx]!;
      }
      const finalX = x;
      const finalY = prop.shapeY[shpIx]!;
      const src: BlitSource = {
        data: sheet.indices,
        width: sheet.width,
        height: sheet.height,
        mask: maskForRegion(sheet, rect.x, rect.y, rect.w, rect.h),
      };
      surface.blit(src, rect.x, rect.y, rect.w, rect.h, finalX, finalY, mirror, 'mask');
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
