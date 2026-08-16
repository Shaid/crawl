/**
 * Export Lands of Lore dungeon assets for the browser walker: per-level
 * maze JSON, per-wall-set VCN tiles + palette + VMP layout as JSON -- same
 * shape as `tools/eotb/export-dungeon.ts`/`tools/eotb2/export-dungeon.ts`,
 * per-tile runtime rendering rather than a pre-baked atlas.
 *
 * `data/landsoflore/dosvga/GAME.DAT` is a raw ISO 9660 image, not game data
 * directly (`docs/landsoflore/dosvga/data-structure.md` § "GAME.DAT").
 * This shells out to `7z` to pull the specific `DATA/*.PAK` files needed
 * into `build/cache/landsoflore/iso/` -- the same cache location
 * `scripts/extract_landsoflore_dosvga.py` already uses, so both tools
 * share one extraction (re-running either is a no-op once cached).
 *
 * **Level selection.** `decode-vmp.ts` derives its wall-type count from
 * the file's own entry count (`backdrop + N*431`, N variable 2-6 -- see
 * that module's doc), so every wall set surveyed this session decodes
 * cleanly, including `FOREST1` (an earlier draft skipped it by analogy to
 * EOB2's own rigid-6-wallType FOREST gap; corrected once `1192-330=2*431`
 * was checked directly). The levels below were picked by a real per-level
 * survey this session (each level's `LEVELn.INI` wall-set string,
 * cross-checked against its wall set's actual VMP entry count) -- 11
 * levels across 6 distinct wall sets:
 *
 * | Level | Wall set | wallTypes |
 * |---|---|---|
 * | 1 | KEEP | 6 |
 * | 2,3 | FOREST1 | 2 |
 * | 4 | MANOR | 4 |
 * | 5,6,7,8,9 | CAVE1 | 5 |
 * | 11 | SWAMP | 3 |
 * | 12 | URBISH | 6 |
 *
 * (Level 10 also uses FOREST1 but isn't included -- no reason it wouldn't
 * work the same as 2/3, just not surveyed/verified this session; a cheap
 * follow-up if more FOREST1 coverage is wanted.)
 *
 * Usage: npx tsx tools/landsoflore/export-dungeon.ts <dataDir>
 * (`dataDir` = `data/landsoflore/dosvga`, the directory containing `GAME.DAT`)
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeJson } from '@seer-project/pipeline';
import { decodeVcn } from './decode-vcn.ts';
import { decodeVmp } from './decode-vmp.ts';
import { decodeCmz, type MazeData } from './decode-maze.ts';
import { decodeWll } from './decode-wll.ts';
import { decodeIniWallSet } from './decode-ini.ts';

interface PakEntry {
  name: string;
  offset: number;
  size: number;
}

/** Minimal Kyra PAK reader -- byte-identical container to EOB's, confirmed (`docs/landsoflore/dosvga/data-structure.md` § "PAK"): a table of `[u32 LE offset, name]` pairs (name NUL-terminated) terminated by a zero offset, entry `i`'s size = `offset[i+1] - offset[i]` (last entry runs to EOF). */
export function parsePak(data: Uint8Array): Map<string, PakEntry> {
  const entries: { name: string; offset: number }[] = [];
  let p = 0;
  for (;;) {
    const offset = data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16) | (data[p + 3]! << 24);
    p += 4;
    if (offset === 0) break;
    let end = p;
    while (data[end] !== 0) end++;
    const name = new TextDecoder('ascii').decode(data.subarray(p, end));
    p = end + 1;
    entries.push({ name, offset });
  }
  const map = new Map<string, PakEntry>();
  for (let i = 0; i < entries.length; i++) {
    const { name, offset } = entries[i]!;
    const nextOffset = i + 1 < entries.length ? entries[i + 1]!.offset : data.length;
    map.set(name, { name, offset, size: nextOffset - offset });
  }
  return map;
}

export function readEntry(data: Uint8Array, entry: PakEntry): Uint8Array {
  return data.subarray(entry.offset, entry.offset + entry.size);
}

export const LEVEL_WALL_SETS: Record<number, string> = {
  1: 'KEEP', 2: 'FOREST1', 3: 'FOREST1', 4: 'MANOR', 5: 'CAVE1', 6: 'CAVE1', 7: 'CAVE1', 8: 'CAVE1', 9: 'CAVE1',
  11: 'SWAMP', 12: 'URBISH',
};

export const CACHE_DIR = resolve('build/cache/landsoflore/iso');

export function ensureExtracted(isoPath: string, cacheDir: string, isoRelPaths: string[]): void {
  const missing = isoRelPaths.filter((p) => !existsSync(resolve(cacheDir, p)));
  if (missing.length === 0) return;
  mkdirSync(cacheDir, { recursive: true });
  execFileSync('7z', ['x', '-y', `-o${cacheDir}`, isoPath, ...missing], { stdio: 'pipe' });
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/landsoflore/export-dungeon.ts <dataDir>');
    process.exit(1);
  }

  const isoPath = resolve(dataDir, 'GAME.DAT');
  const cacheDir = CACHE_DIR;
  const levelNums = Object.keys(LEVEL_WALL_SETS).map(Number);
  const wallSets = [...new Set(Object.values(LEVEL_WALL_SETS))];

  const isoRelPaths = [
    ...levelNums.map((n) => `DATA/L${String(n).padStart(2, '0')}.PAK`),
    ...wallSets.map((w) => `DATA/${w}.PAK`),
  ];
  ensureExtracted(isoPath, cacheDir, isoRelPaths);

  const outDir = resolve('public/assets/landsoflore/dosvga');
  mkdirSync(resolve(outDir, 'dungeon'), { recursive: true });
  mkdirSync(resolve(outDir, 'wallsets'), { recursive: true });

  const wallSetCache = new Set<string>();
  const levels: { level: number; wallSet: string }[] = [];

  for (const wallSet of wallSets) {
    const pakData = readFileSync(resolve(cacheDir, 'DATA', `${wallSet}.PAK`));
    const entries = parsePak(pakData);
    const vcn = decodeVcn(readEntry(pakData, entries.get(`${wallSet}.VCN`)!));
    const vmp = decodeVmp(readEntry(pakData, entries.get(`${wallSet}.VMP`)!), vcn.numTiles);
    writeJson(resolve(outDir, 'wallsets', `${wallSet.toLowerCase()}.json`), {
      numTiles: vcn.numTiles,
      palette: vcn.palette,
      tiles: vcn.tiles.map((t) => Array.from(t)),
      wallTypes: vmp.wallTiles.length,
      vmp: {
        backdrop: vmp.backdrop.map((col) => col.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
        wallTiles: vmp.wallTiles.map((run) => run.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
      },
    });
    wallSetCache.add(wallSet);
    console.log(`  ${wallSet}: ${vcn.numTiles} tiles, ${vmp.wallTiles.length} wallTypes, VMP oracle-checked ok`);
  }

  for (const n of levelNums) {
    const wallSet = LEVEL_WALL_SETS[n]!;
    const pakData = readFileSync(resolve(cacheDir, 'DATA', `L${String(n).padStart(2, '0')}.PAK`));
    const entries = parsePak(pakData);

    const iniEntry = [...entries.keys()].find((k) => k.toUpperCase() === `LEVEL${n}.INI`);
    if (iniEntry) {
      const resolvedWallSet = decodeIniWallSet(readEntry(pakData, entries.get(iniEntry)!));
      if (resolvedWallSet !== wallSet) {
        throw new Error(`export-dungeon: LEVEL${n}.INI resolves to wall set ${resolvedWallSet}, expected ${wallSet} -- update LEVEL_WALL_SETS`);
      }
    }

    const cmzEntry = [...entries.keys()].find((k) => k.toUpperCase() === `LEVEL${n}.CMZ`);
    const maze: MazeData = decodeCmz(readEntry(pakData, entries.get(cmzEntry!)!));

    const wllEntry = [...entries.keys()].find((k) => k.toUpperCase() === `LEVEL${n}.WLL`);
    const wll = wllEntry ? decodeWll(readEntry(pakData, entries.get(wllEntry)!)) : null;

    writeJson(resolve(outDir, 'dungeon', `level${n}.json`), {
      level: n,
      wallSet: wallSet.toLowerCase(),
      width: maze.width,
      height: maze.height,
      cells: maze.cells.map((c) => Array.from(c)),
      wll, // consumed by view-model.ts's resolveRawWallType via decode-wll.ts's buildWllLookup -- see that module's doc
    });
    levels.push({ level: n, wallSet: wallSet.toLowerCase() });
    console.log(`  LEVEL${n}: wall set ${wallSet}`);
  }

  writeJson(resolve(outDir, 'dungeon', 'levels.json'), { levels });
  console.log(`Wrote ${levels.length} levels + ${wallSetCache.size} wall sets to ${outDir}`);
}

const isStandalone = process.argv[1]?.endsWith('export-dungeon.ts') || process.argv[1]?.endsWith('export-dungeon');
if (isStandalone) main();
