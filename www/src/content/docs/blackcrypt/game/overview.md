---
title: Overview
description: What Black Crypt is and how its data files are organised.
sidebar:
  order: 1
---

Black Crypt (1992, Raven Software / Electronic Arts) is a first-person dungeon
crawler for the Amiga. It uses the Amiga's **EHB (Extra Half-Brite)** display
mode — 6 bitplanes, 64 colours — and even supports anaglyph 3D glasses.

The game's data lives in a flat directory of **26 files named `bcdfa`–`bcdfz`**,
alongside the main executable `BlackCrypt` and a small `configuration.dat`.
Each file is a different kind of data: some are HUNK executables (code
overlays), some are RLE-compressed sprite banks, some are raw containers.

## What this project did

The goal of this project is to fully decode every file format so the game's art,
maps, sound and text can be extracted and understood. The work is byte-level:
every format is confirmed against the original files, emulator savestates, and
the DOS port.

The headline results:

- **All 204 monster sprites** across the 13 dungeon levels extract byte-exactly.
- **All 180 item icons** (24×24, 6bpp, no mask) live in two RLE streams inside `bcdfa`.
- **The three dungeon tilesets** (`bcdfx`/`bcdfy`/`bcdfz`) are fully decoded — 84
  named sub-images each, 100% byte coverage.
- **`bcdfa`** — the game's biggest, messiest file — is a *mixed* container, now
  fully mapped: UI panels, spell effects, sound, fonts, item icons, paperdoll
  art, floor sprites and throwing projectiles.
- **`bcdfs`** holds all 13 dungeon maps, with a verified format walker.

## How to read this site

- [File inventory](/blackcrypt/game/file-inventory/) — the one-line summary of every file.
- [Display & bitplanes](/blackcrypt/graphics/display/) — the graphics fundamentals you need first.
- [File formats](/blackcrypt/files/bcdfa/) — one page per file format.
- [Extracted assets](/blackcrypt/assets/screens/) — the actual images pulled out of the files.

## A note on the raw notes

The full, exhaustive analysis lives in `docs/blackcrypt/amiga/data-structure.md`
(≈9,600 lines). It records every format, every correction, and every dead end
so the work isn't repeated. These pages are a friendlier summary of that
document — when in doubt, the raw notes are authoritative.