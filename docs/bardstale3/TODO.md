# Bard's Tale 3 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt3-grp-layout | open | Decode `D0WAL.GRP`/`GDUNG.GRP`/`SKARA.GRP`/`WILDWAL.GRP`: LE u16 offset directory (D0WAL: 7 entries, 14..8864), records start with magic `RAW\x18` | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt3-maps | open | Decode the cell format of `maps.hi`/`maps.lo`: 71 records of `[u32 size][stock LZHUF]` decode; each = 16-byte name + w/h (0x0C/0x10/0x14) + word-offset table | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt3-monster-banks | open | Decode the 48-byte monster stat record in `monsterh`/`monsterl` (no size header; 41 spans, all multiples of 48; high-bit ASCII names) — NOT graphics | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt3-ilbm-screens | open | Decode `title`/`titlescreen`/`victory`/`finalBardscreen` — confirmed real IFF ILBM via container triage, trivial with @seer-project/iff, not yet done | docs/bardstale3/amiga/data-structure.md §1 | 2026-11-18 game-re |
| bt3-icons | open | Decode `icons.bin` | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-driver | open | Disassemble `driver` (68k program) | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |

## Paths tried (dead ends worth remembering)

- **`monsterh`/`monsterl` as graphics (RETRACTED premise)**: the planar-parameter
  sweep (best 0.68/1.0, noise) failed because the files are not graphics —
  48-byte stat records. Trying `unpackBard3` on them is not the next step.
