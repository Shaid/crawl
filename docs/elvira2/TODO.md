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
| elvira2-start-room | open | Decode the real start (sub 101 ends `55 i:854`, a room of starting objects; the opening sequence then moves the player); room-world start is still the first pictured room | `docs/elvira2/amiga/data-structure.md` §6 | 2026-11-21 walker |
| elvira2-gated-pictures | open | Model object/state-gated conditions (ops 148/149/125/76/77/27) so 19 rooms stop showing their default state; draw op-107 actors | `docs/elvira2/amiga/data-structure.md` §5 | 2026-11-21 walker |
| elvira2-maze-entry | open | Confirm room 452 <-> maze 744 arrives at cell 3240 (hypothesis from verb line `165 3240`); 760's only named entry is the dev verb (cell 193) | `docs/elvira2/amiga/data-structure.md` §6 | 2026-11-21 walker |
| elvira2-maze-pits-doors | open | Pit landing cell (sub 1368), opening scripts for closed/locked maze doors (states 2/3), the 8 isolated doorway niches' real access, ~0.3% of maze pictures gated on ops 77/80/125/148 | `docs/elvira2/amiga/data-structure.md` §6 | 2026-11-21 walker |
