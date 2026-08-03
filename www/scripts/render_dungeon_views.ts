// Renders real, walker-verified dungeon corridor views for the docs site's
// Dungeon Textures page, replacing the illustrative hand-composited mockups
// the old generate_tileset_views.mjs produced.
//
// This imports @seer/dungeon directly and runs the *same* pipeline
// tools/walker/ uses in the browser: buildViewList -> compositeDrawList
// against the real exported dungeon/{levels,slots,semantics}.json. Every
// pixel here is exactly what the walker harness would render for the same
// (map, x, y, facing) pose -- not a hand-tuned illustration.
//
// No canvas/DOM shim needed. `compositeDrawList` writes straight into an
// `IndexedSurface` (a plain `Uint8Array`), and `indicesToRGBA` -- a pure
// function, not part of `CanvasPresenter` -- expands that straight to RGBA
// bytes; `sharp` takes it from there. `CanvasPresenter` itself wraps
// `ctx.putImageData`, which needs a real `CanvasRenderingContext2D`/
// `ImageData` with no headless-Node equivalent in this repo (unlike
// middilgard's tools/wime/render-scene-gallery.ts, which built a small
// canvas shim because its compositor calls actual 2D context primitives
// like drawImage/translate/scale) -- but we never touch `CanvasPresenter`
// at all, since the RGBA expansion it calls is already a standalone export.
//
// Usage: node scripts/render_dungeon_views.ts <textureDir>
// (same calling convention the retired generate_tileset_views.mjs used,
// invoked the same way from build.mjs)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import {
  FlatGridLevel,
  buildViewList,
  viewSpecFromSlotTable,
  compositeDrawList,
  IndexedSurface,
  indicesToRGBA,
  PieceBank,
  parseRampPalette,
  paletteRampForUnit,
  rampPalettePath,
  indexedTilesetPaths,
  type PieceBankLookup,
  type RGBAColor,
} from '@seer/dungeon';
import {
  validateDungeonLevelFile,
  validateSlotTableFile,
  validateSemanticsFile,
  type DungeonLevelFile,
  type SlotTableFile,
  type LevelUnit,
  type Dir4,
} from '@seer/dungeon/schema';
import type { AtlasMeta } from '@seer/core';

const textureDir = process.argv[2];
if (!textureDir) throw new Error('Missing texture directory');
// textureDir is .../amiga/textures -- every other asset path
// (dungeon/*.json, palettes/, sprites/) hangs off its parent, "amiga/".
const assetRoot = dirname(textureDir);

function loadJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(assetRoot, relPath), 'utf8')) as T;
}

/** Decode a PNG on disk to interleaved RGBA bytes (mirrors the browser harness's `decodePNGToRGBA`, via `sharp` instead of a `<canvas>`). */
async function decodePNGToRGBA(relPath: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(join(assetRoot, relPath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

async function loadPlainBank(atlasPath: string, imagePath: string): Promise<PieceBank> {
  const atlas = loadJSON<AtlasMeta>(atlasPath);
  const decoded = await decodePNGToRGBA(imagePath);
  return PieceBank.fromRGBA(decoded.data, decoded.width, decoded.height, atlas);
}

// Each tileset's *primary* accent ramp -- the one export_dungeon_tileset_
// indexed.py bakes into the indexed PNG's own embedded palette, needed to
// recover the raw EHB index from a decoded RGBA readback
// (PieceBank.fromIndexedRGBA's basePalette). Same real mapping
// tools/walker/walker.ts uses (bclib.palette.tileset_ramps): bcdfx -> 0,
// bcdfy -> 1, bcdfz -> 2.
const TILESET_PRIMARY_RAMP: Record<string, number> = { bcdfx: 0, bcdfy: 1, bcdfz: 2 };

/** Ramp-aware tileset bank load -- same logic as tools/walker/walker.ts's `loadTilesetBank`, ported to sharp/fs instead of fetch/<canvas>. */
async function loadTilesetBank(tileset: string, targetRamp: number): Promise<{ bank: PieceBank; palette: RGBAColor[] }> {
  const primaryRamp = TILESET_PRIMARY_RAMP[tileset];
  if (primaryRamp === undefined) throw new Error(`render_dungeon_views: no primary ramp known for tileset "${tileset}"`);
  const paths = indexedTilesetPaths(tileset);
  const [atlas, indexImg, maskImg, basePaletteFile, targetPaletteFile] = await Promise.all([
    loadJSON<AtlasMeta>(paths.atlasJson),
    decodePNGToRGBA(paths.indexPng),
    decodePNGToRGBA(paths.maskPng),
    loadJSON<{ colors: Array<{ r: number; g: number; b: number }> }>(rampPalettePath(tileset, primaryRamp)),
    targetRamp === primaryRamp ? null : loadJSON<{ colors: Array<{ r: number; g: number; b: number }> }>(rampPalettePath(tileset, targetRamp)),
  ]);
  const basePalette = parseRampPalette(basePaletteFile);
  const bank = PieceBank.fromIndexedRGBA(indexImg.data, maskImg.data, indexImg.width, indexImg.height, atlas, basePalette);
  const palette = targetPaletteFile ? parseRampPalette(targetPaletteFile) : basePalette;
  return { bank, palette };
}

interface PoseSpec {
  /** Filename/manifest variant id -- also what DungeonViewCycle.astro cycles through. */
  variant: string;
  map: number;
  x: number;
  y: number;
  facing: Dir4;
  /** One-line human description of what this pose shows, surfaced in the manifest and the docs page's reproducibility table. */
  note: string;
}

const FACING_LABEL = ['N', 'E', 'S', 'W'] as const;

/**
 * Curated real `(map, x, y, facing)` poses, one set per tileset. Found by
 * sweeping every cell x facing in the real `levels.json` through
 * `buildViewList` and filtering for (a) that unit's own `tileset` field
 * (levels 1-4 & 12-13 -> bcdfx, level 5 -> bcdfy, levels 6-11 -> bcdfz --
 * confirmed straight from `levels.json`, not assumed), (b) a legible open
 * corridor (side walls visible, front wall -- if any -- far enough away
 * that it doesn't just fill the frame), and (c), where the map data has
 * one, a real M4/M5 prop instance (alcove/plaque/stairs/door-switch/
 * door-lock) so the gallery actually shows off what this session wired up.
 * `bcdfy`'s one map (5) has no plaque entity, so its set has no plaque view
 * -- a real fact about the map, not a gap in the walker.
 */
const POSES: Record<'bcdfx' | 'bcdfy' | 'bcdfz', PoseSpec[]> = {
  bcdfx: [
    { variant: 'corridor', map: 1, x: 57, y: 1, facing: 1, note: 'open corridor, side walls receding to a far wall' },
    { variant: 'alcove', map: 2, x: 35, y: 2, facing: 3, note: 'search alcove set into the left wall' },
    { variant: 'plaque', map: 3, x: 34, y: 1, facing: 3, note: 'wall plaque' },
    { variant: 'stairs', map: 2, x: 28, y: 24, facing: 2, note: 'stairway' },
    { variant: 'door', map: 2, x: 28, y: 21, facing: 0, note: 'a locked door’s wall decoration' },
  ],
  bcdfy: [
    { variant: 'corridor', map: 5, x: 45, y: 1, facing: 1, note: 'open corridor, side walls receding to a far wall' },
    // bcdfy's own atlas (46 sub-images vs. 83 for bcdfx/bcdfz) has no
    // alcove/plaque frames at all -- confirmed against
    // textures/dungeon-bcdfy-indexed.json, not a walker gap -- so this set
    // shows a floor item instead, a feature bcdfy's map genuinely has.
    { variant: 'floor-item', map: 5, x: 38, y: 4, facing: 3, note: 'a floor item' },
    { variant: 'stairs', map: 5, x: 1, y: 13, facing: 1, note: 'stairway, centred and close' },
    { variant: 'door', map: 5, x: 3, y: 1, facing: 1, note: 'a pull-chain door switch' },
  ],
  bcdfz: [
    { variant: 'corridor', map: 6, x: 43, y: 4, facing: 1, note: 'open corridor, side walls receding to a far wall' },
    { variant: 'alcove', map: 6, x: 39, y: 5, facing: 0, note: 'search alcove' },
    { variant: 'plaque', map: 11, x: 8, y: 1, facing: 3, note: 'wall plaque' },
    { variant: 'stairs', map: 6, x: 9, y: 15, facing: 2, note: 'stairway' },
    { variant: 'door', map: 6, x: 9, y: 13, facing: 0, note: 'a locked door’s ornate iron decoration, dead ahead' },
  ],
};

async function main() {
  const levelFile: DungeonLevelFile = validateDungeonLevelFile(loadJSON('dungeon/levels.json'));
  const slots: SlotTableFile = validateSlotTableFile(loadJSON('dungeon/slots.json'));
  const semantics = validateSemanticsFile(loadJSON('dungeon/semantics.json'));
  const spec = viewSpecFromSlotTable(slots);

  const unitsById = new Map<number, LevelUnit>(levelFile.units.map((u) => [u.id, u]));
  const levelCache = new Map<number, FlatGridLevel>();
  function levelFor(unitId: number): { unit: LevelUnit; level: FlatGridLevel } {
    const unit = unitsById.get(unitId);
    if (!unit) throw new Error(`render_dungeon_views: no unit ${unitId} in levels.json`);
    let level = levelCache.get(unitId);
    if (!level) {
      level = new FlatGridLevel(levelFile, unit);
      levelCache.set(unitId, level);
    }
    return { unit, level };
  }

  // slots.banks[0] is the main tileset bank, always labeled "dungeon-bcdfx"
  // in slots.json regardless of the real tileset in play (tools/walker.ts's
  // TILESET_PRIMARY_RAMP comment explains why: it's a lookup key, not a
  // literal claim about which art backs it) -- the actual PieceBank
  // registered under that key is swapped per (tileset, ramp) below. Extra
  // banks (wall-decorations, floor-items) are plain, ramp-independent atlases.
  const mainBankId = slots.banks[0]!.id;
  const extraBanks: PieceBankLookup = {};
  for (const ref of slots.banks.slice(1)) {
    extraBanks[ref.id] = await loadPlainBank(ref.atlas, ref.image);
  }

  const tilesetRampBanks = new Map<string, { bank: PieceBank; palette: RGBAColor[] }>();
  async function bankFor(tileset: string, ramp: number) {
    const key = `${tileset}:${ramp}`;
    let entry = tilesetRampBanks.get(key);
    if (!entry) {
      entry = await loadTilesetBank(tileset, ramp);
      tilesetRampBanks.set(key, entry);
    }
    return entry;
  }

  let totalWritten = 0;
  for (const [tileset, poses] of Object.entries(POSES) as Array<[string, PoseSpec[]]>) {
    const manifestViews: Array<PoseSpec & { mapLabel: string; facingLabel: string }> = [];

    for (const pose of poses) {
      const { unit, level } = levelFor(pose.map);
      if (unit.tileset !== tileset) {
        throw new Error(`render_dungeon_views: pose for "${tileset}" points at map ${pose.map} (${unit.name}), whose own tileset is "${unit.tileset}"`);
      }
      const ramp = paletteRampForUnit(unit);
      const { bank, palette } = await bankFor(tileset, ramp);
      const banks: PieceBankLookup = { [mainBankId]: bank, ...extraBanks };

      const walkerPose = { level: pose.map, x: pose.x, y: pose.y, facing: pose.facing };
      const items = buildViewList(level, walkerPose, spec, semantics, slots);

      const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
      compositeDrawList(surface, banks, slots, items, 0);
      const rgba = indicesToRGBA(surface.data, palette);

      const outPath = join(textureDir, `dungeon-${tileset}-view-${pose.variant}.png`);
      await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
        raw: { width: surface.width, height: surface.height, channels: 4 },
      })
        .extract({ left: slots.viewport.x, top: slots.viewport.y, width: slots.viewport.width, height: slots.viewport.height })
        .png()
        .toFile(outPath);
      totalWritten++;

      manifestViews.push({ ...pose, mapLabel: unit.name ?? String(unit.id), facingLabel: FACING_LABEL[pose.facing] });
    }

    writeFileSync(
      join(textureDir, `dungeon-${tileset}-views.json`),
      JSON.stringify({ tileset, views: manifestViews }, null, 2),
    );
    console.log(`[dungeon-views] ${tileset}: wrote ${poses.length} real walker-rendered view(s)`);
  }

  console.log(`[dungeon-views] wrote ${totalWritten} PNG(s) total`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
