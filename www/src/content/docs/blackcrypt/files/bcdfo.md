---
title: bcdfo — Portraits & UI
description: The character portraits and UI elements bank.
---

# `bcdfo` — Portraits & UI

`bcdfo` (63,010 bytes) holds the **character portraits** and the **UI
elements** for the game's screens. It's fully accounted for — **0 remainder**.

## What's inside

- **36 character portraits** — 32×24×6bpp, sequential planar, at offset `$60`.
  (An earlier pass miscounted these as 109; tiles 36–108 are actually the
  LAB_010D UI descriptor region, misread at the wrong stride.)
- **23 seven-plane masked UI elements**, located via the `LAB_010D` descriptor
  table in `bcdfp`.
- **Three 8×8 fonts** at `0x9E28` / `0xA148` / `0xA320`.
- **The mouse-pointer sprite bank** at `0xA028` (byte-identical to `bcdfa`'s).

## The descriptor table

The `LAB_010D` descriptor table in `bcdfp` drives the UI elements. Each 28-byte
entry describes one element:

| Offset | Size | Field |
|--------|------|-------|
| +0 | 2 | pointer-table index (base address) |
| +2 | 4 | source data offset |
| +6 | 4 | stride per bitplane |
| +10 | 4 | alternate source offset (if flag bit 1) |
| +14 | 2 | BLTSIZE = `(h<<6)\|w/8` |
| +16 | 2 | screen modulo |
| +18 | 2 | X position |
| +20 | 2 | Y position |
| +22 | 2 | flags (bit 0 = clipped path, bit 1 = alternate addr) |
| +24 | 2 | width |
| +26 | 2 | height |

The `+10` field is an explicit **mask pointer**, and flag bit 1 selects
mask-first vs mask-elsewhere storage — so all 23 elements are 7-plane masked
sprites. Reading the descriptor table's *source offset and w/h only* (as two
earlier passes did) is what caused the miscounts.

## Extraction

`scripts/render_all.py` → `public/assets/blackcrypt/amiga/sprites/portraits.*`,
`sprites/ui.*`, `sprites/chargen-font-*.png`.