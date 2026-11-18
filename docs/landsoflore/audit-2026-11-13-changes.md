# Lands of Lore: audit 2026-11-13, changes applied (2026-11-18)

| # | Finding | Outcome |
|---|---|---|
| 5 | `.WLL` "sequential 0..51" / fallback unexercised | **Applied (docs + comments + test).** 12-level census (`tools/landsoflore/__tests__/landsoflore-wll-census.test.ts`, with 0-miss null-control levels): LEVEL2 has 8 unmapped raw values (30 sides), LEVEL3 5 (20 sides); LEVEL2/3/10 duplicate keys 1 and 2; no level is a sequential array. Minor disagreement with the audit: it said 12 values on L2 and L12 sequential; I find 8 and none sequential. `LEVEL2.INI`/`LEVEL3.INI` disassembled with `decode-emc.ts`: zero `setWallType` syscalls, so these gaps are not INI-script driven (L4/5/7-12 INIs do call it). Correction in `dosvga/data-structure.md`; comments fixed in `decode-wll.ts`, `view-model.ts`. Walker behaviour unchanged (clamp fallback kept; engine behaviour unknown). |
| 5 | Row `lol-wll-mapping-fallback` marked `closed` | **Applied.** Reopened with the new question. |
| 2 | TODO statuses `closed`/`narrowed`; stale `lol-iso-remaining-paks` | **Applied.** Statuses fixed, closed-session narrative deleted, row rewritten (L01-L12 cached, 11 levels exported); new row `lol-level10-export` (L10 cached, not exported, unsurveyed). |

Tests: `npx vitest run tools/landsoflore` 26 passed. Files: `tools/landsoflore/{decode-wll,view-model}.ts`, `tools/landsoflore/__tests__/landsoflore-wll-census.test.ts`, `docs/landsoflore/dosvga/data-structure.md`, `docs/landsoflore/TODO.md`.
In-game check for Cassandra: walk LoL levels 2 and 3 and look for the solid-wall cells the walker draws where the original may show something else.
