/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) — batch decompression + verification.
 * Usage: npx tsx tools/ishar3/amigaaga/decompress.ts [dataDir]
 */
import { decompressDir } from '../../shared/ishar-decompress.js';

const dataDir = process.argv[2] ?? 'data/ishar3/amigaaga';
const { report, textByFile } = decompressDir(dataDir, 'ishar3', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
console.log(`ishar3/amigaaga: decompressed ${ok}/${report.length} files, ${Object.keys(textByFile).length} with printable text runs`);
