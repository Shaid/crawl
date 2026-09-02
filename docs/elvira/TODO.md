# Elvira: Mistress of the Dark — open work

Single status surface for this game. See `docs/elvira/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

First-contact pass, 2026-09-02: container (`simon_decr` LZ77), palette, and
the VC10 picture codec are all CONFIRMED and shared with Elvira 2 and
Waxworks (see `docs/agos-pkd-format.md`). 1,124 pictures decoded and
rendered across 62/65 zones; visually verified as coherent, recognizable
game scenes (garden/courtyard renders — see the data-structure doc §2).

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira-out-sfx | open | Decode `.out` "type 3" sound-effect resources (not `simon_decr`-compressed) | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| elvira-vga1-scripts | open | Decode `vga1`'s non-palette content (object defs, room text, VC opcode scripts) | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| elvira-tune-music | open | Identify/decode `*tune` music files (`1tune`/`4tune`/`7tune`/`8tune`/`9tune`/`10tune`/`14tune`) | `docs/elvira/amiga/data-structure.md` §1 | 2026-09-02 game-re |
| elvira-misc-files | open | Examine `gameamiga`/`icon.dat`/`runit`/`start` | `docs/elvira/amiga/data-structure.md` §1 | 2026-09-02 game-re |
| elvira-palette-slots | deferred:not needed for static picture export | Multi-slot palette compositing (`setPaletteSlot`'s windowed banks) for exact runtime fidelity | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
