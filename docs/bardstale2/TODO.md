# Bard's Tale 2 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt2-wpics | open | Interpret `wpics` payload (one 29,728 B Huffman record, shared container; not a directory bank) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-other-banks | open | Interpret decoded `big_city`, `bard_screen`, `ic`, `title`, `citys` (2,304 + 6 x 512); `big_dung`/`levs` are done (walker), `dung_blank` is unused by the executable | docs/bardstale-picture-format.md §8 | 2026-11-21 walker |
| bt2-audio | open | Instrument files decode to PCM, identical to BT1's — one job with `bt1-audio` | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-anm | open | Interpret decoded `bs.anm` payload | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-animation | open | Decode trailing animation data in `pics` records (`sizeDst-32 > 4928` in 50/61, 210,848 B total; `Uncrypt1` ignores it) | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt2-executable | open | Disassemble `data/bard` (68k program); dungeon loop (overlay group 4) is documented, the rest is not | docs/bardstale2/amiga/data-structure.md §3 | 2026-09-02 game-re |
| bt2-walker-start | open | Find the game's arrival point per level (stairs/teleport; the walker uses a first-open-cell heuristic) and decode the `+0x200`/`+0x400` special-square bytes, `0x600` header and message records | docs/bardstale2/amiga/data-structure.md §3 | 2026-11-21 walker |
| bt2-walker-light | open | Light/vis distance (`0x21ed2`) and the transient `0x21ed3`/`0x21f90` face overrides are not modelled (view fixed at vis 4) | docs/bardstale2/amiga/data-structure.md §3 | 2026-11-21 walker |
| bt2-walker-live | open | Live-check against the real game: view geometry (mirror flip, palette), marks (`0x20`/`0x40` flags are rare in BT2 data) | docs/bardstale2/amiga/data-structure.md §3 | 2026-11-21 walker |
