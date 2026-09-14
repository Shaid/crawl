/**
 * Batch sprite-atlas extraction for an Ishar-engine data directory, built on
 * `silmarils-unpack.ts` (container/codec) + `ishar-sprites.ts` (per-script
 * resource directory + pixel decode). One atlas per source `.DO`/`.CO` file
 * that has a decodable directory with >= 1 resolvable bitmap -- a natural
 * semantic grouping (each file is already one location/monster/UI asset
 * bank), matching this project's "pack into a few semantic atlases, not one
 * file per sprite" convention.
 *
 * Colour (2026-09-01 addition, `ishar-palette.ts`): a file's own directory is
 * scanned for a dedicated `0xFE`-marked palette resource first (e.g. every
 * monster/portrait script -- `DRAGON.DO`, `GEANT.DO`, ...); if none is found,
 * the shared world palette resolved from a sibling `FOND.DO`/`FOND.CO` in the
 * same `dataDir` is used as a fallback (own palette entries still win where
 * both cover the same slot -- see `mergeIsharPalettes()`). Only when NEITHER
 * resolves does this fall back to the original `isharBitmapToNormalizedGrey
 * scaleRGBA()` render, so a file this can't colour-resolve renders EXACTLY
 * as before (no regression). `manifest.json`'s `hasPalette` field now
 * reflects which path was actually used, per atlas.
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, writeJson, writeManifest, type ManifestEntry } from './asset-paths.js';
import { unpackSilmarilsScript } from './silmarils-unpack.js';
import { decodeIsharDirectory, isharBitmapToNormalizedGreyscaleRGBA, type IsharBitmap } from './ishar-sprites.js';
import { resolveIsharOwnPalette, mergeIsharPalettes, isharBitmapToPaletteRGBA, type IsharPalette } from './ishar-palette.js';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

/** Resolve `FOND.DO`/`FOND.CO`'s own dedicated palette resource, if a sibling file exists in `dataDir` -- Ishar 1-3's shared outdoor/world palette (see `ishar-palette.ts` module doc). Returns `null` if no `FOND.*` file exists or it has no resolvable palette (e.g. Crystals of Arborea, which has no `FOND` file at all). */
function resolveWorldPalette(dataDir: string, files: string[]): IsharPalette | null {
  const fondName = files.find((f) => /^FOND\.(DO|CO)$/i.test(f));
  if (!fondName) return null;
  try {
    const buf = readFileSync(join(dataDir, fondName));
    const unpacked = unpackSilmarilsScript(buf);
    if (!unpacked) return null;
    return resolveIsharOwnPalette(unpacked.data);
  } catch {
    return null;
  }
}

export interface SpriteAtlasReportEntry {
  name: string;
  resourceCount: number;
  decodedCount: number;
  ok: boolean;
}

export async function extractSpriteAtlases(
  dataDir: string,
  game: string,
  platform: string,
): Promise<{ report: SpriteAtlasReportEntry[]; manifest: ManifestEntry[] }> {
  const outDir = assetDir('sprites', game, platform);
  const report: SpriteAtlasReportEntry[] = [];
  const manifestEntries: ManifestEntry[] = [];
  const allFiles = readdirSync(dataDir);
  const worldPalette = resolveWorldPalette(dataDir, allFiles);

  for (const name of allFiles.sort()) {
    const ext = extname(name).toUpperCase();
    if (ext !== '.DO' && ext !== '.CO') continue;
    const path = join(dataDir, name);
    if (!statSync(path).isFile()) continue;

    const buf = readFileSync(path);
    let unpacked;
    try {
      unpacked = unpackSilmarilsScript(buf);
    } catch {
      continue;
    }
    if (!unpacked) continue;

    const bitmaps = decodeIsharDirectory(unpacked.data);
    const baseName = name.replace(/\.(DO|CO)$/i, '').toLowerCase();
    if (bitmaps.length === 0) {
      report.push({ name, resourceCount: 0, decodedCount: 0, ok: false });
      continue;
    }

    const packInputs: ShelfPackInput[] = bitmaps.map((b) => ({
      name: `${baseName}_${b.index.toString().padStart(3, '0')}`,
      width: b.width,
      height: b.height,
    }));
    const packed = shelfPack(packInputs, 1024);
    const atlas = new Uint8Array(packed.width * packed.height * 4);

    const ownPalette = resolveIsharOwnPalette(unpacked.data);
    const palette = mergeIsharPalettes(ownPalette, worldPalette);

    bitmaps.forEach((b: IsharBitmap, i: number) => {
      const frame = packed.frames[i];
      const rgba = palette ? isharBitmapToPaletteRGBA(b, palette) : isharBitmapToNormalizedGreyscaleRGBA(b);
      for (let y = 0; y < b.height; y++) {
        const srcOff = y * b.width * 4;
        const dstOff = ((frame.y + y) * packed.width + frame.x) * 4;
        atlas.set(rgba.subarray(srcOff, srcOff + b.width * 4), dstOff);
      }
    });

    const pngPath = resolve(outDir, `${baseName}.png`);
    await writePNG(pngPath, atlas, packed.width, packed.height);

    const frames = packed.frames.map((f) => ({ name: f.name, x: f.x, y: f.y, w: f.w, h: f.h }));
    writeJson(resolve(outDir, `${baseName}.json`), { frames, width: packed.width, height: packed.height });

    manifestEntries.push({
      name: `sprites/${baseName}`,
      sprites: bitmaps.length,
      hasPalette: palette !== null,
      png: `sprites/${baseName}.png`,
      kind: 'atlas',
    });

    report.push({ name, resourceCount: bitmaps.length, decodedCount: bitmaps.length, ok: true });
  }

  mkdirSync(outDir, { recursive: true });
  writeJson(resolve('public/assets', game, platform, 'data', 'sprite-atlas-report.json'), report);
  const manifest = manifestEntries.length ? writeManifest(manifestEntries, game, platform) : [];
  return { report, manifest };
}
