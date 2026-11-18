# Curse of the Azure Bonds — open work

Single status surface for this game (Amiga only). Format details: `docs/curseoftheazurebonds/amiga/data-structure.md` (and `docs/goldbox-glib-format.md` for the GLIB titles); this file only tracks what is open. Earlier session history: `docs/curseoftheazurebonds/history-2026-08.md`.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| caob-full-catalog | open | Semantic content of most `.GLB`/`.TLB` files (items, monsters, sprites, portraits, dungeon commands, strings) not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-11-18 |
| caob-misc-formats | open | No row/decoder for `SOUNDS` (`DIG8`), `STRINGS` (`TEXT`), `CURSE.FON`, `CURSE.SLB` (`SLBR`) music, `ITEMS.DAT` (2,048 B, different MD5 per GLIB title) | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-glib-palette | open | Wire up the GLIB palette blocks (`height = 0`; 56 B = 16 RGB888, 104 B = 32 RGB888, e.g. `DISKA/ALWAYS.TLB`) and verify against a screenshot; wall renders are grey ramps until then (hypothesis, unverified) | `docs/goldbox-glib-format.md` §5.5a | 2026-11-18 |
| goldbox-glib-compressed-images | open | HEAD, BODY, PIC, SPRIT, BIGPIC blocks have header byte 7 = `0x02` and sizes that do not fit raw planes: likely individually compressed images | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-ecl-multiwallset-slotfill | open | Level slots set to 127 (placeholder) count as unresolved; test whether loading a multi-wallset WALLDEF entry fills following slots (shared family question) | `docs/goldbox-glib-format.md` §7.4 correction | 2026-11-18 |
| goldbox-geo-verify-numbers | open | Replace documented GEO agreement numbers (90.8/91.6) with a committed script (audit: 98.9/98.9 plane 3, 99.4/99.5 planes 0/1) | `amiga/data-structure.md` §5; audit finding 6 | 2026-11-18 |
