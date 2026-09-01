/**
 * Treasures of the Savage Frontier (Amiga) extractor.
 *
 * Usage: npx tsx tools/treasureofthesavagefrontier/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to the WHDLoad rip staged at
 * `data/ssi/TreasureSavageFrontNTSC/data` — the real game title, confirmed
 * from the rip's own `ReadMe`, is "Treasures Of The Savage Frontier"
 * (plural "Treasures"), 1991 SSI.)
 *
 * Format: the shared "GLIB" container (`tools/shared/goldbox-glib.ts`) —
 * confirmed byte-exact identical to the sibling titles' container+codec.
 * GEO is the fixed 16x16 shape (69.6% cell wall coverage, 98%+ adjacency
 * self-consistency). WALLDEF's per-wall-id "scheme 2" tile bank pairing is
 * `DiskC/walls.tlb` (co-located with `WallDef.glb`, ids matching WALLDEF's
 * own id set exactly) + `diska/Walls.tlb` (ids `{202,203}`, the universal
 * prefix — identical convention to Gateway/Curse).
 *
 * ECL — SOLVED (2026-09-01, `re-oracle` escalation, independently
 * re-verified against real bytes this session). This title's blocks carry a
 * constant 2-byte `0x8813` tag before the real VM buffer (IDENTICAL to Pool
 * of Radiance's own `.dax`-based `POR_ECL_PREFIX_LENGTH`, even though this
 * is a GLIB container, not a `.dax`; confirmed constant across all 30
 * blocks — `diskb/ecl.glb` has 30 blocks, NOT 41; 41 is `geo.glb`'s own
 * entry count). Once stripped, this title's real opcode table is
 * `OPCODE_TABLE_TREASURE_V13X` (Pools of Darkness's v1.3 table plus 3 new
 * opcodes, `0x42`-`0x44`) — confirmed via a headless-Ghidra disassembly of
 * this title's own executable (`data/ssi/TreasureSavageFrontNTSC/data/Treasure`),
 * 0 unknown opcodes / 0 desyncs across all 30 blocks (re-verified this
 * session, not just taken on the escalation's word).
 *
 * The bigger finding: **for dungeon geos (ids 16-50), the ECL bytecode's
 * own wallset operands are dead data** — the executable's `getAreaWallsets`
 * unconditionally overwrites them from a hardcoded per-geo table
 * (`TREASURE_EXE_WALLSETS` in `goldbox-ecl.ts`) before `LoadWalldef` runs.
 * `wallsetOverride` below applies that table (with its `id===15->32` remap)
 * as the real binding source for those 29 geos; the ECL-based resolution
 * still runs first (useful for wilderness geos `51`-`62`, which fall
 * outside the executable's table and remain unresolved — a genuinely open
 * item, see `docs/treasureofthesavagefrontier/TODO.md`).
 *
 * Full writeup: `docs/treasureofthesavagefrontier/amiga/data-structure.md`
 * §4 and `tools/shared/goldbox-ecl.ts`'s module doc.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';
import { OPCODE_TABLE_TREASURE_V13X, TREASURE_WALLSET_LOAD, TREASURE_EXE_WALLSETS, remapTreasureWallId } from '../../shared/goldbox-ecl.ts';

const GAME = 'treasureofthesavagefrontier';
const PLATFORM = 'amiga';

export async function exportTreasuresOfTheSavageFrontierData(dataDir: string) {
  await exportGoldBoxGlibData(GAME, PLATFORM, dataDir, {
    walldefPath: 'DiskC/WallDef.glb',
    tilesPath: 'diska/Walls.tlb',
    specificTilesPath: 'DiskC/walls.tlb',
    universalTilesPath: 'diska/Walls.tlb',
    geoPath: 'diskb/geo.glb',
    eclPath: 'diskb/ecl.glb',
    // Every ECL block starts with a constant 2-byte 0x8813 tag (same as
    // Pool of Radiance's own `.dax`-based ECL entries) — see module doc.
    eclBlockPrefixLength: 2,
    eclOptions: { opcodeTable: OPCODE_TABLE_TREASURE_V13X, wallsetLoad: TREASURE_WALLSET_LOAD },
    // The real wallset-binding authority for dungeon geos 16-50 — see
    // module doc and goldbox-ecl.ts's "Treasures of the Savage Frontier"
    // section.
    wallsetOverride: (geoId) => {
      const raw = TREASURE_EXE_WALLSETS[geoId];
      if (!raw) return undefined;
      const [slot1, slot2, slot3] = raw.map(remapTreasureWallId);
      return { slot1, slot2, slot3 };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/ssi/TreasureSavageFrontNTSC/data');
  mkdirSync(dataDir, { recursive: true });
  exportTreasuresOfTheSavageFrontierData(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
