# EOB3: audit 2026-11-13, changes applied (2026-11-18)

| # | Finding | Outcome |
|---|---|---|
| 1 | `ITEMTYPE.DAT` "2-byte correction" is a framing error | **Applied (code + docs + test).** Re-verified: first u16 = 64, 2 + 64x16 = 1026, record 0 at offset 2, "trailer" 0x0004 = last record's `extraProperties`; files md5-identical to EOB2's. `scripts/eotb3lib/itemdat.py` `load_itemtype_dat` now reads the count header and ScummVM field names (`invFlags`, `handFlags`, `armorClass`, `allowedClasses`, `requiredHands`, dice, `extraProperties`); `data/itemtype.json` regenerated (`extract_eotb3_chargen.py`); new `scripts/eotb3lib/test_itemdat.py` (run with `python3`, includes a null control). `data-structure.md` s6.2 rewritten with a Correction block; `itemtype-dat-offset-correction.md` marked retracted; provenance item 2 retracted. Dungeon Hack claim dropped. Values unchanged (same bytes, new labels); the 26/27 class-mask `shield` discrepancy vs ThirdEye stays open as noted. |
| 2 | `EYE.RES` 35% uncovered, `lost_space=0` | **Applied (doc).** Re-verified with my own parser: 20 blocks, 2449 entries, 2,399,876 B uncovered. Correction in s1.3; row `eotb3-eyeres-stale-region`. |
| - | 265/312 vs 279/312 coloured bitmaps | **Applied (doc).** `data-structure.md`'s "Still open" row was stale; follows `TODO.md` (279/312, 33 remaining). Not re-derived. |

Tests: `python3 scripts/eotb3lib/test_itemdat.py` ok. Files: `scripts/eotb3lib/itemdat.py`, `scripts/eotb3lib/test_itemdat.py`, `docs/eotb3/dosvga/data-structure.md`, `docs/eotb3/itemtype-dat-offset-correction.md`, `docs/eotb3/TODO.md`.
Checks for Cassandra: none (no in-game effect).
