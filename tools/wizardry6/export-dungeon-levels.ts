/**
 * Export Wizardry 6's (Amiga) 14 `scenario.dbs` maze levels as a
 * `@seer-project/dungeon` `DungeonLevelFile`.
 *
 * Output: `public/assets/wizardry6/amiga/dungeon/levels.json`, conforming to
 * `/home/ctemplet/Development/seer/packages/dungeon/src/schema/level.ts`
 * (read that file for the exact TypeScript shape).
 *
 * ## Cell space and densification
 *
 * Each level's real data is 12 sparse 8x8 "regions" placed by an explicit
 * per-region origin table within a 256x256 maze coordinate space (see
 * `decode-scenario-maze.ts`'s module docstring for the full derivation).
 * Rather than emit one giant mostly-empty 256x256 grid per level (Black
 * Crypt's fixed-64x64 convention doesn't fit here -- W6 levels vary widely
 * in real extent), this densifies each level to the *tight bounding box*
 * of its active regions (the same box `decode-scenario-maze.ts`'s
 * `renderLevel` already computes for its top-down PNG). Region-local cells
 * (`localX`/`localY` 0..7) are placed at `(originX-minX+localX,
 * originY-minY+localY)` in the level's own flat grid.
 *
 * Cells inside the bounding box that no real region covers get a
 * defensive fill (`wallA=2, wallB=2` -- "wall" under the rendered, not
 * disassembly-confirmed, value key `decode-scenario-maze.ts` documents:
 * 0=open/1=door/2=wall/3=secret) -- not game data, the same
 * rendering-safety convention Black Crypt's own exporter uses for its
 * densified gaps (`scripts/export_dungeon_levels.py`'s `FILL_WALL_FLAGS`).
 *
 * ## Wall storage: shared-edge, not Black Crypt's bitflags
 *
 * W6 stores each wall edge once, as a 2-bit value on whichever of its two
 * adjacent cells "owns" that plane -- confirmed via disassembly
 * (`CODE+0x908c`/`0x90f6`, see `docs/wizardry6/TODO.md`'s
 * `maze-plane-semantics` row and `seer`'s `FlatGridLevel.sharedEdgeValueAt`):
 * facing 0 (N) reads a cell's own `wallA`; facing 1 (E) reads its own
 * `wallB`; facing 2 (S) reads the southern neighbour's `wallA`; facing 3
 * (W) reads the western neighbour's `wallB`. So `planeDirs: [0, 1]`.
 *
 * `yAxisDown: false` (Y increases northward) -- not just assumed by analogy
 * with Black Crypt, but independently confirmed for this game: the
 * disassembly above traces facing 2 (S) stepping to `(x, y-1)`, exactly
 * matching `@seer-project/dungeon`'s own `Direction.ts` convention
 * (`facing=2 -> dy=-1`).
 *
 * ## Not yet exported
 *
 * `scenario.dbs` section 3 (the per-level entity table) has confirmed
 * structure but unconfirmed field semantics (`data-structure.md` §4.7), so
 * `entities`/`entityHandlePlane` are omitted entirely -- per the schema,
 * that's a valid "wall geometry only" level file (`CellQuery.entitiesAt`
 * then always returns `[]`). The `feature`/`orient`/`flagP`/`flagQ` planes
 * decode-scenario-maze.ts already extracts (doors, scripted overlays, etc.)
 * are carried through as extra named planes for a future pass to consume,
 * but are not yet wired into any wall/entity semantics.
 *
 * Usage: npx tsx tools/wizardry6/export-dungeon-levels.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { parseMazeLevels, type MazeLevel } from './decode-scenario-maze.ts';

const REGION_COUNT = 12;
const REGION_SIZE = 8;

/** Wall/gap fill value: 2 = "wall" under the rendered (not disassembly-confirmed) colour key. */
const FILL_WALL = 2;

interface DenseLevel {
  id: number;
  width: number;
  height: number;
  wallA: number[];
  wallB: number[];
  feature: number[];
  orient: number[];
  flagP: number[];
  flagQ: number[];
}

/** Bounding box of a level's active (non-`(0,0)`-origin) regions, in maze coordinates. */
function activeBounds(lvl: MazeLevel): { minX: number; minY: number; maxX: number; maxY: number; regions: number[] } {
  const active = Array.from({ length: REGION_COUNT }, (_, r) => r).filter(
    (r) => !(lvl.originX[r] === 0 && lvl.originY[r] === 0),
  );
  const regions = active.length > 0 ? active : Array.from({ length: REGION_COUNT }, (_, r) => r);
  const minX = Math.min(...regions.map((r) => lvl.originX[r]));
  const minY = Math.min(...regions.map((r) => lvl.originY[r]));
  const maxX = Math.max(...regions.map((r) => lvl.originX[r] + REGION_SIZE));
  const maxY = Math.max(...regions.map((r) => lvl.originY[r] + REGION_SIZE));
  return { minX, minY, maxX, maxY, regions };
}

/** Densify one level's 12 sparse regions into a flat, bounding-box-sized grid. */
function densifyLevel(lvl: MazeLevel): DenseLevel {
  const { minX, minY, maxX, maxY, regions } = activeBounds(lvl);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const cellCount = width * height;

  const wallA = new Array<number>(cellCount).fill(FILL_WALL);
  const wallB = new Array<number>(cellCount).fill(FILL_WALL);
  const feature = new Array<number>(cellCount).fill(0);
  const orient = new Array<number>(cellCount).fill(0);
  const flagP = new Array<number>(cellCount).fill(0);
  const flagQ = new Array<number>(cellCount).fill(0);

  for (const r of regions) {
    const ox = lvl.originX[r] - minX;
    const oy = lvl.originY[r] - minY;
    for (let ly = 0; ly < REGION_SIZE; ly++) {
      for (let lx = 0; lx < REGION_SIZE; lx++) {
        const srcIndex = r * 64 + ly * 8 + lx;
        const dstIndex = (oy + ly) * width + (ox + lx);
        wallA[dstIndex] = lvl.wallA[srcIndex];
        wallB[dstIndex] = lvl.wallB[srcIndex];
        feature[dstIndex] = lvl.feature[srcIndex];
        orient[dstIndex] = lvl.orient[srcIndex];
        flagP[dstIndex] = lvl.flagP[srcIndex];
        flagQ[dstIndex] = lvl.flagQ[srcIndex];
      }
    }
  }

  return { id: lvl.level, width, height, wallA, wallB, feature, orient, flagP, flagQ };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/export-dungeon-levels.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  const levels = parseMazeLevels(data);
  const dense = levels.map(densifyLevel);

  // `DungeonLevelFile.cellSpace` is one shared grid for every unit in the
  // file, but each W6 level densifies to its own, differently-sized
  // bounding box (unlike Black Crypt's uniform 64x64 maps) -- so rather
  // than pad every level to one wasteful global max size, this writes one
  // `DungeonLevelFile` per level, each with its own accurate `cellSpace`
  // and a single-entry `units` array. A consumer loads whichever level's
  // file the party is currently on, per `levels-index.json`.
  const provenance = {
    source: 'scenario.dbs section 2 (file offset 0x9408, 1346 bytes/level, 14 levels)',
    wallValues: 'RENDERED, not disassembly-confirmed: 0=open, 1=door, 2=wall, 3=secret (decode-scenario-maze.ts)',
    sharedEdgeMapping: 'CONFIRMED: CODE+0x908c/0x90f6 -- facing 0 reads own wallA, facing 1 reads own wallB, facing 2/3 read the neighbour cell\'s wallA/wallB',
    fill: 'cells inside a level\'s bounding box not covered by any real 8x8 region are filled wallA=wallB=2 (wall) -- a rendering-safety default, not game data',
    notExported: 'scenario.dbs section 3 (per-level entity table) -- structure confirmed, field semantics open, see docs/wizardry6/amiga/data-structure.md section 4.7',
  };

  const outDir = resolve('public/assets/wizardry6/amiga/dungeon');
  mkdirSync(outDir, { recursive: true });

  for (const lvl of dense) {
    const perUnitFile = {
      schemaVersion: 1,
      game: 'wizardry6',
      platform: 'amiga',
      cellSpace: { kind: 'flat', width: lvl.width, height: lvl.height },
      wallStorage: {
        kind: 'shared-edge',
        planes: ['wallA', 'wallB'],
        planeDirs: [0, 1],
        offMapValue: FILL_WALL,
      },
      yAxisDown: false,
      units: [{
        id: lvl.id,
        planes: {
          wallA: lvl.wallA,
          wallB: lvl.wallB,
          feature: lvl.feature,
          orient: lvl.orient,
          flagP: lvl.flagP,
          flagQ: lvl.flagQ,
        },
      }],
      provenance,
    };
    writeJson(resolve(outDir, `level${String(lvl.id).padStart(2, '0')}.json`), perUnitFile);
  }

  writeJson(resolve(outDir, 'levels-index.json'), {
    schemaVersion: 1,
    game: 'wizardry6',
    platform: 'amiga',
    levels: dense.map((lvl) => ({ id: lvl.id, width: lvl.width, height: lvl.height, file: `level${String(lvl.id).padStart(2, '0')}.json` })),
  });

  console.log(`Wrote ${dense.length} per-level DungeonLevelFile JSON files (level00.json .. level${String(dense.length - 1).padStart(2, '0')}.json) and levels-index.json to ${outDir}`);
}

main();
