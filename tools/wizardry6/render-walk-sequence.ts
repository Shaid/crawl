/**
 * Walks a real Wizardry 6 (Amiga) level through a sequence of moves,
 * rendering one PNG per step -- reuses `render-corridor-frame.ts`'s
 * compositor (same one `render-cell-driven-corridor.ts` uses for a
 * single pose). A lightweight M3-equivalent: real interactive stepping
 * isn't built (no browser harness/WalkerController wiring yet), but the
 * same facing/position state a real walker would track, updated by the
 * same confirmed stepping rules, drives a real render at each step.
 *
 * ## Collision
 *
 * A forward move is blocked exactly when `evalCellFace(px, py, facing, 0)`
 * (the *current* cell's own face in the direction of travel -- the same
 * evaluation the compositor does for its depth-0 front wall) is anything
 * other than open (dispatch 0). This is the same evaluator this whole
 * session's work already verified, not new logic -- `EvalCellFace` itself
 * has no separate "can I walk here" concept, this is just its own
 * wall-type result read as a boolean.
 *
 * Moves: `F` (step forward), `L`/`R` (turn left/right 90 degrees, no
 * position change). A blocked forward move is skipped (logged, position
 * unchanged) rather than silently ignored or throwing.
 *
 * Usage: npx tsx tools/wizardry6/render-walk-sequence.ts <dataDir> <levelFile> <x> <y> <facing> <moves>
 *   e.g.: npx tsx tools/wizardry6/render-walk-sequence.ts data/wizardry6/amiga level10.json 8 1 0 FFLFF
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { parseMazeData, decodeDirRecord } from './decode-maze.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { evalCellFace, stepForward, type CellPlanes } from './evaluate-cell.ts';
import { renderCorridorFrame, indicesToRGBA, type DecodedSource } from './render-corridor-frame.ts';

function main() {
  const [dataDir, levelFile, xArg, yArg, facingArg, moves] = process.argv.slice(2);
  if (!dataDir || !levelFile || xArg === undefined || yArg === undefined || facingArg === undefined || !moves) {
    console.error('Usage: npx tsx tools/wizardry6/render-walk-sequence.ts <dataDir> <levelFile> <x> <y> <facing> <moves (F/L/R)>');
    process.exit(1);
  }
  let x = Number(xArg);
  let y = Number(yArg);
  let facing = Number(facingArg);

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

  const outDir = resolve('public/assets/wizardry6/amiga/maps/walk');
  mkdirSync(outDir, { recursive: true });

  const writeFrame = (step: number) => {
    const surface = renderCorridorFrame(maze, planes, x, y, facing, decodeCache);
    const rgba = indicesToRGBA(surface.data, surface.width, surface.height, PIC_PALETTE);
    const outFile = `step${String(step).padStart(2, '0')}-${x}-${y}-f${facing}.png`;
    writePNG(resolve(outDir, outFile), rgba, surface.width, surface.height);
    console.log(`step ${step}: pos=(${x},${y}) facing=${facing} -> ${outFile}`);
  };

  writeFrame(0);
  let step = 1;
  for (const move of moves) {
    if (move === 'F') {
      const ahead = evalCellFace(planes, x, y, facing, 0);
      if (ahead !== 0) {
        console.log(`step ${step}: blocked -- dispatch=${ahead} ahead, not moving`);
      } else {
        const next = stepForward(x, y, facing, 1);
        x = next.x;
        y = next.y;
      }
    } else if (move === 'L') {
      facing = (facing + 3) % 4;
    } else if (move === 'R') {
      facing = (facing + 1) % 4;
    } else {
      console.log(`step ${step}: unknown move '${move}', skipping`);
      continue;
    }
    writeFrame(step);
    step++;
  }

  console.log(`Wrote ${step} frames to ${outDir}`);
}

main();
