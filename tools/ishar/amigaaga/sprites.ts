/**
 * Ishar: Legend of the Fortress (Amiga AGA) — sprite/image atlas extraction.
 * Usage: npx tsx tools/ishar/amigaaga/sprites.ts [dataDir]
 * Output: public/assets/ishar/amigaaga/sprites/*.{png,json}, manifest.json,
 *         public/assets/ishar/amigaaga/data/sprite-atlas-report.json
 */
import { extractSpriteAtlases } from '../../shared/ishar-sprite-atlas.js';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
const { report } = await extractSpriteAtlases(dataDir, 'ishar', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
const totalSprites = report.reduce((sum, r) => sum + r.decodedCount, 0);
console.log(`ishar/amigaaga: ${ok}/${report.length} files with a decodable sprite directory, ${totalSprites} sprites decoded`);
