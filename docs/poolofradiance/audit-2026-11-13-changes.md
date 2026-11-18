# Pool of Radiance: changes from the 2026-11-13 audit

Applied 2026-11-18 (Claude, for Cassandra).

## Findings and outcomes
| Audit finding | Outcome |
|---|---|
| 1. 8x8 tile format wrong (1bpp, 4-byte header) | **Applied.** `decodePorGlyphs` (12-byte header + 4 whole-bank planes, 16x8 items = 2 glyphs), universal bank trimmed to 45 glyphs (glyph 45 verified all-zero), per-entry banks via `buildEntryTileBank` (composite ids 0 -> 1/2/3, 21 -> 211/212, 24 -> 241/242, which the old code never loaded). 105 textures regenerated. Seam-continuity lift **0.448** vs random-pair null (audit 0.46); shifted-alignment control collapses. Old `decode8x8Tiles`/`buildTileBank` removed. |
| 2. por-pic-format / por-dungcom-semantics / por-8x8d-header wrong premise | **Applied (structure).** `tools/poolofradiance/amiga/image.ts` parses IMAGE and ANIMATION; **511/511** entries of the 16 files classify with zero remainder (test), dungcom = 13 frames of 48x24 (12+13*144*4 = 7,500), misaligned null control rejected. Three rows closed; PNG export deferred until the palette exists (`por-palette`). |
| 3. Palettes untracked | **Deferred** -> `por-palette` (PoR palette likely in `program`). |
| 4. Stale text (intro "not touched", GEO planes 0/1 heading, GLIB §4, §7.2 typo) | **Applied** in `amiga/data-structure.md` and `docs/goldbox-glib-format.md` (88/29,696). |
| 5. ECL coverage overstated (127 placeholder) | **Applied as a doc correction** (24/29 real, level 0/7); testing the slot-fill rule deferred -> `goldbox-ecl-multiwallset-slotfill`. Exporter log line still prints 26/29 (not changed). |
| 6. GEO verification numbers do not reproduce | **Deferred** (audit numbers recorded as "script-backed pending"; I did not re-run them — `tools/shared/goldbox-geo.ts` is being edited by another agent) -> `goldbox-geo-verify-numbers`. |
| 7. WALLDEF geometry from own `program+0x40E8B` | **Applied** (doc upgrade, audit-verified, not re-run by me). |

- Files: `tools/shared/goldbox-walltiles.ts` (glyph decoder, `buildEntryTileBank`), `tools/shared/goldbox-glib-export.ts` (per-entry banks, scheme-1 render retired), `tools/poolofradiance/amiga/{walldef,export-data,image}.ts`, new test `tools/shared/__tests__/goldbox-glyph.test.ts`. Commit a5a7a07.
- `tools/shared/goldbox-daa-tiles.ts` (Cassandra's uncommitted WIP) was **not touched** — these four titles do not use it, so no shared-file coordination with the Krynn/Savage Frontier agent was needed.

Before -> after: PoR wall texture pixels (105 PNGs) all changed; lift 0.448 against null (old decode ~0.09 family-wide).

## Tests run
- `npx vitest run tools/shared/__tests__/goldbox-glyph.test.ts`: 10/10 pass (synthetic glyph, palette/1bpp rejection, seam-continuity lift for Curse/Secret/Pools/PoR with random-pair null and shifted-alignment control, PoR 23/23 length invariant + misaligned null control, PoR 511/511 image grammar + dungcom 13x48x24 + shifted null control).
- `npx vitest run tools/shared`: 14 files, 84 tests pass. `npx tsc --noEmit` and eslint clean on the touched files.
- Exporters re-run for all four titles (outputs under `public/assets/<game>/amiga/`, gitignored): see per-title counts.

## TODO delta
Deleted: `por-pic-format`, `por-dungcom-semantics`, `por-8x8d-header`. Added: `por-palette`, `goldbox-ecl-multiwallset-slotfill`, `goldbox-geo-verify-numbers`. Changed: `por-full-catalog`. Old narrative blocks moved to `docs/poolofradiance/history-2026-08.md`.

## In-game checks left for Cassandra
- Walker: PoR wall textures are now different (grey ramp of a 4-bit index, no palette). Doors/fountains/bevelled masonry should be recognisable; colours cannot be checked until `por-palette`.
- Walls of entries 0, 21, 24 (multi-wallset) now draw their composite banks (previously universal-only).
