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
 *     — composited wall-view renders using the confirmed headerless 8x8
 *       tile bank in `8X8D1.DAX` (see module doc below for why the
 *       *separate*, similarly-named `8X8D0/1/2.DAA` files are NOT used —
 *       they remain an undecoded, structurally distinct resource).
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
import {
  decodeWallSlices,
  renderView,
  decode8x8Tiles,
  resolveCompositeWallId,
  buildWallSpecificTileBank,
  SLICES_PER_WALLSET,
} from '../../shared/goldbox-walltiles.ts';
import { assetDir, syncDataManifest, manifestEntry, writeManifest } from '../../shared/asset-paths.ts';
import { decodePorGeoEntry, type GeoLevel } from '../../shared/goldbox-geo.ts';
import { exportGeoDungeon } from '../../shared/goldbox-dungeon-export.ts';
import { findWallsetBindings, POR_ECL_PREFIX_LENGTH } from '../../shared/goldbox-ecl.ts';

const GAME = 'championsofkrynn';
const PLATFORM = 'amiga';
const BANKS = [1, 2] as const;
/** Level ids are namespaced per bank so both banks coexist in one dungeon index. */
const LEVEL_ID_MULTIPLIER = 1000;

function grey8ToRGBA(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

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

  // 2. Wall-view PNG renders, per bank. Tile pixel source: 8X8D1.DAX (the
  // ONE dos-dax-container 8x8-tile file — confirmed via visual inspection
  // to render recognizable brick/stone wall texture, headerless 8-byte/tile
  // GLIB-style encoding). id 203 = "universal" tiles (present corpus-wide
  // in this engine family); other ids follow Pool of Radiance's own
  // `10*wallId + wallsetNumber` composite-id arithmetic, falling back to
  // the wall id directly when no composite entry exists (id 23's own case).
  const tilesPath = resolve(dataDir, '8X8D1.DAX');
  const tilesData = readBinary(tilesPath);
  const { byId: tileBankById } = decodeAllEntries(tilesData);
  const universalTiles = tileBankById.has(203) ? decode8x8Tiles(tileBankById.get(203)!) : [];

  const allRenderedFiles: string[] = [];
  const perBankLevels: GeoLevel[][] = [];

  for (const bank of BANKS) {
    const walldefPath = resolve(dataDir, `WALLDEF${bank}.DAX`);
    const walldefData = readBinary(walldefPath);
    const { entries: wEntries, byId: wById } = decodeAllEntries(walldefData);

    let rendered = 0;
    let skippedNoEntry = 0;
    for (const entry of wEntries) {
      const decoded = wById.get(entry.id)!;
      if (decoded.length % 156 !== 0) continue;
      const slices = decodeWallSlices(decoded);
      const wallsetCount = Math.ceil(slices.length / SLICES_PER_WALLSET);
      for (const slice of slices) {
        const view = slice.views[slice.views.length - 4]; // view index 6, "front face"
        if (view.rows * view.cols <= 1) continue;
        const wallsetIndex = Math.floor(slice.wallNumber / SLICES_PER_WALLSET);
        const compositeId = resolveCompositeWallId(entry.id, wallsetIndex, wallsetCount);
        const specificRaw = tileBankById.get(compositeId) ?? tileBankById.get(entry.id);
        if (!specificRaw) {
          skippedNoEntry++;
          continue;
        }
        const specificTiles = decode8x8Tiles(specificRaw);
        const tileBank = buildWallSpecificTileBank(universalTiles, specificTiles);
        const maxIdx = Math.max(...view.tileIndices.flat());
        if (maxIdx >= tileBank.length) continue;
        const { width, height, pixels } = renderView(view, tileBank);
        const rgba = grey8ToRGBA(pixels, width, height);
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
    console.log(`bank ${bank}: walldef textures: ${rendered} PNGs written (${skippedNoEntry} skipped, no tile-bank entry)`);

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
