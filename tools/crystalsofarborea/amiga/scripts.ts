/**
 * Crystals of Arborea (Amiga) -- export the decompressed scripts the 3D
 * view runs (`CRYSTALS_TITLE`'s scene scripts plus NAD, the palette owner)
 * and the raw `INIT.FIC` grid as binary web assets for the walker
 * (`tools/walker/games-crystalsofarborea.ts`, which applies the new game's
 * cell changes itself). NOT wired into package.json (like
 * `tools/ishar/amigaaga/scripts.ts`) -- run directly:
 * `npx tsx tools/crystalsofarborea/amiga/scripts.ts [dataDir]`.
 * Output: public/assets/crystalsofarborea/amiga/scripts/<name>.bin,
 * public/assets/crystalsofarborea/amiga/data/init.bin
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exportIsharScripts } from '../../shared/ishar-script-export.js';
import { assetDir } from '../../shared/asset-paths.js';
import { CRYSTALS_TITLE, isharSceneScriptNames } from '../../shared/ishar-scene.ts';

const dataDir = process.argv[2] ?? 'data/crystalsofarborea/amiga';

const report = exportIsharScripts(dataDir, 'crystalsofarborea', 'amiga', [...isharSceneScriptNames(CRYSTALS_TITLE), 'NAD']);
const ok = report.filter((r) => r.ok).length;
console.log(`crystalsofarborea/amiga: exported ${ok}/${report.length} 3D-view scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);

const dataOut = assetDir('data', 'crystalsofarborea', 'amiga');
mkdirSync(dataOut, { recursive: true });
copyFileSync(join(dataDir, 'INIT.FIC'), join(dataOut, 'init.bin'));
console.log('  OK  INIT.FIC -> data/init.bin (raw, 10830 B expected)');
