/**
 * Export Eye of the Beholder II (Amiga) dungeon assets for the browser
 * walker -- same output shape as `../export-dungeon.ts` (DOS/VGA), so
 * `../renderer.ts`/`../render-through-dungeon.ts`/the walker's
 * `Eotb2View` (`tools/walker/games-eotb2.ts`) can all be reused unmodified
 * against this platform's assets, just pointed at a different asset
 * directory (`public/assets/eotb2/amiga` instead of `.../dosvga`) -- see
 * `./render-through-dungeon.ts`.
 *
 * **What's genuinely different from `../export-dungeon.ts` here** (see
 * `docs/eotb2/amiga/data-structure.md` for the full verification
 * evidence): `.VCN`/`.CPS` are LCW-compressed (Amiga is not) and 5-plane
 * Amiga bitplane pixels (not DOS's chunky 8bpp) -- `./decode-vcn.ts`/
 * `./decode-cps.ts`; `.PAL` is a standalone 64-byte/32-colour Amiga file,
 * not embedded in `.CPS`/`.VCN` and not DOS's 768-byte VGA format --
 * `./palette.ts`. `.VMP`/`.MAZ`/`.INF`/`.DEC` are all confirmed
 * byte-identical (or byte-identical container+record shape) to DOS, so
 * this module reuses those decoders directly (`../decode-vmp.ts`,
 * `../decode-maze.ts` (re-exported again via `./decode-maze.ts`),
 * `../decode-inf.ts`, `../../eotb/decode-decorations.ts`).
 *
 * `AZURE` is skipped as a **navigable** wall set for the same
 * already-confirmed reason as DOS (no `.VCN`/`.VMP` pair exists -- this
 * corpus's `AZURE.DEC`/`AZURE1.CPS`/`AZURE2.CPS` exist and ARE used, via
 * the same second-wall-set-stem palette-override mechanism as DOS, for
 * LEVEL10-14's decoration+palette identity while navigating on `mezz`'s
 * own tile geometry).
 *
 * Usage: npx tsx tools/eotb2/amiga/export-dungeon.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { decodeVcn, type VcnData } from './decode-vcn.ts';
import { decodeVmp, type VmpData } from '../decode-vmp.ts';
import { decodeMaze, type MazeData } from './decode-maze.ts';
import { decodeInf, parseInf, buildWallTypeMap, resolveWallDecorationAssignments } from './decode-inf.ts';
import { decodePal } from './palette.ts';
import { decodeCps } from './decode-cps.ts';
import { decodeDecorations, type DecorationData } from '../../eotb/decode-decorations.ts';

const LEVEL_COUNT = 16;
const SKIP_NAV_WALL_SETS = new Set(['azure']); // no .VCN/.VMP navigable tileset -- see module doc.

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/eotb2/amiga/export-dungeon.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/eotb2/amiga');
  mkdirSync(resolve(outDir, 'dungeon'), { recursive: true });
  mkdirSync(resolve(outDir, 'wallsets'), { recursive: true });

  const vcnVmpCache = new Map<string, { vcn: VcnData; vmp: VmpData }>();
  const paletteCache = new Map<string, [number, number, number][]>();
  const bundleCache = new Set<string>();
  const mazeCache = new Map<string, MazeData>();
  const decCache = new Map<string, DecorationData>();
  const cpsCache = new Map<string, { width: number; height: number; indices: number[] }>();
  const levels: { level: number; wallSet: string; skipped?: string }[] = [];
  let totalDecorationSlots = 0;

  // LEVEL5's real on-disk filename is lowercase in this corpus.
  const infFilename = (n: number) => (n === 5 ? 'level5.inf' : `LEVEL${n}.INF`);

  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const infRaw = readBinary(resolve(dataDir, infFilename(n)));
    const { mazStem, wallSetStem, secondWallSetStem } = decodeInf(infRaw);
    const navWallSet = wallSetStem.toLowerCase();

    if (SKIP_NAV_WALL_SETS.has(navWallSet)) {
      console.log(`  LEVEL${n}: wall set ${wallSetStem} -- skipped (${navWallSet} has no navigable .VCN/.VMP, see module doc)`);
      levels.push({ level: n, wallSet: wallSetStem, skipped: navWallSet });
      continue;
    }

    const paletteStem = (secondWallSetStem ?? wallSetStem).toLowerCase();
    const bundleKey = paletteStem === navWallSet ? navWallSet : `${navWallSet}+${paletteStem}`;

    if (!vcnVmpCache.has(navWallSet)) {
      const vcnRaw = readBinary(resolve(dataDir, `${navWallSet.toUpperCase()}.VCN`));
      const vmpRaw = readBinary(resolve(dataDir, `${navWallSet.toUpperCase()}.VMP`));
      const vcn = decodeVcn(vcnRaw);
      const vmp = decodeVmp(vmpRaw, vcn.numTiles);
      vcnVmpCache.set(navWallSet, { vcn, vmp });
      console.log(`  ${navWallSet}: ${vcn.numTiles} tiles, VMP oracle-checked ok`);
    }
    if (!paletteCache.has(paletteStem)) {
      const palRaw = readBinary(resolve(dataDir, `${paletteStem.toUpperCase()}.PAL`));
      paletteCache.set(paletteStem, decodePal(palRaw));
    }

    if (!bundleCache.has(bundleKey)) {
      const { vcn, vmp } = vcnVmpCache.get(navWallSet)!;
      const palette = paletteCache.get(paletteStem)!;
      writeJson(resolve(outDir, 'wallsets', `${bundleKey}.json`), {
        numTiles: vcn.numTiles,
        palette,
        tiles: vcn.tiles.map((t) => Array.from(t)),
        vmp: {
          backdrop: vmp.backdrop.map((col) => col.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
          wallTiles: vmp.wallTiles.map((run) => run.map((r) => [r.tileIndex, r.mirrorX, r.zMask])),
        },
      });
      bundleCache.add(bundleKey);
      if (bundleKey !== navWallSet) {
        console.log(`  ${bundleKey}: palette-override bundle (${navWallSet} tiles + ${paletteStem} palette)`);
      }
    }

    const mazKey = mazStem.toLowerCase();
    let maze = mazeCache.get(mazKey);
    if (!maze) {
      const mazeRaw = readBinary(resolve(dataDir, mazStem.toUpperCase()));
      maze = decodeMaze(mazeRaw);
      mazeCache.set(mazKey, maze);
    }

    const wallTypeMap = buildWallTypeMap(infRaw);
    const wallDecorations = resolveWallDecorationAssignments(infRaw);
    const { decorationLoads } = parseInf(infRaw);

    const decorationsByFile: Record<string, { properties: unknown[]; rects: unknown[] }> = {};
    const decorationSheets: Record<string, { width: number; height: number; indices: number[] }> = {};
    for (const { cpsFile, decFile } of decorationLoads) {
      if (!decCache.has(decFile)) {
        const decRaw = readBinary(resolve(dataDir, decFile.toUpperCase()));
        decCache.set(decFile, decodeDecorations(new Uint8Array(decRaw)));
      }
      const dec = decCache.get(decFile)!;
      decorationsByFile[decFile] = { properties: dec.properties, rects: dec.rects };

      if (!cpsCache.has(cpsFile)) {
        const cpsRaw = readBinary(resolve(dataDir, `${cpsFile.toUpperCase()}.CPS`));
        const cps = decodeCps(new Uint8Array(cpsRaw));
        cpsCache.set(cpsFile, { width: cps.width, height: cps.height, indices: Array.from(cps.indices) });
      }
      decorationSheets[cpsFile] = cpsCache.get(cpsFile)!;
    }
    totalDecorationSlots += wallDecorations.size;

    writeJson(resolve(outDir, 'dungeon', `level${n}.json`), {
      level: n,
      wallSet: bundleKey,
      width: maze.width,
      height: maze.height,
      cells: maze.cells.map((c) => Array.from(c)),
      wallTypeMap: Array.from(wallTypeMap),
      wallDecorations: Object.fromEntries([...wallDecorations].map(([wallIndex, a]) => [wallIndex, a])),
      decorationsByFile,
      decorationSheets,
    });
    levels.push({ level: n, wallSet: bundleKey });
    console.log(
      `  LEVEL${n}: wall set ${bundleKey}, maze ${mazStem}, ${wallDecorations.size} decorated wallIndex entries, ${Object.keys(decorationSheets).length} decoration sheet(s)`,
    );
  }

  writeJson(resolve(outDir, 'dungeon', 'levels.json'), { levels });
  console.log(
    `Wrote ${LEVEL_COUNT} levels + ${bundleCache.size} wall-set bundle(s) to ${outDir} (${totalDecorationSlots} total decorated wallIndex entries, ${decCache.size} .DEC file(s), ${cpsCache.size} decoration .CPS sheet(s))`,
  );
}

const isStandalone = process.argv[1]?.endsWith('export-dungeon.ts') || process.argv[1]?.endsWith('export-dungeon');
if (isStandalone) main();
