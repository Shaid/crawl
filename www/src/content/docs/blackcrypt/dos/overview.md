---
title: DOS Version — Overview
description: The Windows VGA port and its data files.
---

# The Windows VGA Port

Black Crypt was ported to Windows by Rick Johnson starting October 21, 1995,
using DirectX 3.0 (GameSDK). The Windows version uses DirectDraw for graphics
and DirectSound for audio.

> **Note:** despite the "DOS" label, `crypt.exe` is a **PE32 Windows GUI
> application** (not a DOS program). It requires DirectX 3.0+ and runs on
> Windows 95/98/NT 4.0.

## File inventory

| File | Size | Description |
|------|------|-------------|
| `crypt.exe` | 253,952 B | Windows PE32 GUI executable (DirectX 3.0) |
| `clipper.clp` | 1,151,267 B | Resource archive (images, palettes, sounds) |
| `maindung.gam` | 15,099 B | Dungeon/map data (demo subset) |
| `Config.dat` | 14 B | Configuration file |

The demo contains a subset of the full game's data — only the first dungeon map
(two playable levels). The data files live in `data/blackcrypt/dosvga/`.

## Key differences from the Amiga

- The Amiga spreads resources across 26 `bcdf*` files; the Windows version
  consolidates most into **`clipper.clp`**.
- The Amiga uses EHB (64 colours, 6 bitplanes); the Windows version uses VGA
  (256 colours, 8 bits/pixel).
- The Amiga uses custom RLE compression; the Windows version stores raw indexed
  pixels.
- The dungeon map format (`maindung.gam`) is **structurally identical** to the
  Amiga `bcdfs`, differing only in endianness.

See the [cross-platform comparison](/blackcrypt/dos/comparison/) for the full
table, and [clipper.clp](/blackcrypt/dos/clipper/) for the archive format.