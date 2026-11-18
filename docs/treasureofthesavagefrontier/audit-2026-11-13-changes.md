# Treasures of the Savage Frontier: audit changes

Date: 2026-11-18. Source: [audit-2026-11-13.md](audit-2026-11-13.md). Commits: the commit that contains this file (see `git log -- docs/treasureofthesavagefrontier/audit-2026-11-13-changes.md`).

## Findings
7. **`tsf-wilderness-render-technique` mis-framed: applied (docs, row retitled).** Re-verified block counts/sizes: dungcom.tlb 25 x 368 B, wildcom.tlb 34 x 368 B, randcom.tlb 6 x 440 B (8 + 24x3x5 / x6 planes = 24x24 icons). Correction block added in data-structure.md §4; `blocked` dropped; new rows `tsf-wilderness-sky-render` (disassemble overlay #1 near "Sky") and `tsf-wilderness-geo-encoding`.
9. **Wilderness GEO 51-57: deferred.** With a strict metric they score 15/43..87/106 (dungeon geos 100%); the audit's exact numbers (8/25, 24/40) use another metric, my numbers agree in direction. Row `tsf-wilderness-geo-encoding`.
10. TODO rewritten to one line per open item.

Tests run: `npx vitest run tools/shared/__tests__/goldbox` -> 5 files / 21 tests pass (geo, ecl-dqk, dkk-direct-slice, champions-palette, glyph); `npx tsc --noEmit` clean for the touched Gold Box files. New tests carry null controls.
