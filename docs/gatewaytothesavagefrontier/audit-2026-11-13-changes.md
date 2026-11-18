# Gateway to the Savage Frontier: audit changes

Date: 2026-11-18. Source: [audit-2026-11-13.md](audit-2026-11-13.md). Commits: the commit that contains this file (see `git log -- docs/gatewaytothesavagefrontier/audit-2026-11-13-changes.md`).

## Findings
9. **GEO 30/30 overstated: applied (docs) + deferred.** Re-run with a strict adjacency metric (edges where a wall is present on either side): levels 21-26 = 0/377, 0/374, 0/370, 0/420, 0/311, 0/370; the other 24 levels 100%. Corrections in data-structure.md §3/§4 ("resolves all 3 slots" noted as overstated; level 21 resolves only slot1). Row `gsf-geo-21-26-encoding`. TODO rewritten (narrative removed).
7. (Treasures-linked) Gateway shares the 25/34/6 combat-icon bank shape; noted in the Treasures doc.

Tests run: `npx vitest run tools/shared/__tests__/goldbox` -> 5 files / 21 tests pass (geo, ecl-dqk, dkk-direct-slice, champions-palette, glyph); `npx tsc --noEmit` clean for the touched Gold Box files. New tests carry null controls.
