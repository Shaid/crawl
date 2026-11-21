# Elvira II: The Jaws of Cerberus — open work

Single status surface for this game. See `docs/elvira2/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira2-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-vga1-scripts | open | Remaining VC semantics: ops with unseen lengths (-1 in `ELVIRA2_VC_PARAM_BYTES`), animated `loadSprite`/op 107 actors not drawn | `docs/elvira2/amiga/data-structure.md` §5 | 2026-11-21 walker
| elvira2-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira2-paletteless-zones | open | Palette source for zones whose `vga1` declares 0 banks (atlases are greyscale meanwhile) | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira2-text-tables | open | Decode `text02`-`text09` / `tables01`,`03`-`09` + `stripped.txt` index (8-byte entries; plain text) | `docs/elvira2/amiga/data-structure.md` §4 | 2026-11-18 audit-apply |
| elvira2-misc-files | open | Remaining files: `ICON.DAT`, `menus.dat`, `start`, `Docs/` | `docs/elvira2/amiga/data-structure.md` §4 | 2026-11-18 audit-apply |
| elvira2-superrooms | open | Walk the two super-room grids (items 744 30x30x4, 760 20x20x6): interpret ops 171/166/35/36 in scripts 1300/1499 to get the per-cell, per-facing picture; 23 room exits lead into them | `docs/elvira2/amiga/data-structure.md` §5 | 2026-11-21 walker |
| elvira2-start-room | open | Decode the real start room/pose (script 100 branches on player-in-760/744; walker starts at first pictured room) | `docs/elvira2/amiga/data-structure.md` §5 | 2026-11-21 walker |
| elvira2-gated-pictures | open | Model object/state-gated conditions (ops 148/149/125/76/77/27) so 19 rooms stop showing their default state; draw op-107 actors | `docs/elvira2/amiga/data-structure.md` §5 | 2026-11-21 walker |
