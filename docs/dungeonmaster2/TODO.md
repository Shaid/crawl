# Dungeon Master II: Skullkeep (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster2/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm2-palette | open | Recover the real palette mechanism: not a 16-colour table — each `IMG4` item ends in a 16-byte trailer (values to 0xFF; hypothesis: per-image 16->256 colour map); also `PL` chunks in `SWSH`/`ENDA.DAT` and scene tables named by the fan analysis | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` confirmed instead" (Correction) | 2026-11-18 audit-apply |
| dm2-img8-differential | open | Grammar is solved (5-/6-nibble palette + run stream + 16-byte trailer tile 2,260/2,263). Open: meaning of selector 5 in the 5-nibble variant (727 items; compositing source?), which base image it composites over, and the 5-vs-6 variant flag (179 items tile both ways) | `docs/dungeonmaster2/amiga/data-structure.md` § "Open: the differential/overlay sub-format" | 2026-11-18 audit-apply |
| dm2-p41a-music-earcheck | open | P41A music decoder solved and shipped (10/10 files, quantitative RMS+autocorrelation audio-quality check passing); not yet verified by ear — no audio player available in this environment | `docs/dungeonmaster2/amiga/data-structure.md` § "music/*.MOD — actually P41A-packed" | 2026-09-02 game-re |
| dm2-sample-palette-iff | open | Parse `sample_palette.IFF` (320x200 4-plane ILBM, 16-entry CMAP `000000 707070 909090 703000 ...`; provenance unknown, not a retail filename) via `@seer-project/iff`; cannot be the global palette if trailers index to 255 | `docs/dungeonmaster2/amiga/data-structure.md` § "DUNGEON.DAT" (Correction) | 2026-11-18 audit-apply |
| dm2-raw1-non-image-items | open | Classify GRAPHICS.DAT items that are not plausible IMG4 images: count is smaller than the old ~2,367 (~751 tile as images once width/height top 6 bits are masked); rest SND5x107/TXT2/FNT1/other | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` confirmed instead" (Correction) | 2026-11-18 audit-apply |
| dm2-object-item-lists | open | Parse per-map object/door/teleporter/text/sensor/creature/item lists (shared dungeon-file format, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
| dm2-gfx-dimension-flags | open | Width/height words carry flags in their top 6 bits (~751 items tile exactly once masked: 533 six-nibble, 218 five-nibble); decode the flag meanings and add them to the decoder gate | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` confirmed instead" (Correction) | 2026-11-18 audit-apply |
| dm2-gfx-item0-index | open | GRAPHICS.DAT item 0 (80,380 B) begins `0x8001`; likely a nested index/descriptor table | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` confirmed instead" (Correction) | 2026-11-18 audit-apply |
| dm2-an-chunk-files | open | DM2 `TITL.DAT`/`ENDA.DAT`/`SWSH.DAT` are `AN`-chunk streams with `PL` palettes (shared with DM1/CSB, see `dm1-titl-dat`) | `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" | 2026-11-18 audit-apply |
