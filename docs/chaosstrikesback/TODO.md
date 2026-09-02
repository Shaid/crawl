# Chaos Strikes Back (Amiga) — open work

Single status surface. Format doc:
`docs/chaosstrikesback/amiga/data-structure.md`. Shared container/codec
doc: `docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| csb-palette | open | Recover the real Amiga 16-colour palette(s) — all `IMGx` output ships as greyscale-ramp placeholder | `docs/dungeonmaster-format.md` § "Palette — open" | 2026-09-02 game-re |
| csb-mini-dat-saved-state | open | Decode the rest of `MINI.DAT`'s saved-game envelope (character stats, inventory, position, Block1/2/3 encryption) — only the plaintext Dungeon Data section is decoded | `docs/chaosstrikesback/amiga/data-structure.md` § "Main CSB dungeon" | 2026-09-02 game-re |
