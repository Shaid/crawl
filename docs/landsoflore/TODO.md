# Lands of Lore: The Throne of Chaos — open work

Single status surface. See `docs/landsoflore/dosvga/data-structure.md`
(verified) and `docs/landsoflore/landsoflore-formats-research.md`
(internet research — superseded wherever the two differ) for full
evidence and paths-tried detail. This file is pointers only.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lol-palette-runtime-patch | open | VCN wall-tile and SHP monster-shape colours resolve to a placeholder `RGB(255,0,255)` range in every candidate palette checked (`PLAYFLD.CPS` embedded, `FXPAL.COL`, `SWAMPICE.COL`) — find where the live game patches the real colours in (EOB-equivalent `setLevelPalettes`, likely `engine/scene_lol.cpp`/`script/script_lol.cpp`, not yet fetched) | `dosvga/data-structure.md` § "VCN — Wall tileset" and § "SHP — Multi-frame creature/UI shapes" | 2026-08-02 game-re |
| lol-tlk-files | open | 30 `DATA/NN.TLK` files (up to 29 MB each) not opened — almost certainly CD-audio/speech track data, not Kyra PAK resources; confirm | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-wll-format | open | `.WLL` wall-parameter table not located/decoded (not needed for byte-exact CMZ grid extraction, but likely holds wall-type rendering parameters analogous to EOB's `<WALLSET>.DAT`) | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-iso-remaining-paks | open | Only a representative subset of the 209-file ISO was extracted this session (breadth-first) — `L02-L29`, `O00A-O29A`, `CIMMERIA/KEEP/MANOR/MINE1/RUIN/SWAMP/TOWER1/URBISH/YVEL.PAK`, `FRE`/`GER` language sets, `MUSIC.PAK`, `VOC.PAK` not pulled through the (now-confirmed) pipeline | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
| lol-text-script-data | deferred:out-of-scope | `.INF`/`.TLC`/`.INI`/`.LM` text/scripting tables and EMC2 script bytecode — gameplay logic, out of scope for the palette/sprite/container breadth pass | `dosvga/data-structure.md` § "Not extracted this session" | 2026-08-02 game-re |
