# Death Knights of Krynn — open work

See `docs/deathknightsofkrynn/amiga/data-structure.md` for the full format
writeup and confirmed sections.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dkok-8x8d1daa | open | Decode `8x8d1.daa` (undecoded 8x8-tile-bank candidate; this title's ONLY wall-art pixel source — no PNG textures ship without it) | data-structure.md §4 "8x8 tile pixel format"; paths-tried table in `docs/championsofkrynn/amiga/data-structure.md` §4 | 2026-09-01 game-re |
| dkok-3levels | open | 3/19 levels (GEO ids 16, 65, 80) have no statically-resolved ECL wallset binding — plausibly non-dungeon scripts, not confirmed | data-structure.md §5 "ECL wallset-slot bindings" | 2026-09-01 game-re |
| dkok-geoprefix | open | GEO record's leading 2-byte prefix is non-constant per level (unlike every sibling title) — content/meaning not decoded | data-structure.md §2 "GEO" | 2026-09-01 game-re |
