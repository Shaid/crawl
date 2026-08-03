---
title: File Inventory
description: The 26 bcdf* files and what each one holds.
---

# File Inventory

The game's data is spread across 26 files named `bcdfa`–`bcdfz`. Here's what
each one is. Loader column shows which code opens the file; the tilesets and
monster stores are opened by name from the *decompressed* `bcdft` image (see
[the loading mechanism](/blackcrypt/files/bcdft/)).

| File | Size | Kind | What it holds |
|------|------|------|---------------|
| `BlackCrypt` | 12,700 B | HUNK executable | Main program; opens the overlays + config |
| `bcdfa` | 197,894 B | **Mixed container** | Spell effects, item icons, paperdoll art, floor sprites, sound, fonts, UI panels |
| `bcdfb`–`bcdfn` | 48–72 KB | RLE monster sprites | Per-dungeon-level monster graphics + wall decorations + sound |
| `bcdfo` | 63,010 B | Portraits + UI | 36 character portraits + UI elements + fonts |
| `bcdfp` | 23,960 B | HUNK overlay | All 3D rendering, blitter routines, game logic, item/class tables |
| `bcdfq` | 87,220 B | HUNK overlay + data | Intro screens + music engine; holds 3 palettes |
| `bcdfr` | 138,560 B | Full-screen images | 4 screens: Raven logo, Title, Logo banner, Plot |
| `bcdfs` | 171,005 B | Map data | All 13 dungeon maps (not a save file) |
| `bcdft` | 85,684 B | HUNK overlay (7 hunks) | LZ77-compressed **game code + data** — item names, strings, tables |
| `bcdfu` | 141,388 B | HUNK overlay | Endgame/epilogue player; shared RLE decompressor; sound; 5 palettes |
| `bcdfv` | 191,917 B | Ending sequence data | 16-block container: screens, font, narrated panels, credits |
| `bcdfw` | 457 B | Workbench icon | A `DiskObject` drawer icon, installer-only, never opened by the game |
| `bcdfx` | 144,169 B | RLE tileset | Dungeon tileset — levels 1–4 & 12–13 |
| `bcdfy` | 117,937 B | RLE tileset | Dungeon tileset — level 5 only |
| `bcdfz` | 160,806 B | RLE tileset | Dungeon tileset — levels 6–11 |
| `configuration.dat` | 8 B | Config | Keyboard config (`MLONF_` + `0x0100`) |

## The three tilesets at a glance

`bcdfx`, `bcdfy` and `bcdfz` are the three dungeon tilesets. Each is a bare
concatenation of chunks whose directory lives in the *executable* (decompressed
`bcdft`), not the file itself — which is why naive RLE-scanning of them fails.

| File | Levels | Accent ramp | Sub-images |
|------|--------|-------------|------------|
| `bcdfx` | 1–4, 12–13 | 0 (tan) / 3 (grey) | 84 |
| `bcdfy` | 5 | 1 (violet) | 47 |
| `bcdfz` | 6–11 | 2 (bone/cream) | 84 |

## What's *not* a file

`BCSub` is not a disk file — it's a **runtime message port** the game creates
with `CreatePort("BCSub")` to pass tile descriptors between two tasks. There is
no `BCSub` data file.

## Full detail

Each file has its own page under [File Formats](/blackcrypt/files/bcdfa/). The
byte-level evidence for every row above is in the raw notes.