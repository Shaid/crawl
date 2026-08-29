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
 * `AZURE` is the one wall set still skipped for its **navigable** tileset
 * (no `.VCN`/`.VMP` at all -- confirmed by design, no level ever
 * references it as a navigable wall set). Not silent: a level that *did*
 * reference it would throw here loudly rather than fall back to something
 * else, but per the cited doc, no level in this corpus actually does.
 * `FOREST` (`count=1192`, previously also skipped as "non-standard") is
 * no longer special-cased -- `decode-vmp.ts` derives its wall-type-run
 * count from the file's own byte size instead of assuming a fixed 6, so
 * it decodes and renders like any other wall set now. **Note: AZURE's
 * `.DEC`/`.CPS`/`.PAL` files ARE used** even though its `.VCN`/`.VMP`
 * navigable tileset is not -- see the palette-override paragraph below.
 *
 * Wall-mapping/decoration-load records (`decode-inf.ts`'s
 * `buildWallTypeMap`/`resolveWallDecorationAssignments`, added 2026-08-29)
 * are now decoded and exported per level: the real `rawWallIndex ->
 * vmpIndex` table (replacing the previous raw-passthrough/clamp-to-1
 * fallback), plus every decoration `.DEC`/`.CPS` file this level's own
 * `.INF` record stream references (cached globally by filename across
 * the whole export run, since several levels share the same `.DEC`/`.CPS`
 * pair -- e.g. `brown.dec` is used by LEVEL1-3).
 *
 * **Palette override via the second wall-set stem (2026-08-29, closes
 * `docs/eotb2/TODO.md`'s `eotb2-inf-second-wallset-runtime-consumer`).**
 * Traced `EoBCoreEngine::initLevelData` (`engine/scene_eob.cpp`) line by
 * line: `tmpStr` is assigned from the FIRST wall-set stem's palette
 * filename (`"%s.PAL"`, formatted from `wallSetStem`), then -- when a
 * second wall-set stem is present -- **unconditionally reassigned** (not
 * merged/appended) from the SECOND stem's palette filename; the
 * following `_screen->loadPalette(tmpStr.c_str(), ...)` call loads
 * whichever value `tmpStr` ends up holding. So for `LEVEL10`-`LEVEL14`
 * (the 5 real levels with a second wall-set stem, always `"azure"`), the
 * level's real active palette is **`AZURE.PAL`, not `MEZZ.PAL`** -- the
 * level's navigable wall tileset stays `mezz` (`.VCN`/`.VMP`), but every
 * on-screen colour (walls AND decorations) is drawn through Azure's
 * distinct palette. Confirmed as a real, visible difference, not a
 * no-op: `MEZZ.PAL` and `AZURE.PAL` differ in 73/768 raw bytes (~24 of
 * 256 colour entries). This also gives a coherent in-universe reading
 * for why decoration-load records on these same 5 levels reference
 * `azure.dec`/`azure1.cps`/`azure2.cps` instead of `mezz.dec` (`decode-
 * inf.ts`'s module doc) -- a themed "azure vault" area built on the
 * `mezz` tile geometry, previously an unexplained correlation, now a
 * traced, singular mechanism (one palette-file swap) explaining both.
 * Implemented below as a **palette-variant wall-set bundle**: VCN/VMP
 * tile decode is cached by the navigable tileset name, palette decode is
 * cached separately by the palette-source stem, and the two are combined
 * into a bundle keyed `<wallSet>` (no override) or `<wallSet>+<paletteStem>`
 * (override present) -- `level{n}.json`'s `wallSet` field names this
 * bundle key, not the bare navigable-tileset name, so a level with an
 * override transparently loads its own correctly-coloured bundle.
 *
 * Usage: npx tsx tools/eotb2/export-dungeon.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { decodeVcn, type VcnData } from './decode-vcn.ts';
import { decodeVmp, type VmpData } from './decode-vmp.ts';
import { decodeMaze, type MazeData } from './decode-maze.ts';
import { decodeInf, parseInf, buildWallTypeMap, resolveWallDecorationAssignments } from './decode-inf.ts';
import { decodePal } from './palette.ts';
import { decodeCps } from './decode-cps.ts';
import { decodeDecorations, type DecorationData } from '../eotb/decode-decorations.ts';

const LEVEL_COUNT = 16;
const SKIP_NAV_WALL_SETS = new Set(['azure']); // no .VCN/.VMP navigable tileset -- see module doc.

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/eotb2/export-dungeon.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/eotb2/dosvga');
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

  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const infRaw = readBinary(resolve(dataDir, `LEVEL${n}.INF`));
    const { mazStem, wallSetStem, secondWallSetStem } = decodeInf(infRaw);
    const navWallSet = wallSetStem.toLowerCase();

    if (SKIP_NAV_WALL_SETS.has(navWallSet)) {
      console.log(`  LEVEL${n}: wall set ${wallSetStem} -- skipped (${navWallSet} has no navigable .VCN/.VMP, see module doc)`);
      levels.push({ level: n, wallSet: wallSetStem, skipped: navWallSet });
      continue;
    }

    // Real active palette: the second wall-set stem, when present, REPLACES
    // (not supplements) the first -- see module doc's palette-override paragraph.
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

    // Wall-mapping override table + decoration assignments (2026-08-29).
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
