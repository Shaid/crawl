# Dungeon Master II: Skullkeep (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster2/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm2-viewport-objects | open | Viewport draws floor/ceiling, walls and closed door panels only. Still to port from SKUL.FTL: door frames/pillars + roof slits (door tile CODE+0x17c50 switch, frame tables near A5-0x4164), door ornaments and the D0 (on-the-door) panel (stretch 0x71), stairs (classes 0x12/0x13), pits, wall/floor ornaments (categories 9/10, ornament class table A5-0x409e), outdoor sky/environment (category 0x17/23), items, creatures (rects 5000 + cell*25 + pos) | `docs/dungeonmaster2/amiga/data-structure.md` § "Viewport" | 2026-11-21 walker |
| dm2-viewport-lighting | open | Only palette bank 0 (full light) is used; the wallset `D=9` items hold 6 banks (light levels / distance fade?) -- find the Amiga code that picks the bank | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` codec" | 2026-11-21 walker |
| dm2-palette-amiga-load | open | Palette = nibble -> 16-entry IRGB `D=9` bank is rendered-confirmed (title + 6 wallsets) but not traced to the Amiga palette-load code; trace it and confirm the 16-byte image trailer is unused on Amiga | `docs/dungeonmaster2/amiga/data-structure.md` § "`IMG4` codec" | 2026-11-21 walker |
| dm2-door-half-open | open | Half-open door states 1-3 (panel rect + state, horizontal-opening split at rect +6/+3) and destroyed-door mask are not drawn; the walker only toggles 0/4 | SKUL.FTL CODE+0x178d8 | 2026-11-21 walker |
| dm2-p41a-music-earcheck | open | P41A music decoder solved and shipped (10/10 files, quantitative RMS+autocorrelation audio-quality check passing); not yet verified by ear — no audio player available in this environment | `docs/dungeonmaster2/amiga/data-structure.md` § "music/*.MOD — actually P41A-packed" | 2026-09-02 game-re |
| dm2-sample-palette-iff | open | Parse `sample_palette.IFF` (320x200 4-plane ILBM, 16-entry CMAP `000000 707070 909090 703000 ...`; provenance unknown, not a retail filename) via `@seer-project/iff`; cannot be the global palette if trailers index to 255 | `docs/dungeonmaster2/amiga/data-structure.md` § "DUNGEON.DAT" (Correction) | 2026-11-18 audit-apply |
| dm2-raw1-non-image-items | open (narrowed) | The item-0 catalogue now types every item (`D`: 1 image, 2 sound, 4 rects, 5 text, 7/8 raw, 9 palette, 11 word, 12 offset, 14 remap); what is left is the meaning of the `D=7`/`D=8` raw items other than the underlay table (item 1) | `docs/dungeonmaster2/amiga/data-structure.md` § "Viewport" | 2026-11-21 walker |
| dm2-object-item-lists | open (doors + teleporters done) | Parse per-map object/door/teleporter/text/sensor/creature/item lists (shared dungeon-file format, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
| dm2-an-chunk-files | open | DM2 `TITL.DAT`/`ENDA.DAT`/`SWSH.DAT` are `AN`-chunk streams with `PL` palettes (shared with DM1/CSB, see `dm1-titl-dat`) | `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" | 2026-11-18 audit-apply |
| dm2-walker-unverified-rules | open | Walker rules still hypotheses: door state bits 0-2, trickwall open bit (attr 4), teleporter rotation + rot-type bit 12, pit falling, the 4 stairs squares (level change), sensors/buttons, outdoor handling | `docs/dungeonmaster2/amiga/data-structure.md` § "Walker findings" | 2026-11-21 walker |
