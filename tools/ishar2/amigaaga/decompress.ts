/**
 * Ishar 2: Messengers of Doom (Amiga AGA) — batch decompression + verification.
 * Usage: npx tsx tools/ishar2/amigaaga/decompress.ts [dataDir]
 */
import { decompressDir } from '../../shared/ishar-decompress.js';

const dataDir = process.argv[2] ?? 'data/ishar2/amigaaga';
const { report, textByFile } = decompressDir(dataDir, 'ishar2', 'amigaaga');
const ok = report.filter((r) => r.ok).length;
console.log(`ishar2/amigaaga: decompressed ${ok}/${report.length} files, ${Object.keys(textByFile).length} with printable text runs`);
