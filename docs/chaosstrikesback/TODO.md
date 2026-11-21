# Chaos Strikes Back (Amiga) — open work

Single status surface. Format doc:
`docs/chaosstrikesback/amiga/data-structure.md`. Shared container/codec
doc: `docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| csb-palette | open | Dungeon-view palette 0 SOLVED (`disk1/KAOS.FTL`+0x100A, 16/16 = DM's). Remaining: other screen palettes, light levels 2-5 | `docs/dungeonmaster/amiga/data-structure.md` § "Palette (dungeon view)" | 2026-11-21 walker |
| csb-walker-gaps | open | CSB walker is DM's compositor on CSB maps: items 49-125/246-257/696 are byte-identical to DM so walls/doors/stairs/pits are the same art; CSB-specific wall sets/ornaments/objects/creatures, teleporters, sensors are not drawn. Prison = maps 100/101, main = 0-10 from the disk2 `MINI.DAT` save (its start pose is not the saved game's party position) | `docs/dungeonmaster/TODO.md` (`dm1-walker-ornaments`) | 2026-11-21 walker |
| csb-mini-dat-saved-state | open | Decode the rest of `MINI.DAT`'s saved-game envelope (character stats, inventory, position, Block1/2/3 encryption) — only the plaintext Dungeon Data section is decoded | `docs/chaosstrikesback/amiga/data-structure.md` § "Main CSB dungeon" | 2026-09-02 game-re |
| csb-disk2-support-files | open | Identify disk2 files with no row: `HCSB.DAT` (word0=5, not DMCSB), `HCSB.HTC`, `CEDTLD`/`CEDTLS.DAT`, `ANIM.DAT` (`AN`-chunk stream), `Portrait/`, `Sound/`, `MIDI/` | `docs/chaosstrikesback/amiga/data-structure.md` § "Main CSB dungeon" | 2026-11-18 audit-apply |
