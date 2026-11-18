# Pools of Darkness — open work

Single status surface for this game (Amiga only). Format details: `docs/poolsofdarkness/amiga/data-structure.md` (and `docs/goldbox-glib-format.md` for the GLIB titles); this file only tracks what is open. Earlier session history: `docs/poolsofdarkness/history-2026-08.md`.

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| pod-item-dat-vs-items-dat | open | Both `ITEM.DAT` and `ITEMS.DAT` are present; their relationship (which is real/active) not investigated | `amiga/data-structure.md` §0 | 2026-11-18 |
| pod-full-catalog | open | Semantic content of most `.GLB`/`.TLB` files not catalogued — only outer container structure validated | `amiga/data-structure.md` §4 | 2026-11-18 |
| pod-misc-formats | open | No row/decoder for `SOUNDS.GLB`, strings, `pod.fon`, `pod.mx` (`MXTX`) music | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-glib-palette | open | Wire up the palette block 0 of every `8X8D.TLB` bank (104 B = 32 RGB888; also 49 in PIC, 29 in SPRIT) and verify against a screenshot; wall renders are grey ramps until then (hypothesis, unverified) | `docs/goldbox-glib-format.md` §5.5a | 2026-11-18 |
| goldbox-glib-compressed-images | open | HEAD, BODY, PIC, SPRIT, BIGPIC blocks have header byte 7 = `0x02` and sizes that do not fit raw planes: likely individually compressed images | audit `audit-2026-11-13.md` finding 7 | 2026-11-18 |
| goldbox-ecl-multiwallset-slotfill | open | Placeholder 127 slots counted as resolved in the 32/32 / 96-slot claim; test the multi-wallset slot-fill rule (shared family question) | `docs/goldbox-glib-format.md` §7.4 correction | 2026-11-18 |
| goldbox-geo-verify-numbers | open | Replace documented GEO agreement numbers (96.6/95.1) with a committed script (audit: 99.6/99.5 plane 3, 99.6/99.7 planes 0/1) | `amiga/data-structure.md` §5; audit finding 6 | 2026-11-18 |
