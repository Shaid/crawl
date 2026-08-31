/**
 * Secret of the Silver Blades (Amiga) extractor.
 *
 * Usage: npx tsx tools/secretofthesilverblades/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/secretofthesilverblades/amiga`.)
 *
 * Same shared "GLIB" container as Curse of the Azure Bonds and Pools of
 * Darkness (`tools/shared/goldbox-glib.ts`) — confirmed a different
 * container AND codec from Pool of Radiance's `.dax`. See
 * `docs/secretofthesilverblades/amiga/data-structure.md` for the full
 * writeup and `docs/secretofthesilverblades/TODO.md` for open items.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';

const GAME = 'secretofthesilverblades';
const PLATFORM = 'amiga';

export async function exportSecretOfTheSilverBladesData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    walldefPath: 'DISK2/WALLDEF.GLB',
    // DISK1's 8X8D.TLB uses the "flat universal(203)+specific(202)" scheme
    // (same as Curse's DISKA/8X8D.TLB) but is a much SMALLER bank (165
    // tiles vs Curse's 371). Most wall entries' tile indices fall outside
    // this smaller bank's range and are automatically skipped; wall id 7's
    // first slice is one of the few that fits, and renders as a real but
    // NON-coherent (speckled/noisy) image — weaker evidence than Curse's,
    // recorded honestly as such rather than omitted. Kept alongside (not
    // instead of) the scheme-2 render below.
    tilesPath: 'DISK1/8X8D.TLB',
    // DISK2's own 8X8D.TLB (co-located with WALLDEF.GLB) is the per-wall-id
    // nested scheme WALLDEF is actually keyed to at runtime — same `10*id+n`
    // composite arithmetic as Curse, independently re-confirmed on this
    // file's own index table (composite ids 71/72, 101/102, 211/212/213,
    // etc, exactly matching each WALLDEF entry's own wallset count). Now
    // decodable — see `docs/goldbox-glib-format.md` §5. No id-203 universal
    // bucket in this file; the universal prefix comes from DISK1's copy.
    specificTilesPath: 'DISK2/8X8D.TLB',
    universalTilesPath: 'DISK1/8X8D.TLB',
    // The 16x16 dungeon/city square grid — see tools/shared/goldbox-geo.ts.
    geoPath: 'DISK2/GEO.GLB',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/secretofthesilverblades/amiga');
  mkdirSync(dataDir, { recursive: true });
  exportSecretOfTheSilverBladesData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
