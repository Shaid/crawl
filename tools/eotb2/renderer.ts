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

/** Draw one of the 25 fixed wall positions for a given wallType (1-6; 0 = no wall, caller should skip). See `tools/eotb/renderer.ts`'s `drawWallSlot` doc for the `flipX`-sense derivation this reuses verbatim. */
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

/** Render one full pose (backdrop + all populated wall slots, farthest-first) onto a fresh viewport-sized surface. */
export function renderView(maze: MazeData, x: number, y: number, facing: Facing, vcn: VcnData, vmp: VmpData): IndexedSurface {
  const surface = new IndexedSurface(VIEWPORT_W, VIEWPORT_H);
  surface.clear(0);
  const xflip = (x & y & facing) === 1;
  drawBackdrop(surface, vcn, vmp, xflip);
  const resolved = resolveWallTypes(maze, x, y, facing);
  resolved.forEach(({ wallType }, i) => drawWallSlot(surface, vcn, vmp, i, wallType));
  return surface;
}
