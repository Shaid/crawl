---
title: bcdfr — Full-Screen Images
description: The four title/intro screens.
---

# `bcdfr` — Full-Screen Images

`bcdfr` (138,560 bytes) holds the four full-screen images shown at startup. It's
opened and read by `bcdfq` (`LAB_0019`/`LAB_002F` etc.), which reads four chunks
whose sizes sum to exactly bcdfr's file size.

| Screen | Size | BPP | Dimensions |
|--------|------|-----|------------|
| Raven logo | 32,000 B | 4bpp | 320×200 |
| Title | 48,000 B | 6bpp | 320×200 |
| Logo banner | 10,560 B | 6bpp | 320×44 |
| Plot text | 48,000 B | 6bpp | 320×200 |

Each screen is a full-frame planar bitmap at its own bit depth. The palettes
for these screens live in `bcdfq` (see [palettes](/blackcrypt/graphics/palettes/)).

## Extraction

`scripts/extract_bcdfr.py` → `public/assets/blackcrypt/amiga/screens/{raven,title,logo,plot}.png`.