---
title: "Perihelion — Status & Open Work"
description: What is solved and what is open for Perihelion (Amiga) — recon only; naming and overhead maps confirmed, dungeon grid, slot table and palettes open.
---

Recon only: no extractor is committed and no assets are published. Source:
[`docs/perihelion/TODO.md`](https://github.com/Shaid/crawl/blob/main/docs/perihelion/TODO.md).

| Area | Status | Evidence |
|---|---|---|
| File naming (`Table.Dat`) | **Confirmed.** 99 records; 96 map 1:1 to the 96 files, 0 orphans | data-structure.md § File naming scheme |
| Packing | **Confirmed** depacked by the installer (14/15 MODs close exactly); 1 self-packed picture remains | same |
| MOD / 8SVX / ANIM / ILBM | Standard formats, not yet extracted | `peri-audio` |
| Overhead maps + tilesets | **Confirmed** (structural): 16/16 maps fit 6/6 tilesets; seam continuity 0.59–0.65 vs 0.35 null | § Overhead maps |
| Portraits and location pictures | Geometry rendered (28 × 112×150×5, 6 × 240×130×5); not extracted | `peri-pictures` |
| Wall atlases | Rendered (4 × 352×364×5) | § Wall atlases |
| Palettes | Open; not searched | `peri-palette` |
| Dungeon grid | Candidate span only (main program `+0x72D80`–`+0x73DC0`) | `peri-dungeon-grid` |
| First-person slot table | Not found | `peri-view-slots` |

## Open questions

- `peri-scaffold`: Does a `Table.Dat` parser label all 96 files by disk, track and type? (The data move and game registration are done.)
- `peri-audio`: Do the 15 MODs (with `map.wind` split at 8,758), 13 8SVX and the IFF ANIM/ILBM banks extract cleanly through the standard packages?
- `peri-palette`: Where are the tile, wall and picture palettes — `$0RGB` tables in the main program, or the two 112×150 CMAPs at `+0x32A9A`/`+0x33AFE` for the portraits?
- `peri-overhead-maps`: Can the 16 overhead maps and 6 tilesets be promoted from structural probe to a committed extractor, in colour once a palette exists?
- `peri-pictures`: Do the 28 portraits (112×150×5) and 6 location pictures (240×130×5) extract row-interleaved as rendered?
- `peri-dungeon-grid`: Does the main-program span `+0x72D80`–`+0x73DC0` hold the dungeon grids, how does the preceding record table give each map's width, and is wall storage type-derived?
- `peri-view-slots`: Where is the piece-rectangle/slot table that blits the 352×364 wall atlases into the first-person view?
- `peri-selfpacked`: Which `Boot.Exe` routine depacks `005810FA00005344` (40,000 unpacked / 21,315 packed)?
- `peri-misc-banks`: What are the `0277022E…` SFX bank, the `map.wind` tail, `01461308…`, `00770EA4…`, `022917F6…`, `00020000…` and `01640A96…`?

## Checking in-game

`peri-ingame-check` is **blocked on user screenshots**: one overhead town and
one dungeon view (the Watchtower Colony start) would confirm the palette and the
slot placement.

Full evidence: [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/perihelion/TODO.md).
