# Bard's Tale 3 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt3-grp-layout | open | `.GRP` container + 4bpp chunky geometry decoded (32/32); still open: palette source, which record is which wall/depth, GDUNG 112x44/45 pieces, WILDWAL 22-byte placeholders | docs/bardstale3/amiga/data-structure.md §3 | 2026-11-21 walker |
| bt3-maps | open | Dungeon-record layout (61 of 71 maps: size-1/level/link bytes + sparse cell stream) and cell/special semantics of the 10 grid maps; walker blocked on this | docs/bardstale3/amiga/data-structure.md §3 | 2026-11-21 walker |
| bt3-monster-banks | open | Decode the 48-byte monster stat record in `monsterh`/`monsterl` (no size header; 41 spans, all multiples of 48; high-bit ASCII names) — NOT graphics | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt3-ilbm-screens | open | Decode `title`/`titlescreen`/`victory`/`finalBardscreen` — confirmed real IFF ILBM via container triage, trivial with @seer-project/iff, not yet done | docs/bardstale3/amiga/data-structure.md §1 | 2026-11-18 game-re |
| bt3-icons | open | Decode `icons.bin` | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |
| bt3-driver | open | Disassemble `driver` (68k program): map loader, move routine, view geometry, wall-art palette (blocks the walker) | docs/bardstale3/amiga/data-structure.md §3 | 2026-11-21 walker |

## Paths tried (dead ends worth remembering)

- **`monsterh`/`monsterl` as graphics (RETRACTED premise)**: the planar-parameter
  sweep (best 0.68/1.0, noise) failed because the files are not graphics —
  48-byte stat records. Trying `unpackBard3` on them is not the next step.
