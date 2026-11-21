# Waxworks — open work

Single status surface for this game. See `docs/waxworks/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| waxworks-text-tables | open | Decode `text01`-`text25`/`tables01`-`16`/`xtable01`-`04`/`tbllist`/`xtbllist` + `stripped.txt` index (25-byte entries) — dialogue/narration string tables (tables/xtables are now parsed as subroutines; room names/long text ids `setShortText`/`setLongText` still need the `text*` banks) | `docs/waxworks/amiga/data-structure.md` §2, §5 | 2026-11-21 game-re |
| waxworks-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| waxworks-vga1-scripts | open | VC script semantics beyond static pictures: animated `loadSprite` overlays/NPCs, delays, `setWindow`/sub-windows (zones 40/50 draw into window 16), palette fades | `docs/waxworks/amiga/data-structure.md` §6 | 2026-11-21 game-re |
| waxworks-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; maze zones use bank 0 of their own 1-bank `vga1` (rendered, unverified against a screenshot) | `docs/agos-pkd-format.md` §2 correction | 2026-11-21 game-re |
| waxworks-paletteless-zones | open | Palette source for zones whose `vga1` declares 0 banks (atlases are greyscale meanwhile) | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| waxworks-maze-object-state | open | Maze pictures use default object state (no key/lamp/NPC state): 228 rooms have a picture line gated by an unmodelled condition (item state/`here`/`isAt`/door tests); closed/locked doors cannot be opened; room scripts' non-picture side effects (`process`, `moveDirn` callbacks) not run | `docs/waxworks/amiga/data-structure.md` §5-7; `tools/waxworks/amiga/room-script.ts` | 2026-11-21 game-re |
| waxworks-maze-turn-direction | open | Which of subroutines 24 (`+1`) / 25 (`+3`) the on-screen Left/Right arrows call, and the real compass labelling (walker assumes 25 = left); needs a live check | `docs/waxworks/amiga/data-structure.md` §5 | 2026-11-21 game-re |
| waxworks-vc-op4-length | open | VC opcode 4 (`fadeIn`) is 6 params or 4 + an `op 1`; the data cannot tell (no effect on walking) | `docs/waxworks/amiga/data-structure.md` §6 | 2026-11-21 game-re |
| waxworks-worlds-40-50 | open | Worlds 1 (zone 50, 579 rooms) and 3 (zone 40, 217 rooms) are exported but mostly unpictured: scenery is drawn into `setWindow(16)` sub-windows (need the window table) | `docs/waxworks/amiga/data-structure.md` §7 | 2026-11-21 game-re |
| waxworks-misc-files | open | Remaining files: `MENUS.DAT`, `icon.pkd` (simon_decr), `start`, `runit` | `docs/waxworks/amiga/data-structure.md` §2 | 2026-11-18 audit-apply |
| waxworks-out-rate | open | Second u16 of Waxworks `.OUT` records (values 5,7,8,9,10,16), probably a sample-rate code | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
