/**
 * Ishar: Legend of the Fortress (Amiga AGA) — export decompressed location
 * scripts needed by tools/walker's first-person renderer as binary web
 * assets. NOT wired into package.json (per this task's constraints) — run
 * directly: `npx tsx tools/ishar/amigaaga/scripts.ts [dataDir]`.
 * Output: public/assets/ishar/amigaaga/scripts/{foret,fond,village,plaine,rampart,temple,ftemple}.bin
 *
 * `PLAINE.bin` (plains) and `RAMPART.bin` (fortress) added 2026-09-02 —
 * both RENDERED end-to-end against real `CONT*.FIC` cells matching each
 * script's own disassembled cell-value dispatch (see
 * `docs/ishar-container-format.md` §8.4).
 *
 * `TEMPLE.bin` + its own per-location backdrop `FTEMPLE.bin` added
 * 2026-09-02 — RENDERED end-to-end after correcting a sign error in the
 * previous session's `cswitch2` value-range derivation (real accepted
 * range is `[10,16]`, not `[-10,-4]`); see `docs/ishar-container-format.md`
 * §8.7.
 */
import { exportIsharScripts } from '../../shared/ishar-script-export.js';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
const report = exportIsharScripts(dataDir, 'ishar', 'amigaaga', ['FORET', 'FOND', 'VILLAGE', 'PLAINE', 'RAMPART', 'TEMPLE', 'FTEMPLE']);
const ok = report.filter((r) => r.ok).length;
console.log(`ishar/amigaaga: exported ${ok}/${report.length} first-person scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);
