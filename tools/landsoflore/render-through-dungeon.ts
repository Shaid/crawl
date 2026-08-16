/**
 * Offline PNG render of one Lands of Lore pose, for visual verification --
 * same pattern as `tools/eotb/render-through-dungeon.ts`/`tools/eotb2/
 * render-through-dungeon.ts`. Reads the already-exported JSON assets
 * (`export-dungeon.ts`), not the raw PAK files.
 *
 * Usage: npx tsx tools/landsoflore/render-through-dungeon.ts <level> <x> <y> <facing>
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { renderView, VIEWPORT_W, VIEWPORT_H } from './renderer.ts';
import type { MazeData } from './decode-maze.ts';
import type { VcnData } from './decode-vcn.ts';
import type { VmpData, VmpTileRef } from './decode-vmp.ts';
import type { Facing } from './view-model.ts';
import { buildWllLookup, type WllData } from './decode-wll.ts';

const ASSET_DIR = resolve('public/assets/landsoflore/dosvga');

function refFrom(t: [number, boolean, boolean]): VmpTileRef {
  return { tileIndex: t[0], mirrorX: t[1], zMask: t[2] };
}

function loadMaze(level: number): { maze: MazeData; wallSet: string; wllLookup: Map<number, number> } {
  const j = JSON.parse(readFileSync(resolve(ASSET_DIR, 'dungeon', `level${level}.json`), 'utf8'));
  const wllLookup = j.wll ? buildWllLookup(j.wll as WllData) : new Map<number, number>();
  return {
    maze: { width: j.width, height: j.height, cells: j.cells.map((c: number[]) => Uint8Array.from(c)) },
    wallSet: j.wallSet,
    wllLookup,
  };
}

function loadWallSet(name: string): { vcn: VcnData; vmp: VmpData; palette: [number, number, number][] } {
  const j = JSON.parse(readFileSync(resolve(ASSET_DIR, 'wallsets', `${name.toLowerCase()}.json`), 'utf8'));
  return {
    vcn: { numTiles: j.numTiles, palette: j.palette, tiles: j.tiles.map((t: number[]) => Uint8Array.from(t)) },
    vmp: {
      backdrop: j.vmp.backdrop.map((col: [number, boolean, boolean][]) => col.map(refFrom)),
      wallTiles: j.vmp.wallTiles.map((run: [number, boolean, boolean][]) => run.map(refFrom)),
    },
    palette: j.palette,
  };
}

function main() {
  const [levelArg, xArg, yArg, facingArg] = process.argv.slice(2);
  if (!levelArg || xArg === undefined || yArg === undefined || facingArg === undefined) {
    console.error('Usage: npx tsx tools/landsoflore/render-through-dungeon.ts <level> <x> <y> <facing>');
    process.exit(1);
  }
  const level = Number(levelArg);
  const x = Number(xArg);
  const y = Number(yArg);
  const facing = Number(facingArg) as Facing;

  const { maze, wallSet, wllLookup } = loadMaze(level);
  const { vcn, vmp, palette } = loadWallSet(wallSet);
  const surface = renderView(maze, x, y, facing, vcn, vmp, wllLookup);

  const rgba = new Uint8Array(VIEWPORT_W * VIEWPORT_H * 4);
  for (let i = 0; i < VIEWPORT_W * VIEWPORT_H; i++) {
    const c = palette[surface.data[i]!] ?? [0, 0, 0];
    rgba[i * 4] = c[0]!;
    rgba[i * 4 + 1] = c[1]!;
    rgba[i * 4 + 2] = c[2]!;
    rgba[i * 4 + 3] = 255;
  }
  const outDir = resolve(ASSET_DIR, 'renders');
  mkdirSync(outDir, { recursive: true });
  const outFile = `level${level}-${x}-${y}-f${facing}.png`;
  writePNG(resolve(outDir, outFile), rgba, VIEWPORT_W, VIEWPORT_H);
  console.log(`Wrote ${outFile} (wall set ${wallSet})`);
}

const isStandalone =
  process.argv[1]?.endsWith('render-through-dungeon.ts') || process.argv[1]?.endsWith('render-through-dungeon');
if (isStandalone) main();
