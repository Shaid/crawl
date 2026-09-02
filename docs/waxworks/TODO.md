# Waxworks — open work

Single status surface for this game. See `docs/waxworks/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

First-contact pass, 2026-09-02: same container/codec/palette as Elvira 1/2
(CONFIRMED — see `docs/agos-pkd-format.md`). 2,318 pictures decoded across
126/156 zones — the largest of the three corpora. Visually verified
(Egyptian tomb chamber, dungeon wall — see data-structure doc §1).

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| waxworks-text-tables | open | Decode `text01`-`text25`/`tables01`-`16`/`xtable01`-`04`/`tbllist`/`xtbllist` — likely dialogue/narration string tables, the single biggest undecoded lead across all 3 games | `docs/waxworks/amiga/data-structure.md` §2 | 2026-09-02 game-re |
| waxworks-out-sfx | open | Decode `.OUT` "type 3" sound-effect resources | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| waxworks-vga1-scripts | open | Decode `vga1`'s non-palette content | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| waxworks-tune-music | open | Identify/decode `*tune` music files | `docs/waxworks/amiga/data-structure.md` §2 | 2026-09-02 game-re |
| waxworks-misc-files | open | Examine `MENUS.DAT`/`stripped.txt`/`gameamiga`/`runit`/`start` | `docs/waxworks/amiga/data-structure.md` §2 | 2026-09-02 game-re |
| waxworks-palette-slots | deferred:not needed for static picture export | Multi-slot palette compositing for exact runtime fidelity | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
