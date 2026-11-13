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
 * Cells inside the bounding box that no real region covers are off-map
 * (`region = -1`) and get a fill (`wallA=wallB=2`, or 0 on levels 10/12,
 * whose off-map space is open -- data-structure.md §4.7.10; wall values are
 * confirmed 0=open/1=doorway/2=wall/3=closed door) -- not game data, the same
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
 * `scenario.dbs` section 3 is exported only as the W6 extension
 * `w6.links` (movement.ts: teleports, door states, trigger bits; §4.7.10),
 * not as schema `entities`, so `entities`/`entityHandlePlane` are omitted -- per the schema,
 * that's a valid "wall geometry only" level file (`CellQuery.entitiesAt`
 * then always returns `[]`). The `feature`/`orient` planes decode-
 * scenario-maze.ts already extracts (doors, etc.) are carried through as
 * extra named planes for a future pass to consume, but are not yet wired
 * into any entity semantics. `flagP`/`flagQ` (the scripted overlay bits)
 * ARE wired -- `evaluate-cell.ts`'s `evalOverlay` + `view-model.ts`
 * implement their full per-level dispatch, §4.7.9 -- and `region` (the
 * source region index 0-11 per densified cell, `-1` for a gap) is exported
 * solely to feed that dispatch's level-12 special case.
 *
 * Usage: npx tsx tools/wizardry6/export-dungeon-levels.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { parseMazeLevels, type MazeLevel } from './decode-scenario-maze.ts';
import { canStepStatic, parseEntityTable, offMapIsOpen, W6_NEW_GAME_START, type W6LevelLinks } from './movement.ts';

const REGION_COUNT = 12;
const REGION_SIZE = 8;

/** Wall/gap fill value: 2 = solid wall. Levels 10/12 use 0 instead -- their off-map space is open (movement.ts `offMapIsOpen`, data-structure.md §4.7.10). */
const FILL_WALL = 2;
const fillFor = (level: number) => (offMapIsOpen(level) ? 0 : FILL_WALL);

interface DenseLevel {
  id: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  wallA: number[];
  wallB: number[];
  feature: number[];
  orient: number[];
  flagP: number[];
  flagQ: number[];
  /** Source region index (0-11) of each densified cell, `-1` for a gap not covered by any real region. Needed only by `evalOverlay`'s level-12 flagP special case (data-structure.md §4.7.9: region 0-8 -> alt-floor, region 9-11/gap -> fog). */
  region: number[];
}

/**
 * Bounding box of a level's active (non-`(0,0)`-origin) regions, in maze coordinates.
 * Origin-(0,0) regions are not empty padding: 19 of the 20 hold non-zero cells
 * (levels 10/11/13), and the resolver (`LAB_045D`) does search them. They are
 * excluded because nothing reaches them: 0 of 262 teleporter targets and
 * 0 entities point into them (2026-11-13 census, data-structure.md review
 * finding 7).
 */
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

  const wallA = new Array<number>(cellCount).fill(fillFor(lvl.level));
  const wallB = new Array<number>(cellCount).fill(fillFor(lvl.level));
  const feature = new Array<number>(cellCount).fill(0);
  const orient = new Array<number>(cellCount).fill(0);
  const flagP = new Array<number>(cellCount).fill(0);
  const flagQ = new Array<number>(cellCount).fill(0);
  const region = new Array<number>(cellCount).fill(-1);

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
        region[dstIndex] = r;
      }
    }
  }

  // originX/originY: the densified grid's (0,0) in absolute maze coordinates
  // — needed by `view-model.ts`'s checkerboard parities (§4.7.8), which the
  // game computes from the absolute party position (`-18338/-18336(A4)`).
  return { id: lvl.level, width, height, originX: minX, originY: minY, wallA, wallB, feature, orient, flagP, flagQ, region };
}

/** Core export logic, reusable from a pipeline `buildAssets` step as well as the CLI below. */
export function exportDungeonLevels(dataDir: string): void {
  const data = readBinary(resolve(dataDir, 'scenario.dbs'));
  const levels = parseMazeLevels(data);
  const dense = levels.map(densifyLevel);
  // SCENARIO.HDR's first 140 bytes = the initial `-30310(A4)` per-level
  // 80-bit entity-trigger tables (LAB_02C5, CODE+0x4878; movement.ts).
  const scenarioHdr = readBinary(resolve(dataDir, 'scenario.hdr'));
  const links = levels.map((lvl, l) => buildLinks(lvl, dense[l]!, levels, dense, data, scenarioHdr));

  // `DungeonLevelFile.cellSpace` is one shared grid for every unit in the
  // file, but each W6 level densifies to its own, differently-sized
  // bounding box (unlike Black Crypt's uniform 64x64 maps) -- so rather
  // than pad every level to one wasteful global max size, this writes one
  // `DungeonLevelFile` per level, each with its own accurate `cellSpace`
  // and a single-entry `units` array. A consumer loads whichever level's
  // file the party is currently on, per `levels-index.json`.
  const provenance = {
    source: 'scenario.dbs section 2 (file offset 0x9408, 1346 bytes/level, 14 levels)',
    wallValues: 'CONFIRMED cross-platform (snes/data-structure.md 3.14.12): 0=open, 1=open doorway, 2=solid wall, 3=closed door',
    sharedEdgeMapping: 'CONFIRMED: CODE+0x908c/0x90f6 -- facing 0 reads own wallA, facing 1 reads own wallB, facing 2/3 read the neighbour cell\'s wallA/wallB',
    fill: 'cells inside a level\'s bounding box not covered by any real 8x8 region are off-map (region=-1); their wall planes are filled 2 (wall), or 0 on levels 10/12 whose off-map space is open (data-structure.md 4.7.10) -- consumers should test region<0, not the fill',
    w6: 'w6.links = scenario.dbs section 3 entity tables + pre-resolved kind-1 teleport targets + SCENARIO.HDR initial trigger bits, consumed by tools/wizardry6/movement.ts (data-structure.md 4.7.10)',
  };

  const outDir = resolve('public/assets/wizardry6/amiga/dungeon');
  mkdirSync(outDir, { recursive: true });

  for (const lvl of dense) {
    const perUnitFile = {
      schemaVersion: 1,
      game: 'wizardry6',
      platform: 'amiga',
      cellSpace: { kind: 'flat', width: lvl.width, height: lvl.height },
      // absolute maze coordinate of grid (0,0) -- feeds view-model.ts's
      // checkerboard parities (-11434/-11436(A4), section 4.7.8)
      origin: { x: lvl.originX, y: lvl.originY },
      wallStorage: {
        kind: 'shared-edge',
        planes: ['wallA', 'wallB'],
        planeDirs: [0, 1],
        offMapValue: fillFor(lvl.id),
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
          region: lvl.region,
        },
      }],
      provenance,
      // W6-specific extension (not part of the shared schema): the move
      // port's entity/teleport/trigger data, and -- level 12 only -- the
      // game's own new-party start pose (CODE+0x4212a).
      w6: {
        links: links[lvl.id],
        entrance: entranceFor(lvl, levels, links),
      },
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

function denseRegionOrigin(lvl: MazeLevel, d: DenseLevel, r: number): { x: number; y: number } | null {
  if (lvl.originX[r] === 0 && lvl.originY[r] === 0) return null;
  return { x: lvl.originX[r]! - d.originX, y: lvl.originY[r]! - d.originY };
}

function buildLinks(lvl: MazeLevel, d: DenseLevel, levels: MazeLevel[], dense: DenseLevel[], scenario: Uint8Array, hdr: Uint8Array): W6LevelLinks {
  const entities = parseEntityTable(scenario, lvl.level);
  const regionOrigin = Array.from({ length: REGION_COUNT }, (_, r) => denseRegionOrigin(lvl, d, r));
  const teleportDest = entities.kind.map((kind, k) => {
    if (kind !== 1) return null;
    const w = entities.w240[k]!;
    const destLevel = entities.b630[k]!;
    if (destLevel >= levels.length) return null; // 99 -> leave the maze; none shipped
    const o = denseRegionOrigin(levels[destLevel]!, dense[destLevel]!, (w >> 6) & 15);
    if (!o) return null;
    return { level: destLevel, x: o.x + (w & 7), y: o.y + ((w >> 3) & 7) };
  });
  const initialFlags = Array.from(hdr.subarray(lvl.level * 10, lvl.level * 10 + 10));
  return { level: lvl.level, regionOrigin, entities, teleportDest, initialFlags };
}

function newGameStart(lvl: MazeLevel, d: DenseLevel): { x: number; y: number; facing: number } {
  const s = W6_NEW_GAME_START;
  const o = denseRegionOrigin(lvl, d, s.region)!;
  return { x: o.x + s.localX, y: o.y + s.localY, facing: s.facing };
}

/**
 * A level's default walker entrance: level 12 = the game's own new-party
 * start (CODE+0x4212a); any other level = the first teleport arrival from a
 * different level that is enabled at new game (lowest source level, then
 * entity index), facing the
 * first direction the move port lets the party step. `null` if no level
 * links into it (the walker then falls back to a plane scan).
 */
function entranceFor(d: DenseLevel, levels: MazeLevel[], links: W6LevelLinks[]): { x: number; y: number; facing: number; source: string } | null {
  if (d.id === W6_NEW_GAME_START.level) return { ...newGameStart(levels[d.id]!, d), source: 'new-game start pose (CODE+0x4212a)' };
  for (const src of links) {
    if (src.level === d.id) continue;
    for (let k = 0; k < src.teleportDest.length; k++) {
      const t = src.teleportDest[k];
      if (!t || t.level !== d.id) continue;
      const bit = src.entities.flagBit[k]!;
      if ((((src.initialFlags[bit >> 3] ?? 0) >> (bit & 7)) & 1) === 1) continue; // disabled at new game
      const planes = { width: d.width, height: d.height, wallA: d.wallA, wallB: d.wallB, flagP: d.flagP, flagQ: d.flagQ, region: d.region, level: d.id };
      let facing = 0;
      for (let f = 0; f < 4; f++) if (canStepStatic(planes, links[d.id], t.x, t.y, f)) { facing = f; break; }
      return { x: t.x, y: t.y, facing, source: `teleport arrival from level ${src.level} entity ${k}` };
    }
  }
  return null;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/export-dungeon-levels.ts <dataDir>');
    process.exit(1);
  }
  exportDungeonLevels(dataDir);
}

const isStandalone =
  process.argv[1]?.endsWith('export-dungeon-levels.ts') ||
  process.argv[1]?.endsWith('export-dungeon-levels');

if (isStandalone) main();
