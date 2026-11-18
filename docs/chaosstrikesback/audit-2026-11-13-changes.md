# Chaos Strikes Back (Amiga) — audit 2026-11-13: changes applied (2026-11-18)

Commit: shared with DM1 and DM2 (see `git log -- docs/chaosstrikesback/audit-2026-11-13-changes.md`).

| Audit finding | Outcome |
|---|---|
| 2. IMG1 683/683 circular; "23 -> 683 clean" | **Applied.** Same shared fix as DM1: 687 images by exact consumption; test rewritten with null control. ADF-fix claim demoted in the spec (the fix is real: container tiles, 687 consume exactly). |
| 3. KAOS.FTL palette | **Doc/TODO only** (`csb-palette`; table at `disk1/KAOS.FTL`+0x100A, hypothesis). |
| 4. AN-chunk files (TITL/ENDA/ANIM) | **Doc applied** (shared section; `dm1-titl-dat`, `csb-disk2-support-files`). |
| 5/7. Dungeon layout, checksum | **Applied.** CSB Prison EN: forward tiling exact, checksum 0x939F verified (FR/DE: no trailer). |
| 8. MINI.DAT scan circular | **Applied.** `findDungeonDataOffsets` is now seed-agnostic (plausible header + forward tiling + byte-sum trailer, no whitelist). Result unchanged: unique hit at 10098, ends exactly at EOF 42,786, checksum 0x7CC6; null control (one flipped byte) removes the hit. Test asserts all of this. Signature changed: the old `knownMapCounts` argument is now `maxMapCount` (no other callers). |
| 9. Gaps | **Doc + TODO.** `DungeonF/G.DAT` documented (2 maps, tile exactly); `csb-disk2-support-files` added. |

Tests: `npx vitest run tools/dungeonmaster tools/dungeonmaster2 tools/chaosstrikesback tools/shared/__tests__/dungeonmaster` -> 7 files, 36 tests pass; `npx tsc --noEmit` clean for these paths; eslint clean. Exporters re-run for all three titles (scoped `public/assets/<game>/amiga`).
