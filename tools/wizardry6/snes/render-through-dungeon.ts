/**
 * Render a SNES Wizardry 6 dungeon pose through the v1 view-model
 * (`view-model.ts`) -- the SNES analog of the Amiga port's own
 * `render-through-dungeon.ts`, used for offline verification (look at the
 * PNG) before wiring the browser walker.
 *
 * Usage: npx tsx tools/wizardry6/snes/render-through-dungeon.ts <level> <x> <y> <facing>
 * (level 0-13, facing 0=N/1=E/2=S/3=W)
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { writePNG } from '@seer-project/pipeline';
import {
  densifyMazeLevel,
  resolveViewWords,
  extractPoolIndices,
  compositeSnesView,
  type ViewPiecesFile,
  type MazeLevelRaw,
  type Palette16,
} from './view-model';

function loadPNG(path: string): { rgba: Uint8Array; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(path));
  return { rgba: new Uint8Array(png.data), width: png.width, height: png.height };
}

function main() {
  const [levelArg, xArg, yArg, facingArg] = process.argv.slice(2);
  if (levelArg === undefined || xArg === undefined || yArg === undefined || facingArg === undefined) {
    console.error('Usage: npx tsx tools/wizardry6/snes/render-through-dungeon.ts <level> <x> <y> <facing>');
    process.exit(1);
  }
  const level = Number(levelArg);
  const x = Number(xArg);
  const y = Number(yArg);
  const facing = Number(facingArg);

  const base = resolve('public/assets/wizardry6/snes');
  const maze: MazeLevelRaw[] = JSON.parse(readFileSync(resolve(base, 'data/maze.json'), 'utf8'));
  const lvl = maze.find((l) => l.level === level);
  if (!lvl) throw new Error(`no level ${level} in data/maze.json`);

  const viewPieces: ViewPiecesFile = JSON.parse(readFileSync(resolve(base, 'dungeon/view-pieces.json'), 'utf8'));
  const grid = densifyMazeLevel(lvl, viewPieces.tables.db8d[level] ?? 0x0d);
  console.log(`Level ${level} densified: ${grid.width}x${grid.height}`);
  const { rgba: poolRgba, width: poolW } = loadPNG(resolve(base, `dungeon/${viewPieces.poolAtlas}`));
  const pool = extractPoolIndices(poolRgba, poolW, poolRgba.length / poolW / 4);

  const levelPalettes: { groups: number[] } = JSON.parse(readFileSync(resolve(base, 'dungeon/level-palettes.json'), 'utf8'));
  const group = levelPalettes.groups[level] ?? 40;
  const paletteFile: { colors: { r: number; g: number; b: number }[] } = JSON.parse(
    readFileSync(resolve(base, `palettes/dungeon-region-${group}.json`), 'utf8'),
  );
  const palette: Palette16 = paletteFile.colors;

  const words = resolveViewWords(viewPieces, grid, level, x, y, facing);
  console.log(`Pose (${x},${y}) facing ${'NESW'[facing]}: ${words.length} compose words -> ${words.map((w) => `0x${w.toString(16)}`).join(' ')}`);

  const { rgba, width, height } = compositeSnesView(viewPieces, pool, poolW, palette, words);

  const outDir = resolve('build/cache/wizardry6-snes-renders');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `level${String(level).padStart(2, '0')}-${x}-${y}-f${facing}.png`);
  writePNG(outPath, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
  console.log(`Wrote ${outPath} (${width}x${height}, palette group ${group}).`);
}

main();
