# Black Crypt — Amiga Data Structures

## Overview

Black Crypt (1992, Raven Software / Electronic Arts) is a first-person dungeon
crawler for the Amiga. It uses the Amiga's EHB (Extra Half-Brite) display mode
(6 bitplanes, 64 colors) and supports anaglyph 3D glasses.

The game files are stored in a flat directory of 26 files named `bcdfa`–`bcdfz`,
alongside the main executable `BlackCrypt` and a small `configuration.dat`.

---

## File Inventory

| File             | Size      | Type                        | Loader      | Notes                              |
|------------------|-----------|-----------------------------|-------------|------------------------------------|
| `BlackCrypt`     | 12,700 B  | HUNK executable             | AmigaDOS    | Opens overlays + config            |
| `bcdfa`          | 197,894 B | RLE container/archive        | **bcdfq**   | 887 RLE streams (408KB decompressed). Container format with "BCSPEED.GFK"/"BCSPEED.PRG" markers — NOT simple sequential tiles. |
| `bcdfb`–`bcdfn`  | 48–72 KB  | RLE monster sprites (per dungeon level) | bcdfv | 42 × 28-byte directory entries per file + 7-plane sequential bitplane data (mask + 6bpp EHB). RLE-compressed. 495 animation frames extracted. |
| `bcdfo`          | 63,010 B  | Character portraits + UI elements | bcdfp        | 109 portraits × 32×24×6bpp at offset $60, plus UI tiles at assembly-specified offsets (see bcdfp LAB_010D) |
| `bcdfp`          | 23,960 B  | HUNK overlay (CODE+DATA)    | BlackCrypt   | All 3D rendering, blitter routines, BCSub, item/class tables, save/load |
| `bcdfq`          | 87,220 B  | HUNK overlay + appended data | BlackCrypt  | Intro screens + music engine. Contains monster palette at FILE offset `0x2C6` and dungeon palette at CODE+`0x2C6` |
| `bcdfr`          | 138,560 B | Full-screen images (4 screens, per-screen BPP) | bcdfq | 32KB Raven (4bpp, 320×200) + 48KB Title (6bpp, 320×200) + 10,560B Logo (6bpp, 320×44) + 48KB Plot (6bpp, 320×200) — chunk sizes from bcdfq LAB_0022/27/2B/2F |
| `bcdfs`          | 171,005 B | Dungeon/map data            | bcdfp        | Read in `LAB_0022/27/2B` chunks    |
| `bcdft`          | 85,684 B  | HUNK overlay (7 hunks)      | BlackCrypt   | LZ77-compressed game data (item names, strings, quest text, tables — **NOT** textures). Decompressed via musashi emulator (`tools/bcdft_decompress/`). |
| `bcdfu`          | 141,388 B | HUNK overlay (GAMEDISK2:)   | BlackCrypt   | RLE decompressor, music/sound, text strings. Monster palette at FILE offset `0x2C6` |
| `bcdfv`          | 191,917 B | Multi-block container (sound + sprites) | bcdfu        | RLE-compressed blocks for intro screens + game data (see bcdfv section) |
| `bcdfw`          | 457 B     | Workbench drawer icon       | —            | `0xE3100001`                       |
| `bcdfx`          | 144,169 B | RLE multi-payload (GAMEDISK2) | **bcdfu**  | 10 RLE payloads: P2=208×356 floor atlas, P4/P5=80×193 walls, P0=depth table, P3=viewport mask, P6–P9=fill/misc |
| `bcdfy`          | 117,937 B | RLE multi-payload (GAMEDISK2) | **bcdfu**  | Mostly 0xFF fill, sparse payloads (P0–P3), 178 RLE streams |
| `bcdfz`          | 160,806 B | RLE multi-payload (GAMEDISK3) | **bcdfu**  | 6 RLE payloads: same structure as bcdfx (P0–P5), 258 RLE streams |
| `configuration.dat` | 8 B    | Config store                | BlackCrypt   | `"MLONF_"` + `0x0100`             |

---

## BCSub — Runtime Message Port (Not a File)

The string `"BCSub"` appears in `bcdfp` at offset `0x1FAD` alongside `"CHARACTERS"`
and `"GAMEDISK1:"`. It is referenced at `bcdfp.asm:65` in function `LAB_0000`.
The assembly reveals that BCSub is **not a disk file** but a **runtime message port**:

```
LAB_0003:
    CLR.L -(A7)          ; mode = 0
    PEA LAB_0095(PC)     ; "BCSub"
    JSR LAB_0185(PC)     ; → CreatePort("BCSub", 0)
    MOVE.L D0,-31002(A4) ; store port ptr
    TST.L  -31002(A4)    ; NULL check
    BNE.S LAB_0004       ; port created OK → continue
    CLR.W -(A7)           ; else: exit
    JSR LAB_0228(PC)
```

### LAB_0185 — CreatePort(name, mode)

The function create-rather-than-opens:

1. `AllocSignal(-1)` → allocate a signal bit (`exec.library`, LVO -330)
2. `AllocMem(34, MEMF_PUBLIC|MEMF_CLEAR)` → 34-byte port structure (`exec.library`, LVO -198)
3. Set up port fields: `ln_Type=$04`, signal bit, task pointer from `FindTask(NULL)`
4. `AddPort(port)` → register port in system (`exec.library`, LVO -354)
5. Return port pointer (or NULL on any failure)

### Port Data Flow

```
bcdfp                          BCMain (bcdfq)
  │                                │
  ├─ CreatePort("BCSub") ──→ stored at -31002(A4)
  │                                │
  ├─ PutMsg(BCMain_port,          │
  │   msg{type=$05,                │
  │   BCSub_port_ptr, ...})  ──→  │ receives message
  │                                ├─ extracts BCSub port ptr from msg
  ├─ WaitPort(BCSub_port)          ├─ generates tile descriptors
  ├─ GetMsg(BCSub_port)     ←────  ├─ sends descriptors via BCSub port
  ├─ ReplyMsg(msg)                 │
  │   (loops for more descriptors) │
```

BCMain generates tile descriptors internally from map/dungeon data (bcdfs).
**No BCSub data file exists or is needed** — the descriptors are ephemeral runtime data.

---

## Executable Format (HUNK / loadseg)

All executables use the standard Amiga HUNK format, identified by the magic
`0x000003F3` (HUNK_HEADER).

### BlackCrypt

```
Hunk 0: CODE   — 12,496 B  (public, 2 reloc32 entries)
Hunk 1: DATA   — 92 B + 268 BSS (public, 1 reloc32 entry)
Hunk 2: BSS    — 4 B (public)
```

### bcdfp (overlay)

Loads `GAMEDISK1:bcdfs`. References `OrigDungeons` and `TempDungeons`.
**Contains ALL 3D dungeon rendering code** — bcdfq has zero dungeon rendering.

```
Hunk 0: CODE   — 22,032 B (public, 4 reloc32 entries)
Hunk 1: DATA   — 1,748 B + 1,976 BSS (public, 14 reloc32 entries)
Hunk 2: BSS    — 4 B (public)
```

#### Monster Sprite Rendering Pipeline

The monster sprite rendering code is entirely within **inline raw data blocks**
that IRA encoded as `DC.L` (failed to disassemble). There are **no labeled
callers** of LAB_011E for monster sprites in the disassembly.

**VBlank Handler LAB_00D3** (line 3100): Drives the 3D viewport rendering
pipeline. Dispatches through a jump table to rendering phases.

**Direction Dispatch** (lines 3156–3183): For each player direction (N/E/S/W),
calls different viewport + monster rendering functions via `BSR.W`.

**Sprite Descriptor Construction** (inline, ~line 3212–3213):
- Loads sprite data pointer from `A5+$03CE`
- Loads sprite descriptor base from `A5+$03C2`
- Writes sprite dimensions to descriptor +2 (width) and +6 (height/BLTSIZE)
- Loads sprite data buffer base from `A5+$03C6` (bcdfv decompressed data)
- Skips 12 bytes of header (`LEA $000C(A1),A1`)
- Copies sprite data: `MOVE.W (A0)+,(A1)+` + `LEA $000C(A1),A1` (stride 12)

**Sprite Copy Loop** (inline):
```asm
MOVEQ #7,D0            ; 8 iterations
loop: MOVE.W (A0)+,(A1)+
      LEA $000C(A1),A1  ; stride 12 between planes
      DBF D0,loop
```

**Key A5 Offsets for Monster Sprite Rendering:**

| Offset | Purpose |
|--------|---------|
| A5+$03BE | Alternate sprite pointer |
| A5+$03C2 | Sprite descriptor base pointer (A2 in blitter) |
| A5+$03C6 | Sprite data buffer base (bcdfv decompressed data) |
| A5+$03CE | Sprite data pointer (current monster) |
| A5+$03D6 | Sprite type/index |
| A5+$03D8 | Sprite state longword |
| A5+$03D9 | Sprite-active flag (byte) |
| A5+$03DA | Sprite direction/movement byte |
| A5+$043C | Rendering state flag |

#### Text Rendering Blitter (LAB_0103, line 3646)

A separate blitter for rendering text characters:
- Plane stride: 256 bytes ($100)
- BLTSIZE: $0211 = height=8, width_words=17 (272 pixels/34 bytes per row)
- Screen modulo: 6 bytes
- 6 iterations (DBF D0,5)
- Font data loaded from 0(A5)+$A148

#### Character Record Layout (from WHDLoad trainer)

0xA8 (168) bytes per character, 4 characters:
- +$00: name
- +$4E: current HP (w)
- +$50: max HP (w)
- +$52: experience (l)
- +$56: gold (w)
- +$64..$68: current STR/INT/WIS/CON/CHR (b)
- +$6E..$72: max STR/INT/WIS/CON/CHR (b)
- +$A2: level/XP (w)

Base: $1758(A5), offsets: +0, +$A8, +$150, +$1F8

---

### Amiga Hardware & Disassembly Conventions

#### Register usage

- **A6** = library base (dos, exec, graphics)
- **A5** = local data frame (game state, pointers, scratch)
- **A4** = overlay data

#### DOS LVO offsets

| Function | LVO    |
|----------|--------|
| Open     | -30    |
| Close    | -36    |
| Read     | -42    |
| Write    | -48    |
| Lock     | -84    |

#### BLTSIZE encoding

`BLTSIZE = (height << 6) | width_in_words`

Example: `$0603` = height 24, width 3 words (48 pixels).

#### 6bpp EHB (Extra Half-Brite)

Colors 0–31 are normal; colors 32–63 are half-bright copies (color >> 1).
12-bit Amiga RGB → 24-bit: multiply each nibble by 17 (e.g., `0xC86` → RGB 204,136,102).

#### Blitter minterms

| Minterm  | Operation | Use case |
|----------|-----------|----------|
| `$0FCA`  | D = (A AND B) OR (NOT A AND C) | Mask+color sprite blit (A=mask, B=color, C/D=screen) |
| `$09F0`  | D = C | Screen-to-screen copy |
| `$03CA`  | D = B | Opaque source-to-screen copy (no mask) |
| `$00F0`  | D = C | Full word fill/copy |

#### IRA disassembly quirk

BCLR instructions at label data are raw bytes, not code — IRA sometimes
misidentifies data as instructions.

#### Key blitter functions (bcdfp.asm)

| Function | Description |
|----------|-------------|
| LAB_010D | 28-byte descriptor table for UI elements (source offset, stride, BLTSIZE, modulo, flags, width, height) |
| LAB_010E | Render UI element by descriptor index → LAB_011E |
| LAB_010F | Render portrait by tile index → LAB_011E (uses LAB_010C as live descriptor) |
| LAB_0110 | Simple opaque screen blitter (2-pass: aligned words + edge pixels) |
| LAB_011B | Screen-to-screen blit for scrolling |
| LAB_011E | Main sprite blitter with clipping (minterm $0FCA, 6 plane iterations) |
| LAB_0124 | Alternate sprite blitter with screen-edge clipping |

### bcdfq (overlay with CHIP data)

```
Hunk 0: empty (0 B)
Hunk 1: CODE   — 4 B (1 longword = JMP stub)
Hunk 2: CODE+DATA — 5,284 B (public, 40 reloc32 entries) + 81,700 B CHIP data
```

Total file: 87,220 B. HUNK executable = 5,288 B. **Appended data after HUNK = 81,908 B**.
The DATA portion is marked as CHIP memory (directly accessible by Amiga custom
chips). Contains an offset table at the start followed by embedded MMD0 and
8SVX data resources.

**bcdfq reads its own appended data at runtime** — LAB_0019 opens `"bcdfq"` via
DOS Open(-30) and LAB_0022/LAB_0027/LAB_002B/LAB_002F read sequential chunks
using size tables at LAB_0026/LAB_002A/LAB_002E. The 81,908 bytes of appended
data contain chunked resources (tile graphics, palette data, screen layouts)
that are read into memory at offsets starting at `$BB80` (48,000 bytes per
chunk set).

**Critical: bcdfq opens "bcdfq" by filename** (encoded as raw bytes at LAB_001C
in the disassembly). Since bcdfq is present on all three disks with different
appended data, the 81,908 bytes on GAMEDISK1: contain level-1 textures, while
GAMEDISK2: and GAMEDISK3: versions would contain the respective level textures.
This is the likely loading mechanism for bcdfx/bcdfy/bcdfz data — the texture
data is embedded in bcdfq's appended data on each disk, not in separate files.

### bcdfu (overlay)

```
Hunk 0: CODE
Hunk 1: DATA
```

Contains 3 MMD0 music modules, 8SVX sound effects, game narrative text
strings, and **palette data** at two critical locations:

1. **Monster sprite palette**: FILE offset `0x2C6` (32 colors + 32 half-bright).
   Has RED (255,0,0), ORANGE, TAN — correct for monster rendering.
   ⚠ Loading from `36+0x2C6` gives the dungeon palette (blue ogres).

2. **Dungeon wall/floor palette**: CODE + `0x2C6` = file offset `36 + 0x2C6 = 0x2EA`
   (32 colors + 32 half-bright). Has BROWNS, BLUES, GREYS for the 3D view.

Both are 32 × 16-bit Amiga color registers (64 bytes) with EHB half-bright
computed as `(r//2, g//2, b//2)` for indices 32-63.
Colors 0–25 are identical across all variants; colors 26–31 vary (likely for
different dungeon areas or lighting conditions).

Imports: `graphics.library`, `intuition.library`, `dos.library`. Accesses
`DMACON` (chipset DMA control), confirming this overlay handles display setup.

### bcdft (overlay — data carrier, 7 hunks)

```
Hunk 0: CODE   — 80 B (entry stub / chain resolver)
Hunk 1: BSS    — 166 KB target (S_1: decompressed output)
Hunk 2: BSS    — 40 KB target (S_2: decompressed output)
Hunk 3: BSS    — 4 bytes (S_3: temporary)
Hunk 4: CODE   — LZ77 decompression engine (S_4)
Hunk 5: DATA   — 84,976 B LZ77-compressed dungeon data (S_5)
Hunk 6: BSS    — 18 KB read buffer (S_6)
```

**S_0 entry**: Chain resolver frees S_3/S_5/S_6, returns modified A1.
**S_4 engine**: Custom backwards-reading LZ77 + pointer relocation fixups.
Reads S_5 data backwards from its end using an 8-byte FIFO, 3-pass
structure (destinations: S_1=166KB, S_2=40KB, S_3=4B), and embedded
table-driven bit-tree decoding for lengths and offsets.

**S_5 contents**: Item names, game strings, quest text, spell names,
class/race data, and game logic tables. **NOT** wall/floor pixel textures —
those come from bcdfx/y/z as RLE-decompressed 6bpp planar bitmaps.

No strings or library imports of its own — acts as a data carrier loaded at runtime.
**Confirmed: 7 hunks, NO DOS library calls, NO file I/O whatsoever.**

**Decompression**: Achieved by running the actual S_4 code (496 bytes of 68k)
inside a [musashi](https://github.com/kstenerud/musashi) CPU emulator.
See `tools/bcdft_decompress/` for the build/run:
```bash
cd tools/bcdft_decompress && bash build.sh run
```
Output: 166,676 bytes, ~113KB non-zero, to `data/blackcrypt/extracted/bcdft_decompressed.bin`.

**Known strings in output** (verified against game strings):
| String | Offset |
|--------|--------|
| `POTION OF WATER BREATHING` | 118,185 |
| `POTION OF HEALING` | 116,628 |
| `CANNOT PLACE ITEM IN INVENTORY` | 120,287 |
| `CANNOT USE THIS SPELLBOOK` | 120,388 |
| `THIS ITEM DOES NOT FIT IN` | 120,617 |
| `FIGHTER / CLERIC / MAGIC USER / DRUID` | 108,681 |
| `SPELL FAILED` | 119,198 |
| `RAISE DEAD / CURE POISON / SHIELD / DISPEL MAGIC` | 108,068 |

**WHDLoad slave**: matches by hunk size $4C1AC, patches at $496BA/$496C2 (trainer).

---

## Graphics Format

### Display Mode (copper gospel — bcdfp `LAB_00BD`)

- **BPLCON0 `$6200`**: 6 bitplanes + EHB
- Colors 0–31 normal; 32–63 half-bright (plane 5)
- Plane pitch `$1F40` = 8000 = 320×200/8 → **320×200**
- 12 plane pointers (double-buffer 6+6) at A5+40 / A5+64
- Chip alloc 0 = `$F622` (63010) = exact **`bcdfo` size**; loaded by `LAB_00AB`

### Tile descriptor `LAB_010C` + blit `LAB_011E` (gospel)

```
+2  source offset   (LAB_010F sets $60 + index*$240)
+6  plane stride    = $60 (96) = 32×24/8
+14 BLTSIZE         = $0603 (h=24, w=3 words)
+24 width           = 32
+26 height          = 24
```

Blit loop: `MOVEQ #5` → **6 planes**, `BLTCON0|$0FCA` cookie-cut,
source pointer `A1 += plane_stride` each plane → **sequential planar**, not word-interleaved.

### File opens (string refs only — gospel)

| File | Opened by | Ref | Notes |
|------|-----------|-----|-------|
| bcdfq/p/t | BlackCrypt loader | `BlackCrypt.asm:1028-1032` | Overlays from `GAMEDISK1:` |
| bcdfu | BlackCrypt loader | `BlackCrypt.asm:1032` | Overlay from `GAMEDISK2:` |
| bcdfo | bcdfp `LAB_00AB` | `bcdfp.asm:2714` | UI/chrome graphics bank, alloc `$F622` |
| bcdfs | bcdfp | `bcdfp.asm:2601` | Dungeon/map data |
| bcdfr | bcdfq `LAB_0019` | `bcdfq.asm:306-321` | Fullscreen images, buffer `$BB80` |
| bcdfv | bcdfu | `bcdfu.asm:523` | Animation/script data |
| bcdfb–bcdfn | bcdfv | `bcdfu.asm:611` | 13 dungeon level graphic stores, loaded via bcdfv |
| **bcdfa**    | **UNKNOWN** | *exhaustively searched* | No `Open()` string in any binary |
| **bcdfx**   | **UNKNOWN** | *exhaustively searched* | Not referenced in any disassembled overlay |
| **bcdfy**   | **UNKNOWN** | *exhaustively searched* | Same as bcdfx |
| **bcdfz**   | **UNKNOWN** | *exhaustively searched* | Same as bcdfx |

**Loader theory for bcdfa:** No loading mechanism found in disassembled overlays.
bcdfa may be a legacy/unused file from development, or loaded via code not yet
disassembled.

**Loader theory for bcdfx/bcdfy/bcdfz:** These are standalone RLE data files
on GAMEDISK2: and GAMEDISK3: that provide dungeon texture atlases (P2 = wall/floor
textures at 208×356×6bpp). Not referenced in any disassembled overlay — may be
loaded via code not yet disassembled.

#### File Loading Summary (WHDLoad version)

Only these files are ever loaded by name:

| File | Loaded By | Contents |
|------|-----------|----------|
| bcdfp | BlackCrypt (LoadSeg) | Game logic, blitters, save/load |
| bcdfq | BlackCrypt (LoadSeg) | Intro screens, music engine |
| bcdft | BlackCrypt (LoadSeg) | LZ77-compressed game data (item names, strings, quest text, tables — 85KB) |
| bcdfu | BlackCrypt (LoadSeg) | RLE decompressor, sound engine |
| bcdfo | bcdfp (LAB_00AE) | 109 portraits + UI graphics (63KB) |
| bcdfs | bcdfp (LAB_0047) | Map data (all 13 maps, NOT a save file) |
| bcdfv | bcdfu (LAB_0033) | Sound + monster sprite data (192KB) |
| Configuration.Dat | BlackCrypt | Game config (8 bytes) |

bcdfb–bcdfn (13 files) are per-map monster sprite files on floppy. In the WHDLoad
version, bcdfb–bcdfn filenames are NOT referenced — data comes from bcdfv.
bcdfx/bcdfy/bcdfz — purpose unknown, never loaded by name.

### Original floppy disk layout (ADF directory)

Confirmed via installer text on Disk 1 (offset ~427500) and ADF filesystem:

| Disk 1 (GAMEDISK1:) | Disk 2 (GAMEDISK2:) | Disk 3 (GAMEDISK3:) |
|----------------------|----------------------|----------------------|
| bcdfa, bcdfo | bcdfb, bcdfc, bcdfd | bcdff, bcdfg, bcdfh |
| bcdfp, bcdfq | bcdfe, bcdfm, bcdfn | bcdfi, bcdfj, bcdfk |
| bcdfr, bcdfs, bcdft | bcdfu, bcdfv, bcdfx | bcdfl, bcdfy, bcdfz |
| bcdfw (icon) | — | — |
| configuration.dat | — | — |

Note: `GAMEDISK3:` string does not appear in any disassembled binary — disk 3 files
are likely opened with the default current directory after a disk-swap prompt.
The `GAMEDISK2:` string appears in `bcdfu.asm` (opened by `bcdfu` to load `bcdfv`).
bcdfx/bcdfy/bcdfz are NOT referenced by filename in any disassembled overlay — their
data is embedded in bcdfq's appended data on each disk (see "bcdfq self-reading
mechanism" above).

#### ADF disk images

Three ADF files exist at `data/blackcrypt/amiga/adf/`:
- All 901,120 bytes each (standard 880 KB DD format)
- Valid Amiga OFS/FFS filesystem (`DOS\0` boot sector signature at sector 0)
- Root block at sector 880
- Filenames confirmed via string search: Disk 1 has bcdfa/bcdfp/bcdfq/bcdfr/bcdfs/bcdft/bcdfo/bcdfw; Disk 2 has bcdfb/bcdfc/bcdfd/bcdfe/bcdfm/bcdfn/bcdfu/bcdfv/bcdfx; Disk 3 has bcdff/bcdfg/bcdfh/bcdfi/bcdfj/bcdfk/bcdfl/bcdfy/bcdfz

#### bcdfq self-reading mechanism (confirmed)

bcdfq opens itself by name ("bcdfq" at LAB_001C) via DOS Open(-30) in LAB_0019.
It then reads sequential chunks from the appended data (after the 5,288 B HUNK
code) using size tables at LAB_0026, LAB_002A, and LAB_002E. The total appended
data is 81,908 bytes on GAMEDISK1:. Since bcdfq is present on all three disks
(confirmed by ADF directory listing), each disk's bcdfq contains level-specific
texture data. This explains how bcdfx/bcdfy/bcdfz data is loaded without any
code referencing those filenames — the textures are embedded in bcdfq's appended
data on each respective disk.

The standalone bcdfx/bcdfy/bcdfz files (144K/118K/161K) are larger than bcdfq's
appended data (82K), suggesting they contain additional payloads (P4-P9) beyond
what bcdfq carries, possibly for different rendering modes or dungeon areas within
the same disk level.

---

### bcdfa — BCSPEED Animation Archive

| Property         | Value                                      |
|------------------|--------------------------------------------|
| File size        | 197,894 B                                  |
| Compressed       | Yes — same RLE scheme as bcdfv (bcdfu LAB_0043) |
| RLE streams      | **887** individual streams (separated by `0x00` terminators) |
| Decompressed     | 408,030 bytes total                        |
| Content          | Combat/movement animation system (BCSPEED). NOT item tiles. |
| Loaded by        | **UNKNOWN** — no `Open()` string in any disassembled overlay |

**BCSPEED** is the game's combat/movement animation system for sprites, spells,
and cursors. The name refers to animation speed/timing. It is **not** an
executable program — GFK and PRG are data formats parsed by the game engine.

#### Stream Categories

| Stream Range | Content | Details |
|--------------|---------|---------|
| 0 | Viewport mask | 18,932 B decompressed — repeating `1FFFFFF8` pattern (32px bitmask for 3D dungeon viewport) |
| 1 | Viewport mask | 18,184 B decompressed — repeating `FFFFF000` pattern (alternate mask) |
| 2–406 | Metadata | Small streams, non-graphical data |
| 407 | **BCSPEED.GFK** | 17,190 B decompressed — **16 sprite bitmap entries** (74 frames, 32×14×4bpp) |
| 408–707 | Metadata | Intermediate streams |
| 708–739 | **BCSPEED.PRG** | **283 animation keyframe entries** across 30 streams (see below) |

#### BCSPEED.GFK — Sprite Bitmaps (Stream 407)

Stream layout: 333-byte preamble + 16 × (marker + type + sprite data).

**Per-entry format:**

| Offset | Size | Description |
|--------|------|-------------|
| +0 | 12 | `BCSPEED\0GFK\0` marker (null-terminated strings) |
| +12 | 2 | Type (big-endian) = frame count (0x0002–0x0006) |
| +14 | type×224 | Sprite data (32×14×4bpp sequential planar) |

**Sprite format:**
- **224 bytes per frame** = 32/8 × 4 planes × 14 rows
- Sequential planar decode (4 planes: plane0=LSB through plane3=MSB)
- Each pixel = 4-bit color index (0–15), greyscale: value × 17 = brightness

**Entry table:**

| Entry | Type | Frames | Notes |
|-------|------|--------|-------|
| 0 | 0x03 | 3 (+1 extra) | 281 extra bytes after type×224 (possible4th frame) |
| 1–8 | 0x05 | 5 each | |
| 9 | 0x03 | 3 | |
| 10 | 0x05 | 5 | |
| 11 | 0x04 | 4 | |
| 12 | 0x05 | 5 | |
| 13 | 0x06 | 6 | |
| 14 | 0x05 | 5 | |
| 15 | 0x02 | 2 | |

Total: **74 frames** across 16 entries. Extracted to `data/blackcrypt/extracted/bcspeed_gfk/`.

**Preamble (333 bytes):** Data before first marker. Contains 1 full sprite frame + 109 extra bytes. Purpose unknown — may be a default cursor or global sprite.

#### BCSPEED.PRG — Animation Keyframes (Streams 708–739)

283 animation keyframe entries across 30 streams. Each stream = one "actor" (monster).

**7 distinct action types:**

| Action Type | Description |
|-------------|-------------|
| 0x000b | Walk N/S/E/W |
| 0x0010 | Walk diagonal |
| 0x0009 | Attack |
| 0x0013 | Spell |
| 0x000d | Damage |
| 0x0015 | Die |
| 0x001f | Idle |

**Stream distribution:**
- Streams 708–718: 16–18 entries each (full action set)
- Streams 719–724: 14 entries each
- Streams 725–737: taper to 1 entry (type 0x0015 = death animation only)

Each keyframe entry is a 3-byte record: direction (0x40/0xFF), displacement (-3/+3), flags.
---

### bcdfb–bcdfn — Monster Sprite Files (Per Dungeon Level) — CORRECTED

These 13 files each contain **all monster graphics for one dungeon level**.
Data is **RLE compressed** (using bcdfu LAB_0043 algorithm) and contains
a fixed-size directory + concatenated sprite data.

#### File Structure

```
Offset 0x00: 12-byte header
Offset 0x0C: 42 × 28-byte directory entries (1176 bytes)
Offset 0x4A4: RLE-compressed sprite data streams
```

#### 12-byte Header

| Offset | Size | Description |
|--------|------|-------------|
| 0x00   | 2    | Padding (0x0000) |
| 0x02   | 2    | Map/level ID (varies per file) |
| 0x04   | 2    | Extra ID (varies per file) |
| 0x06   | 2    | Extra ID (varies per file) |
| 0x08   | 4    | Padding (0x00000000) |

**Note:** Previous documentation incorrectly identified the header as part of the first RLE stream. It is a fixed 12-byte header.

#### 42 × 28-byte Directory Entries

Each directory entry describes one sprite (or alternate frame):

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| +0     | 4    | data_offset | Offset into concatenated decompressed stream |
| +4     | 4    | bpr | Bytes per row = (width/8) × height |
| +8     | 4    | reserved | Always 0 |
| +12    | 2    | bltsize | BLTSIZE = (height << 6) | (width/16 + 1) |
| +14    | 2    | modulo | Screen modulo (usually 0) |
| +16    | 4    | reserved | Always 0 |
| +20    | 2    | type | 0x0100 = normal, 0x0500 = alternate frame |
| +22    | 2    | width | Width in pixels |
| +24    | 2    | height | Height in rows |
| +26    | 2    | reserved | Always 0 |

#### Sprite Data Layout

After RLE decompression of the entire file, the decompressed bytes form a
**concatenated stream**. Directory entries index into this stream by
`data_offset`. Each sprite entry is:

```
plane_0 = stream[data_offset : data_offset + bpr]          ; mask (1-bit, 1=opaque)
plane_1 = stream[data_offset + bpr : data_offset + bpr*2]  ; color bit 0
plane_2 = stream[data_offset + bpr*2 : data_offset + bpr*3] ; color bit 1
...
plane_6 = stream[data_offset + bpr*6 : data_offset + bpr*7] ; color bit 5
```

**7 sequential bitplanes per sprite:** plane 0 = transparency mask, planes 1–6 = 6bpp EHB color.

#### Verified Sprite Dimensions (from bcdfb)

| Entry | Width | Height | Data Offset | Type | Notes |
|-------|-------|--------|-------------|------|-------|
| 0-1   | 96    | 124    | 10836       | 0x0100 | Two Head (normal frames) |
| 2     | 96    | 126    | 21252       | 0x0100 | Two Head (alternate) |
| 3     | 96    | 124    | 10836       | 0x0500 | Two Head (alternate frame, shares data) |
| 4-5   | 64    | 79     | 31836       | 0x0100 | Rock Eye |
| 6     | 64    | 81     | 36260       | 0x0100 | Rock Eye (alternate) |
| 7     | 64    | 79     | 31836       | 0x0500 | Rock Eye (alternate frame, shares data) |
| 8-9   | 48    | 52     | 40796       | 0x0100 | Small monster |
| 10    | 48    | 53     | 42980       | 0x0100 | Small monster (alternate) |
| 11    | 48    | 52     | 40796       | 0x0500 | Small monster (alternate frame) |
| 12+   | 64    | 55     | 56154       | 0x0100 | Other monsters |

#### Current Extraction Status

`scripts/extract_bcdfb_bcdfn.py` RLE-decompresses each file, reads the 42-entry
directory, and extracts 7-plane sequential bitplane sprites. Output goes to
`data/blackcrypt/extracted/monsters_corrected/`.

**Result:** 495 individual animation frames extracted across all 13 files.
Mask (plane 0) is correct — sprites show proper opacity and unique colors.
There is a **24-pixel circular shift** in the decoded output that remains
unresolved (likely an alignment issue in the sprite copy loop at A5+$03C6).

**Animation frame splitting:** Entries sharing the same `data_off` are animation
frames of the same sprite. Frame heights are distributed evenly across the total
height: `base_h = height // n_frames`, with some frames getting `base_h + 1`.
Frames are concatenated within each plane (frame0 rows, frame1 rows, etc.).

---

### RLE Decompression (shared across bcdfv, bcdfx, bcdfy, bcdfz)

Found in `bcdfu.asm` at LAB_0043 (line 686). A simple, fast RLE scheme used
for all data files on GAMEDISK2 and GAMEDISK3.

#### Algorithm

```
Read control byte
  if byte == 0x00 → end of stream
  if byte & 1 == 1 → LITERAL: copy (byte >> 1) bytes from source to dest
  if byte & 1 == 0 → FILL: read next byte, repeat it (byte >> 1) times
```

Maximum run length per command: 127 bytes (byte >> 1 with 7-bit count).
The `SUBQ.W #1,D0` before the `DBF` loop makes the actual iteration count
equal to `(byte >> 1)`.

#### Pseudocode (from bcdfu.asm LAB_0043)

```asm
LAB_0043:
    MOVEQ   #0,D0
    MOVE.B  (A0)+,D0        ; read control byte
    BEQ.S   LAB_0048        ; 0x00 = end of stream
    BTST    #0,D0
    BNE.S   LAB_0045        ; bit0=1 → literal copy

; RLE fill
    MOVE.B  (A0)+,D1        ; read fill byte
    LSR.W   #1,D0           ; count = control >> 1
    SUBQ.W  #1,D0           ; adjust for DBF
-   MOVE.B  D1,(A1)+        ; fill
    DBF     D0,-
    BRA.S   LAB_0043        ; next control byte

LAB_0045:                    ; literal copy
    LSR.W   #1,D0           ; count = control >> 1
    SUBQ.W  #1,D0           ; adjust for DBF
-   MOVE.B  (A0)+,(A1)+     ; copy
    DBF     D0,-
    BRA.S   LAB_0043        ; next control byte
```

#### Properties

- Stream-oriented, no block boundaries
- Each command produces 1–127 bytes
- Worst case (all literals): ~2× input size
- Best case (long fills): high compression ratio
- No back-references or dictionary — pure RLE

---

### bcdfx / bcdfy / bcdfz — RLE Multi-Payload Data Files

These three files contain **multiple RLE-compressed payloads** sequentially
concatenated. The compression uses the same RLE scheme as `bcdfv` (see
"RLE Decompression" below). The first payload in each file is preceded by a
32-byte header.

**File sizes:**
| File | Size      | Disk       |
|------|-----------|------------|
| bcdfx | 144,169 B | GAMEDISK2 |
| bcdfy | 117,937 B | GAMEDISK3 |
| bcdfz | 160,806 B | GAMEDISK3 |

#### 32-byte header

bcdfx and bcdfz share an **identical 32-byte header** (verified):

```
15 f8 00 fe 00 ff c0 ff f0 ff fe fe ff f0 ff ff
fe ff fc ff f8 ff f0 ff e0 ff c0 ff 80 ff 00 fe
```

bcdfy's header is offset by one byte: `f8 00 fe 00 ff c0 ff f8 ff ff ff ff...`
All three share the same ramp pattern. Its purpose is unclear (possibly a
lookup table or palette reference).

#### Multi-payload structure

Each file contains multiple RLE-compressed payloads separated by `0x00` stream
terminators. The decompressed payloads have **confirmed dimensions** for all
graphical payloads:

| Payload | Decomp Size | Dimensions | Content |
|---------|-------------|------------|---------|
| P0      | 14,448 B    | 64×301×6bpp | Depth shading lookup table with 32-byte progressive mask header |
| P1      | 42,754 B    | — | Background/fill data (256 unique byte values, not standard image) |
| P2      | 55,536 B    | **208×356×6bpp** | **Floor/ceiling texture atlas** (Wall 0/1/2 + Floor + Ceiling stacked vertically) |
| P3      | 10,780 B    | **320×269×1bit** | **Viewport binary mask** (transparent regions for doors/openings) |
| P4      | 11,580 B    | **80×193×6bpp** | **Left wall side textures** |
| P5      | 11,580 B    | **80×193×6bpp** | **Right wall side textures** (identical size, different content) |
| P6      | 12,460 B (bcdfx) | — | All 0xFF fill (bcdfx only) |
| P7–P9   | 54/1,523/5,393 B (bcdfx) | — | Small data blocks (P9 = all 0x72 fill) |

**bcdfy** is mostly `0xFF` bytes — the first RLE payload produces only 632
decompressed bytes (vs 14,448 for bcdfx/bcdfz), suggesting it contains mostly
empty/fill data with sparse content.

#### bcdfx payload boundaries

| Payload | Offset (raw) | Raw Size  | Decomp Size |
|---------|--------------|-----------|-------------|
| P1      | 0            | 9,730     | 14,448      |
| P2      | 9,731        | 31,188    | 42,754      |
| P3      | 40,920       | 32,165    | 55,536      |
| P4      | 73,086       | 6,572     | 10,780      |
| P5      | 79,659       | 7,408     | 11,580      |
| P6      | 87,068       | 8,901     | 11,580      |
| P7      | 95,970       | 10,865    | 12,460      |

File coverage: 106,884 / 144,169 = 74.1% (remaining ~25% is post-P7 data)

#### bcdfz payload boundaries

| Payload | Offset (raw) | Raw Size  | Decomp Size |
|---------|--------------|-----------|-------------|
| P1      | 0            | 10,988    | 14,448      |
| P2      | 10,989       | 33,839    | 42,754      |
| P3      | 44,829       | 38,295    | 55,536      |
| P4      | 83,125       | 8,226     | 10,780      |
| P5      | 91,352       | 8,225     | 11,580      |
| P6      | 99,578       | 9,953     | 11,580      |
| P7      | 109,532      | 1,515     | 2,387       |

File coverage: 111,443 / 160,806 = 69.3%

#### Payload content

The decompressed payload sizes do not match standard Amiga planar screen
layouts (e.g., 320×200 at 4bpp = 32,000 B). The payloads likely contain:
- Composite bitmap data (tile atlases, sprite sheets)
- Game resource data (item graphics, dungeon textures, UI elements)
- Possibly multiple images per payload with a sub-header

Cross-referencing with Windows VGA `clipper.clp` entries (see `docs/blackcrypt/dos/`)
suggests these payloads may contain the Amiga equivalents of DOS items, monsters,
faces, and dungeon textures.

---

### bcdfv — Sound + Monster Sprite Data (Multi-Block Container)

| Property    | Value                              |
|-------------|------------------------------------|
| File size   | 191,917 B (0x2EDAD)                |
| Compression | RLE (same scheme as bcdfx/bcdfy/bcdfz) |
| Content     | Sound + monster sprite data for all dungeon levels |
| Loaded by   | bcdfu LAB_0033                     |

bcdfu.asm opens `bcdfv` via DOS Open (`-30`) and reads it in sequential
blocks using DOS Read (`-42`). The file is a multi-block container — not a
single compressed screen. All 191,917 bytes are accounted for across two
phases of loading.

#### Phase 1 (intro screens) — overwritten by Phase 2

| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 61   | 1     | $4EB0 (20,144) | RLE | buffer+0 → 32,000B output |
| 68   | 5     | $5067 (20,583) | RLE | $17700 → $BB80 → 48,000B |
| 74   | 6     | $0B10 (2,832)  | RAW | $1A5E0 |
| 76   | 4     | $2500 (9,472)  | RLE | $EA60 → $BB80 |
| 72   | —     | —              | COPY | LAB_003D: $BB80 → buffer+0, 48,000 bytes |

**9× LAB_0022 calls** (intro screens): total $14525 (83,237) bytes.

#### Phase 2 (game data — final buffer state)

| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 131  | 2     | $6754 (26,452) | RLE | $BB80 → buffer+0 (**40,000B output**) |
| 132  | 3     | $678C (26,508) | RAW | $BB80 |
| 148  | 7     | $0A81 (2,689)  | RLE | $EA60 → $BB80 (**4,590B output**, overwrites Block 3 start) |

#### File I/O Pattern (bcdfu.asm)

| Function     | Operation       | Buffer offset | Chunk size  |
|--------------|-----------------|---------------|-------------|
| LAB_0033     | DOS Open "bcdfv"| handle → `28(A5)` | —       |
| LAB_0038     | DOS Read        | `12(A5)`      | 0x4EB0 (20,144) |
| LAB_0039     | DOS Read        | `12(A5)`+?    | 0x6754 (26,452) |
| LAB_003A     | DOS Read        | `12(A5)`+?    | 0x678C (26,508) |
| LAB_003B     | DOS Read        | `12(A5)`+?    | 0x5067 (20,583) |
| LAB_003C     | DOS Read        | `12(A5)`+?    | 0x0B10 (2,832)  |

Each RLE read is followed by a call to LAB_0043 (RLE decompressor).
LAB_003D copies 48,000 bytes from $BB80 to buffer+0.

---

### bcdfr — Full-Screen Images (Title/Intro Screens)

| Property         | Value                                      |
|------------------|--------------------------------------------|
| File size        | 138,560 B                                  |
| Chunk layout     | Set by bcdfq chunk readers (LAB_0022/27/2B/2F) |
| Chunk 1          | 32,000 B — Raven logo (4bpp, 320×200, sequential planar) |
| Chunk 2          | 48,000 B — Title screen (6bpp, 320×200, sequential planar) |
| Chunk 3          | 10,560 B — Black Crypt logo banner (6bpp, 320×44, sequential planar) |
| Chunk 4          | 48,000 B — Intro plot text (6bpp, 320×200, sequential planar) |

Each screen uses its own BPP with sequential planar layout. The palettes are stored
in `bcdfq` (see Palette section):
- Raven logo: 16-color palette at bcdfq `+0x0266` (black + golds + grays)
- Title + Logo: 32-color palette at bcdfq `+0x0286` (white + golds + grays + reds)
- Plot text: 32-color dungeon palette at bcdfq `+0x02C6`

### bcdfo — Character Portraits + UI Elements

| Property         | Value                                      |
|------------------|--------------------------------------------|
| File size        | 63,010 B                                   |
| Loader           | bcdfp LAB_00AB → LAB_00AE (reads entire file) |
| Header           | 96 bytes of `0xFF 0xFF 0xFF 0xFE` repeating |
| Portraits        | 109 tiles × 32×24×6bpp sequential planar, starting at buffer+$60 |
| UI elements      | Stored at assembly-specified offsets (bcdfp LAB_010D descriptor table) |

#### UI Element Descriptor Table (bcdfp LAB_010D — 28-byte entries)

Each entry has a baked-in source offset and tile dimensions:

| Entry | Source Offset | Dimensions | Count | Description |
|-------|---------------|------------|-------|-------------|
| desc00 | `0x5160` (20,832) | 128×105×6bpp | 1 | Character creation UI |
| desc01 | `0x7F50` (32,592) | 192×47×6bpp | 1 | Character gen logo / Enter Crypt UI |
| desc02 | `0xD758` (55,128) | 128×62×6bpp | 1 | Adjust character stats panel |
| desc03–07 | `0xAE68`–`0xB3A8` | 32×14×6bpp | 5 | **Mystic sigils** (spell/ability icons, gold palette 26-30) |
| desc08–11 | `0xB658`–`0xCF18` | 128×22×6bpp | 4 | **Class guild banners** (Fighter, Cleric, Magic User, Druid) |
| desc12–22 | `0xF286`–`0xF5CE` | 16×7×6bpp | 11 | **Numeral font** (gold, for HP/stats display) |

---

### Palette

Three palettes are embedded in `bcdfq`'s CHIP data section at sequential offsets.
The first two are used for title/intro screens; the third is the dungeon gameplay
palette.

#### Title screen palettes (bcdfq 0x0266–0x02C5)

| Offset | Size | Used by | Description |
|--------|------|---------|-------------|
| `0x0266` | 16 × 16-bit | Raven logo (4bpp) | Black, golds, grays |
| `0x0286` | 32 × 16-bit | Title + Logo (6bpp) | White, golds, grays, reds (0x0F00–0x0400) |

#### Dungeon palette (bcdfq 0x02C6)

| Idx | 12-bit  | R   | G   | B   | Swatch              |
|-----|---------|-----|-----|-----|---------------------|
|  0  | `0x000` |   0 |   0 |   0 | Black               |
|  1  | `0xC86` | 204 | 136 | 102 | Amber / skin        |
|  2  | `0xF00` | 255 |   0 |   0 | Red                 |
|  3  | `0xB00` | 187 |   0 |   0 | Dark red            |
|  4  | `0xD80` | 221 | 136 |   0 | Brown               |
|  5  | `0xFE0` | 255 | 238 |   0 | Yellow              |
|  6  | `0x0F0` |   0 | 255 |   0 | Green               |
|  7  | `0x0B0` |   0 | 187 |   0 | Dark green          |
|  8  | `0x040` |   0 |  68 |   0 | Very dark green     |
|  9  | `0x0DD` |   0 | 221 | 221 | Cyan                |
| 10  | `0x00F` |   0 |   0 | 255 | Blue                |
| 11  | `0x07C` |   0 | 119 | 204 | Medium blue         |
| 12  | `0xFD9` | 255 | 221 | 153 | Light tan           |
| 13  | `0xEB8` | 238 | 187 | 136 | Tan                 |
| 14  | `0xF0F` | 255 |   0 | 255 | Magenta             |
| 15  | `0xE09` | 238 |   0 | 153 | Pink                |
| 16  | `0x720` | 119 |  34 |   0 | Dark orange-brown   |
| 17  | `0x952` | 153 |  85 |  34 | Medium brown        |
| 18  | `0xA53` | 170 |  85 |  51 | Light brown         |
| 19  | `0x33B` |  51 |  51 | 187 | Dark blue-purple    |
| 20  | `0x222` |  34 |  34 |  34 | Dark gray           |
| 21  | `0x444` |  68 |  68 |  68 | Gray                |
| 22  | `0x666` | 102 | 102 | 102 | Light gray          |
| 23  | `0x999` | 153 | 153 | 153 | Lighter gray        |
| 24  | `0xCCC` | 204 | 204 | 204 | Very light gray     |
| 25  | `0xFFF` | 255 | 255 | 255 | White               |
| 26  | `0xB60` | 187 | 102 |   0 | Orange              |
| 27  | `0xC70` | 204 | 119 |   0 | Light orange        |
| 28  | `0xC80` | 204 | 136 |   0 | Gold                |
| 29  | `0xD90` | 221 | 153 |   0 | Light gold          |
| 30  | `0xEB0` | 238 | 187 |   0 | Pale gold           |
| 31  | `0xFC0` | 255 | 204 |   0 | Bright gold/yellow  |

The EHB half-bright copies (colors 32–63) are automatically generated by the
Amiga hardware as half-intensity versions of colors 0–31.

**Windows VGA palette:** A palette search in the Windows demo (`crypt.exe`,
`clipper.clp`) did not find a clean 256-color VGA DAC table. The DOS palette
may use 8-bit-per-channel encoding, may be embedded within a larger resource
structure, or may be generated programmatically.

---

### bcdfs Format — Cross-Platform Verification

The Windows VGA demo (`data/blackcrypt/dosvga/maindung.gam`) contains a subset of the
same dungeon data, allowing cross-validation of the Amiga format.

**Confirmed identical:**
- Offset table: Map 1 = `0x00000000`, Map 2 = `0x00003AC7` (same values, stored
  as little-endian 32-bit on DOS vs big-endian on Amiga)
- Maps 3–13 have offset 0 in the DOS file (demo only has 2 maps)
- Map 1 header: `00 00 00 00 1d 00 39` — byte-identical between platforms
- Square data: stored as native-endian 32-bit values. A square `0x00001FF1` is
  `00 00 1F F1` (big-endian Amiga) and `F1 1F 00 00` (little-endian DOS)
- Row format and entity placement follow the same structure

This confirms the bcdfs file format is portable — the only difference is CPU
endianness for multi-byte fields.

---

## Sound Format

### 8SVX (8-bit Sampled Voice)

IFF 8SVX chunks are embedded in `bcdfu` without a containing FORM wrapper.
The raw chunks appear at offset `0x020156`.

**Extracted example: `sky.explosion`**

| Chunk | Size | Content |
|-------|------|---------|
| 8SVX  | 4    | Type ID |
| VHDR  | 20   | OneShot=9872, Repeat=0, Volume=32 |
| NAME  | 20   | `sky.explosion` |
| ANNO  | 20   | `Audio Master` |
| BODY  | 9,872| 8-bit PCM sample data |

### VHDR chunk structure

```
Offset  Size  Type    Description
──────  ────  ──────  ─────────────────────────
0x00    4     uint32  oneShotHiLo (total sample length)
0x04    4     uint32  repeatHiLo (loop start)
0x08    2     uint16  samplesPerSec (playback rate)
0x0A    2     uint16  volume (0–64, default 32)
0x0C    1     uint8   numVoices (0 = use all)
0x0D    1     uint8   padding
0x0E    2     uint16  numOctaves (for instrument use)
```

---

## Music Format

### OctaMED MMD0 Modules

Three MMD0 tracker modules were found in `bcdfu`:

| Module | Offset   | Length  | Notes |
|--------|----------|---------|-------|
| #1     | 0x002130 | 25,212  | |
| #2     | 0x0083AC | 81,696  | Largest module |
| #3     | 0x01C2CC | 25,978  | |

An additional MMD0 module is embedded in `bcdfq`'s CHIP data hunk.

### MMD0 Header

```
Offset  Size  Description
──────  ────  ─────────────────────────
0x00    4     Magic: "MMD0"
0x04    2     Module length (in words?)
0x06    2     Header length (usually 52 = 0x34)
0x08    2     Song length (in positions)
0x0A    2     Instrument data offset
0x0C    2     Sample data offset
0x0E    2     Track data offset / flags
...
```

---

## Text / Narrative

Game text is stored as null-terminated ASCII strings within `bcdfu`'s DATA
hunk. Strings include:

- Victory narrative (e.g., "THROUGH INCREDIBLE BRAVERY AND THE USE OF THE
  POWERFUL OGREBLADE...")
- Menu items (LOAD GAME, SAVE GAME, CONFIGURE KEYBOARD, etc.)
- Error messages (DISK IS WRITE PROTECTED, COULD NOT READ CONFIGURATION FILE)
- Library references (`graphics.library`, `intuition.library`, `dos.library`)
- File paths (`GAMEDISK1:bcdfq`, `GAMEDISK1:bcdfp`, `GAMEDISK1:bcdft`,
  `GAMEDISK2:bcdfu`, `GAMESAVE:`, `OrigDungeons`, `TempDungeons`)

---

## Configuration

`configuration.dat` is 8 bytes:

```
4d 4c 4f 4e 46 5f 01 00
```

The first 6 bytes spell `MLONF_`. Bytes 6–7 contain `0x0100` (keyboard
configuration version?).

---

## Resource Loading Paths

From the disassembly strings and bcdfq self-reading mechanism, the game loads
resources as follows:

```
GAMEDISK1:bcdfp      — code overlay (game logic)
GAMEDISK1:bcdfq      — code overlay + 82KB appended data (intro screens, music engine)
GAMEDISK1:bcdft      — code overlay (LZ77-compressed dungeon data, 7 hunks)
GAMEDISK1:bcdfs      — map / dungeon layout data (read by bcdfp)
GAMEDISK2:bcdfu      — code overlay + music, sound, text (RLE decompressor)
GAMEDISK2:bcdfv      — sound + monster sprite data (multi-block RLE container, 192KB)
GAMEDISK2:bcdfx      — RLE multi-payload (dungeon textures for level 2)
GAMEDISK3:bcdfy      — RLE multi-payload (mostly empty, sparse level data)
GAMEDISK3:bcdfz      — RLE multi-payload (dungeon textures for level 3)
CHARACTERS            — character graphics (read by bcdfp)
OrigDungeons          — dungeon layout data (read by bcdfp)
TempDungeons          — dungeon layout data (written by bcdfp)
GAMESAVE:             — save game directory
Configuration.dat     — keyboard config (8 bytes)
```

bcdfx/bcdfy/bcdfz are NOT opened by name in any code — the texture data they
contain is accessed through bcdfq's self-reading mechanism on each disk.

---

## bcdfs — Map / Dungeon Format

The `bcdfs` file contains all 13 dungeon maps. Its structure has been verified
against the original game file (171,005 bytes).

---
### File-level structure

The game is divided into 13 maps, one for each loading screen transition.

Each map contains:

1. **Offset table** — 52 bytes (13 × 32-bit big-endian offsets). Only filled in
   map 1; maps 2–13 have 52 zero bytes here.
2. **Map header** — 7 bytes (see below).
3. **Map data** — variable-size sequence of rows with squares and interleaved
   entity data.
4. **Padding** — 3,950 bytes of `0x00` (workspace for items placed on floor by
   the player).
5. Repeats 13 times.

**Verified:** All 13 maps have exactly 3,950 zero bytes at their tail.

---

### Offset table (52 bytes, map 1 only)

```
Offset  Size  Description
──────  ────  ────────────────────────────────
0x00    4     Map 1 offset (always 0x00000000)
0x04    4     Map 2 offset
...     ...   ...
0x30    4     Map 13 offset
```

Verified offsets from the original file:

| Map | Offset    |
|-----|-----------|
| 1   | 0x000000  |
| 2   | 0x003AC7  |
| 3   | 0x0087CE  |
| 4   | 0x00D38B  |
| 5   | 0x011FDE  |
| 6   | 0x015CFB  |
| 7   | 0x0198D6  |
| 8   | 0x01D463  |
| 9   | 0x01E8AA  |
| 10  | 0x021EC9  |
| 11  | 0x0231DA  |
| 12  | 0x026CC7  |
| 13  | 0x028736  |

---

### Map header (7 bytes)

```
Offset  Size  Description
──────  ────  ────────────────────────
0x00    3     Unknown (usually 0x000000)
0x03    1     Vertical first row (on the 64×64 grid)
0x04    1     Vertical last row
0x05    1     Horizontal first column
0x06    1     Horizontal last column
```

Example from map 1: `00 00 00 00 1D 00 39`
- Vertical: rows 0–29 (30 rows total)
- Horizontal: columns 0–57 (58 squares per row)

Maps are subdivided into levels on a 64×64 grid. For example, level 1 may
occupy columns 0–27 and level 2 occupies 28–57 on the same map.

---

### Row format

Each row begins with a 2-byte horizontal range, followed by N squares:

```
Offset  Size  Description
──────  ────  ────────────────────────────────
0x00    1     First column in this row
0x01    1     Last column in this row
0x02    4×N   Squares (4 bytes each, N = last - first + 1)
```

Each row can have an independent horizontal range to save space (see the
multi-level examples below). Rows are stored from bottom to top of the 64×64
grid (first row = bottom of map, last row = top).

---

### Square format (4 bytes)

```
Byte 0: [type:4b][0xF]
Byte 1: [0xF][level:4b]
Byte 2: [wall_flags:4b][uniq_hi:4b]
Byte 3: [uniq_lo:8b]
```

| Field       | Bits | Description                                       |
|-------------|------|---------------------------------------------------|
| type        | 4    | Square type: +0 floor, +1 wall, +2 darkness, +4 spell-failed, +8 water |
| level       | 4    | Level number within the 64×64 map                  |
| wall_flags  | 4    | Wall directions on this square: +1 N, +2 E, +4 S, +8 W |
| unique      | 12   | Reference number (0x000 = empty, 0x001–0xFFF = entity follows) |

**Verified:** `1F F1 00 00` = wall (type 1) on level 1, no walls, no entity.
`0F F1 A0 1B` = floor (type 0) on level 1, walls east+west (0xA), entity 0x01B follows.

Square type byte values observed in the file:

| Value | Meaning           |
|-------|-------------------|
| 0x0F  | Floor             |
| 0x1F  | Wall (automap)    |
| 0x2F  | Darkness          |
| 0x4F  | Spell-failed zone |
| 0x8F  | Water             |

Additional observed type values (0x3F–0xFF) reserve the upper nibble (type) while
the lower nibble is always 0xF.

---

### Entity placement (interleaved data)

When a square's 12-bit **unique** field is non-zero, entity data follows
immediately after the square before the next square appears. Entities are
variable-length records whose exact byte count depends on entity type.

The general pattern is:

```
[Square N with unique=X] [Entity data for X] [Square N+1 with unique=0] ...
```

For **single items** (no container, no monster inventory):

```
[Square with unique=N] [~20 bytes item data] [Square with unique=0] ...
```

For **monsters with inventory**:

```
[Square with unique=A] [~40 bytes monster data, chains to unique=B]
  [Item with unique=B] [~20 bytes]
  [Square with unique=0] ...
```

For **containers** (backpack, chest, etc.):

```
[Square with unique=C] [~20 bytes container data, chains to unique=D]
  [Item with unique=D] [~20 bytes]
  [Item with unique=E] [~20 bytes]
  [Square with unique=0] ...
```

For **structures with actions** (switches, pressure plates, alcoves with
triggers):

```
[Square with unique=F] [~20 bytes structure data, chains to unique=G]
  [Actions begin — variable length]
  [Square with unique=0] ...
```

Actions are terminated by a single byte: `0x00` (one-shot) or the action ID
byte of the first action (loop back).

---

### Item bytecode (~20 bytes)

All items share a common 9-byte prefix:

```
Offset  Size  Description
──────  ────  ──────────────────────────────────
0x00    2     gfxNumber (also determines hardcoded weapon stats)
0x02    2     nameOffset (into bcdft)
0x04    1     position on square (N=1, E=2, S=4, W=8; NE=3, SE=6, NW=9, SW=0xC)
              AND class usage (+1 Fighter, +2 Cleric, +4 Druid, +8 Magic User)
0x05    1     itemType (defines the remaining bytes' layout)
0x06    1     position in container (0–7 upper row, 8–15 lower row)
```

The remaining ~9–11 bytes depend on itemType:

| ItemType | Category       | Remaining fields                                   |
|----------|----------------|----------------------------------------------------|
| 0x01     | Weapon         | charges, weight, size, extraDamage, effect, value  |
| 0x02     | Weapon (special)| charges, weight, size, extraDamage, effect, value |
| 0x04     | Spell Scroll   | weight, size, spellType+charges(32b), spellLevel   |
| 0x05     | Potion/Water   | charges, weight, size, maxCharges, effect, waterUnits |
| 0x06     | Key            | weight, size, lockNumber                           |
| 0x07     | Helm           | charges, weight, size, AC, effect, value           |
| 0x08     | Shield         | charges, weight, size, AC, effect, value           |
| 0x09     | Armor          | charges, weight, size, AC, effect, value           |
| 0x0A     | Leggings       | charges, weight, size, AC, effect, value           |
| 0x0B     | Boots          | charges, weight, size, AC, effect, value           |
| 0x0C     | Spellbook      | weight, size, spellSet, classReq                  |
| 0x0E     | Food           | state, weight, size, foodUnits, charges            |
| 0x13     | Container/Bag  | itemFilter, weight, size, nextUniq, maxCapacity, slots |
| 0x15     | Ring           | charges, weight, size, AC, effect, value           |
| 0x18     | Scroll         | weight, size, textNumber, isFalse                  |
| 0x19     | Belt           | charges, weight, size, AC, effect, value           |
| 0x1A     | Amulet         | charges, weight, size, AC, effect, value           |
| 0x1B     | Shirt          | charges, weight, size, AC, effect, value           |
| 0x1C     | Pants          | charges, weight, size, AC, effect, value           |
| 0x23     | Chest/Coffer   | itemFilter, weight, size, nextUniq, maxCapacity, slots |
| 0x24     | Bow            | charges, weight, size, extraDamage, effect, value  |
| 0x25     | Arrow/Dagger   | weight, size, extraDamage, effect                  |
| 0x26     | Death Gem      | weight, size, resurrectClass                       |
| 0x27     | Other/Skull    | weight, size                                       |
| 0x29     | Spellcaster    | charges, weight, size, ?, spell                    |
| 0x2A     | Bracers/Gauntlets| charges, weight, size, AC, effect, value         |
| 0x2B     | Panel Item     | weight, size, panelNumber, itemNumber              |
| 0x2C     | Idol           | weight, size                                       |
| 0x2D     | Crown/Mask     | charges, weight, size, AC, effect, value           |
| 0x30     | Tablet         | readerClass, weight, size, textNumber, effect, value |

**Verified:** Axe found at file offset 0x2779 with bytes
`00 C2 00 8D 02 51 19 01 00 00 00 FA 00 7D 00 00 FF FF 00 00`, matching the
documented `X9 01` position/class layout.

---

### Monster bytecode (~40 bytes)

```
Offset  Size  Description
──────  ────  ────────────────────────────────────────────
0x00    1     Monster marker (0x80) — distinguishes from items
0x01    1     Graphics & sound effects ID
0x02    1     Hit chance / XP randomness (0x00 = almost never miss, 0xFF = almost always miss)
0x03    1     High nibble: door-passing (odd nibble = yes); Low nibble: attack speed (0 slowest, F fastest)
0x04    1     F0 (constant marker)
0x05    1     High nibble: move speed (0 fastest, F slowest); Low nibble: base speed modifier
0x06    1     High nibble: unused; Low nibble: attack method (0/8=none, 2/A=melee, 4/6/C/E=magic; +1=can open doors)
0x07    1     Magic attack intensity (0x00 = melee only)
0x08    2     HP (max ~0x0480; higher values set HP to 1 and disable attack animation)
0x0A    2     Carrying item unique number (0x000 if none)
0x0C    2     Spell set bit flags (+0x0800=party held, +0x1000=possession, +0x2000=flesh-to-stone, +0x4000=disease, +0x8000=poison)
0x0E    1     0x00
0x0F    1     Movement type (0/4/6–A=normal, 1=stationary, 2=teleport, 3=thief, 5=Possessor, B="thank you")
0x10    2     0x0000
0x12    2     Stacking unique number (0x000 if nothing placed after this monster)
0x14    8     0x0000000000000000
0x1C    2     0x0001
0x1E    2     XP gain (maximum from this monster + random component fits in 16 bits)
0x20    2     Attack strength + random XP component
0x22    1     0x00
0x23    1     Position on square (0=NW, 1=NE, 2=SE, 3=SW, 4=center)
0x24    1     0x04
0x25    1     0xFF
0x26    2     0x0000
0x28    1     0x00
```

**Verified:** Rock Eye found at file offset 0xC4 with bytes
`80 B3 02 75 F0 84 0A 00 00 19 00 00 00 00 00 06 00 00 00 00 00 00 00 00 01 00 28 00 19 00 04 00 04 FF 00 00`.
Two Head found at 0x20F7 with bytes
`80 B2 09 3A F0 85 0B 00 00 8C 00 ...`.

Monsters are assigned to specific map files — a monster type can only appear on
the map where it was originally placed.

---

### Structure bytecode (~20 bytes)

Structures are placed like items/monsters via the square unique number chain.
Each has a gfxNumber in bytes 0–1, and a structure type in byte 5.

| Type | Structure          | gfxNumber  |
|------|--------------------|------------|
| 0x0F | Door switch        | 0x0037     |
| 0x10 | Illusionary wall / Glyph / Magic field | varies |
| 0x11 | Door frame         | 0x0035, 0x0036 |
| 0x12 | Stairs / Teleport / Spinner | varies |
| 0x14 | Pit                | 0x003A (floor), 0x003B (ceiling) |
| 0x16 | Alcove             | 0x0039     |
| 0x17 | Pillar             | 0x0038     |
| 0x1D | Switch             | 0x003D, 0x003E, 0x003F |
| 0x1E | Floor plate / Trap | 0x0042 (plate), 0x004A (trap) |
| 0x1F | Fountain / Special panel | 0x0045 (fountain), 0x0046 (panel) |
| 0x20 | Plaque             | 0x0049     |
| 0x21 | Plaque (input)     | 0x001F     |
| 0x22 | Door lock          | 0x0051–0x0053 |
| 0x2E | Monster generator  | 0x00E8     |
| 0x2F | Statue             | 0x00BD     |

**Verified:**
- Door frames (0x0035): 195 instances found with type byte 0x11.
- Switches (0x003E): 33 instances found with type byte 0x1D.
- Floor plates (0x0042): 142 instances with type byte 0x1E.
- Traps (0x004A): 45 instances with type byte 0x1E.
- Alcoves (0x0039): 199 instances with type byte 0x16.
- Door switches (0x0037): 99 instances with type byte 0x0F.
- Illusionary walls (0x00C1, gfx 0x01F3): 37 instances with type byte 0x10.

---

### Action bytecode (7–8 bytes per action)

Structures with action IDs (switches, floor plates, alcoves with triggers,
plaque inputs, special panels) are followed by action records. The `00 00`
terminator after the structure is replaced by the action chain.

```
Offset  Size  Description
──────  ────  ─────────────────────────────────
0x00    1     Action ID (unique number 0x01–0xFF per map, sorted by position)
0x01    1     Action type (see table below)
0x02    1     Clicks to trigger this action
0x03    1     Target width (column on 64×64 grid)
0x04    1     Target height (row on 64×64 grid)
0x05    1     Maximum runs (0xFF = infinite)
0x06    1     Delay (non-linear values)
0x07    1     Action value (wall direction, monster gen source square, map number, etc.)
```

**First action in a chain is 7 bytes** (no action ID — the ID is in the
structure field). Subsequent actions are 8 bytes with their own IDs.

| Action | Description                       |
|--------|-----------------------------------|
| 0x00   | Spell-failed toggle               |
| 0x01   | Spell-failed on                   |
| 0x02   | Spell-failed off                  |
| 0x03   | Pillar toggle                     |
| 0x04   | Pillar on                         |
| 0x05   | Pillar off                        |
| 0x06   | Pit toggle                        |
| 0x07   | Pit on                            |
| 0x08   | Pit off                           |
| 0x09   | Teleport/Spinner toggle           |
| 0x0A   | Teleport/Spinner on               |
| 0x0B   | Teleport/Spinner off              |
| 0x0C   | Trap (pressure plate) toggle      |
| 0x0D   | Trap (pressure plate) on          |
| 0x0E   | Trap (pressure plate) off         |
| 0x0F   | Wall toggle                       |
| 0x10   | Wall on                           |
| 0x11   | Wall off                          |
| 0x12   | Monster generator trigger         |
| 0x13   | Party held                        |
| 0x14   | Items drop                        |
| 0x15   | Teleportation                     |
| 0x16   | Switch/Plate/Alcove trigger on    |
| 0x17   | Switch/Plate/Alcove trigger off   |
| 0x18   | Door toggle                       |
| 0x19   | Door off                          |
| 0x1A   | Door on                           |
| 0x1C   | Trap damage (fire)                |
| 0x1D   | Trap damage (ice)                 |
| 0x1E   | Teleport + dungeon color change   |
| 0x1F   | Dungeon color change              |
| 0x20   | Magic field/Glyph/Illusion toggle |
| 0x21   | Magic field/Glyph/Illusion on     |
| 0x22   | Magic field/Glyph/Illusion off    |

**Action chain termination:** After the last action, a single byte follows:
- `0x00` — one-shot, no loop
- Action ID matching the first action — loops back to the beginning

**Verified:** Switch structure `00 3E 00 00 10 1D 00 00 00 00 00 00 00 [actionID] 00 00 00 00`
followed by `00 00` or action bytes matches the documented patterns.
Floor plate actions begin with 7-byte records (e.g., `0B 01 0C 25 01 00 00` for
"teleport off, 1 click, target 0x0C,0x25, 1 run, no delay, no value").

---

## Executable Data Tables

Disassembly (IRA) of the game overlays revealed several runtime data tables
embedded in the executables.

### Item Table (`bcdfp` DATA section, offset ~0x585C)

Default item definitions are stored in `bcdfp`'s DATA hunk using the same
~20-byte format as items placed in the dungeon (`bcdfs`). Verified items:

- War Hammer (`0x0007`), Apple (`0x0014`), Brown Pants (`0x002E`),
  Yellow Pants (`0x0033`), Holding Bag (`0x001C`), and others.

The byte-level format matches the dungeon item format exactly — the same
gfxNumber, weight, size, AC, and extra effect fields appear at the same
offsets. Most items have a `0x80` prefix byte (monster/item marker).

### Class Definitions (`bcdfp` DATA section)

Four character classes are defined with human-readable names:

| Class       | Data Offset | Stats (Str,Dex,Con,Int,Wis,Cha)           |
|-------------|-------------|-------------------------------------------|
| FIGHTER     | 0x57B2      | 14, 8, 6, 12, 10, 25                     |
| CLERIC      | 0x57D8      | 12, 8, 14, 6, 10, 25                     |
| MAGIC USER  | 0x57FE      | 8, 14, 6, 12, 10, 25                     |
| DRUID       | 0x5824      | 6, 8, 12, 10, 14, 25                     |

Each class entry is preceded by ~18 bytes of stat data and a variable-length
null-terminated name string.

### Tile Table (`bcdfp` DATA section, offset ~0x566C)

Nine tile descriptor records define the dungeon viewport rendering:

```
[2B ID] [2B ?] 00 20 00 18 [2B index] 00 00 [2B offset] [2B ptr]
```

Each record includes the tile dimensions (`0x0020` = 32, `0x0018` = 24),
an index value (0–9), and pointers to the tile graphics data in `bcdfa`.

### Monster Data

Monster statistics were **not found** in any executable DATA section. Monsters
appear to be defined only at placement time in the dungeon file (`bcdfs`),
with per-instance stats (HP, XP, attack strength, spell flags) embedded in the
~40-byte monster records. Core monster behavior (AI, attack patterns) is
hardcoded in the game code.

### Palette Variants (`bcdfu`)

Four 32-color palettes are embedded in `bcdfu` at offsets `0x03C8`, `0x0408`,
`0x0448`, and `0x0488`. Colors 0–25 are identical across all variants;
colors 26–31 change (shifting from orange-gold tones to red-blue tones).
These likely correspond to different dungeon areas or lighting presets.

---

## Extracted Assets

```
data/blackcrypt/
├── sky_explosion.8svx       (8-bit PCM, 9872 B)
├── music_1.mmd0            (MMD0 tracker, 25,216 B)
├── music_2.mmd0            (MMD0 tracker, 81,700 B)
├── music_3.mmd0            (MMD0 tracker, 25,982 B)
├── bcdfa_render.png        (tile sheet, 640×432, palette placeholder)
└── amiga/
    ├── bcdfa … bcdfz       (raw game data files)
    ├── BlackCrypt           (main executable, 12,700 B)
    ├── configuration.dat    (keyboard config, 8 B)
    ├── BlackCrypt.asm       (IRA disassembly)
    ├── bcdfp.asm            (IRA disassembly)
    ├── bcdfq.asm            (IRA disassembly)
    ├── bcdft.asm            (IRA disassembly)
    ├── bcdfu.asm            (IRA disassembly — contains RLE decompressor at LAB_0043)
    └── adf/
        ├── Disk 1.adf       (901,120 B, OFS, GAMEDISK1)
        ├── Disk 2.adf       (901,120 B, OFS, GAMEDISK2)
        └── Disk 3.adf       (901,120 B, OFS, GAMEDISK3)
```
