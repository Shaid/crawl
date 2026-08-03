# Dungeon Hack — open work

Single status surface for Dungeon Hack (DreamForge Intertainment / SSI, 1993,
DOS/Windows, `data/dungeonhack/dosvga/`). Format doc:
`docs/dungeonhack/dosvga/data-structure.md`.

Runs on the same AESOP/16 engine as EOB3 (`docs/eotb3/dosvga/data-structure.md`).
The container format, "old format" bitmaps, palettes, and a proportional
font format were all confirmed this pass against the real AESOP interpreter
source (John Miles' publicly-released `AESOP_INTERPRETER_BUILD_2a` +
Mirek Luza's DAESOP decompiler, both from
https://www.vogons.org/viewtopic.php?t=20601) — see the doc's "Provenance"
section for what was downloaded and how it was used.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dungeonhack-wall-sel-palette-resolution | open | Resolve which of 21 wall/floor palettes or 14 Sel palettes applies to each of the 97/632 (15%) non-fixed-region `old_format_bitmap` resources | `docs/dungeonhack/dosvga/data-structure.md` §3.3, "Still open" | 2026-08-03 game-re |
| dungeonhack-open-scene-palette | open | Confirm/refine which of `OPEN.RES`'s 3 scene palettes each of its 11 screen resources actually wants (currently a single unverified default) | `docs/dungeonhack/dosvga/data-structure.md` §3.3, "Still open" | 2026-08-03 game-re |
| dungeonhack-sound-sample-rate | open | Confirm Dungeon Hack's own compiled sound module actually uses 8000 Hz (currently inherited from EOB3/ThirdEye, not independently confirmed for this game's build) | `docs/dungeonhack/dosvga/data-structure.md` §2.4, "Still open" | 2026-08-03 game-re |
| dungeonhack-music-cue-payload | open | Decode the inner `CAT ` chunk payload of `OPEN.RES`'s 7 `iff_cue`/music resources (Adlib/Roland/PC variants) | `docs/dungeonhack/dosvga/data-structure.md` §2.7, §6 "Still open" | 2026-08-03 game-re |
| dungeonhack-maze-exe-algorithm | deferred:out-of-scope | `MAZE.EXE`'s dungeon-generation algorithm and `SETTINGS.DAT`/`LEVELS.DAT`/`FEA*.DAT`/`ITEMS.DAT` record formats — all session-generated data, no fixed shipped instance to decode against | `docs/dungeonhack/dosvga/data-structure.md` §6 | 2026-08-03 game-re |
| dungeonhack-aesop-bytecode | deferred:out-of-scope | AESOP SOP bytecode itself (376+ class objects) — game logic, not asset data; DAESOP's disassembler already covers this ground for anyone who wants to go further | `docs/dungeonhack/dosvga/data-structure.md` §2.6, "Still open" | 2026-08-03 game-re |
