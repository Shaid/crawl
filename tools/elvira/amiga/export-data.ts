/**
 * Elvira: Mistress of the Dark (Amiga) extractor.
 *
 * Usage: npx tsx tools/elvira/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/elvira/amiga/data`.)
 *
 * Decompresses every `NN1.pkd`/`NN2.pkd` zone pair (the shared AGOS "old
 * bundle" `simon_decr` LZ77 codec, `tools/shared/agos-vga.ts`) and decodes
 * every picture in each zone's VC10 animation table. Writes:
 *   public/assets/elvira/amiga/textures/zoneNNN.png (+ .json sidecar)
 *     — one atlas per zone holding every image in that zone's vga2 table.
 *   public/assets/elvira/amiga/screens/zoneNNN_imgI.png
 *     — the single largest image from each of the 40 zones with the
 *       biggest pictures (room backgrounds / cutscene frames), for a quick
 *       visual sample without flooding screens/ with every zone.
 *   public/assets/elvira/amiga/palettes/zoneNNN.json
 *     — each zone's 16-colour palette (bank 0).
 *   public/assets/elvira/amiga/data/zones.json
 *     — the full zone/image table (dimensions, flags, compressed).
 *
 * See docs/elvira/amiga/data-structure.md for the format writeup and
 * docs/elvira/TODO.md for what remains open (`.out` sound effects, `*tune`
 * music files, non-picture vga1 object/script content).
 */
import { resolve } from 'node:path';
import { exportAgosPictures } from '../../shared/agos-vga-export.ts';

const GAME = 'elvira';
const PLATFORM = 'amiga';

export async function exportElviraData(dataDir: string) {
  const summary = await exportAgosPictures(GAME, PLATFORM, dataDir, 'elvira');
  console.log(
    `elvira/amiga: ${summary.zonesDecoded}/${summary.zonesFound} zones decoded ` +
      `(${summary.zonesMissingFile} missing type1/type2 file, ${summary.zonesNoPictures} decoded with no pictures — text/sound-only zones), ` +
      `${summary.imagesDecoded} images, ${summary.screensWritten} screen samples` +
      (summary.errors.length ? `, ${summary.errors.length} error(s): ${JSON.stringify(summary.errors)}` : ''),
  );
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/elvira/amiga/data');
  exportElviraData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
