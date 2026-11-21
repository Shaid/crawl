---
title: Hired Guns — Status & Open Work
description: What is confirmed and still open for Hired Guns (Amiga) after the 2026-11-21 recon and the CD32 dev-archive fetch — 7 open TODO rows, no extractor yet.
---

Hired Guns is at **recon stage** (2026-11-21). Nothing is extracted, and no
assets are published. Three commits make up the work so far: `bf40165`, the
recon notes; `59b2d29`, which registered the title; and `6f3785e`, which
recorded the fetched DMA CD32 dev archive. No `tools/hiredguns/` directory
exists yet.

| Area | Status | Evidence |
|---|---|---|
| Packing (RNC1) | **Confirmed**: 108/108 files unpack with `ancient` at the header's size | data-structure.md § Compression layer |
| Map geometry | **Structural-confirmed**: 3 planes × 20×23×23 × 4 B at `+0x6F40`, stride `0xA8E8`; dev header `HGmapstructure.h` agrees | § Maps |
| Map cell fields | Hypothesis: plane-0 type byte, plane-1 shape index (53 values), plane 2 unknown; z direction unknown | `hg-map-planes` |
| Map header + object records | Hypothesis: 28-byte records at `+0x22EC`–`+0x65F7` | `hg-map-header-objects` |
| Briefing text | Rendered: `FB 00 yy 00 xx FC` record grammar | § Maps |
| Figure packer (31 files) | Unknown packer (`0x7790…`); ILBM + `MakeFigure/Filters` oracle on disk | `hg-gfx-packer` |
| Figure records | Hypothesis: shared header + 12-byte frame entries | `hg-figure-records` |
| First-person view | Hypothesis, medium: 4 pre-scaled depth sizes, slot blits | `hg-view-renderer` |
| Character ILBMs (12), 8SVX (9), MMD0 (6) | Standard formats, not yet wired | `hg-banks-audio-text` |
| Dev archive | Fetched 2026-11-21, not yet mined | `hg-dev-archive` |

## Open questions

- `hg-map-planes`: What do the fields of the 3 voxel planes (20×23×23×4 B at `+0x6F40`, `+0xA8E8` stride) mean, and does z index 0 sit at the top or the bottom?
- `hg-map-header-objects`: What do map header words `w0`/`w1`/`w4` hold, and what are the `+0x22EC` 28-byte object/event records that point into the map image?
- `hg-gfx-packer`: What is the custom packer behind the `0x7790…` streams in `CharactersGfx`/`MonstersGfx`, checked against the ILBMs cut by `MakeFigure/Filters`?
- `hg-figure-records`: Is there one figure-record grammar shared by `Figure.dump`, the Styles, `Misc` and `Items`, and what is it?
- `hg-view-renderer`: Which cell offsets, including z±1, draw which Style record in the first-person slot table?
- `hg-banks-audio-text`: How are the `GameFast`/`GameChip`/`ExtraSfx` offset banks, the front-end `.dat` screens and the text banks laid out?
- `hg-dev-archive`: Which of the CD32 dev archive's findings (301 source files, the map editor, the `HGmapstructure.h` cell bitfields and `keep_*` masks/shifts) hold for the floppy retail maps?

## What can be checked in-game

The plan names one screenshot for the map: map 01's start position, to confirm
the decoded cell fields and the z direction. For the view, it names one
screenshot per style (5 styles). It also names the map's own redundancy as a
check: stair and lift pairs must line up across layers. None of these checks has
been done yet.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/hiredguns/TODO.md)
for the evidence behind each row, and the [overview](../) for the formats.
