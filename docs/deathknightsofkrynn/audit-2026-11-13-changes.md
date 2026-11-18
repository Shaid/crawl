# Death Knights of Krynn: audit changes

Date: 2026-11-18. Source: [audit-2026-11-13.md](audit-2026-11-13.md). Commits: the commit that contains this file (see `git log -- docs/deathknightsofkrynn/audit-2026-11-13-changes.md`).

## Findings
3. **Slot model / unbound slots (finding 3): applied as a "rendered" model.** Exporter now sets `directWalldefId` (= slot1) per resolved level (`WallsetBinding.directWalldefId`, `resolveDirectWall` in `goldbox-geo.ts`, walker `games-goldbox.ts`). Coverage over the 16 resolved levels: direct model 7,961/7,961 wall faces map to a wall-index texture, old model 5,166/7,961 (audit: 7,953 vs 5,132; face-count method differs). Coverage is not correctness: no seam/screenshot oracle yet -> `dkok-direct-slice-verify`. Corrected the unresolved ids (65, 80, 97, not 16) in doc + TODO; "all-zero view-cell bytes" claim marked overstated. Test `goldbox-dkk-direct-slice.test.ts` (null control: old model must stay < 80%). Output regenerated.
8/11. **SPRIT/PIC container: documented, deferred.** Correction block in data-structure.md §1; `dkok-sprit-pic-container`.
Other: TODO rewritten; `dkok-geoprefix` kept.

## In-game checks left for Cassandra
- Walk a Death Knights level and check that slot-2/3 wall types now show art instead of placeholders.

Tests run: `npx vitest run tools/shared/__tests__/goldbox` -> 5 files / 21 tests pass (geo, ecl-dqk, dkk-direct-slice, champions-palette, glyph); `npx tsc --noEmit` clean for the touched Gold Box files. New tests carry null controls.
