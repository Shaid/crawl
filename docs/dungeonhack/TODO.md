# Dungeon Hack — open work

Single status surface for Dungeon Hack (DreamForge Intertainment / SSI, 1993,
DOS/Windows, `data/dungeonhack/dosvga/`). No format doc exists yet — this file
is pointers only, same convention as the other games' `TODO.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dungeonhack-not-started | open | No reverse-engineering has been done yet. Game data is extracted and ready (bin/cue converted via `bchunk`, ARJ installer archive unpacked into `data/dungeonhack/dosvga/`: `AESOP.EXE`, `MAZE.EXE`, `HACK.RES` 7 MB, `HACK.TBL`, `OPEN.RES`/`OPEN.TBL`, sound drivers, `SAVEGAME/`). `HACK.RES`'s first 16 bytes read `"AESOP/16 V1.00\0"` — byte-identical magic string to EOB3's `EYE.RES`, same engine and same version — so `scripts/eotb3lib/res.py` (EOB3's confirmed, byte-exact `EYE.RES` container parser) is the natural starting point rather than reverse-engineering the container from scratch | `data/dungeonhack/dosvga/` (source CD image kept in `cdimage/`); engine match confirmed by direct byte inspection, not yet written up in a doc | 2026-08-02 user |
