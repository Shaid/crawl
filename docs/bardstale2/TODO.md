# Bard's Tale 2 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt2-wpics | open | Interpret `wpics` payload (one 29,728 B Huffman record, shared container; not a directory bank) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-other-banks | open | Interpret decoded `big_city`, `big_dung`, `dung_blank`, `bard_screen`, `ic`, `title`, `levs` (25 x 3,072 B), `citys` (2,304 + 6 x 512) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-audio | open | Instrument files decode to PCM, identical to BT1's — one job with `bt1-audio` | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-anm | open | Interpret decoded `bs.anm` payload | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-animation | open | Decode trailing animation data in `pics` records (`sizeDst-32 > 4928` in 50/61, 210,848 B total; `Uncrypt1` ignores it) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-executable | open | Disassemble `data/bard` (68k program) | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |
