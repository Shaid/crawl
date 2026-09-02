# Bard's Tale 1 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt1-unk-field | open | What does `pics`' per-record `unk` field (always `0x167B6`) do? | docs/bardstale-picture-format.md §3 | 2026-09-02 game-re |
| bt1-other-banks | open | Decode `big_city`, `big_dung`, `dung_blank`, `bard_screen`, `control_panel`, `icon0-4`, `levs` | docs/bardstale1/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt1-audio | open | Decode `chant`/`drums`/`harp`/`panflu`/`trumpet` (likely bard-instrument audio) | docs/bardstale1/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt1-executable | open | Disassemble `data/bardstale`/`bardstale.dat`/`c/*` (68k program/overlays) | docs/bardstale1/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt1-animation-overlay | open | Does BT1 have per-picture animation overlay data beyond the single static frame decoded here? | docs/bardstale-picture-format.md §8 | 2026-09-02 game-re |

## Paths tried (dead ends worth remembering)

None specific to BT1 this session — `pics` decoded cleanly on the first
correct codec port (after fixing the shared-module bugs documented in
`docs/bardstale-picture-format.md` §4/§6, which affected all 3 games).
