# Gateway to the Savage Frontier — open work

Single status surface for this game (Amiga only). See
`docs/gatewaytothesavagefrontier/amiga/data-structure.md` and
`docs/goldbox-glib-format.md`; this file only tracks what is open.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| gsf-geo-21-26-encoding | open | GEO levels 21-26 score 0% on wall adjacency (S/W planes all zero, `doorN`=1 in ~236/256 cells) — not dungeon grids; decode the (likely overland) encoding | data-structure.md §3 correction (2026-11-18) | 2026-11-18 game-re |
| gsf-ecl-8-unresolved | open | 8/30 levels have no reachable static wallset-load hit and no `NEWECL` target (level 21 resolves only slot1=18); overlaps the non-dungeon levels 21-26 | data-structure.md §4 | 2026-11-18 game-re |
| gsf-full-catalog | open | Most `.GLB`/`.TLB` files' semantic content not catalogued — only container structure validated | data-structure.md §6 | 2026-11-18 game-re |
