/**
 * Crystals of Arborea (Amiga) — sprite/image atlas extraction.
 * Usage: npx tsx tools/crystalsofarborea/amiga/sprites.ts [dataDir]
 * Output: public/assets/crystalsofarborea/amiga/sprites/*.{png,json}, manifest.json,
 *         public/assets/crystalsofarborea/amiga/data/sprite-atlas-report.json
 *
 * NOTE: Crystals' corpus is dominated by bitmap type 0x00/0x02 ("draw_st_4bit_0"
 * in the reference `alis` source — see `docs/ishar-sprite-format.md`), an
 * older raw-4bit encoding with no palette-bank byte (pixel data starts 2
 * bytes earlier than the banked 0x10/0x12 format). This is now decoded by
 * `ishar-sprites.ts` alongside the banked-4bit/direct-8bit types confirmed
 * for Ishar 1-3 (31/36 files, 905 sprites decoded; verified via recognizable
 * renders — humanoid/skeleton figures, trees, bushes).
 */
import { extractSpriteAtlases } from '../../shared/ishar-sprite-atlas.js';

const dataDir = process.argv[2] ?? 'data/crystalsofarborea/amiga';
const { report } = await extractSpriteAtlases(dataDir, 'crystalsofarborea', 'amiga');
const ok = report.filter((r) => r.ok).length;
const totalSprites = report.reduce((sum, r) => sum + r.decodedCount, 0);
console.log(`crystalsofarborea/amiga: ${ok}/${report.length} files with a decodable sprite directory, ${totalSprites} sprites decoded`);
