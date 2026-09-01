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
 * NO `WALLDEF`/`WALLS`-named file exists anywhere in this WHDLoad rip's 3
 * disks (confirmed by an exhaustive `find` — see data-structure.md §4) —
 * `walldefPath` is deliberately omitted below. This is consistent with the
 * title's own distinct file families (`PICA`/`PICB`/`PICC`/`BIGPIC`/`FRAME`
 * — location-picture banks and a border frame — plus a `PICTURE` ECL
 * opcode, `0x0e`) and its own variable-size GEO shape: this engine
 * revision very likely renders dungeon exploration as static per-location
 * pictures rather than composited first-person wall textures, so there is
 * no wall-art format to find, not a decode failure. GEO connectivity/doors
 * still decode fully and drive the walker's movement/minimap exactly like
 * every sibling title; only first-person wall-texture rendering is
 * unavailable (the walker's existing "no rendered wall texture" placeholder
 * — a flat tinted rectangle — covers this gracefully with zero code
 * changes, same fallback path used for any level with a genuinely empty
 * `wall-index.json`).
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';

const GAME = 'darkqueenofkrynn';
const PLATFORM = 'amiga';

export async function exportTheDarkQueenOfKrynnData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    // No walldefPath / tilesPath / specificTilesPath / universalTilesPath —
    // this title ships no wall-art format at all, see module doc.
    geoPath: 'Disk3/GEO.GLB',
    // No eclPath: with no WALLDEF to resolve wallset-slot bindings AGAINST,
    // decoding this title's ECL.GLB for that purpose specifically would be
    // pure overhead — its own bytecode almost certainly drives the
    // PICTURE-based renderer (opcode 0x0e) instead of LOAD PIECES/LOAD
    // FILES, an open question for a future pass (see TODO.md).
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
