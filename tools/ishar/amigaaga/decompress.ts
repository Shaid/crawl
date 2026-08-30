/**
 * Ishar: Legend of the Fortress (Amiga AGA) — batch decompression + verification.
 * Usage: npx tsx tools/ishar/amigaaga/decompress.ts [dataDir]
 * Output: build/cache/ishar/amigaaga/decompressed/*.bin (gitignored),
 *         public/assets/ishar/amigaaga/data/{decompression-report,text-strings}.json
 */
import { decompressDir } from '../../shared/ishar-decompress.js';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
const { report, textByFile } = decompressDir(dataDir, 'ishar', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
console.log(`ishar/amigaaga: decompressed ${ok}/${report.length} files, ${Object.keys(textByFile).length} with printable text runs`);
