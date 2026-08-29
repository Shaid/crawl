/**
 * Export Eye of the Beholder 1 (Amiga) dungeon assets for the browser
 * walker: per-level maze JSON, per-wall-set VCN tiles + palette + VMP
 * layout as JSON (small enough not to need a packed PNG atlas -- see
 * `renderer.ts`'s module doc for why this renders per-tile at runtime
 * instead of from a pre-baked atlas).
 *
 * Usage: npx tsx tools/eotb/export-dungeon.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { decodeCps } from './decode-cps.ts';
import { decodeVcn, applyVcnPalette } from './decode-vcn.ts';
import { decodeVmp } from './decode-vmp.ts';
import { decodeMaze } from './decode-maze.ts';
import { decodeDecorations } from './decode-decorations.ts';
import { findWallSet, buildWallTypeMap, resolveWallDecorationAssignments, parseInf, type WallSet } from './decode-inf.ts';

const WALL_SETS: WallSet[] = ['BRICK', 'BLUE', 'DROW', 'GREEN', 'XANATHA'];
const LEVEL_COUNT = 12;

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/eotb/export-dungeon.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/eotb/amiga');
  mkdirSync(resolve(outDir, 'dungeon'), { recursive: true });
  mkdirSync(resolve(outDir, 'wallsets'), { recursive: true });

  const invent = decodeCps(readBinary(resolve(dataDir, 'INVENT.CPS')));
  if (!invent.palette) throw new Error('INVENT.CPS did not carry an embedded 32-colour palette -- oracle check failed');
  console.log(`Decoded INVENT.CPS base palette (32 colours)`);

  // Pre-pass: which decoration CPS filenames does each wall set actually reference (`decode-inf.ts`'s
  // `resolveWallDecorationAssignments` doc comment -- BRICK alone spans 3 distinct sheets, brick1/2/3).
  const cpsFilesByWallSet = new Map<WallSet, Set<string>>();
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const infRaw = readBinary(resolve(dataDir, `LEVEL${n}.INF`));
    const wallSet = findWallSet(infRaw);
    const { decorationLoads } = parseInf(infRaw);
    const set = cpsFilesByWallSet.get(wallSet) ?? new Set<string>();
    for (const { cpsFile } of decorationLoads) set.add(cpsFile);
    cpsFilesByWallSet.set(wallSet, set);
  }

  for (const wallSet of WALL_SETS) {
    const vcnRaw = readBinary(resolve(dataDir, `${wallSet}.VCN`));
    const vmpRaw = readBinary(resolve(dataDir, `${wallSet}.VMP`));
    const vcn = decodeVcn(vcnRaw);
    const vmp = decodeVmp(vmpRaw, vcn.numTiles);
    const palette = applyVcnPalette(invent.palette, vcn);

    const decorations = decodeDecorations(readBinary(resolve(dataDir, `${wallSet}.DAT`)));
    const decorationSheets: Record<string, { width: number; height: number; indices: number[] }> = {};
    for (const cpsFile of cpsFilesByWallSet.get(wallSet) ?? []) {
      const cps = decodeCps(readBinary(resolve(dataDir, `${cpsFile.toUpperCase()}.CPS`)));
      decorationSheets[cpsFile] = { width: 320, height: 200, indices: Array.from(cps.indices) };
    }

    writeJson(resolve(outDir, 'wallsets', `${wallSet.toLowerCase()}.json`), {
      numTiles: vcn.numTiles,
      palette,
      tiles: vcn.tiles.map((t) => Array.from(t)),
      vmp: {
        header: vmp.header,
        backdrop: vmp.backdrop.map((col) => col.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
        wallTiles: vmp.wallTiles.map((run) => run.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
      },
      decorations: {
        properties: decorations.properties,
        rects: decorations.rects,
      },
      decorationSheets,
    });
    console.log(
      `  ${wallSet}: ${vcn.numTiles} tiles, VMP oracle-checked ok, ${decorations.properties.length} decoration properties / ${decorations.rects.length} rects, ${Object.keys(decorationSheets).length} decoration sheet(s)`,
    );
  }

  const levels: { level: number; wallSet: WallSet }[] = [];
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const mazeRaw = readBinary(resolve(dataDir, `LEVEL${n}.MAZ`));
    const infRaw = readBinary(resolve(dataDir, `LEVEL${n}.INF`));
    const maze = decodeMaze(mazeRaw);
    const wallSet = findWallSet(infRaw);
    const wallTypeMap = buildWallTypeMap(infRaw);
    const wallDecorations = resolveWallDecorationAssignments(infRaw);
    writeJson(resolve(outDir, 'dungeon', `level${n}.json`), {
      level: n,
      wallSet,
      width: maze.width,
      height: maze.height,
      cells: maze.cells.map((c) => Array.from(c)),
      wallTypeMap: Array.from(wallTypeMap),
      wallDecorations: Object.fromEntries([...wallDecorations].map(([wallIndex, a]) => [wallIndex, a])),
    });
    levels.push({ level: n, wallSet });
    console.log(`  LEVEL${n}: wall set ${wallSet}, ${wallDecorations.size} decorated wallIndex entries`);
  }

  writeJson(resolve(outDir, 'dungeon', 'levels.json'), { levels });
  console.log(`Wrote ${LEVEL_COUNT} levels + ${WALL_SETS.length} wall sets to ${outDir}`);
}

const isStandalone = process.argv[1]?.endsWith('export-dungeon.ts') || process.argv[1]?.endsWith('export-dungeon');
if (isStandalone) main();
