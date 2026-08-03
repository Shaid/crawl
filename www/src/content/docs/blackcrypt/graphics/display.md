---
title: Display & Bitplanes
description: The Amiga's EHB display mode and how planar bitmaps are stored.
---

# Display & Bitplanes

Black Crypt runs in the Amiga's **EHB (Extra Half-Brite)** display mode. This
is the single most important thing to understand before decoding any of the
game's graphics.

## EHB in one paragraph

EHB uses **6 bitplanes**. The first 5 planes give 32 colours (indices 0–31).
The 6th plane (plane 5) is a *half-bright* flag: when it's set, the hardware
shows the colour at **half intensity**. So the palette is effectively 32 base
colours plus 32 half-bright copies (indices 32–63).

```
BPLCON0 $6200   →  6 bitplanes + EHB
Plane pitch $1F40 = 8000 = 320×200/8  →  resolution is 320×200
```

## Planar bitmaps

The Amiga stores bitmaps **planar**, not byte-packed. For a 6-bitplane image,
each pixel's colour index is spread across 6 separate planes — one bit per
plane. To recover a pixel's colour you read the same bit position from all 6
planes and combine them:

```
colour = plane0_bit | (plane1_bit << 1) | ... | (plane5_bit << 5)
```

Bit order is standard: **plane 1 → bit 0 (LSB), plane 6 → bit 5 (EHB
half-bright MSB)**.

### Sequential vs word-interleaved

The game stores its bitplanes **sequentially** — all of plane 0, then all of
plane 1, and so on — not word-interleaved. When decoding, advance the source
pointer by the plane stride between planes.

## The two sprite formats

Almost every sprite in the game uses one of two layouts:

1. **7-plane masked** — plane 0 is a 1-bit *cookie-cut mask* (1 = opaque),
   planes 1–6 are the 6bpp EHB colour. This is the convention for monster
   sprites, UI elements, wall decorations, and most `bcdfa` art.
2. **6-plane opaque** — no mask plane; transparency is a specific colour index.
   This is used for item icons (where "transparency" is colour index 53,
   `RGB 0x222222`, byte-identical to the inventory slot it's blitted onto).

## The tile descriptor

Portraits and UI tiles use a fixed descriptor (blitter setup):

```
+2  source offset   = $60 + index × $240  (96 + index × 576)
+6  plane stride    = $60 (96) = 32×24/8
+14 BLTSIZE         = $0603  (h=24, w=3 words)
+24 width           = 32
+26 height          = 24
```

The blit loop runs **6 planes** with a cookie-cut minterm, advancing the source
by one plane stride each time — confirming sequential planar storage.

## Ground-truth oracle

Because the game holds its decompressed graphics in chip RAM, emulator
savestates (`data/blackcrypt/default*.uss`) are a powerful oracle: each carries
the machine's entire 2 MB of chip RAM. If your RLE decode is correct, the whole
decompressed block appears verbatim somewhere in chip RAM — `find()` either
returns an address or it doesn't. This is how the 75,600-byte item bank was
confirmed at `$7D918`.

One trap: mapping screenshot RGB back to palette indices is **not injective**
under EHB. Register 22 (`0x666`) and EHB register 56 (half of `0xCCC`) are both
`RGB 0x666666`. Always compare in RGB, not recovered indices.