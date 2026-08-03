---
title: bcdft — Data Carrier (LZ77)
description: The overlay that decompresses game code and data, and holds the container directories.
---

# `bcdft` — Data Carrier (LZ77)

`bcdft` (85,684 bytes) is a HUNK overlay with **7 hunks**. It's the game's data
carrier: it holds LZ77-compressed **game code + data** — not just data — and,
crucially, it's where the container directories for the tilesets and `bcdfa`
live.

## The 7 hunks

| Hunk | Kind | Purpose |
|------|------|---------|
| S_0 | CODE | entry stub (chain resolver) |
| S_1 | BSS | 166 KB target — the main decompressed image |
| S_2 | BSS | 40 KB target — the `A4` small-data segment |
| S_3 | BSS | 1 L |
| S_4 | CODE | the LZ77 + relocation engine |
| S_5 | DATA | 85 KB compressed payload |
| S_6 | BSS | 18 KB read buffer |

## Decompression

The S_4 engine LZ77-decompresses S_5 into S_1/S_2, then applies pointer
relocation fixups. This project decompresses it by **emulating the game's own
68k decompression routine with musashi** rather than reimplementing the custom
LZ77 by hand — avoiding hand-translation bugs entirely.

Two outputs:

- **`bcdft_decompressed.bin`** (S_1, 166,676 B) — code + graphics/string data.
- **`bcdft_s2_data.bin`** (S_2, 40,808 B) — the `A4` small-data segment where
  every global and per-level table lives (`A4 = S_2 + 0x7FFE`).

> **Trap:** running the emulator for a *fixed* cycle budget silently truncates
> S_1 at `0x1FEE0` and skips the relocation pass. It must run until the engine
> returns (~30 M cycles) — a tell is absolute `JSR $xxxxxx.l` targets pointing
> into an all-zero region.

## What lives in the decompressed image

The decompressed `bcdft` image is where all the *interesting* tables live:

- The **12-entry dungeon accent-ramp table** at `+0x27B00`.
- The **13-entry per-level palette table** at S_2 `+0x39E`.
- The **item-name string block** at S_1 `+0x1C4E2`.
- The **`gfxNumber` → icon LUTs** that map items to their sprites.
- The **container directories** for `bcdfa`, `bcdfx`, `bcdfy`, `bcdfz`.
- The **`"bcdf" 'a' 0` template** used to build every `bcdf?` filename at
  runtime.
- The **`SetDungeonPalette`** routine and the dungeon rendering kernel.

## The loading mechanism (why `strings` finds nothing)

The game stores **one** template `"bcdf" 'a' 0` at S_1 `+0x1DE0A` and patches
its last byte before each `Open()`. Two patch sites:

- **S_1 `+0x21E7E`** — `D0 = (level−1) + 0x62` → `bcdfb`…`bcdfn` (the 13
  per-level monster stores).
- **S_1 `+0x1DD16`** — `D0 = param + 0x77` → `bcdfw`/`bcdfx`/`bcdfy`/`bcdfz`
  (the tilesets), called from the level-entry routine at `+0x1A5CC`.

This is why a raw-overlay `strings` search finds nothing — the filename is
assembled one byte at a time on the stack. The container directories are
confirmed independently by a directory-sum invariant: each sums to exactly its
file's byte size, 3/3, zero deviation.