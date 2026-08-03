---
title: bcdfb–bcdfn — Monster Sprites
description: The 13 per-dungeon-level monster sprite stores.
---

# `bcdfb`–`bcdfn` — Monster Sprites

These 13 files (one per dungeon level, `b` = map 1 … `n` = map 13) hold that
level's monster graphics, wall decorations, and a sound bank. They're opened by
name from the decompressed `bcdft` image via a patched `"bcdf?"` template
(S_1 `+0x21E7E`): filename letter = `0x62 + (level−1)`.

## File structure

```
12-byte header
42 × 28-byte directory entries
214-byte raw table
one RLE stream from offset 1402
```

The **RLE stream starts at byte 1402**, not immediately after the directory —
this was a long-standing decode bug. The 214 bytes between the directory and
the stream are a raw table, not compressed data.

## The directory entry (28 bytes)

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| +0 | 4 | `data_off` | offset into the concatenated decompressed stream |
| +4 | 4 | `bpr` | bytes per plane = (width/8) × total height |
| +8 | 4 | reserved | 0 |
| +12 | 2 | BLTSIZE | `(height<<6) \| (width/16 + 1)` |
| +14 | 2 | modulo | screen modulo |
| +16 | 4 | reserved | 0 |
| +20 | 2 | type | `0x0100`/`0x0500` (frame variant) |
| +22 | 2 | width | pixels |
| +24 | 2 | height | total rows (sum of frame heights) |
| +26 | 2 | reserved | 0 |

## 204 sprites, not 546

Each file has 42 directory entries (546 across all 13 files) — but entries that
share a `data_off` are a **normal/mirrored pair of the same image**, not
separate animation frames. This yields **204 distinct sprites**.

## Sprite layout

Each sprite is **7 sequential planes** — plane 0 is the 1-bit cookie-cut mask,
planes 1–6 are the 6bpp EHB colour. Bit order is standard (plane 1 → bit 0).

```
plane_0 = raw[0 : bpr]            ; mask (1 = opaque)
plane_1 = raw[bpr : bpr*2]        ; colour bit 0 (LSB)
...
plane_6 = raw[bpr*6 : bpr*7]      ; colour bit 5 (EHB half-bright MSB)
```

## Trailing data — wall decorations + sound

The 9–19 KB that follows each sprite stream splits at a **fixed 1932-byte**
boundary:

- **`[0, 1932)`** = **3 wall decorations × 644 B**, each holding the same object
  at three view distances (16×20 / 16×15 / 16×11, 7 sequential planes). These
  are the keyhole/lock plates, a red-cross panel, and a gargoyle face.
- **`[1932, EOF)`** = a raw signed-8-bit **PCM sound bank**, samples back to
  back. Verified against 8 DOS `clipper.clp` samples byte-for-byte.

## Palette

Monsters share the single dungeon EHB palette — there is no separate monster
palette. The half-bright (EHB) computation must happen on the **4-bit nibble**,
not the scaled 8-bit value:

```
correct:   half = (nibble >> 1) * 17
wrong:     half = (nibble * 17) // 2     # off by up to 8 per channel on odd nibbles
```

## Extraction

`scripts/extract_monsters.py` → `public/assets/blackcrypt/amiga/sprites/monsters.*`