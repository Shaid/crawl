---
title: "Liberation: Captive II — Status & Open Work"
description: "What is solved and what remains open for Liberation: Captive II (CD32): generator-built maps, AmSp wall banks, O3DG vectors."
---

As of 2026-11-21 there has been one recon pass (commit `ddd5759`). No
extractor has been committed and no assets are published. The raw ledger is
[`docs/liberation/TODO.md`](https://github.com/Shaid/crawl/blob/main/docs/liberation/TODO.md).
The [overview](../) has the evidence behind each row.

| Area | Status | Evidence |
|---|---|---|
| Map generation (CityGen / BuildingGen / PlotGen) | Entry, parameter block and the `world·16 + zone` LCG seed **confirmed** from disassembly. Not yet run | `data-structure.md` § "1. How is the map stored?" |
| Grid format (3 × 4,096-B planes, 64×64 per zone) | Strong hypothesis; wall encoding unknown | same |
| `AmSp` wall banks (71 `.VGM` + `gamemenu.spr`) | Container **confirmed** 72/72; 4 banks / 152 sprites in 71/71 files; mask-last plane order confirmed (0 violations) | § `AmSp` |
| Wall-bank loader | **Confirmed** at `captiveII +0x250D6` / `+0x251DE` | § "2. How is the first-person view drawn?" |
| View slot table and wall palette | Not found | § `AmSp` |
| `FORM O3DG` / `VCDO` vectors (38 + 2 files) | IFF tiling **confirmed**; chunk contents undecoded | § `FORM O3DG` |
| `ImgA` sprite banks (5 files) | Offset tables read; entries undecoded | § `ImgA` |
| Audio (8SVX), animation (RNC2 ANIM), text | Standard formats identified; not exported | § Audio, Animation, Text |
| Walker | Not started. Blocked on `lib-gen-harness` and `lib-gen-grid-format` | `plan.md` Phase 1 |

## Open questions

- `lib-gen-harness`: Does running CityGen/BuildingGen under the 68k harness,
  given a parameter block for `(world, zone)`, produce the three 4 KB grid
  planes, byte-identical on a second run?
- `lib-gen-grid-format`: What do the 3 byte planes encode (64×64 for the city,
  variable width for interiors)? Are walls stored per cell, on shared edges, or
  derived from cell type?
- `lib-world-seed-origin`: Where is the 14-bit `world` word at `A5+0x626C`
  first set? Is it fixed per level, or random for each new game?
- `lib-vgm-slot-table`: Which view slot does each of the 152 VGM pieces (in 4
  banks) fill? Where is the renderer that `captiveII +0x251DE` leads to?
- `lib-vgm-palette`: Where is the 16-colour palette for the 4-plane wall art?
  Is `gamemenu.spr`'s 32-word trailer really its palette?
- `lib-city-view-mix`: Is the outdoor city drawn with vectors only, or with VGM
  pieces plus vector buildings?
- `lib-o3dg-chunks`: What do the `FORM O3DG`/`VCDO` chunks `OFFS`, `EXVL`,
  `PLST`, `VSPR` and `VFTX` contain?
- `lib-imga`: How are the `ImgA` entries in `MainSp`, `3dView`, `taxi` and
  `backpack` laid out?

## What you can check in-game

The raw notes list no in-game checks. The plan names two oracles that need the
game running: a user screenshot to fix the wall colours (`lib-vgm-palette`),
and the in-game map, to check a generated zone against
(`lib-gen-grid-format`).
