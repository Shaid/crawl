# Bard's Tale 2 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt2-wpics | open | Decode `wpics` — a second, differently-named picture-like file (wilderness/overland variant? unconfirmed) | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt2-unk-field | open | What does `pics`' per-record `unk` field do? (shared with BT1, see bardstale-picture-format.md §3) | docs/bardstale-picture-format.md §3 | 2026-09-02 game-re |
| bt2-other-banks | open | Decode `big_city`, `big_dung`, `dung_blank`, `bard_screen`, `citys`, `ic`, `title`, `levs` | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt2-audio | open | Decode `chant`/`drums`/`harp`/`panflu`/`trumpet` (likely bard-instrument audio) | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt2-anm | open | Decode `bs.anm` (name suggests animation data) | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt2-executable | open | Disassemble `data/bard` (68k program) | docs/bardstale2/amiga/data-structure.md §1 | 2026-09-02 game-re |

## Paths tried (dead ends worth remembering)

- **`pics` picture-count boundary**: a raw directory-offset scan alone
  (strictly-ascending in-bounds `u32` values) found 64 candidate slots, but
  this is NOT decisive on its own (no sentinel in this container, see
  bardstale-picture-format.md §2) — 3 of those 64 slots turned out to be
  real placeholder records (`sizeDst=1`), not full pictures. Resolved by
  the exhaustive sequential-decode-until-failure probe instead (§5 of the
  shared doc), which is the only method that actually distinguishes "real
  picture" from "in-bounds-looking directory slot."
