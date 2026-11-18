# The Dark Queen of Krynn — open work

Single status surface for this game (Amiga only). See
`docs/darkqueenofkrynn/amiga/data-structure.md` and
`docs/goldbox-glib-format.md`; this file only tracks what is open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dqok-wallpiece-render | open | Map the 48 pre-scaled sub-images per `Disk2/8X8DB.TLB`/`8X8DC.TLB` block to wall views/distances, confirm 5-plane order, render textures + a wall index (wallset bindings already exported) | data-structure.md §3 correction (2026-11-18) | 2026-11-18 game-re |
| dqok-ecl-geo24-26 | open | GEO 24 has no static wallset binding and GEO 26 binds the 255 sentinel under `OPCODE_TABLE_DQK` — script-less/non-dungeon, or dynamic? | data-structure.md §3 correction | 2026-11-18 game-re |
| dqok-geo-reserved-header | open | The 6 reserved bytes of the GEO record header (bytes 2-7) are non-constant and undecoded | data-structure.md §2 | 2026-11-18 game-re |
| dqok-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, PIC/FRAME/TOPVIEW banks, commands, strings) not catalogued | data-structure.md §5 | 2026-11-18 game-re |
