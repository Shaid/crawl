/**
 * Pools of Darkness (Amiga) extractor.
 *
 * Usage: npx tsx tools/poolsofdarkness/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/poolsofdarkness/amiga`.)
 *
 * Same shared "GLIB" container as Curse of the Azure Bonds and Secret of
 * the Silver Blades (`tools/shared/goldbox-glib.ts`). See
 * `docs/poolsofdarkness/amiga/data-structure.md` for the full writeup and
 * `docs/poolsofdarkness/TODO.md` for open items.
 *
 * No "flat" scheme-1 render is attempted: `DISK1/8X8DA.TLB`'s only real id
 * (202) is a genuine, now-decodable compressed bucket (21 blocks / 133
 * tiles — legible arrow-icon/dagger/fence-pattern content, see
 * `docs/goldbox-glib-format.md` §5.5), but it isn't wall art and isn't
 * co-located with this title's own `WALLDEF.GLB`/`8X8D.TLB` pairing, so it
 * would only be a lower-confidence stand-in the way Curse/Secret's own
 * scheme-1 renders are — not attempted here since Pools has something
 * better: `Disk2/8X8D.TLB`'s ids match `Disk2/WALLDEF.GLB`'s own ids
 * DIRECTLY (1:1, no composite arithmetic needed — this title's own format
 * simplification, see data-structure.md §2), so the scheme-2 render below
 * is both the higher-confidence AND the only render for this title.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';
import { OPCODE_TABLE_POOLS_V13 } from '../../shared/goldbox-ecl.ts';

const GAME = 'poolsofdarkness';
const PLATFORM = 'amiga';

export async function exportPoolsOfDarknessData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    walldefPath: 'Disk2/WALLDEF.GLB',
    // Direct 1:1 id match, no composite arithmetic, and no id-203 universal
    // bucket in this file (Pools' own format simplification — see
    // data-structure.md §2/§5).
    specificTilesPath: 'Disk2/8X8D.TLB',
    // The 16x16 dungeon/city square grid — see tools/shared/goldbox-geo.ts.
    geoPath: 'Disk3/GEO.GLB',
    // Level-scripting bytecode (tools/shared/goldbox-ecl.ts). Pools of
    // Darkness runs a v1.3 engine revision with a DIFFERENT opcode table
    // and a wallset load moved to opcode 0x21 ("LOAD FILES") whose 2nd
    // operand fills all 3 slots at once — see goldbox-ecl.ts's module doc
    // (corrects an earlier "LOAD PIECES operands are memory-dereferenced"
    // verdict, which was a misparse under the wrong (v1.1) opcode table).
    eclPath: 'Disk3/ECL.GLB',
    eclOptions: {
      opcodeTable: OPCODE_TABLE_POOLS_V13,
      wallsetLoad: { opcode: 0x21, mode: 'fill-all-from-second-operand' },
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/poolsofdarkness/amiga');
  mkdirSync(dataDir, { recursive: true });
  exportPoolsOfDarknessData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
