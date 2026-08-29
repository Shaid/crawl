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
 */
import { IndexedSurface, type BlitSource } from '@seer-project/dungeon';
import type { VcnData } from './decode-vcn.ts';
import type { VmpData, VmpTileRef } from './decode-vmp.ts';
import { WALL_RENDER_SLOTS } from './decode-vmp.ts';
import { resolveWallTypes, type Facing } from './view-model.ts';
import type { MazeData } from './decode-maze.ts';

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

/** Render one full pose (backdrop + all populated wall slots, farthest-first) onto a fresh viewport-sized surface. `wallTypeMap` is the level's real `rawWallIndex -> vmpIndex` table (`decode-inf.ts`'s `buildWallTypeMap`). */
export function renderView(
  maze: MazeData,
  x: number,
  y: number,
  facing: Facing,
  vcn: VcnData,
  vmp: VmpData,
  wallTypeMap: Uint8Array,
): IndexedSurface {
  const surface = new IndexedSurface(VIEWPORT_W, VIEWPORT_H);
  surface.clear(0);
  const xflip = (x & y & facing) === 1;
  drawBackdrop(surface, vcn, vmp, xflip);
  const resolved = resolveWallTypes(maze, x, y, facing, wallTypeMap);
  // WALL_RENDER_SLOTS is already authored back-to-front (A-G, then H-L, then M-O, then P/Q last).
  resolved.forEach(({ wallType }, i) => drawWallSlot(surface, vcn, vmp, i, wallType));
  return surface;
}
