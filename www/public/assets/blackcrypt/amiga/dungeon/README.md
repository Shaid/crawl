`slots.json` is a hand-transcription of the front-wall/side-wall placement
tables confirmed in `docs/blackcrypt/amiga/data-structure.md` (M1 of the
walker plan) — a later milestone (Phase C, `scripts/export_dungeon_slots.py`)
replaces it with a script-generated version that re-verifies every value
against the raw blit descriptors in `bcdft_decompressed.bin` instead of a
manual transcription.
