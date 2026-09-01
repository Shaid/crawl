/**
 * Gateway to the Savage Frontier (Amiga) extractor.
 *
 * Usage: npx tsx tools/gatewaytothesavagefrontier/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to the WHDLoad rip staged at
 * `data/ssi/GatewayToSavageFrontier/data`.)
 *
 * Format: the shared "GLIB" container (`tools/shared/goldbox-glib.ts`) —
 * confirmed byte-exact identical to Curse of the Azure Bonds / Secret of the
 * Silver Blades / Pools of Darkness's own container+codec (see
 * `docs/goldbox-glib-format.md`). This title needed NO format adaptation at
 * all beyond the corpus-wide top-level-compression fix
 * (`tools/shared/goldbox-glib-codecs.ts`'s `loadGlibFile`, discovered this
 * session via Dark Queen of Krynn): GEO is the fixed 16x16 shape, WALLDEF's
 * per-wall-id "scheme 2" tile bank pairing is `DiskC/Walls.tlb` (co-located
 * with `WallDef.glb`) + `DiskA/Walls.tlb` (ids `{202,203}`, the universal
 * prefix — same convention as Curse's `DISKA/8X8D.TLB`), and ECL resolves
 * cleanly with the v1.1 opcode table + base `0x8000` (Curse/Secret's own
 * defaults) with ZERO unknown opcodes across a 25,423-position reachability
 * walk — no engine-revision adaptation needed, unlike Pools of Darkness or
 * Treasures of the Savage Frontier. See
 * `docs/gatewaytothesavagefrontier/amiga/data-structure.md` for the full
 * byte-level writeup and `docs/gatewaytothesavagefrontier/TODO.md` for open
 * items.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';

const GAME = 'gatewaytothesavagefrontier';
const PLATFORM = 'amiga';

export async function exportGatewayToTheSavageFrontierData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    walldefPath: 'DiskC/WallDef.glb',
    // DiskA's own Walls.tlb has exactly ids {202,203} — the same
    // universal(203)+specific(202) flat scheme Curse's DISKA/8X8D.TLB uses,
    // confirmed by re-deriving it directly from this file's own index
    // table (not assumed from the Curse precedent alone).
    tilesPath: 'DiskA/Walls.tlb',
    // DiskC's own Walls.tlb (co-located with WallDef.glb) is the per-
    // wall-id nested scheme WALLDEF is actually keyed to at runtime — its
    // ids overlap WALLDEF's own id set directly (both direct 1:1 and via
    // `resolveCompositeWallId`'s composite arithmetic for multi-wallset
    // entries), confirmed via this file's own index table.
    specificTilesPath: 'DiskC/Walls.tlb',
    universalTilesPath: 'DiskA/Walls.tlb',
    // The dungeon/city square grid — fixed 16x16 shape, byte-identical to
    // Curse/Secret/Pools (see tools/shared/goldbox-geo.ts).
    geoPath: 'DiskC/Geo.glb',
    // Level-scripting bytecode resolving each level's 3 wallset slots.
    // CONFIRMED to use the v1.1 opcode table + base 0x8000 (Curse/Secret's
    // own defaults, no eclOptions needed) — 0 unknown opcodes across the
    // full reachability walk, 22/30 levels resolve at least one slot
    // (64 slots total), and the resolved values all fall inside this
    // title's own WALLDEF directory id space. See
    // tools/shared/goldbox-ecl.ts and data-structure.md §5.
    eclPath: 'DiskC/ECL.glb',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/ssi/GatewayToSavageFrontier/data');
  mkdirSync(dataDir, { recursive: true });
  exportGatewayToTheSavageFrontierData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
