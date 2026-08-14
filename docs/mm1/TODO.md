# MM1 — open work

**MAZEDATA.DTA is SOLVED** (55/55 screens, byte-exact vs Vairn's independent
decoder and the disk file). **WALLPIX.DTA + MONPIX.DTA are SOLVED** (17 wall
sets / 204 frustum slices + 75 monster portraits, 92/92 entries 0-remainder,
ported from ScummVM's mm1 engine). See
`docs/mm1/dosega/data-structure.md` for both specs + verification evidence.
Open items below are everything else.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| mm1-ovr-scripts | open | Decode per-screen `*.OVR` map-script bytecode + data segments (events, WALLPIX lane ids, exits) — ScummVM `engines/mm/mm1/maps/` implements the interpreter (map00-55.cpp are its hand-translated per-map scripts) | data-structure.md § "Still open"; Vairn/MM2 doc 52 | 2026-08-13 game-re |
| mm1-datatables | open | Locate + decode MM1 items/monsters/spells tables (likely `MM.EXE`-embedded; MM1 has no items.dat/monsters.dat) — ScummVM `data/{items,monsters,treasure}.cpp` give record layouts | Vairn/MM2 doc 52; data-structure.md § "Still open" | 2026-08-13 game-re |
| mm1-misc-dta | open | `ROSTER.DTA` (ScummVM `data/roster.cpp` oracle), `GACARD.DTA`, `SCREEN0`–`SCREEN9`, `MM.RSM` contents unexamined | data-structure.md § "Still open" | 2026-08-13 game-re |
| mm1-live-capture | open | DOSBox screenshot of real walls/monsters as a stronger visual oracle than the structural checks (no DOSBox in this environment yet) | data-structure.md § "Still open" | 2026-08-14 game-re |
