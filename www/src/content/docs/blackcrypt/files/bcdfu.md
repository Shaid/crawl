---
title: bcdfu — RLE & Epilogue
description: The shared RLE decompressor, sound, and endgame player overlay.
---

# `bcdfu` — RLE & Epilogue

`bcdfu` (141,388 bytes) is a HUNK overlay that wears several hats:

- It carries the **shared RLE decompressor** (`LAB_0043`) used by `bcdfv`,
  `bcdfx`, `bcdfy` and `bcdfz`.
- It holds the **sound** (8SVX samples) and **music** (OctaMED modules).
- Its CODE hunk 0 is a complete standalone program: the **endgame/epilogue
  sequence player** — 10 narrative screens + credits, then `RTS`. It opens
  `bcdfv` for the sequence data.
- It carries **5 palettes** at file `0x03EC`–`0x04EC` — copies of entries 0–4 of
  the real 12-entry dungeon ramp table in `bcdft`.

## The RLE algorithm (`LAB_0043`)

This is the shared decompression scheme used across the game's RLE files:

```
ctrl byte 0x00 = end of stream
bit0 = 1:  literal copy — copy (byte >> 1) bytes from source
bit0 = 0:  fill — repeat the next byte (byte >> 1) times
```

## Sound & music

`bcdfu` embeds IFF 8SVX chunks (without a containing FORM wrapper) and three
OctaMED MMD0 tracker modules. See [8SVX samples](/blackcrypt/sound/8svx/) and
[OctaMED modules](/blackcrypt/sound/octamed/).

## The epilogue player

`bcdfu`'s own strings ("THROUGH INCREDIBLE BRAVERY…") identify it as the
epilogue player. It reads the 16-block sequence data from `bcdfv` and displays
the narrated ending. See [bcdfv](/blackcrypt/files/bcdfv/).