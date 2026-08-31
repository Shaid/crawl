/**
 * Ishar 2: Messengers of Doom (Amiga AGA) — sprite/image atlas extraction.
 * Usage: npx tsx tools/ishar2/amigaaga/sprites.ts [dataDir]
 * Output: public/assets/ishar2/amigaaga/sprites/*.{png,json}, manifest.json,
 *         public/assets/ishar2/amigaaga/data/sprite-atlas-report.json
 */
import { extractSpriteAtlases } from '../../shared/ishar-sprite-atlas.js';

const dataDir = process.argv[2] ?? 'data/ishar2/amigaaga';
const { report } = await extractSpriteAtlases(dataDir, 'ishar2', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
const totalSprites = report.reduce((sum, r) => sum + r.decodedCount, 0);
console.log(`ishar2/amigaaga: ${ok}/${report.length} files with a decodable sprite directory, ${totalSprites} sprites decoded`);
