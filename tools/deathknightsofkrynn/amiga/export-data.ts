/**
 * Death Knights of Krynn (Amiga) extractor.
 *
 * Usage: npx tsx tools/deathknightsofkrynn/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/ssi/DeathKnightsOfKrynn/data`.)
 *
 * Same "DOS DaxFile" container/codec as Champions of Krynn
 * (`tools/shared/goldbox-dosdax.ts`). Death Knights ships THREE
 * campaigns/banks (`GEO1/ECL1`, `GEO2/ECL2`, `GEO3/ECL3`) but only ONE
 * `walldef1.dax` — confirmed structural reason: every entry decompresses to
 * an exact multiple of 15 wall slices (2340 = 156*15 = 3 bundled 5-slice
 * wallsets), i.e. this single file already carries all 3 banks' own wall
 * variants per wall id, addressed by `wallsetIndex` (0/1/2) the same way
 * Curse/Secret's own multi-wallset ids work — NOT a missing-file gap.
 *
 * **Wall-art PIXEL data**: `8x8d1.daa` — a BIG-ENDIAN sibling of the DOS
 * DaxFile container (`readAmigaDaaDirectory`/`decodeAmigaDaaFile` in
 * `tools/shared/goldbox-dosdax.ts`) — was cracked via a `re-oracle`
 * escalation and independently re-verified this session (see
 * docs/deathknightsofkrynn/amiga/data-structure.md §4). Each WALLDEF wall
 * id (1-7) has 4 "quarter" `.DAA` entries (`W`, `W+20`, `W+40`, `W+60`, 64
 * tiles each) selected by the raw view-cell byte's high 2 bits
 * (`goldbox-daa-tiles.ts`'s "quarters" scheme) — colour comes from the
 * universal entry (id 202)'s embedded palette, since every wall-specific
 * entry's own embedded palette is all-zero.
 *
 * Level ids are namespaced `bank*1000 + geoId` (bank in {1,2,3}) so all
 * three banks coexist in one `dungeon/levels-index.json`.
 *
 * Writes:
 *   public/assets/deathknightsofkrynn/amiga/data/container-directory.json
 *   public/assets/deathknightsofkrynn/amiga/data/walldef-geometry.json
 *   public/assets/deathknightsofkrynn/amiga/textures/walldef-<id>-wall<n>-view6.png
 *   public/assets/deathknightsofkrynn/amiga/dungeon/level-<bank*1000+id>.json
 *
 * See docs/deathknightsofkrynn/amiga/data-structure.md for the full writeup
 * and docs/deathknightsofkrynn/TODO.md for what remains open.
 */
import { resolve } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { readDosDaxDirectory, decompressDosDaxEntry, readAmigaDaaDirectory, type DosDaxEntry } from '../../shared/goldbox-dosdax.ts';
import { decodeWallSlices } from '../../shared/goldbox-walltiles.ts';
import { decodeDaaPalette, buildDkkWallColorBank, renderColorView } from '../../shared/goldbox-daa-tiles.ts';
import { assetDir, syncDataManifest, manifestEntry, writeManifest } from '../../shared/asset-paths.ts';
import { decodePorGeoEntry, type GeoLevel } from '../../shared/goldbox-geo.ts';
import { exportGeoDungeon } from '../../shared/goldbox-dungeon-export.ts';
import { findWallsetBindings, POR_ECL_PREFIX_LENGTH } from '../../shared/goldbox-ecl.ts';

const GAME = 'deathknightsofkrynn';
const PLATFORM = 'amiga';
const BANKS = [1, 2, 3] as const;
const LEVEL_ID_MULTIPLIER = 1000;
/** The universal palette-source entry in `8x8d1.daa` — see module doc. */
const DAA_UNIVERSAL_PALETTE_ID = 202;

function decodeAllEntries(data: Uint8Array): { dataOffset: number; entries: DosDaxEntry[]; byId: Map<number, Uint8Array> } {
  const { dataOffset, entries } = readDosDaxDirectory(data);
  const byId = new Map<number, Uint8Array>();
  for (const entry of entries) {
    byId.set(entry.id, decompressDosDaxEntry(data, dataOffset, entry));
  }
  return { dataOffset, entries, byId };
}

export async function exportDeathKnightsOfKrynnData(dataDir: string) {
  const dataOutDir = assetDir('data', GAME, PLATFORM);
  const textureOutDir = assetDir('textures', GAME, PLATFORM);

  const daxFiles = readdirSync(dataDir).filter((f) => f.toUpperCase().endsWith('.DAX'));

  // 1. Container directory dump, every .DAX file, verified.
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

  // 2. walldef1.dax geometry verification.
  const walldefPath = resolve(dataDir, 'walldef1.dax');
  const walldefData = readBinary(walldefPath);
  const { entries: wEntries, byId: wById } = decodeAllEntries(walldefData);
  const geometryReport = wEntries.map((entry) => {
    const decoded = wById.get(entry.id)!;
    const isMultipleOf156 = decoded.length % 156 === 0;
    const slices = isMultipleOf156 ? decodeWallSlices(decoded) : [];
    return { id: entry.id, decodedLength: decoded.length, isMultipleOf156, sliceCount: slices.length, wallsetGroups: Math.ceil(slices.length / 5) };
  });
  writeJson(resolve(dataOutDir, 'walldef-geometry.json'), { entries: geometryReport });
  const allMultiple = geometryReport.every((r) => r.isMultipleOf156);
  console.log(
    `walldef1.dax geometry: ${geometryReport.length} entries, all multiples of 156 bytes = ${allMultiple} (each entry bundles ${geometryReport[0]?.wallsetGroups ?? '?'} wallset group(s) of 5 slices — matches the 3-bank-sharing hypothesis)`,
  );

  // 2b. Wall-art PNG renders from 8x8d1.daa (see module doc + goldbox-daa-tiles.ts).
  const daaPath = resolve(dataDir, '8x8d1.daa');
  const daaData = readBinary(daaPath);
  const { dataOffset: daaDataOffset, entries: daaEntries } = readAmigaDaaDirectory(daaData);
  const daaById = new Map<number, Uint8Array>();
  for (const entry of daaEntries) daaById.set(entry.id, decompressDosDaxEntry(daaData, daaDataOffset, entry));
  const universalRaw = daaById.get(DAA_UNIVERSAL_PALETTE_ID);
  if (!universalRaw) throw new Error(`8x8d1.daa: missing universal palette-source entry id ${DAA_UNIVERSAL_PALETTE_ID}`);
  const universalPalette = decodeDaaPalette(universalRaw);

  const allRenderedFiles: string[] = [];
  let rendered = 0;
  let skippedNoQuarters = 0;
  for (const entry of wEntries) {
    const decoded = wById.get(entry.id)!;
    if (decoded.length % 156 !== 0) continue;
    let tileBank: Uint8Array[];
    try {
      tileBank = buildDkkWallColorBank(daaById, entry.id, universalPalette);
    } catch {
      skippedNoQuarters++;
      continue;
    }
    const slices = decodeWallSlices(decoded);
    for (const slice of slices) {
      const view = slice.views[slice.views.length - 4]; // view index 6, "front face"
      if (view.rows * view.cols <= 1) continue;
      const { width, height, pixels } = renderColorView(view, tileBank);
      const name = `walldef-${entry.id}-wall${slice.wallNumber}-view${view.view}`;
      await writePNG(resolve(textureOutDir, `${name}.png`), pixels, width, height);
      allRenderedFiles.push(`textures/${name}`);
      rendered++;
    }
  }
  console.log(`8x8d1.daa wall textures: ${rendered} PNGs written (${skippedNoQuarters} wall id(s) missing a full quarter set)`);
  if (allRenderedFiles.length) {
    writeManifest(
      allRenderedFiles.map((n) => manifestEntry(n, 1)),
      GAME,
      PLATFORM,
    );
  }

  // 3. GEO + ECL wallset bindings, per bank. Confirmed default engine
  // config: base 0x8000, standard v1.1 opcode table, wallset load via
  // opcode 0x37 "LOAD PIECES" — the SAME config as Champions of Krynn (and
  // Curse/Secret/Pool of Radiance's own engine revision), NOT Pools of
  // Darkness's v1.3 revision. See docs/deathknightsofkrynn/amiga/
  // data-structure.md §ECL for the manual-disassembly evidence that
  // overturned an earlier (wrong) v1.3-table hypothesis.
  const perBankLevels: GeoLevel[][] = [];
  for (const bank of BANKS) {
    const geoPath = resolve(dataDir, `GEO${bank}.DAX`);
    const geoData = readBinary(geoPath);
    const { entries: geoEntries, byId: geoById } = decodeAllEntries(geoData);
    const levels = geoEntries.map((entry) => decodePorGeoEntry(geoById.get(entry.id)!, bank * LEVEL_ID_MULTIPLIER + entry.id));

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
      const { binding } = findWallsetBindings(raw, { base: 0x8000, resolveBlock });
      const n = (binding.slot1 !== undefined ? 1 : 0) + (binding.slot2 !== undefined ? 1 : 0) + (binding.slot3 !== undefined ? 1 : 0);
      if (n > 0) {
        level.wallsetBinding = binding;
        levelsWithAnyBinding++;
      }
    }
    console.log(`bank ${bank}: ECL wallset bindings: ${levelsWithAnyBinding}/${levels.length} level(s) got at least one statically-resolved slot`);
    perBankLevels.push(levels);
  }

  exportGeoDungeon(GAME, PLATFORM, perBankLevels.flat());
  syncDataManifest(GAME, PLATFORM);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/ssi/DeathKnightsOfKrynn/data');
  mkdirSync(dataDir, { recursive: true });
  exportDeathKnightsOfKrynnData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
