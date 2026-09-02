# Bard's Tale 3 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt3-grp-files | open | Decode `D0WAL.GRP`/`GDUNG.GRP`/`SKARA.GRP`/`WILDWAL.GRP` (likely first-person wall/dungeon-view graphics) | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-maps | open | Decode `maps.hi`/`maps.lo` (same directory container as `all.pic`, content unknown — likely level/dungeon data) | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-monster-banks | open | Decode `monsterh`/`monsterl` — try `unpackBard3`'s LZ77+adaptive-Huffman codec (the raw-planar/chunky hypothesis already failed, see paths-tried below) | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-ilbm-screens | open | Decode `title`/`titlescreen`/`victory`/`finalBardscreen` — confirmed real IFF ILBM via container triage, trivial with @seer-project/iff, not yet done | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-icons | open | Decode `icons.bin` | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-driver | open | Disassemble `driver` (68k program) | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-remap-extra-rows | open | 4 unaccounted-for rows in `bard3`'s 88-row id-remap table (84 real pictures use 84 of 88 rows) | docs/bardstale-picture-format.md §6.1 | 2026-09-02 game-re |
| bt3-slot84 | open | `all.pic` directory slot 84 (offsets 518857-526002, between the last real picture and the sentinel at entry 85) declares a plausible `uncompressedSize=19712` but its LZ77 stream runs past EOF — corrupt data, truncated, or a non-picture reserved slot? | docs/bardstale-picture-format.md §5 correction block | 2026-09-02 game-re |

## Paths tried (dead ends worth remembering)

- **`monsterh`/`monsterl` raw-planar/chunky hypothesis (FAILED)**: before
  `all.pic`'s LZ77+adaptive-Huffman codec was identified, ran
  `seer-probe gfx`'s planar-parameter sweep directly against
  `monsterh`/`monsterl` record 0. Best candidate scored only 0.68/1.0, and
  every candidate in the resulting contact sheet looked like noise, not a
  recognizable image. Not re-attempted with the correct codec yet — these
  files share `all.pic`'s exact self-describing offset-table container
  convention (confirmed structurally), so `unpackBard3` is the next thing
  to try, not more planar-parameter guessing.
