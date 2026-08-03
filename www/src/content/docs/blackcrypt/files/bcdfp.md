---
title: bcdfp — Game Logic
description: The overlay that does all the 3D rendering and game logic.
---

# `bcdfp` — Game Logic

`bcdfp` (23,960 bytes) is the HUNK overlay that contains **all the 3D
rendering, blitter routines, game logic, and the item/class tables**. It's the
code overlay — the one that actually draws the dungeon.

## What it holds

- The **VBlank handler** (`LAB_00D3`) that drives the 3D viewport rendering
  pipeline, dispatching through a jump table to per-direction renderers.
- The **main sprite blitter** (`LAB_011E`) — the cookie-cut mask + colour
  renderer used everywhere.
- The **text rendering blitter** (`LAB_0103`).
- The **UI descriptor table** (`LAB_010D`) that drives `bcdfo`'s UI elements.
- The **item table** and **class definitions** in its DATA section.
- The **character-creation screen layout** table.
- The **BCSub** message-port setup.
- The **character record layout** (168 bytes per character, 4 characters).

## The character record (from the WHDLoad trainer)

Each character is 0xA8 (168) bytes, 4 characters, base `$1758(A5)`:

| Offset | Field |
|--------|-------|
| +0x00 | name |
| +0x4E | current HP (w) |
| +0x50 | max HP (w) |
| +0x52 | experience (l) |
| +0x56 | gold (w) |
| +0x64–68 | current STR/INT/WIS/CON/CHR (b) |
| +0x6E–72 | max STR/INT/WIS/CON/CHR (b) |
| +0xA2 | level/XP (w) |

## A note on the disassembly

Much of the monster-sprite rendering code lives in **inline raw data blocks**
that IRA couldn't disassemble (encoded as `DC.L`). The rendering pipeline was
reconstructed from the surrounding structure and the blitter conventions — see
[blitter & minterms](/blackcrypt/graphics/blitter/).