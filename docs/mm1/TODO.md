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
**raw 8086 opcode bytes remain undisassembled** — what's closed is
*behavior* (via ScummVM's clean-room reimplementation), not an
instruction-level decode of the actual code segment. See
`docs/mm1/dosega/data-structure.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| mm1-ovr-code | answered-by-ScummVM (behavior); opcode disasm still open | Disassemble the `.OVR` code segments against the game's memory map to decode script semantics (encounters, doors, exits, text dispatch) | data-structure.md § `.OVR` map-script overlays, § "Code-segment semantics — answered-by-ScummVM" — cites `engines/mm/mm1/maps/map.h`, `map.cpp`, `maps.cpp`, `map00.cpp`, `map34.cpp` | 2026-08-14 game-re |
| mm1-live-capture | open | DOSBox screenshot of real walls/monsters/title screens as a stronger visual oracle than the structural checks (no DOSBox in this environment yet) | data-structure.md § "Still open" | 2026-08-14 game-re |
| mm1-rsm-encoding | open — answered-by-neither (both oracles checked) | Decode the `MM.RSM` 4-byte address-field encoding (`seg-byte, 0x28, u16LE offset`) — the symbol names are confirmed, the addressing isn't; Vairn has zero `rsm` hits, ScummVM's loader skips the code segment entirely and never parses an overlay symbol table | data-structure.md § MM.RSM ("Oracle check") | 2026-08-14 game-re |
