/**
 * The Dark Queen of Krynn (Amiga) extractor.
 *
 * Usage: npx tsx tools/darkqueenofkrynn/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to the WHDLoad rip staged at
 * `data/ssi/DarkQueenOfKrynn/data` — the real game title, confirmed from
 * the rip's own `ReadMe`, is "The Dark Queen of Krynn", 1992 SSI — the
 * third and final title in the Krynn/Dragonlance Gold Box trilogy.)
 *
 * Format: the shared "GLIB" container (`tools/shared/goldbox-glib.ts`) —
 * confirmed byte-exact identical to the sibling titles' container. TWO
 * genuinely NEW format findings for this title, both documented in full in
 * `docs/darkqueenofkrynn/amiga/data-structure.md`:
 *
 * 1. Several of this title's own top-level `.TLB` files (`ALWAYS`,
 *    `COMSPR`, `TOPVIEW`, `GEN`, `CBODY`, `FRAME`) are COMPRESSED at the
 *    outermost level (not just nested sub-containers, as every sibling
 *    title's own top-level files always are) — `loadGlibFile`
 *    (`tools/shared/goldbox-glib-codecs.ts`) handles this transparently.
 *    This retroactively re-explains 7 files across the Curse/Secret/Pools
 *    corpus this project previously (wrongly) diagnosed as dump truncation.
 * 2. `GEO.GLB` uses a VARIABLE-size record shape (`u8 width, u8 height`, 6
 *    reserved bytes, then 4 planes of `width*height` bytes each) instead of
 *    the sibling titles' fixed 1024-byte/16x16 shape — confirmed 20/20 zero
 *    deviation, see `tools/shared/goldbox-geo.ts`'s module doc.
 *    `goldbox-glib-export.ts`'s `decodeGeoLevel` auto-detects this.
 *
 * Wall art: there IS first-person wall art (corrected 2026-11-18; the old
 * "no wall-art mechanism" verdict was wrong). Wallsets load via ECL `0x21`
 * (LOAD FILES) as in Pools of Darkness, and the art lives in
 * `Disk2/8X8DB.TLB` / `8X8DC.TLB` (48 pre-scaled sub-images per block).
 * No `WALLDEF`-named file exists, and the piece banks are not rendered yet
 * (TODO `dqok-wallpiece-render`), so `walldefPath` stays omitted.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';
import { OPCODE_TABLE_DQK } from '../../shared/goldbox-ecl.ts';

const GAME = 'darkqueenofkrynn';
const PLATFORM = 'amiga';

export async function exportTheDarkQueenOfKrynnData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    // No walldefPath / tilesPath / specificTilesPath / universalTilesPath —
    // this title ships no wall-art format at all, see module doc.
    geoPath: 'Disk3/GEO.GLB',
    // The exe's own v1.3-family ECL table + `0x21` wallset load (2026-11-18:
    // 0 unknown / 0 desync, 19/20 levels bind wallsets 1-6 -- see
    // `OPCODE_TABLE_DQK`). Bindings are exported; the 48-piece wall banks
    // (Disk2/8X8DB.TLB, 8X8DC.TLB) are not rendered yet (TODO dqok-wallpiece-render).
    eclPath: 'Disk3/ECL.GLB',
    eclOptions: {
      opcodeTable: OPCODE_TABLE_DQK,
      wallsetLoad: { opcode: 0x21, mode: 'fill-all-from-second-operand' },
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/ssi/DarkQueenOfKrynn/data');
  mkdirSync(dataDir, { recursive: true });
  exportTheDarkQueenOfKrynnData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
