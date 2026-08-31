/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) — sprite/image atlas extraction.
 * Usage: npx tsx tools/ishar3/amigaaga/sprites.ts [dataDir]
 * Output: public/assets/ishar3/amigaaga/sprites/*.{png,json}, manifest.json,
 *         public/assets/ishar3/amigaaga/data/sprite-atlas-report.json
 */
import { extractSpriteAtlases } from '../../shared/ishar-sprite-atlas.js';

const dataDir = process.argv[2] ?? 'data/ishar3/amigaaga';
const { report } = await extractSpriteAtlases(dataDir, 'ishar3', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
const totalSprites = report.reduce((sum, r) => sum + r.decodedCount, 0);
console.log(`ishar3/amigaaga: ${ok}/${report.length} files with a decodable sprite directory, ${totalSprites} sprites decoded`);
