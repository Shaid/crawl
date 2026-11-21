# Bard's Tale 3 (Amiga) — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| bt3-walker-check | open | User live check of the walker frames (geometry, palette 0x20868, door art) against the game; nothing is screenshot-verified | docs/bardstale3/amiga/data-structure.md §4 | 2026-11-21 walker |
| bt3-walker-light | open | Walker renders at light level 5 (all 22 enabled slots); the game's default light and the 0x28c36 alternate palette (DATA 0x208c8) are not modelled | §4 | 2026-11-21 walker |
| bt3-specials | open | Special-square bytecode (71 opcodes at DATA 0x222cc): only opcode 0/1 (stairs) and 3 (teleport, as first opcode) are used by the walker; messages, fights, traps, spinners not implemented | §4 | 2026-11-21 walker |
| bt3-cities | open | City/wilderness grid maps (1 byte per cell, loader 0x2332, GRP by byte 0x14 bits 6-7: wildwal/skara/skara/gdung, 20-byte directory limit = 10 entries) not in the walker | §3, §4 | 2026-11-21 walker |
| bt3-stairs-oneway | open | 5 of 47 stairs (White Tower 10/11, Ice Keep 23) do not land on a reverse stairs square; check whether intended | §4 | 2026-11-21 walker |
| bt3-monster-banks | open | Decode the 48-byte monster stat record in `monsterh`/`monsterl` (no size header; 41 spans, all multiples of 48; high-bit ASCII names) — NOT graphics | docs/bardstale-picture-format.md §8 | 2026-11-18 game-re |
| bt3-ilbm-screens | open | Decode `title`/`titlescreen`/`victory`/`finalBardscreen` — confirmed real IFF ILBM via container triage, trivial with @seer-project/iff, not yet done | docs/bardstale3/amiga/data-structure.md §1 | 2026-11-18 game-re |
| bt3-icons | open | Decode `icons.bin` | docs/bardstale3/amiga/data-structure.md §1 | 2026-09-02 game-re |

## Paths tried (dead ends worth remembering)

- **`monsterh`/`monsterl` as graphics (RETRACTED premise)**: the planar-parameter
  sweep (best 0.68/1.0, noise) failed because the files are not graphics —
  48-byte stat records. Trying `unpackBard3` on them is not the next step.
