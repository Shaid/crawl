# MM1 — open work

**MAZEDATA.DTA is SOLVED** (55/55 screens, byte-exact vs Vairn's independent
decoder and the disk file). **WALLPIX.DTA + MONPIX.DTA are SOLVED** (18 wall
sets / 216 frustum slices + 76 monster portraits, 94/94 entries 0-remainder,
ported from ScummVM's mm1 engine — an earlier `.DTA` container off-by-one
undercounted both files by one entry each, silently dropping WALLPIX entry
17 and MONPIX entry 75 (the aquatic-monster portrait); fixed in `dta.py`).
**ROSTER.DTA + SCREEN0-9 are SOLVED**
(18 starter characters, 10 title screens); **MM.RSM documented** as the
overlay-loader symbol table (412 symbols — an earlier scan bug undercounted
this at 22 by desyncing past each symbol's address field; address encoding
still open);
**GACARD.DTA documented** as copy-protection state (1 byte). **ITEM and
MONSTER tables are SOLVED** (MM.EXE +0x19B2A 255×24 and +0x1B312 195×32,
byte-exact 255/255 and 195/195 vs ScummVM's transcription); **spells are
documented** (no binary table — code + string pool). **`.OVR` overlays:
container/selection-fields/text SOLVED**, and the **data-segment header +
script behavior are now SOLVED too** (55/55 size invariant, 387 text
strings extracted, wall entries match Vairn doc 24 byte-for-byte; the
data-segment field table and the special-cell dispatch mechanism — door
checks, exits, flag-gated encounters, generic encounter fallback — are
confirmed byte-exact against ScummVM's `maps/map.h` `DataOffset` enum and
`mapNN.cpp` per-map classes, with the `.OVR`→`mapNN.cpp` mapping solved
for all 55 files via the literal slug string in each map constructor). The
overlay **code is now executed** in the Unicorn harness (rules pass 4: dispatcher, handlers, per-map event table `ovr-events.json`; see `game-rules.md` § 5) — behaviour is derived from the game's own bytes, not from ScummVM. See
`docs/mm1/dosega/data-structure.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| mm1-ovr-code | open (executed, event table exported; 14 % of handler code gated) | Reach the gated handler paths (password / story-flag chains / item gates: 48 of 628 handlers have unreached code, ALAMAR f56c, ASTRAL f5EA, BLACKRN f710, BLACKRS f718, WHITEW f767 never run) and harness the terminal screens' own code (`statue` 0x276C, `loadnext` chain 0x509D, `encounter` wrapper 0x2F87, `getinfo` 0x46CB) | game-rules.md § 5.1-5.2; `rules_oracle/ovr_events.py`, `export-events.ts` | 2026-11-26 game-re |
| mm1-rules-world | open (town services, trap effect, bit-7 question closed; skills / chest flow / class sites remain) | Thievery/skills beyond lock/bash/search (chest flow 0x3752 + `trap` 0x3BE7 CLOSED 2026-11-26, section 6.1), class-dependent sites `equip` 0x7B0E / `frommiss` 0x9CFC / `poption` 0xBEC0, `statue` and `gatgold` internals | game-rules.md § 5.3-5.5 | 2026-11-26 game-re |
| mm1-live-capture | open | DOSBox screenshot of real walls/monsters/title screens as a stronger visual oracle than the structural checks (no DOSBox in this environment yet) | data-structure.md § "Still open" | 2026-08-14 game-re |
| mm1-drawscene-port | open | Reimplement the MM1 scene drawing from the game's own data (do NOT port ScummVM `GameView::drawScene`, which is GPL; use it only as a behaviour reference; observed layout: ARR1..ARR19: left x 0/32/72/96, front x 32/72/96/112, neighbour walls as crops of the front tile, nothing drawn when dark) to replace the borrowed MM2 frustum geometry for MM1 | `docs/mm1/audit-2026-11-13.md` finding 5; `docs/walker-mm.md` | 2026-11-18 game-re |
| mm1-start-nontown | open | Only the 5 towns have a real start (ScummVM `loadTown`); `maps.json` `entry` for other screens is the first-open-cell heuristic — find where stairs/exits place the party | data-structure.md § "Start positions" | 2026-11-18 game-re |
| mm1-amiga-port | idea | Owner wish (2026-11-25): port Might and Magic 1 to the Amiga at some point (there was never an official Amiga release). Would build on the rules spec and the browser remake. Not scheduled. | project_end_goal_browser_remakes (remake first) | 2026-11-25 owner request |
