/**
 * Ishar 2: Messengers of Doom (Amiga AGA) — export decompressed location
 * scripts needed by tools/walker's first-person renderer as binary web
 * assets. Run by `npm run build-assets -- --game ishar2` (tools/shared/game-config.ts,
 * 2026-11-23), or directly: `npx tsx tools/ishar2/amigaaga/scripts.ts [dataDir]`.
 * Output: public/assets/ishar2/amigaaga/scripts/<name>.bin -- the old
 * test-bench set plus `ISHAR2_TITLE.sceneScripts` (2026-11-22).
 *
 * Unlike Ishar 1 (one shared `FOND.bin` backdrop for every outdoor script),
 * Ishar 2 ships a PER-LOCATION backdrop file (`FOND1.DO` for `FORET1.DO`,
 * `FVILLE.DO` for `VILLE.DO`) — see `tools/shared/ishar2-firstperson.ts` and
 * `docs/ishar-container-format.md` §8.4 for the render verification both
 * were RENDERED end-to-end against this session.
 */
import { exportIsharEntityMemory, exportIsharScripts, isharSceneScriptNames } from '../../shared/ishar-script-export.js';
import { ISHAR2_TITLE } from '../../shared/ishar-scene.ts';

const dataDir = process.argv[2] ?? 'data/ishar2/amigaaga';
const report = exportIsharScripts(dataDir, 'ishar2', 'amigaaga', [...new Set(['FORET1', 'FOND1', 'VILLE', 'FVILLE', ...isharSceneScriptNames(ISHAR2_TITLE)])]);
const ok = report.filter((r) => r.ok).length;
console.log(`ishar2/amigaaga: exported ${ok}/${report.length} first-person scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);
console.log(`  entity memory: ${exportIsharEntityMemory(dataDir, 'ishar2', 'amigaaga', ISHAR2_TITLE)} blocks`);
