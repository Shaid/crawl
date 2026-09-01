/**
 * Crystals of Arborea (Amiga) -- export decompressed location scripts plus
 * the raw `INIT.FIC` local-scene-array blob needed by tools/walker's
 * first-person renderer (`tools/shared/crystals-firstperson.ts`) as binary
 * web assets. NOT wired into package.json (mirrors
 * `tools/ishar/amigaaga/scripts.ts`'s own out-of-scope note) -- run
 * directly: `npx tsx tools/crystalsofarborea/amiga/scripts.ts [dataDir]`.
 * Output: public/assets/crystalsofarborea/amiga/scripts/{arbre,nplaine,plages,cavint}.bin,
 * public/assets/crystalsofarborea/amiga/data/init.bin
 *
 * `PLAGES.bin` (beaches) and `CAVINT.bin` (cave interior) added
 * 2026-09-02 -- both RENDERED end-to-end against real `INIT.FIC` cells
 * matching each script's own disassembled cell-value dispatch. `CAVINT.bin`
 * needs `sceneLayer=1` (the indoor room-outline layer) -- see
 * `docs/crystalsofarborea/amiga/data-structure.md` §8's correction block.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exportIsharScripts } from '../../shared/ishar-script-export.js';
import { assetDir } from '../../shared/asset-paths.js';

const dataDir = process.argv[2] ?? 'data/crystalsofarborea/amiga';

const report = exportIsharScripts(dataDir, 'crystalsofarborea', 'amiga', ['ARBRE', 'NPLAINE', 'PLAGES', 'CAVINT']);
const ok = report.filter((r) => r.ok).length;
console.log(`crystalsofarborea/amiga: exported ${ok}/${report.length} first-person scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);

const dataOut = assetDir('data', 'crystalsofarborea', 'amiga');
mkdirSync(dataOut, { recursive: true });
copyFileSync(join(dataDir, 'INIT.FIC'), join(dataOut, 'init.bin'));
console.log('  OK  INIT.FIC -> data/init.bin (raw, 10830 B expected)');
