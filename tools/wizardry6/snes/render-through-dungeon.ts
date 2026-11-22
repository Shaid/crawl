/**
 * Render one SNES Wizardry 6 dungeon pose through the v5 view model
 * (`view-model.ts`) on the window the game builds for that cell
 * (`dungeon/maze-windows.json`) -- for looking at a pose offline.
 *
 * Usage: npx tsx tools/wizardry6/snes/render-through-dungeon.ts <level> <gx> <gy> <facing>
 * (level 0-13, global maze coordinates, facing 0=N/1=E/2=S/3=W)
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { writePNG } from '@seer-project/pipeline';
import {
  resolveViewWords,
  extractPoolIndices,
  compositeSnesView,
  decodeMazeWindow,
  windowIndexFor,
  resolveRegionPaletteGroup,
  type ViewPiecesFile,
  type MazeWindowsFile,
  type Palette16,
  type LevelPalettesFile,
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
  const mw: MazeWindowsFile = JSON.parse(readFileSync(resolve(base, 'dungeon/maze-windows.json'), 'utf8'));
  const wi = windowIndexFor(mw, level, x, y);
  if (wi === null) throw new Error(`level ${level} (${x},${y}) is not a party cell (see dungeon/maze-windows.json)`);
  const win = decodeMazeWindow(mw, wi);
  const viewPieces: ViewPiecesFile = JSON.parse(readFileSync(resolve(base, 'dungeon/view-pieces.json'), 'utf8'));
  const { rgba: poolRgba, width: poolW } = loadPNG(resolve(base, `dungeon/${viewPieces.poolAtlas}`));
  const pool = extractPoolIndices(poolRgba, poolW, poolRgba.length / poolW / 4);

  const levelPalettes: LevelPalettesFile = JSON.parse(readFileSync(resolve(base, 'dungeon/level-palettes.json'), 'utf8'));
  const group = resolveRegionPaletteGroup(levelPalettes, level, win.region);
  console.log(`Window ${wi}: centre region ${win.region} at (${win.originX},${win.originY}); palette group ${group}.`);
  const paletteFile: { colors: { r: number; g: number; b: number }[] } = JSON.parse(
    readFileSync(resolve(base, `palettes/dungeon-region-${group}.json`), 'utf8'),
  );
  const palette: Palette16 = paletteFile.colors;

  const words = resolveViewWords(viewPieces, win, x, y, facing);
  console.log(`Pose (${x},${y}) facing ${'NESW'[facing]}: ${words.length} compose words -> ${words.map((w) => `0x${w.toString(16)}`).join(' ')}`);

  const { rgba, width, height } = compositeSnesView(viewPieces, pool, poolW, palette, words);

  const outDir = resolve('build/cache/wizardry6-snes-renders');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `level${String(level).padStart(2, '0')}-${x}-${y}-f${facing}.png`);
  writePNG(outPath, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
  console.log(`Wrote ${outPath} (${width}x${height}, palette group ${group}).`);
}

main();
