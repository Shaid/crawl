# Pools of Darkness: changes from the 2026-11-13 audit

Applied 2026-11-18 (Claude, for Cassandra).

## Findings and outcomes
| Audit finding | Outcome |
|---|---|
| 1. 8x8 "1bpp" tile format wrong | **Applied.** 56-byte glyph blocks = 6 planes; block 0 of each bank is a 104-byte palette (skipped). **No universal bank and no leading "none" slot**: index n = glyph n. Verified by comparing alignments with the seam-continuity oracle: direct **0.399** vs placeholder-shifted worse (the shifted bank's null is itself degenerate), matching the audit's 0.40/0.21. `buildWallSpecificTileBank` now returns the direct bank when there is no universal bank. 90/90 views regenerated, 0 out of range. |
| 3. Palettes | **Deferred** -> `goldbox-glib-palette` (palette block 0 of every bank; hypothesis). |
| 4. Stale "19/24, 5 truncated", "no PNG render", "Pending" rows | **Applied** (24/24, 5 top-level compressed) in data-structure and GLIB §1/§3; stale rows moved to history. |
| 5. ECL overstated | **Doc correction** only; -> `goldbox-ecl-multiwallset-slotfill`. |
| 6. GEO numbers | **Deferred** -> `goldbox-geo-verify-numbers`. |
| 7. Untracked unknowns | **Deferred** -> `goldbox-glib-compressed-images`, `pod-misc-formats`. |

- Files: `tools/shared/goldbox-walltiles.ts` (glyph decoder, `buildEntryTileBank`), `tools/shared/goldbox-glib-export.ts` (per-entry banks, scheme-1 render retired), `tools/poolofradiance/amiga/{walldef,export-data,image}.ts`, new test `tools/shared/__tests__/goldbox-glyph.test.ts`. Commit a5a7a07.
- `tools/shared/goldbox-daa-tiles.ts` (Cassandra's uncommitted WIP) was **not touched** — these four titles do not use it, so no shared-file coordination with the Krynn/Savage Frontier agent was needed.

## Tests run
- `npx vitest run tools/shared/__tests__/goldbox-glyph.test.ts`: 10/10 pass (synthetic glyph, palette/1bpp rejection, seam-continuity lift for Curse/Secret/Pools/PoR with random-pair null and shifted-alignment control, PoR 23/23 length invariant + misaligned null control, PoR 511/511 image grammar + dungcom 13x48x24 + shifted null control).
- `npx vitest run tools/shared`: 14 files, 84 tests pass. `npx tsc --noEmit` and eslint clean on the touched files.
- Exporters re-run for all four titles (outputs under `public/assets/<game>/amiga/`, gitignored): see per-title counts.

## TODO delta
Added: `goldbox-glib-palette`, `goldbox-glib-compressed-images`, `goldbox-ecl-multiwallset-slotfill`, `goldbox-geo-verify-numbers`, `pod-misc-formats`. Kept: `pod-item-dat-vs-items-dat`, `pod-full-catalog`. History moved to `docs/poolsofdarkness/history-2026-08.md`.

## In-game checks left for Cassandra
- Walker: Pools wall textures changed (grey ramp of a 6-bit index). Unlike Curse/Secret, index 0 is a real glyph here (solid), not "none"; confirm no odd solid-block cells in rooms.
