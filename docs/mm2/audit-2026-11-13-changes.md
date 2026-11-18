# MM2 audit 2026-11-13: changes applied (2026-11-18)

Commit `a3e9b07` (shared with MM1/MM3).

| Finding | Outcome |
|---|---|
| 3 overland passability | **applied** — `movementBlocked` + `MM2_TERRAIN_CLASS` (Vairn `passabilityObstruction` @0x9424; kClass table). Measured on the 20 `surface!=0` screens: blocked moves 14,152 -> 4,662 of 19,200; difference 9,490 = the audit's number (it used 24 screens / 23,040 moves; 41.2% there). Unit test covers wall-bit gating, classes 1/3/4, env nibble 0x0A, MM1 encoding unaffected. Party skills (Mountaineering/Pathfinder/Walk on Water) are not modelled (no party in the walker): always blocked/blocking. Direct 68k verification NOT done -> TODO `mm2-overland-passability-0x9424`. |
| 4 back-face check | **applied** (see MM1). |
| 6 start positions | **applied** — start at `attrib` `entry_coord` when non-zero (else heuristic). |
| 7 bit labels / dark | **applied** — see MM1 changes; `map.json` regenerated via `npm run mm2:data`; Correction blocks in `amiga/data-structure.md`. |
| 8 env from attrib | **partly applied** — overland now = `surfaceFlag != 0` (5-16, 33-40); 41-44 moved to the indoor/castle renderer (sheet unconfirmed). `map_category` claim demoted. Remainder -> TODO `mm2-env-from-attrib`. |
| 9 DOS `MAP.DAT` | **applied** — doc + real-data test: 60/60 byte-exact vs Amiga, null control 0/60. `STR.DAT` corrected to a 7,707-B prefix match (re-verified). `EVENTSI` shape -> TODO `mm2-dos-eventsi-shape`. |

TODO.md restructured: new "Open items" table above the (kept) verification ledger.

Tests: `npx vitest run tools/mm1 tools/mm2 tools/walker tools/walker-mm` -> 27 files / 172 tests pass; `npx tsc --noEmit` clean for mm/walker paths; eslint clean.

In-game checks for Cassandra: Middlegate (screen 0) now starts at (7,5); overland: you should be able to walk across open terrain even where the wall bit is set, and be stopped by mountains/forest/deep water; screens 41-44 now render as indoor (castle sheet).
