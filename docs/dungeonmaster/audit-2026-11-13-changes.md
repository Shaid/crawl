# Dungeon Master (Amiga) — audit 2026-11-13: changes applied (2026-11-18)

Commit: the commit adding this file (`fix(dungeonmaster): ...`, shared with CSB and DM2; see `git log -- docs/dungeonmaster/audit-2026-11-13-changes.md`).

| Audit finding | Outcome |
|---|---|
| 2. IMG1 "683/683, 0 residue" circular; item 672 not an image; 5 full screens dropped | **Applied.** New `decodeImg1Checked`/`isImg1Image` (exact stream consumption) in `tools/shared/dungeonmaster-codec.ts`; exporter and test use it. Verified: 687 images; items 1,4,5,728,738 included; 672 excluded (238 nibbles unread); null control (IMG4 grammar) tiles <5%. Before 683 -> after 687. |
| 3. KAOS.FTL palette lead | **Partly applied (docs only).** Bytes re-checked: table of 0666 0888 0620 00CC 0840 0080 00C0 0F00 0FA0 0C86 0FF0 0444 0AAA 000F 0FFF at KAOS.FTL+0x79A; recorded as hypothesis in the spec and in `dm1-palette`. Not rendered or screenshot-compared. |
| 4. TITL.DAT is an AN-chunk stream | **Doc applied.** Files table and `dm1-titl-dat` corrected; new shared section in `docs/dungeonmaster-format.md`. Chunk walk not re-derived (audit says it stops early) so hypothesis-grade. |
| 5. DUNGEON.DAT layout / mislabelled field | **Applied.** `mapDataOffsetWords` -> `mapDataOffsetBytes` (14/14 DM1 maps equal the cumulative byte cursor); projectile = 8, explosion = 4 added to `RECORD_SIZE`; forward section tiling replaces back-from-EOF placement (`forwardTilingExact`). DM1 EN/FR/DE all tile exactly. |
| 6. "Visually coherent maze" weak | **Doc applied.** Column-count oracle cited (DM1 412/412; row-major null 40/412). |
| 7. Checksum | **Applied.** `dungeonChecksum`, `parseDungeon().checksum`: DM1 EN 0x2853 verified; FR/DE no trailer. |
| 9. Cross-title gaps | **Deferred** -> TODO rows `dm-graphics-nonimage-items` (items 671-748, DM1 vs CSB 669/749 identical), `dm1-music-sfx` updated. |
| 1, 8, 10 | See DM2 / CSB changes files (shared code). |

Tests: `npx vitest run tools/dungeonmaster tools/dungeonmaster2 tools/chaosstrikesback tools/shared/__tests__/dungeonmaster` -> 7 files, 36 tests pass; `npx tsc --noEmit` clean for these paths; eslint clean. Exporters re-run for all three titles (scoped `public/assets/<game>/amiga`).

In-game checks left for Cassandra: none required; the atlas `sprites/graphics-sample` now includes the five full screens (items 1, 4, 5 at the front of the 400-item sample) and omits item 672 — worth a glance.
