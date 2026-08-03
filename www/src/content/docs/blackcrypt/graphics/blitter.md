---
title: Blitter & Minterms
description: The Amiga blitter operations the game uses to draw sprites.
---

# Blitter & Minterms

The Amiga's blitter combines up to three source channels (A, B, C) into a
destination (D) using a **minterm** — an 8-bit boolean function. Black Crypt
uses a small set of them, and knowing them tells you how the data is laid out.

## The minterms

| Minterm | Meaning | Used for |
|---------|---------|----------|
| `$0FCA` | `D = (A AND B) OR (NOT A AND C)` | **mask + colour** sprite blit |
| `$09F0` | `D = C` | straight screen-to-screen copy |
| `$03CA` | `D = B` | opaque source-to-screen copy (no mask) |
| `$00F0` | `D = C` | full word fill/copy |

## The mask + colour blit (`$0FCA`)

This is the workhorse. It draws a masked sprite onto the screen:

- **Channel A** = the transparency mask (1 = pixel, 0 = transparent), fixed per
  plane loop.
- **Channel B** = the colour data, advancing by the plane stride each plane.
- **Channels C/D** = the screen (read/write), same pointer.

The result: where the mask is 1, the colour plane is written; where the mask is
0, the screen is left untouched. This is why the 7-plane format (mask + 6bpp
colour) is so common — the blitter consumes it directly.

## The main sprite blitter

The game's central blitter routine (`LAB_011E`) does exactly this:

- Minterm `$0FCA`: A = mask (fixed), B = colour (stride), C/D = screen.
- **6 iterations** (one per colour bitplane).
- Two paths: a clipped path (flag bit 0) for sprites near the screen edge, and
  a fast path otherwise.

## BLTSIZE encoding

The blitter's size register packs height and width:

```
BLTSIZE = (height << 6) | width_in_words
```

So `$0603` = height 24, width 3 words (24 pixels). `$0211` = height 8, width 17
words (272 pixels).

## Register & LVO conventions

When reading the disassembly:

- `A6` = library base (`dos`, `exec`, `graphics`), `A5` = local data frame,
  `A4` = overlay data.
- DOS LVO offsets: `Open=-30`, `Close=-36`, `Read=-42`, `Write=-48`, `Lock=-84`.
- 12-bit Amiga RGB → 24-bit: multiply each nibble by 17 (`0xC86` → 204,136,102).
- EHB half-bright (32–63) = `(r>>1, g>>1, b>>1)`.