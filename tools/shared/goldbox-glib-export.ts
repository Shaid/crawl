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
import { decodeGlibIndex, findBlockById, readBlock } from './goldbox-glib.ts';
import { loadGlibFile } from './goldbox-glib-codecs.ts';
import {
  buildFlatTileBank,
  buildWallSpecificTileBank,
  decodeGlibTileBucket,
  decodeWallSlices,
  renderView,
  resolveCompositeWallId,
  SLICES_PER_WALLSET,
  VIEW_OFFSET,
} from './goldbox-walltiles.ts';
import { decodeGeoLevel } from './goldbox-geo.ts';
import { exportGeoDungeon } from './goldbox-dungeon-export.ts';
import { findWallsetBindings, type EclDecodeOptions } from './goldbox-ecl.ts';

function walk(dir: string, out: string[]) {
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

export interface WallRenderSource {
  /**
   * Path to this title's own WALLDEF.GLB (relative to dataDir). Optional —
   * omit for a title with no wall-art format at all: Dark Queen of Krynn's
   * WHDLoad rip has no `WALLDEF`/`WALLS`-named file anywhere across its 3
   * disks (an exhaustive `find` confirmed this), consistent with its own
   * `PICA`/`PICB`/`PICC`/`BIGPIC`/`FRAME` file families and its variable-
   * size (not fixed 16x16) `GEO.GLB` shape — see
   * `docs/darkqueenofkrynn/amiga/data-structure.md` for the full evidence
   * this title's dungeon exploration is rendered as static location
   * pictures (a `PICTURE` ECL opcode already exists, `0x0e`), not composited
   * first-person wall textures. GEO/ECL still decode and the walker still
   * shows real connectivity/minimap movement; only wall-art rendering is
   * skipped (the walker's existing "no rendered wall texture" placeholder
   * covers this gracefully with zero code changes).
   */
  walldefPath?: string;
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
  /**
   * Path to this title's own `ECL.GLB` — the level-scripting bytecode that
   * resolves each level's 3 wallset slots (`goldbox-ecl.ts`). Optional —
   * omit if not yet located. Same GLIB container/index convention as
   * `geoPath`, same `id` space (one ECL block per level, matched to GEO's
   * own level `id`).
   */
  eclPath?: string;
  /**
   * Engine-revision decode options for this title's ECL bytecode
   * (`tools/shared/goldbox-ecl.ts`'s `EclDecodeOptions` — address base,
   * opcode table, wallset-load opcode/shape). Omit for the v1.1 default
   * (Curse of the Azure Bonds, Secret of the Silver Blades). Pools of
   * Darkness needs `{ opcodeTable: OPCODE_TABLE_POOLS_V13, wallsetLoad: {
   * opcode: 0x21, mode: 'fill-all-from-second-operand' } }` — see
   * goldbox-ecl.ts's module doc.
   */
  eclOptions?: EclDecodeOptions;
  /**
   * Number of leading bytes to strip from each ECL block's raw bytes before
   * decoding — Treasures of the Savage Frontier's own `ECL.glb` blocks
   * carry a constant 2-byte `0x8813` tag (IDENTICAL to Pool of Radiance's
   * `.dax`-based `POR_ECL_PREFIX_LENGTH`, confirmed constant across all 41
   * blocks) before the real VM buffer, even though this is a GLIB container
   * not a `.dax` — see `goldbox-ecl.ts`'s module doc. Default 0 (Curse,
   * Secret, Pools, Gateway all need no strip).
   */
  eclBlockPrefixLength?: number;
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
  let compressedTopLevel = 0;
  let truncated = 0;
  for (const path of glibFiles) {
    const rel = path.slice(dataDir.length + 1);
    const raw = readFileSync(path);
    let loaded;
    try {
      loaded = loadGlibFile(raw);
    } catch (e) {
      results[rel] = { error: (e as Error).message };
      continue;
    }
    const { data, container } = loaded;
    const compressed = data !== raw; // loadGlibFile only decompresses when the top-level method isn't 0.
    // A genuinely truncated/corrupted floppy dump still shows a totalSize
    // mismatch AFTER attempting decompression (either decompressGlibBlock
    // itself throws, or the decompressed body's own offset table is
    // internally inconsistent) — see `loadGlibFile`'s module doc for why
    // this superseded the old "totalSize !== fileSize" heuristic, which
    // mislabelled 6 of Dark Queen of Krynn's real top-level-compressed
    // files (and, retroactively, 7 files in the Curse/Secret/Pools corpus)
    // as corrupted.
    const trunc = container.totalSize !== data.length;
    const headerEnd = 16 + 4 * (container.blockCount + 1);
    const structOk = container.blocks[0]?.start === headerEnd;
    if (!trunc && structOk) glibOk++;
    if (compressed && !trunc && structOk) compressedTopLevel++;
    if (trunc) truncated++;
    results[rel] = {
      totalSize: container.totalSize,
      fileSize: raw.length,
      decompressedSize: compressed ? data.length : undefined,
      compressedTopLevel: compressed,
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
    compressedTopLevel,
    truncatedOrCorrupted: truncated,
    files: results,
  });
  console.log(
    `container-directory.json: ${glibOk}/${glibFiles.length} GLIB files structurally OK (${compressedTopLevel} top-level-compressed), ${truncated} truncated/corrupted`,
  );

  // 2. WALLDEF wall-slice geometry — 156-byte-multiple + 10-view-sum verification, corpus-wide.
  const walldefFiles = glibFiles.filter((f) => /walldef\.glb$/i.test(f));
  const walldefResults: Record<string, unknown> = {};
  for (const path of walldefFiles) {
    const rel = path.slice(dataDir.length + 1);
    const { data, container } = loadGlibFile(readFileSync(path));
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

  if (wallRender?.walldefPath) {
    const { data: wdata, container: wcon } = loadGlibFile(readFileSync(resolve(dataDir, wallRender.walldefPath)));
    const windex = decodeGlibIndex(wdata, wcon);

    // 3a. "Flat" universal+specific scheme — a working sanity check of the
    // pixel format + view-geometry compositor, not necessarily the file
    // this WALLDEF is paired with at runtime (see WallRenderSource doc).
    if (wallRender.tilesPath) {
      const { data: tdata, container: tcon } = loadGlibFile(readFileSync(resolve(dataDir, wallRender.tilesPath)));
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
      const { data: sdata, container: scon } = loadGlibFile(readFileSync(sPath));
      const sindex = decodeGlibIndex(sdata, scon);

      const uPath = resolve(dataDir, wallRender.universalTilesPath ?? wallRender.specificTilesPath);
      const { data: udata, container: ucon } = loadGlibFile(readFileSync(uPath));
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

  // 4. GEO — the dungeon/city square grid (walls/doors CONFIRMED, see
  // goldbox-geo.ts's module doc). One level per index entry; the wall-index
  // scan (exportGeoDungeon) picks up whatever PNGs step 3 just wrote, so
  // this must run after it. `decodeGeoLevel` auto-detects the fixed 16x16
  // shape (Curse/Secret/Pools/Gateway/Treasure/PoR) or Dark Queen of
  // Krynn's own variable-size shape — see goldbox-geo.ts's module doc.
  if (wallRender?.geoPath) {
    const { data: gdata, container: gcon } = loadGlibFile(readFileSync(resolve(dataDir, wallRender.geoPath)));
    const gindex = decodeGlibIndex(gdata, gcon);
    const levels = gindex
      .map(({ id, blockIndex }) => {
        const block = gcon.blocks[blockIndex];
        const raw = readBlock(gdata, block);
        return decodeGeoLevel(raw, id);
      })
      .filter((l) => l !== undefined);
    console.log(`GEO: ${levels.length}/${gindex.length} level(s) decoded (fixed 16x16 or Dark Queen's own variable-size shape)`);

    // 4b. Wallset-slot bindings (goldbox-ecl.ts) — attach each level's own
    // ECL-resolved {slot1,slot2,slot3} flat WALLDEF ids, when the title has
    // an ECL.GLB and this level's own script statically resolves them (see
    // goldbox-ecl.ts's module doc). `resolveBlock` lets findWallsetBindings
    // chase a level's own NEWECL (opcode 0x20) targets into a DIFFERENT ECL
    // block when this level's own reachable code has no wallset-load call
    // of its own (see `ReachabilityResult.newEclTargets`'s doc — a level
    // literally handing its script off to another block's own entry
    // points, not a guess).
    if (wallRender.eclPath) {
      const { data: edata, container: econ } = loadGlibFile(readFileSync(resolve(dataDir, wallRender.eclPath)));
      const eindex = decodeGlibIndex(edata, econ);
      const eclById = new Map(eindex.map(({ id, blockIndex }) => [id, econ.blocks[blockIndex]] as const));
      const prefixLen = wallRender.eclBlockPrefixLength ?? 0;
      const resolveBlock = (id: number): Uint8Array | undefined => {
        const block = eclById.get(id);
        return block ? readBlock(edata, block).subarray(prefixLen) : undefined;
      };
      const eclOptions = { ...wallRender.eclOptions, resolveBlock };
      let resolvedSlots = 0;
      let levelsWithAnyBinding = 0;
      for (const level of levels) {
        const raw = resolveBlock(level.id);
        if (!raw) continue;
        const { binding } = findWallsetBindings(raw, eclOptions);
        const n = (binding.slot1 !== undefined ? 1 : 0) + (binding.slot2 !== undefined ? 1 : 0) + (binding.slot3 !== undefined ? 1 : 0);
        if (n > 0) {
          level.wallsetBinding = binding;
          levelsWithAnyBinding++;
          resolvedSlots += n;
        }
      }
      console.log(
        `ECL wallset bindings: ${levelsWithAnyBinding}/${levels.length} level(s) got at least one statically-resolved slot (${resolvedSlots} slot(s) total)`,
      );
    }

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
