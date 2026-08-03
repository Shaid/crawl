---
title: Cross-Platform Comparison
description: How the Amiga and Windows versions differ.
---

# Cross-Platform Comparison

## Rendering differences

| Property | Amiga | Windows VGA |
|----------|-------|-------------|
| Display | EHB (64 colours) | VGA (256 colours) |
| Colour depth | 6 bitplanes | 8 bits/pixel |
| Resolution | 320×200 | 320×200 |
| Compression | RLE (custom scheme) | none (raw indexed) |
| Palette | 32 × 16-bit + half-bright | 256 × 8-bit RGB |
| Graphics API | custom blitter | DirectDraw |
| Audio | 4-channel Paula | DirectSound |

## File size comparison

| Data type | Amiga source | Amiga size | Windows source | Windows size |
|-----------|--------------|------------|----------------|--------------|
| Dungeon maps | `bcdfs` | 171,005 B | `maindung.gam` | 15,099 B |
| All resources | `bcdfa`–`bcdfz` | ~3.5 MB | `clipper.clp` | 1,151,267 B |
| Executable | `BlackCrypt` + overlays | ~600 KB | `crypt.exe` | 253,952 B |

The Windows demo contains only 2 maps (vs 13 in the full game), explaining the
small `maindung.gam`.

## Resource mapping

The Amiga stores resources across 26 `bcdf*` files; the Windows version
consolidates most into `clipper.clp`. The mapping is **not 1:1** — the Windows
version has 751 images and 22 sounds vs the Amiga's distributed structure.

## The dungeon map format is identical

`maindung.gam` is **structurally identical** to the Amiga `bcdfs`, differing
only in CPU endianness:

| | Amiga | Windows |
|---|-------|---------|
| Offset table | Map 1 = `0x00000000`, Map 2 = `0x00003AC7` | identical |
| Map 1 header | `00 00 00 00 1d 00 39` | byte-identical |
| Square data | big-endian | little-endian |

A square `0x00001FF1` is stored as `00 00 1F F1` on the Amiga but `F1 1F 00 00`
on Windows.