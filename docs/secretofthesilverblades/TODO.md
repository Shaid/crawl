# Secret of the Silver Blades — open work

Single status surface for this game (Amiga only). Format details: `docs/secretofthesilverblades/amiga/data-structure.md` (and `docs/goldbox-glib-format.md` for the GLIB titles); this file only tracks what is open. Earlier session history: `docs/secretofthesilverblades/history-2026-08.md`.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ssb-full-catalog | open | Semantic content of most `.GLB`/`.TLB` files not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-11-18 |
| ssb-misc-formats | open | No row/decoder for `SOUNDS`, `STRINGS`, `SECRET.FON`, `SECRET.SLB`/`SECRET.MX` (`SLBR`/`MXTX`) music, `ITEMS.DAT` | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-glib-palette | open | Wire up the GLIB palette blocks (`height = 0`, e.g. `DISK2/PIC.TLB` 56 B = 16 RGB888) and verify against a screenshot; wall renders are grey ramps until then (hypothesis, unverified) | `docs/goldbox-glib-format.md` §5.5a | 2026-11-18 |
| goldbox-glib-compressed-images | open | HEAD, BODY, PIC, SPRIT, BIGPIC blocks have header byte 7 = `0x02` and sizes that do not fit raw planes: likely individually compressed images | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-ecl-multiwallset-slotfill | open | 15 of 51 slots are 127 (placeholder): levels 16 (`21,127,127`) and 80/81/82 (`3,127,127`) use them; WALLDEF entries 7 and 13 reference a third slot their two composite banks do not supply (2 of 95 views skipped). Test the slot-fill rule | `amiga/data-structure.md` §5.1 correction | 2026-11-18 |
| goldbox-geo-verify-numbers | open | Replace documented GEO agreement numbers (96.5/97.5) with a committed script (audit: 99.6/99.7 plane 3, 100/100 planes 0/1) | `amiga/data-structure.md` §5; audit finding 6 | 2026-11-18 |
