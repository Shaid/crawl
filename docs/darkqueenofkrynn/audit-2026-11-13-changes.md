# Dark Queen of Krynn: audit changes

Date: 2026-11-18. Source: [audit-2026-11-13.md](audit-2026-11-13.md). Commits: the commit that contains this file (see `git log -- docs/darkqueenofkrynn/audit-2026-11-13-changes.md`).

## Findings
1. **Wall art does exist / ECL table (finding 1): applied (ECL wiring) + deferred (rendering).** Added `OPCODE_TABLE_DQK` (`tools/shared/goldbox-ecl.ts`: POOLS_V13 + `0x31` shared ON GOTO handler), wired `eclPath` + `0x21` fill-all into `tools/darkqueenofkrynn/amiga/export-data.ts`, regenerated `public/assets/darkqueenofkrynn/amiga`. Re-verified: 0 unknown / 0 desync, >30k visited instructions; v1.1 and stock v1.3 leave unknown opcodes (null controls). Bindings: 19/20 levels bound, 18 with wallset ids 1-6, geo 26 = 255 sentinel, geo 24 unresolved (audit said 19/20 resolve to 1-6; my run gives 18 + one sentinel + one unresolved). Test: `goldbox-ecl-dqk.test.ts`. Doc: data-structure.md §3 correction (old verdict kept as dead end), §4. Rendering the 48-piece banks deferred -> `dqok-wallpiece-render`; 24/26 -> `dqok-ecl-geo24-26`.
2. **GEO transposed (finding 2): applied.** Header is (height, width). `decodeVariableGeoRecord` fixed. Metric (edge wall-presence agreement, non-square levels) old -> new: L14 0.72->1.00, L38 0.77->1.00, L22 0.76->1.00, L46 0.73->0.91, L47 0.81->1.00, L54 0.79->0.98; all 20 levels >= 0.90. Test `goldbox-geo.test.ts` (per-level gate + swapped-order null control). Docs: data-structure.md §2, `docs/goldbox-glib-format.md`. Exported levels regenerated (20/20).
10. **Doc contradictions: applied** (GEO id list now 20 ids incl. 24; §3/§4 contradiction resolved; TODO rewritten to one line per item, no narrative).

## In-game checks left for Cassandra
- Walk a non-square Dark Queen level (e.g. level 14, 20x39) and confirm the map matches expectation.

Tests run: `npx vitest run tools/shared/__tests__/goldbox` -> 5 files / 21 tests pass (geo, ecl-dqk, dkk-direct-slice, champions-palette, glyph); `npx tsc --noEmit` clean for the touched Gold Box files. New tests carry null controls.
