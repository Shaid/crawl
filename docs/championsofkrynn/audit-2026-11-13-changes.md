# Champions of Krynn: audit changes

Date: 2026-11-18. Source: [audit-2026-11-13.md](audit-2026-11-13.md). Commits: the commit that contains this file (see `git log -- docs/championsofkrynn/audit-2026-11-13-changes.md`).

## Findings
4. **Wall palette 16-31 -> 0-15 (finding 4): applied** in the uncommitted Gold Box code (left uncommitted, see below). Re-verified the oracle: Amiga DAA pixel indices equal DOS `8X8D1.DAX` nibbles, 100.00% for ids 11/23 (4,480/4,480 px) and 202 (2,432/2,432), 99.97% for 203 (2,879/2,880); shuffled-pair null 20-28%. `readChampionsWallPalette` now returns entries 0-15 (EGA default ramp). Textures regenerated. Row reframed -> `cok-wall-palette-verify`.
5. **Flat-bank addressing (finding 5): docs only.** Downgraded to "unsupported (seam ~ null)" in the module doc, data-structure.md and the verification table; row `cok-wall-addressing`. Not re-measured (I did not rebuild the seam oracle); taken from the audit.
6. **8X8D1.DAX not headerless 1bpp: applied (docs).** Correction in data-structure.md §4.
8. **SPRIT/PIC container: deferred** -> `cok-sprit-pic-container`.
10. **Contradictions: applied** — stale "palette OPEN/greyscale" lines, `{19,20,255}` bank attribution, module-doc `CHAMPIONS_WALL_PALETTE_FALLBACK` reference (now `CHAMPIONS_GREY_PALETTE`), "9/9 WALLDEF1 ids" note; exporter no longer namespaces the 0x7f/0xff sentinels (1255/2127 -> 255/127). ECL unknown-opcode ratio -> `cok-ecl-opcode-table` (deferred).

## Uncommitted Gold Box WIP touched (per Cassandra's approval; NOT committed)
- `tools/shared/goldbox-daa-tiles.ts`: palette slice 16-31 -> 0-15; two correction blocks in the module doc (palette; flat-bank addressing); `CHAMPIONS_WALL_PALETTE_FALLBACK` typo fixed.
- `tools/championsofkrynn/amiga/export-data.ts`: doc comments updated; sentinels no longer namespaced.
- `docs/championsofkrynn/TODO.md`, `docs/championsofkrynn/amiga/data-structure.md`: corrections and rewritten rows.
- New untracked test `tools/shared/__tests__/goldbox-champions-palette.test.ts` (depends on the uncommitted `readChampionsWallPalette`, so it ships with her WIP).

## In-game checks left for Cassandra
- Compare a Champions wall render with a real Amiga screenshot (palette is DOS-index-identical only).

Tests run: `npx vitest run tools/shared/__tests__/goldbox` -> 5 files / 21 tests pass (geo, ecl-dqk, dkk-direct-slice, champions-palette, glyph); `npx tsc --noEmit` clean for the touched Gold Box files. New tests carry null controls.
