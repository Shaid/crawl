# Pool of Radiance — open work

Single status surface for this game (Amiga only). Format details: `docs/poolofradiance/amiga/data-structure.md` (and `docs/goldbox-glib-format.md` for the GLIB titles); this file only tracks what is open. Earlier session history: `docs/poolofradiance/history-2026-08.md`.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| por-palette | open | Find PoR's 16-colour palette (the `.dax` image/glyph files are 4bpp with no palette; probably in `program`) and then export `pic`/`cpic`/`dungcom` etc. as PNG atlases with `tools/poolofradiance/amiga/image.ts` | `amiga/data-structure.md` §3/§4 corrections; audit finding 3 | 2026-11-18 |
| por-full-catalog | open | Semantic content of most `.dax` files (sprites, bodies/heads, monsters, items, `final.dax`; `dungcom` = 13 frames of 48x24, content class unconfirmed) still not catalogued; image STRUCTURE is solved (511/511) | `amiga/data-structure.md` §4 correction | 2026-11-18 |
| goldbox-ecl-multiwallset-slotfill | open | PoR levels 0 and 7 bind `(127,127,127)` (placeholder) yet use slots 0-2 / 0-1: real coverage is 24/29, not 26/29. Test: loading a multi-wallset WALLDEF entry fills the following slots; count 127/255 as unresolved in the exporter | `amiga/data-structure.md` §7.1 correction; `docs/goldbox-glib-format.md` §7.4 | 2026-11-18 |
| goldbox-geo-verify-numbers | open | Replace the documented GEO agreement numbers (95.3/95.4, 'best of 23 permutations 55.7%') with a committed script (audit: 99.5/99.5 plane 3, 96.1/95.9 planes 0/1) and state which axis each permutation check can distinguish | `amiga/data-structure.md` §7; audit finding 5 | 2026-11-18 |
