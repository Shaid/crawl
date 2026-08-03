---
title: bcdfx / bcdfy / bcdfz — Dungeon Tilesets
description: The three dungeon tilesets, their chunk directories, and how they're loaded.
---

# `bcdfx` / `bcdfy` / `bcdfz` — Dungeon Tilesets

These three files are the dungeon's wall/floor/door graphics. They are the
trickiest to decode because **their chunk directory lives in the executable,
not in the file** — each is a bare concatenation of chunks with no header or
separator.

> **Never RLE-scan these files.** Five chunks per file are stored *uncompressed*,
> so a blind RLE walk desynchronises on them. That single mistake is the root
> cause of every wrong "payload boundary" table in this project's history.

## Which file, which level

The level-entry routine (S_1 `+0x1A5CC`) selects the tileset by hardcoded level
range:

| Tileset | Levels | Accent ramp |
|---------|--------|-------------|
| `bcdfx` | 1–4 & 12–13 | 0 (tan) / 3 (grey) |
| `bcdfy` | 5 | 1 (violet) |
| `bcdfz` | 6–11 | 2 (bone/cream) |

## How they're loaded

The game stores **one** template `"bcdf" 'a' 0` at S_1 `+0x1DE0A` in the
*decompressed* `bcdft` image, and patches its last byte before each `Open()`:

```
S_1 +0x1DD16   D0 = param + 0x77  →  'w'/'x'/'y'/'z' for param 0/1/2/3
```

This is why a raw-overlay `strings` search finds nothing — the filename is
assembled one byte at a time on the stack. (`bcdfw` is the `param 0` slot but is
provably dead code — nothing ever calls it with `D0=0`.)

## The chunk directory

Each file's chunk table lives in the decompressed `bcdft` image, three
big-endian words per entry — **size, compressed flag, destination `d16(A5)`
slot** — zero-size terminated:

| Tileset | Directory | Entries |
|---------|-----------|---------|
| `bcdfx` | S_1 `+0x1DE10` | 12 |
| `bcdfy` | S_1 `+0x1DE5A` | 7 |
| `bcdfz` | S_1 `+0x1DE86` | 12 |

Each directory sums to the file's exact byte size (3/3, zero deviation).

## Sub-images

Each chunk is a *sequence* of independent sub-images, back to back, no header.
Every image has its own width, height and plane count. Sequential planar;
6 planes = opaque, **7 planes = mask plane first**.

- **84 named sub-images** in `bcdfx` and `bcdfz`, **47** in `bcdfy`.
- **205,922 of 205,922 decompressed bytes assigned** — zero overlap, zero
  remainder.
- The 84th sub-image in bcdfx/z is a 1-plane **door-clip stencil** (80×32) that
  the door open/close animation feeds to the blitter's A channel.

## Geometry from the game's own descriptors

The geometry comes from the game's blit-descriptor tables, not from guessing:

- A **20-byte** record for walls/ceiling/floor.
- A **28-byte** record carrying its own `slot`, `src`, `bytesPerPlane`,
  `BLTSIZE`, modulo, dest X/Y, flags, width and height (side walls, doors,
  pits, pillars, chains, buttons).
- An **18-byte** record for the stairs.

The 28-byte record is self-validating — `bytesPerPlane == (w/8)*h`,
`BLTSIZE == (h<<6)|(w/16+1)`, `modulo + blitBytes == 40` — which held on 61/61
records found by a whole-binary scan.

## Slot map

`$08` side walls (4 depths × L/R, masked) · `$0C` doors · `$B0` front walls ×3
depths + ceiling + floor · `$10` floor/ceiling pits · `$BC` alcove A–E · `$C0`
plaque A–E · `$14` pillars · `$B8` Door Slot 64×136 · `$C4` stairs · `$20` pull
chains · `$C8` Panel Top + Fountain · `$1C` 18 wall buttons.

## Wall rows are three pieces

Each wall row is **left return, front face, right return** — so the returns can
swap under mirroring:

```
16+176+16 = 48+112+48 = 64+80+64 = 208
```

## `bcdfy` is genuinely partial

`bcdfy` carries 7 of the 12 chunks — it lacks only the pits, alcove, plaque,
panel/fountain and button chunks. Its side-wall chunk is stored *raw* (14,448 B
at offset 0), which is why a decompressed-size match never fired for it.

## Rendering

Composite 208×140 viewports built straight from the descriptors' dest X/Y join
seamlessly for all three tilesets, at ramps 0/1/2 respectively. See the
[textures gallery](/blackcrypt/assets/textures/).