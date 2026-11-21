# Zombi — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| zombi-ilieux-fields | open | Meaning of `i-lieux` bytes 6–8 and the 4x10 slot grid values (10..49); special exit values `F0`/`FA`/`1E` | amiga/data-structure.md § i-lieux | 2026-11-21 recon |
| zombi-objects | open | `i-objets` (66 × 4 B) vs 67 `objet.seq` frames; sprite placement over location pictures | amiga/data-structure.md § i-objets | 2026-11-21 recon |
| zombi-sys | deferred:low value | `zombi.sys` layout (game state; contains a re-strided copy of `plan`) | amiga/data-structure.md § Inventory | 2026-11-21 recon |

| zombi-special-exits | open | Effects of exit values 0xFE (event 5), 0xFA (id 46), 0xF0 (36/39), 0x1E (59, unreachable); walker treats them as blocked | amiga/data-structure.md § Movement and compass | 2026-11-21 walker |
| zombi-walker-overlay | open | Objects (slot grid) and zombies/characters over the picture; shared 16-colour palette (only index 0 differs between SCREEN and LIEUX) | tools/walker/games-zombi.ts | 2026-11-21 walker |
