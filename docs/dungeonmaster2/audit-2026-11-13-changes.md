# Dungeon Master II (Amiga) — audit 2026-11-13: changes applied (2026-11-18)

Commit: shared with DM1 and CSB (see `git log -- docs/dungeonmaster2/audit-2026-11-13-changes.md`).

| Audit finding | Outcome |
|---|---|
| 1. IMG4 "98.9%" vacuous; grammar wrong for ~1/3 | **Applied.** New `decodeImg4Checked` (6- or 5-nibble palette + run stream + optional pad nibble + 16-byte trailer, exact tiling). Verified myself: 1,533 six-nibble + 727 five-nibble = 2,260 of 2,263 plausible items (3 unexplained); all 727 five-nibble items use selector 5. Null controls: pre-audit no-trailer grammar tiles <30, IMG1 <100. Exporter gates on exact tiling (atlas: 1,533 items vs the old 2,237; differential/selector-5 items skipped). **Caveat found (not in the audit):** 179 items tile under BOTH variants, so tiling alone does not decide 5 vs 6; decoder prefers 6. Trailer-as-colour-map is recorded as hypothesis only. |
| 5/6/7. DUNGEON.DAT | **Applied.** Forward tiling exact (EOF-2), checksum 0x3D9F verified, per-map byte offsets 44/44, column-count oracle documented. |
| 9. 751 items tile with flag-masked dimensions | **Deferred** -> `dm2-gfx-dimension-flags`; `dm2-gfx-item0-index`; `dm2-raw1-non-image-items` narrowed. |
| 10. Corroborations weak | **Doc applied** (level 7 demoted; type 7/2 semantics unverified; `sample_palette.IFF` provenance). |
| 4. SWSH/TITL/ENDA AN-chunk | **Doc + TODO** (`dm2-an-chunk-files`). |
| `dm2-img8-differential`, `dm2-palette` retitled | **Applied** per the audit. |

Tests: `npx vitest run tools/dungeonmaster tools/dungeonmaster2 tools/chaosstrikesback tools/shared/__tests__/dungeonmaster` -> 7 files, 36 tests pass; `npx tsc --noEmit` clean for these paths; eslint clean. Exporters re-run for all three titles (scoped `public/assets/<game>/amiga`).

In-game/visual check left for Cassandra: the DM2 atlas (`sprites/graphics-sample.png`) changed membership; no palette work was done, so it remains greyscale.
