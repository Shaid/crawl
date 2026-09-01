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
 * ECL is the one genuinely NEW finding for this title: its blocks carry a
 * constant 2-byte `0x8813` tag before the real VM buffer — IDENTICAL to
 * Pool of Radiance's own `.dax`-based `POR_ECL_PREFIX_LENGTH`, even though
 * this is a GLIB container, not a `.dax` (confirmed constant across all 41
 * blocks). Stripping it (`eclBlockPrefixLength: 2`) makes the 5-word header
 * decode cleanly for every block sampled, but a residual ~10% unknown-
 * opcode rate remains in the full reachability walk beyond that fix — see
 * `docs/treasureofthesavagefrontier/amiga/data-structure.md` §5 and
 * `docs/treasureofthesavagefrontier/TODO.md` for the escalation this was
 * handed to (`re-oracle`, 2026-09-01) and its outcome once it lands. Until
 * then, ECL wallset-slot binding for this title is NOT resolved (0 slots) —
 * every cell falls back to the existing one-texture-per-level placeholder,
 * same as any other title/level where ECL doesn't resolve.
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { exportGoldBoxGlibData } from '../../shared/goldbox-glib-export.ts';

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
    // The opcode table beyond this fix is still an open question (residual
    // ~10% unknown-opcode rate) — escalated to `re-oracle`, see the doc.
    eclBlockPrefixLength: 2,
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
