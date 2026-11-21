# Elvira: Mistress of the Dark — open work

Single status surface for this game. See `docs/elvira/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-gamepc | open | Decode `gameamiga`: the 24-B item header is known; the child tail (use the `0026 xxxx` heap-pointer deltas as a size oracle) and the `0x2710`-terminated region from ~`+0x15F40` (hypothesis: 16-bit-opcode subroutine block) -- blocks the walker | `docs/elvira/amiga/data-structure.md` "Walker follow-up" | 2026-11-21 walker |
| elvira-vga1-scripts | open | VC opcode lengths are solved (`ELVIRA1_VC_PARAM_BYTES`, 750/750); remaining: animation/timing op semantics, palette banks (`elvira-palette-slots`) | `docs/elvira/amiga/data-structure.md` "Walker follow-up" | 2026-11-21 walker |
| elvira-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira-misc-files | open | Remaining files: `icon.dat` (GAME_ICONFILE), `start` (GAME_RESTFILE), `runit` (executable) | `docs/elvira/amiga/data-structure.md` §1 | 2026-11-18 audit-apply |

| elvira-walker | blocked:elvira-gamepc | Elvira 1 walker (room graph + room -> picture); pictures compose (VC table solved) but rooms/scripts are undecoded | `docs/elvira/amiga/data-structure.md` "Walker follow-up" | 2026-11-21 walker |
