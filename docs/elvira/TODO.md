# Elvira: Mistress of the Dark — open work

Single status surface for this game. See `docs/elvira/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-gamepc | open | Decode Elvira 1 `gameamiga` items' child tail (variable length; header + 242-op grammar from `runit` already read) -- blocks the walker; then 16-bit-opcode subroutine blocks | `docs/elvira/amiga/data-structure.md` "Walker groundwork" | 2026-11-21 walker |
| elvira-vga1-scripts | open | VC script semantics in `vga1` (structure is walkable: palette banks, image/anim tables, VC scripts; 0 bad opcodes) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira-misc-files | open | Remaining files: `icon.dat` (GAME_ICONFILE), `start` (GAME_RESTFILE), `runit` (executable) | `docs/elvira/amiga/data-structure.md` §1 | 2026-11-18 audit-apply |
