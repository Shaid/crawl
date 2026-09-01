/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) — export decompressed
 * location scripts needed by tools/walker's first-person renderer as binary
 * web assets. NOT wired into package.json (matches Ishar 1/2's own
 * `scripts.ts` convention) — run directly:
 * `npx tsx tools/ishar3/amigaaga/scripts.ts [dataDir]`.
 * Output: public/assets/ishar3/amigaaga/scripts/{foret,fforet,jungle,fjungle}.bin
 *
 * See `tools/shared/ishar3-firstperson.ts` and
 * `docs/ishar-container-format.md` §8.6 for the render verification:
 * `FORET.bin`+`FFORET.bin` against real `CONT4-3.FIC` cells is the
 * confirmed/CONFIRMED script, `JUNGLE.bin`+`FJUNGLE.bin` also renders a
 * coherent (non-degenerate) scene against the same region but its true
 * canonical `CONT<n>-3.FIC` region is not independently pinned this
 * session (its own cell-value dispatch range is too broad to discriminate
 * one region from another the way FORET's is) -- shipped anyway since the
 * render itself is real and non-degenerate.
 */
import { exportIsharScripts } from '../../shared/ishar-script-export.js';

const dataDir = process.argv[2] ?? 'data/ishar3/amigaaga';
const report = exportIsharScripts(dataDir, 'ishar3', 'amigaaga', ['FORET', 'FFORET', 'JUNGLE', 'FJUNGLE']);
const ok = report.filter((r) => r.ok).length;
console.log(`ishar3/amigaaga: exported ${ok}/${report.length} first-person scripts`);
for (const r of report) console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.name} ${r.ok ? r.decodedLength + ' bytes' : r.error}`);
