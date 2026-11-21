# Dungeon Master (Amiga) — open work

Single status surface. Format doc:
`docs/dungeonmaster/amiga/data-structure.md`. Shared container/codec doc:
`docs/dungeonmaster-format.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| dm1-palette | open | Dungeon-view palette is SOLVED (see data-structure.md § Viewport composition). Remaining: the other screen palettes (inventory/UI/entrance/title/credits `0xf54`; `PL` chunks in `AN` files) and light levels 2-5 (KAOS tables use a packed layout; shipped values are prior art, unverified) | `docs/dungeonmaster/amiga/data-structure.md` § "Palette (dungeon view)" | 2026-11-21 walker |
| dm1-titl-dat | open | Decode `TITL.DAT`: it is an `AN`-chunk tagged stream (`AN 0140 00C8 0004`; tags BR/P8/PL/SD/SF/MF/EN/SO; PL = 16-colour palette), NOT a DMCSB/IMG1 container; resolve chunk length semantics, shared with CSB TITL/ENDA/ANIM and DM2 | `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" | 2026-11-18 audit-apply |
| dm1-walker-ornaments | open | Walker draws walls/doors/stairs/pits only. Missing: wall/floor/door ornaments (switches, alcoves, torches), objects, creatures, projectiles, teleporter field, door buttons, destroyed-door mask, light-level switching by torch state; sensors/buttons/pressure plates (so doors only open via the F key) | `docs/dungeonmaster/amiga/data-structure.md` § "Viewport composition" | 2026-11-21 walker |
| dm1-stairs-facing | open | Facing/placement after taking stairs and pit falls is ScummVM's non-party rule (`getStairsExitDirection`); verify against the real game (party facing, which stairs cell you land on) | `tools/dungeonmaster/amiga/model.ts` `tryStep` | 2026-11-21 walker |
| dm1-teleporters | open | Teleporter squares are walkable no-ops in the walker (records not parsed: target map/x/y/direction) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-11-21 walker |
| dm1-object-item-lists | open | Parse per-map object/door/teleporter/text/sensor/creature/item lists (documented in the shared spec, not yet implemented in the reader) | `docs/dungeonmaster-format.md` § "Dungeon file" | 2026-09-02 game-re |
| dm1-music-sfx | deferred:out-of-scope | Audio: lead — `Graphics.DAT` items 671-748 are length-prefixed non-image data, several with PCM-like lag-1 correlation (675, 687, 711, r1 0.90-0.96), so sound probably lives there (see `dm-graphics-nonimage-items`) | `docs/dungeonmaster/amiga/data-structure.md` § "`Graphics.DAT`" | 2026-11-18 audit-apply |
| dm-graphics-nonimage-items | open | Classify DM1/CSB `Graphics.DAT` non-image items 671-748 (~60, length-prefixed; item 694 starts "COMPAS"; possible PCM samples). Also quantify DM1-vs-CSB: 669/749 byte-identical, 80 differ | `docs/dungeonmaster/amiga/data-structure.md` § "`Graphics.DAT`" | 2026-11-18 audit-apply |
