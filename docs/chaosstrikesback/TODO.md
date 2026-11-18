# Chaos Strikes Back (Amiga) — open work

Single status surface. Format doc:
`docs/chaosstrikesback/amiga/data-structure.md`. Shared container/codec
doc: `docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| csb-palette | open | Recover the real Amiga 16-colour palette(s) — `IMGx` output ships greyscale. Lead (hypothesis): `disk1/KAOS.FTL`+0x100A table (see `dm1-palette`); `PL` chunks in TITL/ENDA | `docs/dungeonmaster-format.md` § "Palette — open" | 2026-11-18 audit-apply |
| csb-mini-dat-saved-state | open | Decode the rest of `MINI.DAT`'s saved-game envelope (character stats, inventory, position, Block1/2/3 encryption) — only the plaintext Dungeon Data section is decoded | `docs/chaosstrikesback/amiga/data-structure.md` § "Main CSB dungeon" | 2026-09-02 game-re |
| csb-disk2-support-files | open | Identify disk2 files with no row: `HCSB.DAT` (word0=5, not DMCSB), `HCSB.HTC`, `CEDTLD`/`CEDTLS.DAT`, `ANIM.DAT` (`AN`-chunk stream), `Portrait/`, `Sound/`, `MIDI/` | `docs/chaosstrikesback/amiga/data-structure.md` § "Main CSB dungeon" | 2026-11-18 audit-apply |
