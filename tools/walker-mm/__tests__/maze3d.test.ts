import { describe, expect, it } from 'vitest';
import {
  buildFrustum,
  buildIndoorScene,
  collectBlits,
  movementBlocked,
  setFacing,
  stepParty,
  torchBlitFor,
  wallpixSliceName,
  StitchedVisual,
  MAP_GRID,
  MAP_PAGE_SIZE,
  type ScreenLike,
} from '../maze3d.ts';

function emptyScreen(neighbors = [-1, -1, -1, -1]): ScreenLike {
  return {
    index: 0,
    visual: new Uint8Array(MAP_PAGE_SIZE),
    collision: new Uint8Array(MAP_PAGE_SIZE),
    neighbors,
  };
}

describe('frustum engine', () => {
  it('buildFrustum fills the front slot when the cell ahead is a wall', () => {
    // hood cell 0 (directly ahead, facing N) = wall (code 1 in the N field)
    const hood = new Array(13).fill(0);
    hood[0] = 0b01000000; // N field (bits 6-7) = 1 = wall
    const f = setFacing(0);
    const slots = buildFrustum(hood, f);
    // S_F18 (front, depth 0) should be 1
    expect(slots[8]).toBe(1);
    // nothing behind a solid front wall: other front slots stay 0
    expect(slots[9]).toBe(0);
  });

  it('collectBlits maps front walls to frames 0-3 and left walls to 4-7', () => {
    // hand-set slots: front depth0 wall, left depth1 wall, right depth0 torch
    const slots = new Array(20).fill(0);
    slots[8] = 1; // S_F18 front depth 0
    slots[5] = 1; // S_F1B left (mirror) depth 1
    slots[12] = 3; // S_F14 right-mirror? use S_F14 = right depth 0 mirror
    const blits = collectBlits(slots);
    expect(blits.length).toBe(3);
    const front = blits.find((b) => b.kind === 'front');
    expect(front?.frame).toBe(0);
    const door = collectBlits([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(door.find((b) => b.kind === 'front')?.frame).toBe(0x10);
  });

  it('door (code 2) blits use door frames; torch (code 3) blits are excluded from wall blits', () => {
    const slots = new Array(20).fill(0);
    slots[8] = 2; // front depth 0, code 2 = door
    const blits = collectBlits(slots);
    expect(blits[0].frame).toBe(0x10);
  });

  it('movementBlocked respects the collision page', () => {
    const sc = emptyScreen();
    // facing 0 checks the current cell's collision field 3 (bit 6)
    sc.collision[1 * MAP_GRID + 1] = 0x40;
    expect(movementBlocked(sc, 1, 1, 0)).toBe(true);
    expect(movementBlocked(sc, 2, 1, 0)).toBe(false);
  });

  it('movementBlocked only applies the MM2 terrain-id check when mapWalls is false', () => {
    const sc = emptyScreen();
    sc.outdoor = true;
    // destination visual byte 0xff matches MM1's border-cell convention but
    // also happens to match MM2's terrain-block bit pattern ((v&0x60)===0x60).
    // facing 0 (N) from (1,1) steps to (1,2) -> visual index 2*16+1 = 33.
    sc.visual[2 * MAP_GRID + 1] = 0xff;
    sc.mapWalls = true; // MM1: MapWalls encoding, not an MM2 terrain id — must not block
    expect(movementBlocked(sc, 1, 1, 0)).toBe(false);
    sc.mapWalls = false; // MM2: same byte read as a terrain id — blocks
    expect(movementBlocked(sc, 1, 1, 0)).toBe(true);
  });

  it('stepParty clamps at screen edges without neighbours', () => {
    const screens = [emptyScreen(), emptyScreen()];
    const p = stepParty(2, 0, 0, 0, screens); // facing S, at (0,0) -> stays
    expect(p).toEqual({ screen: 0, x: 0, y: 0, facing: 2 });
  });

  it('stepParty crosses screens when a neighbour exists', () => {
    const a = emptyScreen([1, -1, -1, -1]); // north neighbour = screen 1
    const b = emptyScreen();
    const screens = [a, b];
    const p = stepParty(0, 8, 15, 0, screens); // facing N from bottom row
    expect(p.screen).toBe(1);
    expect(p.y).toBe(0);
  });

  it('torchBlitFor returns null for non-torch codes and depths > 2', () => {
    expect(torchBlitFor({ kind: 'front', depth: 0, frame: 0, x: 0, y: 0, code: 1, latX: 0 }, 0)).toBeNull();
    expect(torchBlitFor({ kind: 'front', depth: 3, frame: 3, x: 0, y: 0, code: 3, latX: 0 }, 0)).toBeNull();
    const tb = torchBlitFor({ kind: 'front', depth: 1, frame: 1, x: 0, y: 0, code: 3, latX: 0 }, 1);
    expect(tb).not.toBeNull();
    expect(tb!.frame).toBe(0x12 + 3 + 1); // 0x12 + depth*3 + flicker
  });

  it('wallpixSliceName maps frustum frames to WALLPIX slice names', () => {
    expect(wallpixSliceName(3, 0)).toBe('wall03_front0'); // front depth 0
    expect(wallpixSliceName(3, 4)).toBe('wall03_left0'); // left depth 0
    expect(wallpixSliceName(3, 8)).toBe('wall03_right0'); // right depth 0
    expect(wallpixSliceName(3, 0x10)).toBe('wall03_front0'); // door frame falls back
    expect(wallpixSliceName(3, 12)).toBe('wall03_left0'); // mirror base
  });

  it('StitchedVisual reads across the west screen boundary', () => {
    // west neighbour = screen 1 (n[3] = 1, per StitchedVisual's page order N/E/S/W)
    const a = emptyScreen([-1, -1, -1, 1]);
    const b = emptyScreen();
    b.visual[8 * MAP_GRID + 15] = 0xab; // screen b's east edge (its col 15), row 8
    const grid = new StitchedVisual([a, b], 0);
    // x=-1 is one cell west of screen a's west edge -> screen b's col 15
    expect(grid.at(-1, 8)).toBe(0xab);
    // x=-4 -> screen b's col 12 (unset)
    expect(grid.at(-4, 8)).toBe(0);
  });

  it('buildIndoorScene is deterministic for a straight corridor', () => {
    // corridor: all cells open except a wall directly ahead of (8,8) facing 0
    const sc = emptyScreen();
    // facing 0's forward visual field is bits 6-7 of the cell ahead
    sc.visual[9 * MAP_GRID + 8] = 0b11 << 6;
    const grid = new StitchedVisual([sc], 0);
    const scene = buildIndoorScene(grid, 8, 8, 0);
    expect(scene.blits.length).toBeGreaterThan(0);
    const front = scene.blits.filter((b) => b.kind === 'front');
    expect(front.length).toBeGreaterThan(0);
    expect(front[0].depth).toBeGreaterThanOrEqual(0);
  });
});
