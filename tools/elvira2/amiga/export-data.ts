/**
 * Elvira II: The Jaws of Cerberus (Amiga) extractor.
 *
 * Usage: npx tsx tools/elvira2/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/elvira2/amiga/data`.)
 *
 * Two independent asset sources:
 *  1. `NN1.pkd`/`NN2.pkd` zone pairs — the SAME AGOS "old bundle" codec as
 *     Elvira 1 (`tools/shared/agos-vga.ts`; confirmed byte-for-byte
 *     identical, not just a "later revision" as the initial probe recon
 *     guessed from varying compressed-content header bytes — see
 *     docs/elvira2/amiga/data-structure.md's "Container format" section).
 *  2. `Pics/*` — 4 plain, uncompressed-container IFF `ILBM` dungeon-level
 *     maps ("SpiderCavesLevelA-D"), decoded via the new
 *     `tools/shared/ilbm.ts` (byte-exact legible renders — room labels,
 *     legend, and the "SKID ROW" cracker-group credit are all crisp text).
 *
 * Writes the same textures/screens/palettes/data layout as Elvira 1, plus:
 *   public/assets/elvira2/amiga/screens/pics-<Name>.png — the 4 level maps.
 *
 * See docs/elvira2/amiga/data-structure.md / docs/elvira2/TODO.md.
 */
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { exportAgosPictures } from '../../shared/agos-vga-export.ts';
import { decodeIlbm, ilbmToRGBA } from '../../shared/ilbm.ts';
import { assetDir, manifestEntry, writeManifest, type ManifestEntry } from '../../shared/asset-paths.ts';

const GAME = 'elvira2';
const PLATFORM = 'amiga';

export async function exportElvira2Data(dataDir: string, picsDir: string) {
  const summary = await exportAgosPictures(GAME, PLATFORM, dataDir, 'elvira');
  console.log(
    `elvira2/amiga (pkd): ${summary.zonesDecoded}/${summary.zonesFound} zones decoded ` +
      `(${summary.zonesMissingFile} missing type1/type2 file, ${summary.zonesNoPictures} decoded with no pictures), ` +
      `${summary.imagesDecoded} images, ${summary.screensWritten} screen samples` +
      (summary.errors.length ? `, ${summary.errors.length} error(s): ${JSON.stringify(summary.errors)}` : ''),
  );

  let picsDecoded = 0;
  if (existsSync(picsDir)) {
    const screenDir = assetDir('screens', GAME, PLATFORM);
    const entries: ManifestEntry[] = [];
    for (const f of readdirSync(picsDir)) {
      if (f.endsWith('.info')) continue;
      const path = resolve(picsDir, f);
      let data: Uint8Array;
      try {
        data = readBinary(path);
      } catch {
        continue;
      }
      const bmp = decodeIlbm(data);
      if (!bmp) continue;
      const rgba = ilbmToRGBA(bmp);
      const name = `pics-${f}`;
      await writePNG(resolve(screenDir, `${name}.png`), rgba, bmp.width, bmp.height);
      entries.push(manifestEntry(`screens/${name}`, 1, true));
      picsDecoded++;
    }
    if (entries.length) writeManifest(entries, GAME, PLATFORM);
  }
  console.log(`elvira2/amiga (Pics/ ILBM): ${picsDecoded} level map(s) decoded`);

  return { ...summary, picsDecoded };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/elvira2/amiga/data');
  const picsDir = resolve(process.argv[3] ?? 'data/elvira2/amiga/Pics');
  exportElvira2Data(dataDir, picsDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
