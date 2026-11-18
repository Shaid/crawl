# Waxworks — audit 2026-11-13: changes applied (2026-11-18)

Source: `docs/waxworks/audit-2026-11-13.md` (AGOS gap audit covering Elvira 1, Elvira II, Waxworks). Code is shared
(`tools/shared/agos-vga.ts`, `agos-vga-export.ts`, `docs/agos-pkd-format.md`); all three titles were fixed in one commit.
Commit hash: see `git log -- docs/waxworks/audit-2026-11-13-changes.md`.

| # | Finding | Outcome |
|---|---------|---------|
| 1 | Picture count truncated (early-stop walk) | **Applied.** `readAnimTable` now skips 0x0 entries and ends at the lowest non-zero offset; junk uncompressed entries that overrun are rejected. Re-exported: 2,318 -> 4,381 images (126 -> 140 zones). Before->after: 2,318 -> 4,381 images (126 -> 140 zones). Audit totals 1,654/3,273/4,381 reproduced exactly (Elvira II 3,272 + 1 junk entry, zone 99 idx 4, width 10240). |
| 2 | ~40 zones exported with palettes from header bytes | **Applied.** Exporter gates on `paletteBankCount` (vga1 word +2; 321/321 files equal the pointer-difference formula, 49 zones = 0 banks). No `palettes/` file for those zones (39 Waxworks + Elvira II zone 80 stale files removed from `public/assets`), atlases greyscale, `zones.json` has `hasPalette`. 45 palette-less zones with pictures now exported greyscale. |
| 3 | `gameamiga` is the game database | **Applied (docs).** Fixed in data-structure + `agos-pkd-format.md` §4; row `waxworks-gamepc` opened. |
| 4 | `*tune` = simon_decr ProTracker modules | **Applied (docs); extractor deferred** -> `waxworks-tune-music`. |
| 5 | `.out` raw PCM layouts | **Applied (docs); extractor deferred** -> `waxworks-out-sfx`. |
| 6 | Waxworks maze zones | **Applied (docs).** 15 type-1-only zones are shared-graphics maze zones; row `waxworks-maze-zones`. |
| 7 | Palette claims overstated, 0xF96 anecdote | **Applied (docs).** Correction block in `agos-pkd-format.md` §2; 0xF96 retracted; `waxworks-palette-slots` re-opened. Not re-derived from the ScummVM source by me; accepted from the audit, the bank-count part re-verified. |
| 8 | `*-vga1-scripts` mis-scoped | **Applied (TODO rescoped).** |
| 9 | Decompressor table rows wrong; stronger decode check; "uncompressed rare" | **Applied (docs).** Table corrected; 628-file full-consumption check, 29%/26%/26% uncompressed and column-major null recorded (audit numbers, not re-run by me). |
| 10 | Inventory errors, stale code comments | **Applied** (zone ids, file counts, paths, `Pics/` provenance, `agos-vga.ts` comments). |

Tests: `npx vitest run tools/shared/__tests__/agos-vga.test.ts` 11/11 pass. New tests: placeholder-mid-table
synthetic, bank-count, and real-data totals (1,654/3,272/4,381 images; 65/99/140 zones) with a stop-at-first-0x0 null
control and a decode-must-not-throw sweep. `tsc --noEmit` shows no AGOS errors.

Deferred / tracked in `docs/waxworks/TODO.md`: extractors for tunes, sounds, `gameamiga`; palette source for palette-less zones;
VC script semantics. In-game checks for Cassandra: none needed; spot check that palette-less Waxworks zones (e.g. 41) look
acceptable in greyscale until their palette source is found.
