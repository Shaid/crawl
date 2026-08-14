# MM1 — open work

**MAZEDATA.DTA is SOLVED** (55/55 screens, byte-exact vs Vairn's independent
decoder and the disk file; see `docs/mm1/dosega/data-structure.md`). Open
items below are everything else.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| mm1-wallpix | open | Decode `WALLPIX.DTA` pixel format (496×128 composites, 12 frustum slices each) — Vairn only has partial coverage via lagdotcom's external exports | data-structure.md § "Still open"; Vairn/MM2 docs 51/24 | 2026-08-13 game-re |
| mm1-monpix | open | Decode `MONPIX.DTA` (81,872 B monster portrait sprites) | data-structure.md § "Still open"; Vairn/MM2 doc 51 | 2026-08-13 game-re |
| mm1-ovr-scripts | open | Decode per-screen `*.OVR` map-script bytecode + data segments (events, WALLPIX lane ids, exits) — ScummVM `engines/mm/mm1` implements the interpreter | data-structure.md § "Still open"; Vairn/MM2 doc 52 | 2026-08-13 game-re |
| mm1-datatables | open | Locate + decode MM1 items/monsters/spells tables (likely `MM.EXE`-embedded; MM1 has no items.dat/monsters.dat) | Vairn/MM2 doc 52 | 2026-08-13 game-re |
| mm1-misc-dta | open | `ROSTER.DTA`, `GACARD.DTA`, `SCREEN0`–`SCREEN9`, `MM.RSM` contents unexamined | data-structure.md § "Still open" | 2026-08-13 game-re |
