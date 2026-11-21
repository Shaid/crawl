# Zombi — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| zombi-exit-orientation | open | Which compass names bytes 0..3 / 4..5 of `i-lieux` carry (rows count up or down; which vertical byte is up) | amiga/data-structure.md § i-lieux | 2026-11-21 recon |
| zombi-ilieux-fields | open | Meaning of `i-lieux` bytes 6–9, the 32-B slot table at 10..41, and 42..49; special exit values `F0`/`FA`/`1E` | amiga/data-structure.md § i-lieux | 2026-11-21 recon |
| zombi-objects | open | `i-objets` (66 × 4 B) vs 67 `objet.seq` frames; sprite placement over location pictures | amiga/data-structure.md § i-objets | 2026-11-21 recon |
| zombi-sys | deferred:low value | `zombi.sys` layout (game state; contains a re-strided copy of `plan`) | amiga/data-structure.md § Inventory | 2026-11-21 recon |
