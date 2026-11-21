# Bard's Tale 1 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt1-other-banks | open | Interpret decoded payloads of `big_city`, (`big_dung`/`dung_blank` solved 2026-11-21), `bard_screen`, `control_panel`, `icon0-4`, `title`, `CITY/*` (all decode with the shared `[u32 size][u32 bitcount][Huffman]` container; payload formats unknown) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-levs-specials | open | Walls/doors/marks decoded; resolve flag bits 0x80/0x08/0x04/0x10/0x01/0x02, the 0x400 header and the special-square list (stairs, teleports, spinners, encounters; level-to-level links) via the event handler at overlay+0x818f2 and square table dispatch at +0x835a0 | docs/bardstale1/amiga/data-structure.md §3 | 2026-11-21 game-re |
| bt1-walker-checks | open | Walker view is code-ported but not checked against the real game: confirm orientation (+a = north), turn direction, wall/door art left-right mirroring and dark far-end (visibility 0x20492 default assumed 4) | docs/bardstale1/amiga/data-structure.md §3 | 2026-11-21 game-re |
| bt1-city | open | Skara Brae city is a separate grid (`big_city` 136,000 B + `CITY/`): not the dungeon model; decode and add a city walker | docs/bardstale-picture-format.md §8 | 2026-11-21 game-re |
| bt1-audio | open | `chant`/`drums`/`harp`/`panflu`/`trumpet` decode to signed 8-bit PCM (identical in BT2) — wrap as audio assets (one job with `bt2-audio`) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-animation-format | open | Decode the trailing animation data after the RLE terminator (44/55 records, u16 count + `03f0 0200 ...` entries ending `ffff`) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-city-dir | open | `bards_data/CITY/` (11 files: bi1..BI9, city.name, city.path, icon3) — inventory + payload meaning | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-c-scrambled | open | `c/bardstale.dat` same size as `bardstale.dat` but differs in 131,281/219,456 B — scrambled copy (copy protection?); also `c/xxx`, `c/zzz` | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt1-executable | open | `bardstale.dat` flattened (144 root hunks + 3 overlay groups) and the dungeon overlay traced; rest of the program and `c/*` not analysed | docs/bardstale1/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt-config-registration | open | BT1 now registered in `game-config.ts`; BT2/BT3 extractors still standalone | docs/bardstale-picture-format.md (audit 2026-11-13 #14) | 2026-11-21 game-re |
