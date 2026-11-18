# Secret of the Silver Blades: changes from the 2026-11-13 audit

Applied 2026-11-18 (Claude, for Cassandra).

## Findings and outcomes
| Audit finding | Outcome |
|---|---|
| 1. 8x8 "1bpp" tile format wrong | **Applied.** Same glyph decoder as Curse (1395/1395 per audit; Curse census re-run by test). Per-entry banks: **93/95** views render (was 95 with the wrong decode); the 2 skipped views are entries 7 and 13, which reference a third slot (max index 233) that their two composite banks (71/72, 131/132) cannot supply — consistent with the audit's slot-fill hypothesis, tracked as `goldbox-ecl-multiwallset-slotfill`. Seam lift **0.477** (control 0.155). Scheme-1 render retired (95 stale PNGs removed). |
| 3. Palettes | **Deferred** -> `goldbox-glib-palette`. |
| 4. Stale "19/21, 2 truncated" text | **Applied** (21/21, 2 top-level compressed) in data-structure and GLIB §1/§3; "Pending at time of writing" rows moved to history. |
| 5. ECL overstated (15/51 slots = 127) | **Doc correction**; test deferred -> `goldbox-ecl-multiwallset-slotfill`. |
| 6. GEO numbers | **Deferred** -> `goldbox-geo-verify-numbers`. |
| 7. Untracked unknowns | **Deferred** -> `goldbox-glib-compressed-images`, `ssb-misc-formats`. |

- Files: `tools/shared/goldbox-walltiles.ts` (glyph decoder, `buildEntryTileBank`), `tools/shared/goldbox-glib-export.ts` (per-entry banks, scheme-1 render retired), `tools/poolofradiance/amiga/{walldef,export-data,image}.ts`, new test `tools/shared/__tests__/goldbox-glyph.test.ts`. Commit a5a7a07.
- `tools/shared/goldbox-daa-tiles.ts` (Cassandra's uncommitted WIP) was **not touched** — these four titles do not use it, so no shared-file coordination with the Krynn/Savage Frontier agent was needed.

## Tests run
- `npx vitest run tools/shared/__tests__/goldbox-glyph.test.ts`: 10/10 pass (synthetic glyph, palette/1bpp rejection, seam-continuity lift for Curse/Secret/Pools/PoR with random-pair null and shifted-alignment control, PoR 23/23 length invariant + misaligned null control, PoR 511/511 image grammar + dungcom 13x48x24 + shifted null control).
- `npx vitest run tools/shared`: 14 files, 84 tests pass. `npx tsc --noEmit` and eslint clean on the touched files.
- Exporters re-run for all four titles (outputs under `public/assets/<game>/amiga/`, gitignored): see per-title counts.

## TODO delta
Added: `goldbox-glib-palette`, `goldbox-glib-compressed-images`, `goldbox-ecl-multiwallset-slotfill`, `goldbox-geo-verify-numbers`, `ssb-misc-formats`. Kept: `ssb-full-catalog`. History moved to `docs/secretofthesilverblades/history-2026-08.md`.

## In-game checks left for Cassandra
- Walker: levels using entries 7/13 will fall back to the placeholder on the third-slot walls (2 views). Textures are grey ramps until the palette is wired.
