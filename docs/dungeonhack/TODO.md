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
| dungeonhack-wall-sel-palette-resolution | open | Dungeon art resolved (wall = region 1, floor = region 2 via wallpal/floorpal); still open for non-dungeon Sel palettes of the 97/632 non-fixed-region bitmaps | `docs/dungeonhack/dosvga/data-structure.md` §3.3, "Still open" | 2026-08-03 game-re |
| dungeonhack-open-scene-palette | open | Confirm/refine which of `OPEN.RES`'s 3 scene palettes each of its 11 screen resources actually wants (currently a single unverified default) | `docs/dungeonhack/dosvga/data-structure.md` §3.3, "Still open" | 2026-08-03 game-re |
| dungeonhack-sound-sample-rate | open | Confirm Dungeon Hack's own compiled sound module actually uses 8000 Hz (currently inherited from EOB3/ThirdEye, not independently confirmed for this game's build) | `docs/dungeonhack/dosvga/data-structure.md` §2.4, "Still open" | 2026-08-03 game-re |
| dungeonhack-music-cue-payload | open | Decode the inner `CAT ` chunk payload of `OPEN.RES`'s 7 `iff_cue`/music resources (Adlib/Roland/PC variants) | `docs/dungeonhack/dosvga/data-structure.md` §2.7, §6 "Still open" | 2026-08-03 game-re |
| dungeonhack-aesop-bytecode | deferred:out-of-scope | AESOP SOP bytecode itself (376+ class objects) — game logic, not asset data; DAESOP's disassembler already covers this ground for anyone who wants to go further | `docs/dungeonhack/dosvga/data-structure.md` §2.6, "Still open" | 2026-08-03 game-re |
| dungeonhack-walker-doors | open | Door leaf (`doors` render 263) toggles (2496 px change) but closed/open frames look identical at (5,1) facing E on seed-0 level 1; verify door art vs the frame behind it, and key/lock/lever interaction | `data-structure.md` §9 | 2026-11-21 game-re |
| dungeonhack-walker-actors | open | Monsters draw (orc/hobgoblin/bugbear frames viewed) but do not move/attack; floor items draw, no pick-up; NPC/spell `notify` timers not pumped (VM step-limit when delivered synchronously) | `data-structure.md` §9 | 2026-11-21 game-re |
| dungeonhack-walker-seed-themes | open | Real game seeds its R250 from the clock; our per-level wall/floor themes are seeded from the maze seed (stand-in). Also verify `step_FDIR` (AESOP.EXE image 0xf4fa), `randomize_array`, arrival pose on levels > 1 | `data-structure.md` §9 | 2026-11-21 game-re |
| dungeonhack-walker-hud | open | Walker draws only the 176x120 view pane: no HUD/automap/party, no pits/spinners/hint parchments, fade/scale args of `draw_bitmap` approximated | `data-structure.md` §9 | 2026-11-21 game-re |
