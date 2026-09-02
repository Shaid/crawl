/**
 * Waxworks (Amiga) extractor.
 *
 * Usage: npx tsx tools/waxworks/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/waxworks/amiga/data`.)
 *
 * Same AGOS "old bundle" `.pkd` container + VC10 planar codec as Elvira 1
 * (`tools/shared/agos-vga.ts`) — confirmed byte-for-byte identical
 * (`simonDecr` decodes 298/298 `.pkd` files cleanly), differing only in the
 * filename digit width (`NNNT.pkd`, 3-digit zone vs Elvira's 2-digit —
 * `pkdFilename`'s `'waxworks'` scheme). See probe recon's cross-corpus
 * hypothesis, confirmed rather than just "same header shape" — this is
 * genuinely the same packer, not a coincidence of both being Horrorsoft
 * titles from the same era.
 *
 * Writes the same textures/screens/palettes/data layout as Elvira 1/2.
 * See docs/waxworks/amiga/data-structure.md / docs/waxworks/TODO.md.
 */
import { resolve } from 'node:path';
import { exportAgosPictures } from '../../shared/agos-vga-export.ts';

const GAME = 'waxworks';
const PLATFORM = 'amiga';

export async function exportWaxworksData(dataDir: string) {
  const summary = await exportAgosPictures(GAME, PLATFORM, dataDir, 'waxworks');
  console.log(
    `waxworks/amiga: ${summary.zonesDecoded}/${summary.zonesFound} zones decoded ` +
      `(${summary.zonesMissingFile} missing type1/type2 file, ${summary.zonesNoPictures} decoded with no pictures), ` +
      `${summary.imagesDecoded} images, ${summary.screensWritten} screen samples` +
      (summary.errors.length ? `, ${summary.errors.length} error(s): ${JSON.stringify(summary.errors)}` : ''),
  );
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/waxworks/amiga/data');
  exportWaxworksData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
