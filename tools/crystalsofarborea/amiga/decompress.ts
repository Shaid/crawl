/**
 * Crystals of Arborea (Amiga) — batch decompression + verification.
 * Usage: npx tsx tools/crystalsofarborea/amiga/decompress.ts [dataDir]
 */
import { decompressDir } from '../../shared/ishar-decompress.js';

const dataDir = process.argv[2] ?? 'data/crystalsofarborea/amiga';
const { report, textByFile } = decompressDir(dataDir, 'crystalsofarborea', 'amiga');
const ok = report.filter((r) => r.ok).length;
console.log(`crystalsofarborea/amiga: decompressed ${ok}/${report.length} files, ${Object.keys(textByFile).length} with printable text runs`);
