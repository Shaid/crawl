---
title: OctaMED Modules
description: The MMD0 tracker modules the game plays its music from.
---

# OctaMED Modules

The game's music is stored as **OctaMED MMD0** tracker modules. Three are found
in `bcdfu`:

| Module | Offset | Length |
|--------|--------|--------|
| #1 | 0x002130 | 25,212 |
| #2 | 0x0083AC | 81,696 (largest) |
| #3 | 0x01C2CC | 25,978 |

An additional MMD0 module is embedded in `bcdfq`'s CHIP data hunk.

## The MMD0 header

| Offset | Size | Description |
|--------|------|-------------|
| 0x00 | 4 | Magic: `"MMD0"` |
| 0x04 | 2 | Module length (in words) |
| 0x06 | 2 | Header length (usually 52 = 0x34) |
| 0x08 | 2 | Song length (in positions) |
| 0x0A | 2 | Instrument data offset |
| 0x0C | 2 | Sample data offset |
| 0x0E | 2 | Track data offset / flags |

## Audio output

The extracted effect sounds are available as raw 8-bit PCM under
`public/assets/blackcrypt/amiga/audio/` (see the [screens gallery](/blackcrypt/assets/screens/) for
the full asset index).