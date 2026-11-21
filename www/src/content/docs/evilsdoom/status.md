---
title: Evil's Doom — Status & Open Work
description: What is confirmed, rendered and still open for Evil's Doom (Amiga AGA) after the 2026-11-21 recon — 10 open and 1 deferred TODO rows, no extractor yet.
---

Evil's Doom is at **recon stage** (2026-11-21). Nothing is extracted, and no
assets are published. Two commits make up the work so far: `db49d43`, the
recon notes, and `59b2d29`, which moved the data and registered the title. No
`tools/evilsdoom/` directory exists yet.

| Area | Status | Evidence |
|---|---|---|
| Packing (RNC1 + CrM2) | **Confirmed**: 236/236 files unpack with `ancient`, 14.8 MB out | data-structure.md § Layer 0 |
| Depack pipeline step | Open: no `build/cache/evilsdoom/` step yet | `evilsdoom-scaffold` |
| Dungeon grid | **Rendered**: 30×30 × 1 B, bit 7 = solid, in all 5 dungeons | § Dungeon maps |
| Grid record framing | Hypothesis: at least 6/10/4/9/5 grids per file (BEL/CLL/IOW/MIN/MYT), pre-grid word lists unexplained | `evilsdoom-map-record` |
| View slot table | Strong hypothesis: self-consistent mirrored table at `BEL.dat+0x16834`, not rendered | `evilsdoom-view-slots` |
| Wall/door art | Structured-unknown: fixed sizes 63,072 / 26,910 / 24,536 B | `evilsdoom-wal` |
| Palette | Unknown: 256-colour AGA; source not located | `evilsdoom-wal` |
| Manual ILBMs (3) | **Confirmed** standard `FORM ILBM` | § Inventory |
| `PIC/*` (36) | Variant: headerless CMAP+BODY, codec unsettled | `evilsdoom-pic` |
| Monsters, UI, intro screens | Magic only | `evilsdoom-mon`, `evilsdoom-ui` |
| Music (31 P60A) | Sibling-solved format, not wired | `evilsdoom-music` |
| Text | Deferred until the maps are done | `evilsdoom-text` |

## Open questions

- `evilsdoom-scaffold`: When will the RNC1/CrM2 depack layer write into `build/cache/evilsdoom/`? (The data move to `data/evilsdoom/amigaaga/` and the game registration are done.)
- `evilsdoom-map-record`: How is the 15,128-byte state block framed: how many levels per file, at which grid offsets, what the pre-grid word lists hold, what each cell bit means, and where the party starts?
- `evilsdoom-newgame-state`: Which file or routine seeds a new game's dungeon state, which is copied in from `8(A6)+$EB38`?
- `evilsdoom-view-slots`: What do the fields of the 14-byte view-slot blit table at `BEL.dat+0x16834` mean, and what are the plane count and mask layout?
- `evilsdoom-wal`: Do `WAL/*.DT0`/`.DT1` and `DOR/*` render cleanly through the slot table, and where is the dungeon palette?
- `evilsdoom-eve`: What is the layout of the `EVE/*` per-level decoration banks (descriptor list + pixels) and of `.MAIN`?
- `evilsdoom-pic`: What codec and geometry does `PIC/*`'s headerless CMAP+BODY use, given that plain ByteRun1 gives inconsistent sizes?
- `evilsdoom-mon`: How are the 24 `MON/*` monster sprite banks laid out?
- `evilsdoom-ui`: How are the `DMD`/`OMD` icon, font and page banks, the `DUNDAT` panels and the `INT/*.bin` screens laid out?
- `evilsdoom-music`: Does `hunter`'s structural decode of signature-less P60A read all 31 `MUZ/P60.*` modules?
- `evilsdoom-text` (deferred until after the maps): How are `OMD/TXT.DAT` and the 44 `CT/*` text/script records encoded?

## What can be checked in-game

The plan names three oracles for the map work. The `FAQ` walkthrough and the
`Guide_*` text files describe each level and its stairs. The in-game magic map
(`M` key) shows the layout to compare against a rendered grid. For the view,
it names user screenshots. No screenshot has been compared yet.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/evilsdoom/TODO.md)
for the evidence behind each row, and the [overview](../) for the formats.
