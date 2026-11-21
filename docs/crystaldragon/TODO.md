# Crystal Dragon (Amiga) — open work

Single status surface. Spec: `docs/crystaldragon/amiga/data-structure.md`.
Plan: `docs/crystaldragon/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| cd-sq-codec | open | Decode `SQ` (`01`/`06`/`0b`; backward bit-stream + delta mode 1-3, `+0x746`) and identify the content | data-structure.md § "Container / compression layer" | 2026-11-21 recon |
| cd-level-ids | open | What are ids `level*9+0xCD … +0xD4` (never shipped)? Save/runtime slots? | data-structure.md § "File naming" | 2026-11-21 recon |
| cd-level-objects | open | Decode the level file's `0x0B00`–`0x2B00` 32-byte record lists and the `0xB140` tail | data-structure.md § "Level maps" | 2026-11-21 recon |
| cd-audio | open | SFX `88`–`91` (id+length+PCM?) and `12` (music?) | data-structure.md § "Raw (unpacked) files" | 2026-11-21 recon |
| cd-overlays | open | Roles of overlays `0a`, `c0`, `c1` and their embedded `SF`/`SA` blocks | data-structure.md § "Executables" | 2026-11-21 recon |
| cd-sp-codec | open | Port the `SP`/`SC` full-screen path (`Unpack` `+0x296`; `09`, `0d`) — same token codec as `SA`, plane-sequential output; verify with `tools/crystaldragon/amiga/emu/` | data-structure.md § "`SA` codec" | 2026-11-21 walker |
| cd-palette-12-15 | open | Dungeon palette is `A5+500` (solved), but colours 12-15 are `$00F` placeholders in the exe: find what fills them (copper, per-level code) or confirm unused | data-structure.md § "First-person renderer" | 2026-11-21 walker |
| cd-cell-types | open | Trace cell types 2/3/4/6/7 (stairs, teleport, door, barrier?) and word0 bits 9-12 / byte 2 (door state, orientation bits 7-8 vs facing at `+0x1E290`); walker treats 0/2/4/6/7 as walkable, 1/3/rock as walls (hypothesis) | data-structure.md § "Level maps" Correction | 2026-11-21 walker |
| cd-doors | open | Draw door frames (slot 12, 308-B table) and doors (slots 16-19, 92-B tables): trace `LAB_16A6` `+0x1FFC8`, `LAB_16BE` `+0x20260`, `LAB_166D` `+0x1F9BC` (who picks position/frame from the door cell) | `tools/crystaldragon/amiga/view-model.ts` | 2026-11-21 walker |
| cd-occlusion | open | Walker paints back to front; port the game's visibility masks (`+0x1E3EC`…`+0x1E516`, tables `+0x21388`/`+0x21400`) and the clipped alternates (wall positions 17-38) if a live check shows differences | data-structure.md § "First-person renderer" | 2026-11-21 walker |
| cd-area-links | open | Follow stairs/teleports between areas and levels (keep absolute x/y, change area id `4310(A5)`); find the move routine and its collision rules | data-structure.md § "How the regions relate" | 2026-11-21 walker |
| cd-start-pose | open | Real start pose (level 1, area, x/y/facing) from the new-game code; walker uses the first open cell (hypothesis) | `tools/crystaldragon/amiga/export-walker.ts` `defaultStart` | 2026-11-21 walker |
| cd-walker-live-check | open | Live check of the walker against the game (see the in-game checks in the walker commit message / report) | — | 2026-11-21 walker |
| cd-pasteons | open | Wall/floor/door decorations (`PASTEONS.*`, `LOCKS.SCR`, slots 23-26, 6-byte table entries) and the object-area records they hang off | data-structure.md § "Level maps" | 2026-11-21 walker |
