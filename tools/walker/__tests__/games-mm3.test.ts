/**
 * `tools/walker/games-mm3.ts` — MM3's wall-blocking oracle and the byte
 * packing that feeds it through the shared MM1/MM2 frustum engine
 * (`tools/walker-mm/maze3d.ts`).
 *
 * The packing order (`W|S<<2|E<<4|N<<6`, not the naive compass-literal
 * `N|E<<2|S<<4|W<<6`) was found empirically, not assumed — see the module
 * doc on `visualFromWalls`. The real-data test below is the regression
 * guard for that: it re-runs the exhaustive check (every indoor maze,
 * every cell, every facing) that found the correct ordering in the first
 * place, so a future refactor that silently reverts to the naive ordering
 * fails loudly instead of just rendering walls in the wrong place.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wallBlocked, visualFromWalls } from '../games-mm3.ts';
import { StitchedVisual, buildIndoorScene, MAP_GRID } from '../../walker-mm/maze3d.ts';

// Wall-word direction shifts (dos_maze.py WALL_SHIFT): west=0, south=4, east=8, north=12;
// bit 3 of each nibble is the blocking flag.
function wallWord(blockedN: boolean, blockedE: boolean, blockedS: boolean, blockedW: boolean): number {
  return (blockedN ? 0x8000 : 0) | (blockedE ? 0x0800 : 0) | (blockedS ? 0x0080 : 0) | (blockedW ? 0x0008 : 0);
}

describe('wallBlocked', () => {
  it('reads each direction from its own nibble', () => {
    const walls = new Array(256).fill(0);
    walls[0] = wallWord(true, false, true, false); // cell (0,0): N + S blocked
    expect(wallBlocked(walls, 0, 0, 0)).toBe(true); // N
    expect(wallBlocked(walls, 0, 0, 1)).toBe(false); // E
    expect(wallBlocked(walls, 0, 0, 2)).toBe(true); // S
    expect(wallBlocked(walls, 0, 0, 3)).toBe(false); // W
  });
});

describe('visualFromWalls', () => {
  it('packs every direction into its own 2-bit slot (only the low bit set)', () => {
    const walls = new Array(256).fill(0);
    walls[0] = wallWord(true, true, true, true); // cell (0,0): all 4 sides blocked
    const visual = visualFromWalls(walls);
    // All 4 slots should be exactly code 1 (not 2 or 3 — MM3 has no door/torch).
    expect(visual[0]).toBe(0b01010101);
  });

  it('open cells pack to a zero byte', () => {
    const visual = visualFromWalls(new Array(256).fill(0));
    expect(visual.every((b) => b === 0)).toBe(true);
  });
});

const MAZES_PATH = resolve(import.meta.dirname, '../../../public/assets/mm3/dosvga/data/mazes.json');
const hasData = existsSync(MAZES_PATH);

describe('MM3 wall packing vs. the frustum engine (real data)', { skip: !hasData }, () => {
  const raw = hasData ? JSON.parse(readFileSync(MAZES_PATH, 'utf8')) : null;
  const mazes = hasData ? raw.mazes.filter((m: { kind: string }) => m.kind === 'indoor') : [];

  it('every indoor maze has cells', () => {
    expect(mazes.length).toBeGreaterThan(0);
  });

  it('depth-0 front blit presence matches wallBlocked exactly, exhaustively', () => {
    let total = 0;
    let mismatches = 0;
    for (const m of mazes as Array<{ id: number; walls: number[] }>) {
      const visual = visualFromWalls(m.walls);
      const screen = { index: m.id, visual, collision: new Uint8Array(256), neighbors: [-1, -1, -1, -1] };
      const grid = new StitchedVisual([screen], 0);
      for (let x = 0; x < MAP_GRID; x++) {
        for (let y = 0; y < MAP_GRID; y++) {
          for (let facing = 0; facing < 4; facing++) {
            const expected = wallBlocked(m.walls, x, y, facing);
            const scene = buildIndoorScene(grid, x, y, facing);
            const rendered = scene.blits.some((b) => b.kind === 'front' && b.depth === 0);
            total++;
            if (expected !== rendered) mismatches++;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(mismatches).toBe(0);
  });
});
