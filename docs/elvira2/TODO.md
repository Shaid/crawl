# Elvira II: The Jaws of Cerberus — open work

Single status surface for this game. See `docs/elvira2/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

First-contact pass, 2026-09-02: same container/codec/palette as Elvira 1
(CONFIRMED byte-identical, refuting the prior probe recon's "different
header" hypothesis — see `docs/agos-pkd-format.md` §0). 2,303 pictures
decoded across 93/100 zones. The `Pics/` directory's 4 plain IFF `ILBM`
dungeon-level maps are also decoded, byte-exact (legible text render — see
data-structure doc §2).

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira2-out-sfx | open | Decode `013.OUT` (and any other `.out`) sound-effect resource | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| elvira2-vga1-scripts | open | Decode `vga1`'s non-palette content | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
| elvira2-tune-music | open | Identify/decode `0tune`-`9tune` music files | `docs/elvira2/amiga/data-structure.md` §4 | 2026-09-02 game-re |
| elvira2-misc-files | open | Examine `ICON.DAT`/`menus.dat`/`tables01`/`03`/`04`/`gameamiga`/`runit`/`start`/`stripped.txt`/`Docs/` | `docs/elvira2/amiga/data-structure.md` §4 | 2026-09-02 game-re |
| elvira2-palette-slots | deferred:not needed for static picture export | Multi-slot palette compositing for exact runtime fidelity | `docs/agos-pkd-format.md` §4 | 2026-09-02 game-re |
