# Crystal Dragon (Amiga) — open work

Single status surface. Spec: `docs/crystaldragon/amiga/data-structure.md`.
Plan: `docs/crystaldragon/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| cd-sa-codec | open | Decode `SA`/`SP`/`SC` (context-modelled planar image codec, `Unpack` `+0x86`/`+0x296`) by emulating hunk 0 `+0x0004` | data-structure.md § "`.SCR` graphic sets" | 2026-11-21 recon |
| cd-sq-codec | open | Decode `SQ` (`01`/`06`/`0b`; backward bit-stream + delta mode 1-3, `+0x746`) and identify the content | data-structure.md § "Container / compression layer" | 2026-11-21 recon |
| cd-palette | open | Locate the dungeon/UI palette(s): no `SC` file ships | plan.md § Phase 2 | 2026-11-21 recon |
| cd-map-grid | open | Cell `word0` type/flag semantics beyond `&7` (bit 7, high bits, words 1-3); what the region `id`/`x0,y0` mean (area ids vs world offset); `15c` ring level check | data-structure.md § "Level maps" (region table solved 2026-11-21) | 2026-11-21 game-re |
| cd-level-ids | open | What are ids `level*9+0xCD … +0xD4` (never shipped)? Save/runtime slots? | data-structure.md § "File naming" | 2026-11-21 recon |
| cd-view-slots | open | Confirm that the `.SCR` companion tables are view-slot→frame/x/y tables and map each SA id to its `.SCR` name | data-structure.md § "First-person view" | 2026-11-21 recon |
| cd-level-objects | open | Decode the level file's `0x0B00`–`0x2B00` 32-byte record lists and the `0xB140` tail | data-structure.md § "Level maps" | 2026-11-21 recon |
| cd-audio | open | SFX `88`–`91` (id+length+PCM?) and `12` (music?) | data-structure.md § "Raw (unpacked) files" | 2026-11-21 recon |
| cd-overlays | open | Roles of overlays `0a`, `c0`, `c1` and their embedded `SF`/`SA` blocks | data-structure.md § "Executables" | 2026-11-21 recon |
