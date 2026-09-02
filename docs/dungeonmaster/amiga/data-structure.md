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
| `Graphics.DAT` | Wall/UI/item bitmaps, `DMCSB1` container + `IMG1` codec | **confirmed**, 683/683 image items decode with 0 residue |
| `TITL.DAT` | Title screen | not decoded (likely `IMG1`/`IMGx`, same container — not attempted this pass) |
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
candidates (header `width*height` in `[1,40000]`). All 683 decode under
`IMG1` with 0 residue. Exported as a greyscale-ramp atlas (real pixel
*indices*, palette not yet recovered — see the shared doc):
`public/assets/dungeonmaster/amiga/sprites/graphics-sample.png` +
`.json` sidecar (400-item sample of the 683; every item decodes cleanly per
the extractor's self-check, the cap is only to keep the shipped PNG a
reasonable size).

**Rendered, unmistakably real content** (visually confirmed): "The End"
title text, a legible on-screen alphabet keyboard/name-entry UI, champion
portrait thumbnails (a row of distinct character faces), health/food/water
status icons with "FOOD WATER POISONED" text, brick and stone wall textures,
staircases, wooden doors, torches, weapon icons, and a compass/direction
indicator.

## TODO

See `docs/dungeonmaster/TODO.md`.
