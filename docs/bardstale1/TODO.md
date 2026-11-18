# Bard's Tale 1 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt1-other-banks | open | Interpret decoded payloads of `big_city`, `big_dung`, `dung_blank`, `bard_screen`, `control_panel`, `icon0-4`, `title`, `CITY/*` (all decode with the shared `[u32 size][u32 bitcount][Huffman]` container; payload formats unknown) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-levs-cells | open | Decode `levs` cells: 16 x 2,048 B records = 22x22 2-bit wall grid (484 B) + 484 B flag grid + slack; specials/doors/monsters | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-audio | open | `chant`/`drums`/`harp`/`panflu`/`trumpet` decode to signed 8-bit PCM (identical in BT2) — wrap as audio assets (one job with `bt2-audio`) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-animation-format | open | Decode the trailing animation data after the RLE terminator (44/55 records, u16 count + `03f0 0200 ...` entries ending `ffff`) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-city-dir | open | `bards_data/CITY/` (11 files: bi1..BI9, city.name, city.path, icon3) — inventory + payload meaning | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-c-scrambled | open | `c/bardstale.dat` same size as `bardstale.dat` but differs in 131,281/219,456 B — scrambled copy (copy protection?); also `c/xxx`, `c/zzz` | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-executable | open | Disassemble `data/bardstale`/`bardstale.dat`/`c/*` (68k program/overlays) | docs/bardstale1/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt-config-registration | open | Extractors are not registered in `tools/shared/game-config.ts` (BT1/2/3 run standalone) | docs/bardstale-picture-format.md (audit 2026-11-13 #14) | 2026-11-18 game-re |
