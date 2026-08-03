---
title: bcdfa — The Big Container
description: The game's largest, messiest file — a mixed container of effects, icons, art, sound and fonts.
---

# `bcdfa` — The Big Container

`bcdfa` (197,894 bytes) is the game's **mixed container**. It is *not* a flat
run of RLE streams — some blocks are RLE-compressed, some are raw. This is the
single most important thing to know about it: **locate blocks by marker string,
never by blind stream-splitting from offset 0.**

It's loaded by `bcdft`'s own code (`OpenBcdfaFile`, S_1 `+0x1DBD2`), which reads
a real **13-entry container directory** at S_1 `+0x1DC54` — the same 3-word
(offset, size, compressed) shape as the tilesets' chunk directories. That
directory sums to bcdfa's exact file size, 13/13, zero deviation.

## What's inside

| Offset | Size | Content | Status |
|--------|------|---------|--------|
| `0x00000` | 18,932 B | **UI panel bank** — 32 records, 15 named | Solved |
| `0x06F4D` | 28,846 B | **Effect sound bank** — raw signed 8-bit PCM | Solved |
| `0x0DFFB` | 16,576 B | **BCSPEED.GFK** — 73 effect sprites (16×16, mask+6bpp) | Solved |
| `0x10779` | 4,288 B | **Message-log font** (four fonts, all code-confirmed) | Solved |
| `0x111E1` | 34,340 B | **UI / Automap resource bank** — 13 records | Mostly solved |
| `0x15F8D` | 20,195 B | **BCSPEED.EFF** — 95 effect particle scripts (raw) | Solved |
| `0x1AE70` | 1,308 B | **BCSPEED.PRG** — 34 uncompressed animation scripts | Solved |
| `0x1B5B3` | 75,600 B | **Item icon bank** — 175 icons (24×24, 6bpp, no mask) | Solved |
| `0x270C4` | 31,388 B | **Dungeon-floor item sprites** — 147 = 49 items × 3 depths | Solved |
| `0x2D05E` | 13,224 B | **Chest armour paperdoll** — 19 × 32×29, 6bpp | Solved |
| `0x2FE5C` | 2,160 B | **Item icons** — 5 more (24×24) | Solved |
| `0x300C2` | 1,092 B | **Throwing-items projectiles** — Arrow + Dagger × 3 depths × 2 facings | Solved |
| `0x036FD` | — | **Large equipment-panel art** — 7 records (48-px rows) | Solved |

## The UI panel bank (`0x00000`)

32 records, 15 named, every one a 7-plane masked sprite (stencil + 6 EHB
colour). The named records were confirmed against the DOS port's `clipper.clp`:

- `as_stats` — the class LV:/AC: stat panel
- `face_square` — the portrait placeholder frame
- `gem_stone` — the twin-gem ring-slot graphic
- `options` — the Save/Rest buttons
- `up_arrows` — the movement compass
- `ghost` — a 50% black stipple (DOS's `Ghost`)
- `page_1`–`page_5`, `pressure_plate_1/2_up/down`

## BCSPEED — the spell effects

`bcdfa` holds three related "BCSPEED" banks that together implement the game's
spell/projectile effects:

1. **`.GFK`** — one RLE stream at `+0x0DFFB`, decoding to 16,576 B = 16 records.
   Each record is `12-byte name + BE count + count×224`, and each 224-byte frame
   is a **16×16 sprite in 7 planes** (mask + 6bpp EHB). **73 frames** total —
   bee, stars, fireballs, ice burst, flames, fly, skull, serpent, bolts.
2. **`.PRG`** — **uncompressed**, 34 records of `name + BE count + count×3`.
3. **`.EFF`** — 95 effect particle-emitter scripts (raw), tying the GFK sprites
   to the PRG movement scripts.

All three were confirmed 100% against the DOS port's `clipper.clp` spell-effect
atlas (73 frames, same order, 100.000% silhouette agreement).

## Item icons (`+0x1B5B3` / `+0x2FE5C`)

**180 item icons** in two RLE streams: 175 at `+0x1B5B3`, 5 at `+0x2FE5C`. Each
is **24×24 @ 6 sequential bitplanes with no mask plane** — the only Black Crypt
sprite format without one — 432 bytes per record. Confirmed three ways: the
whole bank is byte-for-byte resident in chip RAM at `$7D918` in three
savestates; the DOS port holds the same 180 icons in the same order with
100.000% silhouette agreement; and 13 in-game placements match pixel-exactly.

## Dungeon-floor item sprites (`+0x270C4`)

**147 sprites = 49 items × 3 view depths.** Pixels are one RLE stream (31,388
bytes); geometry comes from a 147 × 10-byte blit-descriptor table in
decompressed `bcdft` S_1 `+0x271B6`. Variable per-sprite geometry (16–80 px
wide, 1–26 rows), 7 planes (mask + 6bpp EHB), packed back to back. Verified
100.000% against 43 placements in 10 real screenshots.

## The four fonts

The chunk at `+0x10779` is **four fonts**, not two:

- **Region A** — the in-dungeon message-log font, 64 glyphs, 8×8, 1bpp.
- **Region B** — a micro font, 59 glyphs, 4×5, 1bpp.
- **Regions C+D** — a big font, mask + colour, 59 glyphs, 8×8, 6bpp masked.

All four are code-confirmed via their consumer routines in the decompressed
`bcdft` image.

## Sound, projectiles, and the rest

- **Effect sound bank** (`0x06F4D`) — 10 raw signed 8-bit PCM samples, byte
  identical to 14 DOS `clipper.clp` sound entries.
- **Throwing projectiles** (`0x300C2`) — Arrow + Dagger at 3 view depths × 2
  facings (12 records, 7-plane masked), 100% DOS agreement.

## The open bits

Most of `bcdfa` is solved. The remaining unclassified ranges (a heterogeneous
multi-record UI/text bank inside the `0x111E1` chunk) are tracked on the
[status page](/blackcrypt/status/).