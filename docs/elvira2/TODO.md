# Elvira II: The Jaws of Cerberus — open work

Single status surface for this game. See `docs/elvira2/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira2-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-gamepc | open | Decode `gameamiga` (game database: items, rooms, exits, subroutines) by porting ScummVM `readItemFromGamePc`/`readSubroutineBlock` — the room/exit data a walker needs | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-vga1-scripts | open | VC script semantics in `vga1` (structure is walkable: palette banks, image/anim tables, VC scripts; 0 bad opcodes) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira2-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira2-paletteless-zones | open | Palette source for zones whose `vga1` declares 0 banks (atlases are greyscale meanwhile) | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira2-text-tables | open | Decode `text02`-`text09` / `tables01`,`03`-`09` + `stripped.txt` index (8-byte entries; plain text) | `docs/elvira2/amiga/data-structure.md` §4 | 2026-11-18 audit-apply |
| elvira2-misc-files | open | Remaining files: `ICON.DAT`, `menus.dat`, `start`, `Docs/` | `docs/elvira2/amiga/data-structure.md` §4 | 2026-11-18 audit-apply |
