# Dungeon Master (Amiga) — data structure

FTL Games, 1987 (this corpus: the Amiga release). Source data:
`data/dungeonmaster/amiga/` (copied from `data/_unexplored_/DungeonMaster/`).

Shared container/codec formats (data-file container, `IMGx` pixel codec,
dungeon compression, dungeon-file layout) are documented once in
[`docs/dungeonmaster-format.md`](../../dungeonmaster-format.md) — this file
only covers what's specific to this game's files.

Shared code: `tools/shared/dungeonmaster-{container,codec,dungeon,render}.ts`.
Extractor: `tools/dungeonmaster/amiga/export-data.ts`.

## Files

| File | Role | Status |
|---|---|---|
| `Dungeon.DAT` / `DungeonF.DAT` / `DungeonG.DAT` | English/French/German dungeon (14 maps each) | **confirmed**, decoded end-to-end |
| `Graphics.DAT` | Wall/UI/item bitmaps, `DMCSB1` container + `IMG1` codec | **confirmed** by exact stream consumption: 687 image items (not 683; see Correction in § `Graphics.DAT`) |
| `TITL.DAT` | Title screen | not decoded. **Correction (2026-11-18):** not a DMCSB container; an `AN`-chunk tagged stream (`AN 0140 00C8 0004`, tags `BR`/`P8`/`PL`/`SD`/...; `PL` = 16-colour palette). See `docs/dungeonmaster-format.md` § "FTL `AN`-chunk animation files" |
| `ANIM.FTL`, `APPA.FTL`, `APPB.FTL`, `CNFG.FTL`, `GRF1.FTL`, `KAOS.FTL`, `MEM1.FTL`, `SWSH.FTL`, `USIO.FTL`, `VDEO.FTL` | Executable overlay/code segments (`.FTL` = FTL's own loader convention, not a data container) | not investigated — code, out of scope for this pass |
| `BJELoad_R` | Boot loader | not investigated |
| `save/` | Saved games | not investigated (see the shared doc's "Saved Game Files" citation, used for CSB instead since DM1 didn't need it) |

## Dungeon files

All three (`Dungeon.DAT`/`DungeonF.DAT`/`DungeonG.DAT`) are stored
**compressed** (`0x8104` signature — see the shared doc). Each decompresses
to exactly its header-declared `uncompressedSize` with 0 deviation, and
parses to **14 maps** each under the shared dungeon-file reader.

Exported: `public/assets/dungeonmaster/amiga/data/dungeon-{en,fr,ge}.json`
(full header + per-map definitions + square-type grid), plus one top-down
PNG per map per language variant under
`public/assets/dungeonmaster/amiga/screens/{en,fr,ge}-mapNN-lvlL.png`
(42 PNGs total). **Rendered**: every map is a visually coherent maze
(connected corridors, enclosed rooms, isolated door/stair/teleporter
markers) — see the shared doc's verification section.

The English/French/German files are independent dungeon-data copies (same
maps, localisation lives in the separate text-list section this reader
doesn't parse) — not byte-identical, but structurally identical (same
`mapCount=14`, same per-map dimensions/levels observed while spot-checking).

## `Graphics.DAT`

`DMCSB2` container (`0x8001` signature — the same container variant used by
CSB's `disk1/Graphics.DAT`, not the signature-less `DMCSB1` shape an earlier
pass of this doc incorrectly assumed by community-docs analogy rather than
real bytes), **749** total items, of which **683** are image-shaped
candidates (header `width*height` in `[1,40000]`). Exported as a greyscale-ramp atlas (real pixel
*indices*, palette not yet recovered — see the shared doc):
`public/assets/dungeonmaster/amiga/sprites/graphics-sample.png` +
`.json` sidecar (400-item sample of the 683; every item decodes cleanly per
the extractor's self-check, the cap is only to keep the shipped PNG a
reasonable size).

> **Correction (2026-11-18):** the "683 image items, 0 residue" statement was
> circular (the test asserted `pixels.length === w*h`, true by construction)
> and the size-filter classifier was wrong in both directions. By exact stream
> consumption there are **687** images: item 672 (header "130x11") is a
> length-prefixed data item and is excluded; five full screens (items 1, 4, 5,
> 728, 738; 320x153/320x200) were dropped by the `w<=350, h<=220` filter and
> are now included. Items 671-693 (and ~60 items 671-748) are length-prefixed
> non-image data (several with PCM-like lag-1 correlation: items 675, 687, 711,
> r1 0.90-0.96; item 694 starts "COMPAS"); sound may live there, contrary to
> `dm1-music-sfx`'s "no sample files evident" (tracked as
> `dm-graphics-nonimage-items`). See `docs/dungeonmaster-format.md`. The
> shipped atlas now uses `isImg1Image`.

**Rendered, unmistakably real content** (visually confirmed): "The End"
title text, a legible on-screen alphabet keyboard/name-entry UI, champion
portrait thumbnails (a row of distinct character faces), health/food/water
status icons with "FOOD WATER POISONED" text, brick and stone wall textures,
staircases, wooden doors, torches, weapon icons, and a compass/direction
indicator.

## Viewport composition (walker, 2026-11-21)

> **Correction (2026-11-21):** `Graphics.DAT` here is **DOS-numbered**, not
> the ST/"Amiga" numbering ScummVM's non-DOS path assumes. Evidence: item
> dims match the DOS tables (floor 78 = 224x97, ceiling 79 = 224x39, which sum
> to the 136-row viewport; wall set 86-107; stairs 108-125; door sets 246-257
> = 44x38 / 64x61 / 96x88 per set; pits 50-69, centre-pit widths increase
> D3C 64 < D2C 92 < D1C 139 < D0C 170 under the +1 DOS shift). **confirmed**
> (dimension fit across ~110 items; the ST numbering fails on item 77/86).

* **Item 696 = zone layout** (`0xFC0D` magic, big-endian here): 23 ranges,
  1,135 x 8-byte records `{type,parent,d1,d2}`; consumed bytes == item
  length (9,176/9,176). Zones 700-749 viewport, 800-833 stairs, 850-872 pits,
  3700-3809 door frames. Resolved by `getCoord`
  (`tools/dungeonmaster/amiga/viewport.ts`, port of ScummVM
  `DisplayMan::getCoord`). **confirmed** structurally; placement **rendered**.
* Compositor: `viewport.ts` (ScummVM `engines/dm/gfx.cpp` DOS path). Draw
  order D3L2/R2 walls, then D3 L/R/C, D2L2/R2, D2, D1, D0. Mirror parity
  `(x+y+dir)&1` flips floor/ceiling/walls (the original's anti-tiling trick).
  Doors: closed = zone base; vertical partial states = base+state;
  horizontal = left base+3+state, right base+6+state (**rendered**: iron door
  splits correctly, portcullis rises correctly). Transparent key = colour 10.
* Map model (`model.ts`): DM's type-derived squares converted on import to
  per-cell faces (0 open, 1 solid, 2 door edge, 3 stairs edge, 4 side of
  door/stairs). Oracle: faces symmetric across every shared edge on 14/14 DM
  maps, CSB 11 + 2 (the check initially caught a door/stairs ordering bug;
  null control = a flipped face is detected). Every door square resolves to a
  door record via the object list / `next` chain (`resolveDoors`; 14/14 maps
  count-equal).
* **Palette (dungeon view)** — **confirmed**: `KAOS.FTL`+0xFBC holds the
  16-word table `0000 0666 0888 0620 00CC 0840 0080 00C0 0F00 0FA0 0C86 0FF0
  0444 0AAA 000F 0FFF`, identical (16/16) to ScummVM's
  `G0021_aaui_Graphic562_Palette_DungeonView[0]` (independent source); also
  at +0x79A/+0x7BC; CSB `disk1/KAOS.FTL`+0x100A is the same. Variant 1
  (+0xFDE) matches 15/16; variants 2-5 are stored packed and are used from the
  prior art unverified. Rendered frames show DM's grey stone, brown stair
  rails, grey portcullis (`build/cache/dungeonmaster/walker-frames/`).
  Credits palette also located at `KAOS.FTL`+0xF54.
* CSB: items 49-125, 246-257 and 696 are byte-identical to DM's
  (80 of 749 items differ overall, none in these ranges).
* Not drawn: see `dm1-walker-ornaments`.

## TODO

See `docs/dungeonmaster/TODO.md`.
