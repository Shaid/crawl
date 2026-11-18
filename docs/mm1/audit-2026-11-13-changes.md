# MM1 audit 2026-11-13: changes applied (2026-11-18)

Walker-facing fixes were done as one tight group across MM1/MM2/MM3 in commit `a3e9b07`.

| Finding | Outcome |
|---|---|
| 1 wall art by depth, not code | **applied** — `wallEntryForCode` (`tools/walker/games-mm.ts`); code 1/2/3 -> `wallEntries[0/1/2]`; test with 3 codes. Door/torch art comes from WALLPIX entries; docs corrected. |
| 2 edges never cross / `eventTriples` | **applied** — `scripts/mm1lib/ovr.py` (`exits()`, `MAP_IDS` from ScummVM, `resolve_exit`), `extract_mm1_ovr.py` exports `exits[{id,section,screen}]`, walker `neighbors` wired. Verified: 62/62 reciprocal, null control (same-direction pairing) 0; `pp2->dragad` accounts for the 4 non-reciprocal; pp1's `0x010f` matches no id (treated as self). `ovr.json` regenerated (gitignored). |
| 3/4 back-face check | **applied** — `movementBlocked` reads the current cell only (`tools/walker-mm/maze3d.ts`). Test: one-way door open, null control blocks. |
| 5 MM1 uses MM2 geometry | **deferred** — docs/header comments now say approximation; TODO `mm1-drawscene-port`. |
| 6 start positions | **applied** — `MM1_TOWN_START` (ScummVM `loadTown`); non-town screens keep the heuristic, TODO `mm1-start-nontown`. `findEntry` documented as heuristic. |
| 7 bit labels W,S,E,N / dark = 0x20 | **applied** — `tools/mm2/map.ts` + `tools/mm1/map.ts` relabelled, `dark` added, `export-maps.ts` uses it, `maps.json`/atlas regenerated. Real-data test: E<->W neighbour symmetry > 0.99 vs null (N<->W) < 0.6. Correction blocks in data-structure. `0x02`/`0x08` -> TODO `mm-coll-bits-0x02-0x08` (tracked in `docs/mm2/TODO.md`). |
| 10 minimap atlas "exact" | **applied (doc)** — demoted to rendered. |
| 11 walker-mm.md contradictions | **applied** — rows, stale lines 70/101/131-136, Sorpigal start. |
| 12 `+0x32` | **applied (doc)** — 0x32 = `MAP_SPECIAL_COUNT`, table at 0x33. |

Tests: `npx vitest run tools/mm1 tools/mm2 tools/walker tools/walker-mm` -> 27 files / 172 tests pass; `npx tsc --noEmit` clean for mm/walker paths; eslint clean.

In-game checks for Cassandra: Sorpigal start (8,3) facing N; walls one step away should be plain brick/door/torch by actual wall type, not by distance; walking off any indoor edge wraps; AREAA1 east edge -> AREAB1. MM1 frustum geometry is still MM2's (positions differ from the real game).

Not touched: `www/**` (its copies of `maps.json`/labels, if any, were not regenerated).
