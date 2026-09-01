/**
 * Curse of the Azure Bonds (Amiga) extractor.
 *
 * Usage: npx tsx tools/curseoftheazurebonds/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/curseoftheazurebonds/amiga`.)
 *
 * Format: the shared "GLIB" container (`tools/shared/goldbox-glib.ts`) — a
 * confirmed DIFFERENT container AND codec from Pool of Radiance's `.dax`
 * (top-level containers are always stored; a simpler cumulative-offset
 * directory; nested "TILE" sub-containers are usually compressed — see
 * `tools/shared/goldbox-glib-codecs.ts` and `docs/goldbox-glib-format.md`
 * §5). See `docs/curseoftheazurebonds/amiga/data-structure.md` for the full
 * byte-level writeup and `docs/curseoftheazurebonds/TODO.md` for open items.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';

const GAME = 'curseoftheazurebonds';
const PLATFORM = 'amiga';

export async function exportCurseOfTheAzureBondsData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    walldefPath: 'DISKB/WALLDEF.GLB',
    // DISKA's 8X8D.TLB uses the "flat universal(203)+specific(202)" tile-bank
    // scheme (CONFIRMED decode + render — see data-structure.md §4). It is
    // NOT the file this disk's own WALLDEF.GLB is paired with at runtime —
    // kept as a real, non-degenerate visual sanity check of the 8x8-tile
    // pixel format + view-geometry compositor mechanism, alongside (not
    // instead of) the scheme-2 render below.
    tilesPath: 'DISKA/8X8D.TLB',
    // DISKB's own 8X8D.TLB (co-located with WALLDEF.GLB) is the per-wall-id
    // nested scheme WALLDEF is actually keyed to at runtime — its ids match
    // WALLDEF's own ids exactly via the `10*id+n` composite arithmetic
    // (confirmed independently on this file's own index table). Its
    // payload is compression-method 3 (10-bit LZW) or 0 (stored); now
    // decodable — see `docs/goldbox-glib-format.md` §5. The universal (id
    // 203) prefix still lives on DISKA's 8X8D.TLB, not this file.
    specificTilesPath: 'DISKB/8X8D.TLB',
    universalTilesPath: 'DISKA/8X8D.TLB',
    // The 16x16 dungeon/city square grid — see tools/shared/goldbox-geo.ts.
    geoPath: 'DISKB/GEO.GLB',
    // Level-scripting bytecode resolving each level's 3 wallset slots — see
    // tools/shared/goldbox-ecl.ts. Curse resolves well (12/25 blocks get at
    // least one statically-known slot, per its own data-structure.md).
    eclPath: 'DISKB/ECL.GLB',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/curseoftheazurebonds/amiga');
  mkdirSync(dataDir, { recursive: true });
  exportCurseOfTheAzureBondsData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
