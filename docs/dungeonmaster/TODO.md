# Dungeon Master (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm1-palette | open | Dungeon-view palette is SOLVED (see data-structure.md § Viewport composition). Remaining: the other screen palettes (inventory/UI/entrance/title/credits `0xf54`; `PL` chunks in `AN` files) and (all six dungeon-view light levels are now read from `KAOS.FTL` A5-0x36BA, 2026-11-22) | `docs/dungeonmaster/amiga/data-structure.md` § "Palette (dungeon view)" | 2026-11-21 walker |
| dm1-titl-dat | open | Decode `TITL.DAT`: it is an `AN`-chunk tagged stream (`AN 0140 00C8 0004`; tags BR/P8/PL/SD/SF/MF/EN/SO; PL = 16-colour palette), NOT a DMCSB/IMG1 container; resolve chunk length semantics, shared with CSB TITL/ENDA/ANIM and DM2 | `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" | 2026-11-18 audit-apply |
| dm1-walker-ornaments | open | Walker draws walls/doors/stairs/pits only. Missing: wall/floor/door ornaments (switches, alcoves, torches), objects, creatures, projectiles, teleporter field, door buttons, destroyed-door mask, the per-frame random door flip (K+0x13F50), the far-side pit item 49 (not shipped), light-level switching by torch state; sensors/buttons/pressure plates (so doors only open via the F key) | `docs/dungeonmaster/amiga/data-structure.md` § "Viewport composition" | 2026-11-21 walker |
| dm1-stairs-facing | solved | Taken from the game (2026-11-22): the party lands on the destination stairs square, facing per K+0x5C6A; pit falls keep facing and chain (K+0x18FA8). Remaining walker gaps: turning while on stairs takes them in the game (K+0x1CD5C) but only turns in the walker; creatures blocking a step (K+0x6CF4) | `docs/dungeonmaster/amiga/data-structure.md` § "Viewport composition" | 2026-11-22 walker rewrite |
| dm1-teleporters | open | Teleporter squares are walkable no-ops in the walker (records not parsed: target map/x/y/direction) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-11-21 walker |
| dm1-object-item-lists | open | Parse per-map object/door/teleporter/text/sensor/creature/item lists (documented in the shared spec, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
| dm1-music-sfx | deferred:out-of-scope | Audio: lead — `Graphics.DAT` items 671-748 are length-prefixed non-image data, several with PCM-like lag-1 correlation (675, 687, 711, r1 0.90-0.96), so sound probably lives there (see `dm-graphics-nonimage-items`) | `docs/dungeonmaster/amiga/data-structure.md` § "`Graphics.DAT`" | 2026-11-18 audit-apply |
| dm-graphics-nonimage-items | open | Classify DM1/CSB `Graphics.DAT` non-image items 671-748 (~60, length-prefixed; item 694 starts "COMPAS"; possible PCM samples). Also quantify DM1-vs-CSB: 669/749 byte-identical, 80 differ | `docs/dungeonmaster/amiga/data-structure.md` § "`Graphics.DAT`" | 2026-11-18 audit-apply |
