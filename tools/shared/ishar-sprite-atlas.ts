/**
 * Batch sprite-atlas extraction for an Ishar-engine data directory, built on
 * `silmarils-unpack.ts` (container/codec) + `ishar-sprites.ts` (per-script
 * resource directory + pixel decode). One atlas per source `.DO`/`.CO` file
 * that has a decodable directory with >= 1 resolvable bitmap -- a natural
 * semantic grouping (each file is already one location/monster/UI asset
 * bank), matching this project's "pack into a few semantic atlases, not one
 * file per sprite" convention.
 *
 * Every render here is GREYSCALE (Method §3) -- no real AGA colour palette
 * has been recovered for this engine yet, see `docs/ishar-sprite-format.md`
 * "Open". Output: `public/assets/<game>/<platform>/sprites/<NAME>.{png,json}`,
 * `manifest.json` upserted (this project's merged, upsert-by-name convention).
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { assetDir, writeJson, writeManifest, type ManifestEntry } from './asset-paths.js';
import { unpackSilmarilsScript } from './silmarils-unpack.js';
import { decodeIsharDirectory, isharBitmapToGreyscaleRGBA, type IsharBitmap } from './ishar-sprites.js';
import { shelfPack, type PackInput } from './atlas-pack.js';

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

  for (const name of readdirSync(dataDir).sort()) {
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

    const packInputs: PackInput[] = bitmaps.map((b) => ({
      name: `${baseName}_${b.index.toString().padStart(3, '0')}`,
      width: b.width,
      height: b.height,
    }));
    const packed = shelfPack(packInputs, 1024);
    const atlas = new Uint8Array(packed.width * packed.height * 4);

    bitmaps.forEach((b: IsharBitmap, i: number) => {
      const frame = packed.frames[i];
      const rgba = isharBitmapToGreyscaleRGBA(b);
      for (let y = 0; y < b.height; y++) {
        const srcOff = y * b.width * 4;
        const dstOff = ((frame.y + y) * packed.width + frame.x) * 4;
        atlas.set(rgba.subarray(srcOff, srcOff + b.width * 4), dstOff);
      }
    });

    const pngPath = resolve(outDir, `${baseName}.png`);
    await writePNG(pngPath, atlas, packed.width, packed.height);

    const frames = packed.frames.map((f) => ({ name: f.name, x: f.x, y: f.y, w: f.width, h: f.height }));
    writeJson(resolve(outDir, `${baseName}.json`), { frames, width: packed.width, height: packed.height });

    manifestEntries.push({
      name: `sprites/${baseName}`,
      sprites: bitmaps.length,
      hasPalette: false,
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
