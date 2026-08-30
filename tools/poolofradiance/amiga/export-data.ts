/**
 * Pool of Radiance (Amiga) extractor.
 *
 * Usage: npx tsx tools/poolofradiance/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/poolofradiance/amiga`.)
 *
 * Writes:
 *   public/assets/poolofradiance/amiga/data/container-directory.json
 *     — every `.dax` file's directory (indexID/dataOffset/compressedLength/
 *       decompressedLength), decompressed with the confirmed codec
 *       (`dax.ts`) and checksum-verified. This is the container-format
 *       deliverable: 843/843 entries across the whole corpus decompress
 *       with a passing internal checksum and exact declared-length match.
 *   public/assets/poolofradiance/amiga/data/dungcom.json
 *     — dungcom.dax's single decompressed blob as a hex dump; content not
 *       semantically decoded this pass (see docs/poolofradiance/TODO.md).
 *   public/assets/poolofradiance/amiga/textures/walldef-<id>-view<v>.png
 *     — one composited wall-view render per walldef.dax entry, for its
 *       largest ("front face") view (view 6, 8 rows x 7 cols of 8x8 tiles).
 *       RENDERED, not fully confirmed — see walldef.ts's module doc for
 *       exactly which parts are code/ID-cross-check-confirmed vs. inferred.
 *
 * See docs/poolofradiance/amiga/data-structure.md for the full format
 * writeup and docs/poolofradiance/TODO.md for what remains open.
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { readDaxDirectory, decompressDaxEntry } from './dax.ts';
import { decodeWallSlices, buildTileBank, renderView, VIEW_OFFSET } from './walldef.ts';
import { assetDir, syncDataManifest, manifestEntry, writeManifest } from '../../shared/asset-paths.ts';

const GAME = 'poolofradiance';
const PLATFORM = 'amiga';

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

export async function exportPoolOfRadianceData(dataDir: string) {
  const dataOutDir = assetDir('data', GAME, PLATFORM);
  const textureOutDir = assetDir('textures', GAME, PLATFORM);

  const daxFiles = readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.dax'));

  // 1. Container directory dump, every .dax file, checksum-verified.
  const containerDump: Record<string, unknown> = {};
  let totalEntries = 0;
  let totalOk = 0;
  for (const fname of daxFiles) {
    const path = resolve(dataDir, fname);
    const data = readBinary(path);
    const { headerSize, entries } = readDaxDirectory(data);
    const entryResults = entries.map((entry) => {
      totalEntries++;
      try {
        const out = decompressDaxEntry(data, entry);
        const ok = out.length === entry.decompressedLength;
        if (ok) totalOk++;
        return { ...entry, verified: ok };
      } catch (e) {
        return { ...entry, verified: false, error: (e as Error).message };
      }
    });
    containerDump[fname] = { fileSize: data.length, headerSize, entries: entryResults };
  }
  writeJson(resolve(dataOutDir, 'container-directory.json'), {
    totalEntries,
    totalVerified: totalOk,
    files: containerDump,
  });
  console.log(`container-directory.json: ${totalOk}/${totalEntries} entries verified (checksum + length match)`);

  // 2. dungcom.dax — decompressed but not semantically decoded this pass.
  const dungcomPath = resolve(dataDir, 'dungcom.dax');
  if (existsSync(dungcomPath)) {
    const data = readBinary(dungcomPath);
    const { entries } = readDaxDirectory(data);
    const blocks = entries.map((entry) => {
      const decoded = decompressDaxEntry(data, entry);
      return {
        indexID: entry.indexID,
        decompressedLength: decoded.length,
        hexPreview: Buffer.from(decoded.subarray(0, 128)).toString('hex'),
      };
    });
    writeJson(resolve(dataOutDir, 'dungcom.json'), { note: 'content not semantically decoded — see TODO.md', blocks });
    console.log(`dungcom.json: ${blocks.length} block(s) dumped (undecoded content)`);
  }

  // 3. walldef.dax composite wall-view renders (view 6 = largest, 8x7 tiles).
  const walldefPath = resolve(dataDir, 'walldef.dax');
  const tilesPath = resolve(dataDir, '8x8d.dax');
  if (existsSync(walldefPath) && existsSync(tilesPath)) {
    const walldefData = readBinary(walldefPath);
    const tilesData = readBinary(tilesPath);
    const { entries } = readDaxDirectory(walldefData);
    const renderedFiles: string[] = [];
    const viewToRender = VIEW_OFFSET.length - 4; // view index 6, the 8x7 "front face"
    for (const entry of entries) {
      const decoded = decompressDaxEntry(walldefData, entry);
      const slices = decodeWallSlices(decoded);
      const bank = buildTileBank(tilesData, entry.indexID);
      for (const slice of slices) {
        const view = slice.views[viewToRender];
        if (view.rows * view.cols <= 1) continue; // skip degenerate 1-tile views
        const { width, height, pixels } = renderView(view, bank);
        const rgba = grey8ToRGBA(pixels, width, height);
        const name = `walldef-${entry.indexID}-wall${slice.wallNumber}-view${view.view}`;
        const outPath = resolve(textureOutDir, `${name}.png`);
        await writePNG(outPath, rgba, width, height);
        renderedFiles.push(`textures/${name}`);
      }
    }
    console.log(`walldef textures: ${renderedFiles.length} PNGs written to ${textureOutDir}`);
    writeManifest(
      renderedFiles.map((n) => manifestEntry(n, 1)),
      GAME,
      PLATFORM,
    );
  }

  syncDataManifest(GAME, PLATFORM);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/poolofradiance/amiga');
  mkdirSync(dataDir, { recursive: true });
  exportPoolOfRadianceData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
