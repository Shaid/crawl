import { describe, expect, it } from 'vitest';
import { buildOutdoorScene, StitchedOutdoor, TERRAIN_LOOKUP, biomeForSurface } from '../outdoor3d.ts';
import { MAP_PAGE_SIZE, type ScreenLike } from '../maze3d.ts';

function outdoorScreen(index: number, terrainFill: number, neighbors = [-1, -1, -1, -1]): ScreenLike {
  return {
    index,
    visual: new Uint8Array(MAP_PAGE_SIZE).fill(terrainFill),
    collision: new Uint8Array(MAP_PAGE_SIZE),
    neighbors,
    outdoor: true,
    surface: 0xcc, // ocean
  };
}

describe('outdoor3d', () => {
  it('terrain lookup maps open land (id 1-2) to horizon class 1 and water (id 4) to class 3', () => {
    expect(TERRAIN_LOOKUP[1]).toBe(1);
    expect(TERRAIN_LOOKUP[3]).toBe(2);
    expect(TERRAIN_LOOKUP[4]).toBe(3);
    expect(TERRAIN_LOOKUP[0]).toBe(0);
  });

  it('biomeForSurface maps the attrib surface bytes', () => {
    expect(biomeForSurface(0xcc)).toBe('ocean');
    expect(biomeForSurface(0x99)).toBe('tundra');
    expect(biomeForSurface(0xbb)).toBe('swamp');
    expect(biomeForSurface(0)).toBe('desert');
  });

  it('buildOutdoorScene produces decor + horizon blits on an open overland screen', () => {
    const screens = [outdoorScreen(0, 0x01)]; // terrain id 1 everywhere (open land)
    const grid = new StitchedOutdoor(screens, 0);
    const scene = buildOutdoorScene(grid, 8, 8, 0, screens);
    expect(Array.isArray(scene.horizon)).toBe(true);
    expect(Array.isArray(scene.decor)).toBe(true);
    // an open plain with no blocked terrain still yields horizon content
    expect(scene.horizon.length).toBeGreaterThan(0);
    // every blit names a sheet + frame
    for (const b of [...scene.horizon, ...scene.decor]) {
      expect(typeof b.sheet).toBe('string');
      expect(b.frame).toBeGreaterThanOrEqual(0);
    }
  });

  it('StitchedOutdoor reads across neighbour screens', () => {
    const a = outdoorScreen(0, 0x01);
    const b = outdoorScreen(1, 0x04); // water
    a.neighbors = [1, -1, -1, -1]; // north neighbour = screen 1
    const grid = new StitchedOutdoor([a, b], 0);
    // cell at y=16 (past the north edge) resolves to screen 1's page
    expect(grid.screenIdAt(8, 16)).toBe(1);
    expect(grid.at(8, 16) & 0x1f).toBe(0x04);
  });
});
