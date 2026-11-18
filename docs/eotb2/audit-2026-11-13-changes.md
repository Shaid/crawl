# EOB2: audit 2026-11-13, changes applied (2026-11-18)

| # | Finding | Outcome |
|---|---|---|
| 1 | Decoration rect units (8-px columns) | **Applied.** Shared `tools/eotb/decode-decorations.ts` fix (see `docs/eotb/audit-2026-11-13-changes.md`); correction blocks in `dosvga/data-structure.md` and `amiga/data-structure.md`. `public/assets/eotb2/{dosvga,amiga}` regenerated. CRIMSON.DEC rect #152 clamped. |
| 3 | Sub-levels are cumulative wall-mapping layers | **Doc applied, code deferred.** Correction block in `dosvga/data-structure.md` (source lines + per-level unmapped-value table). Row `eotb2-dos-inf-sublevel-decoration-coverage` rewritten as `eotb2-sublevel-wall-layers` (export sub 0 and sub 0+1 wall maps); new row `eotb2-level5-maz-shared-mapping`. Exporter change not done (walker feature, not a bug fix). Source line citations are the audit's (ScummVM master), not re-fetched. |
| 4 | "LEVEL15 -> level14.maz is Amiga-only" | **Applied (doc).** Re-verified by decoding all 16 DOS `.INF` (`15:level14.maz`, `16:level15.maz`, `14:level12.maz`, `6:level5.maz`). Corrections in both docs. |
| 11 | TODO narrative | **Applied.** `docs/eotb2/TODO.md` reduced to open rows. |
| 2 | EOB3 ITEMTYPE (EOB2 files are the same bytes) | See `docs/eotb3/audit-2026-11-13-changes.md`. EOB2's own docs/code not changed. |

Tests: `npx vitest run tools/eotb2` passed (part of the 118-test run). In-game check for Cassandra: EOB2 decoration appearance (see EOB1 changes file); enter a level-1/3/7 sub-level 1 state if reachable and note unmapped walls.
Files: `docs/eotb2/{dosvga,amiga}/data-structure.md`, `docs/eotb2/TODO.md`.
