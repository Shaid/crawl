# Dungeon Master (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm1-palette | open | Recover the real Amiga 16-colour palette(s) — all `IMGx` output ships as greyscale-ramp placeholder | `docs/dungeonmaster-format.md` § "Palette — open" | 2026-09-02 game-re |
| dm1-titl-dat | open | Decode `TITL.DAT` (title screen) — same container family, not attempted this pass | `docs/dungeonmaster/amiga/data-structure.md` § "Files" | 2026-09-02 game-re |
| dm1-object-item-lists | open | Parse per-map object/door/teleporter/text/sensor/creature/item lists (documented in the shared spec, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
| dm1-music-sfx | deferred:out-of-scope | Any audio format used by this release (not investigated — no `.MOD`/sample files evident in this corpus's file listing, unlike DM2) | `docs/dungeonmaster/amiga/data-structure.md` § "Files" | 2026-09-02 game-re |
