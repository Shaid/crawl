/**
 * Export Eye of the Beholder II (DOS/VGA) dungeon assets for the browser
 * walker: per-level maze JSON, per-wall-set VCN tiles + palette + VMP
 * layout as JSON -- same shape as `tools/eotb/export-dungeon.ts`, per-tile
 * runtime rendering rather than a pre-baked atlas (see `renderer.ts`'s
 * module doc).
 *
 * Reads each `LEVELn.INF` (n=1..16) to resolve its real `mazStem`/
 * `wallSetStem` rather than assuming `LEVELn.MAZ` -- `LEVEL16.INF`'s own
 * `mazStem` is `"level15.maz"` (a documented maze-reuse case, `docs/eotb2/
 * dosvga/data-structure.md` § "VCN / VMP"), so a level-number-keyed
 * filename guess would silently produce a wrong (empty) LEVEL16.MAZ read.
 * The resolved maze grid is written inline into each level's own JSON
 * (matching EOB1's `export-dungeon.ts` convention) -- level 16 duplicates
 * level 15's grid rather than needing a cross-file reference, a small
 * space cost accepted for consumer simplicity.
 *
 * `FOREST` and `AZURE` wall sets are skipped: `FOREST.VMP` has a
 * non-standard 1192-entry layout `decode-vmp.ts` doesn't support (see its
 * module doc), and `AZURE` has no `.VCN`/`.VMP` at all (confirmed by
 * design -- no level ever references it as a navigable wall set). Neither
 * gap is silent: any level that *did* reference them would throw here
 * loudly rather than fall back to something else, but per the cited doc,
 * no level in this corpus actually does.
 *
 * Usage: npx tsx tools/eotb2/export-dungeon.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { decodeVcn } from './decode-vcn.ts';
import { decodeVmp } from './decode-vmp.ts';
import { decodeMaze, type MazeData } from './decode-maze.ts';
import { decodeInf } from './decode-inf.ts';
import { decodePal } from './palette.ts';

const LEVEL_COUNT = 16;
const SKIP_WALL_SETS = new Set(['azure', 'forest']);

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/eotb2/export-dungeon.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/eotb2/dosvga');
  mkdirSync(resolve(outDir, 'dungeon'), { recursive: true });
  mkdirSync(resolve(outDir, 'wallsets'), { recursive: true });

  const wallSetCache = new Set<string>();
  const mazeCache = new Map<string, MazeData>();
  const levels: { level: number; wallSet: string; skipped?: string }[] = [];

  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const infRaw = readBinary(resolve(dataDir, `LEVEL${n}.INF`));
    const { mazStem, wallSetStem } = decodeInf(infRaw);
    const wallSet = wallSetStem.toLowerCase();

    if (SKIP_WALL_SETS.has(wallSet)) {
      console.log(`  LEVEL${n}: wall set ${wallSetStem} -- skipped (${wallSet} not supported, see module doc)`);
      levels.push({ level: n, wallSet: wallSetStem, skipped: wallSet });
      continue;
    }

    if (!wallSetCache.has(wallSet)) {
      const vcnRaw = readBinary(resolve(dataDir, `${wallSetStem.toUpperCase()}.VCN`));
      const vmpRaw = readBinary(resolve(dataDir, `${wallSetStem.toUpperCase()}.VMP`));
      const palRaw = readBinary(resolve(dataDir, `${wallSetStem.toUpperCase()}.PAL`));
      const vcn = decodeVcn(vcnRaw);
      const vmp = decodeVmp(vmpRaw, vcn.numTiles);
      const palette = decodePal(palRaw);

      writeJson(resolve(outDir, 'wallsets', `${wallSet}.json`), {
        numTiles: vcn.numTiles,
        palette,
        tiles: vcn.tiles.map((t) => Array.from(t)),
        vmp: {
          backdrop: vmp.backdrop.map((col) => col.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
          wallTiles: vmp.wallTiles.map((run) => run.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
        },
      });
      wallSetCache.add(wallSet);
      console.log(`  ${wallSetStem}: ${vcn.numTiles} tiles, VMP oracle-checked ok`);
    }

    // mazStem, e.g. "level1.maz" -- this corpus's real filenames are
    // uppercase; resolve case-insensitively and cache by stem so the
    // documented LEVEL16->level15.maz reuse only reads the file once.
    const mazKey = mazStem.toLowerCase();
    let maze = mazeCache.get(mazKey);
    if (!maze) {
      const mazeRaw = readBinary(resolve(dataDir, mazStem.toUpperCase()));
      maze = decodeMaze(mazeRaw);
      mazeCache.set(mazKey, maze);
    }

    writeJson(resolve(outDir, 'dungeon', `level${n}.json`), {
      level: n,
      wallSet,
      width: maze.width,
      height: maze.height,
      cells: maze.cells.map((c) => Array.from(c)),
    });
    levels.push({ level: n, wallSet: wallSetStem });
    console.log(`  LEVEL${n}: wall set ${wallSetStem}, maze ${mazStem}`);
  }

  writeJson(resolve(outDir, 'dungeon', 'levels.json'), { levels });
  console.log(`Wrote ${LEVEL_COUNT} levels + ${wallSetCache.size} wall sets to ${outDir}`);
}

const isStandalone = process.argv[1]?.endsWith('export-dungeon.ts') || process.argv[1]?.endsWith('export-dungeon');
if (isStandalone) main();
