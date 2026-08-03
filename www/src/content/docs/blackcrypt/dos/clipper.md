---
title: clipper.clp — Resource Archive
description: The Windows version's consolidated resource archive format.
---

# `clipper.clp` — Resource Archive

`clipper.clp` (1,151,267 bytes) is the Windows version's resource archive. It
uses a simple **directory + raw data** layout:

```
[2 bytes]  entry count (uint16 LE) → 816
[816 × 56 bytes]  directory entries
[raw data...]
```

## Directory entry (56 bytes)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0x00 | 40 | char[] | null-terminated name string |
| 0x28 | 1 | uint8 | entry type |
| 0x2A | 4 | uint32 | data size (bytes) |
| 0x2E | 4 | uint32 | data offset (from file start) |
| 0x34 | 2 | uint16 | width (images only) |
| 0x36 | 2 | uint16 | height (images only) |

## Entry types

| Type | Count | Description |
|------|-------|-------------|
| 0x01 | 34 | Markers (separator/navigation entries) |
| 0x02 | 751 | Images (raw 8-bit indexed, no compression) |
| 0x03 | 7 | Palettes (256 × 3 bytes RGB, 768 bytes) |
| 0x04 | 22 | Sound effects (raw IFF or WAV) |
| 0x05 | 2 | Speed effects (unknown format) |

## Image format

Images are raw indexed pixels — 1 byte per pixel, dimensions stored in the
directory, no compression. The palette is chosen by image-name context.
Transparency uses two known background colours (brown `95,67,51` and cyan
`0,255,255`), detected and made fully transparent.

## The marker brackets

The 35 type-`0x01` marker entries form 17 `Start X` / `End X` brackets, and
`crypt.exe` looks those bracket names up **by string** at runtime — so they're
the game's own resource taxonomy, not incidental separators. Every one of the
505 unnamed image entries falls inside a bracket:

| Bracket | Entries | Geometry |
|----------|---------|---------|
| Speed Graphics | 73 | all 16×16 (spell effects) |
| Faces | 8 | 4 × 111×90, 4 × 31×24 |
| Keys | 29 | all 8×14 |
| Key Holes | 87 | 29 each of 16×20 / 16×15 / 16×11 |
| Throwing Items | 12 | 4 weapons × 3 depths |
| Items | 175 | all 24×24 |
| Misc | 5 | all 24×24 |
| Chest | 19 | all 32×29 (chest armour) |
| Floor Items | 147 | 49 groups × 3 depths |
| Monsters | 14 | mixed |

## The marker brackets map to the Amiga

Several brackets are byte-exact matches to Amiga banks:

- **Keys** (29) = the Amiga `bcdfa` key-icon bank.
- **Key Holes** (87) = the Amiga `bcdfb`–`bcdfn` wall-decoration bank.
- **Floor Items** (147) = the Amiga `bcdfa` floor-item bank.
- **Speed Effects** (73) = the Amiga BCSPEED spell-effect atlas.
- **Throwing Items** (Arrow + Dagger) = the Amiga `bcdfa` throwing-projectile
  bank — but **Sword and Hammer are DOS-exclusive** projectiles the Amiga never
  had.

## Palettes

Seven palettes, each 768 bytes (256 × RGB):

| Palette | Usage |
|---------|-------|
| Palette | default/dungeon rendering |
| Automap Palette | automap view |
| Character Gen Palette | character generation screen |
| Options Palette | options/UI screens |
| Title Palette / 2 / 3 | title screen variants |

The DOS **Character Gen Palette** *is* the Amiga chargen palette, re-scaled —
both store the same 4-bit component `n`; Amiga renders it `n × 17`, DOS `n × 16`
(94/96 components match).