/**
 * Shared extractor logic for the three Gold Box "GLIB" sibling titles (Curse
 * of the Azure Bonds, Secret of the Silver Blades, Pools of Darkness — see
 * `goldbox-glib.ts` and `goldbox-walltiles.ts` for the format writeup). Each
 * title's own `tools/<game>/amiga/export-data.ts` calls this with its own
 * data directory and wall/tile file pairing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, manifestEntry, syncDataManifest, writeJson, writeManifest } from './asset-paths.ts';
import { decodeGlibIndex, findBlockById, isTruncated, parseGlibContainer, readBlock } from './goldbox-glib.ts';
import {
  buildFlatTileBank,
  buildWallSpecificTileBank,
  decodeGlibTileBucket,
  decodeWallSlices,
  renderView,
  resolveCompositeWallId,
  VIEW_OFFSET,
} from './goldbox-walltiles.ts';
import { decodeGeoRecord, GEO_RECORD_SIZE } from './goldbox-geo.ts';
import { exportGeoDungeon } from './goldbox-dungeon-export.ts';

/**
 * Number of raw wall slices (`decodeWallSlices` records) that share one
 * scheme-2 wallset tile bank. A WALLDEF entry decoding to N slices has
 * `N / SLICES_PER_WALLSET` wallsets, each covering a contiguous run of 5
 * slices — confirmed against every entry's own byte length (780, 1560, 2340
 * are all multiples of 780 = 5*156) and against Curse's own scheme-2 index
 * table (ids 1-13,16 = 1 wallset -> direct id; ids 14,17 = 2 wallsets ->
 * composite ids 141/142, 171/172, one composite id per 5-slice chunk, not
 * per individual slice).
 */
const SLICES_PER_WALLSET = 5;

function walk(dir: string, out: string[]) {
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

export interface WallRenderSource {
  /** Path to this title's own WALLDEF.GLB (relative to dataDir). */
  walldefPath: string;
  /** Path to an 8x8-tile GLIB file using the "flat universal+specific" scheme (see goldbox-walltiles.ts). Optional — omit when no working flat source exists for this title (e.g. Pools of Darkness). */
  tilesPath?: string;
  /**
   * Path to the per-wall-id nested-scheme ("scheme 2") 8x8-tile GLIB file —
   * the pairing WALLDEF is actually keyed to at runtime (its ids match
   * WALLDEF's own ids exactly via `resolveCompositeWallId`), now decodable
   * thanks to `goldbox-glib-codecs.ts`. When present, a second set of
   * renders (`walldef2-*`) is written using this source, alongside (not
   * replacing) any `tilesPath` renders.
   */
  specificTilesPath?: string;
  /**
   * Path to a file whose GLIB index has a "203" universal tile bucket to
   * prefix onto `specificTilesPath`'s own per-wall bucket. Defaults to
   * `specificTilesPath` itself (some titles' scheme-2 file has no 203 of
   * its own, in which case the universal prefix is simply empty).
   */
  universalTilesPath?: string;
  /**
   * Path to this title's own `GEO.GLB` — the 16x16 dungeon/city square grid
   * (walls/doors CONFIRMED, see `goldbox-geo.ts`'s module doc). A top-level
   * "DATA"-tagged GLIB container whose blocks are the raw 1024-byte GEO
   * records directly (top-level containers are always stored, never
   * compressed — §0/§5). Optional — omit if not yet located for a title.
   */
  geoPath?: string;
}

export async function exportGoldBoxGlibData(
  game: string,
  platform: string,
  dataDir: string,
  wallRender?: WallRenderSource,
) {
  const dataOutDir = assetDir('data', game, platform);
  const textureOutDir = assetDir('textures', game, platform);

  // 1. Corpus-wide GLIB container validation (every .GLB/.TLB file across all disk directories).
  const allFiles: string[] = [];
  walk(dataDir, allFiles);
  const glibFiles = allFiles.filter((f) => /\.(glb|tlb)$/i.test(f));

  const results: Record<string, unknown> = {};
  let glibOk = 0;
  let truncated = 0;
  for (const path of glibFiles) {
    const rel = path.slice(dataDir.length + 1);
    const data = readFileSync(path);
    let container;
    try {
      container = parseGlibContainer(data);
    } catch (e) {
      results[rel] = { error: (e as Error).message };
      continue;
    }
    const trunc = isTruncated(container, data.length);
    const headerEnd = 16 + 4 * (container.blockCount + 1);
    const structOk = container.blocks[0]?.start === headerEnd;
    if (!trunc && structOk) glibOk++;
    if (trunc) truncated++;
    results[rel] = {
      totalSize: container.totalSize,
      fileSize: data.length,
      blockCount: container.blockCount,
      flags: container.flags,
      tag: container.tag,
      hasIndex: container.hasIndex,
      truncated: trunc,
      structOk,
    };
  }
  writeJson(resolve(dataOutDir, 'container-directory.json'), {
    totalGlibFiles: glibFiles.length,
    structurallyOk: glibOk,
    truncatedOrCorrupted: truncated,
    files: results,
  });
  console.log(
    `container-directory.json: ${glibOk}/${glibFiles.length} GLIB files structurally OK, ${truncated} truncated/corrupted`,
  );

  // 2. WALLDEF wall-slice geometry — 156-byte-multiple + 10-view-sum verification, corpus-wide.
  const walldefFiles = glibFiles.filter((f) => /walldef\.glb$/i.test(f));
  const walldefResults: Record<string, unknown> = {};
  for (const path of walldefFiles) {
    const rel = path.slice(dataDir.length + 1);
    const data = readFileSync(path);
    const container = parseGlibContainer(data);
    const index = decodeGlibIndex(data, container);
    const entries = index.map(({ id, blockIndex }) => {
      const block = container.blocks[blockIndex];
      const raw = data.subarray(block.start, block.end);
      const isMultipleOf156 = raw.length % 156 === 0;
      const slices = isMultipleOf156 ? decodeWallSlices(raw) : [];
      return { id, byteLength: raw.length, isMultipleOf156, sliceCount: slices.length };
    });
    const allMultiples = entries.every((e) => e.isMultipleOf156);
    walldefResults[rel] = { entryCount: entries.length, allMultipleOf156: allMultiples, entries };
  }
  writeJson(resolve(dataOutDir, 'walldef-geometry.json'), walldefResults);
  console.log(`walldef-geometry.json: ${Object.keys(walldefResults).length} WALLDEF.GLB file(s) verified`);

  // 3. Wall-view PNG render.
  const allRenderedFiles: string[] = [];
  const viewToRender = VIEW_OFFSET.length - 4; // view index 6, the 8x7 "front face"

  if (wallRender) {
    const wdata = readFileSync(resolve(dataDir, wallRender.walldefPath));
    const wcon = parseGlibContainer(wdata);
    const windex = decodeGlibIndex(wdata, wcon);

    // 3a. "Flat" universal+specific scheme — a working sanity check of the
    // pixel format + view-geometry compositor, not necessarily the file
    // this WALLDEF is paired with at runtime (see WallRenderSource doc).
    if (wallRender.tilesPath) {
      const tdata = readFileSync(resolve(dataDir, wallRender.tilesPath));
      const tcon = parseGlibContainer(tdata);
      const bank = buildFlatTileBank(tdata, tcon);
      let skippedOutOfRange = 0;
      let rendered = 0;
      for (const { id, blockIndex } of windex) {
        const block = wcon.blocks[blockIndex];
        const raw = wdata.subarray(block.start, block.end);
        if (raw.length % 156 !== 0) continue;
        const slices = decodeWallSlices(raw);
        for (const slice of slices) {
          const view = slice.views[viewToRender];
          if (view.rows * view.cols <= 1) continue;
          const maxIdx = Math.max(...view.tileIndices.flat());
          if (maxIdx >= bank.length) {
            skippedOutOfRange++;
            continue;
          }
          const name = `walldef-${id}-wall${slice.wallNumber}-view${view.view}`;
          await writeViewPNG(textureOutDir, name, view, bank);
          allRenderedFiles.push(`textures/${name}`);
          rendered++;
        }
      }
      console.log(
        `walldef textures (scheme 1, flat bank): ${rendered} PNGs written to ${textureOutDir} (${skippedOutOfRange} skipped, tile index out of this bank's range)`,
      );
    }

    // 3b. Per-wall-id nested ("scheme 2") — the pairing WALLDEF is actually
    // keyed to at runtime, decodable now that goldbox-glib-codecs.ts covers
    // the compressed nested payload. Index-unit question still open
    // (docs/goldbox-glib-format.md §5.6) — labelled RENDERED, not CONFIRMED.
    if (wallRender.specificTilesPath) {
      const sPath = resolve(dataDir, wallRender.specificTilesPath);
      const sdata = readFileSync(sPath);
      const scon = parseGlibContainer(sdata);
      const sindex = decodeGlibIndex(sdata, scon);

      const uPath = resolve(dataDir, wallRender.universalTilesPath ?? wallRender.specificTilesPath);
      const udata = readFileSync(uPath);
      const ucon = parseGlibContainer(udata);
      const uindex = decodeGlibIndex(udata, ucon);
      const universalBlock = findBlockById(ucon, uindex, 203);
      const universalTiles = universalBlock ? decodeGlibTileBucket(udata, universalBlock) : [];

      let rendered = 0;
      let skippedNoEntry = 0;
      let skippedOutOfRange = 0;
      for (const { id, blockIndex } of windex) {
        const block = wcon.blocks[blockIndex];
        const raw = wdata.subarray(block.start, block.end);
        if (raw.length % 156 !== 0) continue;
        const slices = decodeWallSlices(raw);
        // Try the WALLDEF id DIRECTLY first — this covers both Curse/
        // Secret's own single-wallset ids (5 slices) AND Pools of
        // Darkness's later-title simplification (a direct 1:1 index with
        // NO composite ids at all, even though its own entries run 15
        // slices — 3x the 5-slice quantum below). Composite ids are a
        // Curse/Secret-specific fallback for their own multi-wallset ids
        // (14/17 etc), tried only when no direct entry exists.
        const directBlock = findBlockById(scon, sindex, id);
        // A composite wallset's tile bank is shared across a fixed run of 5
        // raw wall slices (`SLICES_PER_WALLSET`, confirmed against every
        // Curse/Secret WALLDEF entry's own byte length: 780/1560/2340 are
        // all multiples of 780 = 5*156) — NOT one composite id per slice.
        // Curse's own scheme-2 index confirms this exactly: ids 14/17
        // (1560 B, two wallsets of 5 slices) resolve to composite ids
        // 141/142 and 171/172 respectively, one composite id per 5-slice
        // chunk, not per individual slice.
        const wallsetCount = Math.ceil(slices.length / SLICES_PER_WALLSET);
        for (const slice of slices) {
          const view = slice.views[viewToRender];
          if (view.rows * view.cols <= 1) continue;
          let specificBlock = directBlock;
          if (!specificBlock) {
            const wallsetIndex = Math.floor(slice.wallNumber / SLICES_PER_WALLSET);
            const compositeId = resolveCompositeWallId(id, wallsetIndex, wallsetCount);
            specificBlock = findBlockById(scon, sindex, compositeId);
          }
          if (!specificBlock) {
            skippedNoEntry++;
            continue;
          }
          const specificTiles = decodeGlibTileBucket(sdata, specificBlock);
          const bank = buildWallSpecificTileBank(universalTiles, specificTiles);
          const maxIdx = Math.max(...view.tileIndices.flat());
          if (maxIdx >= bank.length) {
            skippedOutOfRange++;
            continue;
          }
          const name = `walldef2-${id}-wall${slice.wallNumber}-view${view.view}`;
          await writeViewPNG(textureOutDir, name, view, bank);
          allRenderedFiles.push(`textures/${name}`);
          rendered++;
        }
      }
      console.log(
        `walldef textures (scheme 2, per-wall-id bank): ${rendered} PNGs written to ${textureOutDir} (${skippedNoEntry} skipped, no scheme-2 entry; ${skippedOutOfRange} skipped, tile index out of this bank's range)`,
      );
    }
  }

  if (allRenderedFiles.length) {
    writeManifest(
      allRenderedFiles.map((n) => manifestEntry(n, 1)),
      game,
      platform,
    );
  }

  // 4. GEO — the 16x16 dungeon/city square grid (walls/doors CONFIRMED, see
  // goldbox-geo.ts's module doc). One level per index entry; the wall-index
  // scan (exportGeoDungeon) picks up whatever PNGs step 3 just wrote, so
  // this must run after it.
  if (wallRender?.geoPath) {
    const gdata = readFileSync(resolve(dataDir, wallRender.geoPath));
    const gcon = parseGlibContainer(gdata);
    const gindex = decodeGlibIndex(gdata, gcon);
    const levels = gindex
      .map(({ id, blockIndex }) => {
        const block = gcon.blocks[blockIndex];
        const raw = readBlock(gdata, block);
        if (raw.length !== GEO_RECORD_SIZE) return undefined;
        return decodeGeoRecord(raw, id);
      })
      .filter((l) => l !== undefined);
    console.log(`GEO: ${levels.length}/${gindex.length} level(s) matched the expected ${GEO_RECORD_SIZE}-byte record size`);
    exportGeoDungeon(game, platform, levels);
  }

  syncDataManifest(game, platform);
}

async function writeViewPNG(
  textureOutDir: string,
  name: string,
  view: ReturnType<typeof decodeWallSlices>[number]['views'][number],
  bank: Uint8Array[],
) {
  const { width, height, pixels } = renderView(view, bank);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i];
    rgba[i * 4 + 1] = pixels[i];
    rgba[i * 4 + 2] = pixels[i];
    rgba[i * 4 + 3] = 255;
  }
  await writePNG(resolve(textureOutDir, `${name}.png`), rgba, width, height);
}
