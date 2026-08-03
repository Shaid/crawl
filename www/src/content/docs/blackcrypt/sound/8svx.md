---
title: 8SVX Samples
description: The IFF 8SVX sound samples embedded in the game files.
---

# 8SVX Samples

The game's sound effects are stored as **IFF 8SVX** chunks, embedded in `bcdfu`
without a containing FORM wrapper. The raw chunks appear at offset `0x020156`.

## Example — `sky.explosion`

| Chunk | Size | Content |
|-------|------|---------|
| 8SVX | 4 | Type ID |
| VHDR | 20 | OneShot=9872, Repeat=0, Volume=32 |
| NAME | 20 | `sky.explosion` |
| ANNO | 20 | `Audio Master` |
| BODY | 9,872 | 8-bit PCM sample data |

## The VHDR chunk

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0x00 | 4 | uint32 | `oneShotHiLo` (total sample length) |
| 0x04 | 4 | uint32 | `repeatHiLo` (loop start) |
| 0x08 | 2 | uint16 | `samplesPerSec` (playback rate) |
| 0x0A | 2 | uint16 | `volume` (0–64, default 32) |
| 0x0C | 1 | uint8 | `numVoices` (0 = use all) |
| 0x0D | 1 | uint8 | padding |
| 0x0E | 2 | uint16 | `numOctaves` (for instrument use) |

## Effect sound banks

Beyond the 8SVX chunks in `bcdfu`, `bcdfa` holds a raw signed-8-bit PCM effect
sound bank (10 samples, byte-identical to 14 DOS `clipper.clp` sound entries),
and the `bcdfb`–`bcdfn` monster files each end with a raw PCM sound bank. See
[bcdfa](/blackcrypt/files/bcdfa/) and
[bcdfb–bcdfn](/blackcrypt/files/bcdfb-n/).