/**
 * Renders one real Wizardry 6 (Amiga) pose (ceiling, floor, front + both
 * side walls) from actual per-cell data (`export-dungeon-levels.ts`'s
 * output). The compositing itself lives in `render-corridor-frame.ts`
 * (shared with `render-walk-sequence.ts`) -- see that module's doc
 * comment for the full derivation of each piece's placement formula.
 *
 * Usage: npx tsx tools/wizardry6/render-cell-driven-corridor.ts <dataDir> <levelFile> <x> <y> <facing>
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { parseMazeData, decodeDirRecord } from './decode-maze.ts';
import { PIC_PALETTE } from './pic-format.ts';
import type { CellPlanes } from './evaluate-cell.ts';
import { renderCorridorFrame, indicesToRGBA, type DecodedSource } from './render-corridor-frame.ts';

function main() {
  const [dataDir, levelFile, xArg, yArg, facingArg] = process.argv.slice(2);
  if (!dataDir || !levelFile || xArg === undefined || yArg === undefined || facingArg === undefined) {
    console.error('Usage: npx tsx tools/wizardry6/render-cell-driven-corridor.ts <dataDir> <levelFile> <x> <y> <facing>');
    process.exit(1);
  }
  const x = Number(xArg);
  const y = Number(yArg);
  const facing = Number(facingArg);

  const levelPath = resolve('public/assets/wizardry6/amiga/dungeon', levelFile);
  const levelData = JSON.parse(readFileSync(levelPath, 'utf8'));
  const unit = levelData.units[0];
  const planes: CellPlanes = {
    width: levelData.cellSpace.width,
    height: levelData.cellSpace.height,
    wallA: unit.planes.wallA,
    wallB: unit.planes.wallB,
    feature: unit.planes.feature,
    orient: unit.planes.orient,
  };

  const mazeData = readBinary(resolve(dataDir, 'mazedata.ega'));
  const maze = parseMazeData(mazeData);

  const decodedByDirIndex = new Map<number, DecodedSource>();
  const decodeCache = (index: number) => {
    let cached = decodedByDirIndex.get(index);
    if (!cached) {
      const rec = maze.dirRecords[index]!;
      cached = { data: decodeDirRecord(mazeData, rec), width: rec.widthPx, height: rec.heightPx };
      decodedByDirIndex.set(index, cached);
    }
    return cached;
  };

  const surface = renderCorridorFrame(maze, planes, x, y, facing, decodeCache, (line) => console.log(line));

  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  mkdirSync(outDir, { recursive: true });
  const rgba = indicesToRGBA(surface.data, surface.width, surface.height, PIC_PALETTE);
  const outFile = `cell-driven-corridor-${x}-${y}-f${facing}.png`;
  writePNG(resolve(outDir, outFile), rgba, surface.width, surface.height);
  console.log(`Wrote ${outFile} to ${outDir}`);
}

main();
