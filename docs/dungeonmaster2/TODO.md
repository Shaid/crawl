# Dungeon Master II: Skullkeep (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster2/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm2-palette | open | Recover the real Amiga palette(s) — all `IMGx` output ships as greyscale-ramp placeholder; the fan-analysis source names several scene-dependent palette tables as a lead but none located in this corpus's executable yet | `docs/dungeonmaster-format.md` § "Palette — open" | 2026-09-02 game-re |
| dm2-img8-differential | open | Decode the `IMG7`/`IMG8` differential/overlay image sub-format (~11% of `GRAPHICS.DAT`'s image-shaped items; 5-nibble palette + cross-image compositing, base `IMG4` grammar already confirmed) | `docs/dungeonmaster2/amiga/data-structure.md` § "Open: the differential/overlay sub-format" | 2026-09-02 game-re |
| dm2-p41a-music-earcheck | open | P41A music decoder solved and shipped (10/10 files, quantitative RMS+autocorrelation audio-quality check passing); not yet verified by ear — no audio player available in this environment | `docs/dungeonmaster2/amiga/data-structure.md` § "music/*.MOD — actually P41A-packed" | 2026-09-02 game-re |
| dm2-sample-palette-iff | open | Parse `sample_palette.IFF` via `@seer-project/iff` and confirm/apply it against the `IMG4` render | `docs/dungeonmaster2/amiga/data-structure.md` § "Files" | 2026-09-02 game-re |
| dm2-raw1-non-image-items | open | Classify the ~2,367 `GRAPHICS.DAT` items that aren't image-shaped candidates at all (per the primary docs' item-type table: `SND5`×107, `TXT2`×1, `FNT1`×1, and the bulk `RAW1` remainder not yet cross-checked against real content) | `docs/dungeonmaster2/amiga/data-structure.md` § "The image codec is NOT IMG1" | 2026-09-02 game-re |
| dm2-object-item-lists | open | Parse per-map object/door/teleporter/text/sensor/creature/item lists (shared dungeon-file format, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
