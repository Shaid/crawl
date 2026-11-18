# Waxworks — open work

Single status surface for this game. See `docs/waxworks/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| waxworks-text-tables | open | Decode `text01`-`text25`/`tables01`-`16`/`xtable01`-`04`/`tbllist`/`xtbllist` + `stripped.txt` index (25-byte entries) — dialogue/narration string tables | `docs/waxworks/amiga/data-structure.md` §2 | 2026-11-18 audit-apply |
| waxworks-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-gamepc | open | Decode `gameamiga` (game database: items, rooms, exits, subroutines) by porting ScummVM `readItemFromGamePc`/`readSubroutineBlock` — the room/exit data a walker needs | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-vga1-scripts | open | VC script semantics in `vga1` (structure is walkable: palette banks, image/anim tables, VC scripts; 0 bad opcodes) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| waxworks-paletteless-zones | open | Palette source for zones whose `vga1` declares 0 banks (atlases are greyscale meanwhile) | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| waxworks-maze-zones | open | First-person maze zones (15 type-1-only zones share zone 18/94 graphics + room scripts); link to the walker map decision | `docs/waxworks/amiga/data-structure.md` §1 correction; `docs/walker-map-format-future-decision.md:538-563` | 2026-11-18 audit-apply |
| waxworks-misc-files | open | Remaining files: `MENUS.DAT`, `icon.pkd` (simon_decr), `start`, `runit` | `docs/waxworks/amiga/data-structure.md` §2 | 2026-11-18 audit-apply |
| waxworks-out-rate | open | Second u16 of Waxworks `.OUT` records (values 5,7,8,9,10,16), probably a sample-rate code | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
