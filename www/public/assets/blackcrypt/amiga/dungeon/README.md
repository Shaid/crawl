`slots.json` is a hand-transcription of the front-wall/side-wall placement
tables confirmed in `docs/blackcrypt/amiga/data-structure.md` (M1 of the
walker plan) — a later milestone (Phase C, `scripts/export_dungeon_slots.py`)
replaces it with a script-generated version that re-verifies every value
against the raw blit descriptors in `bcdft_decompressed.bin` instead of a
manual transcription.

`semantics.json` (M3, `scripts/export_dungeon_semantics.py`) binds
`wallFlags` bit values to movement/sight behaviour; `confidence: 'confirmed'`
since the movement state machine and `scripts/automap_tiles.py` both
independently read the same bits and agree.

`bindings.json` (M3) is hand-authored config, not extracted game data — the
default WASD+QE positional key bindings (`@seer/dungeon`'s
`DEFAULT_BINDINGS`). Edit it directly to prove rebinding works from config.
