/**
 * Champions of Krynn (Amiga) extractor.
 *
 * Usage: npx tsx tools/championsofkrynn/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/ssi/ChampionsOfKrynn/data`.)
 *
 * Champions of Krynn uses the "DOS DaxFile" container/codec
 * (`tools/shared/goldbox-dosdax.ts`) — NOT Pool of Radiance's own bespoke
 * Amiga `.dax` codec, despite sharing the `.dax`/`.DAX` extension and base
 * filenames. See that module's doc for the full derivation. Everything
 * downstream (GEO, ECL, WALLDEF geometry) is byte-for-byte the SAME format
 * this project already cracked for Pool of Radiance / the GLIB titles —
 * confirmed per-format below, not assumed.
 *
 * The game ships TWO campaigns/banks (`GEO1.DAX`+`ECL1.DAX`+`WALLDEF1.DAX`
 * and `GEO2.DAX`+`ECL2.DAX`+`WALLDEF2.DAX`). Level ids are namespaced
 * `bank*1000 + geoId` so both banks' levels coexist in one
 * `dungeon/levels-index.json` (see `tools/walker/games-goldbox.ts`).
 *
 * Writes:
 *   public/assets/championsofkrynn/amiga/data/container-directory.json
 *     — every `.DAX` file's directory, decompressed + verified.
 *   public/assets/championsofkrynn/amiga/textures/walldef-<id>-wall<n>-view6.png
 *     — composited wall-view renders using `8X8D<bank>.DAA`'s own
 *       Champions-specific tile-bank payload (`decodeChampionsWallTileSurface`
 *       + `buildChampionsFlatTileBank` in `tools/shared/goldbox-daa-tiles.ts`
 *       — cracked 2026-09-02, a genuinely different pixel shape AND
 *       addressing model from Death Knights' sibling `.DAA` format despite
 *       the shared BE DaxFile container). Real per-bank art for both banks
 *       — this supersedes an earlier revision of this extractor that used
 *       bank 1's `8X8D1.DAX` tile bank for BOTH banks (a coincidental id
 *       overlap gave bank 2 only 10/65 renders). 115/115 view slices
 *       across both banks (50/50 bank 1, 65/65 bank 2 — 0 skipped) render
 *       with the flat whole-file tile bank; rendered in greyscale (a
 *       synthetic 16-step grey ramp) — no real colour palette for these
 *       tiles has been located yet.
 *   public/assets/championsofkrynn/amiga/dungeon/level-<bank*1000+id>.json
 *     — GEO cell grids + ECL-resolved wallset bindings, one file per level.
 *
 * See docs/championsofkrynn/amiga/data-structure.md for the full writeup
 * and docs/championsofkrynn/TODO.md for what remains open.
 */
import { resolve } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { readDosDaxDirectory, decompressDosDaxEntry, type DosDaxEntry } from '../../shared/goldbox-dosdax.ts';
import { decodeWallSlices } from '../../shared/goldbox-walltiles.ts';
import { buildChampionsFlatTileBank, renderColorView } from '../../shared/goldbox-daa-tiles.ts';
import { assetDir, syncDataManifest, manifestEntry, writeManifest } from '../../shared/asset-paths.ts';
import { decodePorGeoEntry, type GeoLevel } from '../../shared/goldbox-geo.ts';
import { exportGeoDungeon } from '../../shared/goldbox-dungeon-export.ts';
import { findWallsetBindings, POR_ECL_PREFIX_LENGTH } from '../../shared/goldbox-ecl.ts';

const GAME = 'championsofkrynn';
const PLATFORM = 'amiga';
const BANKS = [1, 2] as const;
/** Level ids are namespaced per bank so both banks coexist in one dungeon index. */
const LEVEL_ID_MULTIPLIER = 1000;

function decodeAllEntries(data: Uint8Array): { dataOffset: number; entries: DosDaxEntry[]; byId: Map<number, Uint8Array> } {
  const { dataOffset, entries } = readDosDaxDirectory(data);
  const byId = new Map<number, Uint8Array>();
  for (const entry of entries) {
    byId.set(entry.id, decompressDosDaxEntry(data, dataOffset, entry));
  }
  return { dataOffset, entries, byId };
}

export async function exportChampionsOfKrynnData(dataDir: string) {
  const dataOutDir = assetDir('data', GAME, PLATFORM);
  const textureOutDir = assetDir('textures', GAME, PLATFORM);

  const daxFiles = readdirSync(dataDir).filter((f) => f.toUpperCase().endsWith('.DAX'));

  // 1. Container directory dump, every .DAX file, verified (chain +
  // declared-rawSize match, see goldbox-dosdax.ts's module doc).
  const containerDump: Record<string, unknown> = {};
  let totalEntries = 0;
  let totalOk = 0;
  for (const fname of daxFiles) {
    const path = resolve(dataDir, fname);
    const data = readBinary(path);
    const { dataOffset, entries } = readDosDaxDirectory(data);
    const entryResults = entries.map((entry) => {
      totalEntries++;
      try {
        const out = decompressDosDaxEntry(data, dataOffset, entry);
        const ok = out.length === entry.rawSize;
        if (ok) totalOk++;
        return { ...entry, verified: ok };
      } catch (e) {
        return { ...entry, verified: false, error: (e as Error).message };
      }
    });
    containerDump[fname] = { fileSize: data.length, dataOffset, entries: entryResults };
  }
  writeJson(resolve(dataOutDir, 'container-directory.json'), {
    totalEntries,
    totalVerified: totalOk,
    files: containerDump,
  });
  console.log(`container-directory.json: ${totalOk}/${totalEntries} entries verified (chain + exact decompressed length)`);

  // 2. Wall-view PNG renders, per bank. Tile pixel source: `8X8D<bank>.DAA`
  // (the BE DaxFile sibling container Champions shares with Death Knights
  // — see `goldbox-daa-tiles.ts`'s module doc for the full derivation of
  // this title's own, genuinely different payload shape AND its addressing
  // model). `buildChampionsFlatTileBank` builds ONE flat, whole-file RGBA
  // tile bank per DAA file (`[placeholder, ...universal(id 203), ...every
  // other entry's tiles in directory order]`) — WALLDEF's raw view-index
  // bytes address directly into this flat bank, NOT a per-wall composite-id
  // bank (an earlier attempt at the latter only covered 60/115 view slices
  // across both banks; the flat model covers 115/115 with 0 out-of-range
  // indices — see the module doc's "Addressing model" section). `8X8D2.DAA`
  // (bank 2) has no id 202/203 of its own, so its flat bank has no
  // "universal" prefix of its own — a documented asymmetry, not a bug.
  const daaTilesByBank = new Map<number, Uint8Array[]>([
    [1, buildChampionsFlatTileBank(readBinary(resolve(dataDir, '8X8D1.DAA')))],
    [2, buildChampionsFlatTileBank(readBinary(resolve(dataDir, '8X8D2.DAA')))],
  ]);

  const allRenderedFiles: string[] = [];
  const perBankLevels: GeoLevel[][] = [];

  for (const bank of BANKS) {
    const walldefPath = resolve(dataDir, `WALLDEF${bank}.DAX`);
    const walldefData = readBinary(walldefPath);
    const { entries: wEntries, byId: wById } = decodeAllEntries(walldefData);
    const tileBank = daaTilesByBank.get(bank)!;

    let rendered = 0;
    let skippedOutOfRange = 0;
    for (const entry of wEntries) {
      const decoded = wById.get(entry.id)!;
      if (decoded.length % 156 !== 0) continue;
      const slices = decodeWallSlices(decoded);
      for (const slice of slices) {
        const view = slice.views[slice.views.length - 4]; // view index 6, "front face"
        if (view.rows * view.cols <= 1) continue;
        const maxIdx = Math.max(...view.tileIndices.flat());
        if (maxIdx >= tileBank.length) {
          skippedOutOfRange++;
          continue;
        }
        const { width, height, pixels: rgba } = renderColorView(view, tileBank);
        // Namespaced by bank*1000 (same convention as level ids below) so
        // Champions' two independent WALLDEF id spaces (bank 1 and bank 2
        // can both use e.g. wall id 23 for unrelated art) don't collide in
        // the single shared `wall-index.json` `scanWallTextures` builds —
        // ECL-resolved wallset-slot bindings are remapped the same way
        // below before being attached to each level.
        const name = `walldef-${bank * LEVEL_ID_MULTIPLIER + entry.id}-wall${slice.wallNumber}-view${view.view}`;
        await writePNG(resolve(textureOutDir, `${name}.png`), rgba, width, height);
        allRenderedFiles.push(`textures/${name}`);
        rendered++;
      }
    }
    console.log(`bank ${bank}: walldef textures: ${rendered} PNGs written (${skippedOutOfRange} skipped, index out of range)`);

    // 3. GEO + ECL wallset bindings, per bank.
    const geoPath = resolve(dataDir, `GEO${bank}.DAX`);
    const geoData = readBinary(geoPath);
    const { entries: geoEntries, byId: geoById } = decodeAllEntries(geoData);
    const levels = geoEntries.map((entry) => {
      const level = decodePorGeoEntry(geoById.get(entry.id)!, bank * LEVEL_ID_MULTIPLIER + entry.id);
      return level;
    });

    const eclPath = resolve(dataDir, `ECL${bank}.DAX`);
    const eclData = readBinary(eclPath);
    const { byId: eclById } = decodeAllEntries(eclData);
    const resolveBlock = (id: number): Uint8Array | undefined => {
      const raw = eclById.get(id);
      return raw ? raw.subarray(POR_ECL_PREFIX_LENGTH) : undefined;
    };
    let levelsWithAnyBinding = 0;
    for (const level of levels) {
      const geoIdInBank = level.id - bank * LEVEL_ID_MULTIPLIER;
      const raw = resolveBlock(geoIdInBank);
      if (!raw) continue;
      // Confirmed base 0x8000 (NOT PoR's own 0x9900), standard v1.1 opcode
      // table, wallset load via opcode 0x37 "LOAD PIECES" (default) — see
      // docs/championsofkrynn/amiga/data-structure.md §ECL for the base
      // sweep + manual disassembly evidence.
      const { binding } = findWallsetBindings(raw, { base: 0x8000, resolveBlock });
      const n = (binding.slot1 !== undefined ? 1 : 0) + (binding.slot2 !== undefined ? 1 : 0) + (binding.slot3 !== undefined ? 1 : 0);
      if (n > 0) {
        // Remap into the same bank*1000-namespaced wall-id space the
        // texture filenames above use, so `resolveWallFlatId` (shared,
        // unmodified) finds the right bank's own PNG.
        level.wallsetBinding = {
          slot1: binding.slot1 !== undefined ? bank * LEVEL_ID_MULTIPLIER + binding.slot1 : undefined,
          slot2: binding.slot2 !== undefined ? bank * LEVEL_ID_MULTIPLIER + binding.slot2 : undefined,
          slot3: binding.slot3 !== undefined ? bank * LEVEL_ID_MULTIPLIER + binding.slot3 : undefined,
        };
        levelsWithAnyBinding++;
      }
    }
    console.log(`bank ${bank}: ECL wallset bindings: ${levelsWithAnyBinding}/${levels.length} level(s) got at least one statically-resolved slot`);
    perBankLevels.push(levels);
  }

  if (allRenderedFiles.length) {
    writeManifest(
      allRenderedFiles.map((n) => manifestEntry(n, 1)),
      GAME,
      PLATFORM,
    );
  }

  exportGeoDungeon(GAME, PLATFORM, perBankLevels.flat());
  syncDataManifest(GAME, PLATFORM);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/ssi/ChampionsOfKrynn/data');
  mkdirSync(dataDir, { recursive: true });
  exportChampionsOfKrynnData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
