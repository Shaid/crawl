---
title: bcdfv — Ending Sequence
description: The endgame/epilogue sequence data container.
---

# `bcdfv` — Ending Sequence

`bcdfv` (191,917 bytes) is the **endgame/epilogue sequence data** for `bcdfu`.
It's a container of **16 sequentially-read blocks**, every size byte-exact.

> **A common misconception:** despite old notes describing it as a "sound +
> sprite container", `bcdfv` contains **no monster sprites and no sound**. The
> "Two Head" sprite everyone was hunting is in `bcdfb` and was already
> extracted. The old claim came from hand-written speculative comments in
> `bcdfu.asm`.

## The 16 blocks

| Block | Content | Geometry |
|-------|---------|----------|
| 1 | Congratulations screen | 320×200, planes 0–3 |
| 2 | Ornate picture frame | 320×200×6 EHB |
| 3 | 8×8×6bpp font | 59 glyphs, 48 B each, ASCII 0x20–0x5A |
| 4–13 | **Ten narrated illustration panels** | 160×99×6bpp, 1,980 B/plane, 11,880 B each |
| 14 | Black Crypt facade — intact | 320×200, planes 0–4 |
| 15 | Black Crypt facade — destroyed | planes 0–3, plane 4 retained |
| 16 | Credits graphic | 240×153, **one bitplane**, 30 B/row × 153 = 4,590 |

The geometry was read off the blitter in the game's own routines (`LAB_0064` /
`LAB_0072` / `LAB_0020` / `LAB_0076`), not guessed. Every block's RLE terminator
lands on its last input byte — all 191,917 bytes are consumed with nothing left
over.

## The narration

`bcdfu`'s own strings ("THROUGH INCREDIBLE BRAVERY…") identify it as the
epilogue player. The ten panels tell the endgame story, and the extracted
`data/ending-script.json` pairs each panel with its narration text.

## Extraction

`scripts/extract_bcdfv.py` → `public/assets/blackcrypt/amiga/screens/ending-*.png`,
`sprites/ending-panels.*`, `sprites/ending-font.*`, `data/ending-script.json`.