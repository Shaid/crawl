---
title: bcdfs — Map / Dungeon Data
description: The format of the file holding all 13 dungeon maps.
---

# `bcdfs` — Map / Dungeon Data

`bcdfs` (171,005 bytes) holds **all 13 dungeon maps**. Despite being read by a
routine that looks like a save-file loader, it is **not** a save file — it's the
game's map data.

> **Use the verified walker, don't hand-roll a scan.** Records are a fixed 20
> bytes, monsters are two of them, every action record is 8 bytes, and empty
> rows are encoded `40 FF` with **signed** column bounds — which is what breaks
> naive walkers on maps 11–13.

## File-level structure

The file is 13 maps, one after another. Each map contains:

1. **Offset table** — 52 bytes (13 × 32-bit big-endian offsets). Only filled in
   map 1; maps 2–13 have 52 zero bytes here.
2. **Map header** — 7 bytes.
3. **Map data** — variable-size rows of squares with interleaved entity data.
4. **Padding** — 3,950 bytes of `0x00` (workspace for items dropped on the floor).

All 13 maps have exactly 3,950 zero bytes at their tail.

## Map header (7 bytes)

```
+0  3 bytes  unknown (usually 0)
+3  1 byte   vertical first row (on the 64×64 grid)
+4  1 byte   vertical last row
+5  1 byte   horizontal first column
+6  1 byte   horizontal last column
```

Map 1's header `00 00 00 00 1D 00 39` means rows 0–29 (30 rows) and columns
0–57 (58 squares per row). Maps are subdivided into levels on a 64×64 grid.

## Row format

Each row begins with a 2-byte horizontal range, then that many squares:

```
00  first column in this row
01  last column in this row
02  4×N squares (N = last − first + 1)
```

Rows are stored **bottom to top** of the 64×64 grid.

## Square format (4 bytes)

```
Byte 0: [type:4b][0xF]
Byte 1: [0xF][level:4b]
Byte 2: [wall_flags:4b][uniq_hi:4b]
Byte 3: [uniq_lo:8b]
```

| Field | Bits | Description |
|-------|------|-------------|
| type | 4 | `+0` floor, `+1` wall, `+2` darkness, `+4` spell-failed, `+8` water |
| level | 4 | level number within the 64×64 map |
| wall_flags | 4 | wall directions: `+1` N, `+2` E, `+4` S, `+8` W |
| unique | 12 | reference number — `0x000` empty, `0x001–0xFFF` = entity follows |

Type byte values observed: `0x0F` floor, `0x1F` wall, `0x2F` darkness, `0x4F`
spell-failed, `0x8F` water.

## Entity placement

When a square's 12-bit `unique` field is non-zero, entity data follows
immediately after the square. Entities are variable-length records whose byte
count depends on type, and they **chain** through their `unique` numbers —
a monster can carry an item, a container can hold several items.

```
[Square unique=A] [monster, chains to B] [Item unique=B] [Square unique=0]
```

## Item bytecode (exactly 20 bytes)

All items share a 9-byte prefix:

| Offset | Size | Field |
|--------|------|-------|
| +0 | 2 | `gfxNumber` (also determines hardcoded weapon stats) |
| +2 | 2 | **tagged** name reference (see below) |
| +4 | 1 | position on square AND class usage bitmask |
| +5 | 1 | `itemType` (defines the remaining bytes) |
| +6 | 1 | position in container |

The word at `+2` is a **tagged** reference, not a bare offset:

| `+2` value | meaning |
|------------|---------|
| `0x0000` | no name |
| bit 15 **clear** | byte offset into the map-item name block at `bcdft` S_1 `+0x1C4E2` |
| bit 15 **set** | index (`& 0x7FFF`) into a 19-entry `char *` table at `bcdft` S_2 `+0x07BA` |

685/685 references in the shipped `bcdfs` resolve exactly under this rule.

The remaining bytes depend on `itemType` — weapons, scrolls, potions, keys,
armour, spellbooks, containers, rings, amulets, and more each have their own
field layout. See the raw notes for the full table.

## Monster bytecode (~40 bytes)

Monsters start with a marker byte `0x80` (distinguishing them from items), then
a graphics/sound ID, hit chance, door-passing, attack/move speeds, attack
method, HP, carried item, spell-set flags, movement type, XP, attack strength,
and position on the square. Monsters are assigned to specific map files — a
monster type can only appear on the map where it was originally placed.

## Structure bytecode

Structures (door switches, illusionary walls, door frames, stairs, pits,
alcoves) are placed like items/monsters via the square unique chain, each with a
`gfxNumber` and a structure type. See the raw notes for the full type table.

## Runtime parser

The on-disk stream is parsed into in-memory arrays by a verified routine in the
decompressed `bcdft` image. The walker in this project is ported
instruction-for-instruction from that loader and walks all 13 maps with zero
deviation.