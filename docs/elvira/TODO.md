# Elvira: Mistress of the Dark — open work

Single status surface for this game. See `docs/elvira/amiga/data-structure.md`
and the shared `docs/agos-pkd-format.md` for format details — this file only
tracks what's still open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| elvira-out-sfx | open | Write the `.out` sound extractor (format identified: raw signed 8-bit PCM, per-game record layout) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-tune-music | open | Write the `*tune` extractor (format identified: `simon_decr`-compressed ProTracker modules) | `docs/agos-pkd-format.md` §4 | 2026-11-18 audit-apply |
| elvira-vga1-scripts | open | VC opcode lengths are solved (`ELVIRA1_VC_PARAM_BYTES`, 750/750); remaining: animation/timing op semantics, palette banks (`elvira-palette-slots`) | `docs/elvira/amiga/data-structure.md` "Walker follow-up" | 2026-11-21 walker |
| elvira-palette-slots | open | Real palette load: `vc22_setPalette`, script-selected banks, `paletteMod`; Elvira 1 loads only 13 zone colours + `extraColors` | `docs/agos-pkd-format.md` §2 correction | 2026-11-18 audit-apply |
| elvira-misc-files | open | Remaining files: `icon.dat` (GAME_ICONFILE), `start` (GAME_RESTFILE), `runit` (executable) | `docs/elvira/amiga/data-structure.md` §1 | 2026-11-18 audit-apply |
| elvira-walker-gates | open | Walker approximations: 33 rooms whose scene scripts hit unmodelled conditions (7 opcodes), object/variable-gated pictures at default state, closed/locked doors not openable (no keys), start room 876 and turn-arrow labels unverified in-game, animated sprites (`animate`) not drawn | `docs/elvira/amiga/data-structure.md` "Walker: gameamiga decoded (2026-11-21, second pass)" | 2026-11-21 walker |
