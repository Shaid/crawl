---
title: bcdfq — Intro & Music
description: The intro screens and music engine overlay.
---

# `bcdfq` — Intro & Music

`bcdfq` (87,220 bytes) is a HUNK overlay that holds the **intro screens** and
the **music engine**. It also carries ~82 KB of appended CHIP data (memory
-resident music/palette data) and opens `bcdfr` for the full-screen images.

## What it does

- Loads and displays the four intro screens from `bcdfr`.
- Runs the OctaMED music engine.
- Holds the three title-screen palettes at file offsets `0x0266` / `0x0286` /
  `0x02C6`.

## A retracted theory

An old note claimed `bcdfq` "opens itself by name" (`"bcdfq"` at `LAB_001C`) and
that each disk's copy therefore carried level-specific texture data explaining
the tilesets. **This is false.** `LAB_001C` is actually `DC.B "bcdfr",0`, and
`strings -a` finds exactly one filename in the whole file: `bcdfr`. There is no
`"bcdfq"` byte sequence anywhere for it to open itself with. The four chunk
sizes it reads (32,000 + 48,000 + 10,560 + 48,000 = 138,560 B) equal bcdfr's
file size exactly.

## The palettes

`bcdfq` holds the title-screen palettes at `0x0266` (Raven, 16-colour),
`0x0286` (Title, 32-colour) and `0x02C6` (Plot, gold ramp). See
[palettes](/blackcrypt/graphics/palettes/).