/**
 * Ishar: Legend of the Fortress (Amiga AGA) — export decompressed location
 * scripts needed by tools/walker's first-person renderer as binary web
 * assets. NOT wired into package.json (per this task's constraints) — run
 * directly: `npx tsx tools/ishar/amigaaga/scripts.ts [dataDir]`.
 * Output: public/assets/ishar/amigaaga/scripts/{foret,fond}.bin
 */
import { exportIsharScripts } from '../../shared/ishar-script-export.js';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
const report = exportIsharScripts(dataDir, 'ishar', 'amigaaga', ['FORET', 'FOND']);
const ok = report.filter((r) => r.ok).length;
console.log(`ishar/amigaaga: exported ${ok}/${report.length} first-person scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);
