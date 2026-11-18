# Curse of the Azure Bonds: changes from the 2026-11-13 audit

Applied 2026-11-18 (Claude, for Cassandra).

## Findings and outcomes
| Audit finding | Outcome |
|---|---|
| 1. 8x8 "1bpp" tile format wrong | **Applied.** `decodeGlibGlyph` (8-byte header + 5 plane-major bitplanes), glyph census 20+45+18*70 = 1325/1325 (test). Banks are now built **per WALLDEF entry** (`[none, 45 universal, 70 per slot]`, multi-wallset entries use composite ids 141/142, 171/172): 90/90 views in range (the first per-slice attempt skipped 13 because slices of an entry mix glyphs of several slots). Seam-continuity lift **0.472** vs random-pair null (audit 0.48; shifted-alignment control 0.179; audit's shipped 1bpp reading 0.09). Scheme-1 flat render (`walldef-*`, DISKA 8X8D, bank 202 = UI glyphs) retired; 90 stale PNGs and their manifest rows removed. |
| 3. Palettes untracked | **Deferred** -> `goldbox-glib-palette` (palette blocks found, unverified). |
| 4. Stale text ("no compression", GEO planes 0/1 heading) | **Applied** in `amiga/data-structure.md` (+ GLIB doc). |
| 5. ECL overstated | **Doc correction** in GLIB §7.4; test deferred -> `goldbox-ecl-multiwallset-slotfill`. |
| 6. GEO numbers do not reproduce | **Deferred** -> `goldbox-geo-verify-numbers`. |
| 7. Untracked unknowns | **Deferred** -> `goldbox-glib-compressed-images`, `caob-misc-formats`. |

- Files: `tools/shared/goldbox-walltiles.ts` (glyph decoder, `buildEntryTileBank`), `tools/shared/goldbox-glib-export.ts` (per-entry banks, scheme-1 render retired), `tools/poolofradiance/amiga/{walldef,export-data,image}.ts`, new test `tools/shared/__tests__/goldbox-glyph.test.ts`. Commit a5a7a07.
- `tools/shared/goldbox-daa-tiles.ts` (Cassandra's uncommitted WIP) was **not touched** — these four titles do not use it, so no shared-file coordination with the Krynn/Savage Frontier agent was needed.

## Tests run
- `npx vitest run tools/shared/__tests__/goldbox-glyph.test.ts`: 10/10 pass (synthetic glyph, palette/1bpp rejection, seam-continuity lift for Curse/Secret/Pools/PoR with random-pair null and shifted-alignment control, PoR 23/23 length invariant + misaligned null control, PoR 511/511 image grammar + dungcom 13x48x24 + shifted null control).
- `npx vitest run tools/shared`: 14 files, 84 tests pass. `npx tsc --noEmit` and eslint clean on the touched files.
- Exporters re-run for all four titles (outputs under `public/assets/<game>/amiga/`, gitignored): see per-title counts.

## TODO delta
Added: `goldbox-glib-palette`, `goldbox-glib-compressed-images`, `goldbox-ecl-multiwallset-slotfill`, `goldbox-geo-verify-numbers`, `caob-misc-formats`. Kept: `caob-full-catalog`. Old narrative blocks moved to `docs/curseoftheazurebonds/history-2026-08.md`.

## In-game checks left for Cassandra
- Walker: wall textures changed (grey ramp of a 5-bit index). Expect panelled doors between brick and windows (wall 1); no colour until the palette is wired.
- `walldef-*` (scheme 1) textures no longer exist; the walker already prefers `walldef2-*`.
