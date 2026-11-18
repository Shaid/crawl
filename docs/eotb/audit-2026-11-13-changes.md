# EOB1: audit 2026-11-13, changes applied (2026-11-18)

Findings are numbered as in `docs/eotb/audit-2026-11-13.md` / the source report. Findings 1, 6, 7, 8, 10,
11, 12 are applied here; EOB2-specific findings (3, 4) are in `docs/eotb2/audit-2026-11-13-changes.md`.

| # | Finding | Outcome |
|---|---|---|
| 1 | Decoration rects stored in 8-px column units, read as pixels | **Applied (code + docs).** `tools/eotb/decode-decorations.ts` now converts `x`/`w` x8 and clamps `y+h<=200` (shared by EOB1 Amiga, EOB2 DOS and EOB2 Amiga walkers). New test `tools/eotb/__tests__/eotb-decoration-units.test.ts`. Correction blocks in `amiga/data-structure.md` (Decoration overlays, Wall Set DAT table); `renderer.ts` module comment fixed. Outputs regenerated (`public/assets/eotb/amiga`, `eotb2/{dosvga,amiga}`). |
| 6 | "VMP identical across wall sets" | **Applied (doc).** Re-checked: 5 EOB1 Amiga VMPs have 5 distinct md5s. Correction in `amiga/data-structure.md`. |
| 7 | `skip=true` 4-byte-prefix theory | **Applied (doc).** Correction block in `dosvga/data-structure.md` citing `screen_eob.cpp:405-470`. |
| 8 | Palette sections contradict; `.PAL` absent; `nibble*17` comment | **Applied (doc + comment).** Corrections at the old 0x40 text and at the "wall-set's `.PAL`" text (INVENT.CPS base, evidence recorded); `tools/eotb/palette.ts` comment fixed. (INVENT slot-agreement figures are the audit's; not re-derived.) |
| 10 | `LEVEL3.MAZ` cell (4,30) differs DOS vs Amiga | **Applied (doc).** Re-verified (offsets 3863/3865: 13/18 DOS vs 3/8 Amiga). Note in `dosvga/data-structure.md`; row `eotb1-level3-maz-4-30-xport`. |
| 11 | TODO narrative; stale `.MAZ` "additional data" | **Applied.** `docs/eotb/TODO.md` reduced to open rows (all "Closed this session" sections deleted, history in git). MAZ trailing-data claim corrected. `LEVEL1.INF.dec` in `data/`: not touched (row `eotb-build-cache-migration`). |
| 12 | INF layout "1 unused discriminator byte" | **Applied (doc).** |
| 3 (EOB1 part) | LEVEL1 raw wall value 53 unmapped | **Deferred** -> `eotb1-amiga-level1-wall53`. |
| 9 | (EYE.RES) | n/a, EOB3. |

## Verification (before -> after)
- Rect coverage of Amiga decoration sheets' opaque pixels (rect union): as pixels (old) 0.011 (BRICK1) vs x8 (new) 0.988; BRICK2 0.995, BRICK3 1.0, BLUE 0.983, DROW 0.948, GREEN 0.984, XANATHA 0.901. Test asserts >=0.95/0.88 vs <0.4 under the old reading (null control).
- BRICK rects 0-2 now `(0,55,72,25)`, `(72,55,48,17)`, `(120,55,32,11)` (edge-to-edge); no rect exceeds 320x200 in any wall set.
- Tests: `npx vitest run tools/eotb tools/eotb2 tools/landsoflore` 118 passed; eslint clean on `tools/eotb tools/landsoflore`; `tsc --noEmit` no errors in these dirs.

## Files changed
`tools/eotb/decode-decorations.ts`, `tools/eotb/renderer.ts`, `tools/eotb/palette.ts`,
`tools/eotb/__tests__/eotb-decoration-units.test.ts` (new), `docs/eotb/amiga/data-structure.md`,
`docs/eotb/dosvga/data-structure.md`, `docs/eotb/TODO.md`. Commit: see git log (`fix(eotb): ...`).

## In-game / visual checks left for Cassandra
- Walk EOB1 Amiga level 1 and EOB2 (DOS + Amiga) levels and look at wall decorations (torches, plaques, runes): they should now appear at full size, aligned to the wall. The old "pixel-exact" placements in the docs were circular and were never re-verified against the corrected renderer; the mirrored (`-west`) case especially.
- EOB2 CRIMSON rect #152 (clamped at y=200): check no stray row at the screen bottom.
