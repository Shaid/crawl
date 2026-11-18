# Treasures of the Savage Frontier — open work

Single status surface for this game (Amiga only). See
`docs/treasureofthesavagefrontier/amiga/data-structure.md` and
`docs/goldbox-glib-format.md`; this file only tracks what is open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| tsf-wilderness-sky-render | open | How is the wilderness drawn? The overlay selector registers combat-map icon banks (24x24), not a view; disassemble overlay #1 around its `"Sky"` string (file `0x3A042`; `Sky.tlb` = 3 blocks of 998/278/2483 B) | data-structure.md §4 correction (2026-11-18) | 2026-11-18 game-re |
| tsf-wilderness-geo-encoding | open | Wilderness GEO ids 51-57 fail the wall-adjacency oracle (15/43..87/106 vs 100% on dungeon geos) — a different encoding; decode it | data-structure.md §4 correction | 2026-11-18 game-re |
| tsf-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content (items, monsters, sprites, portraits, commands, strings, sounds) not catalogued | data-structure.md §6 | 2026-11-18 game-re |
