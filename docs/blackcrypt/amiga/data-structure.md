# Black Crypt — Amiga Data Structures

## Overview

Black Crypt (1992, Raven Software / Electronic Arts) is a first-person dungeon
crawler for the Amiga. It uses the Amiga's EHB (Extra Half-Brite) display mode
(6 bitplanes, 64 colors).

> **Correction —** this section previously also claimed the game "supports
> anaglyph 3D glasses." No evidence for that claim has ever been found in the
> disassembly, the extracted data, or any consulted source — it appears to
> have been an unfounded detail with no basis, and has been removed.

The game files are stored in a flat directory of 26 files named `bcdfa`–`bcdfz`,
alongside the main executable `BlackCrypt` and a small `configuration.dat`.

**Status of monster sprite extraction: SOLVED.** All 204 monster sprites across
all 13 dungeon levels extract byte-exactly. See the `bcdfb`–`bcdfn` and Palette
sections for the corrected format (the key fix: the RLE stream starts at byte
**1402**, not `0x4A4`).

**Status of item icon extraction: SOLVED.** All 180 item icons (24×24 @ 6bpp,
no mask) live in two RLE streams inside `bcdfa`. See "bcdfa — Item Icon Bank".

---

## Ground-truth oracle: emulator savestates as a chip-RAM dump

`data/blackcrypt/default*.uss` are Amiberry/WinUAE savestates taken at the four
captured screenshots. Each one carries the machine's **entire 2 MB of chip
RAM**, which makes them a static, offline oracle at least as strong as a live
emulator session and far cheaper — no booting, no IPC, no permission gate.

Parsing is trivial: walk the file's 4-byte chunk tags, find `CRAM`, read
`size / flags / uncompressed_size` as three big-endian longs at `+4`, then
zlib-inflate from `+16`. Colour registers come from the `AGAC` chunk as 256
big-endian `0x00RRGGBB` longs starting at `+4` of the chunk body (registers
0–31 are the real OCS palette; 32–63 in that dump are AGA-bank noise on an OCS
machine — generate EHB yourself).

Two things this unlocks that file analysis alone cannot:

1. **Byte-exact confirmation of a decompressed bank.** If your RLE output is
   correct, the whole decompressed block appears verbatim somewhere in chip
   RAM. `ram.find(decompressed)` either returns an address or it does not —
   there is no "looks right" in between. This is how the 75,600-byte item bank
   was confirmed at `$7D918` in three savestates at once.
2. **Finding an unknown sprite's geometry from the screen.** Take the on-screen
   pixels of the sprite, and search chip RAM for a bitmap that reproduces them
   under an unknown (row-stride, bit-shift) pair; the addresses of the
   individual bitplane hits then give the plane spacing for free. Both banks in
   `bcdfa` were located this way before either was identified in the files.

Two traps this document paid for:

- **Ambiguous index recovery.** Mapping a screenshot's RGB back to palette
  indices is *not* injective under EHB: register 22 (`0x666`) and EHB register
  56 (half of `0xCCC`) are both RGB `0x666666`, as are 20 and 53 at `0x222222`.
  A first attempt to locate the paperdoll armour "found" only planes 0 and 4 —
  which are exactly the two bit positions where 22 and 56 agree. Compare in
  **RGB**, or restrict the constraint set to unambiguous colours.
- **Copper palette splits.** The screenshots are not a single palette. The 3D
  viewport runs a different accent ramp from the side panel, so ~2,000 pixels
  of `default-3` do not map to the `AGAC` registers at all. Confine index
  recovery to the region you care about.

---

## File Inventory

| File             | Size      | Type                        | Loader      | Notes                              |
|------------------|-----------|-----------------------------|-------------|------------------------------------|
| `BlackCrypt`     | 12,700 B  | HUNK executable             | AmigaDOS    | Opens overlays + config            |
| `bcdfa`          | 197,894 B | BCSPEED effects + **item icons** | **bcdfq**   | **Mixed** container, at least four blocks: `.GFK` = one RLE stream at `+0x0DFFB` → 73 sprites, 16×16 mask+6bpp EHB (**solved**); `.PRG` = 34 **uncompressed** script records; **item icon bank** = RLE streams at `+0x1B5B3` (175 icons) and `+0x2FE5C` (5 icons), 24×24 @ 6bpp, no mask (**solved**); **chest-armour paperdoll bank** = RLE stream at `+0x2D05E`, 19 × 32×29 @ 6bpp, no mask (**solved**); **dungeon-floor item sprites** = RLE stream at `+0x270C4` → 31,388 B, 147 masked variable-size sprites = 49 items × 3 view depths, geometry from a 10-byte descriptor table in `bcdft` S_1 `+0x271B6` (**solved**); **large equipment-panel art** = 7 records inside the RLE stream at `+0x036FD`, 48-px rows, 6bpp, no mask (**solved**; the rest of that stream is other UI art at 32/16/80-px widths, unclassified). Not a flat run of RLE streams. |
| `bcdfb`–`bcdfn`  | 48–72 KB  | RLE monster sprites (per dungeon level) | **`bcdft` S_1 `+0x21E7E`** | 12-byte header + 42 × 28-byte directory + 214-byte raw table + one RLE stream from offset **1402**. 7 sequential planes (mask + 6bpp EHB) per sprite. **204 sprites extracted, verified.** |
| `bcdfo`          | 63,010 B  | Character portraits + UI elements | bcdfp        | **Fully accounted (0 remainder).** **36** portraits × 32×24×6bpp at offset $60 (corrected from an earlier miscount of 109), 23 **7-plane masked** UI elements at bcdfp `LAB_010D` descriptor offsets, three 8×8 fonts (`0x9E28`/`0xA148`/`0xA320`) and the mouse-pointer sprite bank (`0xA028`) — see the bcdfo section |
| `bcdfp`          | 23,960 B  | HUNK overlay (CODE+DATA)    | BlackCrypt   | All 3D rendering, blitter routines, BCSub, item/class tables, save/load |
| `bcdfq`          | 87,220 B  | HUNK overlay + appended data | BlackCrypt  | Intro screens + music engine. Holds 3 palettes at file `0x0266` / `0x0286` / `0x02C6` (gold accent variant) |
| `bcdfr`          | 138,560 B | Full-screen images (4 screens, per-screen BPP) | bcdfq | 32KB Raven (4bpp, 320×200) + 48KB Title (6bpp, 320×200) + 10,560B Logo (6bpp, 320×44) + 48KB Plot (6bpp, 320×200) — chunk sizes from bcdfq LAB_0022/27/2B/2F |
| `bcdfs`          | 171,005 B | Dungeon/map data            | bcdfp        | Read in `LAB_0022/27/2B` chunks    |
| `bcdft`          | 85,684 B  | HUNK overlay (7 hunks)      | BlackCrypt   | LZ77-compressed **game code + data** — not just data. Decompresses (musashi emulator) to S_1 (166,676 B: action dispatcher, dungeon display kernel, **the 12-entry dungeon accent-ramp table at `0x27B00`**, item names, strings, quest text, colour-cycling tables at `0x1E6A4`) and S_2 (40,808 B: the `A4` small-data segment with the **13-entry per-level palette table at `0x39E`**). **NOT** textures. |
| `bcdfu`          | 141,388 B | HUNK overlay (GAMEDISK2:)   | BlackCrypt   | **Endgame/epilogue sequence player** (CODE hunk 0 is a complete standalone program: 10 narrative screens + credits, then `RTS`). Also carries the shared RLE decompressor (`LAB_0043`), music/sound and text. Its **5 palettes** at file `0x03EC`–`0x04EC` are the *epilogue screen* palettes — copies of entries 0–4 of the real 12-entry dungeon ramp table in `bcdft` |
| `bcdfv`          | 191,917 B | **Endgame/epilogue sequence data** | bcdfu        | 16 sequentially-read blocks, all sizes byte-exact: congratulations screen, picture frame, 8×8 font (59 glyphs), 10 × 160×99×6bpp narrated panels, Black Crypt facade intact + destroyed, 240×153 1bpp credits. **Solved** — contains no monster sprites and no sound (see bcdfv section) |
| `bcdfw`          | 457 B     | Workbench drawer icon       | —            | `0xE3100001`                       |
| `bcdfx`          | 144,169 B | RLE multi-payload (GAMEDISK2) | **`bcdft` S_1 `+0x1DD16`** | Dungeon tileset — **levels 1–4 (accent ramp 0, tan) and 12–13 (ramp 3, grey)**. Directory = 12 chunks at S_1 `+0x1DE10`, Σ = 144,169 exactly. **All 12 chunks decoded — 84 named sub-images (83 pixel images + the door-clip stencil), 100 % byte coverage.** See the bcdfx/y/z section |
| `bcdfy`          | 117,937 B | RLE multi-payload (GAMEDISK3) | **`bcdft` S_1 `+0x1DD16`** | Dungeon tileset — **level 5 only (accent ramp 1, violet/plum)**. Genuinely partial: directory = **7** chunks at S_1 `+0x1DE5A`, Σ = 117,937 exactly — **47 of the 84 sub-images**, all decoded; it lacks the pit, alcove, plaque, panel/fountain and button chunks only |
| `bcdfz`          | 160,806 B | RLE multi-payload (GAMEDISK3) | **`bcdft` S_1 `+0x1DD16`** | Dungeon tileset — **levels 6–11 (accent ramp 2, bone/cream)**. Directory = 12 chunks at S_1 `+0x1DE86`, Σ = 160,806 exactly. Same 12-chunk structure as bcdfx, all 84 sub-images decoded |
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

#### VBlank Handler `LAB_00D3` — phase chain (confirmed)

> **Correction:** the block previously documented here as the "Monster Sprite
> Rendering Pipeline", together with its "Key A5 Offsets for Monster Sprite
> Rendering" table, was **wrong in its entirety**. The code at `bcdfp+0x2AE8`
> (file-relative; hunk0-relative `0x2AC0`) is the **scrolling message ticker
> and palette colour-cycler**, not a sprite pipeline. It never touches bcdfv,
> never calls a blitter, and `A5+$03C2/$03C6/$03CE` are **copper-list
> pointers**, not sprite buffers. The corrected decode is below. Nothing in
> this region has anything to do with monster sprites; do not re-derive a
> sprite pipeline from it.

All offsets below are **file-relative** in `bcdfp`; hunk0 CODE begins at file
`0x28`, so `hunk_addr = file_off − 0x28`. Decoded from the raw bytes with
capstone (IRA's text for this region is unreliable — see "inline parameter
blocks" below for *why*).

`LAB_00D3` (`bcdfp+0x2716`) is the level-2 VBlank interrupt handler:

```asm
2716  MOVEM.L D0-D7/A0-A6,-(A7)
271A  MOVEA.L $35F6(PC),A5      ; A5 = GLOBAL frame  (LAB_010B slot)
271E  MOVEA.L $450(A5),A6       ; A6 = $DFF000 custom chip base
2722  NOT.B   $459(A5)          ; frame parity toggle
2726  ADDQ.W  #1,$45A(A5)       ; frame counter
272A  PEA     $2758.L           ; ── push 9 phase-handler addresses ──
2730  PEA     $2D56(PC)
2734  PEA     $2AE8(PC)         ;    (the "ticker" phase, ex-"sprite pipeline")
2738  PEA     $40AC(PC)
273C  PEA     $2784(PC)
2740  PEA     $292A(PC)
2744  PEA     $28A0(PC)
2748  PEA     $2788(PC)
274C  PEA     $2DF4(PC)
2750  BRA.W   $27E2             ; enter first phase
2754  MOVEA.L (A7)+,A0          ; ← every phase ends with BRA $2754
2756  JMP     (A0)              ;   pop next phase address and run it
```

**Confirmed.** This is a PEA-chain phase dispatcher, not a jump table. Each
phase returns by `BRA $2754`, which pops the next handler off the stack.

#### `A5` is a single global frame, private to `bcdfp` (confirmed)

`A5` is **never** `LINK`ed in this handler or anywhere on the path into it.
Every one of the **8** `MOVEA.L (d16,PC),A5` instructions in `bcdfp` loads
from the *same* longword slot, `LAB_010B` at `bcdfp+0x35F6` (hunk0 `0x35CE`).
That slot is written once, at `LAB_00A1` (`bcdfp.asm:2641`, `bcdfp+0x2090`):

```asm
2096  MOVE.L  #$00000464,D0     ; frame size = 1124 bytes
209C  MOVE.L  #$00010000,D1     ; MEMF_CLEAR
20A2  MOVEA.L $4.W,A6
20A6  JSR     -198(A6)          ; AllocMem
20AA  LEA     $35F6(PC),A0      ; LAB_010B
20AE  MOVEA.L D0,A5
20B0  MOVE.L  D0,(A0)           ; publish the global frame pointer
```

Invariant: the frame is `$464` = 1124 bytes and the **highest offset any
instruction touches is `$45A`** (word) → `$45C` ≤ `$464`. Zero deviation.

> **Correction — the frame is NOT shared across overlays.** Earlier notes
> assumed `BlackCrypt`, `bcdfp`, `bcdfq`, `bcdft` and `bcdfu` all address one
> common `A5` area. They do not. Counting `MOVEA.L (d16,PC),A5` vs `LINK A5`
> across the binaries: `bcdfp` 8 / 33, `BlackCrypt` 0 / 28, `bcdfq` 0 / 0,
> `bcdft` 0 / 0, `bcdfu` 0 / 1. Only `bcdfp` maintains a global `A5` frame;
> `BlackCrypt`'s `A5` uses are ordinary **LINKed C stack frames**. The two
> frames are provably different structures: `bcdfp` `A5+0` is the bcdfo buffer
> pointer, whereas `bcdfu` `A5+0` is **`dos.library` base**
> (`MOVEA.L 0(A5),A6; JSR -30(A6)` = Open, `bcdfu.asm:LAB_0033`). Likewise
> `bcdfu`'s `12(A5)` bcdfv read buffer is unrelated to `bcdfp`'s `12(A5)`
> 1536-byte allocation. Any cross-overlay reasoning based on a shared `A5` is
> invalid.

#### `bcdfp` global `A5` frame map (confirmed)

Built by `LAB_00A1`–`LAB_00A8` (`bcdfp.asm:2641-2708`) via three loops:

| Offset (hex) | Contents | Size / evidence |
|--------------|----------|-----------------|
| `$00` | → **bcdfo** buffer | `$F622` = 63,010 = bcdfo file size |
| `$04` | → ticker display bitmap | `$2A0` = 672 = 42 B/row × 2 planes × 8 rows |
| `$08` | → ticker staging bitmap | `$150` = 336 = 42 B/row × 1 plane × 8 rows |
| `$0C` | → misc buffer | `$600` = 1536 |
| `$10` | → misc buffer | `$100` = 256 |
| `$14` | → misc buffer | `$1000` = 4096 |
| `$18` | → misc buffer | `$A0` = 160 |
| `$1C` | → misc buffer | `$1A0` = 416 |
| `$20` | → misc buffer | `$40` = 64 |
| `$24` | screen memory base | passed in `D0` |
| `$28`–`$3C` | screen 1, bitplanes 0–5 | base + n×`$1F40` (8000) |
| `$40`–`$54` | screen 2, bitplanes 0–5 | base + n×`$1F40` |
| `$58` | → **3D-viewport save-under buffer** | `$5550` = 21,840 = **208×140×6bpp** |
| `$5C` | → buffer | `$600` = 1536 |
| `$60` | → buffer | `$200` = 512 |
| `$64` | → ticker character ring buffer | `$50` = 80 (index wraps at `$4F`) |
| `$68` | `dos.library` base | used by `LAB_00AE` Open/Read/Close |
| `$70` | `graphics.library` base | `OpenLibrary`, LVO −552 |
| `$3DC` | → screen-1 bitplane pointer array | read by `LAB_011E`, save/restore |
| `$3E0` | → screen-2 bitplane pointer array | |
| `$408` `$40A` `$40E` `$410` `$414` | rect-blit params: BLTxMOD, src offset, BLTSIZE, dest plane stride, dest offset | |
| `$45C` / `$460` | adjusted return address / inline-parameter pointer | see below |
| `$450` | `$DFF000` custom chip base | `LAB_00A2`, `bcdfp.asm:2659` |
| `$459` / `$45A` | frame parity byte / frame counter word | |

The three buffer sizes at `$04`, `$08` and `$64` are each **independently
re-derived** from the ticker code below and match the `AllocMem` table
`LAB_009F` (`bcdfp.asm:2631`) exactly — zero deviation.

#### `bcdfp+0x2AE8` — message ticker + colour cycling (confirmed)

```asm
2AE8  TST.W   $43C(A5)          ; message display timer
2AEC  BNE     $2AFC
2AEE  MOVEA.L $3CE(A5),A0       ; → copper list BPLCON0 data word
2AF2  MOVE.W  #$1000,(A0)       ; BPU=1  (hide ticker)
2AF6  MOVE.B  #$01,$3D9(A5)
2AFC  MOVEA.L $3BE(A5),A0       ; → fine-scroll counter byte
2B00  TST.B   $3D8(A5)          ; text pending?
2B06  SUBQ.B  #4,(A0)           ;   yes → scroll 4 px/frame
2B16  SUBQ.B  #1,(A0)           ;   no  → scroll 1 px per 2 frames
2B1C  MOVE.B  #$0F,(A0)         ; reload counter
2B20  BSR.W   $2C1E             ; fetch next 2 glyphs → A0, A1
2B24  MOVE.W  $3D6(A5),D3       ; D3 = column byte offset, 0..$28 step 2
2B28  MOVEA.L $4(A5),A4         ; A4 = 672-byte ticker bitmap
2B2C  LEA     (A4,D3.W),A4
      ;  ── 8 unrolled rows, one per font scanline ──
      MOVE.B (A0),$2A(A4) / MOVE.B (A0)+,(A4)+     ; glyph A → plane1, plane0
      MOVE.B (A1),$2A(A4) / MOVE.B (A1)+,(A4)+     ; glyph B → plane1, plane0
      LEA    $52(A4),A4                            ; next row (+84 = 2×42)
2BB0  ADDQ.W  #2,D3
2BB2  CMPI.W  #$2A,D3           ; wrap at 42 bytes = 336 px
2BB8  MOVEQ   #0,D3
2BBA  MOVE.W  D3,$3D6(A5)
2BC0  ADD.L   $4(A5),D3         ; D3 = bitmap + column offset
2BC4  MOVEA.L $3C2(A5),A2       ; → COPPER LIST (bitplane pointer pair)
2BC8  MOVE.W  D3,$6(A2)         ;   BPLxPTL data word
2BCE  MOVE.W  D3,$2(A2)         ;   BPLxPTH data word  (after SWAP)
```

**Geometry, confirmed by exact size match:** 42 bytes/row × 2 bitplanes ×
8 rows = **672 bytes = `$2A0`**, the `A5+$04` allocation, to the byte. The
copper bitplane pointer is re-pointed to `bitmap + D3` each step, giving
hardware horizontal scroll; `D3` cycles 0…`$28` in steps of 2 (21 columns ×
16 px = 336 px = 42 bytes), so the ticker wraps exactly one row width.

Glyph fetch (`bcdfp+0x2C1E` / `0x2C3E`):

```asm
2C3E  MOVEA.L $64(A5),A0        ; 80-byte character ring buffer
2C42  MOVE.W  $3D4(A5),D1       ; read index
2C46  CMP.W   $3D2(A5),D1       ; write index — equal ⇒ empty
2C4E  MOVE.B  (A0,D1.W),D0
2C56  MOVE.W  #$4F,D1           ; ring wraps at 79  ⇒ 80 entries = $50 ✓
2C5E  SUBI.W  #$20,D0           ; char − ' '
2C62  LSL.W   #3,D0             ; × 8 bytes per glyph
...
2C28  MOVEA.L $0(A5),A0         ; bcdfo buffer
2C2C  ADDA.L  #$9E28,A0         ; + font base
```

Colour cycling, same phase (`bcdfp+0x2C00`, and again at `0x2D1C`):

```asm
2C00  LEA     $257C(PC),A0      ; palindromic colour ramp table
2C04  LSL.W   #4,D0            ; 16 bytes (8 words) per ramp entry
2C08  MOVEA.L $3C6(A5),A1       ; → COPPER LIST
2C0C  ADDQ.L  #6,A1
2C10  MOVE.W  (A0)+,(A1)        ; patch 8 colour registers,
2C12  LEA     $C(A1),A1         ;   12-byte stride (every 3rd copper MOVE)
```

A second ramp table at `bcdfp+0x260C` patches the same copper list at `+$A`.
This is the **torch-flicker animation** and matches the colour-cycling data
already documented at `bcdfp+0x257C`. **`A5+$03C6` is a copper list, not a
bcdfv sprite buffer** — and there is no bcdfv sprite buffer at all; see the
bcdfv section.

#### Inline parameter blocks — why IRA mis-renders `bcdfp` (confirmed)

`bcdfp` uses a **inline-argument call convention**: the caller does
`BSR routine` immediately followed by *N bytes of data*, and the routine reads
its own return address as a data pointer, then bumps it past the data before
returning. Example, the rectangle save/restore setup at `bcdfp+0x3DC2`:

```asm
3DCC  MOVE.L  (A7),$460(A5)     ; A5+$460 = pointer to the inline rectangle
3DD0  MOVE.L  (A7)+,$45C(A5)    ; A5+$45C = return address
3DD4  ADDQ.L  #8,$45C(A5)       ; …advanced past 8 bytes of inline data
3DDE  MOVEA.L $460(A5),A2       ; A2 → DC.W X, Y, W, H
3DE2  MOVE.W  #$140,D0
3DE6  SUB.W   $4(A2),D0         ; 320 − W
3DEA  LSR.W   #3,D0
3DEC  MOVE.W  D0,$408(A5)       ; BLTxMOD = (320−W)/8
3DF0  MOVE.W  $2(A2),D0         ; Y
3DF4  MULU    #$28,D0           ; ×40
3DF8  MOVE.W  (A2),D1           ; X
3DFA  LSR.W   #3,D1
3DFE  MOVE.L  D0,$40A(A5)       ; source byte offset = Y×40 + X/8
3E02  MOVE.W  $6(A2),D0         ; H
3E06  LSL.W   #6,D0
3E08  MOVE.W  $4(A2),D1         ; W
3E0C  LSR.W   #4,D1
3E10  MOVE.W  D0,$40E(A5)       ; BLTSIZE = (H<<6)|(W/16)
...
3E7C  JMP     (A0)              ; return via A5+$45C (= retaddr + 8)
```

**This, not a disassembler bug, is the main reason large stretches of `bcdfp`
appear in the IRA listing as `DC.L` blobs and impossible opcodes** (`BCLR`,
`EORI`, …): they are genuine 8-byte `DC.W X,Y,W,H` rectangles sitting *inside*
the instruction stream. Any future disassembly pass must resynchronise after
each such call. The previously recorded "IRA disassembly quirk" note should be
read in this light.

#### 3D viewport save-under (confirmed)

Two 6-plane blitters at `bcdfp+0x3E28` and `bcdfp+0x3E7E` use minterm `$09F0`
(`D = A`) to copy a rectangle between the screen bitplanes and the packed
buffer at `A5+$58`:

- `0x3E28`: BLTAPT = screen plane + `$40A`, BLTDPT = `A5+$58` + `$414`,
  BLTAMOD = `$408`, BLTDMOD = 0 → **save screen rect → packed buffer**.
- `0x3E7E`: the reverse → **restore packed buffer → screen rect**.

The buffer is `$5550` = 21,840 bytes = **208 × 140 × 6bpp** exactly, and
`LAB_0124`'s vertical clip constant is `SUBI.W #$8C,D1` (140) at
`bcdfp+0x3C60`. Two independent confirmations that the **3D viewport is
208 × 140 pixels** — the same 208-pixel width as the `bcdfx`/`bcdfz` P2
texture atlas.

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

> **Correction: bcdfq does NOT open itself.** The claim below (previously
> "confirmed") that LAB_0019 opens `"bcdfq"` by filename was checked directly
> against the disassembly and the raw binary and is **wrong**. `LAB_001C` —
> the only filename string LAB_0019 ever loads into `A0` before the `Open()`
> call — is literally `DC.B "bcdfr",0` (`bcdfp.asm:339`), not `"bcdfq"`.
> `strings -a bcdfq` confirms the *only* embedded filename in the entire file
> is `bcdfr`; there is no `"bcdfq"` byte sequence anywhere in the binary.
> LAB_0019/LAB_001D open and close **`bcdfr`** (matching the "bcdfr" entry in
> the File Inventory table above — 138,560 B, 4 full-screen images), and
> LAB_0022/LAB_0027/LAB_002B/LAB_002F read bcdfr's 4 screen chunks
> (32,000/48,000/10,560/48,000 = 138,560 B, exactly bcdfr's file size) into a
> working buffer at `$BB80`. This is the *complete* explanation for how
> bcdfr's screens get loaded — it has nothing to do with bcdfq's own appended
> CHIP data.
>
> The appended 81,908 bytes after bcdfq's HUNK code are therefore **not**
> read via any self-Open() — they are ordinary CHIP-allocated DATA that is
> already resident in memory the moment AmigaOS's `LoadSeg()` loads the
> overlay (same mechanism that makes the embedded MMD0 module and palettes
> directly addressable via `A4`-relative offsets elsewhere in this doc). No
> "level-specific texture" theory for bcdfx/bcdfy/bcdfz follows from this —
> those files are opened normally from the decompressed `bcdft` image via the
> patched `"bcdf?"` filename template (S_1 `+0x1DD16`), selected per level.
> See the File Loading Summary correction below and the Palette section's
> "Dungeon tileset selection".

### bcdfu (overlay)

```
Hunk 0: CODE
Hunk 1: DATA
```

Contains 3 MMD0 music modules, 8SVX sound effects, game narrative text
strings, and **five palette accent variants**.

The five palettes sit at **file** offsets `0x03EC`, `0x042C`, `0x046C`, `0x04AC`
and `0x04EC` (64 bytes each, 32 × 16-bit Amiga colour registers). All five share
the identical fixed core described in the Palette section — they differ **only**
at indices 19 and 26–31, supplying alternative accent ramps (brown, blue-grey,
stone/olive, neutral grey, blue). See the Palette section for the full table.

> Earlier notes listed four palettes at `0x03C8 / 0x0408 / 0x0448 / 0x0488`.
> Those are **CODE**-relative offsets; file offsets are `+0x24`, and there are
> five, not four. The separate claim of a "monster palette at file `0x2C6`" is
> incorrect — that offset falls inside the library-name strings.

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
class/race data, game logic tables, **one 32-word palette variant at `0x1E886`
(stone/olive accent ramp)**, and **colour-cycling tables at `0x1E6A4`** —
groups of 8 palindromic ramps (e.g. `0940 0b62 0d83 0fa4 0d83 0b62 0940 0940`)
used for animated torch flicker and similar effects. The same cycling data is
mirrored in `bcdfp` at `0x257C`. Three 16-colour palettes also appear at
`0x1E560` / `0x1E580` / `0x1E5A0`, differing only in entries 9–12.
**NOT** wall/floor pixel textures — those come from bcdfx/y/z as
RLE-decompressed 6bpp planar bitmaps. The `0x1E886` ramp was once proposed as
*the* dungeon palette; it is a copy of accent ramp **2**.

> **Correction:** and the follow-up claim that "the table the dungeon view
> actually uses is in `bcdfu`" is also wrong. `bcdfu` is the epilogue overlay
> and only carries copies. The **authoritative 12-entry accent-ramp table and
> the live 32-word dungeon palette are inside this file's own decompressed S_1
> image**, at `+0x27B00` and `+0x27AC0` respectively — the dungeon renderer,
> the copper-list builder and `SetDungeonPalette` all live here too. See
> "Dungeon accent-ramp selection (confirmed)" in the bcdfx/y/z section.

`bcdft` is therefore **not** a passive data carrier: its decompressed hunks
hold the bulk of the game's executable code (the action dispatcher, the dungeon
display kernel, the level tables). It has no strings or library imports *in the
compressed container* — 7 hunks, no DOS library calls, no file I/O of its own —
because everything is inside the compressed payload.

**Decompression**: Achieved by running the actual S_4 code (496 bytes of 68k)
inside a [musashi](https://github.com/kstenerud/musashi) CPU emulator.
See `tools/bcdft_decompress/` for the build/run:
```bash
cd tools/bcdft_decompress && bash build.sh run
```
Output: **two** files, to both `data/blackcrypt/extracted/` and
`build/cache/blackcrypt/`:

| File | Hunk | Size | Non-zero | Content |
|------|------|------|----------|---------|
| `bcdft_decompressed.bin` | S_1 | 166,676 B | 138,541 B (last at `0x28B13`) | game code + graphics/string data |
| `bcdft_s2_data.bin` | S_2 | 40,808 B | 2,705 B | small-data segment — every `x(A4)` global and per-level table (`A4 = S_2 + 0x7FFE`) |

> **Correction — the decompression used to be silently truncated.**
> `emu.c` ran the engine for a *fixed* `m68k_execute(20000000)` cycles and then
> dumped whatever was in memory. The engine actually needs ~25–30M cycles. The
> old artifact therefore stopped at S_1 `+0x1FEE0` (only **113,853** non-zero
> bytes, ~21 % of the hunk missing) **and skipped the relocation-fixup pass**,
> so every absolute address in the decompressed code was left unrelocated —
> which is why `JSR $26900.l`-style targets used to point into an all-zero
> region and looked like dead ends. `emu.c` now loops until the PC leaves the
> S_4 engine and errors out if it never does; it also dumps S_2, which the
> harness previously discarded even though it holds all the game's globals.
> Byte offsets of everything previously documented in S_1 are **unchanged**
> (spot-checked at `0x1E560`, `0x1E6A4`, `0x1E886` — byte-identical); the fix
> only adds the missing tail and fixes up address longwords.

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
| bcdfv | bcdfu `LAB_0033` | `bcdfu.asm:545` (`DC.B "bcdfv",0`) | Endgame/epilogue sequence data |
| bcdfb–bcdfn | **`bcdft` S_1 `+0x21E7E`** | decompressed `bcdft` | 13 dungeon level graphic stores; filename letter = `0x62 + (level−1)` |
| bcdfa | `bcdft` S_1 `+0x1DBD2` / `+0x1DD16` | decompressed `bcdft` | UI/BCSPEED bank |
| **bcdfx** | **`bcdft` S_1 `+0x1DD16`** | decompressed `bcdft` | Tileset, levels 1–4 + 12–13 |
| **bcdfy** | **`bcdft` S_1 `+0x1DD16`** | decompressed `bcdft` | Tileset, level 5 |
| **bcdfz** | **`bcdft` S_1 `+0x1DD16`** | decompressed `bcdft` | Tileset, levels 6–11 |

> **Correction — "bcdfa/bcdfx/bcdfy/bcdfz: loader UNKNOWN, exhaustively
> searched" was a false negative, and so was the guess that `bcdfu` loads the
> tilesets.** The search was for literal filename strings, which cannot succeed:
> the game stores **one** template `"bcdf" 'a' 0` at S_1 `+0x1DE0A` in the
> *decompressed* `bcdft` image and patches its final byte before each `Open()`.
> That is also why the search felt exhaustive — every raw overlay really does
> lack the strings. Two patch sites exist:
>
> - **S_1 `+0x21E7E`** — `D0 = (level−1) + 0x62` → `bcdfb`…`bcdfn`, the 13
>   per-level graphic stores (level 1 → `bcdfb`, level 13 → `bcdfn`).
> - **S_1 `+0x1DD16`** — `D0 = param + 0x77` → `bcdfw`/`bcdfx`/`bcdfy`/`bcdfz`
>   for param 0/1/2/3. Called from the level-entry routine at S_1 `+0x1A5CC`.
>
> Confirmed independently of any disassembly by a directory-sum invariant: each
> tileset's chunk table (S_1 `+0x1DE10`/`+0x1DE5A`/`+0x1DE86`) sums to exactly
> the corresponding file's byte size, 3/3, zero deviation. Full detail in the
> Palette section's "Dungeon tileset selection".
>
> `bcdfw` (457 B, GAMEDISK1) is the fourth member of the same family (param 0)
> but is never opened by the three level-entry call sites.
>
> **`bcdfw`'s purpose — SOLVED: it is a Workbench drawer icon, unrelated to
> the tileset-template mechanism beyond a coincidental byte match.** The
> "param 0" framing above is a red herring — nothing in the game ever calls
> `OpenTilesetFile` with `D0=0`. Byte-searched the whole decompressed S_1
> image for the exact `JSR $9DD6E.l` opcode that all 3 known level-entry
> call sites (`+0x1A60C`/`+0x1A636`/`+0x1A666`) use to reach
> `OpenTilesetFile` at `+0x1DD16` (runtime base `0x80058`, confirmed by all
> 3 sites resolving to exactly that file offset) — **exactly 3 hits, the 3
> already known**, zero others anywhere in S_1. So the `0x77+0='w'` slot in
> that function is provably dead code, not a live path to `bcdfw`.
>
> `bcdfw`'s own bytes settle it independently: it starts `E3 10 00 01` —
> the standard AmigaOS `DiskObject` magic (`0xE310`) + version 1, i.e. a
> real `.info`-format Workbench icon, not tileset data at all. The `do_Type`
> byte (file offset `0x30`, after the 44-byte `Gadget` struct) is `0x02` =
> `WBDRAWER`. Its `Gadget` bounding box (`LeftEdge=54, TopEdge=36,
> Width=42, Height=25, Flags=5, Activation=3, GadgetType=1`) is
> byte-identical to `BlackCrypt.info`'s (the game executable's own icon,
> also on GAMEDISK1) — same image dimensions, different embedded pixel
> data. `disk.info` (the volume icon) is `do_Type=1` (`WBDISK`) by
> contrast, confirming the type byte is meaningful, not coincidental.
>
> The clinching evidence: `InstallCrypt` (the GAMEDISK1 installer program)
> contains the literal string **`"GAMEDISK1:bcdfw"`**, sitting directly
> among its `"Copying file `"` / `"Configuration.dat"` progress-message
> strings — i.e. the installer's own file list explicitly names and copies
> `bcdfw` to the destination during setup, exactly as expected for a
> `WBDRAWER` icon meant to be renamed to `<installdir>.info` so the newly
> created game folder gets a custom Workbench icon. `strings -a` on every
> other Amiga overlay/executable in the corpus finds zero `"bcdfw"`
> references — it is genuinely installer-only, never opened by the running
> game.
>
> Verified 3 ways: (1) exhaustive absolute-JSR byte census of `OpenTilesetFile`
> call sites — 3/3 accounted for, 0 extra; (2) `DiskObject` header parse —
> magic, version, and `do_Type` all match the standard Workbench icon format
> exactly, with `do_Type=WBDRAWER` distinguishing it from the volume icon
> (`WBDISK`) and the executable icons (`WBTOOL`); (3) the installer's own
> embedded filename string, found via `strings` on `InstallCrypt` (unpacked
> from `data/blackcrypt/amiga/adf/...Disk 1...adf` via `xdftool`).

**Re-verified independently** (a later session re-asked "how are bcdfx/y/z
loaded, no `Open()` string exists anywhere?" and re-derived the same answer
from the bytes). `OpenTilesetFile` at S_1 `+0x1DD16` disassembles to:

```asm
1DD16  MOVEM.L D2-D5/A2/A5-A6,-(A7)
1DD1A  BSR.W   $2030E               ; A5 := *(S_1+$2099E), A6 := $50C(A5)
1DD1E  MOVEQ   #0,D5
1DD20  MOVE.W  D0,D3                ; keep the tileset index
1DD22  ADDI.W  #$77,D0              ; 1->'x', 2->'y', 3->'z'  ('w' for 0)
1DD26  LEA     $1DE0A(pc),A0        ; the one template, "bcdf" 'a' 0
1DD2A  MOVE.B  D0,$4(A0)            ; patch the 5th byte in place
1DD2E  MOVE.L  A0,D1
1DD30  MOVE.L  #$3ED,D2             ; MODE_OLDFILE (1005)
1DD36  MOVEA.L $F0(A5),A6           ; DOSBase
1DD3A  JSR     -$1E(A6)             ; Open()
...
1DD48  LEA     $1DE10(pc),A2        ; directory for D0 = 1  (bcdfx)
1DD4C  SUBQ.W  #2,D3
1DD4E  BMI.B   $1DD5C
1DD50  BEQ.B   $1DD58
1DD52  LEA     $1DE86(pc),A2        ; D0 = 3  (bcdfz)
1DD56  BRA.B   $1DD5C
1DD58  LEA     $1DE5A(pc),A2        ; D0 = 2  (bcdfy)
1DD5C  ... per-chunk loop: Read() into $78(A5)+$BB80, then either
       RLE-expand (BSR $21E5C) into (A5,D2.w) or Read() straight into it
```

So the `strings` search was not merely a false negative, it was searching for
something that never exists in any build: the filename is assembled one byte at
a time on the stack-resident template and the file is closed again at
`1DDF8`. The three angles that would have found it are (a) looking for
`MOVE.B Dn,d8(An)` immediately before an `Open()` LVO `-30` call, (b) noticing
that `GAMEDISK2:`/`GAMEDISK3:` *do* exist in the decompressed `bcdft` image and
tracing their `PEA` sites, or (c) the directory-sum invariant, which confirms
the mapping with no disassembly at all.

#### File Loading Summary (WHDLoad version)

Only these files are ever loaded by name:

| File | Loaded By | Contents |
|------|-----------|----------|
| bcdfp | BlackCrypt (LoadSeg) | Game logic, blitters, save/load |
| bcdfq | BlackCrypt (LoadSeg) | Intro screens, music engine |
| bcdft | BlackCrypt (LoadSeg) | LZ77-compressed game data (item names, strings, quest text, tables — 85KB) |
| bcdfu | BlackCrypt (LoadSeg) | Endgame/epilogue player; also carries the shared RLE decompressor and a 4-channel music player |
| bcdfo | bcdfp (LAB_00AE) | 36 portraits + UI graphics (63KB) |
| bcdfs | bcdfp (LAB_0047) | Map data (all 13 maps, NOT a save file) |
| bcdfv | bcdfu (LAB_0033) | Endgame/epilogue sequence data (192KB) — screens, font, panels, credits |
| Configuration.Dat | BlackCrypt | Game config (8 bytes) |

bcdfb–bcdfn (13 files) are the per-map monster sprite + sound stores. They are
opened by name from the *decompressed* `bcdft` image via the patched `"bcdf?"`
template (S_1 `+0x21E7E`), which is why a raw-overlay string search finds
nothing — see the correction above. They have nothing to do with bcdfv.
bcdfx/bcdfy/bcdfz are the three dungeon tilesets, opened by name from the
decompressed `bcdft` image via the patched `"bcdf?"` template (S_1 `+0x1DD16`);
see the loader-table correction above.

### Original floppy disk layout (ADF directory)

Confirmed via installer text on Disk 1 (offset ~427500) and ADF filesystem:

| Disk 1 (GAMEDISK1:) | Disk 2 (GAMEDISK2:) | Disk 3 (GAMEDISK3:) |
|----------------------|----------------------|----------------------|
| bcdfa, bcdfo | bcdfb, bcdfc, bcdfd | bcdff, bcdfg, bcdfh |
| bcdfp, bcdfq | bcdfe, bcdfm, bcdfn | bcdfi, bcdfj, bcdfk |
| bcdfr, bcdfs, bcdft | bcdfu, bcdfv, bcdfx | bcdfl, bcdfy, bcdfz |
| bcdfw (icon) | — | — |
| configuration.dat | — | — |

> **Correction — `GAMEDISK3:` does exist, and the disk layout is exactly what
> the tileset selector requires.** "The `GAMEDISK3:` string does not appear in
> any disassembled binary, so disk 3 files are likely opened with the default
> current directory" is wrong on both halves. Both volume strings live in the
> *decompressed* `bcdft` image, adjacent: `"GAMEDISK2:"` at S_1 `+0x1D9CF` and
> `"GAMEDISK3:"` at S_1 `+0x1D9DA`, and the level-entry routine at S_1
> `+0x1A5CC` `PEA`s whichever one the current level needs before opening its
> tileset. `bcdfx`/`bcdfy`/`bcdfz`'s loading path is no longer unknown — see the
> loader-table correction above.
>
> The physical layout is a hard constraint that corroborates the selector:
> GAMEDISK2 carries `bcdfb`,`c`,`d`,`e`,`m`,`n` (levels 1–4, 12, 13) and exactly
> one tileset, `bcdfx`; GAMEDISK3 carries `bcdff`…`bcdfl` (levels 5–11) and
> exactly two, `bcdfy` + `bcdfz`. No level ever needs a tileset from the other
> disk. Verified with `xdftool <adf> list` on all three images.

#### ADF disk images

Three ADF files exist at `data/blackcrypt/amiga/adf/`:
- All 901,120 bytes each (standard 880 KB DD format)
- Valid Amiga OFS/FFS filesystem (`DOS\0` boot sector signature at sector 0)
- Root block at sector 880
- Filenames confirmed via string search: Disk 1 has bcdfa/bcdfp/bcdfq/bcdfr/bcdfs/bcdft/bcdfo/bcdfw; Disk 2 has bcdfb/bcdfc/bcdfd/bcdfe/bcdfm/bcdfn/bcdfu/bcdfv/bcdfx; Disk 3 has bcdff/bcdfg/bcdfh/bcdfi/bcdfj/bcdfk/bcdfl/bcdfy/bcdfz

#### bcdfq self-reading mechanism — RETRACTED, was never confirmed

> **Correction:** this entire subsection was wrong and is kept only so the
> dead end isn't repeated. It claimed bcdfq opens itself by name ("bcdfq" at
> `LAB_001C`) and that each disk's bcdfq copy therefore carries level-specific
> texture data explaining bcdfx/y/z. Neither claim survives a direct check:
>
> - `LAB_001C` is `DC.B "bcdfr",0` (`bcdfp.asm:339` — labels are shared across
>   `bcdfq.asm`/`bcdfp.asm` line numbering in this repo's IRA output, the
>   string itself lives in `bcdfq`'s own overlay data), not `"bcdfq"`.
> - `strings -a -n4 data/blackcrypt/amiga/bcdfq` finds exactly one filename in
>   the entire file: `bcdfr`. There is no `"bcdfq"` byte sequence anywhere in
>   the binary for it to open itself with.
> - LAB_0019/LAB_002F etc. are simply bcdfq's loader for **bcdfr** (see the
>   correction earlier in this document, in the "bcdfq (overlay with CHIP
>   data)" section) — the four chunk sizes they read (32,000 + 48,000 +
>   10,560 + 48,000 = 138,560 B) equal bcdfr's file size exactly.
>
> The appended 81,908 B of CHIP data in bcdfq is ordinary memory-resident
> overlay data (music/8SVX/palettes, per the rest of this section), not a
> chunked, re-opened texture stream. ~~**How bcdfx/bcdfy/bcdfz actually get
> loaded is still an open question**~~ — do not repeat the self-Open() theory.
> **Resolved:** they are opened by `bcdft`'s own code (S_1 `+0x1DD16`) using a
> runtime-patched `"bcdf?"` filename template, chosen per dungeon level; see
> the File Loading Summary correction and "Dungeon tileset selection".

---

### bcdfa — Container Directory — **SOLVED**

> **Correction — supersedes every "bcdfa has no known loader" claim in this
> document** (previously at the BCSPEED table's "Loaded by: UNKNOWN" row,
> the "Which overlay loads bcdfa" open-question rows, and the "Remaining
> Unclassified Ranges" paths-tried table). bcdfa **is** loaded by name, and
> it carries a full in-executable container directory — the same mechanism
> already documented for bcdfx/bcdfy/bcdfz — that was simply never looked
> for under bcdfa's own name before now.

`OpenBcdfaFile` at decompressed `bcdft` S_1 **`+0x1DBD2`** is structurally
identical to `OpenTilesetFile` at `+0x1DD16` (same `MODE_OLDFILE`/DOSBase/
`Open()` LVO `-30` idiom, same per-chunk Read-then-maybe-RLE-expand loop at
`+0x78(A5)+$BB80`), except it hardcodes the filename instead of taking a
parameter — it patches the shared `"bcdf" 'a' 0` template's byte 4 to
literal `0x61` ('a') rather than `0x62+level` or `0x77+param`. Disassembly
(r2, `data/blackcrypt/extracted/bcdft_decompressed.bin`):

```asm
1DBD2  LEA     $1DE0A(pc),A0        ; the one shared "bcdf" 'a' 0 template
1DBD6  MOVE.B  #$61,$4(A0)          ; patch byte 4 -> 'a' (re-asserts it)
1DBDC  MOVE.L  A0,D1
1DBDE  MOVE.L  #$3ED,D2             ; MODE_OLDFILE (1005)
1DBE4  MOVEA.L $F0(A5),A6           ; DOSBase
1DBE8  JSR     -$1E(A6)             ; Open()
1DBEC  MOVE.L  D0,D4                ; file handle
1DBEE  BNE.B   $1DBF4
1DBF0  MOVEQ   #1,D5
1DBF2  BRA.B   $1DC4C               ; error path
1DBF4  LEA     $1DC54(pc),A2        ; the container directory
1DBF8  MOVEQ   #0,D3
1DBFA  MOVE.W  (A2)+,D3             ; size word; 0 terminates
1DBFC  BEQ.B   $1DC42
1DBFE  TST.W   (A2)+                ; compressed flag
1DC00  BEQ.B   $1DC2C               ; 0 -> raw Read() branch
1DC02  MOVE.L  $78(A5),D2
1DC06  ADDI.L  #$0000BB80,D2        ; scratch read buffer (same as OpenTilesetFile)
1DC0C  MOVE.L  D4,D1
1DC0E  MOVEA.L $F0(A5),A6
1DC12  JSR     -$2A(A6)             ; Read() into the scratch buffer
1DC16  MOVEA.L $78(A5),A0
1DC1A  ADDA.L  #$0000BB80,A0
1DC20  MOVE.W  (A2)+,D2             ; slot word
1DC22  MOVEA.L (A5,D2.W),A1         ; A1 = *(A5+slot) -- the destination pointer var
1DC26  BSR.W   $21E5C               ; RLE-expand(src=A0, dst=A1)
1DC2A  BRA.B   $1DBF8
1DC2C  MOVE.W  (A2)+,D2             ; raw-copy branch: slot word again
1DC2E  MOVE.L  (A5,D2.W),D2         ; D2 = *(A5+slot) (still holds size in D3)
1DC32  MOVE.L  D4,D1
1DC34  MOVEA.L $F0(A5),A6
1DC38  JSR     -$2A(A6)             ; Read(handle, *(A5+slot), size) -- straight into the buffer
```

13 directory entries at S_1 **`+0x1DC54`**, the *exact* same 3-big-endian-word
shape as `bcdfxyz.CHUNK_DIRECTORIES` (size-in-file, compressed flag,
A5-relative destination-pointer slot), zero-size terminated:

```
36 fd 00 01 00 00   38 50 00 01 00 04   70 ae 00 00 00 28   27 7e 00 01 00 2c
0a 68 00 01 00 e0   4d ac 00 01 00 b4   4e e3 00 00 00 e8   07 43 00 00 00 ec
bb 11 00 01 00 d4   5f 9a 00 01 00 30   2d fe 00 01 00 dc   02 66 00 01 00 d8
04 44 00 00 00 34   00 00 (terminator)
```

Independently parsed and re-summed programmatically
(`bclib.bcdfa.read_container_directory`): **13 entries, summing to exactly
197,894 bytes — bcdfa's real file size, zero deviation**, same evidentiary
bar as bcdfx/y/z's 3/3 directory-sum confirmations.

#### The 13 entries (confirmed)

| # | File range | Raw size | Comp | Slot | Decoded | Content | Status |
|---|-----------|----------|------|------|---------|---------|--------|
| 0 | `0x00000`-`0x036FD` | 14,077 | RLE | `0x00` | 18,932 | UI panel bank | **confirmed** (existing section) |
| 1 | `0x036FD`-`0x06F4D` | 14,416 | RLE | `0x04` | 18,184 | Large equipment-panel art | **confirmed** (existing section) |
| 2 | `0x06F4D`-`0x0DFFB` | 28,846 | **raw** | `0x28` | 28,846 | Effect sound bank (PCM) | **confirmed** (existing section) — `comp=0` now directly explains why this was never RLE |
| 3 | `0x0DFFB`-`0x10779` | 10,110 | RLE | `0x2C` | 16,576 | BCSPEED.GFK | **confirmed** (existing section) |
| 4 | `0x10779`-`0x111E1` | 2,664 | RLE | `0xE0` | 4,288 | **Four fonts**: 8×8 1bpp message-log (64 glyphs), 4×5 micro (59), 8×8 mask (59), 8×8 6bpp colour (59) | **confirmed** — all four regions have consumer code and the sizes sum to 4,288 exactly; see "bcdfa — Mono Font Bank" below |
| 5 | `0x111E1`-`0x15F8D` | 19,884 | RLE | `0xB4` | 34,340 | Multi-purpose UI/graphics resource bank — tail `0x7CA0`-end is the **29 key icons** (confirmed) | **partly open** — 15 consumer sites mapped to exact sub-record offsets; see below |
| 6 | `0x15F8D`-`0x1AE70` | 20,195 | **raw** | `0xE8` | 20,195 | **BCSPEED.EFF** — 95 effect particle-emitter scripts (DOS: `"Speed Effects"`) | **confirmed** — see "bcdfa — BCSPEED.EFF" below |
| 7 | `0x1AE70`-`0x1B5B3` | 1,859 | **raw** | `0xEC` | 1,859 | BCSPEED.PRG | **confirmed** (existing section) |
| 8 | `0x1B5B3`-`0x270C4` | 47,889 | RLE | `0xD4` | 75,600 | Item icon bank 0 | **confirmed** (existing section) |
| 9 | `0x270C4`-`0x2D05E` | 24,474 | RLE | `0x30` | 31,388 | Dungeon-floor item sprites | **confirmed** (existing section) |
| 10 | `0x2D05E`-`0x2FE5C` | 11,774 | RLE | `0xDC` | 13,224 | Chest armour paperdoll bank | **confirmed** (existing section) |
| 11 | `0x2FE5C`-`0x300C2` | 614 | RLE | `0xD8` | 2,160 | Item icon bank 1 | **confirmed** (existing section) |
| 12 | `0x300C2`-`0x30506` (EOF) | 1,092 | **raw** | `0x34` | 1,092 | **Throwing-item projectile sprites** — Arrow + Dagger, 3 depths × 2 facings, 16 px, 7 planes (DOS: `"Start Throwing Items"`) | **confirmed** — see "`0x300C2`–EOF tail" below |

**All 13 entries account for 100% of the file, with no gap and no overlap.**
Ten of the thirteen land byte-exact on decoded sizes this document already
confirmed independently, by completely different methods (marker-string
search, chip-RAM byte comparison, DOS cross-reference) — this is strong
independent confirmation of the directory itself, not just a parse that
happens to balance.

Slots `0xD4` and `0xDC` are cross-confirmed a second way: they are the
*exact* displacements the item-icon and chest-armour consumer code
(documented in their own sections below) already uses —
`MOVEA.L $D4(A5),A1` / `MOVEA.L $DC(A5),A1` — found independently, before
this directory was known, by tracing `MULU.W #$1B0`/`#$2B8` call sites.

> **Correction — resolves a "chest armour size looks inconsistent" concern
> raised while checking this directory.** A hand-computed running total
> mis-attributed entry 9 (raw 24,474 → decoded 31,388, actually the
> **floor-item bank**) to chest armour, making the real armour entry's raw
> size (11,774 → decoded 13,224) look mismatched by comparison. There is no
> inconsistency: entry 10 (`0x2D05E`, 11,774 raw → 13,224 decoded, RLE
> ratio 1.12×) is chest armour, entry 9 (`0x270C4`, 24,474 raw → 31,388
> decoded, ratio 1.28×) is the floor-item bank, and both ratios are
> unremarkable for this codec.

#### Why this was missed for so long

Every earlier "no `Open()` string for bcdfa" search was a literal-filename
`strings` search — the same failure mode already documented and corrected
for bcdfx/y/z and bcdfb-n: the game never stores the literal string
`"bcdfa"` anywhere except as one byte-patch target inside the *decompressed*
`bcdft` image, so a raw-overlay string search was guaranteed to find
nothing regardless of whether a loader existed. Once bcdfx/y/z's
"one shared template, several patch sites" mechanism was confirmed, the
same technique applied to bcdfa immediately (a fourth patch site, hardcoded
rather than parameterised) — this is the fourth and last such site.

---

### bcdfa — BCSPEED Effect Animations — **SOLVED**

| Property         | Value                                      |
|------------------|--------------------------------------------|
| File size        | 197,894 B                                  |
| Structure        | **Mixed container** — a 13-entry in-executable directory (see "bcdfa — Container Directory" above); some entries RLE-compressed (bcdfu `LAB_0043`), others stored raw |
| Content          | BCSPEED: spell/projectile effect sprites (`.GFK`) + animation scripts (`.PRG`), plus 11 other banks — see the container directory table above |
| Loaded by        | `bcdft` S_1 `+0x1DBD2` (`OpenBcdfaFile`) — see "bcdfa — Container Directory" above |
| Extractor        | `scripts/bclib/bcdfa.py`, driven by `scripts/render_all.py` |
| Assets           | `public/assets/blackcrypt/amiga/sprites/bcspeed.{png,json}` — 73 frames |

**BCSPEED** is the game's effect-animation system — a small particle engine.
It spans **three** container entries, each with its own pointer table inside
the executable (all three relocated together by `InitBcspeedTables` at S_1
`+0x25536`):

| Bank | Entry | Slot | Table | Holds |
|------|-------|------|-------|-------|
| `.GFK` | 3 | `0x2C` | `+0x2594A` (16) | the 16×16 sprite frames (73 across 16 records) |
| **`.EFF`** | **6** | **`0xE8`** | **`+0x2598A` (95)** | **the 95 effect particle-emitter scripts** (DOS: `"Speed Effects"`) |
| `.PRG` | 7 | `0xEC` | `+0x258C2` (34) | the 34 per-particle movement scripts |

An effect script (`.EFF`) walks a list of ticks; each tick spawns particles,
and each particle names a `.GFK` sprite + frame, a `.PRG` movement script, and
a spawn position. None of the three is executable code.

> **Correction — the "887 RLE streams" model is wrong.** bcdfa is *not* a flat
> run of RLE streams that can be split by scanning for `0x00` terminators from
> offset 0. It is a mixed container: the `.PRG` block is stored **uncompressed**
> (running the RLE decoder over it shreds the marker strings into bogus fill
> runs), and the `.GFK` block is a single RLE stream that starts at a specific
> offset, not at an arbitrary terminator boundary. Splitting the whole file
> blindly produced 477 pseudo-streams under the current shared decoder (887
> under an older one) — a number with no structural meaning. Locate the blocks
> by their marker strings instead.

#### BCSPEED.GFK — effect sprites (**confirmed**)

One continuous RLE stream. It begins at the byte **immediately before** the
first `BCSPEED\0GFK\0` marker, at file offset **`bcdfa+0x0DFFB`** (file-relative).
That byte is the stream's first control byte (`0x53` = literal run of 41), which
emits the first record header; the stream terminates on its own `0x00` at
`bcdfa+0x10778`.

Decoded size **16,576 B**, holding 16 records back to back with no container
header and **zero trailing slack**.

| Offset | Size        | Field                                 |
|--------|-------------|---------------------------------------|
| +0x00  | 12          | `BCSPEED\0GFK\0`                      |
| +0x0C  | 2           | frame count, big-endian (2–6)         |
| +0x0E  | count × 224 | frames, 224 bytes each                |

Each 224-byte frame is a **16×16 sprite in 7 sequential bitplanes** — plane 0 is
the 1-bit cookie-cut mask, planes 1–6 a 6bpp EHB colour index into the `game`
palette. This is the *same* convention as the bcdfb–bcdfn monster sprites, so
`bclib.decode_masked(frame, 16, 16, 6)` reads it unchanged.

**73 frames across 16 records** (3, 5×8, 3, 5, 4, 5, 6, 5, 2).

Content, in order: bee/wasp; blue 4-point star; red fireball→ring; red
starburst; yellow fireball→ring; green star; green star burst; blue ice burst;
red flames; green fly; red spiky ball; skull; blue cross; yellow serpent; red
bolt cluster; small blue mote.

Records 0 and 9 (the two insects) are the only ones whose colour planes carry a
non-zero **background** outside the mask — a uniform index 35 (EHB half-bright
of 3 → RGB 85,0,0). The mask cookie-cuts it on Amiga; the DOS port renders the
same background literally. Everywhere else `plane0 == OR(planes 1..6)` exactly.

> **Correction — supersedes "32×14 @ 4bpp, 333-byte preamble, 74 frames".**
> The earlier reading started the RLE stream at `bcdfa+0xDEAB`, where a **336-byte
> uncompressed table** (signed bytes, range −14…+17 — a movement/delta table)
> sits ahead of the compressed block. Decoding that raw table as RLE desyncs the
> decoder: it invents fill runs (122×`0x3F`, 124×`0x67`, 102×`0x41`), swallows
> real data bytes as control bytes, and only resynchronises just before the
> *second* record. The symptoms were a phantom "333-byte preamble", a first
> record 281 bytes too long, and one garbage sprite. The `0x01` control byte the
> old parse consumed at `bcdfa+0xDFA9` is the tell: `LAB_0043` would read it as
> a literal run of `(0>>1)−1` = 65,535, so a valid stream can never contain it.
> Same trap as `MONSTER_STREAM_START` in bcdfb–bcdfn — a raw table between a
> header and the stream that follows it.
>
> The old `count × 224` arithmetic happened to survive the desync for 15 of 16
> records, which is why "32×14 × 4 planes = 224" looked like a fit. It is a
> coincidence of byte count: 224 = 16/8 × 16 × 7 as well. The 4bpp reading also
> required this file to be the only asset in the game without a mask plane or
> EHB — that anomaly was the clue.

##### Verification (ground truth)

| Check | Result |
|-------|--------|
| Record sizing | `gap == 14 + 224 × count` for **16/16** records, zero deviation |
| Stream closure | decoded length 16,576 == Σ record sizes exactly; **0** trailing bytes; stream's own `0x00` terminator lands exactly at the end |
| Codec sanity | **0** degenerate `0x01` control bytes (the old parse had them) |
| Mask invariant | `plane0 == OR(planes 1..6)` for **1,073/1,168** rows — 100% on 14/16 records, the 2 exceptions being the background-filled insects |
| **Cross-platform oracle** | DOS VGA `clipper.clp` yields **73** spell-effect frames, all **16×16** — same count, same size, same order |
| DOS silhouette match | **17,152 / 17,152 opaque-pixel comparisons agree (100.000%)** across the 67 non-background-filled frames |
| DOS background colour | on the 6 background-filled frames, every off-mask pixel is Amiga index 35 (85,0,0) and DOS RGB (87,0,0) — 150/150, 126/126, 138/138, 173/173, 141/141, 162/162 |
| Extractor regression | committed atlas vs. verified probe: **0** differing RGBA components across 73 frames |

#### BCSPEED.PRG — animation scripts (**confirmed sizing**)

Stored **uncompressed**; 34 records at `bcdfa+0x1AE70` … `bcdfa+0x1B566`.

| Offset | Size      | Field                                        |
|--------|-----------|----------------------------------------------|
| +0x00  | 12        | `BCSPEED\0PRG\0`                             |
| +0x0C  | 2         | record count, big-endian                     |
| +0x0E  | count × 3 | 3-byte records: tag byte, then two signed bytes |

Record sizing is **confirmed**: distance to the next marker equals
`14 + 3 × count` for **33/33** measurable gaps, zero deviation. The record
size of 3 is independently re-confirmed by the engine's own per-tick advance
`ADDQ.L #$3,(A2,D6.W)` at S_1 `+0x256AC`, and the bank's 34 records by the
34-entry pointer table at S_1 `+0x258C2` (all **34/34** entries land exactly
on a `BCSPEED\0PRG\0` marker).

Tag bytes seen are `0x40`, `0xFF`, `0x44` and `0x3C`, with `0x3C` last in all
**34/34** records. The **two signed bytes are confirmed dx/dy deltas**: at S_1
`+0x256DC`–`+0x25708` the `0xFF` tag path adds them to the particle's `x` and
`y` and kills the particle if it leaves the viewport. Non-`0xFF` tags are
dispatched through `JMP (A0,D0.W)` at `+0x256CE` against a 4-byte-entry jump
table at `+0x2576C` — i.e. the tag byte is a **pre-multiplied byte offset**,
the same convention BCSPEED.EFF uses for its PRG index. The individual
handlers are not traced; `0x3C` is the end/kill case by position.

> **Correction — supersedes "the mapping from script to GFK record is not
> confirmed".** There is no script→GFK mapping to find: the two are bound at
> *emitter* level, not statically. BCSPEED.EFF (container entry 6) supplies
> both, per particle, in one 6-byte record — see "bcdfa — BCSPEED.EFF".

`bclib.prg_records` exposes the records without interpreting them.

> **Correction — supersedes "283 keyframes across streams 708–739, 7 action
> types".** Those stream indices and the `0x0009/0x000b/0x000d/0x0010/0x0013/`
> `0x0015/0x001f` "action type" tags came from RLE-decoding a region that is not
> compressed. The real count is 34 records; the values previously read as action
> types are the big-endian record *counts* (`0x09`, `0x0B`, `0x10`, `0x13`,
> `0x1F` are all counts appearing in the raw headers), mis-tabulated as an
> enumeration.

#### Still open

| Question | Status |
|----------|--------|
| Rest of bcdfa | Down to two container-directory entries (5, 6) plus a 1,092 B tail (entry 12) — see "bcdfa — Container Directory" above, which supersedes this row |
| PRG tag byte semantics + GFK linkage | **Mostly closed** — dx/dy semantics and the `0xFF` tag confirmed at `+0x256DC`; tags are jump-table byte offsets (`+0x2576C`), individual handlers untraced. GFK linkage is per-particle via BCSPEED.EFF, not a static mapping |
| Which overlay loads bcdfa | **SOLVED** — `bcdft` S_1 `+0x1DBD2` (`OpenBcdfaFile`); see "bcdfa — Container Directory" above |
| `gfxNumber` → item-icon index mapping | Strongly supported as a direct 0-based index; see the item icon section below |

> **Correction — bcdfa is not "BCSPEED only".** The region previously written
> off as `0x1B5B4–end` "not classified" is in fact the game's **entire item
> icon bank** (180 icons), and `0x036FD–0x06F4C` holds the larger
> equipped-item paperdoll graphics. See the two sections below. bcdfa's
> unclassified remainder is now ~104 KB, not ~186 KB.

> **Correction — three of the four remaining gaps are now identified.** The
> `0x00000` stream (18,932 B) is the "Adventure Screen" UI panel bank (stat
> panels, portrait frame, ring-slot gems, options buttons, movement compass);
> `0x06F4D`–`0x0DFFA` is not a stray "336-byte raw table" plus unclassified
> filler, it is one single raw signed-8-bit PCM sound bank end to end (the
> BCSPEED effect sound effects). See "bcdfa — UI Panel Bank" and "bcdfa —
> Effect Sound Bank" below. Only `0x10779`–`0x1AE70` (two RLE-stream-bounded
> but content-unidentified blocks) and the small `0x300C2`–EOF tail remain
> genuinely open — see "bcdfa — Remaining Unclassified Ranges".

---

### bcdfa — UI Panel Bank (`0x00000`) — **SOLVED (32 records, 15 named)**

bcdfa's very first RLE stream — file offset `0x00000`, decoding to exactly
**18,932 B** and terminating precisely at `0x036FD`, the confirmed start of
the paperdoll stream — is not part of BCSPEED at all. It is the in-dungeon
"Adventure Screen" status-bar art: the class LV:/AC: stat panel, the
character-portrait placeholder frame, the twin-gem ring-slot graphic, the
Save/Rest options buttons and the 8-way movement compass.

| Property | Value | Confidence |
|----------|-------|------------|
| Container | `bcdfa`, one RLE stream at `0x00000` → **18,932 B**, 0 trailing bytes (terminator lands exactly at `0x036FD`) | **confirmed** |
| Geometry | Per record; 7-plane masked (stencil plane 0 + 6 EHB colour planes) — see the "32 records" correction below; the extractor decodes every named record cookie-cut against its own stencil, not opaque | **confirmed** |
| Records found | 32 (15 named: `as_stats`, `face_square`, `gem_stone`, `options`, `up_arrows`, `ghost`, `page_1`-`5`, `pressure_plate_1/2_up/down`) | **confirmed** presence, mixed ID confidence |
| Extractor | `scripts/bclib/bcdfa.py` (`UI_PANEL_RECORDS`/`ui_panel_records`), driven by `scripts/extract_bcdfa_ui.py` — re-synced with all corrections below (dropped `as_stats_alt`, renamed `checker_tile`→`ghost`, cookie-cut decode, +9 newly-named records) |
| Assets | `public/assets/blackcrypt/amiga/sprites/ui-panel.{png,json}` — 15 frames |
| Re-verification | Cookie-cut decode reproduces (or improves on) every previously-reported DOS silhouette score: `as_stats` 99.680% (1,864/1,876 opaque px agree, vs. 99.360% previously), `face_square` 100.000%, `gem_stone` 100.000%, `options` 98.214%, `up_arrows` 98.881%, `ghost` — 288/288 opaque px match DOS `Ghost` exactly once the 1-px checkerboard-phase difference already noted below is accounted for (0% at phase 0, 100% at phase ±1) |

#### How the records were found

Same technique as the paperdoll bank's 7 records — a structural scan for a
column that is a single constant colour index across every row of every
plane — run twice: once pinned to the paperdoll bank's own padding index
(33), once generalised to "any single index constant per plane" (since not
every element here uses backdrop 33). The generalised scan is far noisier
(thousands of spurious sub-window hits on ordinary image content), so every
candidate was cross-checked against the strict index-33 scan and, where
possible, against the DOS archive before being trusted.

#### Record table (stream offsets, confirmed)

| Record | Offset | Storage | Drawn | Backdrop idx | DOS `clipper.clp` match | Silhouette agreement |
|--------|--------|---------|-------|---------------|--------------------------|----------------------|
| `as_stats` | 1,960 | 80×28 | 67×28 | 33 | **AS Stats** (67×28) | **99.360%** (1,876 px) |
| ~~`as_stats_alt`~~ | ~~1,680~~ | — | — | — | — | **artifact — not a record**; 1,680 is `as_stats`'s own stencil plane. See below |
| `face_square` | 3,808 | 48×28 | 36×28 | 33 | **Face Square** (36×28) | **98.810%** (1,008 px) |
| `gem_stone` | 9,916 | 96×25 | 88×25 | 33 | **Gem Stone** (88×25) | **100.000%** (2,200 px) |
| `options` | 11,964 | 64×31 | 55×31 | 33 | **Options** (56×31) | **100.000%** (1,705 px) |
| `up_arrows` | 13,700 | 64×31 | 49×31 | 33 | **Up Arrows** (49×31) | **100.000%** (1,519 px) |
| `checker_tile` → **`ghost`** | 17,512 (record starts 17,416) | 32×24 | 24×24 | — | **133 `Ghost`** (24×24) | same 288/288 two-value checkerboard; see below |

`as_stats` is the LV:/AC: template shown behind each of the four party
members' class name in `data/default-2.png` — confirmed directly: cropping
the CLERIC panel at screen `(290, 163)` reproduces the same bordered
box/bar-row/`LV:`/`AC:` layout pixel-for-pixel (the raw-RGB score of 65% is
explained entirely by the class-name text, numeric values and bar fills the
game composites on top at runtime — none of which are part of this static
template). `gem_stone` (81.25% raw-RGB match at `(257,101)`) and `up_arrows`
(72.5% at `(277,128)`) are both directly visible, at the expected size and
in the expected screen position, in the same screenshot.

`gem_stone` and `up_arrows`/`options` were previously guessed (from their
dimensions alone) to be "Hands" and a custom Amiga-only button set; decoding
the actual DOS `clipper.clp` entries named `Gem Stone`, `Options` and
`Up Arrows` and comparing pixel-for-pixel shows they are silhouette-identical
to the Amiga finds, so the DOS *names* are used here instead.

#### The bank really has **32** records, not 7 — read the game's own descriptors

> **Correction — the padding-column scan under-counted this bank by 4× and
> mis-framed every record it did find.** The scan finds the *colour* data of
> a record, because for a 7-plane record the constant-backdrop column only
> becomes constant once you are past plane 0. Every one of the seven scan
> hits above is therefore **one plane block late**: the real record starts at
> `hit − bytesPerPlane`, with plane 0 as a stencil/mask.

The reliable enumeration is the game's own **28-byte generic blit
descriptor** (documented in the `bcdfx`/`bcdfy`/`bcdfz` section; field
`+0x00` is the A5 slot the pixels live in). Blind-scanning the whole
decompressed S_1 image for records satisfying the three descriptor
invariants (`bytesPerPlane == (w/8)×h`, the `BLTSIZE` identity,
`modulo + blitBytes == 40`) and filtering on `slot == 0x00` yields **32
descriptors**, which tile this bank's 18,932 bytes with only three small
gaps:

| slot `0x00` descriptors | 32 |
|---|---|
| Bytes covered | **18,608 / 18,932 (98.3%)** |
| Gaps | `[4816, 4912)` 96 B, `[16196, 16308)` 112 B, `[18648, 18764)` 116 B — each exactly one plane block, i.e. almost certainly further shared stencils |
| Last record | `18,904 + 7 × 4 = 18,932` — the stream's exact decoded length, **0 remainder** |

Two flag bits drive the plane count (`BTST` on the *byte* at `+0x16`, i.e.
word bits 8–10):

| Flags | Planes read from `src` | Mask |
|-------|------------------------|------|
| `0x0000` | 7 — plane 0 at `src`, colour planes 1–6 at `src + bytesPerPlane` | plane 0 |
| `0x0200` | 6 colour planes at `src` | shared, at the descriptor's `maskSrc` (`+0x0A`) |
| `0x0100` | 1 — `src` *is* the mask (mask-only blit path at `+0x24D46`) | — |
| `0x0400` | horizontal mirror (the blitter builds a mirrored copy at `$AC(A5)+0x2710`) | — |

Every one of the seven scan-found records is explained by this, exactly:

| Scan-found offset | Real descriptor `src` | Geometry | Relationship |
|-------------------|----------------------|----------|--------------|
| `as_stats` 1,960 | **1,680** | 80×28, flags `0x0000` | `1,680 + 280` = colour plane 1 |
| `as_stats_alt` 1,680 | **1,680** | — | **the same record** — see below |
| `face_square` 3,808 | **3,640** | 48×28, flags `0x0000` | `3,640 + 168` |
| `gem_stone` 9,916 | **9,616** | 96×25, flags `0x0000` | `9,616 + 300` |
| `options` 11,964 | **11,716** | 64×31, flags `0x0000`, dest `(235,108)` | `11,716 + 248` |
| `up_arrows` 13,700 | **13,452** | 64×31, flags `0x0000`, dest `(239,108)` | `13,452 + 248` |
| `checker_tile` 17,512 | **17,416** | 32×24, flags `0x0000` | `17,416 + 96` |

**7 of 7**, with no exceptions — which is itself the confirmation that the
descriptor scan and the padding-column scan are describing the same objects.

###### Newly named records (DOS `clipper.clp`, 100.000% silhouette)

| `src` | Geometry | DOS entry | Agreement |
|-------|----------|-----------|-----------|
| 18,088 | 16×8 | **149 `Page 1`** | **100.000%** (128 px) |
| 18,200 | 16×8 | **150 `Page 2`** | **100.000%** |
| 18,312 | 16×8 | **151 `Page 3`** | **100.000%** |
| 18,424 | 16×8 | **152 `Page 4`** | **100.000%** |
| 18,536 | 16×8 | **153 `Page 5`** | **100.000%** |
| 18,764 | 16×4 | **79 `Pressure Plate 1 Up`** | **100.000%** (64 px) |
| 18,820 | 16×4 | **81 `Pressure Plate 1 Down`** | **100.000%** |
| 18,876 | 16×2 | **80 `Pressure Plate 2 Up`** | **100.000%** (32 px) |
| 18,904 | 16×2 | **82 `Pressure Plate 2 Down`** | **100.000%** |

> **This closes part of `tileset-missing-dos-items`.** That open item asks
> where DOS's `Pressure Plate 1 Up/Down` and `Pressure Plate 2 Up/Down` went,
> given that all 12 `bcdfx`/`bcdfy`/`bcdfz` chunks are byte-exactly accounted
> for. **They are here** — in `bcdfa`'s UI panel bank, not in the tileset
> files at all: 4 of the 6 missing DOS entries, each a 100.000% silhouette
> match. **`Floor 2` and `Ram Block` are now also found — see the
> `bcdfx`/`bcdfy`/`bcdfz` section's "DOS `Floor 2` and `Ram Block` — SOLVED"
> — which closes `tileset-missing-dos-items` completely, all 6/6 accounted
> for.**

The remaining unnamed descriptors are eight 32×24 records sharing one stencil
at 4,912 (`5,008 … 9,616`, 576 B apart — an 8-frame animation or an 8-state
icon set), four 16×16 records sharing a stencil at 16,308, one 16×22, and a
48×24 at 15,188 drawn at `(213, 93)`.

#### `as_stats_alt` — **RESOLVED: a scan artifact, hypothesis 2 was right**

> **Correction — supersedes the "two explanations, neither confirmed" note.**
> There is exactly **one** record here, and its declared extent does not
> overlap anything. The descriptor at S_1 `+0x209F6` reads
> `slot 0x00, src = 1680, bytesPerPlane = 280, BLTSIZE/modulo for 80×28,
> flags = 0x0000` — a **7-plane record starting at 1,680**, whose plane 0
> (the stencil) occupies `[1680, 1960)` and whose six colour planes occupy
> `[1960, 3640)`. The next descriptor's `src` is 3,640, so the record ends
> exactly where the following one begins.
>
> `as_stats` (offset 1,960, 6 planes) is therefore the **correct colour
> data**, and `as_stats_alt` (offset 1,680, 6 planes) is reading
> `[stencil, colour1 … colour5]` — five real colour planes plus one alien
> plane. That is precisely explanation 2 in the old note: a whole-plane shift
> keeps the shape legible (hence the identical 99.360% DOS silhouette score)
> while recolouring it (hence backdrop index 2 instead of 33). **There is no
> second "highlighted party member" copy.**
>
> Two consequences for extraction: `as_stats_alt` should be **dropped**, and
> `as_stats` should be rendered **cookie-cut against the stencil at 1,680**
> rather than as an opaque rectangle.

> **Done.** `bclib.bcdfa.UI_PANEL_RECORDS` no longer has an `as_stats_alt`
> entry; `as_stats` decodes from `src=1,680` via `decode_masked`. DOS
> agreement improved slightly on re-verification: **99.680%** (1,864/1,876
> opaque px), up from the earlier 99.360% figure computed against the
> uncorrected offset.

#### `checker_tile` — **SOLVED: it is DOS's `Ghost`, a 50% ghosting stipple**

> **Correction — supersedes "unidentified purpose … none of DOS's 24×24
> entries is a checkerboard".** `Ghost` (`clipper.clp` entry **133**, 24×24)
> **is** a checkerboard: it contains exactly two indices, `32` and `0`, in a
> perfect single-pixel alternation, **288 pixels each**. The earlier check
> compared the wrong thing — a *silhouette* comparison between a stencil and
> a pre-dithered bitmap can never match.

The Amiga record is the descriptor at S_1 `+0x23EB2`: `src = 17,416`,
32×24, flags `0x0000`, so plane 0 at `[17416, 17512)` is the mask and the six
colour planes at `[17512, 18088)` are the pixels. Rendering the **mask**
gives a perfect single-pixel checkerboard over columns 0–23 (columns 24–31
entirely clear), 288 of 768 bits set = **exactly 37.5% = 24×24×0.5 / 32×24**,
and every one of those 288 masked pixels carries colour index **0** (black).

So the Amiga draws the ghosting effect as a **cookie-cut 50% stipple of black
over a 24×24 area**, where the DOS port ships a pre-dithered 24×24 bitmap of
the same two-value alternation. Same object, two implementations —
which is exactly why the dimensions "coincided". (The checkerboard phase
differs by one pixel between the two; that is either a genuine port
difference or a bit-order convention, and it does not affect the
identification.)

`checker_tile` should be renamed **`ghost`** in the extractor and rendered as
a mask, not as a 24×24 opaque tile.

> **Done.** `bclib.bcdfa.UI_PANEL_RECORDS` now names this record `ghost` and
> `ui_panel_records` decodes every record (not just this one) via
> `decode_masked`, so it renders as a cookie-cut stipple automatically —
> see `scripts/extract_bcdfa_ui.py`.

---

### bcdfa — Effect Sound Bank (`0x06F4D`–`0x0DFFB`) — **SOLVED**

The 28,846 bytes between the paperdoll RLE stream's end (`0x06F4D`) and the
`BCSPEED\0GFK\0` RLE stream's start (`0x0DFFB`) are not compressed, and are
not the "336-byte raw movement/delta table" this document previously
described at `0x0DEAB`–`0x0DFFB`. They are one contiguous **raw signed 8-bit
PCM sound bank** — the BCSPEED effect sound effects, paired with the GFK
animation frames and PRG scripts elsewhere in the same file — in exactly the
convention already documented for the bcdfb–bcdfn monster sound banks.

| Property | Value | Confidence |
|----------|-------|------------|
| Location | `bcdfa` file bytes `0x06F4D`–`0x0DFFB` (raw, **not** RLE-compressed) | **confirmed** |
| Format | Signed 8-bit PCM, Amiga byte order | **confirmed** |
| Samples | **10** unique + 3 duplicate catalogue references, tiling the whole 28,846-byte span with **zero** gap or overlap | **confirmed** |
| Extractor | `scripts/bclib/bcdfa.py` (`sfx_samples`), driven by `scripts/extract_bcdfa_sfx.py` |
| Assets | `public/assets/blackcrypt/amiga/audio/bcspeed-sfx-{00..09}.raw`, `data/bcspeed-sfx.json` |

#### Found by cross-referencing the DOS sound catalogue, not by RLE-scanning

A blind RLE walk from `0x06F4D` desyncs almost immediately (matching the
"887 pseudo-streams" trap already documented for bcdfa's `.GFK`/`.PRG`
blocks), and the region's byte-value entropy (6.91 bits/byte, higher than any
genuinely RLE-compressed stream in this file) and signed-byte statistics
(mean ≈ 4, near-zero; smooth lag-1..10 autocorrelation decaying from 0.49 to
0.10 — the textbook signature of a real waveform, not compressed data or a
bitplane image) both pointed at raw PCM audio instead. Cross-referencing
every DOS `clipper.clp` `type=4` (sound) entry against the raw Amiga file
(`entry_bytes XOR 0x80`, the same DOS/Amiga sign convention already
confirmed for the bcdfb–bcdfn monster sound banks) finds 14 of the 22 DOS
sound entries byte-identical inside `bcdfa`, all in this span:

| Offset | Bytes | DOS `clipper.clp` entries |
|--------|-------|----------------------------|
| `0x06F4D` (28,493) | 4,456 | 181, 194 |
| `0x080B5` (32,949) | 2,186 | 182, 191 |
| `0x0893F` (35,135) | 9,020 | 183 |
| `0x0AC7B` (44,155) | 2,748 | 184 |
| `0x0B737` (46,903) | 1,750 | 185 |
| `0x0BE0D` (48,653) | 598 | 186 |
| `0x0C063` (49,251) | 878 | 187 |
| `0x0C3D1` (50,129) | 3,974 | 188 |
| `0x0D357` (54,103) | 1,040 | 189 |
| `0x0D767` (55,143) | 2,196 | 190, 192 |

These 10 offsets tile `[0x06F4D, 0x0DFFB)` with **zero** gap and **zero**
overlap (each record's end is exactly the next record's start; the last ends
at exactly `0x0DFFB`, the confirmed `BCSPEED\0GFK\0` RLE stream start). The
other 8 DOS `type=4` entries (169, 170, 173–178) are the already-documented
bcdfb/c/f/j/m monster sound bank samples — every one of the 22 DOS sound
entries is now accounted for somewhere in the Amiga corpus.

> **Correction — retracts the "336-byte raw movement/delta table" reading.**
> This document previously described `bcdfa+0x0DEAB`–`0x0DFFB` (336 bytes,
> signed range −14…+17) as an uncompressed movement/delta table preceding the
> GFK RLE stream, based only on its byte range and value distribution. It is
> not a separate structure: `0x0DEAB` falls **inside** sample 9
> (`0x0D767`–`0x0DFFB`, the DOS entry-190/192 sample) — the "−14…+17" range is
> simply that sample's quiet tail. The GFK preamble claim in the BCSPEED.GFK
> section above (a 336-byte gap between the last PRG-adjacent byte and the
> GFK marker) is unaffected — this correction is about what fills that
> *specific* 336 bytes, not about where the GFK RLE stream itself starts.

---

### bcdfa — Remaining Unclassified Ranges

> **Correction — the blocker this whole section was built on is gone.** Every
> row below previously said tracing a consumer was "not possible" because
> "`bcdfa` has no known loader anywhere in the disassembled corpus." That is
> no longer true — see "bcdfa — Container Directory" above, which also
> supplies each range's exact directory-confirmed `compressed` flag (the
> "does not chain as clean RLE" symptom below for `0x15F8D`-`0x1AE70` and
> `0x300C2`-EOF is now **explained**, not just observed: the directory says
> both are stored raw, not RLE, so of course an RLE walk desyncs on them).
> Findings below are kept for the historical paths-tried record. **Entries 4,
> 6 and 12 are now all solved**, and entry 5 is partly solved: its 15 consumer
> sites are mapped to exact sub-record offsets and its 2,436-byte tail is
> confirmed as the 29 key icons.

| Range | Container-directory entry | Size | Status |
|-------|---------------------------|------|--------|
| `0x10779`–`0x111E1` | 4 (`comp=1`, slot `0xE0`) | 4,288 B decoded | **Solved** — **four** fonts (8×8 1bpp ×64 glyphs, 4×5 ×59, 8×8 mask ×59, 8×8 6bpp colour ×59), all with consumer code, summing to 4,288 exactly. See "bcdfa — Mono Font Bank" below. |
| `0x111E1`–`0x15F8D` | 5 (`comp=1`, slot `0xB4`) | 34,340 B decoded | **Solved** — **13 records** (Spell Book bg, the "Stone" side panel, a blank-stone erase strip, Scroll Top + Scroll Piece, the 15-frame Fire Animation, the mouse-pointer and bubble hardware sprites, Auto Map Block + Auto Map Tiles, two Treasure Chest states, 29 key icons) tiling the chunk with **0 remainder**; 11 of the 13 confirmed against named DOS `clipper.clp` entries at 100.000% (Stone at 99.986%). See "bcdfa — UI / Automap Resource Bank" below. |
| `0x15F8D`–`0x1AE70` | 6 (`comp=0`, **raw**) | 20,195 B | **Solved** — BCSPEED.EFF, 95 effect particle-emitter scripts; consumer traced at S_1 `+0x25624`. See "bcdfa — BCSPEED.EFF" below. Directory-confirmed raw, which is *why* the RLE walk desynced into fragments; it was never a decode bug. |
| `0x300C2`–EOF | 12 (`comp=0`, **raw**) | 1,092 B | **Solved** — the Throwing-Items projectile sprite bank (Arrow + Dagger, 3 depths × 2 facings, 16 px, 7 planes). Raw *and* pixel data — the one bank where `comp=0` does not imply "table data". See "`0x300C2`–EOF tail" below. |

##### `0x10779`–`0x111E1` — Mono Font Bank — **SOLVED (four fonts, all code-confirmed)**

Container-directory entry 4 (slot `0xE0`) decodes to exactly 4,288 bytes and
opens with a **128-glyph, 8x8, 1-bit-per-pixel font**: full printable ASCII
punctuation/digits/`@A-Z` plus arrow glyphs, twice over (two visual weights).

Confirmed via its own consumer code — not just by rendering. Decompressed
`bcdft` S_1 `+0x1F3D2`-`+0x1F3FE` is the game's scrolling dungeon
message-log text blitter:

```asm
1F3D2  MOVEA.L $44(A5),A1     ; destination = message-log screen buffer
1F3D6  ADDA.W  D0,A1
1F3D8  MOVEA.L (A2),A0        ; source = the message string
1F3DA  MOVEQ   #0,D0
1F3DC  MOVE.B  (A0)+,D0       ; next character byte
1F3DE  BEQ.B   $1F3FE         ; 0 -> end of string
1F3E0  SUBI.B  #$20,D0        ; ASCII -> glyph index (space = 0)
1F3E4  LSL.W   #3,D0          ; x8 -- the font's own glyph stride
1F3E6  MOVEA.L $E0(A5),A3     ; A3 = font base = SLOT_FONT
1F3EA  ADDA.W  D0,A3          ; A3 += index*8
1F3EC  MOVEQ   #7,D1
1F3EE  MOVE.B  (A3)+,(A1)     ; copy one row (1 byte = 8px) into the bitplane
1F3F0  LEA     $2A(A1),A1     ; stride $2A = 42 = 40 screen bytes/row + 2
1F3F4  DBRA    D1,$1F3EE      ; 8 rows -> 8 bytes/glyph, matches the x8 above
1F3F8  SUBA.W  #$14F,A1       ; advance to the next character column
1F3FC  BRA.B   $1F3DA
```

8 bytes consumed per glyph exactly matches the `LSL.W #3` (×8) stride; the
`(A3)+` loop copies one byte (= one 8-pixel-wide row) straight into a single
screen bitplane at a time — this is a monochrome mask blit, not EHB colour,
consistent with a text/log font rather than a decorative one. The caller
context (a counter at `$460(A5)`/`$515(A5)` decremented once per frame,
gating the blit) matches the game's known scrolling dungeon message log.

`bclib.bcdfa.mono_font_glyphs` decodes it; `scripts/extract_bcdfa_font.py`
extracts all 128 glyphs to `public/assets/blackcrypt/amiga/sprites/font-mono.{png,json}`.
Rendered and visually verified: a clean, fully legible font sheet (space,
punctuation, digits, `@A-Z`, movement-arrow glyphs), byte-for-byte identical
between the probe and the committed extractor.

> **Correction — supersedes "128-glyph font twice over" and "a second,
> unconfirmed 136-glyph alphabet at 3 bitplanes / 24 B per glyph".** Both
> readings were wrong, and the "no consumer code exists" finding was a
> **false negative of exactly the kind already documented for entry 6**: the
> earlier census only covered `MOVEA.L $E0(A5),An`. Widening it to *every*
> `(d16,A5)` effective-address form — the low six bits of the opcode word
> are `0b101101` for any source EA of that shape — finds **six** hits, not
> two; the four new ones are `ADDA.L $E0(A5),A3/A4` at S_1 `+0x20040`,
> `+0x20148`, `+0x2024E`, `+0x2025C`, and they are the consumers of the rest
> of the chunk. **Lesson (again): census the `ADDA`/`ADD`/`LEA`/`TST`/`CMP`
> and data-register forms, not just `MOVEA.L`.**

##### The chunk is four fonts, not two — **confirmed, byte-exact**

Each consumer names its own base offset with a literal `LEA <disp>(A3)` after
adding the slot pointer, so the region boundaries come straight out of the
code:

| Region | Chunk offset | Size | Glyphs | Format | Consumer (S_1) |
|--------|--------------|------|--------|--------|----------------|
| A — message-log font | `0` | 512 | **64** (`0x20`–`0x5F`) | 8×8, **1 bitplane**, 8 B/glyph | `+0x1F3E6` (blit), `+0x1F314` (address helper) |
| B — micro font | `0x200` (512) | 472 | **59** (`0x20`–`0x5A`) | **4×5**, 1 bitplane, 8 B/glyph (5 rows used, high nibble; odd characters are `LSR.B #4` shifted and OR'd so two glyphs share one byte) | `+0x20040`, `+0x20148` |
| C — big-font mask | `0x3D8` (984) | 472 | **59** | 8×8, 1 bitplane, 8 B/glyph | `+0x2024E` |
| D — big-font colour | `0x5B0` (1456) | 2,832 | **59** | 8×8, **6 bitplanes**, plane-major (`plane*8 + row`), 48 B/glyph | `+0x2025C` |

`512 + 472 + 472 + 2832 = 4288` — the chunk's exact decoded size, **zero
remainder, zero slack**.

```asm
; region B — the 4x5 micro font (S_1 +0x20030, second copy at +0x20138)
20036  SUBI.B  #$20,D0
2003C  LSL.W   #3,D0            ; x8 glyph stride
2003E  MOVEA.L D0,A3
20040  ADDA.L  $E0(A5),A3       ; <- the form the old census missed
20044  LEA     $200(A3),A3      ; region B base = chunk+512
2004A  BTST    #0,D6            ; even/odd character column
20050  MOVEQ   #4,D2            ; 5 rows
20052  MOVE.B  (A3)+,(A1,D3.W)  ;   even: store byte (pixels 0-3 in the high nibble)
20056  ADDI.W  #$20,D3          ;   destination row stride 32
2006C  ; odd:  MOVE.B (A3)+,D7 / LSR.B #4,D7 / OR.B D7,(A1,D3.W) / ADDQ.L #1,A1

; regions C+D — the 8x8 six-plane colour font (S_1 +0x20244)
20244  SUBI.B  #$20,D0
2024A  LSL.W   #3,D0
2024E  ADDA.L  $E0(A5),A3
20252  LEA     $3D8(A3),A3      ; region C base = chunk+984, mask,   8 B/glyph
20256  MULU.W  #$30,D1          ; x48
2025C  ADDA.L  $E0(A5),A4
20260  LEA     $5B0(A4),A4      ; region D base = chunk+1456, colour, 48 B/glyph
20266  MOVEQ   #7,D2            ; 8 mask rows   -> $4C(A5) buffer, stride 32
20276  MOVEQ   #$2F,D2          ; 48 colour rows-> $48(A5) buffer, stride 32
```

The `MOVEQ #$2F` (48) against `MULU #$30` (48) fixes region D's record size,
and the 48 destination rows at a 32-byte stride are 6 planes × 8 rows of a
32-byte-wide off-screen buffer — i.e. **plane-major** order.

###### Verification (ground truth)

| Check | Result |
|-------|--------|
| Byte accounting | `512 + 59×8 + 59×8 + 59×48 = 4,288` — the chunk's exact decoded size, **0 remainder** |
| **Mask invariant** | region C `== OR(region D's 6 planes)` for **472/472 bytes**, zero deviation, under plane-major order. Row-major order scores 111/472, so the plane order is settled, not assumed |
| Region A glyph count | 64 = `0x20`–`0x5F`; glyphs 59–63 (`[ \ ] ^ _`) render as the movement-arrow glyphs, which is why the old reading mistook A+B for "one 128-glyph font in two weights" |
| Regions B/C/D glyph count | 59 = `0x20`–`0x5A`, i.e. space … `Z` — uppercase-only, matching every in-game string in this document |
| Render | all four regions render as clean, fully legible alphabets; region B's 4×5 glyphs are the "lighter second weight" the old reading saw when it decoded them as 8×8 |

The old "136 glyphs × 24 B at 3 bitplanes" reading is a numerological
coincidence: `3,264 = 136 × 24` **and** `= 472 + 2,792`, and 3 bitplanes of
an 8×8 glyph is 24 B just as 6 bitplanes is 48 B, so a plane-count error
halves the glyph size and doubles the glyph count while leaving the total
byte count intact. The mask invariant above is what distinguishes them.

**Extracted.** `bclib.bcdfa.mono_font_glyphs`/`font_micro_glyphs`/
`font_big_glyphs` decode regions A/B/(C+D) respectively; `font_second_glyphs`
and the `font-mono2` asset are retired. Re-run via
`scripts/extract_bcdfa_font.py` →
`sprites/font-mono.{png,json}` (region A, 64 glyphs),
`sprites/font-micro.{png,json}` (region B, 59 glyphs),
`sprites/font-big.{png,json}` (regions C+D, 59 glyphs, masked). The mask
invariant re-verified byte-exact against the committed decoder
(472/472, 0 deviation) as part of promoting these functions.

##### `0x111E1`–`0x15F8D` — UI / Automap Resource Bank — **SOLVED (13 records, all identified)**

Container-directory entry 5 (slot `0xB4`) decodes to 34,340 bytes. A
whole-image byte-pattern census for every `(d16,A5)` effective-address form
of `$B4(A5)` finds **15 sites**, spread across **13** distinct subroutines from
S_1 `+0x1E8CE` to `+0x25C7E`. Each site's literal `ADDA.L`/`LEA`
displacement is a sub-record's exact offset inside the chunk, and the copy
loop around it fixes that record's geometry. The bank is **heterogeneous** —
many independently-addressed sub-images sharing one buffer — which is why
every earlier fixed-width render sweep and padding-column scan found
nothing: there is no single image or record size to find.

> **Correction — supersedes the old "partly solved" table and every "open"
> row in it.** All thirteen records are now identified, and eleven of them
> are confirmed pixel-for-pixel against a *named* DOS `clipper.clp` entry.
> Four specific claims in the superseded table were wrong and are corrected
> in the new table below:
>
> - **`0x62C4` was listed as 2,940 B.** Its real extent is **1,932 B**; the
>   remaining 1,008 B are two further records (`0x6A50` Scroll Top, 924 B,
>   and `0x6DEC` Scroll Piece, 84 B) whose own 100.000% DOS matches pin
>   those boundaries exactly.
> - **`0x3480` was read as "6 sequential planes copied into the screen
>   bitplane pointers", implying row-interleaved planes.** It is
>   **plane-major with a 1,974-byte plane stride** — the `LEA $444(A0),A0`
>   in `+0x236FA` and the `LEA $46E(A0),A0` in `+0x23D6C` both sit *inside*
>   the 6-iteration plane loop, not before it, so each is a per-plane skip,
>   not a one-off offset. `1,092 + 882 = 1,134 + 840 = 1,974`, and
>   `1,974 × 6 = 11,844` = the whole span.
> - **`+0x236FA`'s sub-image was called "28 rows".** `MOVEQ #$3E,D1` is 62,
>   so the `DBRA` runs **63** rows.
> - **`0x7350` was called "two 16×20 1-bitplane images".** `LEA $28(A3),A3`
>   is a *plane* offset, not a second image: it is **one** 16×20 image with
>   **2** bitplanes (40 B per plane).
>
> The old table's three rejected DOS candidates ("Ram Block", two unnamed
> 32×14s) were rejected correctly — they were simply the wrong candidates.
> The right ones were found by reading the DOS catalogue's *names* for
> automap/scroll/fire resources instead of scanning it by size.

###### Complete record table — **all offsets and geometry confirmed**

Every 6-plane record here is **plane-major** and 14 bytes (112 px) wide
unless stated otherwise — the width of the game's right-hand side panel,
which the blitters place at screen byte column 26 (x = 208).

| Chunk offset | Extent | Consumer (S_1) | Geometry | Identification |
|--------------|--------|----------------|----------|----------------|
| `0x0000` | 13,440 B | `+0x246E6`, `+0x24734` | 320×56, 6 planes, opaque; drawn at screen offset `$1680` = **(0, 144)** | **Spell Book background** = DOS `clipper.clp` 147 `"Spell Book"` — 100.000% (17,920/17,920 px) |
| `0x3480` | 11,844 B | `+0x25C7E` (all 141 rows), `+0x236FA` (rows 78-140), `+0x23D6C` (rows 81-140) | 112×**141**, 6 planes, plane stride **1,974 B**; drawn at (208, 0) | **Right-hand side panel** = DOS 90 `"Stone"` (103×139, at panel row 2 / col 6) — **14,315/14,317 px (99.986%)**, the only residue being a 2-px speck and the 36×11 DOS 107 `"Castor 0"` glyph strip the Amiga **bakes in** at (63, 11), itself 396/396 = 100.000% |
| `0x62C4` | 1,932 B | `+0x236C2` | 112×**23**, 6 planes | **Blank-stone erase strip, Amiga-only.** Drawn immediately above `0x3480`'s rows 78-140 (`ADDI.W #$398,D4` = +23 rows) by the same function — together they clear a 112×86 area of the panel to plain stone. No DOS counterpart: DOS just re-blits `"Stone"` |
| `0x6A50` | 924 B | — | 112×11, 6 planes | **Scroll roller** = DOS 165 `"Scroll Top"` (110×11, 2 px in from the Amiga record's left edge) — 1,210/1,210 = **100.000%**. DOS 166 `"Scroll Bottom"` scores 64.1% here and is **not** in this bank |
| `0x6DEC` | 84 B | `+0x24430` | 112×**1**, 6 planes | **Parchment body row** = DOS 167 `"Scroll Piece"` (110×1) — 110/110 = **100.000%**. `+0x24430` re-reads the same 84 bytes for each of 84 output rows (`MOVEA.L D3,A0` sits *inside* the row loop), tiling it from screen offset `$4A2` = row 29 |
| `0x6E40` | 720 B = 15 × 48 | `+0x1EC78` | 8×8 stored, **8×7 drawn**, 6 planes, 48 B/frame | **Fire Animation** = DOS 157 `"Fire Animation"` (8×105 = 15 × 8×7) — 840/840 = **100.000%**. The DOS raster's height *is* 15 × 7, which is exactly why the Amiga blitter draws 7 of its 8 stored rows |
| `0x7110` | 288 B = 3 × 96 | `+0x1E8CE` | Amiga **hardware sprite**: 24 lines × 4 B/record; records 0+1 are an attached SPR0/SPR1 pair (4 planes), record 2 is all zeros. 18 lines copied | **Mouse pointer** = DOS 163 `"Mouse Arrow"` — identical 11×11 content bounding box, 121/121 = **100.000%** |
| `0x7230` | 288 B = 3 × 96 | `+0x1E8FE` | Same sprite layout, **5** lines copied | **Bubble** = DOS 164 `"Bubble"` (5×5) — 25/25 = **100.000%** |
| `0x7350` | 80 B | `+0x1F9D2` | 16×20, **2** planes (40 B/plane) | **Auto Map Block** = DOS 132 `"Auto Map Block"` (16×20) — 320/320 = **100.000%** |
| `0x73A0` | **576 B** = 24 × 24 | `+0x1FA14` | 8×8, **3** planes, 24 B/tile | **Auto Map Tiles** = DOS 131 `"Auto Map Tiles"` (8×192 = 24 tiles) — 1,536/1,536 = **100.000%** |
| `0x75E0` | 864 B | `+0x23F14` | 48×24, 6 planes; drawn at screen offset `$1B32` = **(16, 174)** | **Treasure Chest 0** (closed) = DOS 158 — 1,152/1,152 = **100.000%** (Amiga's 48 px are DOS columns 3-50 of its 54-wide raster) |
| `0x7940` | 864 B | `+0x23F14` (`+$360` when `D2 ≠ 0`) | as above | **Treasure Chest 1** (open) = DOS 159 — 1,152/1,152 = **100.000%**. DOS 160 `"Treasure Chest 2"` scores 35.7% and is **not** in this bank |
| `0x7CA0` | 2,436 B = 29 × 84 | `+0x1FB40`, `+0x206D4` | 8×14, 6 planes, indexed by `gfxNumber − 200` | **29 key icons** — DOS `clipper.clp` 313-341 — 3,248/3,248 = **100.000%** |

**The thirteen records tile the chunk exactly:** `13,440 + 11,844 + 1,932 +
924 + 84 + 720 + 288 + 288 + 80 + 576 + 864 + 864 + 2,436 = 34,340` —
**zero remainder, zero gaps, zero overlap.** From `0x62C4` onward each
record's *end* is independently pinned by the 100.000% DOS match of the
record that begins at the next offset, so the tiling is not an assumption
that happens to add up; it is a chain of eleven separately-verified
boundaries. `bclib.check_text_resource_layout()` asserts it, and
`scripts/verify_bcdfa_entry5_dos.py` re-runs every comparison above.

###### The automap screen — a dual-playfield display (confirmed)

`0x7350` and `0x73A0` belong to a screen that is not the 320×200 6-plane
EHB display the rest of the game uses. Its copper list is built by S_1
`+0x1E792`-`+0x1E884`:

```asm
1E792  MOVE.L  #$00968020,(A2)+   ; DMACON
1E79C  MOVE.L  $68(A5),D1         ; SPR0PT/SPR1PT <- the mouse-pointer pair,
1E7A2  ...                        ;   two 80-byte structures ($50 apart)
1E7C0  MOVE.L  $74(A5),D1         ; SPR2PT..SPR7PT all point at one null sprite
1E7FA  MOVE.L  #$01005400,(A2)+   ; BPLCON0: BPU = 5, DBLPF set
1E7EE  MOVE.L  #$01080028,(A2)+   ; BPL1MOD = 40  -> playfield 1 row = 42+40 = 82 B
1E7F4  MOVE.L  #$010A0000,(A2)+   ; BPL2MOD = 0   -> playfield 2 row = 42 B
1E806  MOVE.L  #$008E2C81,(A2)+   ; DIWSTRT / DIWSTOP / DDFSTRT $30 / DDFSTOP $D0
1E80C  MOVE.L  #$0090F4C1,(A2)+   ;   -> 21 word fetches = 42 B = 336 px displayed
1E824  MOVE.L  A2,$4EE(A5)        ; live pointer to the BPLCON1 scroll byte
1E830  MOVE.L  $78(A5),D0         ; BPL1PT/BPL3PT/BPL5PT, +$8020 apart  (playfield 1)
1E854  ADDI.L  #$18060,D0         ; BPL2PT/BPL4PT,        +$20D0 apart  (playfield 2)
```

| Property | Value | Confidence |
|----------|-------|------------|
| Mode | Dual playfield, 5 bitplanes total (`BPLCON0 = $5400`) | **confirmed** |
| Playfield 1 | 3 planes; 82 B/row, plane stride `$8020` = 32,800 = 82 × 400 → a 656×400 surface scrolled inside a 336×200 window | **confirmed** |
| Playfield 2 | 2 planes; 42 B/row, plane stride `$20D0` = 8,400 = 42 × 200 → 336×200, no scroll | **confirmed** |
| PF1 content | an 82 × 50 grid of 8×8 tiles from `0x73A0` (`MULU.W #$290,D1` = 656 = 8 rows × 82; `ADDA.L #$7D90,A0` = `$8020 − 656` steps to the next plane) | **confirmed** |
| PF2 content | a 21 × 10 grid of 16×20 cells (`DIVU.W #$15,D0` = 21 columns; `MULU.W #$348,D1` = 840 = 20 rows × 42) stamped with `0x7350` | **confirmed** |
| Palette | 32 words at S_1 `+0x1E886` (immediately after the copper builder's `RTS`) | **confirmed** |

The palette is the independent cross-platform check on the whole reading.
PF1 pixel value *v* lights `COLORv`; PF2 pixel value *v* lights `COLOR(8+v)`.
Under that mapping, entries 0-7 and 9-11 reproduce DOS `clipper.clp` entry 1,
`"Automap Palette"`, indices 64-71 and 72-74 **colour for colour**, with a
**maximum channel error of 10/255** — pure 12-bit → 8-bit quantisation, over
11 entries. (DOS index 75 onward is the archive's unused cyan sentinel, so
the comparison stops there; Amiga `COLOR8` is playfield-2 transparent and has
no DOS counterpart.) This also re-confirms, on a third independent record,
the **Amiga index → DOS index + 64** relationship the Spell Book decode first
showed.

###### The automap tilemap — where the 24 tiles come from — **SOLVED**

> **Correction — supersedes "nothing traces which `bcdfs` dungeon square
> becomes which of the 24 tiles, nor what writes the playfield-1 tilemap
> buffer at `$78(A5)`".** Both are now traced end to end, and the premise
> behind the question was slightly off: **there is no tilemap buffer.**
> `$78(A5)` is the playfield-1 **bitplane** base, and the tiles are blitted
> straight into it 24 bytes at a time. The thing that behaves like a tilemap
> is a **field inside the runtime map array itself** (see below).

**The tile index is stored in the square's own longword.** The runtime 64×64
map array at `A4 − 0x37CA` (index `(row << 8) | (col << 2)`, the same array
and formula the loader and the per-square palette override already use) holds
each square as the on-disk 4-byte square, *reinterpreted*:

| Bits | On disk | At runtime |
|---|---|---|
| 31-28 | square type nibble (`+1` wall, `+2` darkness, `+4` spell-failed, `+8` water) | unchanged |
| **27-20** | the two constant `0xF` nibbles — **`0xFF` in all 14,168 squares of all 13 maps** | **automap tile index 0-23**; `0xFF` = *not yet explored* |
| 19-16 | level nibble | unchanged |
| 15-12 | `wall_flags` (N/E/S/W) | unchanged |
| 11-0 | `unique` | unchanged |

That `0xFF` is the explored-state sentinel: the render loop skips any square
still holding it, and the reveal routine overwrites it with a tile index as
the party walks. **Verified: bits 27-20 are `0xFF` on every one of the 14,168
squares in `bcdfs`, zero deviation** — the field is untouched on disk, so it
is pure runtime state.

**Writer — `RevealAroundParty()` S_1 `+0x0382A`** (gated on `$1E2A(A4)`; ten
call sites, including `MoveParty`'s tail at `+0x27C52`). For `d5 = 0…4` — the
four neighbours **and** the party's own square (`d5 = 4` skips the step,
`ApplyFacingDelta` no-ops on facings ≥ 4) — it picks a tile and commits it
with a read-modify-write that touches only bits 27-20:

```asm
03846  MOVE.L  #$F00000,D2        ; default = tile 15 (plain floor)
0385E  ...                        ; if wall_flags bit (1 << (d5+12)) set -> D2 = 0
0388A  JSR     $2B4(PC)           ; ApplyFacingDelta(&X, &Y, d5)
038E8  BTST.B  #4,(A0,D0.L)       ; square type bit 0 (wall)     -> D2 = 0
03908  BTST.B  #5,(A0,D0.L)       ; square type bit 1 (darkness) -> D2 = $1000000
03916  TST.L   D2 / BEQ $3B36     ; blocked -> commit tile 0 without consulting objects
0391C  ...                        ; walk the square's object chain (word +0x12)
03B1A  SUBI.W  #$10,D0            ; switch on the record's type byte +0x05
03B26  MOVE.W  $3AFA(PC,D0.W),D0  ; 16-entry jump table, base $3B2C
03B60  ANDI.L  #$F00FFFFF,D0      ; <-- clear bits 27-20 ...
03B66  ADD.L   D2,D0              ; ... and OR in the chosen tile << 20
03B82  MOVE.L  D0,(A0,D1.L)       ; commit
```

**Helper — `RevealWalls(X, Y)` S_1 `+0x0369E`**, called by most tile handlers.
For each of the 5 directions: if `(X,Y)` has a `wall_flags` bit in that
direction, the square *beyond* it is forced to **tile 0** (a wall block);
otherwise, if the neighbour holds an illusionary wall (type `0x10`,
`word +0x0A == 0`, `word +0x0C == 1`) it is forced to **tile 21**. This is
what paints the wall outline around anything you can see.

**Reader — `ShowAutomap()` S_1 `+0x03B94`.** Installs the automap copper list
(`JSR $9F962` = S_1 `+0x1F90A`: `COP1LC = $64(A5)`, `$4F6(A5) = 1`, then a
blitter clear of `$78(A5)`), takes the current level from the party's own
square, makes **two** passes over the whole 64×64 array — one to find the
bounding box of squares whose level matches *and* whose tile ≠ `0xFF`, one to
draw — then restores `COP1LC = $50(A5)` (`+0x1F978`) and re-requests screen
mode 1. Centring and the bottom-up row order:

```asm
03CC8  A2 = $28 - (maxCol-minCol)/2       ; 40 = half of the 82-tile PF1 row
03CD2  A3 = $19 + (maxRow-minRow)/2       ; 25 = half of the 50-tile PF1 column
03D7C  D1 = A3 - (row - minRow)           ; screen tile row  (map row 0 at the BOTTOM)
03D82  D0 = A2 + (col - minCol)           ; screen tile column
03D88  JSR     $9FA52.l                   ; DrawAutomapTile(D0=col, D1=row, D2=tile)
03DA8  D2 = $1744(A4) + $11               ; party arrow = tile 17 + facing
```

**`DrawAutomapTile(D0, D1, D2)` — S_1 `+0x1F9FA`** (the only writer of the
playfield-1 bitplane): `D1 × 656` (`$290` = 8 rows × 82 B) `+ D0` off
`$78(A5)`, then 3 planes × 8 unrolled `MOVE.B (A1)+,(A0)` / `LEA $52(A0),A0`
(82-byte rows) with `ADDA.L #$7D90,A0` (= `$8020 − 656`) between planes;
source is `$B4(A5) + $73A0 + D2 × 24`.

###### The 24 automap tiles — **confirmed**

Every discriminator below partitions the shipped corpus by `gfxNumber` with
**zero mixing**, and the artwork (already extracted byte-exact as
`sprites/automap.*`) independently depicts what the code selects.

The **Squares** column counts how many map squares end up carrying each tile
when the simulator below explores all 13 maps exhaustively — it is a count of
*squares*, not of records (a record on an unreachable or level-0 square never
gets drawn).

| Tile | Selected when | Art | Squares |
|---|---|---|---|
| **0** | blocked: a `wall_flags` bit between party and square, or square type bit 0 (wall). Also forced by `RevealWalls` | shaded 3-D block | 5,724 |
| **1** | type `0x12`, `word +0x10` = **2** (gfx `0x43`) — **STAIRS UP** | wedge widening downward | 38 |
| **2** | type `0x12`, `word +0x10` = **3** (gfx `0x44`) — **STAIRS DOWN** | wedge narrowing downward | 33 |
| **3** | type `0x11` door frame, `byte +0x04` bit 4 **clear**, `byte +0x0F` bit 0 **set** | horizontal bar **with a gap** = open | 3 |
| **4** | type `0x11`, `+0x04` bit 4 clear, `+0x0F` bit 0 clear | solid horizontal bar = closed | 91 |
| **5** | type `0x11`, `+0x04` bit 4 **set**, `+0x0F` bit 0 set | vertical bar with a gap = open | 1 |
| **6** | type `0x11`, `+0x04` bit 4 set, `+0x0F` bit 0 clear | solid vertical bar = closed | 79 |
| **7** | type `0x17` Pillar, `word +0x0A == 0` | dark blob | 206 |
| **8** | type `0x14` Pit, `word +0x10 == 0` (gfx `0x3A` = **floor** pit), `+0x0A == 0` | hole with shadow | 12 |
| **9** | type `0x12`, `+0x10` = **0 or 1** (gfx `0x41` inviso / `0x40` visible) — teleport | magenta/blue sparkle checker | 123 |
| **10** | type `0x10`, `word +0x0C` = **2** (gfx `0x48`) — magic field | blue dot lattice | 25 |
| **11** | type `0x10`, `+0x0C` = **3** (gfx `0x3C`) — glyph | blue panel on floor | 13 |
| **12** | type `0x1F`, `word +0x0E == 0` (gfx `0x45`) — fountain | framed blue panel | 26 |
| **13** | type `0x1E`, `byte +0x07 == 0`, `+0x0A == 0`, `word +0x0E == 0` (gfx `0x42`) — floor plate | empty framed square | 25 |
| **14** | type `0x1E`, `byte +0x07 == 0`, `+0x0E != 0`, `+0x0C != 0` — a **visible trap** | framed square, magenta fill | **0** — see below |
| **15** | default: an unobstructed, featureless floor square | floor stipple | 6,601 |
| **16** | square type bit 1 (darkness) | dark dither | 99 |
| **17-20** | party marker, `tile = 17 + $1744(A4)` (facing 0=N,1=E,2=S,3=W) | up / right / down / left arrows | 1 per draw |
| **21** | type `0x10`, `+0x0C` = **1** (gfx `0xC1`) — illusionary wall; also forced by `RevealWalls` on neighbours | *brightened* wall block | 59 |
| **22** | type `0x12`, `+0x10` = **4** (gfx `0x1E`) — spinner | magenta-cornered swirl | 7 |
| **23** | type `0x1F`, `word +0x0E != 0` (gfx `0x46`) — special panel | wall block with a bright inset | 14 |

Types `0x13`, `0x15`, `0x16` (alcove), `0x18`-`0x1D` and everything outside
`0x10`-`0x1F` fall through the jump table to the "next record in the chain"
arm — **alcoves, switches, plaques, locks, monster generators and statues get
no automap marker at all**, which is why the clue book marks them but the
in-game map does not.

**`byte +0x07` of a type-`0x1E` record is the "inviso" flag** (new this pass).
The clue book's legend carries *both* `FLOOR PLATE` and `INVISO FLOOR PLATE`,
and Level 1's two type-`0x1E` records split exactly along `+0x07`:

| Square | gfx | `byte +0x07` | Automap | Clue-book cell, best NCC over all 30 legend icons |
|---|---|---|---|---|
| (18, 8) | `0x42` | **1** | *nothing* | **`INVISO FLOOR PLATE` +0.329** (rank 1); `FLOOR PLATE` −0.006 |
| (25, 10) | `0x42` | **0** | tile 13 | `FLOOR PLATE` **+0.419** vs `INVISO FLOOR PLATE` +0.264 |

Every one of the 41 **trap** records (gfx `0x4A`) in all 13 maps has
`byte +0x07 = 1`, so **tile 14 is never drawn from shipped on-disk state** —
the trap marker is reachable only if something clears `+0x07` at runtime.
(11 candidate `byte +0x07` writers exist in S_1; none was traced to the
`A4 − 0x6E7A` object array this pass. See `TODO.md` row `automap-trap-tile`.)

###### Verification (ground truth)

The whole chain — reveal, tile selection and render — was reimplemented in
Python from the disassembly and compared against the **official Manual &
Clue Book**'s printed per-level maps (scanned PDF, rendered at 250 dpi, grid
lattice located from its own printed rulings, cells classified black/white by
window mean; the 30 legend icons segmented from p. 31 at 600 dpi and matched
by normalised cross-correlation).

1. **Bounding box, exact.** Simulating full exploration of Level 1 (map 1,
   level nibble 1) yields a used area of **28 columns × 24 rows**. The clue
   book's Level 1 grid has drawn content in exactly **columns 0-27, rows
   0-23** — same extent, same origin, no offset.
2. **Wall/floor agreement, Level 1:** of the 401 cells the simulation marks
   tile 0 or tile 15 and the clue book renders as a *pure* black or white
   cell, **398 agree — 99.25 %** (tile 0: 232/233 black; tile 15: 166/168
   white). Every remaining cell the simulation marks with a *special* tile
   lands on a clue-book cell carrying a symbol, never on plain floor.
3. **Wall/floor agreement, Level 2** (map 1, nibble 2, clue book p. 34):
   **595/607 = 98.02 %** at the grid alignment derived from that page's own
   lattice.
4. **Stairs, three independent ways.** (a) The Level 1 stairs square (5, 18)
   cross-correlates **+0.440 with `STAIRS DOWN` and −0.140 with `STAIRS UP`**;
   the simulation puts `word +0x10 = 3` / gfx `0x44` / tile 2 there. (b) The
   tile art itself: tile 2 is a wedge narrowing downward (the legend's
   `STAIRS DOWN` funnel), tile 1 a wedge widening downward (`STAIRS UP`).
   (c) A whole-corpus census over all 28 dungeon levels — **level 1, the top
   of the dungeon, has 0 × gfx `0x43` and 1 × gfx `0x44`; level 28, the
   bottom, has 1 × gfx `0x43` and 0 × gfx `0x44`**, and levels 7 / 8 carry a
   matched **11 × `0x44` / 11 × `0x43`** pair with none of the opposite kind
   on either side.

> **Correction — resolves the stairs `+0x10` = 2 vs 3 hypothesis left open
> under "Special-square sub-kinds".** It is settled: `+0x10` = **2** (gfx
> `0x43`, sprite-slot flight A) = **STAIRS UP**, `+0x10` = **3** (gfx `0x44`,
> flight B) = **STAIRS DOWN**.

**The door orientation bit reads the corridor, not the door leaf.** `byte
+0x04` of a door frame takes only two values across all **291** door frames —
`0x50` (walls **N + S**) and `0xA0` (walls **E + W**) — i.e. the two side
walls of the corridor the door sits in. `BTST #4` therefore tests "N wall
present", which means the corridor runs **east-west**, so the door leaf is
drawn as a **vertical** bar (tiles 5/6); `0xA0` gives the horizontal bar
(tiles 3/4). `byte +0x0F` bit 0 is the already-confirmed open/closed flag
(see "Door State"), and the art agrees independently: tiles 3 and 5 have a
gap in the middle of the bar, tiles 4 and 6 are solid.

###### `$490(A5)` — the screen-mode selector — **SOLVED**

> **Correction — supersedes "mode 1 is the automap".** It is not. **The
> automap is not a `$490(A5)` mode at all**: `ShowAutomap` swaps `COP1LC`
> directly to `$64(A5)` (S_1 `+0x1F90A`), restores it to `$50(A5)` on exit
> (`+0x1F978`), and then *re-requests mode 1* (`+0x03E42`). Mode 1 is the
> screen the automap returns **to**.

`$492(A5)` is the *request*, `$490(A5)` the *committed* mode. Apart from the
`CLR.B` in the init block at S_1 `+0x2033E` (which also seeds `$490(A5) = 1`
directly at `+0x20354`, without running the dispatcher), the only writer of
the request is `SetScreenMode(D0)` at S_1 `+0x231FC`; the VBlank chain
latches it at `+0x1E9EA` and dispatches:

```asm
1E9EA  MOVE.W  $492(A5),D0        ; 0 = no change
1E9F4  MOVE.W  D0,$490(A5)
1E9FC  CMPI.W  #$1,D0 -> $1EAB2   ; copper sub-list $54(A5)
1EA04  CMPI.W  #$2,D0 -> $1EAE6   ;                 $58(A5)
1EA0C  CMPI.W  #$3,D0 -> $1EB00   ;                 $5C(A5)
1EA14  BRA     $1EACC             ; default          $60(A5)
```

Each arm only patches the two address halves at `$2(A0)`/`$6(A0)` where
`A0 = $48A(A5)` — a `COP2LC` pair inside the main list built at `+0x1E066` —
so a "mode" is a copper **sub-list**, not a whole display.

Each mode is named by the **mouse hot-spot table** its call site installs
immediately afterwards through `InstallHotspotList(A0)` (S_1 `+0x1FF9C`,
which walks a singly-linked list of 14-byte `x, y, w, h, id, next` records
into the live region list at `$158(A5)`):

| `$490(A5)` | Copper | Requested at | Hot-spot table | Screen |
|---|---|---|---|---|
| **1** | `$54(A5)` — per-scanline `COLOR19/26/27` gradient over lines `$BA`-`$D1` and `$D5`-`$EC` | `+0x14D88`, `+0x10A70`, `+0x10E66`, `+0x15D5A`, `+0x1A74C`, `+0x03E42` | S_2 `0x09AC`, 30 regions | **Main dungeon screen** — 4 × 31×24 portraits at (127/161, 146/173), 4 × 63×25 character panels at (3/252, 145/172), 8 × 24×24 hand slots, HP/stamina/food bars. The four brazier positions the fire animation gates on mode 1 for — (16,151), (296,151), (296,178), (16,178) — frame exactly this panel |
| **2** | `$58(A5)` — `COLOR26` ramp, same two line bands; also references `$60(A5)` at `+0x1E47E` | `+0x150DE` (inside a per-character function keyed on `$1A16(A4)`, character records at `$1758(A4)`, stride 168) | S_2 `0x0B42`, 41 regions | **Inventory / equipment (paperdoll) screen** — a body-shaped cluster of 9 irregular slots at x 213-309, y 4-116 (head/neck/torso/arms/hands/legs), 4 × 23×22 character selectors at y 121, and a 16-slot 24×24 backpack grid at x 110-309, y 148-197 |
| **3** | `$5C(A5)` — 1 bitplane from `$3C(A5)` (a 2,320 B = 40×58 buffer pre-filled `$FF`) from line `$B6`, 16 warm colours from `+0x1E560`, plus `$4C8(A5) = +0x24816` and `$4CC(A5) = $FF` | `+0x1549C` (sets `$174A(A4) = 3`) | S_2 `0x0D3A`, 13 regions | **Spell book** — 4 × 186×10 text lines at (75, 159/169/179/189), 5 small buttons in a row at y 123, and 7×25 scroll arrows at (229, 89)/(288, 89). These sit exactly inside the 320×56 **"Spell Book" background** that `bcdfa` entry-5 record `0x0000` draws at (0, 144) |
| **4 / default** | `$60(A5)` | **never requested** — all 8 `SetScreenMode` call sites pass 1, 2 or 3, and `D0 = 0` is filtered out at `+0x1E9EE` | — | Unreachable as a mode in the shipped build. Unlike the other three, `$60(A5)`'s builder (`+0x1E5C0`) emits a **complete standalone list** (DMACON, 8 null sprite pointers, `BPL1PT`/`BPL2PT` from `$40(A5)`/`$44(A5)`, `BPLCON0 = $2400` → 2 planes **DBLPF**, `BPL1MOD = $2A`, DIW `$F281`/`$FAC1`, an 8-line `COLOR1`/`COLOR9` cycle) that ends by pointing `COP1LC` back at `$50(A5)`. It is better read as a shared sub-list that mode 2's list jumps to than as a fourth screen |

`$174A(A4)` is a separate, loosely-coupled **screen id** taking 1, 2, 3, 4 and
10; `ShowAutomap` sets it to 1 on exit (`+0x03E3C`) alongside its
`SetScreenMode(1)`.

###### `0x6E40` — the Fire Animation and its four braziers (confirmed)

The blitter and its caller are a complete, self-contained animation driver:

```asm
1EB88  CMPI.W  #$1,$490(A5)       ; only on screen mode 1
1EB92  LEA     $1EC28(PC),A2      ; four per-corner tick counters, seeded 0/10/20/30
1EB96  SUBQ.B  #$1,(A2)+          ;   each decremented once per frame ...
1EB9A  MOVE.B  #$3B,-$1(A2)       ;   ... and reloaded with 59 on underflow
1EBBC  LEA     $49A(A5),A2        ; four per-corner enable flags
1EBC0  LEA     $1EC2C(PC),A3      ; 60-byte ramp: frame = tick / 4  (0..14, x4 each)
1EBD4  MOVE.B  (A3,D3.W),D1       ; D1 = frame index
1EBDA  MOVE.W  D2,D0              ; D0 = corner 0..3
1EBDC  BSR.W   $1EC68

1EC6C  LEA     $1ECBA(PC),A0      ; four screen word-offsets, one per corner
1EC72  MOVE.W  (A0,D0.W),D5
1EC76  MOVEQ   #$28,D4            ; 40 = screen row stride
1EC78  MOVEA.L $B4(A5),A2
1EC7C  ADDA.L  #$6E40,A2
1EC82  MULU.W  #$30,D1            ; x48 -- one frame
1EC88  MOVEA.L $468(A5),A0        ; the 6 screen bitplane pointers
1EC92  MOVE.B  (A2)+,(A1) x7      ; 7 rows drawn ...
1ECAE  ADDQ.L  #$1,A2             ; ... 8th stored row skipped
```

`$1ECBA` holds `6042, 6077, 7157, 7122` — i.e. **(16,151), (296,151),
(296,178), (16,178)**, the four corners of a rectangle, walked clockwise
from the top left. So the record is not "a spark effect": it is a **15-frame
looping flame**, drawn at four fixed brazier positions, each corner running
the same 60-tick cycle **10 ticks out of phase** with its neighbour, each
individually gated by a byte in `$49A(A5)` (latched once per frame from
`$49E(A5)` at S_1 `+0x1E9E4`).

> **Correction — supersedes "15 small icons, one blank … a triangular/pyramid
> spark motif … no DOS `clipper.clp` entry is 8×8, so there is no
> cross-platform name for it".** All three parts are wrong. There are exactly
> **15** frames and **none** is blank (720 / 48 = 15). The motif is a flame,
> not a spark. And DOS *does* carry it — as a **vertical strip**, entry 157
> `"Fire Animation"`, 8×105, which is 15 frames of 8×7 stacked. The old
> search missed it because it filtered the DOS catalogue on `w == 8 && h == 8`;
> DOS stores multi-frame small art as one tall raster, exactly as it does for
> its fonts (`8×472`) and `"Auto Map Tiles"` (`8×192`). **Lesson: when
> matching a small Amiga frame bank against `clipper.clp`, look for
> `w == frameWidth && h == frames × frameHeight`, not for a single frame's
> dimensions.**

###### `0x7110` / `0x7230` — hardware sprites, not bitplane art (confirmed)

Both banks are Amiga **hardware sprite** data, which is why no bitplane
geometry ever fit them. Each 96-byte record is 24 scanlines × 4 bytes
(`SPRxDATA`, `SPRxDATB` = 2 bitplanes); records 0 and 1 form an *attached*
SPR0/SPR1 pair (4 planes, 15 colours, register base `COLOR16`); record 2 is
all zeros in both banks. The consumers copy only the leading lines into the
live sprite structures at `$68(A5)` (18 lines → an 80-byte structure) and
`$70(A5)` (5 lines → a 28-byte structure), each after the 4-byte
`SPRxPOS`/`SPRxCTL` header:

```asm
1E8C6  MOVEA.L $68(A5),A1
1E8CA  LEA     $4(A1),A1          ; skip SPRxPOS/SPRxCTL
1E8CE  MOVEA.L $B4(A5),A0
1E8D2  ADDA.L  #$7110,A0
1E8DA  MOVEQ   #$11,D1            ; 18 longwords = 18 scanlines
1E8DC  MOVE.L  (A0)+,(A1)+
1E8E2  ADDI.L  #$50,D0            ; second structure, 80 B on
1E8EC  LEA     $18(A0),A0         ; source record stride = 72 + 24 = 96
```

The `0x7230` bubble is placed by S_1 `+0x1EA4E`: `MOVE.W #$84,$51E(A5)`
fixes y = 132, and `MOVE.W #$90,-(A7) / BSR $268BA / ADDI.W #$20,D0` gives
a **random** x in `[32, 176)` — `$268BA` is `Random(n)` (`BSR $26854` for a
raw value, `DIVU.W` by the argument, `SWAP` to take the remainder). It runs
for a 60-frame countdown at `$500(A5)`.

###### `0x0000` — the Spell Book background's consumers, and its mirrored twin

> **Correction — supersedes "no consumer found" / "it has zero hits in the
> `(d16,A5)` census that found every other sub-record's offset".** Two
> consumers exist; the earlier census missed them because both write the
> displacement as `LEA $0(A0),A0` — a *zero* displacement, which the census
> was implicitly filtering out as "no offset added".

```asm
0246E6  MOVEA.L $B4(A5),A0
0246EA  LEA     $0(A0),A0
0246EE  MOVEA.L $464(A5),A1
0246F6  LEA     $1680(A2),A2       ; 5,760 = row 144, col 0  -> (0, 144)
0246FA  MOVEQ   #$37,D1            ; 56 rows
0246FC  MOVE.L  (A0)+,(A2)+ x10    ; 40 bytes = 320 px per row

024734  MOVEA.L $B4(A5),A0         ; the mirrored variant
024738  LEA     $0(A0),A0
02473C  LEA     $279C0(PC),A3      ; 256-byte bit-reversal LUT
024750  LEA     $28(A2),A2         ; walk the destination row backwards ...
024758  MOVE.B  (A3,D3.W),-(A2)    ; ... reversing the bits inside each byte too
```

S_1 `+0x279C0` is verified a bit-reversal table: `table[i] == reverse_bits(i)`
for **256/256 entries**. Combined with the descending `-(A2)` destination
walk, `+0x24734` draws the same 320×56 image **horizontally mirrored** — the
spell book's facing page. Screen placement is confirmed as **(0, 144)**, i.e.
the bottom 56 rows of the display.


###### `0x0000`–`0x3480` — the Spell Book background — **SOLVED**

The chunk's first 13,440 bytes decode as a single opaque image: **320×56,
6 sequential bitplanes, no mask**.

> **Correction — supersedes "No consumer references this range at all — it
> has zero hits in the `(d16,A5)` census … consistent with it being read as
> one whole-buffer `Read()` destination rather than indexed by a per-element
> displacement."** Two consumers do exist (S_1 `+0x246E6` and `+0x24734`);
> both address the record with `LEA $0(A0),A0`, and a census that treats
> "adds a displacement" as the signal for a sub-record cannot see a
> *zero* displacement. See "the Spell Book background's consumers, and its
> mirrored twin" above for the disassembly, the confirmed screen placement
> (0, 144), and the bit-reversal table that produces the mirrored variant.

Identified via the DOS `clipper.clp` archive: entry **147, `"Spell Book"`,
320×56** — the *exact* pixel count this decoded region needs
(320×56×6⁄8 = 13,440 Amiga bytes ⟺ 320×56 = 17,920 DOS 8bpp bytes). Decoding
both and comparing index-for-index (most-common index as backdrop) gives a
**100.000% silhouette match (17,920/17,920 pixels)** — and it is stronger
than a shape coincidence: the five most common colour indices in each image
have **identical pixel counts** (8,016 / 2,130 / 935 / 774 / 620), and the
Amiga indices are a fixed **+64** offset from the DOS ones (2→66, 3→67,
4→68, 5→69), consistent with the DOS archive's own palette simply being a
different table over the same paletted art.

| Property | Value | Confidence |
|----------|-------|------------|
| Extent | chunk `0x0000`–`0x3480` = 13,440 B, **0 remainder** against the 320×56×6-plane formula | **confirmed** |
| Geometry | 320×56, 6 sequential bitplanes, no mask | **confirmed** |
| Content | Spell book background art — decorative diamond/triangle border across the top, solid colour field below | **confirmed** (rendered; distinctive border shape visible in both Amiga and DOS decodes) |
| Cross-platform oracle | DOS `clipper.clp` entry 147, `"Spell Book"` | **confirmed**, 100.000% silhouette (17,920/17,920 px), exact per-index pixel-count agreement on the top 5 indices |

`bclib.bcdfa.spell_book_background` decodes it; `scripts/extract_bcdfa_spellbook.py`
→ `screens/spell-book-bg.png`.

###### `0x7CA0`–end — the 29 key icons — **SOLVED**

```asm
1FB40  MOVEA.L $B4(A5),A0
1FB44  LEA     $7CA0(A0),A0      ; bank base + 31,904
1FB48  MOVE.W  (A7),D0           ; item gfxNumber
1FB4A  SUBI.W  #$C8,D0           ; -200  -> key index 0..28
1FB4E  MULU.W  #$54,D0           ; x84
1FB52  LEA     (A0,D0.W),A0
1FB56  MOVEA.L $AC(A5),A1
1FB5A  LEA     $10(A1),A1
1FB5E  MOVEQ   #5,D0             ; 6 planes
1FB60  MOVEQ   #$D,D1            ; 14 rows
1FB62  MOVE.B  (A0)+,(A1)        ;   1 byte = 8 px per row
1FB64  ADDQ.L  #3,A1             ;   4-byte destination row
```

| Property | Value | Confidence |
|----------|-------|------------|
| Extent | chunk `0x7CA0` … `0x8624` = **34,340**, the exact chunk end, **0 remainder** | **confirmed** |
| Records | **29** × **84 B** (`2,436 = 29 × 84`) | **confirmed** |
| Geometry | **8 × 14 px, 6 sequential bitplanes, plane-major (14 B per plane), no mask** | **confirmed** |
| Backdrop | colour index **53** — the same item-icon backdrop already confirmed for the 24×24 bank | **confirmed** |
| Index | `keyIndex = gfxNumber − 200`, so item `gfxNumber` **200 … 228** are the keys | **confirmed** (two independent call sites, both `SUBI.W #$C8` / `MULU.W #$54`) |

**Cross-platform oracle.** `clipper.clp` brackets exactly **29** unnamed
8×14 entries between the type-1 marker entries **312 `"Start Keys"`** and
**342 `"End Keys"`** (catalogue entries 313–341). Comparing Amiga
`index != 53` against DOS `index != 53` — *the DOS backdrop index is also 53*
— gives **3,248 / 3,248 pixels in agreement (100.000%) across 29 / 29
frames**, every frame individually perfect.

This is the first sub-record of entry 5 to be fully identified, and it pins
the chunk's **end**: everything from `0x7CA0` to the last byte is keys.

**Extracted.** `bclib.bcdfa.key_icon_sprites`, driven by
`scripts/extract_bcdfa_keys.py`, → `sprites/keys.{png,json}` (29 frames) +
`data/key-icon-gfx-table.json`. Re-verified against the DOS oracle as part
of promoting the extractor: 3,248/3,248 opaque px (100.000%), 29/29 frames
individually perfect — same figures as above, now backed by committed code.

###### Extraction

| Records | Decoder | Script | Output |
|---------|---------|--------|--------|
| `0x0000` | `bclib.spell_book_background` | `extract_bcdfa_spellbook.py` | `screens/spell-book-bg.png` |
| `0x3480`, `0x62C4`, `0x6A50`, `0x6DEC`, `0x75E0`, `0x7940` | `bclib.stone_panel`, `panel_clear_strip`, `scroll_top`, `scroll_piece`, `scroll_panel`, `treasure_chest_sprites` | `extract_bcdfa_ui_bank.py` | `sprites/ui-side-panel.{png,json}` (7 records) |
| `0x6E40` | `bclib.fire_animation_frames` | `extract_bcdfa_ui_bank.py` | `sprites/fire-animation.{png,json}` + `data/fire-animation.json` (positions + phases) |
| `0x7110`, `0x7230`, `0x7350`, `0x73A0` | `bclib.mouse_pointer_sprite`, `bubble_sprite`, `automap_block`, `automap_tiles` (+ `bclib.decode_sprite_pair`) | `extract_bcdfa_ui_bank.py` | `sprites/automap.{png,json}` (24 tiles + block + 2 sprites), `palettes/automap.json` |
| `0x7CA0` | `bclib.key_icon_sprites` | `extract_bcdfa_keys.py` | `sprites/keys.{png,json}` + `data/key-icon-gfx-table.json` |

`scripts/verify_bcdfa_entry5_dos.py` re-runs the whole DOS cross-check
(**12/12 comparisons at ≥99.9%**, all but two with an injective index map;
the two non-injective ones are `"Stone"`, where two DOS indices collapse
onto one Amiga index, and `"Fire Animation"`, where DOS's two backdrop
shades 131/132 both map to Amiga index 26). Every committed decoder was
regression-checked against the verified probe: **0 differing pixels** across
all eleven records.

###### Paths tried (entry 5)

| Approach | Result | Why it failed |
|----------|--------|---------------|
| Fixed-width render sweeps + padding-column scans over the whole 34,340-byte chunk | Nothing coherent | The bank is heterogeneous — 13 records of 8 different geometries. There is no single width or record size to find |
| DOS `clipper.clp` size-collision search: `"Ram Block"` (32×20) for `0x7350`, two unnamed 32×14s for `0x7110`/`0x7230` | 21.6%–58.3% silhouette, chance level — **rejected** | Right method, wrong candidates. `0x7350` is `"Auto Map Block"` (16×20, 100.000%); `0x7110`/`0x7230` are not bitplane art at all but hardware sprites, so no bitplane-shaped DOS entry could ever match them |
| DOS catalogue filtered on `w == 8 && h == 8` for the `0x6E40` icons | "No DOS entry is 8×8, so there is no cross-platform name" | DOS stores multi-frame small art as **one tall raster**: entry 157 `"Fire Animation"` is 8×**105** = 15 × 8×7, a 100.000% match. Filter on `h == frames × frameHeight` |
| `MOVEA.L $B4(A5),An`-only byte-pattern census | 14 sites; missed `MOVE.L $B4(A5),D3` at `+0x24430` | The same narrow-opcode-form trap already documented for the font bank — census every `(d16,A5)` EA form |
| Treating a nonzero `LEA <disp>` as the signal that a sub-record exists | `0x0000` reported as "no consumer found" | Its two consumers use `LEA $0(A0),A0` — a *zero* displacement is still a consumer |
| Reading `+0x236FA`/`+0x23D6C`'s `LEA` skips as one-off offsets before a row loop | Implied row-interleaved planes and a 28-row sub-image | Both `LEA`s sit **inside** the 6-iteration plane loop, making them per-plane skips: the record is plane-major, stride 1,974 B, and the sub-image is 63 rows |
| Matching `0x62C4`'s 112×23 strip against every row window of DOS `"Stone"`/`"Stone 2"` | best 69.4% / 64.5% — **rejected** | It is a genuinely separate authored asset (a blank-stone erase strip). DOS has no counterpart because DOS re-blits the whole `"Stone"` panel instead |
| Matching DOS `"Scroll Bottom"` (166) and `"Treasure Chest 2"` (160) anywhere in the bank | 64.1% / 35.7% — **rejected** | Neither is present. The Amiga bank ships only the scroll's top roller and two of DOS's three chest states |
| Rendering `0x73A0` as 96 × 24-byte tiles (2,304 / 24) | Tiles 24-95 are visual noise | The tile bank is exactly **24** tiles (576 B); the following 1,728 B are the two 864-byte treasure chests, whose own 100.000% matches pin that boundary |

#### bcdfa — BCSPEED.EFF — Effect Particle Scripts — **SOLVED**

Container-directory entry 6, `0x15F8D`–`0x1AE70`, **`comp=0` — stored raw**,
20,195 bytes. Slot `0xE8`, immediately preceding BCSPEED.PRG's slot `0xEC`.

> **Correction — supersedes "Unidentified — not pixel data", "open, escalated
> to `re-codebreaker`", and the "no compile-time-constant consumer exists
> anywhere in the traced corpus" claim.** This is the **third BCSPEED bank**:
> the effect *particle-emitter scripts* that tie the already-confirmed
> `.GFK` sprites (entry 3) to the already-confirmed `.PRG` movement scripts
> (entry 7). The DOS port names it outright — `clipper.clp` catalog entry
> **225, `"Speed Effects"`, type `0x05`, size 20,195** — byte-identical
> content and size to the Amiga bank. The "no consumer" finding was a
> **false negative**: the earlier census only tested `MOVEA.L`/`ADDA.L`
> `(d16,A5),An`, but the real consumer reads the slot with
> **`MOVE.L $E8(A5),D1`** (`0x222D`), a data-register form the scan never
> covered. Widening the census to `MOVE.L (d16,A5),Dn` finds it immediately,
> alongside its two BCSPEED siblings within 40 bytes.

There is **no file header**: the first section begins at offset 0.

##### The three BCSPEED index tables (**confirmed**)

`InitBcspeedTables` at decompressed `bcdft` S_1 **`+0x25536`** is a run-once
relocation fixup that converts three in-executable tables of *relative*
offsets into absolute pointers:

```asm
25536  LEA     $2558A(pc),A0        ; run-once flag byte
2553A  TST.B   (A0)
2553C  BNE.B   $25588
2553E  MOVE.B  #$1,(A0)
2554A  MOVE.L  $EC(A5),D1           ; BCSPEED.PRG bank base
2554E  ADDI.L  #$E,D1               ; +14: skip "BCSPEED\0PRG\0" + count word
25554  LEA     $258C2(pc),A0        ; PRG table
25558  MOVEQ   #$21,D0              ; 33 -> 34 entries
2555A  ADD.L   D1,(A0)+
2555C  DBRA    D0,$2555A
25560  MOVE.L  $E8(A5),D1           ; <<< THIS BANK (no +14: no marker header)
25564  LEA     $2598A(pc),A0        ; EFFECT table
25568  MOVE.W  #$5E,D0              ; 94 -> 95 entries
2556C  ADD.L   D1,(A0)+
2556E  DBRA    D0,$2556C
25572  MOVE.L  $2C(A5),D1           ; BCSPEED.GFK bank base
25576  ADDI.L  #$E,D1               ; +14
2557C  LEA     $2594A(pc),A0        ; GFK table
25580  MOVEQ   #$F,D0               ; 15 -> 16 entries
25582  ADD.L   D1,(A0)+
25584  DBRA    D0,$25582
25588  RTS
```

| Table | S_1 offset | Entries | Indexes |
|-------|-----------|---------|---------|
| Effect script table | `+0x2598A` | **95** | this bank — 95 effects |
| GFK record table | `+0x2594A` | **16** | BCSPEED.GFK's 16 records |
| PRG script table | `+0x258C2` | **34** | BCSPEED.PRG's 34 records |
| GFK frame-offset LUT | `+0x25C56` | words | frame → byte offset within a GFK record |

The `+0x2598A` table's 95 values are, byte-for-byte, the 95 section start
offsets recovered independently from the data alone (see verification below).

##### Format

```
File := Section[95]                       ; located via the +0x2598A table

Section:
  u16  lastGroupIndex     ; = groupCount - 1   -> $4D2(A5)
  u16  frameDelay         ; extra vblanks per tick (0 or 4) -> $4D6(A5)
  Group[groupCount]       ; each: Record[] then 0xFF

Record (6 bytes):
```

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| +0x00 | 1 | `gfkRecord` | 0–15, index into BCSPEED.GFK's 16 records. `0xFF` here terminates the group |
| +0x01 | 1 | `gfkFrame` | 0–4, frame within that GFK record; **always < that record's frame count** |
| +0x02 | 1 | `prgOffset` | **PRG script index × 4** — used as a *raw byte offset* into the 34-longword PRG table, never shifted. Hence always ≡ 0 (mod 4), ≤ 132 |
| +0x03 | 1 | `x` | viewport x of the 16×16 sprite's top-left, 0–192 |
| +0x04 | 1 | `y` | viewport y, 0–124 |
| +0x05 | 1 | pad | **always `0x00`** (3110/3110) |

Each group is one **tick**: the walker fills a 20-slot particle ring from the
group's records, presents a frame, waits `frameDelay+1` vblanks, then moves
to the next group. Live particles from earlier ticks keep running their PRG
script; the effect ends when the last group has been consumed *and* no
particle remains alive.

##### The consumer (**confirmed**)

`PlayEffect` at S_1 **`+0x25624`** — the particle-spawn walker. `A3` = the
effect script pointer from the `+0x2598A` table; `A2` = a 20-slot × 8-byte
particle array at S_1 `+0x25812`:

```asm
25624  ADDQ.L  #1,A3                ; skip hi byte of header word 0
25626  MOVE.B  (A3)+,$4D3(A5)       ; lastGroupIndex  (low byte)
2562A  ADDQ.L  #1,A3
2562C  MOVE.B  (A3)+,$4D7(A5)       ; frameDelay      (low byte)
                                    ; -> 4-byte header consumed
25630  LEA     $25812(pc),A0
25634  MOVEQ   #$9,D0
25636  CLR.L (A0)+ ×4 / DBRA        ; clear 40 longwords = 20 slots × 8 B
2564A  MOVE.W  #$98,D6              ; 152 = (20-1)×8, ring walks downward
2565C  MOVE.B  (A3)+,D0             ; record +0
2565E  BMI.B   $2568A               ; 0xFF -> end of this group/tick
25660  MOVE.B  D0,$4(A2,D6.W)       ; slot.gfkRecord
25664  MOVE.B  (A3)+,$5(A2,D6.W)    ; slot.gfkFrame   <- record +1
25668  LEA     $258C2(pc),A0        ; PRG script table
2566C  MOVEQ   #$0,D0
2566E  MOVE.B  (A3)+,D0             ; record +2
25670  MOVE.L  (A0,D0.W),(A2,D6.W)  ; slot.script = *(PRGtable + record[2])
25676  MOVE.B  (A3)+,$6(A2,D6.W)    ; slot.x          <- record +3
2567A  MOVE.B  (A3)+,$7(A2,D6.W)    ; slot.y          <- record +4
2567E  ADDQ.L  #1,A3                ; skip record +5 (pad)
25680  SUBQ.W  #$8,D6               ; next slot
25682  BPL.B   $25656
```

`MOVE.L (A0,D0.W)` uses record byte +2 **directly as a byte offset**, with no
`LSL`. That is exactly why the field is always a multiple of 4 — the index is
pre-multiplied in the data file.

Particle slot (8 bytes, 20 slots at S_1 `+0x25812`):

| Offset | Size | Field |
|--------|------|-------|
| +0x00 | 4 | current PRG step pointer (advanced by 3 each tick) |
| +0x04 | 1 | `gfkRecord` |
| +0x05 | 1 | `gfkFrame` |
| +0x06 | 1 | `x` |
| +0x07 | 1 | `y` |

Per-tick update at S_1 `+0x256A0` advances each live slot's script by 3 bytes
(the confirmed PRG record size), blits, then applies the step. The `0xFF` PRG
tag path adds the two signed deltas and **kills the particle if it leaves the
viewport**:

```asm
0256AC  ADDQ.L  #$3,(A2,D6.W)   ; advance PRG script by one 3-byte step
0256C0  BSR.W   $25B06          ; blit sprite
0256C6  MOVE.B  (A4)+,D0        ; PRG tag byte
0256C8  BMI.B   $256D8          ; 0xFF -> apply dx/dy
0256CE  JMP     (A0,D0.W)       ; else dispatch via jump table at $2576C
                                ;   (tags 0x3C/0x40/0x44 are byte offsets
                                ;    into a 4-byte-entry table, same
                                ;    pre-multiplied convention as record +2)
0256E4  ADD.W   D1,D0           ; x += signed dx
0256E6  BMI.B   $256D2          ;   x < 0   -> kill
0256E8  CMPI.W  #$C0,D0         ;   192
0256EC  BGT.B   $256D2          ;   x > 192 -> kill
0256FE  ADD.W   D1,D0           ; y += signed dy
025700  BMI.B   $256D2          ;   y < 0   -> kill
025702  CMPI.W  #$7C,D0         ;   124
025706  BGT.B   $256D2          ;   y > 124 -> kill
```

`frameDelay` (`$4D6(A5)`) is a plain vblank-wait counter at `+0x25720`:
`MOVE.W $4D6(A5),D2; BEQ; SUBQ #1,D2; <wait vblank>; DBRA D2` — so `0` runs
at full speed and `4` runs at one tick per 5 frames.

`lastGroupIndex` (`$4D2(A5)`) is compared against the running group counter
`$4D0(A5)` at `+0x25740`; on equality the spawner sets the "no more groups"
flag `$4CE(A5)`. That is the code-level statement of the `lastGroupIndex + 1
== groupCount` invariant.

The draw routine is `+0x25B06`. It takes `D2 = gfkRecord`, `D3 = gfkFrame`,
`D0 = x`, `D1 = y`; adds the effect origin `$4D8/$4DA(A5)` to `x`/`y`; indexes
the GFK table by `gfkRecord × 4`; adds the frame's byte offset from the LUT at
`+0x25C56`; skips `$20` (32 B) to step past the mask plane; and runs a 6-pass
cookie-cut blitter loop (`BLTCON0 = $?FCA`, `BLTSIZE = $402` = 16 rows × 2
words, screen stride 40 B). This independently re-confirms the documented GFK
geometry: 16×16, 1 mask plane + 6 EHB colour planes, 32 B per plane, 224 B per
frame.

##### Verification (ground truth)

| Check | Result |
|-------|--------|
| **Cross-platform name oracle** | DOS `clipper.clp` entry **225 `"Speed Effects"`**, type `0x05`, **size 20,195** — exact size match, and its payload at `clipper.clp+0xC542D` is **byte-identical to the Amiga bank across all 20,195 bytes** (the scripts are platform-independent, which is itself why `x`/`y` are logical viewport coordinates rather than Amiga blitter units) |
| **Section index table** | the game's own 95-entry table at S_1 `+0x2598A` equals the 95 section offsets derived blind from the data: **95/95 byte-exact**, monotonic, all < 20,195 |
| Structural closure | every `0xFF`-delimited part is `6k` or `6k+4` bytes — **1156/1156**, zero exceptions |
| Byte accounting | 95 headers × 4 + 3110 records × 6 + 1155 terminators = 380 + 18,660 + 1,155 = **20,195 = the exact file size; 0 unexplained bytes** |
| Group-count invariant | `lastGroupIndex + 1 == groupCount` for **95/95** sections, zero deviation |
| Pad byte | record +5 is `0x00` for **3110/3110** records |
| **GFK frame-count invariant** | record +1 `< gfkFrameCount[record +0]` for **3110/3110** records, **0 violations**. Non-trivial: GFK records 9/11/15 hold 3/4/2 frames and are never over-indexed across 203 records, while 5-frame records use frame 4 freely (95 times) |
| **Viewport bound** | record +3 ∈ [0,192], record +4 ∈ [0,124] for 3110/3110; both maxima are *exactly* `208−16` and `140−16`, matching the independently confirmed 208×140 viewport — and the engine's own kill test at `+0x256E8`/`+0x25702` is `CMPI.W #$C0` (192) / `CMPI.W #$7C` (124), the same two numbers |
| PRG index range | record +2 ≡ 0 (mod 4) for 3110/3110; max 132 = 33×4, i.e. exactly the 34 PRG records |
| PRG table cross-check | `+0x258C2` strides equal `14 + 3 × count` for **33/33** gaps, and all **34/34** entries land exactly on a `BCSPEED\0PRG\0` marker in the bank |
| GFK table cross-check | `+0x2594A` strides equal `14 + 224 × frames` for **15/15** gaps |
| Semantic check — mirror pairs | the PRG table is built from mirrored motion pairs. For all **8** x-mirrored pairs, `meanSpawnX(a) + meanSpawnX(b)` lands in **189.6–196.5** against the predicted mirror axis of 192. Sharpest cases: PRG 18 (net +93 x) mean x **27.0** vs PRG 19 (net −93) mean x **166.5**; PRG 12 (net +104 y, downward) mean y **0.0** vs PRG 13 (net −104, upward) mean y **119.0**. Scripts that travel further also spawn further out (PRG 20/22 at ±25 spawn at 32.9/158.5; PRG 21/23 at ±12 spawn at 62.2/130.5) |
| Correlation | over records whose script actually moves, `corr(net dx, spawn x) = −0.41` (n=491) and `corr(net dy, spawn y) = −0.52` (n=681) — emitters spawn on the side they travel away from |
| **Render** | all 95 effects were composited onto a 208×140 canvas, one image per tick, using the confirmed `bcspeed` GFK atlas. **Caveat: this renders only each tick's *spawn* positions — the PRG motion was deliberately not simulated**, so effects whose visual body comes from particle travel look sparse. Even so, none renders as noise, and the static-pattern effects are unmistakable: a 13-skull ring rotating through 4 phases (section 1), an imploding 12-fireball ring (section 9), a red bolt pyramid (2), a blue star funnel (3), a green star "X" (4), an insect swarm using the GFK bee sprite (27). Contact sheets are reproducible from the probe listed below |

> **Superseded — a true per-tick particle simulation is now implemented.**
> See "The PRG tag-byte jump table" below for the handler semantics this
> needed, and `simulate_effect` in "Still open" for the render itself. The
> spawn-only render above is kept for the record (it's what first confirmed
> the static-pattern effects); the frame-accurate one now shows genuine
> particle travel — the imploding fireball ring (section 9) visibly
> converges from a wide circle to a tight cluster over its tail ticks,
> instead of the same static ring size repeated for every group.

95 effects is the full spell/impact effect roster. Note the DOS port's
`"Speed Programs"` entry (226, 1,859 B) matches container entry 7's 1,859 B
exactly, and `"Speed Graphics"` (entries 228–300) is **73 × 16×16** — the same
73 frames the GFK section already confirmed.

> **Independently re-verified by the orchestrating session** (this
> escalation's findings were not taken on faith — see
> `verify-escalation-artifacts-not-just-claims.md` in the project-wide
> pitfalls list). A **fresh** r2 disassembly of `InitBcspeedTables`
> (`+0x25536`) and `PlayEffect` (`+0x25624`), run independently of the
> escalation's own session, matched its transcription byte-for-byte,
> instruction-for-instruction. A **from-scratch** blind parser (no code or
> data borrowed from the escalation's own probe script) reproduces the
> in-executable 95-entry section-offset table at `+0x2598A` **95/95
> byte-exact** and accounts for the bank's 20,195 bytes with **zero
> remainder** (`95×4 + 3110×6 + 1155×1 = 20195`, and a direct byte count
> confirms exactly 1,155 `0xFF` bytes in the whole bank — every single one
> is a group terminator, none stray). The DOS oracle claim was re-checked
> with this project's **own** `scripts/extract_clipper.parse_clp` (not the
> escalation's code): `clipper.clp` entry 225 is `"Speed Effects"`, type
> `0x05`, size 20,195, and its payload is **byte-identical** to the Amiga
> bank. All of this held up, so the format is now promoted to a committed
> extractor:

| Property | Value |
|----------|-------|
| Extractor | `scripts/bclib/bcdfa.py` (`eff_scripts`, `eff_table_offsets`), driven by `scripts/extract_bcdfa_eff.py` |
| Assets | `public/assets/blackcrypt/amiga/data/bcspeed-effects.json` — 95 effects, 3,110 particle records |

`eff_scripts` parses the bank directly from `bcdfa`'s raw bytes (no
decompression, no dependency on the decompressed `bcdft` S_1 image — the
format is self-describing); `eff_table_offsets` reads the in-executable
table separately as an *optional* integrity cross-check, which
`extract_bcdfa_eff.py` runs when the decompressed `bcdft` cache is present
and skips gracefully when it isn't. This is a data-only export — no
pixel rendering — since a static render of spawn positions alone would
misrepresent effects whose visual body comes from PRG particle travel (see
the "Render" row above); a consumer wanting pixels should composite
`sprites/bcspeed.*` frames at the recorded spawn position and then step
each particle through its own `prgOffset` script, exactly as `PlayEffect`
does.

##### The PRG tag-byte jump table (S_1 `+0x2576C`) — **SOLVED**

The table is **18 entries × 4 bytes** (`BRA.W` each), and the tag byte is a
pre-multiplied byte offset into it, so tags `0x00`–`0x44` are all legal.
Every handler was traced:

| Tag | Entry | Handler | Semantics |
|-----|-------|---------|-----------|
| `0x00`–`0x38` | 0–14 | `+0x257EE` | **absolute frame set**: `frame = tag >> 2` (`LSR.B #2,D0`), then if `frame == frameCount[gfkRecord]` kill the particle, else fall through to the dx/dy step. **Unused by the shipped data** — the only tags any of the 34 PRG records contain are `0x3C`, `0x40`, `0x44` and `0xFF` |
| `0x3C` | 15 | `+0x257B4` | **kill**: `CLR.L (A2,D6.W)` clears the slot's script pointer; no dx/dy applied. Last record of all 34/34 scripts, as already observed |
| `0x40` | 16 | `+0x257BC` | **next frame**: `ADDQ.B #1,$5(A2,D6.W)`; if the new frame equals `frameCount[gfkRecord]` the particle is killed, otherwise control falls into the dx/dy step at `+0x256D8` |
| `0x44` | 17 | `+0x257DE` | **previous frame**: `SUBQ.B #1,$5(A2,D6.W)`; if it goes negative the particle is killed, otherwise dx/dy is applied |
| `0xFF` | — | `+0x256D8` | dx/dy only, no frame change (already documented) |

All three frame-changing handlers bound-check against a **16-byte table at
S_1 `+0x258B2`**:

```
03 05 05 05 05 05 05 05 05 03 05 04 05 06 05 00
```

Those are the **per-GFK-record frame counts**, and they match the 16 frame
counts recovered independently from the GFK bank's own record headers
(3, 5×8, 3, 5, 4, 5, 6, 5, …) on **15/16 records** — the 16th entry is `0x00`
where the GFK header says 2, so record 15's animation must terminate through
`0x3C` rather than by frame-count overflow. The table sits immediately before
the 34-entry PRG pointer table at `+0x258C2`, i.e. `+0x258B2 + 16 = +0x258C2`
exactly.

With these handlers the particle simulation is fully specified: per tick,
`script += 3`; blit `(gfkRecord, gfkFrame)` at `(x, y) + origin`; read
`tag = script[0]`; dispatch; then for every path except `0x3C`, apply
`x += (int8)script[1]`, `y += (int8)script[2]` and kill the particle if it
leaves `x ∈ [0,192]` / `y ∈ [0,124]`.

##### Which effect belongs to which spell — **SOLVED (92 of 95 effects attributed)**

> **Correction — supersedes "advanced, still open", "the actual static table
> is in the on-disk `bcdfs` structure record layout" (half right — it is, but
> only for effects 1-8), and "15 constant effect indices recovered" as the
> ceiling.** Two things were missing, and each unlocked a different half of
> the map:
>
> 1. The on-disk-table hypothesis was **correct** — `bcdfs` structure type
>    `0x10`'s word `+0x10` really is the static effect-index table the
>    instruction-level write-site census could not find, because the loader
>    copies the record **verbatim** (`pea $14.w` at S_1 `+0x18A56`) and never
>    writes that word for a non-monster record. It accounts for effects
>    **1-8** only, though: 13 glyph records × 2 uses each.
> 2. The other 80 effects were never in a *table* at all. They are constant
>    arguments to a **shared projectile-spell routine**, `CastSpellRay` at
>    S_1 `+0x06D9A`, whose third stack word is the base effect index. The
>    earlier passes stopped at "the site computes the index" without tracing
>    the *callee's* argument frame, so 27 call sites carrying a compile-time
>    constant effect index looked like "computed, unknown".

Three independent mechanisms select an effect. All three are now traced.

###### 1. Glyphs — the on-disk `bcdfs` table (effects 1-8) — **confirmed**

`bcdfs` structure type `0x10` covers three different objects, discriminated by
the record's own **word `+0x0C`** (see the new field map in the `bcdfs`
"Structure bytecode" section). Only sub-kind 3 — the *glyph* — touches
BCSPEED, and it does so twice, through two unrelated code paths that read the
**same** on-disk word `+0x10`:

| Path | Code | Effect index |
|---|---|---|
| **Viewport rune** (the glyph drawn on the floor ahead) | the **kind-4/12 handler `+0x0224C`**'s type-`0x10` case, S_1 `+0x0231C` → `+0x02388` (*corrected — this address is inside `+0x0224C`, not `DispatchSquareObject`, whose entry is `+0x025B0`*): `D0 = objRec.word(+0x10)`, `D1 = objRec.byte(+0x07)`, origin (0,0), via the **static-tick** entry `+0x2558C` | `word(+0x10)` — raw |
| **Trigger animation** (party steps onto the glyph) | `ResolveTargetSquare` returns **5** for a sub-kind-3 record (S_1 `+0x27CC8`: `CMPI.W #3,$C(A5,D4.W)` → `MOVEQ #5,D3`); `MoveParty` dispatches code 5 to S_1 `+0x04662` (`+0x016FA6`), which does `MOVE.W $10(A0,D0.L),D0 / ADDQ.W #4,D0` and calls the full animator `+0x255DA` at `+0x046C8` | `word(+0x10) + 4` |

```asm
; S_1 +0x027CBA  — ResolveTargetSquare, structure type 0x10
027CBA  CMPI.B  #$10,D5
027CC0  CMPI.W  #$0,$A(A5,D4.W)   ; record word +0x0A != 0 -> passable, no effect
027CC8  CMPI.W  #$3,$C(A5,D4.W)   ; sub-kind 3  = GLYPH
027CD0  MOVEQ   #$5,D3            ;   -> result 5 -> +0x4662 plays word(+0x10)+4
027CD4  CMPI.W  #$2,$C(A5,D4.W)   ; sub-kind 2  = MAGIC FIELD
027CDC  MOVEQ   #$7,D3            ;   -> result 7 = blocked + screen shake, no effect
027CE0  CMPI.W  #$1,$C(A5,D4.W)   ; sub-kind 1  = ILLUSIONARY WALL
027CE6  BNE.B   $27D18            ;   -> falls through, passable, no effect
```

`+0x04662` immediately re-reads the same record's word `+0x10` into A3 and
uses it a **second** time as a 5-entry jump-table index (table at S_1
`+0x04822`, JMP base `+0x0483A`), so the same byte picks both the visual and
the mechanical payload:

| `word +0x10` | Rune effect | Trigger effect | Handler | Payload |
|---|---|---|---|---|
| 1 | 1 | **5** | `+0x04702` | if word `+0x0E` == 0: `DamageCharacter(ch, ch.hp−1, kind 4)` on every living member — i.e. reduces the whole party to 1 HP |
| 2 | 2 | **6** | `+0x0476A` | `+0x04600(5, 5×word(+0x0E), 4)` → each member takes `5 + rand(5×w0E)` of damage kind 4 |
| 3 | 3 | **7** | `+0x04780` | byte-identical body to handler 2 (separate `case` the compiler did not merge) |
| 4 | 4 | **8** | `+0x04796` | `DamageCharacter(ch, 1+rand(10), kind 5)` for members whose byte `+0x8B` is clear, and `ch[+0x9A]++` |
| 0 | — | — | `+0x0483C` | the shared no-op tail. **Unused by the shipped data** |

###### 2. Projectile spells — `CastSpellRay` (effects 9-88) — **confirmed**

`CastSpellRay` at S_1 **`+0x06D9A`** is a 5-word-stack-arg routine shared by
every directed attack spell:

| Frame | Field | Notes |
|---|---|---|
| `8(A5)` | magnitude | computed per cast from the caster's level (`D3`/`D5`) |
| `A(A5)` | damage | 0…100 |
| `C(A5)` | **base effect index** | the value this section is about |
| `E(A5)` | pre-effect selector | `1` = none, `0x66` = screen-shake first (`JSR $A39B0`), `0x67` = its own variant |
| `10(A5)` | **range** | max squares the ray walks — `3` or `1`; passed straight to the ray-march at `+0x0435C` |

```asm
006E5C  MOVE.W  $C(A5),D0        ; base effect index
006E60  ADD.W   D6,D0            ; D6 = squares the ray travelled (from +0x435C)
006E62  TST.W   D6
006E66  MOVEQ   #$1,D1           ;   D6 == 0 -> +1
006E6A  MOVEQ   #$0,D1
006E6C  ADD.W   D1,D0
006E6E  ADDI.W  #$FFFF,D0        ; -1
006E72  MOVE.W  D0,-(A7)
006E74  JSR     $A5632.L         ; = PlayEffect (+0x255DA)
```

i.e. **`effect = base + max(distance, 1) − 1`**, so a range-3 spell owns three
consecutive indices (one per view depth) and a range-1 spell owns one. This is
why the recovered bases form an exact stride-3 lattice.

Caller: `CastSpell(slot)` at S_1 **`+0x07044`**, which reads the memorised
spell id from `char[+0x49+slot]` and dispatches through a **60-entry word jump
table at S_1 `+0x07822`** (JMP base `+0x078AC`, bound `CMPI.W #$3C,D0`). The
spell id indexes the **60-record, 8-byte spell table at `bcdft` S_2
`+0x000E`**, whose word `+0x04` is a `char *` to the spell's display name
(name block at S_1 `+0x1A7FA`). Three cases print their own name with a
PC-relative `PEA` and those strings match the S_2 table at the same index
(`SHIELD` id 15, `PROTECT` id 27, `CURE` id 53) — that is what pins the id
space.

| Spell (id) | Base | Effects | Damage | Range | Case |
|---|---|---|---|---|---|
| CHANT OF DOOM (55) | 9 | 9–11 | 0 | 3 | `+0x075F4` |
| LIGHTNING FIELD (47) | 12 | 12–14 | 45 | 3 | `+0x072F8` |
| FIREBALL (14) | 15 | 15–17 | 6 | 3 | `+0x0728C` |
| FREEZE (23) | 18 | 18–20 | 8 | 3 | `+0x072B0` |
| CHANT OF ORLIN (8) | 21 | 21–23 | 6 | 3 | `+0x07268` |
| STONE FIRE (28) | 24 | 24–26 | 6 | 3 | `+0x072D4` |
| SWARM (33) | 27 | **27** | 6 | **1** | `+0x0731C` |
| PESTILENCE (52) | 28 | **28** | 8 | **1** | `+0x07340` |
| BLAST OF COLD (58) | 38 | 38–40 | 30 | 3 | `+0x0763C` |
| QUAKE (59) | 38 | **38** | 100 | **1** | `+0x077E8` (shares BLAST OF COLD's visual; pre-effect `0x66` = quake shake) |
| DEATH (50) | 41 | 41–43 | 20 | 3 | `+0x075CE` |
| DEATH STORM (16) | 44 | 44–46 | 90 | 3 | `+0x0742E` |
| DIETY STRIKE (39) | 47 | 47–49 | 40 | 3 | `+0x07584` |
| DISRUPT (35) | 50 | 50–52 | 50 | 3 | `+0x074E6` |
| FIRE MAELSTROM (31) | 53 | 53–55 | 100 | 3 | `+0x074C0` |
| FIRE VORTEX (30) | 56 | 56–58 | 45 | 3 | `+0x0749C` |
| FIRE WIND (29) | 59 | 59–61 | 10 | 3 | `+0x07478` |
| ICE STRIKE (57) | 62 | 62–64 | 70 | 3 | `+0x07618` |
| LIFESTEALER (17) | 65 | 65–67 | 24 | 3 | `+0x076C4` |
| MIND STRIKE (49) | 68 | 68–70 | 18 | 3 | `+0x075AA` |
| POISON CLOUD (0) | 71 | 71–73 | 8 | 3 | `+0x073E4` |
| RUNE OF DEATH (37) | 74 | 74–76 | 80 | 3 | `+0x07538` |
| RUNE OF PAIN (36) | 77 | 77–79 | 8 | 3 | `+0x07514` |
| VORPAL AIR (38) | 80 | 80–82 | 15 | 3 | `+0x0755E` |
| CHAOS (25) | 83 | 83–85 | 6 | 3 | `+0x07454` |
| GODS FURY (11) | 86 | 86–88 | 60 | 3 | `+0x07408` |

A second dispatcher at S_1 `+0x130xx` (scroll/wand/monster casts) reuses the
same routine with the same bases — `+0x130DE` 28 (PESTILENCE), `+0x13102` 15
(FIREBALL), `+0x1313E` 24 (STONE FIRE), `+0x1317A` 21 (CHANT OF ORLIN),
`+0x1319E` 18 (FREEZE), `+0x131C2`/`+0x10FE6` 38 (QUAKE) — an independent
re-derivation of six of the rows above.

###### 3. Constants in named spell / trap routines (effects 0, 29-37, 89-94)

Attributed by locating each call site's enclosing `LINK` and matching it
against the routine the spell jump table calls for that spell id:

| Effect | Consumer | Evidence |
|---|---|---|
| **0** | the generic party buff/heal sparkle | 9 call sites, each inside a named spell routine: HEALING I/II + CURE WOUNDS (`+0x05070`), RESTORE (`+0x051DE`), CURE POISON (`+0x052D6`), CURE DISEASE (`+0x0540E`), SHIELD + PROTECTION (`+0x054E2`), STRENGTH (`+0x05710`), RAISE DEAD (`+0x05CFA`), plus `+0x061B0` and `+0x0F3A0` |
| **6** | **action opcode `0x1C` — "trap damage (fire)"** | handler `+0x0CCCC` (jump table `+0x0CE54`, JMP base `+0x0CEAA`) calls `+0x0C236` at `+0x0CCD0`, which plays effect 6 |
| **7** | **action opcode `0x1D` — "trap damage (ice)"** | handler `+0x0CCDA` calls `+0x0C288` at `+0x0CCDC`, which plays effect 7 |
| **29** | REMOVE TRAP (`+0x060BE`) | site `+0x06182` |
| **30** | REMOVE GLYPH (`+0x04E0A`) | site `+0x04EEA` |
| **33** | BINDING (`+0x04A4E`) | site `+0x04A70`; also `+0x079EE`/`+0x07B5A` in two helpers |
| **35** | `+0x09D28` — a monster/attack routine (4 callers) | site `+0x0A370`, guarded on `objRec.byte(+0x0C) == (facing+2)&3` (target faces the party) |
| **36** | DISPEL MAGIC (`+0x04C46`) | site `+0x04D0E` |
| **37** | `+0x062D0`, called from the item-use dispatcher `+0x10FFE` | site `+0x063DC`; also base 37 at `+0x13264` |
| **89** | **trap-detection marker** on a type-`0x1E` floor plate/trap | `+0x02548` (`MOVEQ #$59,D0`), gated on depth 1, `objRec.word(+0x0E) == 1` (41 of 182 records), `word(+0x0C) != 0`, and the party-wide counter `$1E2C(A4) != 0` |
| **90** | **fountain water** on a type-`0x1F` fountain | `+0x02460` (`MOVEQ #$5A,D0`), on the `word(+0x0E) == 0` branch, gated on `byte(+0x07) != 0` — that byte is the fountain's remaining water units (values 0/2/3/5/10/25/255 across the 41 shipped records) |
| **91** | `+0x12FEA` (strings HEAL / SPELL FAILED) | site `+0x1309A` |
| **92** | `+0x16502` (string THE KEY DOES NOT FIT) | site `+0x16A62` |
| **93** | the single monster with gfx word `0x80C5` (map 13, row 12, col 12, `bcdfs+0x02893D`, 350 HP — the final boss) | `+0x02752` inside `DispatchSquareObject`, gated on `CMPI.L #$80C5` and `$1A1E(A4)==4`, group index `$1A20(A4)` cycling 0–3; second site `+0x07DA2` in `+0x07C40` steps the same counter |
| **94** | `+0x07C40`, called from `+0x13298` | site `+0x07C6C`, immediately before the effect-93 loop |

###### Coverage and verification

| Check | Result |
|---|---|
| **Glyph field invariant** | all **13/13** `bcdfs` type-`0x10` sub-kind-3 records have `word(+0x10) ∈ {1,2,3,4}` — never 0, never ≥ 5, i.e. **zero** dispatches outside the 5-entry jump table at `+0x04822`, and the resulting effect indices land exactly on 1–4 (runes) and 5–8 (triggers) with no gap and no overflow past the bank's 95 effects |
| **Sub-kind partition** | the 97 type-`0x10` records split **59 / 25 / 13** on `word(+0x0C)` = 1/2/3, and each sub-kind has exactly one `gfxNumber` (`0x00C1` / `0x0048` / `0x003C`) — **97/97**, zero mixing. Only sub-kind 3 reaches an effect call in either code path |
| **Element cross-check (independent chains)** | glyph type 2 → trigger effect 6, which is *separately* proven to be action opcode `0x1C` **"trap damage (fire)"**; glyph type 3 → effect 7 = opcode `0x1D` **"trap damage (ice)"**. The already-published render of the *runes* (drawn before any of this was known) describes effect 2 as a **red** bolt pyramid and effect 3 as a **blue** star funnel. Colour matches element on both, derived from three chains that share no evidence |
| **Name cross-check** | effect **27** is `SWARM`'s only effect under the range-1 rule; the earlier independent render describes effect 27 as "an insect swarm using the GFK bee sprite" |
| **Lattice closure** | the 26 recovered bases are `9,12,…,27` and `38,41,…,86` — an exact stride-3 lattice with **no collisions** except QUAKE/BLAST OF COLD (both 38, and QUAKE is range-1 so it only uses index 38 itself). Range-3 spells own `[base, base+2]`; the union of those intervals plus the two range-1 singletons covers **9–28 and 38–88 with zero holes and zero overlaps** |
| **Spell-id space** | 60 jump-table entries (`CMPI.W #$3C`) = 60 records in the S_2 spell table = the exact count; three cases push their own name string PC-relative and it equals the S_2 table's name at the same id (`SHIELD` 15, `PROTECT` 27, `CURE` 53) |
| **Total coverage** | **92 of 95** effects now have an identified consumer. Only **31, 32, 34** remain unattributed — no call site, no table entry, and no `bcdfs` field value reaches them |

Probe: `scratchpad/probes/{probe_t10b,spellmap2,verify}.py` (throwaway).

> **Correction — a wrong relocation base made the call sites look
> nonexistent.** A first pass concluded that `+0x2558C` and `+0x255DA` have
> **no callers anywhere in S_1**, because absolute `JSR $xxxxxxxx.L` operands
> were resolved with a base of `0x80000`. The real base is **`0x80058`**
> (calibrated by requiring the resolved targets to land on function
> prologues: 216/267 targets hit `MOVEM`/`LINK`/`LEA 4(A7)`/`RTS` at
> `0x80058` versus a scatter at any other base, and `0xA8B12 − 0x80058 =
> 0x28ABA`, just inside S_1's `0x28B14` of live bytes). With the right base
> the callers appear immediately. **Lesson: calibrate a relocation base
> against instruction boundaries before concluding "no xrefs exist".**

Two entry points, both confirmed:

| Entry | Signature | Role |
|-------|-----------|------|
| S_1 `+0x2558C` | register args — `D0` = effect, `D1` = group/tick, `D2`/`D3` = origin | draws **one static tick** of an effect (no animation) |
| S_1 `+0x255DA` | **stack args**, `LEA $4(A7),A1`; `(A1)` = effect index, `4(A1)` = origin x, `6(A1)` = origin y, `8(A1)` = flag; callers clean up with `LEA $A(A7),A7` (5 words) | the full animator (`PlayEffect`, body at `+0x25624`) |

**31 call sites** exist: 5 for `+0x2558C` and **26** for `+0x255DA`. Fifteen
of the 26 push the effect index as a literal:

| Effect | Call sites (S_1) | Nearby string context |
|--------|------------------|------------------------|
| 0 | `+0x5102`, `+0x526E`, `+0x5366`, `+0x549E`, `+0x561E`, `+0x5834`, `+0x608E`, `+0x625E`, `+0xF528` (9 sites) | `CURE`, `RESTORE`, `STRENGTHEN`, `PARTY HELD`, `RAISE`, `PROTECT` — all beneficial party-target spells; each pushes `x`/`y` from a 14-byte-per-slot party-position table at `A4−0x7200` |
| 6 | `+0xC25E`, `+0x1637E` | — |
| 7 | `+0xC2B0` | — |
| 29 | `+0x6182` | `PROTECT` |
| 30 | `+0x4EEA` | — |
| 33 | `+0x4A70`, `+0x79EE`, `+0x7B5A` | — |
| 35 | `+0xA370` | — |
| 36 | `+0x4D0E` | — |
| 37 | `+0x63DC` | `PROTECT` |
| 91 | `+0x1309A` | `HEAL`, `SPELL FAILED` |
| 92 | `+0x16A62` | `THE KEY DOES NOT FIT` |
| 94 | `+0x7C6C` | — |

The remaining sites compute the index:

- `+0x46C8`: `effect = objectPool[i].word(+0x10) + 4`, where the pool is the
  20-byte-record array at `A4−0x6E7A` (S_2 offset `0x1184`). That array is
  **BSS filled at runtime** — its `+0x12` field is a free-list "next" index
  (pop/push helpers at S_1 `+0x0006` and `+0x0046`), so it is a dynamic
  object pool, not a static spell table. The static source of field `+0x10`
  is the next thing to find.
- `+0x6E74`: `effect = arg + D6 + (D6 == 0) − 1`, in a function whose strings
  are `TELEPORT FAILED` / `CANNOT TELEPORT THERE`.
- `+0xA388`: from a local, `−0x38(A5)`.

**Still open:** a complete spell → effect map.

> **Correction/refinement — the field `+0x10` writer search was completed
> this pass and came back negative in an informative way: the field isn't
> written by any single discrete `MOVE` instruction at all for the object
> "type" this reader cares about.** A full byte-pattern census for
> `LEA −0x6E7A(A4),An` (all 7 address-register forms) found **703** hits —
> far too many to eyeball (this pool base is used everywhere for many
> unrelated object "types"/fields) — so the search was narrowed to the
> actual write shape: `MOVE.? src,$10(An,Dn.?)` regardless of base,
> confirming the base immediately before it. That found exactly **5** write
> sites, and every one turned out to serve a *different* purpose than a
> spell-effect index:
>
> - `+0x1256`/`+0xBB82` write a value that was just popped off the stack —
>   tracing further back, the value is a **party-member cycling counter**
>   (`(value+1) & 3`, i.e. 0-3, matching the 4-character party), unrelated to
>   effects.
> - `+0x18676`/`+0x18AA` write the return value of `JSR $8005E.L`
>   (`= S_1 +0x6`, confirmed as the pool's own **free-list "pop" helper** —
>   the same routine documented above) into a *different, already-existing*
>   object's `+0x10` field — a back-reference to a newly-allocated pool
>   slot, not an effect index.
> - `+0x15ED0` copies `A4+0x1A14` into `+0x10` — but `A4+0x1A14` is itself a
>   **0-3 cycling "current party member" iterator**, initialised to 1 by the
>   startup routine at S_1 `+0x19564` (which clears a whole block of party-
>   loop state in the same instruction run) and stepped `(v+1)&3` at several
>   sites (`+0xF8DA`, `+0xF90C`, `+0xFB68`, `+0x178E6`, `+0xFE4E`) that all
>   read the *same* 4-character HP array at `+0x1758(A4)` documented in
>   "Character Record Layout" — again unrelated to spell effects.
>
> This is the **`locally-indexed-substructures`** pitfall exactly: the
> 20-byte pool record's `+0x10` field means something different depending on
> the object's own "kind", and these 5 writers all belong to kinds that
> aren't the one `+0x46C8` reads from.
>
> **What the `+0x46C8` reader's object actually is, traced from its own
> caller:** the function containing `+0x46C8` starts at S_1 `+0x4662`. Right
> before the `+0x10`-field read, it calls `JSR $A7D80.L` (`= S_1 +0x27D28`)
> with `D3 = 0x10` (a **type filter**, coincidentally also numerically `0x10`
> — not to be confused with the record field offset), `D2`/`D1` = the values
> at `A4+0x1740`/`A4+0x1742` (a current dungeon-square X/Y pair, by their use
> elsewhere). `+0x27D28` walks the object pool's own per-square linked list
> (chained via each record's `+0x12` "next" field, matching the free-list
> convention already documented) filtering on the record's `+0x05` type
> byte, and returns the **matching object's own pool index** — or an
> unfiltered chain head if none matches. In other words, `+0x46C8`'s `D3` is
> **not a freshly-created object** and is **not written by any runtime
> instruction traced this pass** — it is an *existing* structure/trap object
> already resident on the current dungeon square, of type `0x05`-field
> value `0x10`. Its `+0x10` field is therefore populated when that object's
> 20-byte record is first built from the on-disk `bcdfs` structure/trap
> data during map load (a bulk field-by-field copy, not a discrete
> `MOVE ...,$10(...)` the way a runtime-computed value would be), which is
> exactly why an instruction-level census for the writer comes up empty —
> there isn't one to find in S_1.
>
> **Concrete next step, genuinely different from both prior approaches:**
> trace the on-disk `bcdfs` structure-type-`0x10` record's own field layout
> (the "Structure/Item type tables" walked at S_1 `+0x186E0`/`+0x18B5C`/
> `+0x18B74`/`+0x18C10`/`+0x18C28`, per the `bcdfs` "Runtime parser"
> subsection) and identify which on-disk byte the map loader copies into
> runtime offset `+0x10` — that on-disk byte is the actual static
> spell/trap-effect table entry, not anything in S_1's executable code.
>
> > **Resolved — this next step was taken and the hypothesis held.** The
> > on-disk word is `+0x10` itself (the loader's `pea $14.w` copy is verbatim,
> > so runtime `+0x10` *is* on-disk `+0x10` for every non-monster record).
> > It supplies effects **1-8** only — the glyph runes and their triggers.
> > See "Which effect belongs to which spell — **SOLVED**" at the top of this
> > subsection for the full result, including the second, larger mechanism
> > (`CastSpellRay` `+0x06D9A`) that the "no static table in code" conclusion
> > had ruled out prematurely: the constants were in *caller argument frames*,
> > not in a table, and were invisible to every table- and write-site-shaped
> > search tried so far.

##### Still open

| Question | Status |
|----------|--------|
| Which of the 95 effects belongs to which spell/attack | **SOLVED for 92 of 95.** Three mechanisms, all traced: (1) `bcdfs` structure type `0x10` sub-kind 3 (glyph) word `+0x10` → effects **1–4** (viewport rune, raw) and **5–8** (trigger, `+4`), 13/13 records in range with zero exceptions; (2) `CastSpellRay` S_1 `+0x06D9A`'s third stack word → effects **9–88**, 26 named spells via the 60-entry spell jump table at `+0x07822` and the S_2 spell-name table at `+0x000E`, an exact stride-3 lattice with no holes; (3) constants in named spell/trap/render routines → effects **0, 29–37, 89–94**. Only **31, 32, 34** have no identified consumer. See "Which effect belongs to which spell — **SOLVED**" above |
| PRG tag bytes `0x3C`/`0x40`/`0x44` | **SOLVED** — all 18 jump-table handlers traced; see "The PRG tag-byte jump table" above |
| Simulating PRG particle motion for a full render | **SOLVED.** `bclib.bcdfa.simulate_effect` implements the full per-tick loop (20-slot ring, top-down spawn-overwrite, `scriptPtr += 1 record` / blit / tag-dispatch / dx-dy / viewport-kill, trailing ticks after the last group until every particle dies). Driven by `scripts/render_bcspeed_eff.py` → `data/bcspeed-effects-simulated.json` (web asset — per-tick particle lists for a browser engine to play back) + `build/cache/blackcrypt/bcspeed_eff_render/effect*.png` (verification contact sheets, not a web asset). Verified: runs error-free across all 95 effects (1,833 total simulated ticks); every particle stays within the confirmed viewport/frame bounds on every tick; tick 0 of every effect reproduces its raw group-0 spawn records **exactly** (95/95, the strongest available regression check against the already-verified static reading); GFK frame counts derived from the GFK bank itself match the engine's own `+0x258B2` table on 15/16 records, with the one documented exception (record 15) behaving exactly as predicted (kill-by-`0x3C` before the bound would matter). Visual check: the "imploding fireball ring" (effect 9) now visibly converges tick-by-tick instead of repeating a static ring |

##### `0x300C2`–EOF tail — **SOLVED — the Throwing-Items projectile sprites**

> **Correction — supersedes "same small-integer profile as entry 6 … very
> likely the same family of table/script data as entry 6, not pixel data."**
> It is pixel data, and the "small-integer / heavy zero-padding" profile is
> simply what **1-bit-per-pixel 16-px-wide bitplanes** look like when you
> histogram them. Entry 12 is the in-flight sprite bank for thrown/fired
> weapons.

Container-directory entry 12, `comp=0` (raw), 1,092 bytes, slot `0x34`.

| Property | Value | Confidence |
|----------|-------|------------|
| Records | **12** = 2 weapons × 3 view depths × 2 facings | **confirmed** |
| Geometry | **16 px wide**, heights 11 / 8 / 5 (arrow) and 7 / 5 / 3 (dagger) | **confirmed** |
| Planes | **7** — plane 0 = 1-bit cookie-cut mask, planes 1–6 = 6bpp EHB colour (the project-standard masked convention) | **confirmed** |
| Layout | facing 0 at `0` … `545`, facing 1 (**exact horizontal mirror**) at `546` … `1091` | **confirmed** |
| Palette | registers 3–25 + EHB 34–57 only; never touches the 26–31 accent ramp, like the item icons | **confirmed** |
| Descriptor table | S_1 **`+0x21B1C`** (facing 0) and **`+0x21BC4`** (facing 1), 6 × 28-byte generic blit descriptors each | **confirmed** |
| Consumer | S_1 **`+0x21A78`** — the projectile flight animator | **confirmed** |

Record table, straight out of the game's own descriptors (`src` is the byte
offset in the 1,092-byte chunk; every `bytesPerPlane`, `BLTSIZE` and modulo
satisfies the three 28-byte-descriptor invariants):

| # | Facing 0 `src` | Facing 1 `src` | Geometry | Bytes (7 planes) | Content |
|---|----------------|----------------|----------|------------------|---------|
| 0 | 0 | 546 | 16×11 | 154 | Arrow, near |
| 1 | 154 | 700 | 16×8 | 112 | Arrow, mid |
| 2 | 266 | 812 | 16×5 | 70 | Arrow, far |
| 3 | 336 | 882 | 16×7 | 98 | Dagger, near |
| 4 | 434 | 980 | 16×5 | 70 | Dagger, mid |
| 5 | 504 | 1050 | 16×3 | 42 | Dagger, far |

`1050 + 7 × 6 = 1092` — the chunk's exact size, **zero gap, zero overlap**.

The animator:

```asm
21A78  MOVEM.L D2-D7/A2-A6,-(A7)
21A86  TST.W   D0                  ; D0 = weapon type (0 = arrow, 1 = dagger)
21A88  BNE.B   $21A90
21A8A  MOVEQ   #2,D5 / #2,D6 / #6,D7   ; arrow:  path stride +2, depth steps at 2 and 6
21A90  ; (dagger keeps D5=0, D6=4, D7=$C — depth steps at 4 and 12)
21A92  MULU.W  #$54,D3             ; x84 = 3 descriptors x 28 -> this weapon's depth set
21A96  LEA     $21B1C(pc),A2       ; facing 0
21A9A  TST.B   D2
21A9E  LEA     $21BC4(pc),A2       ; facing 1
21AA6  MULU.W  #$C,D0              ; x12 -> per-weapon hot-spot table
21AAA  LEA     $21C6C(pc),A0
21AB2  LEA     $21A48(pc),A3       ; the flight-path table
21AD2  MOVE.B  (A3)+,D0            ; path x
21AD8  MOVE.W  #$CF,D1 / SUB.W D0,D1 ; mirror: x' = 207 - x
21AE0  SUB.W   (A4),D0             ; minus hot-spot x
21AE4  MOVE.B  (A3)+,D1            ; path y
21AE6  SUB.W   $2(A4),D1           ; minus hot-spot y
21AEC  BSR.W   $24C6E              ; generic blit
21AF0  BSR.W   $203A0              ; present
21AF4  BSR.W   $26538              ; restore background
21AFA  CMP.W   D6,D4 / CMP.W D7,D4 ; at these steps ...
21B04  LEA     $1C(A2),A2          ;   ... advance to the next (smaller) depth
21B08  ADDA.L  D5,A3               ; skip D5 extra path bytes (arrow flies twice as fast)
```

Two independent tables corroborate the geometry:

- **Hot-spot table**, S_1 `+0x21C6C`, 12 B per weapon = 3 word pairs:
  arrow `(8,6) (8,4) (8,2)`, dagger `(8,4) (8,2) (8,1)`. `x` is always 8 =
  half of 16, and `y` is exactly `height / 2` for all six heights
  (11→6, 8→4, 5→2, 7→4, 5→2, 3→1) — **6/6, derived from a table the record
  sizes were not read from.**
- **Flight-path table**, S_1 `+0x21A48`, 48 B = 24 `(x, y)` byte pairs running
  `(154,54) → (122,44)`: the projectile recedes toward the vanishing point,
  which is why three shrinking depth sizes exist at all. The mirror form
  `207 − x` matches the confirmed 208-px viewport width exactly.

###### Verification (ground truth)

| Check | Result |
|-------|--------|
| **Cross-platform name oracle** | `clipper.clp` brackets exactly these six sprite *shapes* between the type-1 markers **432 `"Start Throwing Items"`** and **445 `"End Throwing Items"`** (entries 433–444, 12 total): `Arrow` 16×11 and `Dagger` 16×7 (only the near-depth entry of each carries a name string — the same "name the first of 3 depths only" convention as `Start Keys`/`Start Floor Items`), plus their unnamed 16×8/16×5 and 16×5/16×3 mid/far siblings. The DOS port additionally carries `Sword` (32×15, named) and `Hammer` (16×13, named) there, each with 2 further unnamed depth siblings; the Amiga bank has only the two weapons, and its 12 descriptors and byte-exact accounting say so independently |
| **DOS silhouette match** | the 1-bit mask planes of the six facing-0 records are **byte-identical** to the DOS entries' non-background silhouettes — a verbatim `bytes.find()` hit for 5 of 6 (the 6th, 16×3, was only excluded by a height filter). Later re-run per pixel against the DOS bracket's *depth-ordered* entries 433–438 (`data != 33` vs the mask plane): **624/624 px, 100.000%**, all six shapes, opaque counts 63/35/18 (arrow) and 56/15/11 (dagger) matching exactly — so the DOS mid/far entries, which carry no name, are confirmed as this bank's depths 2 and 3 and not merely as "six shapes that happen to be present". See `docs/blackcrypt/dos/data-structure.md` § "Residue 2 — `Start Throwing Items`" |
| **Mask invariant** | `plane0 == OR(planes 1..6)` for **156/156 bytes**, zero deviation — the record boundaries and the 7-plane reading are self-consistent |
| **Mirror invariant** | rows `273…545` are the **exact horizontal bit-reverse** of rows `0…272`: **273/273 rows, zero deviation** |
| Byte accounting | the 12 descriptors tile the chunk **1,092/1,092 bytes, 0 gaps, 0 overlaps** |
| Descriptor self-consistency | `bytesPerPlane == (w/8)×h`, the `BLTSIZE` identity and `modulo + blitBytes == 40` hold on **12/12** records |

**Why the earlier "raw, small-integer, probably script data" reading missed
it:** entry 12 is the only bcdfa bank that is *both* stored raw *and* pixel
data, so the two heuristics that had worked everywhere else ("`comp=0` ⇒ not
pixels", "low entropy ⇒ tables") pointed the wrong way together. The 15-form
`(d16,A5)` census also returns **zero** hits for slot `0x34` — correctly, and
misleadingly: banks reached through the generic blitter are addressed by a
**slot number stored in the descriptor's `+0x00` field** and loaded with an
*indexed* `MOVEA.L (A5,D0.W),An` — `+0x24C1C` (`A0`) and `+0x24C8C` (`A3`),
both preceded by `MOVE.W $0(A0),D0` — never with a literal displacement. Slot `0x30` (the confirmed floor-item bank) is invisible to the
same census for the same reason. **Scanning for 28-byte descriptors is the
reliable way to find a bank's consumers; the A5-displacement census is not.**

##### Paths tried (historical, kept for the record)

| Approach | Result |
|----------|--------|
| Opaque 6-plane render, widths 16/32/48/64/80/96/112/128/176/208 px (entries 4-5 combined stream) | No coherent image at any width; some regions show plausible-looking repeated brownish banding at 128-208 px but it does not hold up under closer inspection |
| Masked (7-plane: 1 mask + 6 EHB colour) render, widths 16/32/48/64 px | No coherent image |
| Strict index-33 padding-column scan (the technique that solved the UI panel bank) | Zero hits in either stream |
| Generalised any-constant-index padding-column scan | Thousands of hits in the 34,340-byte stream (false-positive rate consistent with ordinary detailed image content) |
| 22-width × 2-format render sweep of entry 6 (`0x15F8D`-`0x1AE70`) alone, now that its true byte range is directory-confirmed | Pure noise at every width/format — correct, entry 6 is script data, not pixels (see "bcdfa — BCSPEED.EFF"). This is what triggered the entropy/byte-pattern analysis instead |
| Byte-pattern census for `MOVEA.L`/`ADDA.L $E8(A5),An` (entry 6's slot) across the whole decompressed S_1 image, and `232(A5)` across every raw overlay `.asm` | Zero hits — but this was a **false negative**, not evidence of absence. The census only covered address-register loads; the real consumer uses `MOVE.L $E8(A5),D1` (`0x222D`) at S_1 `+0x25560`. **Lesson: enumerate the data-register and `LEA`/`TST`/`CMPA` forms too before concluding a slot has no compile-time-constant consumer.** Widening the scan to `MOVE.L (d16,A5),Dn` found entry 6's consumer and its two BCSPEED siblings (slots `0x2C` and `0xEC`) within 40 bytes of each other |
| RLE walk of entry 6 from several start offsets | Desyncs into tiny fragments — correct behaviour, the entry is `comp=0` and was never RLE |
| Entropy / autocorrelation profiling of entry 6 | 5.16 bits/byte, no smooth autocorrelation decay, lag-7 spike — correctly ruled out both PCM audio and compressed data, and the lag-7 spike was the (slightly off-by-one) shadow of the real 6-byte record stride plus its `0xFF` group terminators |
| Searching `clipper.clp`'s catalog for entry 6's byte signature | **Solved it.** The DOS port stores the same bank verbatim under the name `"Speed Effects"`. Doing this *first* — a whole-corpus `find()` of a distinctive 30-byte run, then a catalog-entry lookup — would have identified the bank before any entropy or render work |
| Byte-pattern census for `MOVEA.L $B4(A5),An` (entry 5's slot) | **14 hits across 10+ subroutines** — real consumer code exists, bank is heterogeneous, not one image (see above). Re-run over *every* `(d16,A5)` EA form it is **15** hits; the extra one is `MOVE.L $B4(A5),D3` at `+0x24430` |
| Census for slot `0x34` (entry 12) over every `(d16,A5)` EA form, source **and** destination, in the whole decompressed S_1 image | **Zero hits — and the bank was fully solved anyway.** Banks reached through the generic blitter are addressed by a *slot number stored in the 28-byte descriptor's `+0x00` field* and loaded with an indexed `MOVEA.L (A5,D0.W),An`, never by literal displacement; the confirmed floor-item bank (slot `0x30`) is invisible to the same census for the same reason. **A zero-hit A5-displacement census is not evidence that a bank has no consumer.** |
| Blind whole-image scan for **28-byte generic blit descriptors** (three self-consistency invariants), filtered by slot | **The technique that cracked entries 12, 0 and 1 in one pass**: 162 descriptors, 12 for slot `0x34` (tiles entry 12 100%), 32 for slot `0x00` (98.3%) and 48 for slot `0x04` (98.9%). Should be the *first* move on any unidentified bcdfa/bcdfx bank, ahead of any render sweep or padding-column scan |
| Searching `clipper.clp` for the **type-1 marker entries** (`"Start Throwing Items"`, `"Start Keys"`, …) rather than for named images | Named two banks outright (entry 12; entry 5's `0x7CA0` tail). The 34 type-1 entries are section markers and are the cheapest naming oracle in the DOS archive |
| Byte-pattern census for `MOVEA.L $E0(A5),An` (entry 4's slot) | 2 hits, both the confirmed mono font's own address-helper and glyph-copy loop — led directly to the font identification above, **but the 2-hit result was a false negative for the rest of the chunk**: widening to every `(d16,A5)` form finds **6**, and the four `ADDA.L $E0(A5),A3/A4` sites are the consumers of the three further fonts. Same trap as entry 6, second occurrence |

**Extracted.** `bclib.bcdfa.throwing_item_sprites`, driven by
`scripts/extract_bcdfa_throwing.py`, → `sprites/throwing-items.{png,json}`
(12 frames). Re-verified as part of promoting the extractor: the mirror
invariant holds on all 39/39 rows across the 6 shapes, and both named DOS
entries (`Arrow` 16×11, `Dagger` 16×7) match their Amiga near-depth,
facing-0 record **100.000%** (63/63 and 56/56 opaque px).

---

### bcdfa — Item Icon Bank — **SOLVED**

The graphics the game draws for every carryable object in the inventory grid
and in the equipment panel's slot squares.

> **Correction:** this used to say "on a dungeon floor square, in the inventory
> grid, and in the equipment panel". Floor squares are **not** drawn with these
> icons — they use the separate 147-sprite masked bank at `bcdfa+0x270C4`; see
> "Dungeon-floor item sprites".

| Property     | Value |
|--------------|-------|
| Container    | `bcdfa`, two RLE streams (bcdfu `LAB_0043`) |
| Bank 0       | stream at `bcdfa+0x1B5B3` → **75,600 B** = **175** icons |
| Bank 1       | stream at `bcdfa+0x2FE5C` → **2,160 B** = **5** icons |
| Total        | **180** icons |
| Geometry     | **24 × 24 px, 6 sequential bitplanes, LSB plane first** |
| Record       | **432 B** = `(24/8) × 24 × 6`; 72 B per plane, 3 B per row |
| Mask         | **none** — see below |
| Palette      | bcdfq `game` + EHB (indices 0–25 / 32–57 only) |
| Extractor    | `scripts/bclib/bcdfa.py` (`item_icons`), driven by `scripts/extract_items.py` |
| Assets       | `public/assets/blackcrypt/amiga/sprites/items.{png,json}` — 180 frames |

#### Stream boundaries (confirmed)

The bank-0 stream's first control byte is at **`bcdfa+0x1B5B3`**, the byte
immediately after the last `BCSPEED\0PRG\0` record's `3C 00 00` terminator.
Starting one byte later (`0x1B5B4`, the "obvious" boundary if you count the
PRG block as ending on a round number) decodes 74,850 bytes — a desynced
stream that still *looks* plausible and still contains recognisable icon
data, but is not a multiple of the record size. Same trap as
`MONSTER_STREAM_START` and the GFK preamble:

| Start | Decoded | `% 432` |
|-------|---------|---------|
| `0x1B5B2` | 0 | — |
| **`0x1B5B3`** | **75,600** | **0** |
| `0x1B5B4` | 74,850 | 258 |
| `0x1B5B5` | 75,578 | 26 |

`0x1B5B3` is the only start in its neighbourhood whose output is an exact
multiple of 432, and it is exact with **zero** remainder for 175 records.
The same holds for `0x2FE5C` → 2,160 = 5 × 432 exactly (its neighbours
`0x2FE58`–`0x2FE61` give 1,775 / 446 / 2,287 / 0 / **2,160** / 321 / 2,156 /
475 / 1,547 / 350 — only one lands clean).

#### There is no mask plane

This is the **only** Black Crypt sprite format without one. Every other
masked format in this document is `plane0 = 1bpp cookie-cut mask,
planes 1–6 = 6bpp EHB colour`; item icons are a flat 6-plane opaque
rectangle. What reads as transparency is **colour index 53** (EHB
half-bright of register 21), which renders as RGB `0x222222` — byte-identical
to register 20, the colour of the inventory slot interior the icon is blitted
into. The blit is a straight rectangular copy; the "transparency" is the
artists painting the slot colour into the icon's backdrop.

Two independent confirmations that 53 really is the intended backdrop and not
a coincidence:

- All 180 icons contain index-53 pixels, and it is the modal index in 156 of
  them (the other 24 are large objects that fill most of the tile).
- In the DOS VGA port the corresponding backdrop colour is RGB `(35,35,35)`
  — the same colour — and cutting `index != 53` on Amiga against
  `RGB != (35,35,35)` on DOS gives a **100.000%** silhouette match (below).

The extractor therefore keys transparency on `index != 53`
(`bclib.ITEM_BACKDROP_INDEX`), not on a mask plane.

#### Verification (ground truth)

| Check | Result |
|-------|--------|
| Record sizing, bank 0 | decoded 75,600 B = 175 × 432 exactly, **0** remainder |
| Record sizing, bank 1 | decoded 2,160 B = 5 × 432 exactly, **0** remainder |
| Bank extent in RAM | rendering RAM past record 174 at the same 432-B stride yields noise from record 175 on — the bank ends exactly where the stream does |
| **Live chip-RAM oracle** | the whole decompressed bank 0 is **byte-for-byte** resident in Amiga chip RAM at **`$7D918`** — **75,600 / 75,600 bytes**, in *three* independent in-game emulator savestates (`data/blackcrypt/default-{2,3,4}.uss`), and absent from the two pre-game savestates (`default.uss`, `default-1.uss`), which is what you would expect of a bank loaded on entering the dungeon |
| **Cross-platform oracle** | DOS VGA `clipper.clp` holds the same **180** 24×24 item icons **in the same order**: entries `447`–`621` = Amiga bank 0 icons 0–174, entries `624`–`628` = bank 1 icons 0–4 |
| DOS silhouette match | **103,680 / 103,680 pixels agree (100.000%)** across **180 / 180** frames, comparing Amiga `index != 53` against DOS `RGB != (35,35,35)` |
| **Live screen oracle** | 13 icon placements located in three real emulator screenshots (`data/default-{2,3,4}.png`) and compared pixel by pixel: **3,683 / 3,683 opaque pixels exact (100.000%)** |
| Extractor regression | `bclib.item_icons` output is byte-identical to the verified probe for all 180 records |

The screen oracle placements, for reference — `(x, y)` is the icon's top-left
in the 320×200 screen (screenshots are the 320-px content of a 376-px capture,
origin `(38, 20)`):

| Screenshot | Icon | Position | Opaque px |
|------------|------|----------|-----------|
| default-3 | 0 (empty helm slot) | (254, 5) | 205 |
| default-3 | 1 (empty cloak slot) | (220, 35) | 133 |
| default-3 | 3 (empty leggings slot) | (254, 65) | 412 |
| default-3 | 4 (empty boots slot) | (254, 92) | 285 |
| default-3 | 24 (cheese) | (110, 148) | 402 |
| default-3 | 33 (cooked meat) | (13, 147) | 256 |
| default-3 | 177/178/179 (bank 1) | (43,147) (73,147) (73,174) | 568/492/466 |
| default-2, default-4 | 10 (mace) | (223, 146) | 102 |
| default-2, default-4 | 173 (idol/mask) | (97, 173) | 130 |

The 24×24 inventory slot in `default-3` is at screen `x = 110..133,
y = 148..171` (black slot border at `x = 109/134`, `y = 147/172`) — the icon
fills the slot interior exactly, which independently pins the 24×24 geometry
before any decode was attempted.

#### Palette notes

The 180 icons only ever use colour registers **0–25** and their EHB
half-brights **32–57**. They never touch **26–31**, which is the swappable
dungeon accent ramp — so the item icons are immune to the per-level accent-ramp
swap that applies to `bcdfx/y/z` (now resolved — see "Dungeon tileset
selection" in the Palette section).

Two registers *are* reprogrammed at runtime and differ from what the bcdfq
`game` table ships with. All three in-game savestates agree on the live
values, and they are what the real screenshots show:

| Register | bcdfq `game` | live in-game | Icon pixels affected |
|----------|--------------|--------------|----------------------|
| 1 | `0xC86` = (204,136,102) | `0x158` = (17,85,136) | 281 |
| 9 | `0x0DD` = (0,221,221) | `0x940` = (153,68,0) | 86 |

That is 367 of 103,680 icon pixels (0.354%). `scripts/extract_items.py`
applies both overrides (`UI_PALETTE_OVERRIDES`) and writes the resulting
table to `palettes/ui.json`.

##### Where registers 1 and 9 come from — **SOLVED: the copper, not a palette**

> **Correction — supersedes "open … not a literal 32-word palette anywhere in
> the game files".** That search was correct and its conclusion was the right
> one to draw: these two values are **not** part of any 32-word palette,
> because they are never loaded from one. They are written **by the copper**,
> from two 8-word ramps, and the suspected location (`bcdfp+0x257C` /
> `bcdft+0x1E6A4`) was exactly right.

`bcdfp+0x2534` is a copper-list builder that emits eight
`WAIT / COLOR01 / COLOR09` triplets on eight consecutive raster lines:

```asm
2534  LEA     $257C(pc),A1       ; 8-word ramp for COLOR01
2538  LEA     $260C(pc),A3       ; 8-word ramp for COLOR09
253C  MOVE.L  #$F2,D1            ; first WAIT vpos
2542  MOVEQ   #7,D0              ; 8 scanlines
2544  MOVE.B  D1,(A2)+           ; copper WAIT: vpos
2546  ADDQ.L  #1,D1              ;   next line
2548  MOVE.B  #$0F,(A2)+         ;   hpos
254C  MOVE.W  #$FFFE,(A2)+       ;   mask
2550  MOVE.W  #$0182,(A2)+       ; COLOR01 = $DFF182
2554  MOVE.W  (A1)+,(A2)+        ;   <- ramp word
2556  MOVE.W  #$0192,(A2)+       ; COLOR09 = $DFF192
255A  MOVE.W  (A3)+,(A2)+        ;   <- ramp word
255C  DBRA    D0,$2544
```

`$0182` and `$0192` are the **only** two `COLOR` register numbers that appear
anywhere in `bcdfp` besides `COLOR00` — a whole-file word search finds
`0x0182` exactly once (`bcdfp+0x2552`) and `0x0192` exactly once
(`bcdfp+0x2558`), which is why registers 1 and 9 are precisely the two that
diverge from the shipped `game` palette and no others do.

The two ramps:

| Register | Ramp base | 8 words |
|----------|-----------|---------|
| 1 (`COLOR01`) | `bcdfp+0x257C` = `bcdft` S_1 `+0x1E6A8` | `0158 026B 038D 059F 038D 026B 0158 0158` |
| 9 (`COLOR09`) | `bcdfp+0x260C` = `bcdft` S_1 `+0x1E738` | `0940 0B62 0D83 0FA4 0D83 0B62 0940 0940` |

**The live values are the first word of each ramp** — `0x0158` and `0x0940`
— which is also its 7th and 8th word, so three of the eight phases hold that
value and it is by far the most likely one to be captured in a savestate or a
screenshot. That accounts for both observed values exactly, with no residual.

These two ramps are the 1st and the 10th of **fourteen** consecutive 8-word
palindromic ramps at `bcdfp+0x257C … +0x265C` (mirrored in `bcdft` S_1 at
`+0x1E6A8 … +0x1E788`). `+0x260C − +0x257C = 0x90` = 9 ramps, so the table
partitions as **9 ramps for `COLOR01` followed by 5 for `COLOR09`** — the
`COLOR01` set fades from `0158 026B 038D 059F` down to a flat `0034 0034 …`,
which reads as a torch/light-radius dim sequence, while the `COLOR09` set
holds five different hues (`0940` orange, `0911`, `0074` blue, `0555` grey,
`0636` purple). Ramp *selection* is **hypothesis**; the two base addresses,
the two register numbers and the two live values are **confirmed**.

> **EHB rendering convention — a real divergence, flagged not fixed.**
> `bclib.amiga12_to_rgb(half_bright=True)` computes `(nibble >> 1) * 17`,
> which is what OCS hardware does (the EHB shift happens in the 4-bit
> domain). Amiberry renders EHB as `byte >> 1` on the already-scaled 8-bit
> value, so its output contains components that are *not* multiples of 17
> (e.g. register 28 `0x653` → Amiberry `(51,42,25)`, hardware `(51,34,17)`).
> Against the emulator screenshots the item icons score **3,683/3,683
> (100.000%)** under Amiberry's convention and 2,320/3,683 (62.99%) under the
> hardware one — **the decode is identical either way; only the EHB→RGB step
> differs.** The committed extractor keeps the project-wide hardware-correct
> formula for consistency with every other asset group; the screenshots are
> not evidence against it. Deciding which convention the browser runtime
> should use is a separate, project-wide question and was deliberately not
> changed here.

#### Still open

#### `gfxNumber` → icon index — **strongly supported hypothesis**

`gfxNumber` appears to be a **direct 0-based index into bank 0**. Evidence
from the starting-equipment table in `bcdfp`'s DATA hunk (file offset
`0x585C`, 20-byte records — the field at record bytes `+2..+3`, which
`tools/shared/game-config.ts` currently calls `uniq`):

- The table holds exactly **20 valid records** (record 20 onward fails the
  `prefix == 0 && marker == 0x80` test) = **4 characters × 5 starting items**.
- All 20 values are `1 … 144` — every one inside the bank's `0 … 174` range,
  with **no** value out of range.
- Read as bank-0 indices they are semantically coherent per character:

| Char | item 0 (`subGfx` 02) | item 1 (01) | item 2 (03/04) | item 3 | item 4 |
|------|----------------------|-------------|----------------|--------|--------|
| 1 | 46 shirt | 51 gold pants | 28 backpack | 20 **black spellbook, triangle sigil** | 7 ring |
| 2 | 43 belt | 48 red pants | 27 apple | 18 **red spellbook, ankh sigil** | 2 (dark silhouette) |
| 3 | 42 shield | 47 shirt | 28 backpack | 19 **green spellbook, figure sigil** | 1 (dark silhouette) |
| 4 | 44 red shirt | 49 white pants | 27 apple | 21 red gem | 144 wooden shield |

  Three different class spellbooks land in the *same* slot position across
  three characters, each with the sigil for a different class, and the fourth
  character (no spellbook) gets a gem and a shield instead. Garments, food and
  containers line up by column too.

> **Correction — the blit call site *does* exist, and `gfxNumber` is not a
> direct index.** The claim "no `MULU #$1B0` (432) or equivalent appears in any
> disassembled overlay" was wrong: the search had not covered the *decompressed*
> `bcdft` S_1 image (`build/cache/blackcrypt/bcdft_decompressed.bin`), which
> contains **five** `MULU.W #$1B0` sites — `+0x1FAE8`, `+0x1FBBC`, `+0x20640`,
> `+0x20756`, `+0x24374`. Four of them are preceded by a byte-table lookup:
>
> ```asm
>    LEA     $26EF2(PC),A1       ; gfxNumber → icon-index table (256 bytes)
>    MOVEQ   #0,D1
>    MOVE.B  (A1,D0.W),D1
>    MOVE.W  D1,D0
>    MOVEA.L $D4(A5),A1          ; base of item icon bank 0
>    MULU.W  #$1B0,D0            ; × 432
>    LEA     (A1,D0.L),A0
> ```
>
> So the icon address arithmetic is now **confirmed** (432-byte records, bank
> base at `$D4(A5)`; a second bank at `$D8(A5)` uses the same record size, which
> is bank 1), but the index is **`table[gfxNumber]`, not `gfxNumber`**. The
> table at S_1 `+0x26EF2` is **236 bytes** (`0x26EF2 … 0x26FDD`, i.e. `gfxNumber`
> runs `0 … 235`), 147 of them non-zero, with a maximum value of **174** —
> exactly bank 0's last index, with no value out of range. It is the first of
> **three parallel 236-entry per-`gfxNumber` tables**: `+0x26EF2` → icon index,
> `+0x26FDE` → some other per-item attribute (values `0 … 255`, unidentified,
> read at `+0x21908` / `+0x219BE` / `+0x21CB0`), `+0x270CA` → chest-armour index.
>
> The two numbering spaces are cross-checked by the *armour* table 472 bytes
> later at `+0x270CA` (see the chest-armour section): every `gfxNumber` that
> maps to a non-zero chest-armour graphic also maps, through `+0x26EF2`, to an
> armour-type 24×24 icon — `gfxNumber` 149/151/153/154/155/156/157/158 all give
> icon **125** (the generic breastplate icon) while giving eight *different*
> armour graphics 7/9/15/18/16/17/10/11, and 42/43/44 all give icon **44** (the
> red shirt) with cloth-armour graphics 2/3/4. Two independently authored
> tables agreeing on item category for 17 of 17 entries.
>
> The `bcdfp` starting-equipment values above are, however, **not** in the
> `gfxNumber` space: pushing them through `+0x26EF2` turns the three class
> spellbooks (18/19/20) into a pouch, a cheese and an apple (133/24/26), while
> reading them directly still yields the coherent per-class table. Treat that
> field as a **direct icon index** and the `bcdfs` item record's `gfxNumber` as
> a *different* key that must go through the table — **hypothesis**, since the
> reader of the `bcdfp` table has not been traced.

> **Correction — that hypothesis is refuted; the field IS a `gfxNumber`.**
> The tell is the *chest-armour* table at S_1 `+0x270CA`, and it is decisive.
> Only **17 of 236** `gfxNumber` values (7.2%) have a non-zero chest-armour
> graphic: 34, 38, 42, 43, 44, 46, 149, 151, 153–158, 166, 167, 194. The four
> characters' **slot-0** starting items are 46, 43, 42, 44 — **all four inside
> that 7.2% subset** (`p ≈ 2.7 × 10⁻⁵` by chance), and they yield four
> *distinct* armour graphics (5, 3, 2, 4 — the four cloth paperdolls) while
> all four map through `+0x26EF2` to the *same* icon **44**. That is exactly
> the "generic garment icon, per-item paperdoll" structure this document
> already confirmed for the plate armours, and it is unreproducible under the
> direct-index reading, which instead makes slot 0 a shirt, a belt, a shield
> and a red shirt — i.e. no starting body armour at all, and nothing for the
> equipment panel's paperdoll to draw.
>
> Corrected reading of the 20-byte record at `bcdfp` file offset `0x585C`:
>
> | Bytes | Field | Notes |
> |-------|-------|-------|
> | `+0x00` | prefix | `0x0000` on all 20 valid records |
> | `+0x02` | **`gfxNumber`** | 0–235; must go through `+0x26EF2` to get the icon index. Currently named `uniq` in `tools/shared/game-config.ts` — **rename it** |
> | `+0x04` | marker + `subGfx` | high byte `0x80`; low byte is a slot/category id — `2` for all four slot-0 records, `1` for all four slot-1 records |
>
> Per-character starting kit under the corrected reading (icon = `+0x26EF2`,
> armour = `+0x270CA`):
>
> | Char | slot 0 (body) | slot 1 (legs) | slot 2 | slot 3 | slot 4 |
> |------|---------------|---------------|--------|--------|--------|
> | 1 | gfx 46 → icon 44, **armour 5** | gfx 51 → icon 51 | gfx 28 → icon 32 | gfx 20 → icon 26 | gfx 7 → icon 16 |
> | 2 | gfx 43 → icon 44, **armour 3** | gfx 48 → icon 49 | gfx 27 → icon 30 | gfx 18 → icon 133 | gfx 2 → icon 10 |
> | 3 | gfx 42 → icon 44, **armour 2** | gfx 47 → icon 48 | gfx 28 → icon 32 | gfx 19 → icon 24 | gfx 1 → icon 9 |
> | 4 | gfx 44 → icon 44, **armour 4** | gfx 49 → icon 50 | gfx 27 → icon 30 | gfx 21 → icon 28 | gfx 144 → icon 173 |
>
> All 20 values have a non-zero `+0x26EF2` entry and every resulting icon
> index is inside bank 0's 0–174 range.
>
> **Why the old hypothesis looked good:** the direct reading made three of the
> four characters' slot-3 items come out as icons 18/19/20, which render as
> three different class spellbooks — a very persuasive, very wrong pattern.
> Note that the *same* slot is four different items under either reading (the
> `subGfx` bytes are 6/11/8/5, all distinct); the spellbook triple is a
> coincidence of the icon bank happening to store three spellbooks
> consecutively. The armour-table test is the one that discriminates, because
> it tests membership in a small, independently-authored subset rather than
> the plausibility of a rendering.

> **Correction:** the "Item Table" section later in this document lists
> "War Hammer (`0x0007`), Apple (`0x0014`), Brown Pants (`0x002E`)" for this
> same table. Those names came from a guess, not from the graphics, and
> should not be reused. Under the confirmed mapping the values are
> `gfxNumber` 7 → icon 16, `gfxNumber` 0x14 = 20 → icon 26 and
> `gfxNumber` 0x2E = 46 → icon 44 (the generic cloth-garment icon).

#### Icon → item-name linkage — **SOLVED**

> **Correction —** the section below previously read "still open, but one
> whole approach is now closed". The approach that was closed (positional
> indexing of the string block by `gfxNumber`) was correctly refuted, but the
> *premise* that produced it was also wrong in two ways, and both matter:
>
> 1. **The block does not start at `+0x1C430`.** `+0x1C430` is where the
>    *starting-equipment* names start (`DEATH GEM`, `PANTS`, `SHIRT`, …);
>    those 17 strings are reached through a pointer table, not by offset. The
>    **map-item** name block begins **`0xB2` bytes later, at `+0x1C4E2`**
>    (`WAR HAMMER`).
> 2. **There *is* a pointer table**, just not in S_1. The earlier search only
>    covered the S_1 image; the table lives in the **S_2 small-data segment**
>    at `+0x07BA` (19 relocated longwords), which is why it came back empty.
>
> The linkage itself is not positional at all: the name is a **byte offset**
> carried by each `bcdfs` record.

The `bcdfs` item/structure record's word `+0x02` is a **tagged name
reference**, resolved identically by both of its consumers — S_1 `+0x42A0`
(examine the held item) and S_1 `+0xEFDE` (compose a message string):

```asm
; both sites, verbatim
        move.w  $1a22(a4),d0        ; unique of the selected object
        mulu    #20,d0              ; 20-byte record stride
        lea     -$6e7a(a4),a0       ; object-record array
        move.w  $2(a0,d0.l),d1      ; the name word
        btst    #$f,d1
        beq     .byte_offset
        andi.w  #$7fff,d0           ; --- bit 15 SET ---
        asl.l   #2,d1
        lea     -$7844(a4),a0       ; char *nameTable[]  (S_2 +0x07BA)
        movea.l (a0,d1.l),a0
        bra     .print
.byte_offset:                       ; --- bit 15 CLEAR ---
        moveq   #0,d1
        move.w  $2(a0,d0.l),d1
        add.l   -$7174(a4),d1       ; + item-name block base (S_2 +0x0E8A)
        movea.l d1,a0
.print: jsr     $9f3ac.l
```

| Field | Value | Confidence |
|---|---|---|
| Name reference | `bcdfs` record word `+0x02` | **confirmed** |
| Bit 15 clear ⇒ **byte offset** into the map-item name block | block base = decompressed `bcdft` S_1 **`+0x1C4E2`** (absolute `0x0009C53A`, held in the pointer variable `A4 − 0x7174` = S_2 `+0x0E8A`) | **confirmed** |
| Bit 15 set ⇒ **index** into a 19-entry `char *` table | `A4 − 0x7844` = S_2 `+0x07BA`; entry 0 = `DEATH GEM`, entries 0-16 are exactly the 17 starting-equipment names at S_1 `+0x1C430 … +0x1C4E1` | **confirmed** (code path; no `bcdfs` record uses it — see below) |
| `0` | no name (structures that are never named) | **confirmed** |

**Verification (ground truth).** Walking all 13 maps with the game's own
loader (`scripts/bclib/bcdfs.py`, 13/13 maps, zero deviation — see "Runtime
parser" in the `bcdfs` section) yields 2,536 records, of which **685 carry a
non-zero name word. All 685 resolve to an exact string start** (the byte
before the target is `NUL`) under the byte-offset rule — **0 failures**. A
brute-force sweep of every candidate base in `S_1[0x18000, 0x1E000)` scores
**685/685 on `+0x1C4E2` and at most 217/685 (31.7 %) anywhere else**, so the
base is unique, not merely consistent. None of the 685 sets bit 15, so the pointer
table is the *runtime*-created-item path (starting equipment, `Items drop`,
`YOU ARE GRANTED AN ITEM`), not a `bcdfs` path.

Semantic cross-check against the record's own `itemType` byte `+0x05`, which
the name field knows nothing about — every type lands on a matching name:
Key (`0x06`) → `RECTANGLE KEY`/`DRAGON KEY`/`PIN KEY`/`OCTA KEY`…, Potion
(`0x05`) → `POTION OF WATER BREATHING`/`WATER SKIN`, Spellbook (`0x0C`) →
`BOOK OF FIRE`/`FORCE OF THE ELEMENTS`, Tablet (`0x30`) → `TABLET OF
RUNETEK`/`TABLET OF OAKRAVEN`, Food (`0x0E`) → `MEAT`, Amulet (`0x1A`) →
`AMULET OF PIETY`, and so on.

**Joined to the icons.** Composing this with the confirmed
`gfxNumber` → icon LUT at S_1 `+0x26EF2` gives the icon → name mapping the
open question asked for. 169 distinct `gfxNumber`s carry names; the grouping
is self-validating, because names that share an icon are the same object
family without the mapping ever being told so:

| icon | names sharing it |
|---|---|
| 9 | `THROWING DAGGER`, `+1`, `+2`, `+5` |
| 15 | `ARROW`, `ARROW +1` |
| 22 | `SCROLL`, `OLD SCROLL`, `BLOODY SCROLL`, `TATTERED SCROLL`, `TORN SCROLL`, `OLD MANUSCRIPT` |
| 24 / 26 / 28 | `CHEESE` / `APPLE` / `MEAT` |
| 45 / 46 / 47 | `TABLET OF DVERGAR` / `TABLET OF RUNETEK` / `TABLET OF OAKRAVEN` |
| 104 | `PLATE LEGGINGS`, `PLATE LEGGINGS +1` |

Independent corroboration for the **key** bank: the 58 Key-type (`0x06`)
records across all 13 maps resolve to exactly **29 distinct key names**
(27 distinct `gfxNumber`s, 200-227) — matching the **29 key icons** already
identified in `bcdfa` container entry 5, two unrelated derivations landing on
the same count. All 58 map to icon **0** in the `+0x26EF2` LUT, i.e. keys are
deliberately excluded from the 180-icon bank and drawn from that separate
bank instead — which is also why the "reserved" icon-0 slot exists.

Extractor: `scripts/extract_bcdfs_items.py` →
`public/assets/blackcrypt/amiga/data/item-names.json` (per-`gfxNumber`
catalog + all 685 placements with map/row/col).

#### Still open

| Question | Status |
|----------|--------|
| `gfxNumber` → icon index | **Confirmed** as `table[gfxNumber]` via the LUT at decompressed `bcdft` S_1 `+0x26EF2` |
| Which `bcdfp` starting-equipment field feeds it | **SOLVED** — the word at record bytes `+0x02` (currently `uniq` in `tools/shared/game-config.ts`) is the `gfxNumber` itself; see the correction above |
| Icon → item-name linkage | **SOLVED** — the `bcdfs` record word `+0x02` is a byte offset into the map-item name block at S_1 `+0x1C4E2` (bit 15 ⇒ index into the S_2 `+0x07BA` pointer table instead); 685/685 references resolve exactly. See the section above |
| Which overlay loads bcdfa | **SOLVED** — `bcdft` S_1 `+0x1DBD2` (`OpenBcdfaFile`); see "bcdfa — Container Directory" |
| Where the live values of colour registers 1 and 9 come from | **SOLVED** — copper ramps at `bcdfp+0x257C` / `+0x260C`; see "Palette notes" above |

---

### bcdfa — Chest Armour Paperdoll Bank — **SOLVED**

The 19 large chest-armour images the equipment panel shows for the armour a
character is wearing. This is the Amiga counterpart of the DOS port's 19
`32 × 29` `clipper.clp` entries, image for image.

| Property | Value | Confidence |
|----------|-------|------------|
| Container | `bcdfa`, one RLE stream (bcdfu `LAB_0043`) at **`0x2D05E`** → **13,224 B** | **confirmed** |
| Records | **19** × **696 B**, zero remainder (`13,224 = 19 × 696`) | **confirmed** |
| Geometry | **32 × 29 px, 6 sequential bitplanes, LSB plane first** | **confirmed** |
| Row / plane stride | 4 B per row, **116 B per plane** (`0x74`) | **confirmed** — the engine's own plane advance |
| Mask | **none** — transparency is colour index **53**, the same backdrop trick as the 24×24 item icons | **confirmed** |
| Selector | 236-byte lookup table `gfxNumber → armour index`, decompressed `bcdft` S_1 **`+0x270CA`**, distinct values `{0, 2 … 18}` | **confirmed** |
| Extractor | `scripts/bclib/bcdfa.py` (`armour_icons`), driven by `scripts/extract_paperdoll.py` |
| Assets | `public/assets/blackcrypt/amiga/sprites/armour.{png,json}` — 19 frames |

#### Found by reading the engine, not by scanning

The record size and the count both come straight out of the decompressed
`bcdft` S_1 overlay (`build/cache/blackcrypt/bcdft_decompressed.bin`, offsets
below are file offsets into that image, which equal the overlay's own
PC-relative address space):

```asm
0208 0A  ; entry: D0 = gfxNumber
   TST.W   D0
   BEQ.B   $20824              ; 0 → armour graphic 0 (the empty-slot silhouette)
   BMI.B   $2082E              ; negative → armour graphic 1
   LEA     $270CA(PC),A1       ; gfxNumber → armour-index table
   MOVEQ   #0,D1
   MOVE.B  (A1,D0.W),D1
   MOVE.W  D1,D0
   BSR.W   $2083A
0208 3A  ; D0 = armour index
   MOVEA.L $DC(A5),A1          ; base of the armour bank
   MULU.W  #$2B8,D0            ; × 696
   LEA     (A1,D0.W),A0
   MOVEA.L $AC(A5),A1          ; 696-byte staging buffer
   MOVEQ   #$56,D0             ; 87 × 8 bytes = 696
   MOVE.L  (A0)+,(A1)+ / MOVE.L (A0)+,(A1)+ / DBRA
```

and the blit that consumes the staging buffer (`+0x20914`) sets
`BLTSIZE = $743` = **29 rows** × 3 words, `BLTBMOD = $FFFE` (−2, so the
source advances 6 − 2 = **4 bytes per row**) and advances the source by
`$74` = **116 bytes per plane** — 32 px wide, 29 rows, 6 planes, 696 bytes.
Multiplying that record size by the table's 19 distinct values gives 13,224,
which is exactly one of `bcdfa`'s RLE streams.

#### Verification (ground truth)

| Check | Result |
|-------|--------|
| Record sizing | stream at `0x2D05E` decodes to 13,224 B = 19 × 696 with **0** remainder |
| Selector range | the `+0x270CA` table's 236 entries hold exactly `{0, 2 … 18}`; with the two hard-coded cases (`0` for an empty slot, `1` for the `BMI` branch) that is **19** graphics, matching the record count with no gaps |
| **Cross-platform oracle** | the DOS port's 19 `32 × 29` `clipper.clp` entries are the **same 19 images in the same order**. Amiga `index != 53` vs DOS `RGB != (35,35,35)` agrees on **17,567 / 17,632 pixels (99.631%)**; **15 / 19 frames are 928 / 928 exact**, and frames 3 / 4 / 5 / 6 differ by 21 / 21 / 21 / 2 px of per-port retouching |
| Colour-region histograms | **15 / 19** frames have byte-identical *sorted colour-region pixel counts* between the two ports (frame 0 `556/314/58`, frame 1 `734/72/58/46/18`, frame 2 `216/216/127/92/88/58`, …). The other four (3, 4, 5, 6) differ only by one extra Amiga region of 21/21/21/2 px that DOS merged into an adjacent one — the same four frames as the silhouette misses. The two ports drew the same art, not merely the same silhouette |
| **Live screen oracle** | armour record **0** (the empty-chest-slot silhouette) is present in `data/default-3.png` at screen `(250, 33)`, **928 / 928 pixels RGB-exact (100.000%)** |
| Extractor regression | `bclib.armour_icons` reproduces the verified probe's silhouettes with **0 / 17,632** mismatches |

> **Correction — the "12 missing armours" were never missing.** An earlier
> pass looked for all 19 chest armours inside the `0x036FD` stream (below),
> found only three plausible ones, and recorded the enumeration as unresolved.
> The three it found are a different asset class; the real 19-image bank is a
> **separate RLE stream** at `0x2D05E`, in a different geometry (32 × 29,
> 696 B) — it was missed because a greedy stream walk from file offset 0
> desyncs before reaching it (the same trap that hides the item bank's true
> start at `0x1B5B3`), and because a blind structural scan for the `0x036FD`
> records' signature cannot match a bank with a different width.

---

### bcdfa — Large Equipment-Panel Art (`0x036FD`) — **SOLVED (48 records)**

The equipment panel does not draw everything at 24×24. Seven records inside
the `0x036FD` stream are **48 px wide** (only the left 36 px are drawn): four
`36 × 29` shield/crest emblems with class-coloured gems, and three `36 × 25`
body-armour images — including the silver breastplate with red pauldrons that
`default-3` shows at screen `(284, 4)`.

| Property | Value | Confidence |
|----------|-------|------------|
| Container | `bcdfa` RLE stream at **`0x036FD`** → **18,184 B** | **confirmed** — the whole stream is byte-identical to chip RAM at `$99948` |
| Storage width | **6 bytes = 48 px**; columns 36–47 are off-screen padding filled with index **33** | **confirmed** |
| Drawn width | **36 px** (record columns 0–35) | **confirmed** — 284 + 36 = 320, the exact right edge of the screen |
| Planes | 6, sequential, LSB first; **no mask**. Backdrop inside the drawn area is index **54**, the panel's own colour | **confirmed** |
| Records | **7**, heights **not** uniform | **confirmed** |
| Extractor | `scripts/bclib/bcdfa.py` (`paperdoll_records`), driven by `scripts/extract_paperdoll.py` |
| Assets | `public/assets/blackcrypt/amiga/sprites/paperdoll.{png,json}` — 7 frames |

#### Record table (stream offsets, confirmed)

| # | Offset | Height | Bytes | Chip RAM (`default-2/3/4`) | Content |
|---|--------|--------|-------|---------------------------|---------|
| — | 0 | 29 | 174 | `$99948` | **not a record** — one lone bitplane of a solid 36 × 29 rectangle (`FF FF FF FF F0 00` × 29). Unpaired; probably a stencil/erase plate |
| 0 | 174 | 29 | 1,044 | `$999F6` | silver tabard, upright sword, two **red** gems |
| 1 | 1,218 | 29 | 1,044 | `$99E0A` | grey shield, cross-and-circle emblem, two **orange** gems |
| 2 | 2,262 | 29 | 1,044 | `$9A21E` | shield, triangle/"A" sigil, two **magenta** gems |
| 3 | 3,306 | 29 | 1,044 | `$9A632` | tabard, rune sigil, two **green** gems |
| 4 | 4,350 | 25 | 900 | `$9AA46` | silver breastplate, red pauldrons, gold trim |
| 5 | 5,250 | 25 | 900 | `$9ADCA` | plain red tunic |
| 6 | 6,150 | 25 | 900 | `$9B14E` | red tunic with gold collar trim |

Records end at stream offset **7,050**. Everything after that is *not* this
format — see "Rest of the stream" below.

#### How the records were enumerated

A record is identified by a structural invariant that needs no directory:
because columns 36–47 are uniform off-screen padding, **byte 5 of every row is
constant within each plane**, and across the six planes it reads
`FF 00 00 00 00 FF` (padding colour index 33 = bits 0 and 5). Scanning for
that pattern over `H = 18 … 39`:

| Corpus scanned | Hits |
|----------------|------|
| the `0x036FD` stream itself | **exactly the 7 above**, no others, no near-misses |
| every RLE stream ≥ 900 B in every `bcdf?` file plus `BlackCrypt` | none outside `bcdfa` (two `H = 32` hits inside `bcdfx`/`bcdfz`'s alcove payload are unrelated) |
| all 2 MB of chip RAM from **three** in-game savestates | the same 7, at the RAM addresses tabulated above, plus one `H = 28` record at `$95E30` belonging to `bcdfa`'s *first* stream (offset 0, decoded offset 3,808 — a bordered UI frame, not equipment art) |

Three independent corpora, identical answer, zero false positives.

#### Verification (ground truth)

Each record was rendered at 36 × H and slid over the full 320 × 200 content of
all three emulator screenshots, comparing RGB directly (which sidesteps the
EHB index aliasing where e.g. index 53 and index 20 share a colour):

| Record | Screenshot | Position | Result |
|--------|------------|----------|--------|
| 2 (magenta-gem crest) | `default-3` | `(213, 62)` | **1,044 / 1,044 px RGB-exact (100.000%)** |
| 4 (silver breastplate) | `default-3` | `(284, 4)` | **900 / 900 px RGB-exact (100.000%)** |

That pins both the `H = 29` grid and the `H = 25` grid independently, and the
36-px drawn width (the breastplate ends exactly on the screen's right edge).

> **Correction — the record grid is offset by one plane from the earlier
> reading.** The previous note put the first records at stream offsets
> `0, 1044, 2088, 3132` and called the leftover 174 bytes at 4,176 an orphan.
> The grid actually starts at **174**: reading from 0 shifts every record one
> bitplane, which still renders a recognisable shape (planar art degrades
> gracefully under a whole-plane shift) but recolours it — the modal index
> profile comes out as 2/45/47 instead of the confirmed 33/54/23/24 that the
> screenshot-verified record at 4,350 shows. The 174 unpaired bytes are at the
> **start** of the stream, not the middle.

> **Correction — "19 entries at 32 × 29 in the DOS port is a good target count
> for this bank."** It is not: those 19 are the *separate* chest-armour bank
> at `bcdfa+0x2D05E` (previous section). This bank holds 7 records of a
> different geometry and there is no reason to expect 19 of them.

#### Rest of the stream (`7,050 … 18,184`) — **SOLVED**

> **Correction — this bank is not "7 records plus 11 KB of unclassified
> tail", and the 174 bytes at offset 0 are not an orphan stencil.** The whole
> 18,184-byte stream is described by **48 of the game's own 28-byte generic
> blit descriptors** (the record type documented in the `bcdfx`/`bcdfy`/
> `bcdfz` section; field `+0x00` is the A5 slot). Blind-scanning the
> decompressed S_1 image for records satisfying the three descriptor
> invariants and filtering on `slot == 0x04` finds them; they tile the stream
> **17,976 / 18,184 bytes (98.9%)** with a **single** 208-byte gap at
> `[7,246, 7,454)`, and the last record ends at `18,016 + 7 × 24 = 18,184`,
> the stream's exact decoded length, **zero remainder**.
>
> The 174 bytes at offset 0 are the **shared stencil** for all seven
> equipment-panel records: every one of those seven descriptors carries
> `flags = 0x0200` ("mask at `+0x0A`") with `maskSrc = 0`. A solid
> `FF FF FF FF F0 00` rectangle is exactly the right stencil for a
> 36-drawn-of-48-px opaque panel image, and 174 B = 6 B × 29 rows covers the
> tallest of them.
>
> The descriptor set also **independently reproduces both screenshot-verified
> placements** already recorded above: `src = 2,262`, 48×29, dest `(213, 62)`
> and `src = 4,350`, 48×25, dest `(284, 4)` — the same offsets, the same
> geometry and the same screen coordinates that scored 1,044/1,044 and
> 900/900 RGB-exact against `default-3`. Two independent methods, identical
> answer.

##### Record map (all 48 descriptors, slot `0x04`)

Plane count follows the flag rules given in the UI-panel-bank section
(`flags & 0x0200` ⇒ 6 colour planes + shared stencil; otherwise 7 planes,
stencil first).

| Stream range | Descriptor(s) (S_1) | Geometry | Planes | Content |
|--------------|---------------------|----------|--------|---------|
| `0 … 174` | — | 48×29 | 1 | shared stencil for the seven records below |
| `174 … 4,350` | `+0x20BD2`…`+0x20C26` | 4 × 48×29 @ `(213, 62)` | 6 | the four class crest/tabard emblems |
| `4,350 … 7,050` | `+0x20B7E`…`+0x20BB6` | 3 × 48×25 @ `(284, 4)` | 6 | the three body-armour images |
| `7,050 … 7,246` | `+0x20C42` | 32×7 | 7 | unnamed |
| `7,246 … 7,454` | — | — | — | **the one remaining gap** (208 B) |
| `7,454 … 8,702` | `+0x20C5E`, `+0x20C7A` | 2 × 32×24 (stencil at 7,454) | 6 | the "solid plate" pair the old autocorrelation found |
| `8,702 … 9,374` | `+0x20C96` | 32×24 | 7 | the "starburst" the old pass saw |
| `9,374 … 9,556` | `+0x20CEA`, `+0x20D06` | 2 × 16×7 (stencil at 9,374) | 6 | unnamed |
| `9,556 … 10,634` | `+0x20D22` | 112×11 | 7 | unnamed wide banner |
| `10,634 … 11,844` | `+0x23530`…`+0x23610` | 9 × 16×11 (stencil at 10,634) @ `(271,11)`, `(283,11)`, `(295,11)` | 6 | **3 slots × 3 states** — the three top-right indicator gems |
| `11,844 … 13,454` | `+0x20CB2` | 80×23 | 7 | unnamed |
| `13,454 … 13,790` | `+0x20CCE` | 32×12 | 7 | unnamed |
| `13,790 … 14,028` | `+0x2369E` | 16×17 @ `(257,109)` | 7 | unnamed |
| `14,028 … 14,798` | `+0x20F36` | 80×11 @ `(222,123)` | 7 | the spell-level bar (all five levels pre-composited) |
| `14,798 … 15,568` | `+0x20F52`…`+0x20FC2` | 5 × 16×11 @ x = 222/234/251/272/292, y = 123 | 7 | **`Spell Level 1 … 5`** |
| `15,568 … 16,448` | `+0x20FDE`…`+0x210BE` | 9 × 16×8 (stencil at 15,568) | 6 | unnamed 9-state indicator |
| `16,448 … 17,008` | `+0x210DA` | 32×20 | 7 | **`Ram Block`** — DOS `clipper.clp` `Ram Block`, 100.000% mask agreement (640/640 px), 0.995 luminance corr. See the `bcdfx`/`bcdfy`/`bcdfz` section's "DOS `Floor 2` and `Ram Block` — SOLVED" |
| `17,008 … 18,184` | `+0x2325E`…`+0x232EA` | 16×14, 16×16, 16×14, 16×16, 16×12, 16×12 | 7 | **the movement compass** — `Down Arrow Up / Right / Down / Left / Turn Left / Turn Right` |

###### Verification (ground truth) — DOS `clipper.clp` silhouettes

| Amiga `src` | Geometry | DOS entry | Agreement |
|-------------|----------|-----------|-----------|
| 14,798 | 16×11 | **137 `Spell Level 1`** | **100.000%** (176 px) |
| 14,952 | 16×11 | **138 `Spell Level 2`** | **100.000%** |
| 15,414 | 16×11 | **141 `Spell Level 5`** | **100.000%** |
| 16,448 | 32×20 | **161 `Ram Block`** | **100.000%** mask (640/640 px), 0.995 luminance corr |
| 17,008 | 16×14 | **93 `Down Arrow Up`** | **100.000%** (224 px) |
| 17,204 | 16×16 | **94 `Down Arrow Right`** | **100.000%** (256 px) |
| 17,428 | 16×14 | **95 `Down Arrow Down`** | **100.000%** |
| 17,624 | 16×16 | **96 `Down Arrow Left`** | **100.000%** |
| 17,848 | 16×12 | **97 `Down Arrow Turn Left`** | **100.000%** (192 px) |

The two records **between** the confirmed `Spell Level` frames — 15,106 and
15,260, drawn at x = 251 and x = 272 — are **not** `Spell Level 3` / `4`,
despite sitting exactly where those belong by position, geometry and screen
x-coordinate. Scored against *every* 16×11 image in `clipper.clp` they peak
at **88.6%** and **84.1%** (both on `Special Button 3R`, which is obviously
unrelated), and only **55.1%** / **45.5%** against `Spell Level 3` / `4`
themselves; their mask fill is 95.5% / 85.2% versus 40–71% for the three
confirmed frames. They are real, distinct records — **unidentified**, and
deliberately not named after their neighbours. 18,016 (16×12) is
`Down Arrow Turn Right` by the positional argument, which for the compass is
safe because the other five arrows are 100.000% matches in DOS's own order.

##### Why the earlier passes found nothing here

The old approach (a padding-column scan) can only find records that carry a
wide off-screen column of one constant index. That is true of the seven
48-px equipment records and of almost nothing else in this stream, which is
why re-running it "confirmed the negative". The stream was never a
padding-column problem: **the record boundaries are in the executable, not in
the pixels.** The general lesson for this project is in the UI-panel-bank
section above — scan for 28-byte descriptors first.

##### Historical: the autocorrelation survey (kept for the record)

The remaining 11,134 bytes are graphics, but not at 48 px. A sliding
byte-equality autocorrelation (window 600 B, lag 1–16) gives a clean,
piecewise-constant row width:

| Stream range | Dominant lag | Implied width |
|--------------|--------------|----------------|
| 0 – 6,750 | **6** (0.87 bit-agreement; record-size peak also visible at 1,044) | 48 px — the records above |
| 7,050 – 9,400 | **4** (0.91) | 32 px |
| 9,450 – 11,600 | **2** (0.83) | 16 px |
| 11,700 – 13,050 | **10** (0.89) | 80 px |
| 13,200 – 13,700 | 4 | 32 px |
| 13,800 – 14,500 | 10 | 80 px |
| 14,550 – 16,300 | **2** (0.84) | 16 px |
| 16,350 – end | 4 / 2 (weak) | 32 / 16 px |

The 32-px region has a clear 96-byte plane grid (24-row runs at offsets
`7,454 + 96k`, i.e. 32 × 24 planes, 576-byte records); rendering it gives a
solid black plate, a solid white plate and a black starburst — plausibly
screen-flash / effect frames rather than equipment. None of it was classified
further. This is why 18,184 factors so badly (`2³ × 2273`): the stream is a
**multi-asset UI block**, not one array.

Paths tried on this region:

| Approach | Result |
|----------|--------|
| Uniform 48×25×7 (mask + 6 colour, 1,050 B) records from offset 0 | Garbage — there is no mask plane, and 18,184 / 1,050 is not integral |
| Uniform 48×25×6 (900 B) records from offset 0 | Garbage |
| Uniform 900-B records phased on the armour (start 750) | 3 of 19 coherent, rest garbage → heights are not uniform (superseded: heights are 29/29/29/29/25/25/25 and the bank stops at 7,050) |
| Searching the whole file set for the armour's 900 RAM bytes raw | Not present raw — it is RLE-compressed |
| Exact-remainder arithmetic over plane counts × widths for the whole 18,184 | No fixed record size divides it; 18,184 = 2³ × 2273 has no useful divisors. Correct conclusion (it is not one array), wrong inference if read as "variable-height records fill the file" |
| Byte-5-constant structural scan at widths 4, 5 and 6 bytes over every stream in every file | Found the 7 records and nothing else; the tail does not use a constant padding column at any of those widths |
| Rendering the tail at 32 / 16 / 80 px with 6 sequential planes and the UI palette | Coherent only for three 32×24 plates; the rest renders as colourful noise, so either the plane count or the palette (or both) differs there |
| Re-ran the generalised any-constant-index padding-column scan (the technique that found the `bcdfa+0x00000` UI panel bank's 7 records, widths 2–12 bytes, heights 16–39) over the full 11,134-byte tail | Only re-found the already-known 32×24 solid-plate grid (large hit clusters at the same offsets); no new record-shaped hits elsewhere in the tail | Confirms the existing negative result rather than extending it — the UI panel bank's success depended on most of its records having a wide, single-index off-screen padding column, which this tail evidently lacks outside the 32×24 plates |

---

### Dungeon-floor item sprites — **SOLVED** (147 sprites = 49 items × 3 depths)

> **Correction (supersedes the "no separate asset class found" negative result
> below).** There *is* a distinct floor-item sprite bank, and it is a
> **variable-size, self-describing** one — 49 purpose-drawn "lying flat on the
> ground" graphics, each pre-rendered at **three** sizes for the three drawable
> view depths, 147 masked sprites in total. The pixels are the RLE stream at
> `bcdfa+0x270C4`; the geometry is a 147 × 10-byte blit-descriptor table in
> decompressed `bcdft` S_1 at `+0x271B6`.
>
> The negative result was wrong for one specific, generalisable reason: its
> search was a **`MULU #imm` census**, which can only ever find *fixed*-size
> record arrays. This bank has no fixed record size — each descriptor carries
> its own `width`/`height`/`bytesPerPlane`, so the blit code needs no stride
> constant and the census had nothing to find. (The same shape as
> `bcdfx`/`bcdfy`/`bcdfz`'s 28-byte sub-image descriptors, which the negative
> result already had in front of it.) Every individual fact it recorded below
> is still true; only the conclusion drawn from them was wrong. The other
> mistaken premise — "there is no fourth bank because only three `d16(A5)`
> bank pointers exist" — fails the same way: this bank is not addressed
> through an `A5` slot at all, the descriptor's `src` is an offset into an
> RLE-decoded buffer reached PC-relative.

#### Location and layout (confirmed)

| Property | Value |
|----------|-------|
| Pixel bank | `bcdfa+0x270C4`, one RLE stream (bcdfu `LAB_0043`) → **31,388 B** |
| Descriptor table | decompressed `bcdft` S_1 **`+0x271B6` … `+0x27774`**, 147 × 10 B |
| Count | **147** = **49 floor graphics × 3 view depths** |
| Depth order | within a group: index 0 = **nearest** (largest), 2 = **farthest** |
| Geometry | per-sprite; widths 16/32/48/64/80 px, heights 1–26 rows |
| Planes | **7** — plane 0 = 1-bit cookie-cut mask, planes 1–6 = 6bpp EHB colour |
| Record size | `7 × (width/8) × height`, packed back to back, no padding |
| Palette | bcdft dungeon palette, registers **0–25 only** (never the 26–31 accent ramp), so one palette serves every level |
| Selector | `bcdfs` item `gfxNumber` → S_1 `+0x26FDE` 236-byte table → group 0–48, `0xFF` = no floor graphic |
| Extractor | `scripts/bclib/bcdfa.py` (`floor_item_sprites`), driven by `scripts/extract_floor_items.py` |
| Assets | `public/assets/blackcrypt/amiga/sprites/floor-items.{png,json}` (147 frames, `floorNN-dD`), `data/floor-item-gfx-table.json`, `data/floor-item-names.json` (49 confirmed names — see "DOS cross-check and group naming" below) |

##### The 10-byte descriptor (confirmed)

Read at S_1 `+0x2193E`. It is a compressed form of the same blit parameters as
the 28-byte tileset sub-image descriptor documented in the `bcdfx`/`bcdfy`/
`bcdfz` section:

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `+0x00` | 2 | `src` | byte offset into the decompressed 31,388-byte bank |
| `+0x02` | 2 | `bytesPerPlane` | `(width / 8) × height` |
| `+0x04` | 2 | `BLTSIZE` | `(height << 6) \| (width / 16 + 1)` |
| `+0x06` | 2 | blitter modulo | `40 − (width / 16 + 1) × 2` |
| `+0x08` | 1 | width (pixels) | always a multiple of 8 |
| `+0x09` | 1 | height (rows) | |

##### The consumer (confirmed, S_1 `+0x21900`–`+0x21962`)

Disassembled from `build/cache/blackcrypt/bcdft_decompressed.bin` (`m68k`,
big-endian; all addresses are **offsets into decompressed S_1**, and the
`LEA (PC)` displacements resolve to S_1 offsets directly):

```
21908  lea.l   0x26fde(pc),a1     ; gfxNumber -> floor-group table (236 bytes)
2190c  move.w  (a2),d0            ; d0 = gfxNumber
21910  move.b  (a1,d0.w),d1       ; d1 = group
21914  bmi.b   0x2198c            ; 0xFF -> item has no floor graphic, skip
21916  move.w  d1,(a2)
2192e  move.w  (a2),d0
21930  mulu.w  #30,d0             ; group * (3 depths * 10 bytes)
21934  move.w  0x2(a2),d1         ; d1 = view depth (0..2)
21938  mulu.w  #10,d1
2193c  add.w   d0,d1
2193e  lea.l   0x271b6(pc),a0     ; <- descriptor table base
21942  lea.l   (a0,d1.w),a0       ; <- this sprite's descriptor
2195a  lea.l   0x27774(pc),a1     ; per-(depth, floor-slot) screen coords
```

`MULU #30` / `MULU #10` fix the record size at 10 bytes and the group stride
at 3 records; `LEA 0x27774(PC)` lands exactly on `0x271B6 + 147 × 10`, which
independently pins the table's **end**, not just its start.

#### Verification (ground truth)

| Check | Result |
|-------|--------|
| Descriptor self-consistency | `bytesPerPlane == (w/8)*h`, the `BLTSIZE` identity and `modulo + blitBytes == 40` all hold on **147 / 147** records |
| Bank tiling | sorted by `src`, the 147 records tile the bank with **0 gaps and 0 overlaps**, first `src` = 0 and last record ends at **31,388** = the decompressed stream length **exactly** |
| Table extent | start `0x271B6` and end `0x27774` are both read straight out of the consumer's own `LEA`s |
| Group structure | all **49 / 49** triples are monotonically non-increasing in both width and height (near → far) |
| Selector table range | the 236 entries take exactly the values `0…48` and `0xFF`; all 49 groups are referenced, 176 of 236 `gfxNumber`s draw a floor graphic |
| **Live screen oracle** | 10 in-game screenshots (`data/default_45.png` … `default_54.png`). **43 sprite placements matched, 7,474 / 7,474 visible opaque pixels RGB-exact — 100.000 %, zero mismatches** (see below) |
| Depth semantics | the same group renders as index 0 (48×25, `default_54`, viewport y = 100), index 1 (32×13, `default_50`, y = 93) and index 2 (16×8, `default_45`, y = 76) — bigger sprite, lower on screen, nearer square |

##### How the screenshot oracle was set up

Worth recording, because two premises had to be fixed before any comparison
was possible:

1. **The 2026-08-01 amiberry captures are 378 × 243, not 376 × 243, and their
   colours are black-level shifted.** Every 8-bit channel value in them is
   `floor(0.98431 × old + 4)` relative to the July captures (0 → 4, 17 → 20,
   136 → 137, 255 → 255); the 23 possible source values invert unambiguously.
   Without undoing that, *no* known asset matches anything.
2. **Amiberry's EHB model is not the hardware one.** It halves the expanded
   8-bit component (`0x55 → 0x2A`); real OCS halves the 4-bit register value
   (`0x5 → 0x2`, i.e. `0x55 → 0x22`). `bclib.ehb_palette` implements the
   hardware model and is correct for the shipped assets; the screenshot
   comparison uses the emulator model, because that is what the PNG contains.

With those two fixed, the 3D viewport is at image `(38, 20)`, exactly
**208 × 140** (the documented save-under size), and **all 10 screenshots'
viewports map to the level-1 dungeon palette with 0 unmatched colours**.

##### Viewport vs panel palette split (confirmed)

The copper split between the 3D viewport and the equipment panel covers more
than the 26–31 accent ramp. Registers **1** and **9** also differ:

| Register | Equipment panel (live, from savestates) | 3D viewport |
|----------|------------------------------------------|-------------|
| 1 | `0x158` (17, 85, 136) | **`0xC86`** (204, 136, 102) — the shipped value |
| 9 | `0x940` (153, 68, 0) | **`0x0DD`** (0, 221, 221) — the shipped value |

Evidence: floor sprite 120's index-1 pixels render as RGB (204, 136, 102) in
`default_51`, and sprite 24's index-41 (EHB half of 9) pixels render as half
of `0x0DD` in `default_45`, both inside 100 %-exact whole-sprite matches. So
`extract_items.py`'s `UI_PALETTE_OVERRIDES` are **panel-only** — the floor
extractor must *not* apply them.

##### DOS cross-check and group naming — **SOLVED**

> **Correction — supersedes "corroborating, not conclusive" below.** The
> earlier pass compared the Amiga bank against `clipper.clp`'s 233-entry
> `misc` bucket, the wrong pool. `clipper.clp` carries its own **explicit**
> `Start Floor Items` / `End Floor Items` marker block (directory type
> `0x01`, entries **651** and **799**) delimiting **exactly 147 entries**
> (652–798) — the DOS archive's own author-written boundary for a bank
> matching this one, not an inferred one. Within it, every third entry
> (`652, 655, 658, …`) is named (`Hammer`, `Belt`, `Apple`, …) and the other
> two are unnamed, and the three entries of each triple are monotonically
> non-increasing in width and height — the identical near→far shape as the
> Amiga's per-group depth ordering. This is the DOS floor-item bank, and it
> gives the group names outright.

**Group-for-group correspondence (confirmed):** comparing the Amiga
descriptor table's 147 `(w, h)` pairs against the DOS block's 147 `(w, h)`
pairs, **at the same group index**, gives an **exact match for all 49/49
groups, 147/147 individual depth records, 0 deviation** — no reordering, no
fuzzy matching, `dos_groups[i] == amiga_groups[i]` for every `i`. Four pairs
of groups happen to share identical dimensions and so aren't disambiguated by
size alone (`0`/`39` Hammer vs. Tall Shield, `5`/`6` Gold Key vs. Silver Key,
`14`/`15` White Clothes vs. Brown Clothes) — resolved by the pixel check
below, which confirms the *positional* pairing directly rather than relying
on dimension coincidence.

**Pixel check (confirmed):** rendering both sides — Amiga via
`bclib.decode_masked` + the confirmed dungeon EHB palette, DOS via
`clipper.clp`'s own `Palette` entry keyed on its brown/cyan background
convention (the same convention already established for the 24×24 item
icons) — and comparing per-pixel opacity (not colour; the two ports are
separately authored art, same convention as the item-icon DOS check):

| Check | Result |
|-------|--------|
| Dimension match, all 147 records | **147/147** exact, 0 deviation |
| Silhouette (opaque/transparent) agreement, whole bank | **35,869 / 35,872 pixels (99.992 %)** |
| Silhouette agreement, the 4 dimension-ambiguous groups (0, 5, 6, 14, 15, 39) | **100.000 %** on 5 of 6; group 14 (White Clothes) 99.861 % (2 edge px) |
| Per-group worst case | group 9 (Cheese) 99.792 % (1 edge px), group 14 (White Clothes) 99.861 % (2 edge px) — everything else 100.000 % |

The 3 total disagreeing pixels across the whole 35,872-pixel bank are
isolated edge/anti-aliasing pixels on 2 of the 49 groups, not a
classification error. `scripts/verify_floor_item_dos_names.py` reproduces
this end to end and is the regression check.

**The 49 confirmed names**, in group-index order (`bclib.FLOOR_ITEM_NAMES`):
Hammer, Belt, Apple, Backpack, Quiver, Gold Key, Silver Key, Death Gem,
Dagger, Cheese, Sword, Bag, Scroll, Amulet, White Clothes, Brown Clothes,
Spell Book, Horn, Bow, Arrow, Potion, Helmet, Wand, Ring, Crown, Bracers,
Gauntlets, Meat, Water Skin, Blue Eyes, Holy Symbol, Coffer, Chain Mail, Sun
Key, Figurein of Deflection, Skull, Mace, Rod, Idol of Temin, Tall Shield,
Round Shield, Axe, Chest Plate Armor, Boot Plate Armor, Big Chest, Clawpiller
Mask, Orb, Leather Boots, Stone Tablet. ("Figurein of Deflection" is verbatim
from the archive — an authentic misspelling in the game's own data.)

Output: `public/assets/blackcrypt/amiga/data/floor-item-names.json` (written
by `extract_floor_items.py`), `{index, name, frames: [floorNN-d0..d2]}` per
group. Frame names themselves are unchanged (`floorNN-dD`) — the names file
is additive metadata, not a rename, so nothing downstream that already
depends on the `floorNN-dD` convention breaks.

> Why the earlier `bcdft` string-table approach was abandoned rather than
> fixed: it had no structural link to the floor-item bank at all (just
> positional proximity in a string region 385 strings long against a
> documented 254), whereas `clipper.clp`'s marker block is a hand-authored
> boundary in the *other* platform's own resource catalogue, immediately
> falsifiable (either the counts and dimensions line up or they don't) and
> in fact lines up with zero deviation.

##### Still open

| Question | Status |
|----------|--------|
| The three remaining bcdfa gaps | Unchanged — `0x00000` (18,932 B), `0x10779` (4,288 B) and `0x111E1` (34,340 B) are each one clean RLE stream, content unidentified. Note this bank was found in the *fourth* such gap, so they are worth a pass with the same descriptor-table-in-S_1 assumption |

---

#### Superseded: the original "no separate asset class found" write-up

Retained because every individual observation in it is still correct and the
paths it closed are still closed.

Items lying on a dungeon floor square are visible in the 3D view. The question
was whether the Amiga stores a *distinct* sprite for that, separate from the
24×24 inventory icon. **No such bank exists in the game files.** This is a
negative result with a specific residual doubt, recorded so nobody re-runs it.

Evidence:

| Check | Result |
|-------|--------|
| Census of **every** `MULU/MULS #imm` in the decompressed `bcdft` S_1 (166,676 B, the overlay that owns all in-game rendering) | Only **two** image-record sizes appear anywhere: `#$1B0` = 432 (24×24 item icons, 5 sites) and `#$2B8` = 696 (32×29 chest armour, 2 sites). Every other immediate resolves to a text/font row stride (`$52`, `$2A`, `$348`, `$290`), a struct stride (12, 20, 28, 40) or a table pitch |
| Corpus-wide search for `MULU #$1B0` | Present only in `bcdft`'s decompressed image; absent from `bcdfp`, `bcdfq`, `bcdfu`, `bcdfv` |
| Number of item-graphics banks reachable from code | Two 432-byte banks (`$D4(A5)`, `$D8(A5)` = the 175- and 5-icon banks) and one 696-byte bank (`$DC(A5)` = chest armour). No fourth |
| Number of `gfxNumber` graphic-selector tables | Two of the three parallel 236-entry tables select graphics: `+0x26EF2` → icon index (max 174) and `+0x270CA` → armour index (max 18). The third, `+0x26FDE`, is not a graphic index (it is read at `+0x21908` / `+0x219BE` / `+0x21CB0`, none of which reach a bank pointer or a blit). No fourth table exists — **wrong on both counts: `+0x26FDE` *is* the floor-graphics selector, and `+0x21908` is the read that reaches the descriptor table 0x36 bytes later** |
| Icon blit routine (`+0x20780`) | Fixed `BLTSIZE = $603` (24 rows × 3 words) — **no scaling path**, and the destination `(x, y)` is a free parameter (`y × 40 + x/8` against the six screen bitplane pointers at `$464(A5)`), so the same routine can place a 24×24 icon anywhere on screen including inside the 3D viewport |
| The one place icon draws are laid out by a table | S_1 `+0x2435C` walks hard-coded `(icon, x, y)` triples at `+0x243D6` / `+0x243FA`: icons `0..4` at `(254,5) (220,35) (288,35) (254,65) (254,92)` and icons `5..8` at the same four positions. Every x is ≥ 220, i.e. the equipment panel, never the 3D viewport — and the coordinates match the empty-slot placements already recorded in the item-icon section's screen-oracle table, which independently re-confirms that icons 0–4 are the empty-slot art |
| DOS port cross-check | `clipper.clp` has no floor-item-shaped entries. The 233 remaining unnamed `misc` entries were rendered and inspected: the four large size clusters (16×11 ×31, 16×15 ×30, 8×14 ×29, 16×20 ×29) are **door graphics at four view depths**, not scaled item art — **now doubtful; 105 of the Amiga's 147 floor-sprite sizes do appear in that same `misc` pool, and the four clusters look like ~30 objects × 4 depths** |

Conclusion (**hypothesis, strongly supported**): a floor item is drawn with the
**same 24×24 icon**, unscaled, blitted into the 3D viewport at a position
derived from the square's depth and position. There is no separate floor-item
sprite class and no pre-rendered distance variants.

> **Refuted.** See the correction at the head of this section. There *is* a
> separate class (147 sprites) and there *are* pre-rendered distance variants
> (3 per item).

Residual doubt, and how to settle it cheaply: the caller of `+0x20750` was not
traced (the overlay's own `JSR`s are absolute runtime addresses — e.g.
`JSR $A7EAC.L` — and S_1's load base is not established, so a static xref from
the file-offset disassembly cannot resolve them). None of the five savestates
on disk has an item on the floor, so there is no pixel oracle either. The
narrow live-capture ask that would close this in one shot: **drop an item on a
dungeon floor square, step back one square, and take a screenshot plus a
savestate.** If the object on the floor is pixel-identical to an entry in
`sprites/items.png` the hypothesis is confirmed outright; if it is a different
image, its chip-RAM bytes give the missing bank's address directly.

> The ask was answered with screenshots only (no savestate) —
> `data/default_45.png` … `default_54.png` — and screenshots alone were
> enough: the floor objects are *not* pixel-identical to any
> `sprites/items.png` entry, and locating their bits took no chip-RAM dump.
> The winning move was a **bit-level search of the whole decompressed corpus
> for one screenshot row's plane bits**: convert the on-screen sprite back to
> palette indices, take the longest run of unambiguous pixels in one row, and
> search every decompressed blob for that 46-bit pattern at any bit offset,
> once per colour plane. Four of the six planes returned 2–3 corpus-wide hits
> and all four agreed on the same blob; the *spacing between* the per-plane
> hits handed over the plane stride (150 B) and the *spacing between* adjacent
> rows' hits handed over the row stride (6 B = 48 px) for free — geometry and
> location in one pass, with no rendering and no guessing.

##### Paths tried (this section)

| Approach | Result |
|----------|--------|
| `MULU/MULS #imm` census across decompressed `bcdft` S_1 | Found the two fixed-size icon banks and nothing else. **Structurally incapable** of finding this bank: variable-size records carry their own dimensions, so no stride immediate exists. The `MULU #30`/`MULU #10` that *do* index the descriptor table are table pitches, which the census explicitly binned as "not an image size" |
| Enumerating `d16(A5)` bank pointers | Found 3; concluded "no fourth bank". The floor bank is not reached through `A5` at all — the descriptor's `src` indexes a buffer reached PC-relative |
| Assuming the third 236-entry `gfxNumber` table was not a graphic selector | Wrong. It is the floor-graphics selector; the read at `+0x21908` reaches the descriptor table 0x36 bytes further down the same routine |
| Blind RLE-stream walk of bcdfa's unclassified gaps | Correct and cheap — the gap `0x270C4…0x2D05E` is exactly one stream (31,388 B). Doing this *first* would have surfaced the bank before any code tracing; it was skipped because the gap was assumed to be BCSPEED slack |
| Exact-RGB template match of known assets against the new screenshots | Zero hits until the amiberry black-level shift was undone. Silent, total failure mode — worth checking first whenever a new capture batch stops matching an old one |
| Cookie-cut invariant (`colour AND NOT mask == 0`) as a record segmenter | Fails here — 686 colour bits lie outside the roast's mask. Black Crypt artists leave garbage outside the mask because the blit ANDs it away |

---

### bcdfb–bcdfn — Monster Sprite Files (Per Dungeon Level) — **SOLVED**

These 13 files each contain **all monster graphics for one dungeon level**.
Data is **RLE compressed** (bcdfu `LAB_0043`) behind a fixed-size directory.

Extraction is fully working: **204 sprites across all 13 files**, byte-exact,
verified against reference renders and in-game screenshots.

#### File Structure

```
0x0000   12 bytes    file header
0x000C   1176 bytes  42 × 28-byte directory entries
0x04A4   214 bytes   secondary table (RAW — NOT compressed)
0x057A   ...         single RLE stream          ← STREAM_START = 1402
```

> **Correction (was the root cause of all earlier extraction bugs):**
> the RLE stream does **not** begin at `0x4A4` immediately after the directory.
> A **214-byte uncompressed secondary table** sits between them. The stream
> starts at **byte 1402 (`0x57A`)**, and this constant is **identical in all 13
> files**. Decoding from `0x4A4` treats that raw table as RLE data and desyncs
> the entire stream, which is what produced the "24-pixel circular shift"
> previously recorded as unresolved. That shift is **resolved** — it was never a
> shift, it was a decode offset error.

#### 12-byte Header

| Offset | Size | Description |
|--------|------|-------------|
| 0x00   | 2    | Padding (always `0x0000`) |
| 0x02   | 2    | **Compressed stream length** in bytes (verified: matches measured stream length in all 13 files) |
| 0x04   | 2    | Monster graphics ID #1 |
| 0x06   | 2    | Monster graphics ID #2 (0 if unused) |
| 0x08   | 2    | Monster graphics ID #3 (0 if unused) |
| 0x0A   | 2    | Padding (always `0x0000`) |

The three IDs at +4/+6/+8 are the **same graphics IDs used in the `bcdfs`
monster bytecode at offset +1** ("Graphics & sound effects ID"). This links each
sprite file to the monsters placed on its map.

**This confirms the letter→map mapping** (`bcdfb`=map 1 … `bcdfn`=map 13):
cross-referencing every header ID against monster records in the corresponding
`bcdfs` map region gives **11/13 exact containment**.

> **Correction (2026-08-02) — two things in this table were wrong.**
>
> 1. **The IDs are stored in sprite-store order, not sorted.** The table below
>    previously listed map 9 as `bf, c4` and map 11 as `bd, be, c6`; the bytes
>    at `+4/+6/+8` actually read `c4, bf` and `be, c6, bd`. The order is
>    load-bearing — **header ID *i* is cluster *i*** of the sprite store (see
>    "Cluster → graphics-ID binding" below), so a sorted table destroys the one
>    thing the field is good for.
> 2. **"The two misses are generator-spawned" was a guess, and is wrong for
>    both.** `bcdfl`'s `0xbd` is not a monster at all — `0x00BD` is the
>    **Statue** structure's `gfxNumber`, and map 11 is the only map in the game
>    carrying type-`0x2F` statue records (9 of them). `bcdfe`'s `0x50`
>    (Dragonlich) and every other "unplaced" ID is a **row-0 prototype**, a
>    separate mechanism described under "Row 0 is a prototype row" below.

| Map | File | Graphics IDs (file order) | Dungeon levels | Cluster names |
|-----|------|---------------------------|----------------|----------------|
| 1  | bcdfb | `b2`, `b3`           | 1, 2         | Two Head (the Ogre), Rock Eye |
| 2  | bcdfc | `4f`, `b0`, `b1`     | 3, 4, 5      | — (`4f` is the only movement-type-3 "thief" in the game) |
| 3  | bcdfd | `4d`, `4e`, `c7`     | 6, 7, 8, 9   | — |
| 4  | bcdfe | `4b`, `4c`, `50`     | 10, 11, 12   | `50` = **Dragonlich** |
| 5  | bcdff | `ba`, `c3`           | 13           | — |
| 6  | bcdfg | `b7`, `b8`           | 14, 15       | `b8` = **Possessor Demon**; `b7` = variant, unplaced |
| 7  | bcdfh | `b5`, `b9`           | 16, 17, 18, 19 | `b5` = **Ram Demon**; `b9` = stationary, 1 sprite |
| 8  | bcdfi | `b6`                 | 20           | **Ram Lord** |
| 9  | bcdfj | `c4`, `bf`           | 21, 22       | — |
| 10 | bcdfk | `bc`                 | 23           | **The Great Waterlord** |
| 11 | bcdfl | `be`, `c6`, `bd`     | 24, 25, 26   | `be` = **Medusa**; `bd` = **Statue** (not a creature) |
| 12 | bcdfm | `b4`                 | 27           | — |
| 13 | bcdfn | `c5`                 | 28           | **Estoroth Paingiver** |

##### Row 0 is a prototype row, not a placement — **confirmed**

Thirteen monster records across eleven maps sit on a square whose level nibble
is **0**. Every single one of them is on **row 0**, and no level-nibble-0
monster exists on any other row (13/13, zero deviation). Row 0 is therefore a
**prototype/template row** the level's real placements and its summon/generator
scripts copy from, not somewhere the party can meet a monster.

This matters because a prototype record looks exactly like a "unique boss with
a single placement" if you only count records — which is precisely how the
Dragonlich was nearly mis-attributed (see the corrections table at the end of
this section).

#### 214-byte Secondary Table (`0x04A4`–`0x0579`)

107 big-endian words, all with a zero high nibble, stored as repeating value
pairs (e.g. bcdfb begins `0001 0035` ×5; bcdfk is `000e 0042` repeated). Values
are small (< `0x80`), so this is **not** a palette. Purpose not yet determined —
most likely animation/frame sequencing or sound-effect pairing. It is read
directly (uncompressed) and must be skipped to reach the RLE stream.

#### 42 × 28-byte Directory Entries

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| +0     | 4    | data_offset | Offset into the decompressed stream — **exact, no fixup needed** |
| +4     | 4    | plane_size  | Bytes **per bitplane** = (width/8) × height |
| +8     | 4    | reserved    | Always 0 (verified across all 546 entries) |
| +12    | 2    | bltsize     | `(height << 6) \| (width/16 + 1)` — verified |
| +14    | 2    | modulo      | Screen modulo; varies 14–36 by sprite width (**not** usually 0) |
| +16    | 4    | reserved    | 0 in 534/546 entries; 12 entries carry non-zero values |
| +20    | 2    | type        | `0x0100` = normal (451), `0x0500` = mirrored/alternate (95) |
| +22    | 2    | width       | Width in pixels |
| +24    | 2    | height      | Height in rows |
| +26    | 2    | reserved    | 0 in 533/546 entries |

> **Note:** the `+4` field was previously labelled "bytes per row". It is bytes
> per **plane** — the stride between consecutive bitplanes of the same sprite.

#### Sprite Data Layout

The whole file decompresses to **one contiguous buffer**. Each sprite occupies
exactly `7 × plane_size` bytes, tiled back-to-back with **no gaps and no
per-sprite header**:

```
mask     = stream[off             : off + ps]        ; 1 = opaque
plane_1  = stream[off + ps*1      : off + ps*2]      ; colour bit 0
...
plane_6  = stream[off + ps*6      : off + ps*7]      ; colour bit 5
colour_index = Σ plane_p << (p-1)                    ; 0-63, EHB
```

**Proof / self-check.** For every pair of consecutive distinct `data_offset`
values, `next_off − off == 7 × plane_size` **exactly** (verified over 13 frames
in bcdfb spanning plane sizes 128–1548, zero deviation). Consequently:

```
len(decompressed) == max(data_offset + 7 × plane_size)
```

holds exactly for all 13 files. This is a reliable integrity check — if it
fails, the stream start is wrong.

| File | Decompressed | Sprites | File | Decompressed | Sprites |
|------|-------------:|--------:|------|-------------:|--------:|
| bcdfb | 66,528 | 14 | bcdfi | 48,188 | 10 |
| bcdfc | 65,646 | 21 | bcdfj | 61,376 | 20 |
| bcdfd | 56,098 | 24 | bcdfk | 47,922 | 10 |
| bcdfe | 70,336 | 16 | bcdfl | 69,132 | 17 |
| bcdff | 51,058 | 20 | bcdfm | 45,836 | 10 |
| bcdfg | 67,816 | 20 | bcdfn | 53,774 | 11 |
| bcdfh | 52,402 | 11 | **Total** | | **204** |

#### Trailing Data — Wall Decorations + Monster Sound Bank (**SOLVED**)

The RLE stream does not consume the whole file — 9–19 KB remains after the
terminator in each (bcdfb: stream ends at 49,067 of 60,913). The trailing
region begins **immediately** after the stream's `0x00` terminator, with no gap
and no header. Its start is independently pinned by the 12-byte file header:
`1402 + word@0x02 == stream_end` **exactly in all 13 files** (bcdfb:
`1402 + 0xBA31 = 49,067`).

```
+0        1932 B    wall-decoration graphics — 3 decorations × 644 B
+1932     to EOF    monster sound-effect bank — raw signed 8-bit PCM,
                    samples back to back, last sample ends exactly at EOF
```

> **Correction (supersedes two earlier passes).** This region was previously
> documented as "692 standalone 1bpp 16×20 icons", then corrected to "92
> 16×20 mask+6bpp-EHB icons, 7 per file". **Both are wrong.** Only the first
> **1932 bytes** are graphics; the remaining 7–17 KB per file is *sound*, not
> pixels — every "icon" with index ≥ 7 in the old `structure-icons` atlas was
> PCM audio rendered as bitplanes. The old colour-diversity boundary
> heuristic did detect a real transition at roughly the right place (~7 × 280
> = 1960 ≈ 1932), but attributed the far side of it to "unidentified noise"
> instead of recognising it as audio, and it also got the *icon* geometry
> wrong on the near side (the icons are three nested sizes, not a uniform
> 280-byte stride). The tell that was missed: the region's byte histogram is
> centred on 0x00/±small values with a smooth waveform envelope, and its
> median |Δ| between consecutive bytes is < 40 (bitplane data runs > 90).
> `scripts/extract_bcdfbn_icons.py` has been deleted; use
> `scripts/extract_bcdfbn_decor.py`.

##### Wall-decoration block (`+0 .. +1932`)

Three 644-byte blocks. **One block = one wall decoration at three view
distances**, 16 px wide throughout (2 bytes/row), each size stored as **7
sequential planes** — plane 0 = 1bpp mask, planes 1–6 = 6bpp EHB colour — i.e.
the game's usual `bclib.decode_masked(chunk, 16, h, color_planes=6)`:

| Offset in block | Size | Geometry | Planes | Bytes |
|----------------:|------|----------|-------:|------:|
| +0   | near | 16 × 20 | 7 × 40 B | 280 |
| +280 | mid  | 16 × 15 | 7 × 30 B | 210 |
| +490 | far  | 16 × 11 | 7 × 22 B | 154 |

`280 + 210 + 154 = 644` **exactly** — the block tiles with zero padding, and
`3 × 644 = 1932` with zero padding.

**Verification (quantified):**
- **Boundary, 13/13 files, zero deviation.** Bit-agreement at lag 644 across
  the trailing region is 0.60–0.98 for the first two 644-byte windows and
  collapses to chance (0.49–0.54) from byte 1932 onward, in every file. The
  three blocks per file are mutually similar; nothing after 1932 is.
- **Boundary, byte-exact in bcdfb.** `1932 + 4432 + 3488 + 1994 = 11,846` =
  the trailing region's exact length, where the three addends are DOS
  `clipper.clp` sound entries #170, #169, #177 matched **byte-for-byte**
  (see the sound section below). 100 % of bcdfb's post-1932 bytes are
  accounted for by known DOS sound samples with no gap and no overlap.
- **Geometry, self-validating.** The masks are nested rectangles that shrink
  with the size step: `ffff` (16 px) × 20 rows, `3ffc`/`7ffc`/`3ffe`
  (12–13 px) × 15 rows, `0ff0`/`1ff0`/`1ff8` (8–9 px) × 11 rows — width ratio
  1 : 0.78 : 0.53 against height ratio 1 : 0.75 : 0.55. 111 of 117 masks are a
  *single 16-bit row value repeated* for every row but the last.
- **Content.** Rendering all 117 sprites through the confirmed game palette
  gives, for every one of the 39 decorations, **the same recognisable object
  at three progressively smaller sizes** — which cannot happen by accident
  under a wrong layout. The art is exactly what was expected: wall-mounted
  keyhole/lock plates (grey stone, black, gold, ornate orange, marble), a
  red-cross panel, a gargoyle face with glowing orange eyes, a blue-eyed
  mechanism, cross/dial plates.
- **0 unknown palette indices across 23,550 rendered opaque pixels.**

bcdfj and bcdfk (maps 9 and 10) have a **byte-identical** 1932-byte decoration
block — the two levels share a decor set.

##### Monster sound bank (`+1932 .. EOF`) — **confirmed**

Raw **signed 8-bit PCM**, no header, no per-sample length field; samples are
stored back to back and the last one ends exactly at EOF.

**Cross-platform oracle (the decisive evidence).** The DOS release's
`clipper.clp` type-4 entries are the *same samples* in unsigned form: DOS byte
== Amiga byte `XOR 0x80`. Byte-exact matches found by direct search:

| File | Offset in trailing region | Length | DOS `clipper.clp` entry |
|------|--------------------------:|-------:|-------------------------|
| bcdfb | 1932 | 4432 | #170 |
| bcdfb | 6364 | 3488 | #169 |
| bcdfb | 9852 | 1994 | #177 |
| bcdfc | 12410 / 14854 / 16684 | 2444 / 1830 / 1994 | #173 / #174 / #177 |
| bcdfd | 16310 | 1830 | #174 |
| bcdfe | 14792 / 16786 | 1994 / 2444 | #177 / #173 |
| bcdff | 9726 | 1580 | #176 |
| bcdfg | 12132 | 1994 | #177 |
| bcdfh | 11886 | 1994 | #177 |
| bcdfi | 9818 | 1994 | #177 |
| bcdfj | 12966 | 2154 | #178 |
| bcdfm | 6018 | 3684 | #175 |
| bcdfn | 11510 | 1994 | #177 |

Every one of these ends **exactly at the file's last byte** or abuts the next
matched sample with no gap. `sound_0177` (1994 B) is the last sample in 6
different files. bcdfb is fully tiled (100 % coverage, 0 unmatched bytes).

Independent corroboration: `bcdfu` contains a 4-channel Paula driver — the
channel structs at `bcdfu.asm` `LAB_0085`–`LAB_0088` hold literal
`$00DFF0A0` / `B0` / `C0` / `D0`. The 12-byte file header's `+4/+6/+8` IDs are
the `bcdfs` "**Graphics & sound effects** ID" field, so graphics + sound in one
per-level file is exactly what the header advertises.

> **Correction:** this paragraph previously offered a second corroboration —
> that "`bcdfv`'s block 3 (`bcdfu.asm` `LAB_003A`) reads 26,508 bytes raw,
> un-RLE'd, already annotated there as sound". Both halves are wrong and it
> should carry no weight here. The block is not raw (`LAB_005E` RLE-decompresses
> it to a 32,000-byte 320×200 image — the destroyed Black Crypt facade), and
> the "annotated there as sound" was a hand-written guess in the `.asm`, not a
> traced fact. See the bcdfv section. The DOS `clipper.clp` byte-exact match
> above is unaffected and remains the actual evidence for bcdfb–bcdfn's audio.

**Open:** the per-sample offset/length table. Not present in the file header,
the 42-entry directory, the 214-byte secondary table, the decompressed sprite
stream, or `bcdfp`/`bcdfq`/`bcdfu`/`bcdfv`/`bcdfs` as a plain word/long triple
of the known bcdfb values (searched exhaustively for `4432/3488/1994`,
`2216/1744/997`, `1932/6364/9852` in both 16- and 32-bit BE, and for any
`4432` within 32 bytes of a `3488`). Without it, samples inside a bank cannot
be split for files with no DOS anchor; the extractor emits the whole bank per
level as one `.raw`.

**Extractor:** `scripts/extract_bcdfbn_decor.py` →
`sprites/wall-decorations` (117 frames, `m<map>_decor<0-2>_<near|mid|far>`),
`audio/level<NN>-sfx.raw` (13 banks, `pcm_s8`), `data/level-sfx-banks.json`.

##### Paths tried on this region

| Approach | Result | Why it failed |
|----------|--------|---------------|
| Flat 40-byte standalone 1bpp icons, "692 icons" | Wrong | A single colour bitplane of a real image reads as a clean 1bpp bitmap; also swept up ~8 KB of PCM per file |
| Flat 280-byte 7-plane icons, colour-diversity boundary, "92 icons" | Wrong | Right *family* (mask+6bpp EHB, 16 px wide) but wrong stride (icons are three nested sizes 280/210/154, not uniform 280) and the boundary heuristic mislabelled the PCM bank as "noise" rather than audio |
| Re-RLE-decompress from the stream end | Rejected | Yields 256–4179 B from 197–1699 B consumed, inconsistent across files; no tiling |
| Cookie-cut invariant scan (`OR(colour planes) ⊆ mask`) over the 1932 B head at every even offset, bpr = 2 and 4, h = 6..40 | 0 non-trivial hits | These decorations' colour planes carry 1-bits *outside* the mask (drawn on a 1s background); the blitter cookie-cuts them away, so the invariant does not hold here even though the layout is mask+6bpp |
| Row-stride autocorrelation for a bitmap row length | No peak at 46/92/138/161/276/322/483 | The 644 block is three differently-sized sprites, so there is no single row stride; only 644 and 1288 peak |
| Search for a per-sample sound offset/length table | Not found | See "Open" above |

#### Animation frames

Entries sharing the same `data_offset` are **the same image**, not sub-frames:
a `0x0100`/`0x0500` pair is the normal and mirrored (left/right-facing) view of
one pose, reusing identical pixel data. There are 42 directory slots but only
10–24 distinct images per file.

> **Correction:** the earlier note that entries sharing `data_offset` should be
> split into N sub-frames by dividing `height` evenly (yielding "495 frames") is
> **wrong**. The 7×plane_size tiling proof shows each `data_offset` block holds
> exactly one full-height image, and reference renders confirm a single creature
> fills the full stated height (e.g. bcdfb `off=0` is one 96×129 Two Head).

#### Verified Sprite Table (bcdfb, map 1)

| data_off | W×H | plane_size | Monster |
|---------:|-----|-----------:|---------|
| 0      | 96×129 | 1548 | Two Head |
| 10836  | 96×124 | 1488 | Two Head |
| 21252  | 96×126 | 1512 | Two Head |
| 31836  | 64×79  | 632  | Two Head (distant) |
| 36260  | 64×81  | 648  | Two Head (distant) |
| 40796  | 48×52  | 312  | Two Head (far) |
| 42980  | 48×53  | 318  | Two Head (far) |
| 45206  | 64×71  | 568  | — |
| 49182  | 96×83  | 996  | Rock Eye |
| 56154  | 64×55  | 440  | Rock Eye (distant) |
| 59234  | 64×55  | 440  | Rock Eye (distant) |
| 62314  | 64×55  | 440  | Rock Eye (distant) |
| 65394  | 32×32  | 128  | projectile / effect |
| 66290  | 16×17  | 34   | projectile / effect |

#### Reference Extractor

`extract_monsters_v2.py` — reads the directory, decompresses from
`STREAM_START = 1402`, renders mask + 6 planes through the EHB palette, and
asserts the length self-check. Zero unknown palette indices across all 204
sprites.

#### Monster sprite clustering (maps 2-13) and name resolution — **rendered / partly confirmed**

Map 1's 14 sprites are grouped and named via a 100% DOS `clipper.clp`
silhouette match (see above). The other 12 files' 190 sprites had no such
cross-reference, so which directory entries are different render-distance/
mirror views of *one* creature vs. genuinely different creatures sharing a
file was undetermined. `scripts/cluster_monster_names.py` now answers this
and writes `public/assets/blackcrypt/amiga/data/monster-names.json`
(`{index, name, frames}` groups, every one of the 204 `sprites/monsters.json`
frame names covered exactly once).

**Method.** Within one file, entries are already sorted by `data_off`
(`extract_monsters.py`'s own dedup order). A creature's near/mid/far/mirror
poses turn out to be stored as a *contiguous run* with non-increasing
bytes-per-plane (`bpr`, proportional to rendered area) — confirmed by the
already-verified map 1 table (Two Head's 7 entries run `1548→...→318`
bpr before Rock Eye's block starts at `996`, a rebound). The segmenter starts
a new cluster at entry `i` iff `bpr[i] > 1.4 * max(bpr[i-1], bpr[i-2])` — a
**local** rebound test, not a global running minimum (a global-minimum
version was tried first; see Paths tried below).

**Calibration/validation, cheapest first:**

1. Applied with no map-1-specific tuning, the rule reproduces map 1's own
   confirmed split exactly: Two Head (7) / the "—" unidentified 64×71
   singleton / Rock Eye + tail (6, offsets 49182→66290 — the same set the
   existing doc leaves merged).
2. Per-map cluster **count** matches the bcdfb-n header's own "Graphics &
   sound effects ID" count (the number of distinct monster types the game
   says are on that level) for **12 of 13 maps** (2-8, 10-13). Only map 9
   mismatches (3 clusters found vs. 2 known IDs).
3. Every map's clusters were rendered to a contact-sheet PNG (one thumbnail
   per sprite, grouped/labelled by cluster) and visually inspected. All 12
   matching-count maps render as internally consistent creatures — e.g. map 2:
   a grey ogre-gorilla (7), a green horned beetle (4), a horned orange/gold
   caterpillar (10); map 7: a ram-horned minotaur warrior (10) + one
   standalone giant magenta-accented rock/gargoyle face (1); map 11: a
   skull-and-snakes gorgon-like creature (10), a hooded wraith (4), a
   grey robed statue-guardian (3). Recolour pairs are common and expected
   (e.g. map 3's clusters 0/1 are the *same* floating horned demon-face
   shape in red/pink vs. grey/silver — two distinct known IDs, not a
   clustering error) and are called out as such rather than merged.
4. Map 9's mismatch was root-caused by the same visual check: its 3rd cluster
   split into a 2-entry block (a front-view pose, chest emblem visible) and
   an 8-entry block (profile-view poses) of what the render shows is **one**
   red crab/lobster-humanoid (yellow eyes, brown claws, segmented shell) —
   the bpr jump between "front pose 2" and "profile near pose" crosses the
   1.4x threshold by coincidence. Fixed with one hardcoded merge in the
   script (`mapno == 9`); after the merge map 9 also matches its known count
   of 2.

**Confidence:** high for the clustering itself (matches known ID counts
12/13 before any correction, and every cluster renders as a coherent single
creature on visual inspection) — treat as *rendered*, not *confirmed*, since
there's no byte-exact oracle (unlike the DOS cross-reference used for map 1).

> **Correction (2026-08-02) — map 1 was over-split into four clusters; it has
> two.** The segmenter's map-1 output ("Two Head 7 / unidentified 64×71
> singleton / Rock Eye 4 / projectile 2") is now settled byte-for-byte by DOS
> `clipper.clp`'s own **developer-authored entry names**, which nobody had read
> before: its `Start Monsters` … `End Monsters` bracket holds exactly 14
> entries, **7 per creature**, named `<creature> <tier> <facing>` plus `A n`
> attack poses:
>
> ```
> Rock Eye 1 N   Rock Eye 1 E   Rock Eye 1 S   Rock Eye 2 S
> Rock Eye 3 S   Rock Eye A 0   Rock Eye A 1                 (7)
> Two Head 1 S   Two Head 1 E   Two Head 2 S   Two Head 2 E
> Two Head 3 S   Two Head 3 E   Two Head A 0                 (7)
> ```
>
> The Amiga store likewise holds 7 + 7, so the trailing three "clusters" are
> **all Rock Eye**: the 64×71 singleton is the mid-size open star-eye and the
> 32×32 / 16×17 "projectiles" are the closed stone ball at far range — visible
> on the render. `MAP1_GROUPS` in `scripts/cluster_monster_names.py` is
> corrected accordingly. **Consequence:** cluster count now equals the header's
> graphics-ID count for **13/13** maps, not 12/13-plus-map-1-at-4-vs-2. That
> upgrade is what makes the positional ID binding below safe to assert.
>
> The `A n` convention also explains the one frame per creature that sits
> *outside* the near/mid/far width ladder (Rock Eye's 96×83, Medusa's 112×112,
> Estoroth's 144×128): those are attack poses.

##### Map ↔ dungeon-level mapping — **confirmed**

A `bcdfs` "map" is a **load unit**, not a dungeon level: the game has **28**
levels (per the official Manual & Clue Book) across 13 maps, and each square's
own **4-bit level nibble** says which level it belongs to. Nibble *k* is that
map's *k*-th level, counting up in file order; nibble **0** means "belongs to
no level" (sealed chambers, the prototype row, inter-level filler).

| Map | File | Levels | | Map | File | Levels |
|-----|------|--------|-|-----|------|--------|
| 1 | bcdfb | 1, 2 | | 8 | bcdfi | 20 |
| 2 | bcdfc | 3, 4, 5 | | 9 | bcdfj | 21, 22 |
| 3 | bcdfd | 6, 7, 8, 9 | | 10 | bcdfk | 23 |
| 4 | bcdfe | 10, 11, 12 | | 11 | bcdfl | 24, 25, 26 |
| 5 | bcdff | 13 | | 12 | bcdfm | 27 |
| 6 | bcdfg | 14, 15 | | 13 | bcdfn | 28 |
| 7 | bcdfh | 16, 17, 18, 19 | | | | |

**How it was established** (`scripts/` probes, clue book as oracle). The clue
book annotates each level with numbered notes carrying explicit
`(x, y, LEVEL)` coordinates. Two independent checks:

1. **Structure-at-coordinate match.** For every clue-book note of the form
   "*DOOR / PILLAR / ALCOVE / TELEPORT / PLATE / SWITCH / PIT / FOUNTAIN /
   PLAQUE / GLYPH / STAIRS / STATUE* … `(x, y, L)`", test whether the candidate
   `bcdfs` region holds a structure record of the matching type at
   `col = x + region_min_col`, `row = y + region_min_row`. Scanning every
   region × every offset, the winning region for each level is unambiguous and
   always lands at exactly the region's own origin: **level 4 → map 2 nibble 2
   at 46/54 notes**, level 14 → map 6 nibble 1 at 21/28, level 7 → map 3
   nibble 2 at 15/31, level 10 → map 4 nibble 1 at 14/23, level 13 → map 5
   nibble 1 at 13/42, level 24 → map 11 nibble 1 at 10/24, level 16 → map 7
   nibble 1 at 10/16, level 5 → map 2 nibble 3 at 6/7, level 1 → map 1
   nibble 1 at 4/5. (The residue is OCR noise and notes whose coordinate names
   a *destination*, not the annotated object.)
2. **Cross-reference containment.** Under this mapping, of the **338**
   coordinate references a level's legend makes to some level, **336 (99.4%)
   target a level on the *same* map**. The only two exceptions are the two
   places the clue book itself describes a map transition: level 12's
   "STAIRS TO (17,21,13)" and level 22/23's Waterlord key. A dungeon-level
   grouping *is* a load unit, so this is the invariant that pins it.

The per-map level counts fall out at exactly **2+3+4+3+1+2+4+1+2+1+3+1+1 = 28**,
and the clue book's own page layout corroborates the two biggest groups (one
page headed "LEVELS 16—17—18—19" for map 7's four nibbles, one headed
"LEVEL 22, 23" for map 9's two).

##### Cluster → graphics-ID binding — **confirmed**

**Cluster *i* (by `data_off` order) is header graphics ID *i*** (`+4/+6/+8`,
in file order — see the correction above). Evidence:

- **Ground truth**: map 1's `+4` is `0xb2`, and cluster 0 is Two Head, whose
  identity comes from the DOS labels. ✓
- **The 214-byte secondary table.** Its **trailing 72 words** are `3 × 12`
  pairs = **3 creature slots × (3 distance tiers × 4 facings)**, each pair
  roughly `(sprite width, 0.85 × sprite height)`. Reading slot *i* against
  cluster *i* matches on every map where the clusters differ in size, and the
  degenerate slots land exactly where they should:

  | Map | Slot | Value | Cluster it lands on | Why it is decisive |
  |-----|------|-------|---------------------|--------------------|
  | 4 | 2 | `(136, 88)` constant, all 12 | C — 2 frames, `160×90` + `112×104` | The only map-4 cluster with no distance ladder; 136 = mean of 160 and 112 |
  | 7 | 1 | `(190, 83)` constant, all 12 | B — 1 frame, `192×103` | 190 vs 192 |
  | 11 | 2 | **all zero** | C — the 3 `64×100` statue figures | `0xbd` owns **zero** monster records anywhere; a creature with no placement gets no hitbox ladder |
  | 11 | 0 | `(80, 83)` / `(110, 83)` | A — `80×84`, `112×84` | exact width match |
  | 2 | 2 | `(72,57)/(80,51)/(96,53)` | C — `96×69`, `80×70`, `80×67` | exact width match |
  | 1 | 0 | `(88,104)…(100,105)` | Two Head — `96×129/126/124` | ✓ against DOS ground truth |

- **Behavioural cross-check.** Map 7's cluster B is the single `192×103`
  stone-face sprite; the binding assigns it `0xb9`, and **9 of `0xb9`'s 10
  `bcdfs` records carry movement type 1 = "stationary"** while **0 of `0xb5`'s
  9 records do**. A one-pose, never-moving monster is exactly what a stationary
  movement type predicts. Likewise map 11's `0xc6` (cluster B, the hooded
  wraith) is movement type **2 = teleport** on 16 of its 17 records, while
  `0xbe` (cluster A, Medusa) is not.

##### Creature names from the Manual & Clue Book — **confirmed**

The official *Black Crypt Manual & Clue Book* (64-page scan; no text layer,
OCR'd per page with `tesseract`) is the oracle the earlier passes lacked. It
names creatures **per dungeon level**, which the mapping above turns into a
per-`bcdfb`-n-file, per-cluster name. Eleven clusters (90 of the 204 sprites)
now carry a real name, up from four clusters / 31 sprites.

| Cluster | gfx | Level | Name | Evidence |
|---------|-----|-------|------|----------|
| map 1 A | `b2` | 2 | **Two Head — "the Ogre"** | DOS entry label `Two Head …`; the record carries the game's **only** `EMERALD KEY` (1/1 corpus-wide), and epilogue panel 1 reads *"THROUGH INCREDIBLE BRAVERY AND THE USE OF THE POWERFUL OGREBLADE, YOU DEFEATED **THE OGRE** AND RETRIEVED **THE EMERALD KEY**"*. `OGREBLADE` is the level-1 alcove sword (clue book L1 note 21). The journal at S_1 `+0x1A87F`… independently calls it *"THE TWO HEADED BEAST"* |
| map 1 B | `b3` | 1, 2 | **Rock Eye** | DOS entry labels `Rock Eye 1 N … A 1` (7 = 7) |
| map 4 C | `50` | 10 | **Dragonlich** | Clue book L10 note 10: *"THREE ALCOVES: PLACE IDOLS OF TEMIN HERE TO OPEN THE WAY TO THE **DRAGON LICH** (WALL 12,26,10)"*; note 43 *"DRAGON LICH; PRESSURE PLATE TO OPEN WALL"*. Epilogue panel 3: *"USING **3 EVIL IDOLS**, YOU SUMMONED AND DEFEATED THE DREADED **DRAGONLICH**"*. In-game plaque: *"THREE EVIL IDOLS / ALL IN ONE ROOM / ENTER THE **DRAGONKING** / BRINGER OF DOOM"*. `0x50` has **no static placement** — its only record is the row-0 prototype — which is exactly what "summoned" predicts. Sprite: a winged skeleton |
| map 6 B | `b8` | 14 | **Possessor Demon** | (previously established via the unique movement-type-5 record) **plus** a new independent confirmation: it carries the game's **only** `SOUL KEY`, and clue book L15 note 2 reads *"LOCKED DOOR: **POSSESSOR HAS THE KEY** AND MUST BE KILLED FOR IT (WILL THEN DROP DEATH GEMS OF DEAD PARTY MEMBERS)"* |
| map 7 A | `b5` | 17 | **Ram Demon** | Clue book L17 note 2: *"**RAM MINOR DEMON** - HOLDS KEY TO DOOR AT (10,4,17)"*. `0xb5` at level-17 local (19,8) is the **only** key-carrying monster on level 17 (an `IRON KEY`). Sprite: ram-horned minotaur. Plaque: *"THE **RAM DEMONS** FEED OFF THE ENERGY OF THE SPELLS YOU CAST"* |
| map 8 A | `b6` | 20 | **Ram Lord** | Clue book L20 note 2: *"**RAM LORD** - HOLDS **KEYS TO TWO LOCKED DOORS** AS WELL AS **AMULET OF POWER** (+2 AC, +4 STRENGTH), AND **BELT OF SUSTENANCE**"*. The 550-HP record's carried sub-chain is, byte for byte, `BELT OF SUSTENANCE` (type `0x19`) + `AMULET OF POWER` (`0x1A`) + `PIN KEY` + `PIN KEY` (`0x06`×2). The belt and the amulet are each **1/1 corpus-wide**. This is the epilogue's *"THE MIGHTY RAM DEMON"* and the taunt text's *"MY RAM GENERAL"* |
| map 10 A | `bc` | 23 | **The Great Waterlord** | Clue book L23 note 3: *"**WATERLORD**, HOLDS KEY TO DOOR AT (4,5,23), AND **RING OF LOCATION**"*. The 375-HP record — the only monster on the whole map — carries `RING OF LOCATION` + `GOLD OCTA KEY`. Manual p. 27 describes the first lieutenant as *"a silent, man-sized beast from the sea. His blue-green skin flashed like abalone"*; sprite: a green amphibian with a trident |
| map 11 A | `be` | 24 | **Medusa** | Level 24 is the Medusa level throughout: note 16 *"SPECIAL PANELS (3) - **MEDUSA SKULL AND SNAKES**"*, note 31 *"**MIRROR SHIELD** (USED TO KILL MEDUSA)"* (1/1 corpus-wide), note 18 *"PREVIOUS ADVENTURERS WERE PLACED HERE WHEN TURNED TO STONE"*. `0xbe` is the **only** unique monster on level 24 (1 record, 150 HP, vs `0xc6`'s 17). Sprite: a skull with snakes for hair — matching manual p. 27 *"A skinless creature with hair of snakes"* — and the plaque *"THE **SKULL OF STONE** / LIKE ALL EVIL / CAN NOT LIVE IN / TRUE REFLECTION"* |
| map 11 C | `bd` | 24 | **Statue (petrified adventurer)** — *not a creature* | `0x00BD` is the **Statue** structure's `gfxNumber` (structure type table above). Map 11 is the **only** map in the game with type-`0x2F` records — **9** of them, all on level 24, the "turned to stone" room. `0xbd` owns zero monster records and its 214-byte slot is all zeros |
| map 13 A | `c5` | 28 | **Estoroth Paingiver** | The only monster on the final level; epilogue panel 10 *"A FINAL, LIFE AND DEATH BATTLE WITH ESTOROTH HIMSELF"*; already special-cased in code as gfx word `0x80C5` (see the BCSPEED effect-93 entry). Level 28's alcoves hold the `WAND OF ESTOROTH` |

**All six of `bcdfu`'s epilogue bosses are now placed**: Ogre (map 1),
Dragonlich (map 4), Possessor Demon (map 6), Ram Demon/Ram Lord (maps 7 & 8),
Great Waterlord (map 10), Medusa (map 11).

###### Corrections to the previous unconfirmed-lead table

| Old lead | Verdict | Why |
|---|---|---|
| Medusa = **map 11** cluster A | ✅ **right, now confirmed** | Level 24 is on map 11 and `0xbe` is its only unique monster |
| Great Waterlord = **map 9** cluster A | ❌ **refuted** | The Waterlord is on **level 23 = map 10**, not levels 21/22 = map 9. Map 9's blue-green mermen are the *regular* guards of the water/brig levels; the clue-book note that names the Waterlord sits in the **right-hand column** of the two-column page 54, i.e. under `LEVEL 23`, not `LEVEL 22` |
| Ram Demon = **map 7** cluster A | ✅ **right for the lesser demon**, and extended | Map 7 = levels 16-19 holds the "Ram Minor Demons"; the unique **Ram Lord** ("THE MIGHTY RAM DEMON") is a *different* file, **map 8** = level 20 |
| Dragonlich = **map 4** cluster C, on the strength of "the only single-record, highest-HP monster on map 4 — a genuine unique-boss signature" | ✅ **right cluster, wrong reason** | `0x50`'s single record is a **row-0 prototype**, not a placement — the "unique boss signature" was an artefact. The real reason it has no placement is that the Dragonlich is *summoned* by the three Idols of Temin, which the clue book and the epilogue both state |
| Ogre = "no candidate identified" | ❌ **refuted** | It is **Two Head**, map 1 — the only carrier of the game's only `EMERALD KEY`, which the epilogue explicitly says is taken from the Ogre |

##### Still open (naming)

Fifteen clusters / 114 sprites remain placeholder-named. There is **no**
creature-name table in the game data, and the clue book names creatures only
where a note needed to (a key-holder, a boss). The remaining clusters are
monsters the clue book never names. Each now carries its **confirmed graphics
ID and dungeon levels** in `monster-names.json`, which is as far as the
available oracles go. Two weak, deliberately-unapplied leads:

- map 2 cluster A (`0x4f`) is the **only** movement-type-3 ("thief") creature
  in the 265-record corpus (4 of its 5 records), and the in-game journal says
  *"THE THIEF TOOK MY SWORD AS HE VANISHED INTO THIN AIR"* — suggestive, but
  "thief" is a behaviour label from the field table, not a name.
- DOS `clipper.clp` has a floor-item entry named `Clawpiller Mask`, and map 2
  cluster C renders as a horned caterpillar — but the Amiga item list has no
  such string, and an item named after a creature is not a creature name.

**Naming (superseded).** Only one new name was resolved beyond geometry: **Possessor
Demon**, map 6, both of its clusters (10+10, identical dimensions —
recolours of one base sprite). `bcdfs`'s monster stat records hold exactly
**one** entry, in the entire 265-record corpus, with movement-type byte
`+0x0F == 5` ("Possessor" — a value already named in the documented
monster-bytecode field table) — at map 6 gfx ID `0xb8`. Independently,
`bcdft`'s taunt text names `"THE POSSESSOR"` in prose (decompressed S_1
offset `0x1C026`), and `bcdfu`'s ending-epilogue text independently names a
defeated boss `"THE EVIL POSSESSOR DEMON ..."` outright. Map 6's other gfx ID
(`0xb7`) is already documented above as the generator-spawned,
identically-dimensioned recolour of the same sprite (no static placement, 0
records in the census), so both clusters are labelled Possessor Demon /
"Possessor Demon (recolour variant)". This is a structural (movement-type
census) + double-independent-text match, not a literal name-pointer, so it
is **not** given the same confidence as the DOS-cross-reference names — call
it high-confidence but short of "confirmed".

> **Superseded (2026-08-02):** the sentence that used to follow — "everything
> else beyond map 1 and map 6 is a geometry-only placeholder" — held only
> because no oracle outside the game files had been tried. Nine further
> clusters are now named from the official Manual & Clue Book; see
> "Creature names from the Manual & Clue Book" above. The map-6 reasoning in
> this subsection is still correct and is now independently corroborated by the
> Possessor's `SOUL KEY`.

##### Paths tried (sprite clustering)

| Approach | Result | Why it failed / was superseded |
|----------|--------|--------------------------------|
| Pixel-content similarity (crop-to-mask-bbox, pad-to-square, resize, IoU + colour correlation) between every sprite pair in a file | Rejected as the primary signal | Confirmed same-creature pairs (map 1's Rock Eye near vs. far, ground truth) scored *lower* (~0.47-0.54) than some confirmed different-creature pairs, because near/far poses in this game are separately hand-drawn, not scaled copies — shape/colour correlation is too weak a same-creature signal here. Still useful as a spot-check, not a clusterer |
| Width-only ratio boundary (`width[i] > 1.3 * running-block-min-width`) | Mostly right, two failure modes | (a) `48→64` width steps *within* one creature's own near-tier (e.g. map4's `128,112,128,64,80,...`) sat right at the threshold and were sensitive to its exact value; (b) a **global running minimum** lets one very small "far" outlier lock in a floor that makes a later, still-legitimate same-creature value look like a big jump (false split, e.g. map 10's `...,32,48,32` far-tier zigzag) |
| bpr (byte-per-plane, ~ rendered area) with a **global running-minimum** floor, factor swept 1.3-1.6 | Same false-split failure mode as width-global-min | Confirmed on map 9 (5 blocks vs. 2 known) and map 11 (5-6 vs. 3 known) at every factor tried; switching to a **local** 2-entry-window rebound test (not a global floor) fixed both while keeping map 1/3/4's correct splits |
| Trusting the header's per-file known-ID count as an exact target and forcing that many clusters | Not used as-is | It's the right *validation* signal (matched 12/13 maps) but not a splitting rule on its own — it doesn't say *where* to cut, and one map (9) needed the geometric segmenter's own output plus a visual check to reconcile a genuine off-by-one |

##### Paths tried (naming)

| Approach | Result | Why it failed / was superseded |
|----------|--------|--------------------------------|
| Exhaustive string/table search of decompressed `bcdft` S_1 + S_2 and `bcdfs` for an indexed bestiary | **Confirmed negative — do not repeat** | No array-of-pointers or fixed-stride name table keyed by the graphics ID exists; every creature-adjacent string is prose. See "Bestiary name table search" above |
| Matching epilogue boss names to clusters on visual/thematic grounds | 3 of 5 right, 2 wrong, none provable | Correct for Medusa and the Ram Demon, **wrong** for the Great Waterlord (map 9 vs. the real map 10) and silent on the Ogre. Visual plausibility alone cannot distinguish "the aquatic boss" from "the aquatic mooks on the level before it" |
| "Unique boss = the map's single-record, highest-HP graphics ID" | Produced the right Dragonlich answer for the **wrong reason** | The single record was a **row-0 prototype**, not a placement. The signature is an artefact of not checking the record's square; see "Row 0 is a prototype row" |
| Assuming the `bcdfb`-n header's three graphics IDs are stored sorted | Wrong, and it discarded the binding | They are in sprite-store order (`bcdfj` = `c4,bf`, `bcdfl` = `be,c6,bd`). The earlier doc table sorted them, which silently destroyed the cluster↔ID mapping the field exists to provide |
| Assuming one `bcdfs` map == one dungeon level | Wrong — and it is what blocked naming for a whole pass | The game has **28** levels in **13** maps; each square's 4-bit level nibble picks the sub-level. Until that was worked out, per-level clue-book facts could not be attached to a sprite file at all |
| Reading the 214-byte secondary table as a palette or an animation table | Neither | It is `17 head pairs + 3 × 12` per-creature hitbox pairs (`≈ width`, `≈0.85 × height`) over 3 distance tiers × 4 facings. Useful as a **cluster↔ID oracle**, which is how it is used above |
| OCR of the clue book's *map images* (as opposed to its legend text) | Unusable | The maps are dense grid art; `tesseract` returns noise. All the mapping work was done from the legends' `(x,y,LEVEL)` coordinates, which OCR cleanly |

##### Bestiary name table search (bcdft / bcdft S_2 / bcdfs)

Searched for a monster bestiary / creature-name table indexed by the same
"Graphics & sound effects ID" byte that drives the sprite-file headers and
the monster stat records, and for any code path indexing such a table by
that field.

**What was checked:**

- Full `strings` dump of decompressed `bcdft` S_1 (166,676 B). Its *only*
  readable-text region is offsets **`0x1A87F`–`0x1DA34`** (≈12.8 KB, ends where
  the file returns to 68k code/binary noise on both sides — every string
  outside this range that superficially looked like a name (e.g. `XORC`,
  `TORB`, `RDRB`) is a coincidental opcode-byte pattern, not text). Its
  contents, in order: **32 spell names** (`LIGHT`, `HEALING I`, ... `STONE TO
  FLESH`), **4 class names** (`FIGHTER CLERIC MAGIC USER DRUID`), ~40
  riddle/quest-journal entries (in-fiction diary pages, one of which reads
  `"...TO ATTACK THE TWO HEADED BEAST HE IS FAR TO STRONG..."` — an
  independent third corroboration of map 1's already-confirmed "Two Head"
  name), a set of "Estoroth" boss-taunt lines naming a few creatures in prose
  (`"MY RAM GENERAL"`, `"MY BEAUTIFUL MEDUSA"`, `"THE POSSESSOR"`,
  `"THE RAM DEMONS"`), and a ~340-entry unique/magic-item name list
  (`"OGRE BLADE"`, `"DEMON DICER"`, ... — this is the table the existing
  "abandoned bcdft string-table approach" note already describes; item, not
  monster, names).
- `bcdft` S_2 (40,808 B, the `A4` small-data segment): its only strings are a
  QWERTY keyboard-remap table, unrelated.
- `bcdfs` (the dungeon map/entity file): no readable strings at all.
- `BlackCrypt` (main executable) and `bcdfp/q/r/v`: no monster-keyword string
  hits.
- `bcdfu` (epilogue overlay): **does** contain readable boss text — a
  victory-epilogue block naming defeated "lieutenants" in sequence: `OGRE`
  (associated with `OGREBLADE`/Emerald Key), the `DREADED DRAGONLICH`, `THE
  HIDEOUS MEDUSA`, `THE EVIL POSSESSOR DEMON`, `THE GREAT WATERLORD`, and
  `THE MIGHTY RAM DEMON` — six named unique bosses total.

**Conclusion: no indexed bestiary table exists in any of these files.**
Every creature-adjacent string found is prose (quest riddles, boss taunts, an
ending epilogue), not an array addressable by monster/graphics ID, and no
code path indexing a string table by that ID field was found (none of the
regions above have the array-of-pointers or fixed-stride-record shape the
confirmed item-name tables have).

> **Superseded (2026-08-02) — all five of these are now settled.** The
> conclusion above (no in-file bestiary table) still stands and does not need
> re-testing; what was missing was an oracle *outside* the game files. The
> official **Manual & Clue Book** names creatures per dungeon level, and with
> the map↔level mapping established (see "Map ↔ dungeon-level mapping" above)
> that resolves every one of the six epilogue bosses. Three of the five leads
> below were right, two were wrong; see "Corrections to the previous
> unconfirmed-lead table" above for the per-row verdict. The table is kept as
> the record of what the reasoning looked like before the oracle arrived.

**Unconfirmed leads (deliberately not applied to `monster-names.json`).**
`bcdfu`'s 6 epilogue boss names are plausible matches for some of the
geometry clusters on thematic/visual grounds, but none has the kind of
structural link that resolved "Possessor Demon" (map 6) — no HP/movement-type
outlier, no unique single-instance record, or an outlier that doesn't
resolve to a single map/cluster cleanly:

| Epilogue name | Candidate | Basis | Why not applied |
|---|---|---|---|
| Medusa | Map 11 cluster A (10 sprites) | Visual: skull head with snake-like radiating limbs; textual: "MY BEAUTIFUL MEDUSA" taunt | Thematic/visual only — no HP/movement-type/gfx-ID outlier found linking it specifically |
| Great Waterlord | Map 9 cluster A (10 sprites) | Visual: blue-green merman with a trident, clearly aquatic | Same — map 9's two gfx IDs (`bf` n=13, `c4` n=28) are both common "regular" record counts, no unique-boss signature |
| Ram Demon / Ram General | Map 7 cluster A (10, ram-horned minotaur) and/or cluster B (1, standalone 192×103 rock/gargoyle face) | Textual: "THE RAM DEMONS", "MY RAM GENERAL", "THE MIGHTY RAM DEMON" | Map 7's two gfx IDs (`b5` n=9, `b9` n=10, HP up to 300) are both multi-instance — no clean 1:1 "this is the unique Ram General" signal, and cluster B doesn't look ram-themed at all |
| Dragonlich | Map 4 cluster C (2 sprites, giant winged skeletal figure, gfx `0x50`) | Structural: `0x50` is the **only** single-record (n=1), highest-HP (220 vs. 65-110/25-95 for the map's other two IDs) monster on map 4 — a genuine unique-boss signature; visual: skeletal + winged fits "lich" imagery | Held back anyway — the HP/singleton signature is solid, but "Dragonlich" specifically (vs. some other unique) is still a narrative inference, not a name pointer. Closest of the five to being upgradable; worth a closer look if more evidence turns up |
| Ogre | — (no candidate identified) | Textual only (`OGREBLADE`/Emerald Key) | No visually ogre-like cluster or HP outlier stood out among the reviewed contact sheets |

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
    BEQ.S   LAB_0047        ; 0x00 = end of stream  → RTS
    LSR.B   #1,D0           ; D0 = count = byte >> 1; C = original bit0
    BCC.S   LAB_0045        ; bit0=0 → fill
    SUBQ.W  #1,D0           ; literal: adjust for DBF
LAB_0044:
    MOVE.B  (A0)+,(A1)+     ; copy literal byte
    DBF     D0,LAB_0044
    BRA.S   LAB_0043        ; next control byte
LAB_0045:
    MOVE.B  (A0)+,D1        ; fill: read fill byte
    SUBQ.W  #1,D0           ; adjust for DBF
LAB_0046:
    MOVE.B  D1,(A1)+        ; write fill byte
    DBF     D0,LAB_0046
    BRA.S   LAB_0043        ; next control byte
LAB_0047:
    RTS                     ; end of stream
```

#### Properties

- Stream-oriented; `0x00` terminates the stream (the decompressor `RTS`es —
  it does **not** skip the byte and continue). A file containing several
  payloads has several streams, each ending in its own `0x00`.
- Each command produces 1–127 bytes
- Edge case: a control byte of `0x01` or `0x02` gives count 0; `SUBQ.W #1,D0`
  wraps to `0xFFFF` and the `DBF` loop runs 65,536 times. The compressor never
  emits these, but a port should guard against it.
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

> **Correction:** there is **no** 32-byte header. RLE decoding starts at
> **offset 0** in all three files and produces valid output immediately
> (bcdfx/bcdfz → 14,448 bytes for payload 1). The bytes previously read as a
> header are simply the first RLE commands, which happen to encode a
> `ff f0 / ff e0 / ff c0 …` mask ramp — that ramp is *decoded content*, not a
> header. The payload boundary tables below already list payload 1 at offset 0,
> which is correct.

bcdfx and bcdfz decompress to **identical block sizes** for their first six
payloads (14,448 / 42,754 / 55,536 / 10,780 / 11,580 / 11,580), confirming they
are two instances of the same asset type with different content. bcdfy's first
few streams look like a different, much smaller layout (632 / 11,074 / 1,532 /
461 / …), but that is only the *start* of the file, not the whole thing.

> **Correction:** "bcdfy has a different layout … and is mostly `0xFF` fill"
> was based on reading only its first 4 of 178 RLE streams and stopping. The
> full stream census (below) finds two of bcdfy's 178 streams — stream 44
> (raw offset 48,725, decompressed 55,536 B) and stream 45 (raw offset 90,441,
> decompressed 12,460 B) — that are byte-size-exact matches for bcdfx/bcdfz's
> front-wall/ceiling/floor payload and masked-pillar payload respectively.
> Applying the identical confirmed sub-image offset tables (below) decodes
> both cleanly (no short-data truncation) into 8 coherent sub-images — a
> **third, distinct dungeon tileset**, not filler. See "bcdfy — a third,
> partial tileset" below for the full evidence and what is still missing.

Scans of all three for 32-word `$0RGB` blocks — word-aligned and
byte-offset — found **no palettes**.

#### Multi-payload structure

Each file contains multiple RLE-compressed payloads separated by `0x00` stream
terminators.

> **Correction (supersedes the whole "confirmed dimensions" table that used to
> sit here).** Every geometry in that table was wrong, and none of it had ever
> been checked against an external oracle — the "Confirmed" labels came from
> eyeballing greyscale renders of RLE output, exactly the
> `rle-decode-succeeds-on-garbage.md` trap. What was wrong:
>
> - **A payload is not one image.** Each graphical payload is a *sequence of
>   independent sub-images*, each with its own width, height and plane count,
>   stored back-to-back with no header, index or separator. A per-window
>   row-stride autocorrelation over `bcdfx` P2 shows the byte row stride
>   *changing* along the payload (22 B → 14 B → 8 B → 10 B → 26 B), which no
>   single-image geometry can produce.
> - **"P2 = 208×356" was a byte-count coincidence** that happens to equal the
>   five real sub-images' total. Decoding it as one 208×356 image (what
>   `render_all.py` did) mixes five images' bitplanes together and renders
>   noise.
> - **"P4/P5 = 80×193 left/right wall sides" was wrong twice over** — the two
>   payloads are not the same shape as each other (P4's rows are 14 B, P5's
>   are 12 B) and neither is a wall side.
> - **"P3 = 320×269 1-bit" cannot be right at all**: 320/8 × 269 = 10,760 ≠
>   10,780. The claimed geometry does not even fit the byte count.
>
> The oracle that cracked it is the Windows/DOS port, already extracted in this
> repo: `public/assets/blackcrypt/dosvga/sprites/dungeon.json` is a **76-entry
> named dungeon-graphics manifest with exact per-image dimensions** (`Wall 0`,
> `Wall 1`, `Wall 2`, `Ceiling`, `Floor 1/2`, `Alcove A–E`, `Plaque A–E`,
> `Pillar A–C`, `Door Type 0/1 - 1/2/3`, `Stairs`, …). See "Sub-image layout"
> below.

#### Dungeon palette — five variants in bcdfu (confirmed, live capture)

> **Correction:** "there is no separate dungeon palette, the bcdfq `game`
> palette at file offset `0x2C6` covers monsters, walls and floors" is right
> for **26 of its 32 entries and wrong for the other six**. A live Amiberry
> capture with a dungeon view on screen — `COP1LC` read from the custom
> registers, then the copper list decoded instruction by instruction
> (WAIT, DMACON, eight sprite pointer pairs, then 32 consecutive `MOVE`s to
> `COLOR00`–`COLOR31` at `$180`–`$1BE`, no gaps) — gives a palette that matches
> bcdfq `game` **byte-for-byte for COLOR00–COLOR25** and differs completely for
> **COLOR26–COLOR31**. The game reprograms exactly that six-entry accent ramp
> per dungeon tileset. Because these are base entries, they also drive EHB
> half-brights 58–63, which is where most of the masonry mid-tone lives —
> rendering walls with the unmodified bcdfq tail turns tan sandstone into
> saturated gold.

The variants live in **`bcdfu`** (not, as previously guessed, the
`bcdft`-decompressed "stone/olive ramp" at `0x1E886` — that offset holds
`332 443 654 987 BA8 EEB`, which is variant 2's ramp *copied*, not the source
the dungeon view uses). `bcdfu` holds **five complete 32-word palette records
at a 64-byte stride**, byte-identical in entries 0–25:

| Variant | bcdfu file offset | COLOR26–31 (12-bit `0RGB`) | Appearance |
|---------|-------------------|-----------------------------|------------|
| 0 | `0x03EC` | `432 542 653 764 875 986` | tan sandstone — **live-confirmed** |
| 1 | `0x042C` | `223 334 445 647 858 968` | violet/plum |
| 2 | `0x046C` | `332 443 654 987 BA8 EEB` | bone / warm cream |
| 3 | `0x04AC` | `222 333 444 555 666 777` | neutral grey |
| 4 | `0x04EC` | `234 345 456 678 89A 9AB` | cold blue-grey |

The live-read ramp `0432 0542 0653 0764 0875 0986` occurs **exactly once in the
raw Amiga corpus** — `bcdfu+0x420`.

> **Correction:** that uniqueness was read as "so `bcdfu` is the source". It
> isn't. `bcdft`'s payload is LZ77-compressed, so its copy — the real one — is
> invisible to a byte search. (An *RLE*-compressed copy would have shown up:
> the RLE codec emits literal runs verbatim. LZ77 does not.)

Read them with `bclib.read_dungeon_palette(bcdfu, variant)` — but for dungeon
work prefer the authoritative source:
`bclib.read_dungeon_palette_for_level(bcdft_s1, bcdft_s2, level)`,
`bclib.read_accent_ramp(bcdft_s1, index)` and
`bclib.read_level_ramp_indices(bcdft_s2)`.

> **Correction — `bcdfu` is not the source, and there are 12 ramps, not 5.**
> "Open: which variant each tileset/level selects" is now answered, and two of
> its premises were wrong.
>
> 1. **The five `bcdfu` records are the *endgame/epilogue* screen palettes**,
>    not a dungeon table. They are referenced, exactly and only, by `bcdfu`'s
>    epilogue sequence — see "bcdfu is the epilogue overlay" below. They are a
>    *copy* of the first five entries of the real table.
> 2. **The accent ramp is selected per dungeon *level*, never per tileset.**
>    There is no tileset→palette association anywhere in the code, and the DOS
>    port ships exactly one dungeon tileset (`dungeon.json` has a single
>    `Wall 0/1/2` + `Ceiling` + `Floor` set), so the question "which variant does
>    `bcdfz` use" has no answer as posed — `bcdfz`'s art, whatever it is, is
>    drawn with whatever ramp the *level* it appears on selects.
>
> The real machinery is documented in "Dungeon accent-ramp selection" below.

> **Correction — point 2 above is half wrong: the tileset *file* is also chosen
> per level, and the two per-level tables agree.** "The ramp is selected per
> level" is correct. "There is no tileset→palette association anywhere in the
> code" is **not** — it was concluded from a failed *filename* search (no code
> anywhere opens a literal `"bcdfx"`/`"bcdfy"`/`"bcdfz"` string, because the
> loader patches the last letter of a single `"bcdf?"` template at runtime).
> Once the real loader is found, `bcdfx`/`bcdfy`/`bcdfz` turn out to be selected
> by a **hardcoded per-level range dispatch**, and there is a second per-level
> table whose values are byte-identical to the ramp table for 11 of 13 levels.
> The correspondence is near-bijective:
>
> | Tileset | Levels | Accent ramp(s) |
> |---------|--------|----------------|
> | `bcdfx` | 1–4, 12–13 | **0** (tan sandstone) on 1–4, **3** (neutral grey) on 12–13 |
> | `bcdfy` | 5 only | **1** (violet/plum) — exclusive |
> | `bcdfz` | 6–11 | **2** (bone/warm cream) — exclusive |
>
> So `bcdfy` should be rendered with ramp 1 and `bcdfz` with ramp 2; `bcdfx` is
> the only tileset used under two ramps. See "Dungeon tileset selection" below.

#### Dungeon accent-ramp selection (confirmed)

All of this lives in the **decompressed `bcdft`** image. Two output hunks
matter and both are now produced by `tools/bcdft_decompress`:

| Artifact | Content | A-register base |
|----------|---------|-----------------|
| `bcdft_decompressed.bin` (S_1, 166,676 B) | game code + graphics/string data | — |
| `bcdft_s2_data.bin` (S_2, 40,808 B) | small-data segment: every `x(A4)` global and per-level table | `A4 = S_2 + 0x7FFE` |

`A4 = S_2 + 0x7FFE` is confirmed with zero deviation: across the whole S_1
disassembly the `(d16,A4)` displacements run from exactly `-0x7FFE` (→ S_2+0)
to `+0x1F12` (→ S_2+0x9F10), and S_2 is `0x9F68` bytes — the observed range
fits inside the segment and starts exactly at its first byte.

##### The ramp table — 12 entries × 12 bytes at S_1 `+0x27B00`

`SetDungeonPalette(D0 = index)` at **S_1 `+0x26900`**:

```asm
26900  MOVE.L  A5,-(A7)
26902  MOVEA.L $2099E(PC),A5        ; display-kernel globals
26906  LEA     $27B00(PC),A0        ; accent-ramp table
2690A  MULU.W  #$C,D0               ; 12 bytes (6 words) per entry
2690E  LEA     (A0,D0.W),A0
26914  LEA     $27AF4(PC),A1        ; tail of the live 32-word palette buffer
26918  MOVE.L  (A0)+,(A1)+ / MOVE.L (A0)+,(A1)+ / MOVE.L (A0),(A1)
26920  MOVEA.L $510(A5),A1          ; copper-list COLOR block base
26924  LEA     $6A(A1),A1           ; +0x6A = 26*4+2 = COLOR26's value word
26928  MOVEQ   #5,D0
2692A  MOVE.W  (A0)+,(A1)+ / ADDQ.L #2,A1 / DBRA D0,$2692A
26934  RTS
```

`$510(A5)` is set at **S_1 `+0x1E0E2`** by the dungeon copper-list builder
(`MOVE.L A2,$510(A5)`, then `MOVE.W #$0180,D2 / MOVEQ #31,D0 / {MOVE.W D2,(A2)+;
ADDQ #2,D2; CLR.W (A2)+}`, then `BPLCON0 = $6200` — 6 bitplanes, i.e. the EHB
dungeon view). `0x6A = 26 × 4 + 2` lands on COLOR26's value word exactly, and
the loop writes six words at the 4-byte copper stride → **COLOR26–COLOR31**,
zero deviation.

The live 32-word dungeon palette buffer is at **S_1 `+0x27AC0`**; its shipped
content is **byte-identical to `bcdfu`+0x03EC (variant 0) in all 32 words**.

| idx | ramp (`0RGB` ×6) | Appearance | Also appears as |
|-----|------------------|------------|-----------------|
| 0 | `0432 0542 0653 0764 0875 0986` | tan sandstone — **the default dungeon look** | `bcdfu`+0x03EC; DOS `Palette` + `Automap_Palette` |
| 1 | `0223 0334 0445 0647 0858 0968` | violet / plum | `bcdfu`+0x042C |
| 2 | `0332 0443 0654 0987 0BA8 0EEB` | bone / warm cream | `bcdfu`+0x046C; DOS `Options_Palette`; `bcdft`+0x1E886 |
| 3 | `0222 0333 0444 0555 0666 0777` | neutral grey | `bcdfu`+0x04AC |
| 4 | `0234 0345 0456 0678 089A 09AB` | cold blue-grey | `bcdfu`+0x04EC |
| 5 | `0070 0080 0090 00A0 00B0 00C0` | saturated blue | — |
| 6 | `0050 0060 0070 0080 0090 00A0` | darker blue | — |
| 7 | `0030 0040 0050 0060 0070 0080` | darker still | — |
| 8 | `0020 0030 0040 0060 0070 0080` | near-black blue | — |
| 9 | `0511 0711 0911 0B11 0D11 0F00` | blood red | — |
| 10 | `0711 0911 0A11 0C11 0D11 0F00` | brighter red | — |
| 11 | `0006 0008 0009 000B 000D 000F` | pure blue | — |

The table ends after entry 11: S_1 `+0x27B90` is `48E7 40C0` (`MOVEM.L`), the
start of the next routine. Indices 5–11 are effect ramps (progressive blue
darkening, red flash); which effect drives each is **open**.

##### Selector 1 — per-level default (confirmed)

`$1E62(A4)` (= S_2 `+0x9E60`) holds the current ramp index. On level entry,
**S_1 `+0x02DD0`**:

```asm
02DD0  MOVE.W  $1E5C(A4),D0        ; current dungeon level, 1-based
02DD4  ADDI.W  #$FFFF,D0           ; level − 1
02DDA  MOVE.W  D0,D1 / ADD.L D1,D1 ; × 2 (word array)
02DDE  LEA     -$7C60(A4),A0       ; per-level ramp-index table
02DE2  MOVE.W  (A0,D1.L),$1E62(A4)
02DE8  MOVE.W  $1E62(A4),D0
02DEC  JSR     SetDungeonPalette
```

`$1E5C(A4)` is the level number, 1-based, 1–13 — confirmed independently at
S_1 `+0x188AA` (`CMPI.W #$D,$1E5C(A4)`), S_1 `+0x1A676`
(`CMPI.W #$C,$1E5C(A4)`) and S_1 `+0x18888`, where `(level−1) × 4` indexes a
13-entry pointer array at `$1EDE(A4)`.

The table `A4 − 0x7C60` = **S_2 `+0x039E`**, 13 words:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|-------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| **Ramp** | 0 | 0 | 0 | 0 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 |

Read them with `bcdft_s2_data.bin[0x39E : 0x39E+26]` as big-endian words.
The array is exactly 13 entries long: the next word (S_2 `+0x3B8`) is `0x00DE`
= 222, far outside the table's 0–11 index range, so the boundary is
self-evident. Every value is in range, no value is out of range — zero
deviation.

S_2 `0x0300`–`0x039C` holds five further small tables of 15–17 words each
(`0,0,1,1,2,3,4,4,5,5,6,7,7,7,7,7,7`; `35,30,25,25,20,20,15,10,10,5,0…`;
`−5,−5,−10,−10,−15,…`; `9,8,7,7,6,5,4,3,3,3,0…`; `−1,−2,−3,−3,−4,…`). Their
15–17 entry width rules them out as dungeon-level arrays — they are almost
certainly **character**-level progression tables. Unidentified; a cheap lead
for whoever documents the class/level system.

So: **levels 1–4 tan sandstone, level 5 violet, levels 6–11 bone/cream,
levels 12–13 neutral grey.** The live Amiberry capture (variant 0) is
consistent with any of levels 1–4.

##### Dungeon tileset selection — which level loads `bcdfx`/`bcdfy`/`bcdfz` (confirmed)

> **Correction:** the earlier conclusion "no code path maps a tileset file to a
> ramp" was drawn from a *filename* search that could never have succeeded. No
> file in the corpus contains the literal strings `bcdfx`, `bcdfy`, `bcdfz`,
> `bcdfb`…`bcdfn` — the loader stores one template `"bcdf?"` and **patches its
> last letter at runtime**. Searching for whole filenames therefore returns
> nothing regardless of whether an association exists. This is the
> `save-file-not-asset.md` failure mode in reverse: an empty string search is
> evidence about *how the name is built*, not about whether the code exists.

The tileset filename template lives at **S_1 `+0x1DE0A`** (`"bcdf" 'a' 0`).
Two routines patch its last byte:

| Routine | Patch | Produces |
|---------|-------|----------|
| S_1 `+0x21E7E` | `D0 = (level−1) + 0x62` → `MOVE.B D0,$4(A0)` | `bcdfb`…`bcdfn` — the 13 per-level graphic stores, level 1 → `bcdfb` |
| S_1 `+0x1DD16` | `D0 = <param> + 0x77` → `MOVE.B D0,$4(A0)` | `bcdfw`/`bcdfx`/`bcdfy`/`bcdfz` for param 0/1/2/3 |

`OpenTilesetFile(D0)` at **S_1 `+0x1DD16`** also uses the same `D0` to pick one
of three embedded directory tables (`D3 = D0; SUBQ.W #2,D3; BMI/BEQ/else`).

##### `OpenLevelFile(level)` at S_1 `+0x21E7E` — full trace (confirmed)

The `+0x21E7E` row above previously cited only the one-line patch summary;
this is the full instruction-level disassembly (r2, `data/blackcrypt/extracted/bcdft_decompressed.bin`),
confirming it uses the *exact same* three-part idiom as `OpenTilesetFile`
at `+0x1DD16` and the bcdfa loader at `+0x1DBD2`: patch byte 4 of the one
shared `"bcdf?"` template, then `MODE_OLDFILE`/DOSBase/`Open()` LVO `-30`.

```asm
21E7E  MOVEM.L D2-D5/A5-A6,-(A7)
21E82  MOVEA.L $2099E(pc),A5       ; A5 := the global data frame
21E86  SUBQ.W  #1,D0               ; D0 = level -> level-1
21E88  MOVE.W  D0,D5
21E8A  MOVE.W  D5,$518(A5)
21E8E  LEA     $21FCE(pc),A0       ; BCDFT_LEVEL_TILESET_TABLE (see palette.py)
21E92  LSL.W   #1,D0
21E94  MOVE.W  (A0,D0.W),D1
21E98  MOVE.W  D1,$51A(A5)         ; per-level tileset-variant flag
21E9C  LEA     $1DE0A(pc),A0       ; the ONE shared "bcdf" 'a' 0 template
21EA0  MOVE.W  D5,D0
21EA2  ADDI.W  #$0062,D0           ; (level-1) + 0x62 -> 'b'..'n'
21EA6  MOVE.B  D0,$4(A0)           ; patch template byte 4
21EAA  MOVE.L  A0,D1
21EAC  MOVE.L  #$3ED,D2            ; MODE_OLDFILE (1005) -- same constant
21EB2  MOVEA.L $F0(A5),A6          ; DOSBase -- same pattern
21EB6  JSR     -$1E(A6)            ; Open() -- same LVO -30
21EBA  MOVE.L  D0,D4
21EBC  BNE.B   $21EC6              ; success -> continues into a directory Read()
21EBE  MOVEM.L (A7)+,D2-D5/A5-A6   ; error path
21EC2  MOVEQ   #1,D0
21EC4  RTS
21EC6  LEA     $2223A(pc),A2       ; (success path continues: the 42-entry
21ECA  MOVE.L  A0,D2                ; per-level monster-directory template)
21ECC  MOVE.L  $57A,D3
21ED2  MOVE.L  D4,D1
21ED4  MOVEA.L $F0(A5),A6
```

Confirms every claim in the row above (the `(level-1)+0x62` patch, the
`$21FCE` tileset-variant lookup already documented elsewhere, `MODE_OLDFILE`,
`Open()` LVO `-30`) with one correction to a hand-traced draft of this
listing: the saved/restored register list is **`D2-D5/A5-A6`** (6 registers,
24 bytes), not `D2-D7/A2-A3` — confirmed by both the `MOVEM.L` at `+0x21E7E`
and its matching restore at `+0x21EBE` (opcode `48E7 3C06` / `4CDF 603C`).
All three template-patch sites — `+0x1DBD2` (bcdfa, hardcoded), `+0x1DD16`
(bcdfw/x/y/z, parameterised) and `+0x21E7E` (bcdfb-n, parameterised) — are
now traced at the same instruction level and confirmed to share this one
idiom, not just the two that were previously written up in full.

The caller — the level-entry routine at **S_1 `+0x1A5CC`** — dispatches purely
on `$1E5C(A4)` (the 1-based level number):

```asm
1A5CC  MOVE.W  $A(A5),$1E5C(A4)     ; level := parameter
1A5D6  JSR     $18852(pc)           ; load the level's map/object chunk
1A5DA  CMPI.W  #$4,$1E5C(A4)
1A5E2  BLS     $1A5EC               ; level <= 4      -> GAMEDISK2 / bcdfx
1A5E4  CMPI.W  #$C,$1E5C(A4)
1A5EA  BCS     $1A614               ; level <  12     -> disk-3 branch
       ;                              level >= 12     -> falls through to bcdfx
1A5EC  PEA     $1D9CF(pc)           ; "GAMEDISK2:"
1A60A  MOVEQ   #1,D0                ; -> bcdfx
1A60C  JSR     OpenTilesetFile
1A614  CMPI.W  #$5,$1E5C(A4) / BNE $1A63E
1A61C  PEA     $1D9DA(pc)           ; "GAMEDISK3:"
1A634  MOVEQ   #2,D0                ; -> bcdfy
1A636  JSR     OpenTilesetFile
1A63E  CMPI.W  #$B,$1E5C(A4) / BHI $1A66C
1A646  PEA     $1D9DA(pc)           ; "GAMEDISK3:"
1A664  MOVEQ   #3,D0                ; -> bcdfz
1A666  JSR     OpenTilesetFile
```

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|-------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| **Tileset** | x | x | x | x | **y** | z | z | z | z | z | z | x | x |
| **Ramp** | 0 | 0 | 0 | 0 | **1** | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 |

**Therefore: `bcdfy` is drawn only under ramp 1 (violet/plum), `bcdfz` only
under ramp 2 (bone/warm cream), and `bcdfx` under ramp 0 (levels 1–4) and
ramp 3 (levels 12–13).** Renders of `bcdfy`/`bcdfz` should use ramps 1 and 2
respectively; only `bcdfx` is genuinely ambiguous, and only between 0 and 3.

**Five independent confirmations, zero deviation:**

1. **Range dispatch** (above) — hardcoded `CMPI.W` bounds partition 1–13 into
   `{1–4, 12–13} / {5} / {6–11}`.
2. **Reload-cache guards** in the same routine re-encode the identical
   partition against `D2` (the *previous* level, `−1` = none): the `bcdfx` path
   reloads iff `5 ≤ D2 ≤ 11`; the `bcdfy` path reloads iff `D2 ≠ 5`; the
   `bcdfz` path reloads iff `D2 ≤ 5 or D2 ≥ 12`. Three separate tests, all
   consistent with the same 4-block partition.
3. **A per-level tileset-index table at S_1 `+0x21FCE`** (13 words, read at
   S_1 `+0x21E8E` beside the `bcdfb`…`bcdfn` filename patch and stored to
   `$51A(A5)`): `0 0 0 0 1 2 2 2 2 2 2 0 0` — i.e. `tileset_index + 1 = D0`.
   Boundary is self-evident: word 15 is `0x0054` (84), far out of range.
   `$51A(A5)` is consumed as a graphics-variant flag — every reader
   (S_1 `+0x204A4`, `+0x25DC4`, `+0x26114`) does `TST.W $51A(A5)` and selects an
   alternate table/offset when non-zero.
4. **The per-level ramp table** at S_2 `+0x39E` (`0 0 0 0 1 2 2 2 2 2 2 3 3`) is
   **byte-identical to table 3 for levels 1–11**, diverging only at levels
   12–13 (ramp 3 vs tileset 0). Two tables authored in different segments — one
   data, one code-adjacent — agreeing on the same 4-block partition of 13 levels.
5. **Physical disk layout** (`xdftool list` on all three ADFs) makes the
   partition mandatory: GAMEDISK2 holds `bcdfb`,`c`,`d`,`e`,`m`,`n`
   (= levels 1–4, 12, 13) **and `bcdfx`, and no other tileset**; GAMEDISK3 holds
   `bcdff`…`bcdfl` (= levels 5–11) **and `bcdfy` + `bcdfz`**. No level can reach
   a tileset on the other disk without a swap the code never requests.

###### Tileset container directory (confirmed — 3/3 byte-exact)

Each of the three tileset files is a bare concatenation of chunks; the
directory is **in the executable**, not the file. Entries are 3 big-endian
words, terminated by a zero size word:

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `+0x00` | 2 | `size` | chunk length in bytes; `0` terminates the table |
| `+0x02` | 2 | `compressed` | non-zero → RLE (`bcdfu LAB_0043`); zero → copy raw |
| `+0x04` | 2 | `slot` | destination, as an `A5`-relative pointer slot |

| `D0` | File | Table (S_1) | Entries | Σ sizes | File size |
|------|------|-------------|---------|---------|-----------|
| 1 | `bcdfx` | `+0x1DE10` | 12 | 144,169 | **144,169** |
| 2 | `bcdfy` | `+0x1DE5A` | 7 | 117,937 | **117,937** |
| 3 | `bcdfz` | `+0x1DE86` | 12 | 160,806 | **160,806** |

All three sums equal the shipped file size exactly — 31 entries, zero
deviation. This simultaneously confirms the directory format *and* the
`D0`→filename letter mapping, since table choice and filename derive from the
same `D0`. It also explains why `bcdfy` is a "partial" tileset: it genuinely
has only 7 chunks to `bcdfx`/`bcdfz`'s 12, level 5 being a one-off themed level
with its own tileset *and* its own exclusive accent ramp.

###### Master buffer-allocation size tables (confirmed — resolves `buffer-allocation-sizes`)

Two zero-terminated tables of big-endian longword sizes drive the game's
startup `AllocMem(size, MEMF_PUBLIC|MEMF_CLEAR)` calls, back to back at S_1
`+0x1DA02` (31 entries incl. terminator) and S_1 `+0x1DA7E` (17 entries incl.
terminator). Both are genuine code-driven tables, not a numeric coincidence:
four separate `LEA` sites target their exact start addresses — `+0x1DB66` and
`+0x1DCBA` → `+0x1DA02`; `+0x1DAC0` and `+0x1DC56` → `+0x1DA7E` — and the
consumer loop at `+0x1DB66` is `move.l (a2)+,d0 / beq <exit> / move.l
#$10002,d1 / movea.l 4.w,a6 / jsr -0xC6(a6)` — `AllocMem` LVO `-198`
(`0xC6`) with `d1 = MEMF_PUBLIC|MEMF_CLEAR`, storing each returned pointer
sequentially from `A5+0`, terminating on the first `0` size.

```
S_1 +0x1DA02 (31 entries): 18932 18184 14448 42754 10780 12460 1932 4186
    1330 512 42346 16576 31388 1092 70500 2320 672 336 1536 256 512 650
    450 200 240 300 160 416 56 64 0
S_1 +0x1DA7E (17 entries): 55536 34340 6528 13308 13464 28680 10380 1536
    512 75600 2160 13224 4288 126 20195 1859 0
```

Cross-referencing every non-zero value against sizes already confirmed
elsewhere in this doc finds **20 exact matches, zero deviation**:

| Value | Confirmed elsewhere as |
|-------|-------------------------|
| 18932 | `bcdfa` UI panel bank (`0x00000`–`0x036FC`) |
| 14448 | Tileset slot `$08` (side walls) |
| 42754 | Tileset slot `$0C` (doors) — **the exact buffer this session's slot-`$0C`-tail item concerns; confirms the 320 B tail is inside the game's own intended allocation, not slack beyond it** |
| 10780 | Tileset slot `$10` (pits) |
| 12460 | Tileset slot `$14` (pillars) |
| 1932 | `bcdfb`–`bcdfn` wall-decoration/sound-bank boundary |
| 4186 | Tileset slot `$1C` (18 wall buttons) |
| 1330 | Tileset slot `$20` (pull chains) |
| 16576 | `bcdfa` BCSPEED.GFK (16 records) |
| 31388 | `bcdfa` dungeon-floor-item RLE stream |
| 1092 | `bcdfa` container-directory entry 12 (still-unclassified tail) |
| 55536 | Tileset slot `$B0` (front walls + ceiling + floor) |
| 34340 | `bcdfa` container-directory entry 5 (still-unclassified UI/text bank) |
| 6528 | Tileset slot `$B8` (Door Slot) |
| 28680 | Tileset slot `$C4` (stairs) |
| 75600 | `bcdfa` item-icon bank, stream 1 (175 × 432) |
| 2160 | `bcdfa` item-icon bank, stream 2 (5 × 432) |
| 13224 | `bcdfa` paperdoll chest-armour bank (19 × 696) |
| 4288 | `bcdfa` container-directory entry 4 (message-log font) |
| 20195 | `bcdfa` container-directory entry 6 (BCSPEED.EFF) |

11 of the tileset's 12 `SLOT_SIZES` appear exactly (all but `$C8`, Panel
Top + Fountain, which isn't in either table — presumably allocated some
other way, e.g. folded into a neighbouring buffer or a fixed static
allocation that never went through this dynamic path). `13308`/`13464`
plausibly correspond to the over-allocated alcove/plaque buffers (`$BC`/`$C0`,
11,580 B loaded + runtime mirror-generation headroom — see "Both alcove and
plaque layouts..." above) but aren't exact matches to the raw loaded size, so
they're left as a strong hypothesis, not a confirmed match. The remaining
unmatched values (18184, 42346, 70500, 2320, 672, 336, 1536×2, 256, 512×2,
650, 450, 200, 240, 300, 160, 416, 56, 64, 10380, 126, 1859) are buffers this
project hasn't otherwise identified — a lead for whoever tackles the
still-open `bcdfa` entries, but out of scope for the tileset work this
resolves.

> **Addendum — address-level mapping (independent re-derivation, same
> session cluster).** Beyond value-matching, the consumer loops themselves
> pin every table position to an exact `A5` address, resolving the `$C8`
> gap above and upgrading `$BC`/`$C0` from "plausible" to "confirmed
> address, over-allocated size". Two loops share the pattern
> `LEA <base>(A5),A3` then `move.l D0,(A3)+` on every successful
> `AllocMem`, so table position *i* lands at exactly `A5+base+4×i` with no
> possible skip (postincrement `.l` always advances 4 bytes,
> unconditionally, once `D0≠0`): `+0x1DB44`'s `LEA $B0(A5),A3` walks the
> 16-entry `+0x1DA7E` table to addresses `$B0,$B4,$B8,…,$EC`; `+0x1DB6A`'s
> `LEA $0(A5),A3` walks the 30-entry `+0x1DA02` table to `$00,$04,…,$74`.
> Reading off that arithmetic: position 3 of the `+0x1DA7E` table (`13308`)
> is `A5+$BC` (alcove) and position 4 (`13464`) is `A5+$C0` (plaque) —
> **confirmed addresses**, both genuinely larger than the 11,580 B the
> tileset chunk directory actually loads there (over-allocated by 1,728 /
> 1,884 B, cause not identified). Position 6 (`10380`) is `A5+$C8`
> (Panel Top + Fountain) — so `$C8` **is** in the table after all, just not
> reachable by value-matching alone (its real geometry-summed content is
> 6,060 B, so this slot is also over-allocated, by 4,320 B). `A5+$B4`
> (position 1, `34340`) independently re-confirms `bcdfa` container entry
> 5's decompressed size via this same address arithmetic, and `A5+$D4`/`$D8`/
> `$DC`/`$E0`/`$E8`/`$EC` (positions 9/10/11/12/14/15) land exactly on
> `bcdfa`'s own container-directory slots `0xD4`/`0xD8`/`0xDC`/`0xE0`/`0xE8`/
> `0xEC`, decompressing byte-for-byte to the table values (verified by
> actually running `bclib.bcdfa.read_container_chunks` and
> `bclib.bcdfxyz.read_chunks` against both raw files, not by inference —
> 15/16 `+0x1DA7E` positions and 6/6 checked `+0x1DA02` positions matched
> their independently-decompressed real content exactly; the one exception,
> `+0x1DA02` position 10 = `A5+$28` = `bcdfa`'s raw (uncompressed) sound
> bank, allocates `42,346` B against a real `28,846` B payload — a fourth,
> larger over-allocation in the same family as `$BC`/`$C0`/`$C8`). Master
> allocator itself: `movem.l d2/a2-a6,-(a7)` at S_1 `+0x1DAE4`, first
> allocates the whole 1,324 B (`$52C`) `A5` frame, stores it at
> `*(S_1+0x2099E)` (the same global the `+0x2030E` accessor other loaders
> use), then sets `A5+$F0` = DOSBase and `A5+$50C` = `$DFF000` (custom chip
> base) before running the two size-table loops — called from exactly one
> site, S_1 `+0xD39E`, i.e. once at game startup, well before any level is
> entered. The 4 over-allocated slots (`$BC`/`$C0`/`$C8`/`$28`, headroom
> 1,728–13,500 B) remain unexplained but are now precisely located, for
> whoever investigates further.

##### Still open / paths tried

| Approach | Result | Why |
|----------|--------|-----|
| Byte-search whole Amiga corpus (raw files + every RLE-decompressed `bcdfx`/`y`/`z` payload) for the live-captured ramp | Exactly one hit, `bcdfu`+0x420 | Misleading — that is the epilogue overlay's *copy*. The real table is inside `bcdft`'s LZ77 payload, invisible to a raw search. (The RLE codec copies literal runs verbatim, so a compressed *RLE* copy would have been found; an LZ77 one is not.) |
| Trace `bcdfp` `LAB_0137` as "the palette loader" | Wrong routine | It is a 16-step vertical-blank **fade**; its table has one entry and both call sites pass `n = 1` / `n = 0`. `bcdfp`'s copper `COLOR` block is only ever written by the two fade routines. |
| ~~Look for a tileset→palette association~~ | ~~None exists~~ | **Superseded — see "Dungeon tileset selection" above.** The search looked for literal `bcdfx`/`y`/`z` filename strings, which cannot exist: the loader patches the last letter of one `"bcdf?"` template at S_1 `+0x1DE0A`. The association does exist and is confirmed five ways. |
| Enumerate real `0x1E`/`0x1F` action records in `bcdfs` to check their value bytes land in 0–11 | Still open, but the blind-scan premise was wrong | The scan assumed the on-disk record matches the 8-byte in-memory record *and* that byte `0x07` is the value. Byte `0x07` is the **chain-next index** (walked at S_1 `+0x187A4`); the value is byte `0x06`. ~~Also, `bcdfs` is not a flat record array — it is 13 level chunks, each a sparse `(row, col, cell-longword)` stream that the parser at S_1 `+0x18928` expands into the 64×64 map at `A4−0x37CA` plus 20-byte object records at `A4−0x6E7A`. A correct walker must reimplement that parser, not window-scan.~~ |
| **Superseded — that note is not a competing on-disk format, it's an under-cited description of the loader.** | Traced S_1 `+0x188D0`–`+0x18D00` end to end | It's exactly the runtime consumer of the on-disk layout already documented in "bcdfs — Map / Dungeon Format" below (offset table → header → sparse row/col → interleaved entity chains), not a different file shape. See that section's new "Runtime parser" subsection for the full trace: per-map `Read()` sized from the offset table, then a row/col walk byte-for-byte matching the documented row format, expanding into the same `A4−0x37CA` 64×64 array independently confirmed by "Selector 2" above, and the same `A4−0x6E7A` 20-byte records whose offset `+0x5` type byte matches the Item/Structure type tables' values exactly (`0x13`/`0x23`/`0x0F`/`0x1F`, tested at S_1 `+0x186E0`/`+0x18B5C`/`+0x18B74`/`+0x18C10`/`+0x18C28`). A window-scan still can't walk it (the row/col ranges are genuinely variable-length and depend on the offset table), but a scripted parser that follows the same three steps can, and should replace hand-scanning. |
| Attribute ramps 5–11 to specific effects | Open | They are never touched by the level table or by the square-flag override; presumably spell/effect code elsewhere in S_1. |

##### Selector 2 — per-square override (confirmed)

**S_1 `+0x02D46`**, called on party movement, reads the current square's
longword from the 64×64 map array at `A4 − 0x37CA`
(`index = (Y << 8) | (X << 2)`) and tests **bit 31**:

```asm
02D76  LEA     -$37CA(A4),A0
02D7A  MOVE.L  (A0,D0.L),D0
02D7E  ANDI.L  #$80000000,D0       ; square flag bit 31
...    D0 = 0/1, compare with $1E60(A4) — unchanged ⇒ nothing to do
02D94  CMPI.W  #$3,$1E5C(A4) / BEQ  ; level 3 is exempt
02DA2  MOVE.W  D0,$1E60(A4)
02DAA  JSR     <state change>
02DB6  MOVE.W  #$4,$1E62(A4)       ; entering ⇒ force ramp 4 (cold blue-grey)
02DC0  JSR     SetDungeonPalette
       ... else fall through to the per-level table restore at 02DD0
```

Entering a bit-31 square re-tints the stonework to ramp **4** and leaving it
restores the level default. Level 3 never does this. The gameplay meaning of
the flag (water / submerged region is the obvious candidate given ramps 4–8
are all blues) is **hypothesis**, not confirmed.

##### Selector 3 — `bcdfs` action opcodes `0x1E` / `0x1F` (confirmed)

The action-opcode dispatcher is at **S_1 `+0x0CEA8`** — `CMPI.W #$24,D0 /
BCC default / ADD.W D0,D0 / MOVE.W (tbl,PC,D0.W),D0 / JMP (0,PC,D0.W)` with a
**36-entry** word table at S_1 `+0x0CE54` (opcodes `0x00`–`0x23`; the
documented action list stops at `0x22`, so one more opcode exists than was
listed). Both colour opcodes are confirmed:

```asm
; 0x1F — dungeon colour change
0CD3E  MOVEQ   #0,D0
0CD40  MOVE.B  D5,D0               ; D5 = the action record's byte 0x06 ("value")
0CD42  MOVE.W  D0,$1E62(A4)
0CD46  MOVE.W  $1E62(A4),D0
0CD4A  JSR     SetDungeonPalette
0CD50  BRA     <done>

; 0x1E — teleport + dungeon colour change (S_1+0x0CCE6)
       ... same three lines, plus $1742/$1740(A4) = target X/Y and a full
       re-init/redraw chain
```

So the action record's **"action value" byte at record offset `0x06` is the
accent-ramp index (0–11)** — this is what lets a map re-tint an area's
stonework mid-play without touching creature colours. This confirms the
previously hypothesised meaning of opcodes `0x1E`/`0x1F`.

> **Correction — the value byte is offset `0x06`, not `0x07`; `0x07` is the
> chain link.** The in-memory action record is **8 bytes**, and the array base
> is `$836(A4)` (= S_2 `+0x8834`, zero-filled in the shipped image — it is a
> runtime buffer). The field loads are all in the dispatcher's prologue at
> **S_1 `+0x0C4F6`**, each one `MOVE.B D6,D0 / ASL.L #3,D0 / LEA $836(A4),A0`
> (the `ASL.L #3` is the 8-byte stride) followed by:
>
> | Offset | Size | Field | Evidence |
> |--------|------|-------|----------|
> | `0x00` | 1 | opcode (0x00–0x23) | `0C544  MOVE.B (A0,D1.L),D0` → falls into the dispatcher at `+0x0CE9C` |
> | `0x02` | 1 | X (`D3`) | `0C50E  MOVE.B $2(A0,D0.L),D1 / MOVE.W D1,D3` |
> | `0x03` | 1 | Y (`D4`) | `0C520  MOVE.B $3(A0,D0.L),D1 / MOVE.W D1,D4` |
> | `0x06` | 1 | **action value** (`D5`) | `0C530  MOVE.B $6(A0,D0.L),D5` |
> | `0x07` | 1 | **next-record index** (chain link) | `187A4  MOVE.B $7(A0,D0.L),$83D(A4)` — the chain walker; `187E2  CLR.B $7(A0,D0.L)` unlinks; `187F8  MOVE.B D2,$7(A0,D0.L)` relinks |
>
> `D3`/`D4` are confirmed as X/Y independently: the `0x1E` teleport handler
> writes them to `$1742(A4)`/`$1740(A4)`, and sibling handlers use them as
> `(Y << 8) | (X << 2)` to index the 64×64 map longword array at `A4 − 0x37CA`
> (e.g. S_1 `+0x0C9D8`, `+0x0C55A`) — the same addressing the per-square
> override at `+0x02D76` uses.

##### Cross-platform oracle (DOS VGA)

The DOS port stores its palettes in `clipper.clp` as 256 × RGB bytes. Two
different quantisations are used; both map the Amiga 4-bit nibble `n` exactly:

| DOS palette | `clipper.clp` offset | Encoding | Equals |
|-------------|----------------------|----------|--------|
| `Palette` (dungeon) | `0xB2D0` | `16n + 3` | Amiga dungeon palette / ramp 0 — **31 of 32 words identical** |
| `Automap_Palette` | `0xB5D0` | `16n + 3` | same |
| `Character_Gen_Palette` | `0xB8D0` | `16n` | `bcdfp`+0x4194 = `BlackCrypt`+0x2848 ramp, all 6 words |
| `Options_Palette` | `0xBBD0` | `16n` | ramp 2, all 6 words |

The single mismatch in the dungeon palette is index 19: DOS `0FD0` (static
gold) vs Amiga `033B`. That is not an error — index 19 is the Amiga's
colour-cycled register; its 12-step cycle table `033B 033A 0339 0338 0337 0336
0336 0337 0338 0339 033A 033B` sits at `bcdft`+0x1E308. **All six accent
entries 26–31 match byte-for-byte.**

Ramps 1 and 4 appear nowhere in the DOS port under any encoding — consistent
with them being used only by level 5 and the per-square override, neither of
which the extractor's palette dump would have captured.

#### `bcdfu` is the epilogue overlay (confirmed)

`bcdfu`'s CODE hunk 0 is a complete standalone program: open
graphics/intuition/dos, hook `AUTO_INT3`, run a linear sequence of narrative
screens, restore and `RTS`. The sequence at hunk-0 `0x0F6`–`0x1A4` is ten
repetitions of `LEA <palette>(PC),A0 / LEA <text>(PC),A1 / MOVE.L #<n>,D0 /
BSR LAB_0022`:

| asm (hunk0) | palette | file offset | ramp | Narrative text |
|-------------|---------|-------------|------|----------------|
| `0x0F6` | `LAB_0008` | `0x03EC` | 0 | (title screen, `BSR LAB_0050`) |
| `0x0FE` | `LAB_0008` | `0x03EC` | 0 | "THROUGH INCREDIBLE BRAVERY … EMERALD KEY." |
| `0x110` | `LAB_0008` | `0x03EC` | 0 | "COURAGE, WITS, AND DILIGENCE … ESTOROTH WAITED." |
| `0x122` | `LAB_0008` | `0x03EC` | 0 | "USING 3 EVIL IDOLS … DREADED DRAGONLICH." |
| `0x134` | `LAB_000A` | `0x046C` | 2 | "THE HIDEOUS MEDUSA …" |
| `0x146` | `LAB_000A` | `0x046C` | 2 | "THE EVIL POSSESSOR DEMON …" |
| `0x158` | `LAB_000C` | `0x04EC` | 4 | "THE GREAT WATERLORD …" |
| `0x16A` | `LAB_000A` | `0x046C` | 2 | "AND THE MIGHTY RAM DEMON." |
| `0x17C` | `LAB_0009` | `0x042C` | 1 | "TO REACH THE BLACK CRYPT …" |
| `0x18E` | `LAB_000B` | `0x04AC` | 3 | "YOU FOUGHT YOUR WAY PAST …" |
| `0x1A0` | `LAB_000B` | `0x04AC` | 3 | (final, `BSR LAB_004F`) |

Note the Waterlord screen uses ramp 4, the blue-grey — the same ramp the
per-square override forces. `bcdfu` also holds three further 32-word palettes
at hunk-0 `0x508`/`0x548`/`0x588` (`LAB_000D`–`LAB_000F`) used by the credits
roll, and the narrative strings themselves at `0x5C8` onward, each line
prefixed by a big-endian word (`0x068B`, `0x0695`, …) and the block terminated
by `0xFF`.

Because the epilogue only *copies* five of the twelve ramps, `bcdfu` is a
convenient place to read them from but **not** the authoritative table. Prefer
`bcdft_decompressed.bin[0x27B00 : 0x27B00 + 12*12]`.

#### Sub-image layout (confirmed)

Every sub-image is **sequential planar**, planes stored whole one after
another, `(width/8) × height` bytes per plane. Two plane counts occur:

| Planes | Layout | Used by |
|--------|--------|---------|
| 6 | 6 colour planes, EHB index | opaque full-rectangle art (walls, floor, ceiling, alcoves, plaques) |
| 7 | 1 mask plane **first**, then 6 colour planes | art with transparency (pillars, doors) |

The 7-plane mask-first order is the same convention already confirmed for
`bcdfa` BCSPEED.GFK and the `bcdfb`–`bcdfn` wall decorations.

**Amiga sub-images are stored at their true on-screen perspective size**, not
padded to the viewport width the way the DOS port pads them. `Wall 0/1/2` are
208 px wide in `clipper.clp` but **176 / 112 / 64 px** on Amiga, at the same
heights (123 / 78 / 57).

##### Slot 176 (chunk 2) — 55,536 B — front walls + ceiling + floor (confirmed)

> **Correction — the four "unidentified" gaps are not gaps, their sizes were
> wrong, and `Wall 2` was the wrong sub-image.** The earlier table was built by
> subtracting DOS-manifest-sized pieces out of the payload and calling the
> leftovers unknown; three of its four "unknown" offsets are off by 4 bytes and
> its `Wall 2` entry points at a side return, not the front face. The real
> layout comes from the game's own 20-byte blit descriptors (below) and tiles
> the payload with **zero gaps and zero overlap**.

The renderer draws each wall *row* as three pieces — **left return, front face,
right return** — so the two returns can be swapped when the view is mirrored.
DOS `clipper.clp` stores each row pre-composited as one 208-px image; the three
Amiga widths sum to exactly 208 in all three rows.

| Offset | Size | Image | Geometry | Dest (x, y) |
|--------|------|-------|----------|-------------|
| 0 | 1,476 | Wall 0 — left return | 16×123, 6 planes | (0, 5) |
| 1,476 | 16,236 | **Wall 0 — front face** | 176×123, 6 planes | (16, 5) |
| 17,712 | 1,476 | Wall 0 — right return | 16×123, 6 planes | (192, 5) |
| 19,188 | 2,808 | Wall 1 — left return | 48×78, 6 planes | (0, 18) |
| 21,996 | 6,552 | **Wall 1 — front face** | 112×78, 6 planes | (48, 18) |
| 28,548 | 2,808 | Wall 1 — right return | 48×78, 6 planes | (160, 18) |
| 31,356 | 2,736 | Wall 2 — left return | 64×57, 6 planes | (0, 23) |
| 34,092 | 3,420 | **Wall 2 — front face** | 80×57, 6 planes | (64, 23) |
| 37,512 | 2,736 | Wall 2 — right return | 64×57, 6 planes | (144, 23) |
| 40,248 | 4,680 | **Ceiling** | 208×30, 6 planes | (0, 0) |
| 44,928 | 10,608 | **Floor** | 208×68, 6 planes | (0, 72) |

Σ = 55,536 = the payload size exactly. `16+176+16 = 48+112+48 = 64+80+64 = 208`.

Source: two **20-byte blit-descriptor tables** in the decompressed `bcdft` S_1
image — direct at S_1 `+0x22CE2`, mirrored at S_1 `+0x22D96`, 9 records each,
consumed by `DrawSubImage` (S_1 `+0x2300A`) and `DrawSubImageMirrored`
(S_1 `+0x2304A`, which bit-reverses each byte through a lookup table at S_1
`+0x279C0`). Record layout, all big-endian longwords:

| Offset | Field |
|--------|-------|
| `+0x00` | source byte offset into the slot's payload |
| `+0x04` | destination byte offset (dest row stride is 40 B = 320 px) |
| `+0x08` | width in words − 1 |
| `+0x0C` | height in rows − 1 |
| `+0x10` | bytes to add to the destination after each row |

In the mirrored table the **centre** record keeps its source offset while the
two flanking records swap theirs — which is what identifies the middle entry of
each row as the front face and the outer two as the returns.

Ceiling and floor are additionally hard-coded in the view builder at S_1
`+0x230C6` (`$B0(a5) + $9D38` = 40,248, 26 B × 30 rows × 6 planes) and S_1
`+0x2310E` (`$B0(a5) + $AF80` = 44,928, 26 B × 68 rows × 6 planes) — an
independent second confirmation of both offsets, sizes and plane counts.

##### bcdfx / bcdfz payload P4 — 11,580 B (alcove, 5 depths)

`1,930 × 6 = 11,580` exactly, zero remainder.

| Offset | Image | Geometry |
|--------|-------|----------|
| 0 | Alcove A | 112×77, 6 planes |
| 6,468 | Alcove B | 64×45, 6 planes |
| 8,628 | Alcove C | 48×34, 6 planes |
| 9,852 | Alcove D | 32×54, 6 planes |
| 11,148 | Alcove E | 16×36, 6 planes |

##### bcdfx / bcdfz payload P5 — 11,580 B (plaque, 5 depths)

`1,930 × 6 = 11,580` exactly. Same total as P4 by coincidence of the artists'
sizing, *not* because the two payloads share a shape.

| Offset | Image | Geometry |
|--------|-------|----------|
| 0 | Plaque A | 96×80, 6 planes |
| 5,760 | Plaque B | 64×52, 6 planes |
| 8,256 | Plaque C | 48×40, 6 planes |
| 9,696 | Plaque D | 32×60, 6 planes |
| 11,136 | Plaque E | 16×37, 6 planes |

##### bcdfx payload P6 — 12,460 B (pillar, 3 depths, masked)

`1,780 × 7 = 12,460` exactly — the first payload proven to use the 7-plane
mask-first layout.

| Offset | Image | Geometry |
|--------|-------|----------|
| 0 | Pillar A | 80×116, mask + 6 planes |
| 8,120 | Pillar B | 48×72, mask + 6 planes |
| 11,144 | Pillar C | 32×47, mask + 6 planes |

> **Correction — "`bcdfz` P6 is only 2,387 B" was an artefact of blind RLE
> scanning.** `bcdfz` stores this chunk **uncompressed** (directory
> `compressed = 0`), so RLE-decoding it desynchronises after 2,387 bytes. Read
> through the directory it is 12,460 B at raw offset 109,532, identical in size
> and layout to `bcdfx`'s. The "per-payload index isn't stable" conclusion drawn
> from it is also void — the index *is* stable; the container directory (below)
> assigns every chunk a fixed destination slot in all three files.

Both alcove and plaque layouts are independently confirmed by the loader
itself: after reading the last chunk, `OpenTilesetFile` (S_1 `+0x1DDA8`)
generates horizontally mirrored copies of the two smallest depths of each set
by calling S_1 `+0x254FA` four times with literal `(src, dst, width, height)`
arguments — `$BC(a5)+0x267C` (9,852) 32×54 and `+0x2B8C` (11,148) 16×36 for the
alcove, `$C0(a5)+0x25E0` (9,696) 32×60 and `+0x2B80` (11,136) 16×37 for the
plaque. Those four source offsets and four geometries are exactly the Alcove
D/E and Plaque D/E rows above, read straight out of the instruction stream.
The mirrors land at `+0x2D3C` (11,580 — i.e. immediately past the loaded data)
and `+0x324C`/`+0x32DC`, so both buffers are deliberately over-allocated by one
mirrored D+E pair.

##### The container directory and the full slot inventory (confirmed)

Each chunk in the directory (see "Tileset container directory" above) names a
**destination slot**, which is a `d16(A5)` displacement in the graphics
kernel's globals frame — `A5` is loaded from S_1 `+0x2099E` by the two-
instruction helper at S_1 `+0x2030E` (`MOVEA.L $2099E(pc),A5` /
`MOVEA.L $50C(A5),A6`), so every `$xx(A5)` in the 0x1D000–0x27000 range is a
global, not a stack argument. (Code below 0x1D000 is C with `LINK A5,#n`
frames; `$8(A5)` there is a *stack* argument and is not a slot. A slot scan
that ignores this produces false positives.)

| Slot | Chunk (x/z) | Bytes | Contents | Coverage |
|------|-------------|-------|----------|----------|
| `$08` (8) | 0 | 14,448 | Side walls, 4 depths × L/R, masked | 14,448 / 14,448 |
| `$0C` (12) | 1 | 42,754 | Door leaves ×2 types ×3 depths + 7 door-way frames, masked, **+ the 80×32 door-animation clip stencil** | 42,754 / 42,754 |
| `$B0` (176) | 2 | 55,536 | Front walls ×3 depths (3 pieces each) + ceiling + floor | 55,536 / 55,536 |
| `$10` (16) | 3 | 10,780 | Floor pits A–D + ceiling pits A–B, masked | 10,780 / 10,780 |
| `$BC` (188) | 4 | 11,580 | Alcove A–E | 11,580 / 11,580 |
| `$C0` (192) | 5 | 11,580 | Plaque A–E | 11,580 / 11,580 |
| `$14` (20) | 6 | 12,460 | Pillar A–C, masked | 12,460 / 12,460 |
| `$B8` (184) | 7 | 6,528 | **Door Slot** — one 64×136, 6 planes | 6,528 / 6,528 |
| `$C4` (196) | 8 | 28,680 | **Stairs**, two flights × 3 depths, 6 planes | 28,680 / 28,680 |
| `$20` (32) | 9 | 1,330 | **Pull Chain 0–3**, masked | 1,330 / 1,330 |
| `$C8` (200) | 10 | 6,060 | **Panel Top** + **Fountain**, 6 planes | 6,060 / 6,060 |
| `$1C` (28) | 11 | 4,186 | **18 wall buttons**, masked | 4,186 / 4,186 |

**205,922 of 205,922 decompressed bytes assigned, with zero overlap and zero
remainder.** All 83 pixel sub-images decode at full length in `bcdfx` and
`bcdfz` and all 46 present in `bcdfy`, with no short-data truncation and no
out-of-palette index; the 84th entry is the 1-plane clip stencil that closes
slot `$0C` (see "Slot `$0C` tail" below).

> **Correction — "one 320-byte remainder (end of slot `$0C`)" is superseded.**
> Those 320 bytes are a real, code-consumed asset (an 80×32 clip stencil), not
> slack. See "Slot `$0C` tail (42,434–42,754) — the door-animation clip
> stencil" below for the trace and verification.

###### The 28-byte sprite descriptor (confirmed)

Most of the newly-identified sets are described by a second, richer record used
by the generic masked blitter (built at S_1 `+0x24BF8`, dispatched at S_1
`+0x24C00`, and read field-by-field at S_1 `+0x22BEA`):

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `+0x00` | 2 | `slot` | the `d16(A5)` displacement the pixels live in |
| `+0x02` | 4 | `src` | byte offset within that slot |
| `+0x06` | 4 | `bytesPerPlane` | always `(width / 8) × height` |
| `+0x0A` | 4 | `maskSrc` | used only when flag bit 1 is set |
| `+0x0E` | 2 | `BLTSIZE` | always `(height << 6) \| (width / 16 + 1)` |
| `+0x10` | 2 | blitter modulo | always `40 − (width / 16 + 1) × 2` |
| `+0x12` | 2 | dest X (pixels) | written by `MOVE.W D0,$12(A0)` |
| `+0x14` | 2 | dest Y (rows) | written by `MOVE.W D1,$14(A0)` |
| `+0x16` | 2 | flags | bit 8 = `src` is the mask; bit 9 = mask is at `+0x0A`; **bit 10 = horizontal mirror** (`BTST #2,$16(A0)`) |
| `+0x18` | 2 | width (pixels) | |
| `+0x1A` | 2 | height (rows) | `MULU #7,D1` → 7 planes, mask first |

Three internal invariants hold on **61 of 61** records found by a whole-binary
scan (`bytesPerPlane == (w/8)*h`, the `BLTSIZE` identity, and
`modulo + blitBytes == 40`), which is what makes a blind struct scan safe here:
the record is self-describing enough to reject false positives outright.

###### Slot `$08` (14,448 B) — side walls, masked (confirmed)

Tables at S_1 `+0x22E4A` (direct) and S_1 `+0x22F2A` (mirrored), 8 records each.
7 planes, mask first.

> **Correction — these were labelled `near side`/`far side`; they are the
> party's `left`/`right`.** Confirmed from the render driver's wall-bit
> selection (`(facing−1)&3` ⇒ even index, `(facing+1)&3` ⇒ odd) and from the
> dest-X values below being exact mirror pairs about the 208-px viewport centre
> in 4/4 depths. See "3D Viewport Compositing → Verification".

| Offset | Image | Geometry | Dest (x, y) |
|--------|-------|----------|-------------|
| 0 | Side wall, depth 0, **left** | 16×140 | (0, 0) |
| 1,960 | Side wall, depth 0, **right** | 16×140 | (192, 0) |
| 3,920 | Side wall, depth 1, **left** | 32×122 | (16, 5) |
| 7,336 | Side wall, depth 1, **right** | 32×122 | (160, 5) |
| 10,752 | Side wall, depth 2, **left** | 16×77 | (48, 18) |
| 11,830 | Side wall, depth 2, **right** | 16×77 | (144, 18) |
| 12,908 | Side wall, depth 3, **left** | 16×55 | (64, 24) |
| 13,678 | Side wall, depth 3, **right** | 16×55 | (128, 24) |

Σ = 14,448 exactly. The four widths sum to **80** and the tallest is **140** —
i.e. DOS `Wall Left` / `Wall Right` (80×140) are the same art pre-composited
into one image per side, the Amiga keeping the four depth slices separate.

###### Slot `$0C` (42,754 B) — doors, masked (confirmed)

Tables at S_1 `+0x2115E` (7 door-way frames) and S_1 `+0x261D2` (6 door
leaves). All 7 planes, mask first.

| Offset | Image | Geometry |
|--------|-------|----------|
| 0 | Door Type 0 − 1 | 80×92 |
| 6,440 | Door Type 0 − 2 | 64×60 |
| 9,800 | Door Type 0 − 3 | 48×44 |
| 11,648 | Door Type 1 − 1 | 80×92 |
| 18,088 | Door Type 1 − 2 | 64×60 |
| 21,448 | Door Type 1 − 3 | 48×44 |
| 23,296 | Door Way 1B (lintel) | 80×27 |
| 25,186 | Door Way 1A (left jamb) | 48×109 |
| 29,764 | Door Way 1C (right jamb) | 48×109 |
| 34,342 | Door Way 2B | 48×14 |
| 34,930 | Door Way 2A | 32×69 |
| 36,862 | Door Way 2C | 32×69 |
| 38,794 | Door Way 3 | 80×52 |
| 42,434 | **Door-animation clip stencil** (1 plane, mask only) | 80×32 |

The two 80×92 leaves are the records whose flag has bit 9 set: their `src`
points at the **colour** planes and `+0x0A` at the mask (`0` and `11,648`),
which is what makes the chain close — everything else has `src` at the mask.

> **Correction — the earlier "Door Type 1 − 1/2/3 at 11,650 / 18,090 / 21,450"
> is off by 2, 2 and 2 bytes**, and the r = 0.82 correlation on the first of
> them was the tell. The profile-correlator was matching a near-miss; the real
> offsets are 11,648 / 18,088 / 21,448 and come from the game's own descriptor
> table. "Door Type 0 − 2/3 and Door Way 1A/2A/3 also match but not at mutually
> consistent offsets" is now resolved: all 13 pieces tile the payload
> back-to-back with no gaps.

###### Slot `$0C` tail (42,434–42,754) — the door-animation clip stencil (**confirmed**)

> **Correction — supersedes "320 B unaccounted / exporter slack in a fixed
> 42,754-byte authoring buffer".** The tail is a genuine asset with a single,
> exactly-bounded consumer. The earlier negative ("0 code references to file
> offset 42,434") was a *shape-based* search for the wrong constant: no code
> ever references 42,434, because the one consumer references **42,524** — the
> tail's own offset **plus 90 bytes**, for the arithmetic reason given below.
> See the paths-tried table for how the wrong constant was arrived at.

An 80-pixel-wide, 32-row, **1-plane** (mask-only) stencil, anchored at the
depth-1 doorway frame's own screen origin `(64, 9)`. Rows 0–8 are solid; rows
9–31 are a trapezoidal aperture that widens by exactly 1 px per side per row
(24 → 2 px of set pixels per side).

**The consumer — the door open/close animation.** Two entry points, differing
only in which byte-script they walk:

| Address | Script | Meaning | Caller |
|---|---|---|---|
| S_1 `+0x262C2` | `+0x26456` | **door closing** — leaf height 1 → 0x41, sound marker, 0x46 → 0x5C, then a 0x5C/0x5A/0x58/0x57/0x56/0x56/0x57/0x58/0x5A/0x5C slam-bounce | S_1 `+0x11444` (`JSR $A631A.l`) |
| S_1 `+0x262CC` | `+0x26432` | **door opening** — leaf height 0x5C → 0 in 33 steps | S_1 `+0x1128A` (`JSR $A6324.l`) |

Both callers reach the routine the same way: `LEA -$6E7A(A4),A0` (the 20-byte
object-record array) → `D0 = record[+0x00]` (the door's own `gfxNumber`,
`0x0035`/`0x0036`) → the `JSR`. Absolute targets resolve under the already-
documented `+0x80058` load base.

Each animation frame does three blits:

1. `+0x26538` **restore** — copy the whole 80×92 saved rect from `$AC(A5)`
   back to the screen (`BLTCON0 = $09F0`, LF `$F0` = plain copy).
2. `+0x2630E` **draw the sliding leaf** — the descriptor at `+0x261D2` /
   `+0x261EE` (80×92, dest `(64, 18)`); `BLTAPTH = leafMask + (92 − d5)×10`,
   `BLTBPTH = leafColour + (92 − d5)×10`, `BLTSIZE = (d5 << 6) | 5`. The leaf
   scrolls within its own art while the destination stays fixed, so the leaf's
   own mask no longer lines up with the doorway.
3. `+0x26380` **the stencil pass** — this is the tail's consumer:

```asm
026380  206d0464      movea.l $464(a5),a0        ; screen bitplane pointer list
026384  226d00ac      movea.l $ac(a5),a1         ; saved 80x92x6 background
026388  266d000c      movea.l $c(a5),a3          ; <-- slot $0C, the door chunk
02638C  d7fc0000a61c  adda.l  #$a61c,a3          ; +42,524  == 42,434 + 90
026392  426e0042      clr.w   $42(a6)            ; BLTCON1 = 0
026396  3d7c0fca0040  move.w  #$fca,$40(a6)      ; BLTCON0: USEA|USEB|USEC|USED, LF=$CA
0263A8  426e0064      clr.w   $64(a6)            ; BLTAMOD = 0   -> A stride 10 B/row
0263AC  426e0062      clr.w   $62(a6)            ; BLTBMOD = 0
0263B0  3d7c001e0060  move.w  #$1e,$60(a6)       ; BLTCMOD = 30  -> 40 B screen row
0263B6  3d7c001e0066  move.w  #$1e,$66(a6)       ; BLTDMOD = 30
0263BC  7005          moveq   #$5,d0             ; 6 bitplanes
0263BE  2d4b0050      move.l  a3,$50(a6)         ; BLTAPTH = the stencil (same every plane)
0263C2  2d49004c      move.l  a1,$4c(a6)         ; BLTBPTH = saved background
0263C6  2458          movea.l (a0)+,a2
0263C8  45ea02d8      lea     $2d8(a2),a2        ; 18*40 + 64/8  ->  dest (64, 18)
0263CC  2d4a0054      move.l  a2,$54(a6)         ; BLTDPTH
0263D0  2d4a0048      move.l  a2,$48(a6)         ; BLTCPTH
0263D4  3d7c05c50058  move.w  #$5c5,$58(a6)      ; BLTSIZE = 23 rows x 5 words (80 px)
0263E2  43e90398      lea     $398(a1),a1        ; next saved-bg plane (+920 = 10*92)
0263E6  51c8ffd6      dbra    d0,$263be
```

Minterm `$CA` is `D = A ? B : C`: wherever the stencil is set, put back the
pre-animation background; elsewhere leave the screen alone. So the pass
**re-clips the scrolled leaf to the closed door's silhouette** every frame.

| Fact | Value | Where it comes from |
|---|---|---|
| Stencil start | 42,524 | `ADDA.L #$A61C,A3` at S_1 `+0x2638C` |
| Rows read | 23 | `BLTSIZE = $05C5` → `$5C5 >> 6` |
| Bytes per row | 10 | `BLTSIZE & $3F = 5` words, `BLTAMOD = 0` |
| Bytes read | 230 | 23 × 10 |
| End of read | **42,754** | 42,524 + 230 = the chunk's exact length |
| Skipped cap | 90 B = 9 rows | `(leafDestY 18) − (frameDestY 9) = 9` rows × 10 B |

The 90-byte cap is therefore not slack either: the stencil is authored against
the *doorway frame's* origin `(64, 9)` — Y=9 is `MOVEQ #$9,D1` at every one of
`+0x25CAE`'s five depth-1 call sites (`+0x25CC4`, `+0x25CD2`, `+0x25CDE`,
`+0x25CEC`, `+0x25CFC`), and X=64 is the `MOVEQ #$40,D0` at `+0x25CDC` that
places the 80-px lintel — while the animation's destination is the *leaf's* origin
`(64, 18)` (dest Y in descriptors `+0x261D2`/`+0x261EE`), so the code enters the
image 9 rows down. Both constants are independently documented above. Rows 0–8
are solid `$FF` in all three tilesets, which matches the doorway frame's own
mask over dest rows 9–17 at **720/720 px** in `bcdfx` and `bcdfz`.

**Verification (confirmed — three independent oracles, zero deviation).**

1. **Byte-exact derivation from the art.** `bcdfz`'s stencil rows 9–31 are
   *exactly* `NOT(Door Type 0 − 1's own mask plane, rows 0–22)` dilated 1 px
   horizontally: **1840/1840 pixels, 100.000%**. Dilating 0 px or 2 px both give
   97.500% (46 px off = exactly 2 px × 23 rows), so the 1-px dilation is the
   unique fit, not a fitted parameter.
2. **Functional simulation.** Replaying both scripts (33 opening frames, 34
   closing frames) with the game's own `BLTAPTH = mask + (92 − d5)×10` rule and
   counting leaf pixels drawn outside the closed door's row-wise outline:

   | Tileset | Leaf | Spill without the stencil | With it |
   |---|---|---|---|
   | `bcdfz` | Door Type 0 | 12,150 px (open) / 11,784 px (close) | **0 / 0** |
   | `bcdfz` | Door Type 1 | 12,403 / 11,351 | 1,772 / 1,509 |
   | `bcdfx` | both | 1,536 / 1,304 and 0 / 0 | unchanged (stencil is blank) |
   | `bcdfy` | both | 0 / 0 | unchanged (stencil is blank) |

   The stencil removes **100.000%** of the Door Type 0 spill it was cut for,
   across every frame of both animations. One stencil serves both leaf types,
   so Door Type 1 (a different arch, with an interior grate) keeps a residue.
3. **The `bcdfx`/`bcdfy` blank is content-correct, not a missing asset.** Those
   two tilesets' depth-1 door leaves are square-topped — `bcdfx` Door Type 1 and
   both of `bcdfy`'s masks are fully solid over rows 0–22, so there is nothing
   to clip and an all-zero A channel makes the blit a no-op (`D = C`). The one
   exception is `bcdfx`'s Door Type 0, whose leaf is inset 2 px per side from
   row 14 down and which therefore does keep a small (1,536 px cumulative,
   2 px wide) uncorrected overhang — a genuine, minor shipping artifact in that
   tileset, not evidence against the stencil.

A side-by-side render of `bcdfz`'s depth-1 door at five animation steps, with
and without the pass, is at `build/cache/blackcrypt/slot0c_door_stencil.png`
(verification artifact, not a web asset): without it the leaf's square top
corners visibly punch through the arch's sloped shoulders.

**Why the earlier "no code reads this" was wrong — root vs. shape.**

The negative that kept this open was shape-based — a search for the literal
constant 42,434. Redone **root-based**, the access set is finite and complete:

- `A5` (the graphics kernel's globals frame) has exactly one producer, the
  two-instruction helper at S_1 `+0x2030E`, which the animation routine calls at
  `+0x262D4`.
- Across the whole 166,676-byte S_1 image, exactly **two** instructions form an
  `(0x000C, A5)` effective address inside the kernel range `0x1D000–0x28B14`:
  `+0x26312` (`MOVEA.L $C(A5),A1`, the leaf blit — bounded by its descriptor)
  and `+0x26388` (the stencil). The only other candidates in that range,
  `+0x21178` and `+0x21194`, are the `slot` fields of two doorway descriptors
  read as opcodes — data, not code.
- The indexed root `(A5,Dn.W)` resolves in every case to
  `Dn = descriptor.word(+0x00)` followed by `ADDA.L descriptor.long(+0x02)`
  (`+0x22AAE`, `+0x22BEE`, `+0x22C20`, `+0x24C1C`, `+0x24C8C`, `+0x24D52`), plus
  the chunk loader's own write path at `+0x1DC22`/`+0x1DD86`. A blind
  whole-image scan finds **13** valid 28-byte descriptors with `slot == 0x0C`,
  and the highest byte any of them reaches is **42,434** — exactly the start of
  the tail, zero overlap.

So the complete set of runtime reads of bytes 42,434–42,754 is the single
`BLTAPTH` at `+0x26388`, covering 42,524–42,754. Nothing reads 42,434–42,524.

**Paths tried (kept: these are the dead ends that cost two passes)**

| Approach | Result | Why it failed |
|---|---|---|
| Blind 28-byte descriptor scan filtered on `slot == 0x0C` | 13 records, none reaching past 42,434 | Correct, but only covers the *descriptor-driven* root. The stencil is reached by a hard-coded `ADDA.L`, which no descriptor scan can see. |
| Literal-constant census for the tail's offset 42,434 (16- and 32-bit) across S_1 | 0 hits — read as "nothing references the tail" | **The wrong constant.** The consumer adds 42,**524**, because the stencil is anchored 9 rows above the blit's destination. Searching a region's *first* byte only finds consumers that start there. |
| Cross-platform check against DOS `clipper.clp` for an 80×32 dungeon entry | None found | Correct but not decisive — the DOS port composites its doors differently and has no equivalent runtime stencil. A missing counterpart is not evidence of slack. |
| "All three tilesets decompress to exactly 42,754 while art ends at exactly 42,434" read as a fixed authoring-buffer signature | Plausible, and wrong | The constant length is just the constant *stencil* length. Two of the three tilesets store an all-zero stencil because their door leaves are square-topped, which looks like "padding" until you check the leaf masks. |
| Matching the tail against `doorway-1b`'s (the lintel's) mask | 140/320 bytes identical, ramp continues 9 rows further | Right family, wrong sibling. The stencil is derived from the **door leaf's** silhouette (1-px dilated), not the lintel's; the two share a generated ramp, which is why a partial match appeared. |

###### Slot `$10` (10,780 B) — pits, masked (confirmed)

Tables at S_1 `+0x21616` (5 records) and S_1 `+0x216DE` (2 records).

| Offset | Image | Geometry | Dest (x, y) |
|--------|-------|----------|-------------|
| 0 | Floor Pit D, left | 48×32 | (0, 95) |
| 1,344 | Floor Pit A | 144×30 | (32, 96) |
| 5,124 | Floor Pit D, right | 48×32 | (160, 95) |
| 6,468 | Floor Pit B | 96×14 | — |
| 7,644 | Floor Pit C | 64×8 | — |
| 8,092 | Ceiling Pit A | 144×16 | — |
| 10,108 | Ceiling Pit B | 96×8 | — |

Σ = 10,780 exactly.

> **Correction — "P3 = 320×269, 1 bit" and its successor "`= 1,540 × 7`, no
> confirmed decode" are both superseded.** The payload is not one image; it is
> the seven pit overlays above. The `1,540 × 7` factorisation was arithmetically
> true and led nowhere because it assumed a single geometry.

###### Slot `$B8` (6,528 B) — Door Slot (confirmed)

One image, 64×136, 6 planes, `6,528 = 8 × 136 × 6` exactly. Blitted by S_1
`+0x26282`: `d1 = 0x87` (136 rows), 8 bytes per row, `d4 = 9` (dest x = 72 px,
centred in the 208-px viewport), `d5 = 0x20` (row advance 32 → stride 40 B).
DOS `018_Door Slot` is 64×136.

###### Slot `$C4` (28,680 B) — stairs, 6 planes (confirmed)

Described by a third record format — **18-byte** records at S_1 `+0x25246`,
14 of them (7 per flight):
`slot(w), src(l), widthBytes−1(w), rows−1(w), srcModulo(w), destModulo(w),
srcStartByte(w), destOffset(w)`.

| Offset | Image | Geometry |
|--------|-------|----------|
| 0 | Stairs flight A, depth 0 | 112×109 |
| 9,156 | Stairs flight A, depth 1 | 64×69 |
| 12,468 | Stairs flight A, depth 2 | 48×52 |
| 14,340 | Stairs flight B, depth 0 | 112×109 |
| 23,496 | Stairs flight B, depth 1 | 64×69 |
| 26,808 | Stairs flight B, depth 2 | 48×52 |

Σ = 28,680 exactly, the two flights being byte-for-byte the same size. The
destination offsets in the table are 366 / 809 / 1,010 for the three centred
pieces — at a 40-byte stride that is x = 48 / 72 / 80, i.e. `(208 − width) / 2`
in every case. The four remaining records per flight are the narrower
left/right variants drawn when the staircase is in an adjacent square
(`srcModulo`/`srcStartByte` clip a half-width stripe out of the same image).

**Flight A = `Stairs Up`, flight B = `Stairs Down` — CONFIRMED** against the
DOS port's own labelled catalog. `clipper.clp` names entries 43-45
`Stairs Down 1/2/3` and 46-48 `Stairs Up 1/2/3`, at exactly the Amiga's three
sizes (112×109, 64×69, 48×52). Comparing each Amiga flight to each DOS flight
by **region agreement** (map every Amiga palette index to the DOS colour it
most often coincides with, then score the fraction of pixels that agree — a
palette-independent test that reduces to "are these the same artwork?"):

| Amiga | vs DOS `Stairs Up` | vs DOS `Stairs Down` |
|---|---|---|
| flight A depth 0 (112×109, 12,208 px) | **1.0000** / 0.9981 | 0.6394 / 0.6461 |
| flight A depth 1 (64×69, 4,416 px) | **1.0000** / 0.9986 | 0.6350 / 0.6399 |
| flight A depth 2 (48×52, 2,496 px) | **1.0000** / 0.9992 | 0.7965 / 0.7516 |
| flight B depth 0 | 0.6480 / 0.6394 | **1.0000** / 1.0000 |
| flight B depth 1 | 0.6504 / 0.6343 | **1.0000** / 0.9887 |
| flight B depth 2 | 0.7524 / 0.7957 | **1.0000** / 0.9992 |

(Each cell is Amiga→DOS / DOS→Amiga.) 19,120 px per flight, 38,240 px total,
the correct pairing perfect in one direction and ≥98.9 % in the other, the
wrong pairing 20-36 points worse at every depth. The two flights are *not*
in DOS catalog order — this is the counter-example that retires the
"Amiga table order matches DOS catalog order" heuristic for this chunk (see
the door-way pieces below, stored `1B, 1A, 1C`).

Independent corroboration from the map data: a `bcdfs` Stairs/Teleport/Spinner
structure (type `0x12`) carries its sub-kind in word **`+0x10`** —
`ResolveTargetSquare` returns stairs-code 3 for `2` and `3`, **spinner**-code 4
for `4`, and **teleport**-code 9 otherwise (S_1 `+0x27C86`-`+0x27CA6`).
(The "teleport-code 4" label this sentence originally carried is corrected —
see "Special-square sub-kinds" in the movement section, where 4 = Spinner and
9 = Teleport are confirmed against the official clue book.) Sub-kind correlates
1:1 with `gfxNumber`: `2 ↔ 0x0043` (38 records) and `3 ↔ 0x0044` (36). Each
record's words `+0x0C`/`+0x0E` are the destination column/row (copied into the
caller's X/Y at S_1 `+0x27C64`). Resolving those against the destination
square's `level` nibble: sub-kind `2` goes to a **lower** level number in 27 of
its 33 resolvable cases (3 same-level, 3 higher), sub-kind `3` to a **higher**
one in 26 of 35 (6 same-level, 3 lower) — a clean mirror pair, consistent with
`2`/`0x0043` = flight A = **Up** and `3`/`0x0044` = flight B = **Down**.

> **Correction — this is no longer a hypothesis, and the `level`-nibble
> assumption it rested on is no longer load-bearing.** Flight A = Up /
> flight B = Down is **confirmed** by the pixel comparison against DOS
> `clipper.clp`'s own labelled entries 43-48 (see "Still open" below:
> 1.0000/~0.999 for the correct pairing at all three depths versus 0.63-0.80
> for the wrong one, 38,240 px), and **independently re-derived three further
> ways** by the automap pass — see "bcdfa — UI / Automap Resource Bank" →
> "The 24 automap tiles" → "Verification (ground truth)": the clue book's
> `STAIRS DOWN` legend icon cross-correlates to the Level 1 stairs square
> (which is `+0x10 = 3`), the automap tile art for the two flights is the
> same up/down wedge pair the legend uses, and a 28-level census shows the
> dungeon's **top** level carrying only `0x44` and its **bottom** level only
> `0x43`, with levels 7/8 forming a matched 11 × `0x44` / 11 × `0x43` pair.
> The earlier note here ("Investigated further, still open … the
> appearance-based A=Up/B=Down guess is left as-is") is superseded: the guess
> was right, and four independent oracles now agree.

###### Slot `$C8` (6,060 B) — Panel Top + Fountain (confirmed)

Blitted by the unrolled routine at S_1 `+0x25340`, which reads
`$C8(A5) + 0x6CC` for one and `$C8(A5) + 0` for the other:

| Offset | Image | Geometry | Dest (x, y) |
|--------|-------|----------|-------------|
| 0 | Panel Top | 80×29, 6 planes | (64, 9) |
| 1,740 | Fountain | 80×72, 6 planes | (64, 38) |

Σ = 6,060 exactly (`0x6CC` = 1,740 is itself Panel Top's byte size). Both are
centred: `(208 − 80) / 2 = 64`. The routine has a second branch that reads from
`+0x17AC` (6,060) — one fountain frame past the end of the chunk; no tileset
ships a chunk that long, so the branch is either dead or reads uninitialised
memory. Noted, not explained.

###### Slot `$20` (1,330 B) — Pull Chains, masked (confirmed)

Table at S_1 `+0x26000`, 4 records: 16×38 at 0, 16×25 at 532, 16×19 at 882,
16×13 at 1,148 — Σ = 1,330 exactly, and dimension-for-dimension DOS
`054–057 Pull Chain 0–3`.

###### Slot `$1C` (4,186 B) — wall buttons, masked (confirmed)

Table at S_1 `+0x20D3E`, **18** records tiling the chunk exactly. Every one
matches a DOS `clipper.clp` entry at identical dimensions, in DOS order:

| Offset | Geometry | DOS name |
|--------|----------|----------|
| 0 / 70 | 16×5 | Secret Button 1 Out / In |
| 140 / 364 | 16×16 | Normal Button 1 Out / In |
| 588 / 714 | 16×9 | Normal Button 2 Out / In |
| 840 | 32×30 | Special Button 1R |
| 1,680 | 32×10 | Special Button 1L |
| 1,960 | 32×19 | Special Button 2R |
| 2,492 | 32×6 | Special Button 2L |
| 2,660 | 16×11 | Special Button 3R |
| 2,814 | 16×4 | Special Button 3L |
| 2,870 / 3,178 | 16×22 | Special Button 1RS / 1LS |
| 3,486 / 3,696 | 16×15 | Special Button 2RS / 2LS |
| 3,906 / 4,046 | 16×10 | Special Button 3RS / 3LS |

##### DOS `Floor 2` and `Ram Block` — **SOLVED, closes `tileset-missing-dos-items`**

Both of the two DOS `clipper.clp` dungeon assets this project could not
place on the Amiga side (`Pressure Plate 1/2 Up/Down` were already found in
`bcdfa`'s UI panel bank, see that section) turn out to have Amiga
counterparts after all — neither is a floppy-space-saving cut.

**`Floor 2` (208×68) is the runtime horizontal mirror of the already-
extracted `floor` sub-image, not a second floor texture.** DOS's own
`Floor 1` and `Floor 2` entries are **byte-for-byte identical after a
horizontal flip** (`hflip(Floor 1) == Floor 2`, 14,144/14,144 px exact) —
the DOS port simply bakes out both orientations as static raster images,
the way it already does for door-way pieces and other assets Amiga mirrors
at runtime via `DrawSubImageMirrored`'s bit-reverse LUT (`+0x279C0`, see
"Slot 176"'s mirrored side-wall table above). `bcdfx`'s `floor` sub-image
(slot `$B0`, offset 44,928, the tan/sandstone tileset used for levels 1-4)
matches DOS `Floor 1` at **100.000%** on an index-rank comparison (14,144/
14,144 px identical relative brightness ordering; raw RGB differs only by
Amiga's 12-bit-per-channel vs. DOS's 6-bit-per-channel colour scaling, the
same quantization gap already documented throughout this file) and an edge-
structure correlation of **0.9519** (`hflip` raises both to 0.9519/0.9953,
confirming the mirror relationship independently of the index-rank check).
`bcdfy`'s and `bcdfz`'s own `floor` sub-images are **genuinely different
art** (raw-index agreement with `bcdfx`'s only 22-24%, and neither
correlates with `Floor 1`/`Floor 2` above chance, edge-corr ≈ 0) — DOS only
ships one floor pattern (recolour aside, per-ramp), so `Floor 2` is
specifically `bcdfx`'s floor, mirrored, not a second tileset's floor.

**`Ram Block` (32×20) is an unnamed record in `bcdfa`'s `0x036FD`
(paperdoll) stream, in the tail this doc already calls "unnamed" at stream
range `16,448…17,008`** (descriptor S_1 `+0x210DA`, slot `0x04`, flags
`0x0000` ⇒ 7-plane mask-first). Rendered and compared against DOS `Ram
Block`: **100.000% mask agreement** (640/640 px) and a luminance/edge
correlation of **0.995/0.994** — both show the same object (a horizontal
log/battering-ram shape with two darker rounded caps). This record was
never extracted into a named asset before this pass; see
`docs/blackcrypt/amiga/data-structure.md`'s "bcdfa — Large Equipment-Panel
Art" § "Rest of the stream" record map, row `16,448…17,008`, for its
context among the other 47 descriptors of that stream (still otherwise
unnamed — this was the only one checked against `Ram Block` specifically).

Neither finding required new disassembly: `Floor 2` came from re-examining
the already-fully-solved tileset sub-image table with a fresh oracle
comparison (DOS's own two floor entries against each other, not just
against Amiga), and `Ram Block` came from checking the already-enumerated-
but-unnamed paperdoll-stream tail records (from the "Large Equipment-Panel
Art" section's 48-descriptor scan) against the one remaining unmatched DOS
dimension. Both are cross-platform silhouette/structural matches, no code
tracing needed — consistent with the rest of this row's history (the four
Pressure Plates were found the same way, in a bank nobody had checked
against them yet).

##### Still open

| Item | Size | Best current result |
|------|------|---------------------|
| ~~Slot `$0C` tail~~ | 320 B at 42,754 − 320 | **SOLVED — it is the door-animation clip stencil, read every frame by S_1 `+0x26388` as `BLTAPTH`.** The "exporter slack" verdict below is **refuted**; see "Slot `$0C` tail (42,434–42,754) — the door-animation clip stencil" above for the trace, the three zero-deviation oracles, and why the shape-based negative failed. The row's original text is kept below for the record. Geometry re-confirmed independently of the width argument: `bcdfz`'s copy is *mirror-symmetric about the 10-byte row* (row 10 reads `ff ff fe 00 00 00 00 7f ff ff` — byte 2 `0xFE` against byte 7 `0x7F`), which fixes the width at 80 px without appealing to neighbouring sub-images. **What the bytes are:** rows 0-8 solid, then an aperture that widens by exactly 2 px per row — set-pixel counts 48, 46, 44 … 4. That is the *same generated wedge* as `doorway-1b`'s (the depth-1 lintel's) mask plane, which runs 54, 52, 50 … 22 over its rows 10-26; tail rows 9-22 are **byte-identical to `doorway-1b` mask rows 13-26** (140 of the 320 bytes, found by searching the decoded chunk for the tail's own bytes), and the tail then carries the ramp 9 rows further than the lintel needs. **Why slack, not an asset:** (a) all three tilesets decompress slot `$0C` to *exactly* 42,754 B while their descriptor-covered art ends at *exactly* 42,434 B, even though `bcdfx` and `bcdfy` agree on only 16,076 of those 42,754 bytes — the signature of a fixed-size authoring buffer, not of shared content; (b) `bcdfx`/`bcdfy`'s tail is the degenerate case (solid cap, then all zeros — no wedge at all), so the three files do **not** share a silhouette, contradicting the earlier note; (c) the DOS port has no counterpart — `clipper.clp`'s dungeon set contains no 80×32 entry, and its only numbering gap (entries 77/78) is the zero-length `Start/End Level Specifics` markers, not images; (d) besides the earlier zero-hit descriptor scan, a literal-constant census finds **0** occurrences of the tail's chunk offset 42,434 anywhere in S_1 (16- and 32-bit forms), while the immediately preceding `doorway-3` offset 38,794 has exactly 1 (its own descriptor at S_1 `+0x21208`) — so the census can find real references and the negative is meaningful. Remaining doubt: nothing *proves* the exporter wrote it rather than the artist, so this is labelled hypothesis, not confirmed. |
| ~~Which stairs flight is Up vs Down~~ | — | **SOLVED — flight A = `Stairs Up`, flight B = `Stairs Down`.** Confirmed against DOS `clipper.clp`'s own labelled entries 43-48 by palette-independent region agreement: **1.0000 / ~0.999** for the correct pairing at all three depths versus 0.63-0.80 for the wrong one, 38,240 px compared. The three failed code searches recorded here (`MOVEA.L $C4(A5)`, `MULU.W #$12`, `CMPI.B #$12` dispatch) stay on record as dead ends, and the DOS *catalog-order* heuristic is now positively **refuted**, not merely unsafe: the Amiga stores Up first, DOS lists Down first. The lesson is that the oracle was available all along — comparing the *pixels* against the DOS port's named entries, which is this project's standard move, rather than reasoning about the order they appear in. See the full table in the slot `$C4` section above. |

Slot `$0C` tail, `bcdfz`'s copy, rendered at 10 bytes (80 px) per row, `#` = set
bit / `1` = opaque, `.` = clear:

```
rows 0-8:  solid fill (0xFF x 10 bytes/row)
row  9:    ########################................................########################
row 15:    ##################............................................##################
row 20:    #############......................................................#############
row 25:    ########................................................................########
row 31:    ##............................................................................##
```

##### bcdfy — a third, partial tileset (confirmed)

> **Correction:** the claim that follows this box (kept for the record, not
> deleted) is wrong. "bcdfy is mostly `0xFF` bytes … mostly empty/fill data
> with sparse content" was written after decoding only bcdfy's first RLE
> payload (632 B) and never scanning the other 177 streams in the file. A
> parallel investigation this session flagged a conflicting lead — that
> bcdfy "carries the same 55,536 / 12,460-byte payloads as bcdfx, just at
> different stream offsets" — which is **confirmed** below, re-derived from
> scratch against `scripts/bclib/rle.py`, independent of that lead.
>
> Full stream census of `bcdfy` (`bclib.rle_streams`, same code as bcdfx/z):
> 178 RLE streams total (matches the old stream count, which was correct —
> only the "mostly empty" interpretation of it was wrong). Searching all 178
> streams' decompressed sizes against bcdfx/bcdfz's known payload sizes finds
> exactly two matches, each occurring exactly once, zero collisions:
>
> | Target size | bcdfx/bcdfz payload | Found in bcdfy at | Raw offset | Raw size |
> |---|---|---|---|---|
> | 55,536 B | P2 — front walls + ceiling + floor | stream 44 | 48,725 | 41,716 |
> | 12,460 B | P6 — pillar ×3, masked | stream 45 | 90,441 | 5,036 |
>
> Applying the exact confirmed bcdfx/bcdfz P2 and P6 sub-image offset tables
> (above, unmodified) to these two streams decodes all 8 sub-images with **no
> short-data truncation** — every offset/size pair fits inside the payload
> with bytes to spare, which would not happen by chance against arbitrary
> data. Rendered (`textures/dungeon-bcdfy.png`, built by `scripts/render_all.py`):
> `wall0` (176×123), `wall1` (112×78), `wall2` (64×57), `floor` (208×68),
> `pillar_a/b/c` (80×116 / 48×72 / 32×47, masked) all show a coherent,
> recognizable carved-stone wall/pillar motif (ornate frame with a
> skull/mask medallion) — visually distinct from both bcdfx (tan sandstone)
> and bcdfz (rough-hewn stone). Confirmed **not** a duplicate of bcdfx's P2:
> 39,978 of 55,536 bytes differ byte-for-byte between bcdfx's stream 2 and
> bcdfy's stream 44. `ceiling` (208×30) decodes to 4,680 bytes of literal
> `0x00` — a real, deliberate flat-black ceiling tile for this set, not a
> decode failure (bcdfx/bcdfz's ceiling sub-images use palette indices
> 26–29/58–63 at the same offset/size, so the all-zero result is bcdfy's own
> content, not a structural mismatch).
>
> ~~Palette: none of the five `bcdfu` accent variants (`0x03EC`–`0x04EC`) is
> confirmed for bcdfy specifically — same open question as bcdfz. All five
> render plausible, coherent output (tan/gold, violet, olive/mossy, neutral
> grey, cold blue-grey); appearance alone can't decide, per the existing
> caveat above. `scripts/render_all.py` uses the same default (variant 0)
> already used for bcdfx/bcdfz, which is a placeholder choice, not a finding.~~
>
> > **Correction — resolved by code, not by appearance.** The ramp is picked
> > per *level*, and the tileset file is picked per level too, by the same
> > routine (S_1 `+0x1A5CC`). `bcdfy` is loaded **only for level 5**, and level
> > 5's ramp index is **1** (violet/plum). `bcdfz` is loaded only for levels
> > 6–11, all of which select ramp **2** (bone/warm cream). `bcdfx` covers
> > levels 1–4 (ramp 0, tan) and 12–13 (ramp 3, grey). Renders should therefore
> > use **ramp 1 for bcdfy and ramp 2 for bcdfz**; variant 0 is correct for
> > bcdfx only in its levels-1–4 role. `scripts/render_all.py`'s blanket
> > variant-0 default is now a known-wrong placeholder for `bcdfy`/`bcdfz`.
> > Note the flat-black ceiling above is consistent with level 5 being a
> > deliberately distinct themed level. See "Dungeon tileset selection".
>
> ~~**What did NOT match:** the other five bcdfx/bcdfz payload sizes — 14,448
> (P0, side walls), 42,754 (P1, doors), 10,780 (P3), and 11,580 twice (P4
> alcove, P5 plaque) — occur **zero** times among bcdfy's other 176 streams.
> So bcdfy is not a full 7-payload counterpart to bcdfx; only the front-wall/
> ceiling/floor set and the pillar set have a same-size sibling so far.
> Streams 43 (42,923 B) and 46 (8,772 B) are close in size to the door
> (42,754 B) and alcove/plaque (11,580 B) payloads respectively but do not
> match exactly and have not been decoded/verified — noted as an open lead,
> not a finding.~~
>
> > **Correction — `bcdfy` carries 7 of the 12 chunks, not 2 of 6.** The
> > blind stream census could not see them: `bcdfy` stores its side-wall chunk
> > **uncompressed** (14,448 B verbatim at file offset 0, directory
> > `compressed = 0`), and its door chunk compresses to a *different* raw size
> > than `bcdfx`'s, so neither shows up in a decompressed-size match. Read
> > through the container directory, `bcdfy` has slots `$08` (side walls),
> > `$0C` (doors, 42,754 B — the "stream 43, 42,923 B" near-miss was the
> > adjacent stream, not this one), `$B0` (walls/ceiling/floor), `$14`
> > (pillars), `$B8` (door slot), `$C4` (stairs) and `$20` (pull chains). It
> > genuinely lacks only slots `$10` (pits), `$BC` (alcove), `$C0` (plaque),
> > `$C8` (panel/fountain) and `$1C` (buttons) — 47 of the 84 sub-images.
> > All 46 decode at full length with no truncation and render as a coherent
> > violet/plum tileset.
>
> Extracted to `public/assets/blackcrypt/amiga/textures/dungeon-bcdfy.{png,json}`
> (8 sub-images) by the size-based payload search in `scripts/render_all.py`
> (`find_payload_by_size`), which replaced the old fixed-stream-index lookup
> so the same code path now serves bcdfx, bcdfy and bcdfz without a
> per-file special case.
>
> > **Correction — `find_payload_by_size` is retired; the extractor now reads
> > the real chunk directory.** The size-based search above was already
> > superseded in substance by the "46 of 83" correction two boxes up (which
> > found `bcdfy`'s side-wall/door/pillar/stairs/chain chunks that a
> > decompressed-size scan is structurally blind to, since two of them are
> > stored raw and the door chunk compresses to a size no `bcdfx`/`bcdfz`
> > chunk shares) — this entry records that the code has caught up. A
> > `re-codebreaker` escalation traced the game's own 20/28/18-byte
> > blit-descriptor tables end to end and confirmed every sub-image offset
> > byte-exact; `scripts/bclib/bcdfxyz.py` now reads the in-executable chunk
> > directory (`read_chunk_directory`/`read_chunks`) and the confirmed
> > `SUB_IMAGES` geometry table (`iter_sub_images`) directly, the same way
> > `bcdfv.py` reads `bcdfv`'s block table. `scripts/render_all.py` calls it
> > per tileset file. Output: **84 named sub-images for `bcdfx` and `bcdfz`,
> > 47 for `bcdfy`** — exactly the documented counts, zero short-data
> > warnings, reproducing the escalation probe's own
> > "22 of 654,736 opaque pixels have an out-of-palette index" result
> > unchanged. Sub-image names changed from the old ad-hoc
> > `wall0`/`alcove_a`/`pillar_a` set (tied to the old `DUNGEON_GROUPS`
> > payload numbering) to a full, hyphenated label per sub-image matching
> > this document's own tables 1:1 (`wall0-face`, `door-type1-1`,
> > `stairs-flight-a-depth0`, `special-button1-rs`, ...) — see
> > `scripts/bclib/bcdfxyz.py`'s `SUB_IMAGES` for the complete list.

**Superseded claim, kept for the record:** bcdfy is mostly `0xFF` bytes — the
first RLE payload produces only 632 decompressed bytes (vs 14,448 for
bcdfx/bcdfz), suggesting it contains mostly empty/fill data with sparse
content.

#### Chunk boundaries — read the directory, do not scan for RLE streams

> **Correction — the "payload boundaries" tables that used to sit here were
> produced by walking the files for `0x00`-terminated RLE streams, and they are
> wrong in three ways.** (1) They are off by one in numbering (`P1` was chunk
> 0). (2) They stop at ~70–74 % file coverage and label the rest "post-P7
> data" — there is no post-chunk data; the directory accounts for every byte.
> (3) Any chunk stored **uncompressed** is misread: `bcdfz`'s pillar chunk
> really is 12,460 B verbatim at 109,532, but RLE-decoding it yields 2,387 B of
> garbage, which is where the bogus "`bcdfz` P6 is only 2,387 B" came from.
> Five chunks per file are stored raw (`compressed = 0`).

Offsets are the running sum of the directory's `size` fields; there is nothing
else in the file. Coverage is 144,169 / 144,169, 117,937 / 117,937 and
160,806 / 160,806 — **100 %, 3/3 files, zero deviation.**

| # | Slot | `bcdfx` off / raw / dec | `bcdfy` off / raw / dec | `bcdfz` off / raw / dec |
|---|------|--------------------------|--------------------------|--------------------------|
| 0 | `$08` | 0 / 9,731 / 14,448 | 0 / **14,448 raw** / 14,448 | 0 / 10,989 / 14,448 |
| 1 | `$0C` | 9,731 / 31,189 / 42,754 | 14,448 / 34,277 / 42,754 | 10,989 / 33,840 / 42,754 |
| 2 | `$B0` | 40,920 / 32,166 / 55,536 | 48,725 / 41,716 / 55,536 | 44,829 / 38,296 / 55,536 |
| 3 | `$10` | 73,086 / 6,573 / 10,780 | — | 83,125 / 8,227 / 10,780 |
| 4 | `$BC` | 79,659 / 7,409 / 11,580 | — | 91,352 / 8,226 / 11,580 |
| 5 | `$C0` | 87,068 / 8,902 / 11,580 | — | 99,578 / 9,954 / 11,580 |
| 6 | `$14` | 95,970 / 10,866 / 12,460 | 90,441 / 5,036 / 12,460 | 109,532 / **12,460 raw** / 12,460 |
| 7 | `$B8` | 106,836 / **6,528 raw** / 6,528 | 95,477 / **6,528 raw** / 6,528 | 121,992 / **6,528 raw** / 6,528 |
| 8 | `$C4` | 113,364 / 20,599 / 28,680 | 102,005 / 14,602 / 28,680 | 128,520 / 22,197 / 28,680 |
| 9 | `$20` | 133,963 / **1,330 raw** / 1,330 | 116,607 / **1,330 raw** / 1,330 | 150,717 / **1,330 raw** / 1,330 |
| 10 | `$C8` | 135,293 / 4,690 / 6,060 | — | 152,047 / 4,573 / 6,060 |
| 11 | `$1C` | 139,983 / **4,186 raw** / 4,186 | — | 156,620 / **4,186 raw** / 4,186 |

Every chunk's *decompressed* size is identical across all three files — the
tilesets are three skins of one fixed layout, not three different containers.
No chunk is byte-identical between files (12/12 distinct MD5s in `bcdfx` vs
`bcdfz`), so none of it is shared geometry data.

#### Cross-platform coverage against the DOS manifest

`public/assets/blackcrypt/dosvga/sprites/dungeon.json` has 76 entries. **70 are
now accounted for**: 65 match an Amiga sub-image at *identical* width × height,
and 5 more (`Wall 0`, `Wall 1`, `Wall 2`, `Wall Left`, `Wall Right`) match by
decomposition — DOS pre-composites what the Amiga keeps as separate pieces, and
the Amiga widths sum to the DOS width exactly in all five cases
(`16+176+16 = 48+112+48 = 64+80+64 = 208`; `16+32+16+16 = 80`). Zero
dimension mismatches. The 6 unmatched entries are listed under "Still open".

---

### 3D Viewport Compositing — the render loop (**solved end to end**)

This traces the actual code that decides *which* wall/side-wall sub-image goes
at *which* depth and blits it — not just the sub-image geometry (already
confirmed above). All addresses below are **S_1-relative in the decompressed
`bcdft` image** (`data/blackcrypt/extracted/bcdft_decompressed.bin`), found
with a from-scratch capstone disassembly (`capstone.CS_ARCH_M68K |
CS_MODE_BIG_ENDIAN`), disassembling at **every 2-byte-aligned offset**
independently (not a single linear walk, which desyncs through the data
tables interleaved with this code) and cross-referencing operands against a
target address list. `A5` throughout is the **graphics-kernel globals frame**
already established for the tileset chunk directory — loaded by the
two-instruction helper at S_1 `+0x2030E` from the pointer at S_1 `+0x2099E`
— **not** `bcdfp`'s private per-overlay `A5` frame; `$B0(a5)` etc. below are
the same `d16(A5)` chunk-directory slots already documented ("The container
directory and the full slot inventory").

> **Correction — the decompressed image is already *relocated*; absolute
> addresses in it are `0x80058 + S_1 offset`, not the S_1 offset.** An earlier
> pass concluded the four per-square renderers had "**zero** direct `BSR`/`JSR`
> references and **zero** raw 4-byte literal-address occurrences" anywhere in
> S_1 or S_2, and inferred a computed/indirect dispatch. **That inference was
> wrong, and so was the premise under it.** `tools/bcdft_decompress/emu.c` runs
> the game's own S_4 engine at `BASE = 0x80000`, and its **relocation-fixup
> pass runs to completion** (that is exactly what the "truncated decompression"
> correction restored). S_1's data therefore sits at
> `BASE + 84 + 4 = 0x80058`, and every `JSR $xxxxxx.l` operand and every
> stored code pointer in the artifact is `0x80058 + offset`. Searching for the
> bare offset finds nothing **by construction**:
>
> | Interpretation | Distinct `JSR/JMP xxx.l` operands landing inside S_1 | …that decode as code | …with a `LINK`/`MOVEM`-push prologue |
> |---|---|---|---|
> | raw S_1 offset (the earlier assumption) | **0** | 0 | 0 |
> | `0x80058 + offset` (correct) | **267** | 261 (97 %) | 194 |
>
> Under the corrected base all four renderers resolve immediately:
> `+0x220F0` = `$A2148` (2 sites), `+0x221C0` = `$A2218`, `+0x227DA` =
> `$A2832`, `+0x22B8A` = `$A2BE2`. There is no indirect dispatch and no
> jump table of function pointers anywhere in the image — a scan for runs of
> ≥3 consecutive S_1-range longwords in S_1 **and** S_2 returns **0 runs**.
> Two further scan gaps compounded the false negative: an operand regex that
> matched `$xxxx.l` but not the `JSR $xxxx(pc)` form (which is how ~40 % of
> intra-module calls are encoded here — adding it took the xref map from 2,033
> to 2,591 sites and is what finally surfaced the driver), and a linear
> disassembly that desyncs through this region's inline tables. Lesson, in the
> general form: *when a decompression/loader harness applies relocation, the
> artifact's address space is the harness's, not the file's.*

#### Two rendering primitives, confirmed by register trace

- **`DrawSubImage` (S_1 `+0x2300A`) / `DrawSubImageMirrored` (`+0x2304A`)** —
  already known as the consumer of the 20-byte front-wall/ceiling/floor
  descriptor. Tracing its body: it is a **plain 68000 `MOVE.W (a2)+,(a3)+`
  copy loop** (word at a time, per row, per one of 6 planes) — **not** the
  hardware blitter. `a1 = $464(a5)` is a 6-entry array of screen bitplane base
  pointers; each plane's destination is `a1[n] + descriptor.destOffset`. This
  confirms opaque front-wall/ceiling/floor pieces are composited by the CPU,
  while masked pieces (side walls, doors, pillars, buttons, …) go through the
  blitter — a real, previously-undocumented split in how this renderer works,
  not an assumption.
- **The generic masked-descriptor blitter** (already documented format) turns
  out to have **four entry points into one shared tail**, not one:
  `GenericMaskedBlitBuild` (`+0x24BF8`, builds the 28-byte descriptor from
  scratch) → `GenericMaskedBlitDispatch` (`+0x24C00`, descriptor already
  built) → a small record-copy shim at `+0x24BAE` (copies a *compact*
  6-field source record — used by pull-chains/buttons-style callers — into
  the 28-byte layout) → **`+0x24C6E`**, which is the actual common tail:
  writes `d0`/`d1` into the descriptor's `+0x12`/`+0x14` (dest X/Y, confirmed
  field-for-field against the already-documented 28-byte record) and branches
  on flag bit 0 of `+0x16` into the real blitter setup. `DrawDoorAtDepth`
  (below) calls `+0x24C6E` directly, i.e. it already has a ready-made 28-byte
  descriptor in hand and only needs X/Y patched in.

#### `DrawWallPieceDispatch` (S_1 `+0x22C78`) — confirmed

```asm
22c78  tst.w   d0
22c7a  bmi.b   $22cb0            ; d0 < 0            → front-wall-row path
22c7c  cmpi.w  #$3, d0
22c80  blt.b   $22cb0            ; 0 ≤ d0 < 3          → front-wall-row path
22c82  ...                       ; d0 ≥ 3               → side-wall path
```

Takes `d0` = a signed **piece selector** and `d1` = a secondary index:

- **`d0 < 3`** (including negative): front-wall-row path (`+0x22CB0`).
  `d1 = (d1×3 + d0+1) × 20` indexes the confirmed **9-record, 20-byte**
  front-wall/ceiling/floor descriptor table — `FrontWallTableDirect`
  (`+0x22CE2`) or `FrontWallTableMirrored` (`+0x22D96`), selected by
  `TST.B $48F(A5)`; the picked descriptor is drawn with `DrawSubImage` /
  `DrawSubImageMirrored`.
- **`d0 ≥ 3`**: side-wall path. `subq.w #3,d0` recovers the depth (0-3);
  `d1 = d1×2 + d0` indexes the confirmed **8-record, 28-byte** side-wall
  descriptor table — `SideWallTableDirect` (`+0x22E4A`) or
  `SideWallTableMirrored` (`+0x22F2A`), same `$48F(A5)` selector — dispatched
  through `GenericMaskedBlitDispatch` (`+0x24C00`, hardware blitter, minterm
  `$0FCA`).

**`A5+$48F` is a global, per-frame mirror flag** read at 6 sites across the
graphics kernel (`+0x21750`, `+0x22C8E`, `+0x22CC2`, `+0x230B6`, `+0x230FE`,
`+0x24A86`, `+0x250AE`) that uniformly picks the *mirrored* wall/ceiling/floor
descriptor table over the *direct* one — this is almost certainly how a
single authored wall-art direction is flipped for the opposite-facing view,
the same mechanism already documented per-descriptor (`flags bit 10 =
horizontal mirror`) but applied here as one flag for the whole row. **The
write site was not found this pass** (searched literal `$48F` writes across
the whole image; a `BCHG.B #2,$48F(A0)` hit at `+0x2492E` did not survive
re-inspection — that address falls inside a misaligned data run in a linear
disassembly and disappears once decoded from its real instruction boundary,
so it is **not** treated as a finding here).

#### `DrawSquareRecord` (S_1 `+0x220F0`) — the per-square corridor renderer, confirmed

Called with a small caller-supplied record (reached via `a2`, standard
stack-argument convention — `LEA $4(A7),A0` before the `MOVEM` push, i.e. the
caller `PEA`s the record's address before calling):

| Offset | Field (as used here) |
|--------|------------------------|
| `+0x00` | object/structure id — **`0xB9` (185) = "no structure, wall-only square"** |
| `+0x02` | depth-remaining counter (decremented on entry; drives which branch runs) |
| `+0x04` | signed lateral/side selector — magnitude doubles as the front-wall depth (0-2) |
| `+0x06`, `+0x08` | further fields, fed to the structure x/y-lookup helpers below |

- **`id != 0xB9`** (a structure occupies this square): computes screen (x, y)
  via three helpers — `+0x2201C` (compares `id` against 2 threshold constants
  at `+0x2223E` to pick 1 of 3 offset "families"), `+0x22042`
  (`descriptor = TABLE[id]`, 28-byte stride, table base `+0x22244`), `+0x2204E`
  (depth-indexed x/y delta) — then calls `GenericMaskedBlitBuild` (`+0x24BF8`)
  directly and **returns without touching any wall piece**. The `+0x22244`
  table reads **all zero** in the static decompressed image — S_1 is a BSS
  hunk (per the existing "bcdft — Data Carrier Overlay" entry), so this is a
  **runtime-populated scratch array**, presumably filled in per-level from
  `bcdfs` structure records at level load; that population code was not
  traced this pass.
- **`id == 0xB9`** (plain wall square): draws via `DrawWallPieceDispatch`
  (`+0x22C78`), called **up to twice**:
  - depth-remaining counter == 1 (this square terminates the line of sight):
    draw the **front-wall row** at depth `$04(a2)` (`d0 = $04(a2)`, the
    blocking wall), then **fall through** and also draw this square's own
    **side-wall pieces** one step nearer (`d0=3` or `4`, i.e. depth
    `$02(a2)-1`'s near/far side wall).
  - depth-remaining counter == 0 (nearest square, terminal case, reached via
    a separate entry at `+0x221B0`): draw only the near+far side-wall pieces
    at the fixed nearest depth.
  - depth-remaining counter > 1 (an intermediate square the sight line
    continues past): draw only its side-wall piece, no front wall.

  **This is the mechanism behind the "3 front-wall depths vs. 4 side-wall
  depths" asymmetry already recorded for the sub-image tables** — the
  blocking front wall is only ever drawn for the *one* square that
  terminates the sight line (at most 3 squares out), while every square
  along the sight line, including the party's own, contributes a side-wall
  strip.

#### `DrawDoorAtDepth` (S_1 `+0x221C0`) — confirmed, noted for the door-state pass

Same `a2` record convention. `BCLR.B #$F,D0` on `$00(a2)` — **bit 15 of the
id/state word is a live "door open" flag consumed directly by the renderer**,
not just game logic. The cleared value is compared against 2 constants to
pick between the two known door leaf types (`Door Type 0`/`Door Type 1`,
slot `$0C`). Depth `$02(a2) ≥ 2` indexes a screen-position table at
`+0x226DC` and calls `+0x24C6E` (the masked-blit tail, above) directly; depth
`< 2` (a door right next to the party) falls back to the generic
`DrawSquareRecord` (`+0x220F0`) via 5 inline pushed words
(`2, distance, 0, 1, id`) instead of using its own close-range code path. A
sibling agent is investigating door open/closed state in more depth this
session — this is flagged here so that work isn't duplicated, not fully
chased.

#### A family of per-square renderer variants exists — sibling entries noted, not traced

The exact same `LEA $4(A7),A0 / MOVEM / BSR +0x2030E / MOVEA A0,A2 / BCLR.B
#7,(A2) / CMPI.W #$B9,(A2)` preamble — including the same `0xB9` sentinel —
recurs at **`+0x227DA`** (falls into helpers `+0x22A76`/`+0x2293C` using a
`DIVU.W` perspective-scaling divide; likely pillars/statues, which are the
only structure class documented as needing progressive per-depth scaling)
and **`+0x22B8A`** (reads the 28-byte descriptor's mirror bit — `BTST.B
#2,$16(A3)` — directly, matching the already-documented "flags bit 10 =
horizontal mirror" one byte down). Both are almost certainly more members of
this same per-square-render-function family (candidates: stairs, alcove/
plaque, fountains/panels); neither was traced end-to-end this pass.

#### `DrawViewport` (S_1 `+0x02D46`) — the outer render driver (**confirmed**)

The routine the whole section was missing. One function, `+0x02D46` …
`+0x0369C` (next function starts `+0x0369E`), called from **49 sites in 31
distinct functions** — it is the general "redraw the 3D view" entry, invoked
after movement, turning, door toggles, combat, spells and cutscene steps.

Two of those callers are already-confirmed routines documented elsewhere in
this file, which is an independent identification check needing no new
analysis: **`MoveParty` (S_1 `+0x16CC4`)** calls it from 6 sites
(`+0x16DDA`, `+0x16DFC`, `+0x16EBA`, `+0x16EF2`, `+0x16F5E`, `+0x16F72` — one
per successful-move exit path) and **`TurnParty` (S_1 `+0x1702A`)** from
`+0x1707E`. The existing `TurnParty` write-up above already ends
"…conditional automap update, **viewport redraw**" — that unnamed redraw call
is this function.

It is a **two-phase build-then-drain renderer**, which is why no sight-line
loop calls a per-square renderer directly:

1. **Phase 1 — walk the 12 visible squares and *enqueue* render items** into a
   sorted display list (`+0x02D64`…`+0x0343C`).
2. **Phase 2 — drain the list in sorted order**, dispatching each item through
   a 14-entry jump table to the actual renderer (`+0x03440`…`+0x0359C`).

##### Phase 1 — the sight-line walk

```asm
02E92  MOVE.W  #$FFFF,$1E64(A4)   ; display-list head  = empty
02E98  CLR.W   $1E66(A4)          ; display-list count = 0
02E9C  MOVEQ   #$B,D5             ; D5 = draw-priority counter, 11 → 0
02E9E  MOVEQ   #0,D2              ; D2 = depth      0 → 3   (outer loop)
02EA0  MOVEQ   #2,D6              ; D6 = lateral ix 2 → 0   (inner loop)
       ...                        ; D6=2 ⇒ D3=0, D6=1 ⇒ D3=+1, D6=0 ⇒ D3=−1
03436  ADDQ.W  #1,D2 / CMPI.W #3,D2 / BLE  $02EA0
```

`4 depths × 3 laterals = 12 squares`, visited centre-first at each depth, with
`D5` counting **11 (nearest) down to 0 (farthest)** — that counter is the
painter's-algorithm sort key.

Per square, the candidate map cell is derived from the party position by a
4-way switch on the facing bitmask `1 << (facing+12)` (`+0x02FD0`), each arm
bounds-checking both axes against `0…0x3F` before committing:

| Facing | Case at | Forward step (depth `D2`) | Lateral step (`D3`, + = party's right) |
|--------|---------|---------------------------|-----------------------------------------|
| 0 (N) | `+0x02ECC` | `Y += D2` | `X += D3` |
| 1 (E) | `+0x02F0E` | `X += D2` | `Y −= D3` |
| 2 (S) | `+0x02F50` | `Y −= D2` | `X −= D3` |
| 3 (W) | `+0x02F90` | `X −= D2` | `Y += D3` |

(`$1740(A4)` = `partyY`/row, `$1742(A4)` = `partyX`/col, `$1744(A4)` = facing —
the fields already confirmed in "Party Movement / Facing State Machine".)

The square's longword is then read from the confirmed 64×64 map array and three
wall bits are tested:

```asm
02FFE  MOVE.W  -$6(A5),D0 / ASL.L #8,D0    ; row << 8
03006  MOVE.W  -$4(A5),D1 / ASL.L #2,D1    ; col << 2
03010  LEA     -$37CA(A4),A0
03014  MOVE.L  (A0,D0.L),-$E(A5)           ; the square longword
```

| Local | Value | Meaning | Enqueues |
|-------|-------|---------|----------|
| `-$12(A5)` | `1 << (facing+12)` | wall on the square's **forward** side | kind 5 — front-wall row, **only when `D2 < 3`** (`CMPI.W #3,D2 / BGE`) |
| `-$16(A5)` | `1 << (((facing+3)&3)+12)` | wall on the party's **left** | kind 6 — **only when `D3 == 0`** (`TST.W D3 / BNE`) |
| `-$1A(A5)` | `1 << (((facing+1)&3)+12)` | wall on the party's **right** | kind 7 — same `D3 == 0` gate |

Then `D4 = squareLongword & 0xFFF` is the **object index** into the 20-byte
record array at `A4−0x6E7A`; `BTST #7,(A2)` on the record's id byte selects
between the structure path (`+0x02C16`, enqueues kind 13 with the object index)
and a type switch on `objRec[+4] & 0xF0`. Multiple objects per square are
walked through `objRec[+0x12]` = next-object index, looping back to `+0x030BE`.

##### `AddRenderItem` (S_1 `+0x27D7A`) and the display list (**confirmed**)

`AddRenderItem(D0=kind, D1=depthKey, D2=priority, D3, D4, D5)` — an insertion
sort into a singly-linked list of **12-byte records**:

| Offset | Size | Field |
|--------|------|-------|
| `+0x00` | 1 | `kind` — index into the 14-entry drain jump table |
| `+0x01` | 1 | `depthKey` — the `D5` counter, 11 = nearest … 0 = farthest |
| `+0x02` | 1 | `priority` — primary sort key; bit 7 set = "draw first" |
| `+0x04` | 2 | arg → drain `D2` |
| `+0x06` | 2 | arg → drain `D3` |
| `+0x08` | 2 | arg → drain `D4` |
| `+0x0A` | 2 | next record index, `0xFFFF` = end of list |

Three globals drive it, and this is the cleanest confirmation of the load-base
correction above: the routine repurposes `A4`/`A5` as scratch (`MOVEM.L
D6/A2-A5,-(A7)`), so it cannot use small-data addressing and instead hard-codes
**relocated absolute** pointers — `$B29D2`, `$B29D4`, `$B29D6` — which resolve
to exactly `$1E64(A4)`, `$1E66(A4)`, `$1E68(A4)`, the same three consecutive
globals the driver initialises and reads A4-relatively. 3 of 3, zero deviation.

| Global | Role |
|--------|------|
| `$1E64(A4)` | list head index (`0xFFFF` = empty) |
| `$1E66(A4)` | record count / next free slot (post-increment) |
| `$1E68(A4)` | pointer to the record array — set at `+0x0D3F8` as `alloc() + 0x960` (2,400 B = 200 records of headroom); the drain loop indexes it with **`MULS.W #$C`**, so negative indices are representable |

Insertion: an item with `priority & 0x80` is prepended to the head (drawn
first); otherwise the list is scanned and the item placed by
`(priority, depthKey)`. Simulating the routine over the driver's own 12-square
sequence yields a drain order that is **non-decreasing in `depthKey`** —
farthest square first, nearest last, i.e. straightforward back-to-front
painter's algorithm — with all 17 enqueued items retained.

##### Phase 2 — the drain loop and its 14-entry jump table (**confirmed**)

```asm
03440  MOVE.W  $1E64(A4),D6          ; D6 = head
03444  CMPI.W  #$FFFF,D6 / BEQ  done
       ; rec = $1E68(A4) + D6*12
03456  D3 = rec+$06 ;  03464  D2 = rec+$04 ;  03472  D4 = rec+$08
03486  D0 = rec+$00                  ; kind byte
0358C  CMPI.W  #$E,D0 / BCC skip
03592  ADD.W   D0,D0 / MOVE.W $03570(PC,D0.W),D0 / JMP $0359A(PC,D0.W)
0359C  D6 = rec+$0A                  ; next, loop
```

Table at S_1 `+0x03570` (14 signed words, base `+0x0359A`), fully resolved:

| Kind | Handler | Action | Enqueued by |
|------|---------|--------|-------------|
| 0–3 | `+0x03550` | forwards `rec[+0]` (a **party-relative facing** 0–3) and `D4` to `+0x02A0E` — directional sprite (monster/NPC) | `+0x02B86`, which computes `(dir + 4 − partyFacing) & 3` and uses priority `0x46` / `0x32` |
| 4 | `+0x034D4` | `+0x00224C(D4, D2, D3)` | driver, priority `0x80` |
| **5** | `+0x0348E` | `D1 = D2` (depth), `D0 = D3` (lateral) → **`DrawWallPieceDispatch` `+0x22C78`** | driver, priority `0x64` |
| **6** | `+0x034A8` | `D1 = D2`, `D0 = 3` → `DrawWallPieceDispatch` (side wall, **left**) | driver, priority `0x64` |
| **7** | `+0x034B6` | `D1 = D2`, `D0 = 4` → `DrawWallPieceDispatch` (side wall, **right**) | driver, priority `0x64` |
| 8 | `+0x03542` | `+0x02806(D4, D2, D3)` | driver, priority `0x5A` |
| 9 | `+0x03542` | same | driver, priority `0x59` |
| 10 | `+0x034E4` | `+0x02627A()` | driver, priority `0x47` |
| **11** | `+0x034EE` | `+0x025CAE(D0=D2, D1=D3)`, then (see below) | driver, priority `0x3C` |
| 12 | `+0x034D4` | `+0x00224C(D4, D2, D3)` | driver, priority `0x3B` |
| **13** | `+0x034C4` | **`+0x025B0(D4, D2, D3)`** — the per-square structure dispatcher | `+0x02C16`, priority `0x3D` / `0x1E` |

##### `DispatchSquareObject` (S_1 `+0x025B0`) — the missing per-square dispatcher

The kind-13 handler, and the **only** caller of `DrawSquareRecord`
(`+0x220F0`), `DrawDoorAtDepth` (`+0x221C0`) and `+0x22B8A` in the normal
dungeon view. Signature `DispatchSquareObject(objIndex, depth, lateral)`
(`D2`/`D5`/`D6`); it reads the 20-byte record at `A4−0x6E7A + objIndex*20`,
follows `objRec[+0x10]` to a second record (call it `art`) for the direction
bytes, and computes `D7 = (art[+0x0C] + 4 − partyFacing) & 3` and
`D3 = art[+0x0B]` re-based the same way (left as-is when it is `4`).

| Branch | Condition | Call |
|--------|-----------|------|
| early-out | `id == 0x80B1` **and** `objRec[+0x08] > 0` **and** `pool[tbl[+0x36]].id != 0xC0` **and** `tbl[+0x00] != 2` (where `tbl = $1758(A4) + $1A24(A4)*168`) | **returns without drawing** — a conditional-visibility gate (`+0x0264A`) |
| `+0x026EC` | `objRec[+0x08] <= 0` | push `(id, depth, lateral, D3, D7)` → **`+0x22B8A`** |
| `+0x027B6` | `art[+0x0A] > 0` **and** `depth == 1` **and** `lateral == 0` | push `(id, D3, art[+0x0A]−1)` → **`DrawDoorAtDepth` `+0x221C0`** |
| `+0x027E4` | otherwise | push `(id, depth, lateral, D3, D7)` → **`DrawSquareRecord` `+0x220F0`**, then `CLR.B art[+0x0A]` |

The five-word push builds exactly the record `DrawSquareRecord` was
independently documented to read — `+0x00` id, `+0x02` depth, `+0x04` lateral —
with `depth`/`lateral` being the driver's own loop variables. That the
caller-side and callee-side field derivations were done by different methods
and agree field-for-field is a further zero-deviation cross-check.

The high bit of the id word (cleared by the renderers' `BCLR.B #7,(A2)`) is the
same flag the driver tests with `BTST #7,(A2)` at `+0x030D8`. The remaining
direct callers of `DrawSquareRecord` are `+0x07DC0` (a scripted spin/rotate
animation that hard-codes `id = 0x80C5`) and `+0x22230` (`DrawDoorAtDepth`'s
own close-range fallback, already documented).

> **Correction — resolved, not just flagged.** `DrawDoorAtDepth`'s record is
> built here with only **three** words, and its `+0x02` receives `D3` — a
> *party-relative direction* 0–3 (or sentinel `4`, "not rebased") — **never a
> depth**. This is now settled, not just the stronger-evidence guess: an
> exhaustive whole-`S_1` scan (every 2-byte-aligned offset disassembled
> independently, filtering `jsr`/`jmp`/`bsr`/`bra` whose resolved absolute
> operand equals `DrawDoorAtDepth`'s address `$A2218`) finds **exactly one**
> caller in the entire image — this call site, `+0x027B6` — and no other. That
> means `DrawDoorAtDepth` is *always* invoked with `depth` fixed at `1`
> (the caller's own gate, `depth == 1 && lateral == 0`) and its `$02(a2)` field
> is *always* the rebased direction, never a literal depth; the callee body's
> `subq.w #2,d0 / bmi` test (direction `< 2` ⇒ close-range fallback via
> `DrawSquareRecord`, direction `≥ 2` ⇒ position-table lookup + masked blit) is
> therefore a **direction** branch, not a depth branch, and the existing
> callee-side prose ("depth `$02(a2) ≥ 2` indexes a screen-position table at
> `+0x226DC`") is corrected in place: read "`$02(a2)` ≥ 2" there as *rebased
> direction*, not depth. `DrawDoorAtDepth`'s own descriptor-selection table
> (`+0x22634`, indexed by the two comparison words at `+0x2223E`) and its
> position table (`+0x226DC`) both read as **all zero** in the static
> decompressed image — same pattern as the already-documented `+0x22244`
> runtime structure-descriptor array (S_1 is a BSS hunk; these are
> level-load-populated scratch tables) — so `DrawDoorAtDepth`'s own leaf/frame
> choice cannot be resolved further from static analysis; this is a genuine
> dead end, not an unchased lead. It only ever fires for the single
> depth-1/lateral-0 "door right next to the party" case; every other depth is
> handled by the newly-traced kind-11 mechanism below, which *is* fully static
> and fully decoded.

> **This answers the "which per-square kind table selects the renderer" open
> question, and it is *not* the hypothesis previously recorded.** There is no
> "call every renderer and let each self-select" scheme: selection is a
> **two-level dispatch** — the drain loop's 14-entry `kind` jump table picks the
> renderer *family*, and `DispatchSquareObject` then picks the exact routine
> from the object record's id and door-state fields.

##### Kind 11 (S_1 `+0x034EE` stub → `+0x025CAE` + `+0x02613E`) — door frame + closed-leaf render, confirmed byte-exact

This is a **third, previously undocumented door-rendering path**, entirely
separate from `DrawDoorAtDepth`/`DispatchSquareObject` (which only ever fires
for the single depth-1/lateral-0 case, above) and from the `+0x112FC`/
`+0x0CF34` wall-tile-dispatcher consumer documented in "Door State" below. It
is enqueued directly by `DrawViewport`'s Phase-1 sight-line walk (the
`objRec[+4] & 0xF0` type switch at `+0x033D2`, not `DispatchSquareObject`),
and it accounts for doorway squares at every depth `DrawDoorAtDepth` doesn't
cover.

The kind-11 jump-table stub (`+0x034EE`) does more than forward to a handler —
it inlines extra logic after the call:

```asm
0034ee  move.w  d3,d1 / move.w d2,d0
0034f2  jsr     $025CAE.l                  ; ALWAYS called: D0=depth, D1=lateral
0034f8  ...     d0 = D4*20 ; a0 = -0x6E7A(a4)
003508  btst.b  #0,$f(a0,d0.l)             ; the confirmed door-open bit, record +0x0F.0
00350e  bne.b   -> end                     ; OPEN: stop here, no leaf art
003510  ...     re-read record[+0x00] into d2 (the id/gfxNumber word)
003536  jsr     $02613E.l                  ; CLOSED only: D0=depth, D1=lateral, D2=id
```

**`+0x025CAE(D0=depth, D1=lateral)` — the door *frame* (jamb/lintel), drawn
unconditionally (open or closed).** A small switch on `D0`: `D0==0` → nothing;
`D0==1` → an **L/C/R triptych at fixed Y=9** using 3 hard-coded (X, table)
pairs; `D0==2` → a triptych at **Y=20**; `D0≥3` → a single piece via an
inline `(lateral+1)×4`-indexed position table. Every descriptor it passes to
the confirmed masked-blit tail (`+0x24C6E`/`+0x24C76`) is a **valid,
self-consistent 28-byte generic blit descriptor** (`bytesPerPlane==(w/8)×h`,
the `BLTSIZE` identity, and `modulo+blitBytes==40` all hold, 7/7) in slot
`0x0C` — and every one of their `src` fields is **byte-exact, zero deviation**
against the door chunk's already-documented cumulative sub-image offset table
("Slot `$0C` (doors)"):

| `D0` | Descriptor `src` (dec) | Named sub-image (w×h) |
|---|---|---|
| 1 | 25,186 / 29,764 / 23,296 | Door Way 1A (48×109) / 1C (48×109) / 1B (80×27) — full 3-piece frame |
| 2 | 34,930 / 36,862 / 34,342 | Door Way 2A (32×69) / 2C (32×69) / 2B (48×14) |
| ≥3 | 38,794 | Door Way 3 (80×52), single piece |

**`+0x02613E(D0=depth, D1=lateral, D2=id)` — the door *leaf*, drawn only when
closed.** `D2 − 0x35` (the record's own gfxNumber, already documented as
`0x0035`/`0x0036` for Door Type 0/1) is remapped through an 8-entry,
28-byte-stride table at S_1 `+0x21222` (`0 → Door Type 0`, `0x1C → Door Type
1`) to pick which of two 28-byte descriptors a small per-depth table selects:
`D0==1` → a single centred piece via `+0x24C76`; `D0==2` → an L/C/R triptych
at Y=26; `D0≥3` → a triptych at Y=30. **All 6 leaf descriptors (2 door types ×
3 depths) are valid 28-byte records whose `src` is byte-exact against the
already-documented "Door Type" cumulative offsets, 6/6, zero deviation:**

| Depth | Door Type 0 `src` | Door Type 1 `src` | Named sub-image (w×h) |
|---|---|---|---|
| 1 | 920¹ | 12,568¹ | Door Type 0/1 − 1 (80×92) |
| 2 | 6,440 | 18,088 | Door Type 0/1 − 2 (64×60) |
| 3 | 9,800 | 21,448 | Door Type 0/1 − 3 (48×44) |

¹ the depth-1 descriptors carry flag `0x0200` ("mask at `+0x0A`", `maskSrc`
field) rather than `0x0100` ("`src` is the mask") like the other 5; their
`maskSrc` is `0`/`11,648` (the mask-plane start) and `src` is exactly one
`bytesPerPlane` (920 B) past it (the colour-plane start) — this is a genuine
mask+colour descriptor, matching the doc's existing "Door Type 0 − 1 at offset
0" / "Door Type 1 − 1 at offset 11,648" cumulative-table entries exactly once
the mask-plane's own 920 B are added back in.

**This fully answers "which exact door-chunk sub-image gets blitted for open
vs. closed"** for every doorway square kind 11 covers (depths 1–3): the frame
(Door Way 1/2/3, per depth) is always drawn; the leaf (Door Type 0/1, per
depth) is drawn on top of it only when the confirmed door-open bit is clear,
selected by the structure's own gfxNumber. When open, kind 11 draws the frame
only — no leaf — which is the "see through the frame into the corridor" open
look. Found via a from-scratch capstone disassembly of the stub and its two
callees (not from the jump-table entry alone), cross-checked against the
already-confirmed 28-byte descriptor invariants and the already-confirmed
door-chunk cumulative-offset table — no new hypothesis about the door chunk's
own layout was needed, only about which code reads it.

##### The Phase-1 object switch at S_1 `+0x033D2` — `objRec[+4]`'s high nibble is the square's **wall bitmask**, not an object class (**confirmed**)

> **Correction — the long-standing name "the object-type switch on
> `objRec[+4] & 0xF0`" describes the instruction but not the meaning.** The
> nibble is the same **N/E/S/W wall bitmask** the map's square longword carries
> in bits 12–15: `DrawViewport` builds `A3 = 1 << (partyFacing + 4)`
> (`+0x02E44`, from the confirmed facing local `−0x10(A5)`) and three arms of
> the switch gate on `A3 & objRec[+4]` — an operation that is only meaningful
> if the two share a bit numbering. Bit 4 = N, 5 = E, 6 = S, 7 = W, exactly as
> for `wall_flags`. So the switch does not select a *renderer by object class*;
> it selects a renderer by **how the object is attached to the square**
> (free-standing on the floor, on one wall, in a corner, or in a two-opposite-
> wall corridor/doorway), and the object's actual `bcdfs` type byte
> (`objRec[+5]`) is then tested *inside* the chosen arm.

Subtractive ladder at `+0x033D2`, fully resolved (`D0 = objRec[+4] & 0xF0`):

| Nibble | Walls | Arm | What it enqueues |
|--------|-------|-----|------------------|
| `0x00` | none — free-standing | `+0x030FE` | type `0x14`/`0x1E` → **kind 4** (prio `0x80`); type `0x10` with `+0x0C == 1` → **kinds 5/6/7** (prio `0x64`); anything else → **kind 12** (prio `0x3B`) |
| `0x10`/`0x20`/`0x40`/`0x80` | exactly one wall | `+0x03310` | `objRec[+5] ∈ {0x16, 0x20}` → **kind 8** (prio `0x5A`), else → **kind 9** (prio `0x59`) |
| `0x30`/`0x60`/`0xC0`/`0x90` | a corner (N+E / E+S / S+W / W+N) | `+0x03390` / `+0x033A6` / `+0x033BC` / `+0x0337A` | `+0x02B86(dir = 1 / 2 / 3 / 0)` → **kinds 0–3** |
| `0x50`/`0xA0` | two **opposite** walls (N+S / E+W) — a corridor or doorway square | `+0x03244` | type `0x11` → **kind 11** (prio `0x3C`) when `A3 & objRec[+4] == 0` and `depth > 0`; **kind 10** (prio `0x47`) when `A3 & objRec[+4] != 0` and `depth == 0` and `lateral == 0`; types `0x22`/`0x0F` → one **kind 0–3** item per set bit of `objRec[+0x07]`, via `+0x02B86` |
| `0xF0` | — | *(never reached)* | monsters are intercepted one instruction earlier by `BTST #7,(A2)` at `+0x030D8` → `+0x02C16` → kind 13 |
| `0x70`/`0xB0`/`0xD0`/`0xE0` | three walls (dead end) | *(no arm)* | **zero occurrences in the shipped data** |

**Verification — whole-corpus census, zero unexplained values.** Walking all 13
maps with `scripts/bclib/bcdfs.py` (2,536 records, 14,168 squares) gives exactly
**twelve** distinct values of `objRec[+4] & 0xF0`:

```
0x00:834  0x10:205  0x20:193  0x30: 97  0x40:132  0x50:178
0x60: 90  0x80:151  0x90: 48  0xA0:270  0xC0: 52  0xF0:286
```

- **11/11 switch arms are exercised** (every handled value occurs), and the four
  values the switch does *not* handle (`0x70`/`0xB0`/`0xD0`/`0xE0`) occur **0
  times**.
- `0xF0` is **265 monsters** (`objRec[+5]` bit 7 set) + **17 records nested
  inside container/monster sub-chains** (never reachable from a square) + **4
  type-`0x2E` monster generators**, which are unhandled in every ladder and
  therefore invisible by design. So of 2,390 top-level records, 2,386 land on a
  handled path.
- The nibble is a **subset of the square's own wall bits in 2,169 of 2,536
  records**; all 367 exceptions are `0xF0` records (monsters and inventory),
  i.e. the invariant holds with zero deviation on every record the switch can
  actually see.
- **`0x50`/`0xA0` are occupied by exactly three `bcdfs` types and nothing else:
  `0x11` (door frame, 291), `0x0F` (door switch, 96), `0x22` (door lock, 61) —
  448/448 records, zero other types, zero items.** The arm at `+0x03244` tests
  precisely those three type bytes and nothing else. Conversely `0x00` is
  occupied only by the eight floor-standing structure types
  (`0x10 0x12 0x14 0x17 0x1E 0x1F 0x2E 0x2F`, 834/834, zero items).
- `objRec[+0x07]` on the `0x50`/`0xA0` decoration path is a 4-bit mask whose set
  bits are **⊆ {1,3} on every N+S square and ⊆ {0,2} on every E+W square**
  (157/157, zero deviation) — i.e. bit `d` corresponds to the wall in direction
  `(d + 3) & 3`. That mapping is re-derived from disassembly and pinned against
  both the corner arms and the corridor arm in "Kind 3 and the left-wall
  position tables" below; the invariant is a *consequence* of it (a bit can
  only name a wall the square actually has), not a coincidence in the data.
  Only bits 0–3 are ever tested (`CMPI.W #4,D7` at `+0x03306`), and the shipped
  values are exactly `{0x01, 0x02, 0x04, 0x05, 0x08, 0x0A}`.

##### Kinds 0–3 (S_1 `+0x03550` stub → `+0x02A0E`) — wall-mounted decorations, door locks and door switches (**confirmed**)

The stub reads the display-list record's own `kind` byte back out
(`rec[+0x00]`) and passes it as an argument, so the handler receives the
**party-relative direction** the item was enqueued with:
`+0x02A0E(objIndex = D4, dir = kind 0–3, depth = D2, lateral = D3)`.

| `objRec[+5]` | Condition | Call |
|---|---|---|
| `0x22` (door lock / wall decoration) | `dir ≥ 2` | `+0x25DA0(gfx, depth, lateral, side = (dir == 2))` |
| `0x0F` (door switch) | `dir ≥ 2`, `objRec[+0x02] == 0` | `+0x25F9E(depth, lateral, side)`; separately, at `depth == 1 && lateral == 0` with `objRec[+0x02] == 1`, `+0x26100(side)` |
| anything else | — | `+0x21C84(gfx, dir, depth, lateral)` — the generic corner/floor-item renderer |

At `depth == 1 && lateral == 0` both special cases also register a **clickable
hotspot** (see below): code `0x6B` for the door lock, `0x64` for the door
switch, both with rect `(0x1F or 0x9C, 0x28, 0x15, 0x25)` — left or right of
the viewport depending on `dir`.

> **Important — `dir ≤ 1` on a `0x22`/`0x0F` record draws *nothing*, it does
> not fall through to the generic renderer.** `+0x02A3E` (`CMPI.W #1,D2 /
> BLE $2AA6`) and `+0x02AC4` (`CMPI.W #1,D2 / BLE.W $2B5A`) both branch to
> `BRA $2B7E`, the function epilogue. The generic `+0x21C84` call at
> `+0x02B5C` is reached only when the type byte is *neither* `0x22` nor
> `0x0F`. This matters — see the next subsection.

##### Kind 3 and the left-wall position tables — unreachable, and an off-by-one in the engine (**confirmed**)

> **Correction — supersedes the former "Still open" row "the `dir == 3`
> (`+0x25E12`/`+0x26070`) position tables look unreachable".** That row
> asserted the gate plus the data "force `kind == 2` for every reachable
> combination — so `D0` is always `1`". **`kind == 2` is not forced.**
> `kind ∈ {0, 2}` in an exact 50/50 split (252 / 252 over the whole corpus),
> and it was never checked whether both through-corridor facings had been
> swept. They have been now: they are both legal, both physically playable on
> 153/157 records, and *neither* produces `kind == 3`. The conclusion the old
> row reached is right; its reasoning was not.

**The whole chain, re-derived from disassembly this pass** (nothing below is
taken from the earlier prose):

| Site | Instruction evidence | Establishes |
|---|---|---|
| `+0x02E44` | `MOVEQ #1,D0 / MOVE.W -$10(A5),D1 / ASL.W D1,D0 / ASL.W #4,D0 / MOVEA.W D0,A3` | `A3 = 1 << (partyFacing + 4)`; `-0x10(A5)` is the low word of the long loaded from `$1744(A4)` at `+0x02DFC` — the same `partyFacing` global `+0x02B86` uses |
| `+0x032D0` | `TST.W D2 / BLE $330C` | the corridor arm requires `depth > 0` |
| `+0x032D4`–`+0x032DE` | `MOVE.W A3,D0 / MOVEQ #0,D1 / MOVE.B $4(A2),D1 / AND.W D1,D0 / BNE $330C` | **the gate**: the party's own facing bit must *not* be one of the square's walls (only the high nibble can match, `A3 ≥ 0x10`) |
| `+0x032E0`–`+0x0330A` | `MOVEQ #0,D7 … MOVEQ #1,D1 / ASL.W D7,D1 / AND.W D1,D0 / … MOVE.W D7,-(A7) / JSR $2B86(PC) … CMPI.W #4,D7 / BCS` | one `+0x02B86` call per set bit of `objRec[+0x07]`, and the argument is the **raw bit index `D7` (0–3)**, not a transformed value. Only bits 0–3 are ever tested |
| `+0x02BA2`–`+0x02BAC` | `MOVE.W D2,D0 / ADDQ.W #4,D0 / SUB.W $1744(A4),D0 / MOVE.W D0,D2 / ANDI.W #3,D2` | `kind = (dir + 4 − partyFacing) & 3` |
| `+0x02A3E` / `+0x02AC4` | `CMPI.W #1,D2 / BLE →epilogue` | `kind ≤ 1` ⇒ **nothing drawn** |
| `+0x02A44`–`+0x02A50` | `CMPI.W #2,D2 / BNE → MOVEQ #0,D0` else `MOVEQ #1,D0` | `side = (kind == 2)` |
| `+0x25DB6`–`+0x25DC0` | `LEA $25E12(PC),A1 / TST.W $6(A0) / BEQ $25DC4 / LEA $25E5A(PC),A1` | `side == 0` ⇒ `+0x25E12`; `side != 0` ⇒ `+0x25E5A` |
| `+0x25DCE`–`+0x25DDE` | `MOVE.W $2(A0),D0 / MULU #$C,D0 / MOVE.W $4(A0),D1 / LSL.W #2,D1 / ADD.W D0,D1` | position index = `(depth−1)×12 + lateral×4`, i.e. 3 laterals × 3 depths of `(x, y)` words; `$51A(A5)` adds `+0x24` = the second such block |

**Call graph is closed** (whole-image scan for absolute `JSR/JMP xxx.l` under
base `0x80058` *and* `d16(PC)` forms): `+0x02A0E` has exactly **one** caller
(`+0x03568`, the kind 0–3 stub); `+0x02B86` has exactly **five** (the four
corner arms `+0x0337A`/`+0x03390`/`+0x033A6`/`+0x033BC` with constant
`dir = 0/1/2/3`, and the corridor arm `+0x032FC`); `+0x25DA0`, `+0x25F9E` and
`+0x26100` have exactly one caller each, all inside `+0x02A0E`. So the *only*
route to the `side = 0` tables is `+0x02A0E` receiving `kind == 3`.

**The bit → wall mapping, re-derived (confirmed).** `dir` is the raw bit index
`d`; the wall it names is `w = (d + 3) & 3` (equivalently `d = (w + 1) & 3`),
with `0=N, 1=E, 2=S, 3=W`. Two independent constraints pin this down, and only
this mapping satisfies both:

- **Corners.** The four constant-`dir` arms must name a wall the corner
  actually has: `0x30` (N+E) → `dir 1`, `0x60` (E+S) → `dir 2`, `0xC0` (S+W)
  → `dir 3`, `0x90` (W+N) → `dir 0`. `w = (d+3)&3` gives N/E/S/W respectively
  — 4/4 inside the corner's wall pair. (`w = d` also passes here, which is why
  corners alone are not sufficient.)
- **Corridors.** On `0x50` (walls N+S) the set bits are ⊆ {1,3}; `w = (d+3)&3`
  → {N, S} ✓, whereas `w = d` → {E, W}, walls that square does not have ✗.
  On `0xA0` (walls E+W) bits ⊆ {0,2} → {W, E} ✓ vs {N, S} ✗.

So the "157/157 bits ⊆ {1,3} / {0,2}" invariant is **not a coincidence in the
data** — it is a *consequence* of the mapping: a decoration bit can only name
one of the two walls the square has.

**What `kind` means geometrically.** Writing `r = (w − partyFacing) & 3` for
the party-relative wall direction (`0` ahead, `1` right, `2` behind, `3` left
— the engine's own convention, independently confirmed by the kinds 8/9
handler's `D3 = (D0 − partyFacing − 1) & 3` at `+0x02806`), the formula
collapses to **`kind = (r + 1) & 3`**:

| `kind` | `r` | The decorated wall is… | What `+0x02A0E` does |
|---|---|---|---|
| 0 | 3 | on the party's **left** | `BLE` → epilogue, **nothing drawn** |
| 1 | 0 | **ahead**, seen head-on (far wall) | `BLE` → epilogue, **nothing drawn** |
| 2 | 1 | on the party's **right** | `side = 1` → `+0x25E5A`/`+0x260B8`, x = 158 |
| 3 | 2 | **behind** — the near edge, between party and square | `side = 0` → `+0x25E12`/`+0x26070`, x = 34 |

The `side` tables confirm the left/right reading independently of the mapping
— read at `depth 1, lateral 0` they are `(34, 52)` for `side = 0` and
`(158, 52)` for `side = 1`, and `34 + 16 + 158 = 208` is an exact mirror about
the viewport width for the 16-px-wide sprite. They also skip complementary
laterals (`side = 0` blanks lateral −1, `side = 1` blanks lateral +1), exactly
as a left/right pair should. The hotspot rects agree: x = `0x1F` (31) for
`kind 3`, `0x9C` (156) for `kind 2`.

**The off-by-one.** `kind 3` — what the `side = 0` tables are dispatched on —
means *the wall on the near edge of the target square*, i.e. a wall standing
between the party and the square. That is **precisely the configuration the
gate at `+0x032D4` exists to reject** (`A3 & objRec[+4] != 0` ⇒ skip). The
case the `side = 0` tables were actually written for, *the wall on the party's
left*, arrives as `kind 0` — and the same `dir ≥ 2` test throws it away. The
handler's `CMPI.W #1,D2 / BLE` should have been a test that admits `kind 0`
(the left wall) rather than `kind 3` (the invisible one).

**Consequence, and it is directly observable in-game:** on a two-opposite-wall
square a door lock or door switch is **only ever drawn on the wall to the
party's right**. The left-hand wall's copy is silently dropped, and turning
180° swaps which physical wall is "the right one" — so the player sees exactly
one decoration, always on the right, and never both at once.

**Verification — exhaustive sweep, zero deviation.** Walking all 13 maps with
`scripts/bclib/bcdfs.py` and evaluating the transcribed dispatch for **every
record × every one of the four facings × every set bit**:

- **All 157** `0x22`/`0x0F` records in the game sit on a `0x50`/`0xA0` square
  (69 on `0x50`, 88 on `0xA0`; type `0x0F` 96, type `0x22` 61). **Zero** sit on
  a corner or single-wall square, so the four constant-`dir` corner arms never
  carry one either. `objRec[+4]` takes only the two values `0x50`/`0xA0`
  (no low-nibble bits) and `objRec[+0x07]` only `{0x01, 0x02, 0x04, 0x05,
  0x08, 0x0A}`.
- `objRec[+4] >> 4` equals the square's own `wall_flags` on **157/157**.
- The gate leaves exactly the two along-corridor facings legal: `{1,3}` (E/W)
  on `0x50`, `{0,2}` (N/S) on `0xA0`.
- Over the resulting **504 (record, facing, bit) combinations**: **kind 0 ×
  252, kind 2 × 252, kind 1 × 0, kind 3 × 0.** Per nibble: `0x50` → {0: 105,
  2: 105}; `0xA0` → {0: 147, 2: 147}.
- **Walkability cross-check** (square type bit 0 = wall, plus the single-sided
  `wall_flags` collision rule of `MoveParty` `+0x16CDC`, deltas from
  `ApplyFacingDelta` `+0x002B4`): on **153/157** records *both* traversal
  facings are genuinely playable — the corridor is open at both ends — and on
  the remaining 4 exactly one is. **Zero** records are unreachable. So the
  "sweep both facings" scenario is not hypothetical, it is the norm, and it
  still never yields `kind 3`.
- **95 records** carry a decoration on **both** walls (`mask 0x0A` on `0x50`,
  `0x05` on `0xA0`) *and* have both ends open — the strongest possible test
  fixture. In every one, the two bits split as `{kind 0, kind 2}` from one
  facing and swap under the 180° turn.

This is a **structural** negative, not an empirical one: `kind` is odd iff
`dir` and `partyFacing` differ in parity; the gate forces `partyFacing` to the
parity opposite the wall axis, and the bit→wall mapping forces `dir` to that
same parity. No data value and no facing can make `kind` odd. `kind 3` is
therefore unreachable for types `0x22`/`0x0F` **by construction**.

**`kind 3` is not dead in general** — only for these two types. The 287
non-monster records that sit on corner squares (`0x30`/`0x60`/`0x90`/`0xC0`)
reach `+0x02B86` with a constant `dir`, and over 4 facings produce a perfectly
uniform `{0: 287, 1: 287, 2: 287, 3: 287}`. Those records are none of them
type `0x22`/`0x0F`, so they take the `+0x02B5C` → `+0x21C84` generic branch,
which passes `kind` straight through as its `dir` argument. The kind-3 jump
path is live; only the door-lock/door-switch `side = 0` tables are not.

**In-game fixture for a screenshot oracle** (should anyone want to confirm the
missing left-hand decoration visually): **map 1, dungeon level 1, row 11,
col 20** — a type-`0x0F` door switch (drawn as the Pull Chain, slot `$20`),
`objRec[+4] = 0x50` (N+S walls, so an E–W corridor), `objRec[+0x07] = 0x0A`
(chains on **both** the N and S walls), square longword `0F F1 50 49`. Both
neighbours are open floor (`(11,19)` = `0F F1 40 00`, `(11,21)` =
`0F F1 20 00`; neither carries a blocking `wall_flags` bit on the shared
edge). Predictions:

- Party at **(row 11, col 19) facing E**: bit 3 (S wall) → `kind 2`, chain
  drawn at x = 158 (right); bit 1 (N wall) → `kind 0`, **not drawn**.
- Party at **(row 11, col 21) facing W**: bit 1 (N wall) → `kind 2`, chain
  drawn at x = 158 (right); bit 3 (S wall) → `kind 0`, **not drawn**.

i.e. one chain on the right in both directions, never a chain on the left, and
never two chains at once. (Map 1 rows 8/37 and 5/55 are equivalent fixtures on
dungeon level 2.)

##### Kinds 4 and 12 (S_1 `+0x034D4` stub → `+0x0224C`) — every free-standing structure (**confirmed**)

`+0x0224C(objIndex = D4, depth = D2, lateral = D3)`. The body is one
`SUBI.W`/`BEQ` ladder on `objRec[+5]` at `+0x0257C`, covering **7 of the 8**
types that ever occur with wall-nibble `0x00`:

| Type | Sub-selector | Renderer | Art |
|------|--------------|----------|-----|
| `0x10` Illusionary / field / glyph | `word +0x0C` | `1` → nothing; `2` → `+0x21504`; `3` → `+0x2558C` static effect tick | see below |
| `0x12` Stairs / teleport / spinner | `word +0x10` | `1` → `+0x214F4`; `2` → `+0x251FE(flight 0)`; `3` → `+0x251FE(flight 1)`; `0` and `4` → **nothing** | slot `$C4` |
| `0x14` Pit | `word +0x10` | `0` → `+0x215B0` (floor pit); `1` → `+0x216A2` (ceiling pit) | slot `$10` |
| `0x17` Pillar | — | `+0x21842(depth, lateral)` | slot `$14` |
| `0x1E` Floor plate / trap | `1 − word +0x08` | `+0x21732(depth, pressed)`, gated `lateral == 0` and `!BTST #1, +0x0B`; plus the already-documented effect-`0x59` trap marker at `+0x02548` | slot `$00` |
| `0x1F` Fountain / special panel | `word +0x0E` | `+0x25340(0 or 1)`, gated `depth == 1 && lateral == 0`; `+0x0E != 0` also runs `+0x253A6` per set bit of `objRec[+0x07]`; `+0x0E == 0` plays effect `0x5A` | slot `$C8` |
| `0x2F` Statue | — | `+0x227B4(word +0x0C)`, gated `depth == 1 && lateral == 0` | runtime `+0x22244` table |
| `0x2E` Monster generator | — | **no case** — never drawn, on any path | — |

> **Correction — the type-`0x10` render case is in `+0x0224C`, not
> `DispatchSquareObject`.** Two places in this file cite "`DispatchSquareObject`'s
> type-`0x10` case, S_1 `+0x0231C` → `+0x02388`" and "`+0x02548` inside
> `DispatchSquareObject`". Both addresses are **below** `DispatchSquareObject`'s
> entry (`+0x025B0`); they are inside the kind-4/12 handler `+0x0224C`, which
> runs from `+0x0224C` to `+0x025AE`. The *findings* at those addresses are
> unaffected (field reads, gates and effect numbers all re-verified this pass);
> only the owning function was misattributed.

**Sub-kind → art, checked against the shipped data (zero deviation).** Every
type-`0x12` record's `word +0x10` is a perfect function of its `gfxNumber`,
across all 13 maps:

| `+0x10` | gfx | n | Rendered as |
|---|---|---|---|
| `0` | `0x0041` | 61 | **nothing** — this is the confirmed **"inviso" teleport** |
| `1` | `0x0040` | 82 | dither field via `+0x214F4` — the **visible** teleport |
| `2` | `0x0043` | 39 | **stairs flight A** (`$C4` src 0 / 9,156 / 12,468) |
| `3` | `0x0044` | 36 | **stairs flight B** (`$C4` src 14,340 / 23,496 / 26,808) |
| `4` | `0x001E` | 7 | **nothing** — the **spinner**, correctly invisible |

This closes the open question "the render-side mechanism of *inviso* is
untraced": there is no special skip, sub-kind `0` simply falls off the
`SUBQ.W #1` ladder before any case matches. It also settles that stairs
sub-kinds `2` and `3` are the **two flights** in slot `$C4`, not a stairs/
non-stairs split — `gfx 0x43 ↔ flight A`, `gfx 0x44 ↔ flight B`.

Type `0x14` partitions the same way: `+0x10 == 0` ⇒ gfx `0x3A` (18 records,
floor pit), `+0x10 == 1` ⇒ gfx `0x3B` (15 records, ceiling pit), zero mixing —
matching slot `$10`'s documented "floor pits A–D + ceiling pits A–B" split.
Type `0x1F` likewise: `word +0x0E == 0` ⇒ gfx `0x45` (fountain, 27/27),
`!= 0` ⇒ gfx `0x46` (special panel, 14/14).

##### Kinds 8 and 9 (S_1 `+0x03542` stub → `+0x02806`) — objects on a single-wall square (**confirmed**)

`+0x02806(objIndex = D4, depth = D2, lateral = D3)`. It first converts the wall
nibble to a party-relative direction: `D1 = objRec[+4] & 0xF0` →
`+0x1FFE4` (a generic "which bit is set" byte-table lookup at `+0x1FFE4`/
`+0x20007`; the high-nibble table maps `1/2/4/8 → 5/6/7/8`) → `D3 = (D0 −
partyFacing − 1) & 3`, i.e. **0 = the wall you are facing, 1 = right,
2 = behind, 3 = left**. Then a ladder on `objRec[+5]`:

| Type | Condition | Call | Hotspot at `depth 0, dir 0, lateral 0` |
|---|---|---|---|
| `0x16` Alcove | `depth < 3` | `+0x24F60(depth, lateral, dir)` — or `+0x2509E()` when `$1E5C(A4) == 5` | code `0x69`, rect (64, 54, 80, 24) |
| `0x20`/`0x21` Plaque | `depth < 3` | `+0x250C0(depth, lateral, dir)` | code `0x6A` (`0x20`) / `0x6F` (`0x21`), rect (58, 20, 90, 68) |
| `0x1D` Switch | `!BTST #1, +0x0B` | `+0x2040E(gfx, depth, lateral, dir, +0x08)` | code `0x6D`, rect (44, 22, 140, 70) |
| default (all items and the remaining structure types) | `dir == 0` and `depth < 3` | `+0x218FA(gfx, depth, lateral)` — the floor-item bank | — |

##### Kind 10 (S_1 `+0x034E4` stub → `+0x02627A`) — "standing in the doorway" (**confirmed byte-exact**)

The only argument-less handler in the table, and the smallest: a 21-instruction
routine that copies the **entire** slot `$B8` chunk to the screen, opaque, with
no descriptor at all.

```asm
02627E  movea.l $2099E(pc),a5      ; graphics globals
026282  movea.l $464(a5),a1        ; 6 screen bitplane bases
026286  movea.l $b8(a5),a2         ; the "Door Slot" chunk
02628E  move.w  #$87,d1            ; 136 rows − 1
026292  moveq   #9,d4              ; dest byte 9  → x = 72 px
026294  moveq   #$20,d5            ; +32 after each 8-byte row → 40 B stride
026296  moveq   #5,d0              ; 6 planes
0262A0  8 × move.b (a2)+,(a3)+     ; 8 bytes = 64 px per row
```

`6 planes × 136 rows × 8 B = 6,528 B` — **exactly** the documented size of slot
`$B8` ("Door Slot — one 64×136, 6 planes, 6,528 / 6,528"). The chunk is
consumed in one linear pass from byte 0 to its last byte, zero remainder, and
lands at `(72, 0)` — perfectly centred in the 208-px viewport
(`72 + 64/2 = 104`). Enqueued only when the party stands **on** a doorway
square (`depth == 0`, `lateral == 0`) facing along the door's own wall plane
(`A3 & objRec[+4] != 0`), which is exactly the "you are inside the door frame,
looking sideways at the jamb" view.

##### The two static blit-descriptor formats these handlers use (**confirmed**)

Neither of the two generic copiers below was documented; both are needed to
read the tables above.

**18-byte opaque 6-plane copier — `+0x24F0A`.** Used by the alcove, plaque and
stairs renderers.

| Offset | Size | Field |
|--------|------|-------|
| `+0x00` | 2 | **slot** — the `d16(A5)` displacement the pixels live in (`MOVEA.L (A5,D0.W),A2`) |
| `+0x02` | 4 | byte offset within that slot |
| `+0x06` | 2 | bytes per row − 1 |
| `+0x08` | 2 | rows − 1 |
| `+0x0A` | 2 | source advance after each row (clipping) |
| `+0x0C` | 2 | dest advance after each row |
| `+0x0E` | 2 | extra source offset, added once |
| `+0x10` | 2 | dest offset within each plane (`row × 40 + x/8`) |

**10-byte compact record → the fixed template at `+0x24BDC`.** `+0x24BAE` copies
six fields out of a 10-byte record into a static 28-byte descriptor and falls
into the confirmed masked-blit tail `+0x24C6E`:

| Compact | → 28-byte field |
|---|---|
| `+0x00` | `+0x04` (low word of `src`) |
| `+0x02` | `+0x08` (low word of `bytesPerPlane`) |
| `+0x04` | `+0x0E` (`BLTSIZE`) |
| `+0x06` | `+0x10` (blitter modulo) |
| `+0x08` | `+0x19` (width low byte) |
| `+0x09` | `+0x1B` (height low byte) |

> **Correction — the floor-item bank *is* reached through an `A5` slot.** The
> "Location and layout" note above says "this bank is not addressed through an
> `A5` slot at all, the descriptor's `src` is an offset into an RLE-decoded
> buffer reached PC-relative". The template at `+0x24BDC` that `+0x24BAE` fills
> in is 28 bytes long (`+0x24BDC … +0x24BF8`, ending exactly at the next
> function) and hard-codes `slot = 0x0030` at `+0x00` and `flags = 0x0100`
> ("`src` is the mask") at `+0x16`; `+0x24C6E` then does the usual
> `MOVEA.L (A5,D0.W),An`. So the bank is **slot `$30`**, exactly as the other
> passage in this file ("Slot `0x30` (the confirmed floor-item bank)") already
> assumed — the two statements were in conflict and this settles it. The flag
> value also corroborates the documented "plane 0 = 1-bit cookie-cut mask".

##### Which routine draws which bank (**confirmed**)

| Renderer | Reached from | Slot | Table(s) | Byte-exact evidence |
|---|---|---|---|---|
| `+0x24F60` alcove | kind 8/9, type `0x16` | `$BC` | 36-word index `+0x24F90`, descriptors in the pool at `+0x1D9E6` | 11/11 descriptors; `src ∈ {0, 6468, 8628, 9852, 11148}` = the documented Alcove A–E offsets, **plus 11,580 and 12,876 = the loader's two generated mirrors**, all 13 values exact |
| `+0x250C0` plaque | kind 8/9, type `0x20`/`0x21` | `$C0` | index `+0x250F0` | 11/11; `src ∈ {0, 5760, 8256, 9696, 11136}` = Plaque A–E, plus mirrors 11,580 / 13,020 — the same three mirror destinations the loader trace found (`+0x2D3C`, `+0x324C`, `+0x32DC`) |
| `+0x251FE` stairs | kind 4/12, type `0x12` sub 2/3 | `$C4` | index `+0x25232`, flight B = same table `+ 0x7E` (= 7 × 18 B) | 14/14; flight A `{0, 9156, 12468}`, flight B `{14340, 23496, 26808}` = flight A + 14,340, and **2 × 14,340 = 28,680 = the documented slot size exactly** |
| `+0x21842` pillar | kind 4/12, type `0x17` | `$14` | 3 × 28-byte descriptors at `+0x218A6` | `src {0, 8120, 11144}`, geometry 80×116 / 48×72 / 32×47 — identical to the documented Pillar A–C |
| `+0x215B0` floor pit / `+0x216A2` ceiling pit | kind 4/12, type `0x14` | `$10` | `+0x21616` (5 records) / `+0x216DE` (2) | all 7 pass the three 28-byte invariants; the two routines split exactly along the confirmed gfx `0x3A`/`0x3B` partition |
| `+0x2040E` switch | kind 8/9, type `0x1D` | `$1C` | **18** × 28-byte descriptors at `+0x20D3E` | 18/18 — exactly the documented "18 wall buttons" |
| `+0x25F9E`/`+0x26100` door switch | kinds 0–3, type `0x0F` | `$20` | 4 × 28-byte descriptors at `+0x26000`, positions `+0x26070`/`+0x260B8` | `src {532, 882, 1148, 0}` with sizes 16×25/19/13/38; `1148 + 2×13×7 = 1,330` = the documented slot size exactly. **The "door switch" is drawn as the Pull Chain.** |
| `+0x25DA0` door lock | kinds 0–3, type `0x22` | `$18` | 9 × 28-byte descriptors at `+0x25EA2`, index `(gfx − 0x51) × 0x54 + (depth−1) × 0x1C`; positions `+0x25E12`/`+0x25E5A` | 9/9 invariants pass; per decoration `280 + 210 + 154 = 644` at 16×20 / 16×15 / 16×11, 7 planes, and `3 × 644 = 1,932` — **byte-for-byte the per-level wall-decoration block documented at `bcdfb`–`bcdfn` `+0`**. The three `gfxNumbers` in the data are exactly `0x51/0x52/0x53` (26/20/15 records) |
| `+0x218FA` / `+0x21C84` generic | kind 8/9 default; kinds 0–3 default | `$30` | gfx→group byte table `+0x26FDE`; 10-byte records `+0x271B6`; positions `+0x27774` (`+0x218FA`) | see below |
| `+0x21732` floor plate/trap | kind 4/12, type `0x1E` | `$00` | 4 × 28-byte descriptors `+0x217D2`/`+0x217EE`/`+0x2180A`/`+0x21826`, position byte-pairs `+0x21788`/`+0x217A2`/`+0x217BC` | 4/4 invariants pass; 13 tile positions near, 11 far; honours the `$48F(A5)` mirror flag (its already-listed read site `+0x21750`) |
| `+0x227B4` statue | kind 4/12, type `0x2F` | runtime | `+0x2201C` / `+0x22042` | a **second** consumer of the still-unpopulated runtime `+0x22244` descriptor array (the first is `DrawSquareRecord`) |
| `+0x214F4` / `+0x21504` | kind 4/12, type `0x12` sub 1 / type `0x10` sub 2 | *(none)* | 9-entry index `+0x21556`, byte streams from `+0x21568` | procedural — see below |

**The magic field / visible teleport is procedural, not a sprite
(`+0x21236`).** `+0x214F4` (sets `$4E0(A5) = 1`) and `+0x21504` (clears it)
share one body: a 9-entry `(depth 1–3) × (lateral −1/0/+1)` index at `+0x21556`
selects a byte stream at `+0x21568` of the form `[height×2] [colour]
[y] [x]… 0xFF`, and each `x` is blitted through `+0x21236`, which programs
`BLTCON0 = (x & 15) << 12 | 0x3CA` (USEC|USED, minterm `0xCA`) with
`BLTADAT = 0xAAAA`/`0x5555` and per-plane `BLTBDAT = 0`/`0xFFFF` — a **50 %
checkerboard stipple fill in a solid colour**, six planes deep, no source art.
The nine entries are internally consistent and self-terminating (each entry's
length lands exactly on the next entry's index, 9/9). Colour index is `0x13`
(19) at depths 1–2 and `0x33` (51) at depth 3 — `51 = 19 + 32`, i.e. the
**EHB half-bright of the same colour**, which is precisely how this renderer
darkens the effect with distance.

**The `+0x26FDE` gfx→group table partitions the whole corpus (**confirmed,
zero exceptions on 624/624**).** `+0x218FA` and `+0x21C84` both start with
`MOVE.B (A1, gfx.W), D1` at `A1 = +0x26FDE` and bail on a negative result.
Testing every non-monster record in `bcdfs`:

- **624 of 624** records whose type has *no* dedicated renderer map to a real
  group index (never `0xFF`) — zero exceptions;
- **1,636 of 1,647** records of the 15 types that *do* have a dedicated
  renderer map to `0xFF`; the 11 exceptions are all type `0x2E`
  (monster generator, gfx `0xE9`), a type with no case in any ladder and
  therefore never drawn at all.

The table's largest group index is `0x30` (48), i.e. **49 groups**, and
`+0x271B6 + 49 × 30 B = +0x27774`, which is exactly where the position table
begins — zero slack. That is a third independent agreement with the already-
documented "147 frames = 49 floor graphics × 3 view depths".

`+0x218FA` also applies a per-item scatter: at `depth == 0` it steps the
global `$498(A5)` down 8 → 0 → 8 and adds the corresponding `(dx, dy)` from a
9-entry table at `+0x220CC`, so several items dropped on the party's own
square do not stack exactly.

##### Clickable-hotspot globals (**confirmed**)

Five handlers write the same two register blocks at `depth == 1` (or `0`) dead
ahead. Both are `{x, y, w, h}` words plus a code byte:

| Block | Rect words | Code byte | Written by |
|---|---|---|---|
| A | `−0x77B0` / `−0x77AE` / `−0x77AC` / `−0x77AA` | `−0x77A8` | kinds 0–3, type `0x22` (code `0x6B`) |
| B | `−0x77A2` / `−0x77A0` / `−0x779E` / `−0x779C` | `−0x779A` | kinds 0–3 type `0x0F` (`0x64`); kind 8/9 types `0x16` (`0x69`), `0x20` (`0x6A`), `0x21` (`0x6F`), `0x1D` (`0x6D`); kind 4/12 type `0x1F` (`0x6E`) |

`DrawViewport` reads `−0x779A(A4)` into a local at `+0x02E6C` before the walk
and calls `+0x02CF0`, i.e. the blocks are reset per frame. These are the
in-viewport mouse targets for "pull the chain", "search the alcove", "read the
plaque", "press the switch", "use the fountain/panel".

##### `+0x25340` — slot `$C8`'s internal layout, read straight off the copy loops (**confirmed byte-exact**)

`+0x25340(D0)` performs two hard-coded opaque 6-plane copies:

| Source | Geometry | Dest | Bytes |
|---|---|---|---|
| `$C8 + 0` | 80 × 29 (10 B/row) | (64, 9) | 1,740 |
| `$C8 + 1,740` when `D0 == 0`, `$C8 + 6,060` when `D0 != 0` | 80 × 72 | (64, 38) | 4,320 |

`1,740 + 4,320 = 6,060` = the documented slot `$C8` size **exactly**, and the
two dest positions are `(64, 9)` and `(64, 38)` — the same "panel-top (64,9)"
and "fountain (64,38)" the screenshot composite had only *inferred*. So slot
`$C8` is **Panel Top (80×29) then Fountain (80×72)**, and the "Panel Top" strip
is a shared header drawn above *both* variants. The `D0 != 0` (special-panel)
body at `+6,060` lies past the chunk's declared end — like the alcove/plaque
buffers, `$C8` must be over-allocated and back-filled; that fill is not traced.

##### Verification (**confirmed** — two independent geometric oracles, zero deviation)

Nothing here was fitted to the descriptor tables; the loop bounds come from the
driver, the table geometry from the previously-confirmed
`DrawWallPieceDispatch` analysis.

1. **Descriptor-table saturation.** Symbolically executing the driver's loop
   bounds and gates through the documented index formulas gives
   front-wall index `= depth*3 + (lateral+1)` for `depth ∈ {0,1,2}`,
   `lateral ∈ {−1,0,+1}` → exactly `{0…8}`, and side-wall index
   `= depth*2 + s` for `depth ∈ {0,1,2,3}`, `s ∈ {0,1}` → exactly `{0…7}`.
   **9/9 and 8/8 slots reachable, 0 out of range, 0 unreached.** The tables are
   also byte-contiguous at exactly those sizes: `+0x22CE2` → `+0x22D96` →
   `+0x22E4A` → `+0x22F2A` → `+0x2300A` = `180, 180, 224, 224` B =
   `9×20, 9×20, 8×28, 8×28` — **4/4 boundaries exact.**
2. **Facing deltas.** The four coordinate arms reproduce
   `facing 0 ⇒ +Y, 1 ⇒ +X, 2 ⇒ −Y, 3 ⇒ −X` — **4/4 identical** to
   `ApplyFacingDelta`'s jump table (S_1 `+0x002B4`), confirmed independently in
   "Facing encoding". The lateral steps are the consistent 90° rotation in all
   four arms, and the wall-bit selection (`facing`, `facing−1`, `facing+1`)
   matches the documented `wall_flags` bits 12–15 = N/E/S/W with no slack.
3. **Screen geometry.** Decoding the descriptors confirms the driver's sign
   conventions: front-wall `lateral = −1 / 0 / +1` map to dest `x = 0 /
   16 / 192` (depth 0), `0 / 48 / 160` (depth 1), `0 / 64 / 144` (depth 2) —
   **3/3 rows tile the 208-px viewport exactly, zero gap and zero overlap**;
   and side-wall `s = 0` (party's left) lands at `x = 0, 16, 48, 64` while
   `s = 1` (right) lands at `192, 160, 144, 128`, satisfying
   `x_right = 208 − w − x_left` for **4/4 pairs exactly**.
4. **Load base.** 267 distinct `JSR/JMP xxx.l` targets resolve inside S_1 under
   `+0x80058`, 261 decode as code and 194 begin with a canonical `LINK`/
   `MOVEM`-push prologue; under the raw-offset reading **0** operands even land
   inside the image. Independently, `AddRenderItem`'s three hard-coded absolute
   globals map onto three consecutive, correctly-ordered `d16(A4)` slots.

> **Correction — the 8 side-wall descriptors are *left/right*, not
> *near/far*.** They were tabulated in "Slot `$08` (14,448 B) — side walls" and
> referenced in the screenshot corroboration below as
> `sidewall-depth{0-3}-{near,far}`. The driver proves otherwise: index
> `depth*2+0` is enqueued from the wall bit `(facing−1)&3` (the party's **left**
> side) and `depth*2+1` from `(facing+1)&3` (the **right**). Their own dest-X
> values agree — the two members of each depth pair are exact mirror images
> about the 208-px viewport centre (`0/192`, `16/160`, `48/144`, `64/128`),
> which "near/far" cannot explain. Renders are unaffected (positions come from
> the descriptors themselves); only the labels were wrong.

> **Correction — the "front wall is drawn only at the sight-line terminus"
> reading describes `DrawSquareRecord`'s internal logic, not the wall
> pipeline.** Ordinary corridor walls never go through `DrawSquareRecord` at
> all: the driver enqueues them as kinds 5/6/7 straight to
> `DrawWallPieceDispatch`. The real source of the **3 front-wall depths vs. 4
> side-wall depths** asymmetry is two gates in Phase 1 — `CMPI.W #3,D2 / BGE`
> suppresses the front-wall row at depth 3, and `TST.W D3 / BNE` restricts side
> walls to the centre column. `DrawSquareRecord`'s own front/side logic applies
> to the *structure* squares reached via kind 13.

#### Screenshot corroboration (structural match, not byte-exact)

Compositing the confirmed dest-position table by hand — `ceiling` (0,0),
`floor` (0,72), `wall0/1/2-{left,face,right}` and `sidewall-depth{0-3}-
{left,right}` at their documented (x,y), plus `panel-top` (64,9) and
`fountain` (64,38) from slot `$C8` — against the `bcdfx` texture atlas
(`public/assets/blackcrypt/amiga/textures/dungeon-bcdfx.png`) reproduces
`data/default-2.png`'s dungeon viewport (cropped at the confirmed `(38,20)`,
208×140) **structurally exactly**: same wall-step recession, same centred
panel/fountain position and size, same silhouette. Sweeping the crop origin
±4 px in both axes confirms `(0,0)` is already the best alignment (no hidden
offset). Raw RGB agreement is only ~41% (~55% outside the panel/fountain
area) because the screenshot is Amiberry's non-hardware EHB model (halves
the *expanded* 8-bit value) against this doc's hardware-correct EHB decode,
compounded by animated torch-flicker shading the static composite doesn't
reproduce — both already-documented, unrelated discrepancies (see "How the
screenshot oracle was set up"), not evidence against the layout. Classified
**rendered/structurally confirmed**, not byte-exact confirmed.

#### Still open

| Item | Best current result |
|------|---------------------|
| ~~The outer "walk the sight line…" driver~~ | **SOLVED — `DrawViewport` S_1 `+0x02D46`.** See "the outer render driver" above. The old entry's premise (zero references, therefore indirect dispatch) was an artefact of searching for unrelocated addresses; superseded by the correction at the top of this section. |
| ~~Which per-square "kind" table selects the renderer~~ | **SOLVED — two-level dispatch:** the drain loop's 14-entry `kind` jump table at S_1 `+0x03570`, then `DispatchSquareObject` (`+0x025B0`) on the object record's id. The old "each renderer self-selects, no dispatch table" hypothesis is **refuted**. |
| ~~Kind 11 handler body~~ | **SOLVED — see "Kind 11 … door frame + closed-leaf render" above.** `+0x025CAE` draws the door frame (Door Way 1/2/3) unconditionally; `+0x02613E` draws the closed-only leaf (Door Type 0/1 × 3 depths), gated on the confirmed door-open bit. All 13 descriptors byte-exact against the door chunk's cumulative offset table. |
| ~~The remaining kind handlers `+0x00224C` (kinds 4/12), `+0x02806` (8/9), `+0x02627A` (10), `+0x02A0E` (0–3)~~ | **SOLVED — all four traced; see "Kinds 0–3", "Kinds 4 and 12", "Kinds 8 and 9", "Kind 10" above.** All 14 jump-table entries now have a decoded body. Kind 10 is byte-exact (consumes slot `$B8` whole, 6,528/6,528). Kinds 4/12, 8/9 and 0–3 resolve to 13 named per-structure renderers whose art bindings are byte-exact against the already-documented slot layouts (see "Which routine draws which bank"). Residual sub-cases below. |
| ~~The object-type switch on `objRec[+4] & 0xF0` at S_1 `+0x033D2`~~ | **SOLVED, and the premise was wrong — the nibble is the square's N/E/S/W wall bitmask, not an object class.** All 11 arms decoded and mapped onto the Structure/Item type tables; whole-corpus census shows 12 distinct values, 11 handled, `0xF0` = monsters (intercepted earlier), and the 4 unhandled values occur zero times. See "The Phase-1 object switch at S_1 `+0x033D2`" above. |
| Where the `+0x22244` runtime structure-descriptor array is populated | Not traced. Presumably filled from `bcdfs` structure bytecode at level load. A literal-address search under the **corrected** base (`$A229C`) also returns 0 hits, so it is reached PC-relatively, not through a stored pointer. **A second consumer is now known:** the type-`0x2F` (statue) renderer `+0x227B4` reaches it through the same `+0x2201C`/`+0x22042` helpers as `DrawSquareRecord`. |
| Which container fills graphics-kernel slot `$00` | The floor-plate/trap renderer `+0x21732` blits from slot `$00` at `src` 18,764–18,932 (16×4 and 16×2, 7-plane masked, contiguous). Slot `$00` is not in the `bcdfx`/`bcdfy`/`bcdfz` tileset inventory, and the range is *not* a hole in the floor-item bank (slot `$30` is fully covered 0…31,388 with zero gaps), so it is a third, still-unidentified pixel buffer. |
| Slot `$C8`'s "special panel" body at `+6,060` | `+0x25340(D0 != 0)` reads 4,320 B starting 4,320 B past the documented end of chunk 10. Same over-allocation pattern as the alcove/plaque mirror buffers, but the code that fills it was not found this pass. |
| `$51A(A5)` — the door-family position variant | Read by the door frame (`+0x25CAE`), door leaf (`+0x2613E`), door lock (`+0x25DA0`) and door switch (`+0x25F9E`/`+0x26100`); when nonzero each adds `+0x24` to its position table, which uniformly changes the sprite's `y` to 40 at every depth. Almost certainly "this doorway square also carries a door frame, so raise the fitting" — **not verified**, and no write site was searched for. |
| ~~Kinds 0–3: the `dir == 3` (`+0x25E12` / `+0x26070`) position tables look unreachable~~ | **SOLVED — they are genuinely unreachable, and the reason is an off-by-one in the engine's own `kind → side` dispatch, not a gap in the reachability argument.** `kind == 3` is structurally impossible for types `0x22`/`0x0F` from *either* through-corridor facing, and the physically-left wall arrives as `kind == 0`, which `+0x02A0E` discards. The old row's arithmetic was also wrong: `kind == 2` is *not* forced — `kind ∈ {0, 2}` in an exact 50/50 split. See "Kind 3 and the left-wall position tables" above for the full derivation, the 504-combination sweep and the in-game fixture. |
| ~~`DrawDoorAtDepth`'s `$02(a2)` — depth, or party-relative direction?~~ | **SOLVED — party-relative direction.** See the corrected blockquote above "Kind 11" — an exhaustive whole-image caller scan found exactly one caller (`DispatchSquareObject` `+0x027B6`), which always passes the rebased direction `D3`, never a depth. |
| `A5+$48F` mirror-flag write site | Still not found. Re-checked this pass over a resynced recursive-descent disassembly: all 6 references (`+0x21750`, `+0x22C8E`, `+0x22CC2`, `+0x230B6`, `+0x230FE`, `+0x250AE`) are `TST.B` reads; no write site anywhere in the decoded stream. `DrawViewport` does not touch it, so it is set outside the viewport pipeline. |
| A genuine 4-entry facing-indexed (`0=N,1=E,2=S,3=W`-shaped) jump table *does* exist, at S_1 `+0x1EB2A` | **Traced and it is not the wall/floor render dispatch.** It's driven by comparing a cached facing byte `$4DE(A5)` against a live one `$4DF(A5)` (`+0x1EA18`) and, on change, jumps through 4 `BRA.W` trampolines to handlers at `+0x1EB3A/1EB50/1EB56/1EB5C`, each of which writes a run of `WAIT`/colour words into a *different* copper list (`$4E2(A5)`) with a per-handler step size — a **per-facing ambient torchlight colour-gradient effect**, not viewport compositing. This *is* a real, disassembly-confirmed direction dispatch in the graphics kernel — it just isn't the one the old (already-retracted) `AGENTS.md` "Direction Dispatch" note was describing, and it should not be re-chased as the wall-selection loop. |

---

### bcdfv — Ending Sequence Data (Multi-Block Container) — **SOLVED**

| Property    | Value                                          |
|-------------|------------------------------------------------|
| File size   | 191,917 B (0x2EDAD)                            |
| Compression | RLE (bcdfu LAB_0043, same scheme as bcdfx/y/z) |
| Content     | The endgame/epilogue cutscene: 10 narrated illustration panels, picture frame, 8×8 font, Black Crypt facade (intact + destroyed), credits |
| Loaded by   | bcdfu LAB_0033 (DOS Open `-30`, DOS Read `-42`) |
| Extractor   | `scripts/extract_bcdfv.py`, `scripts/bclib/bcdfv.py` |

> **Correction — bcdfv contains no monster sprites and no sound.** It was
> documented for months as "Sound + Monster Sprite Data … monster sprites:
> 64×96 pixels, 6-plane interleaved EHB … ~17+ frames per map", and the
> long-running "find the Two Head sprite in bcdfv" investigation (best result
> ~69 % shape match) was chasing something that is not in the file. Both
> claims traced back to hand-written *speculative* comments added to
> `bcdfu.asm` (`LAB_0033`, `LAB_0038`, `LAB_0039`, `LAB_003A`) that were never
> derived from the code they annotate — no register in those routines
> mentions a sprite, and bcdfu's music player reads its module from **inside
> bcdfu itself** (`LAB_00B3`/`LAB_00B4` load `LAB_00D0` at bcdfu `+0x82B4` and
> `LAB_00D1` at `+0x1C1D4`), never from the bcdfv buffer.
>
> `bcdfu` is the standalone **endgame overlay**: it opens bcdfv, plays the
> epilogue, and exits. Its own narration strings (`LAB_0010`…`LAB_0019`) —
> "THROUGH INCREDIBLE BRAVERY AND THE USE OF THE POWERFUL OGREBLADE, YOU
> DEFEATED THE OGRE…" — are the giveaway that was in plain sight.
>
> **The Two Head sprite was never missing.** It is in `bcdfb` (map 1's monster
> store, graphics ID `b2`), already extracted, and its 7 frames plus Rock Eye's
> 7 match the DOS `clipper.clp` monster bucket at **100.00 % silhouette
> agreement, 14 of 14 frames, zero mismatches** — see "Verification" below.

#### Block table (all 16 blocks, file order)

Read strictly sequentially: no seeking, no directory, no header. Buffer
offsets are relative to `12(A5)`, bcdfu's single big allocation. `$BB80` =
48,000 = one 320×200×6 screen, so the screen occupies `+0` … `+$BB7F` and
everything above it is scratch.

| # | File offset | Size | Read by | Type | Decoded size | Content |
|---|-------------|------|---------|------|--------------|---------|
| 1 | `+0x00000` | $4EB0 (20,144) | LAB_0038 | RLE → `+0` | 32,000 | **Congratulations screen** (320×200, planes 0–3) |
| 2 | `+0x04EB0` | $5067 (20,583) | LAB_003B | RLE → `+$BB80` | 48,000 | **Picture frame** (320×200, 6 planes EHB); LAB_003D then copies it to `+0` |
| 3 | `+0x09F17` | $0B10 (2,832) | LAB_003C | **raw** → `+$1A5E0` | 2,832 | **Font**, 59 glyphs |
| 4 | `+0x0AA27` | $2500 (9,472) | LAB_003F | RLE → `+$BB80` | 11,880 | Panel 01 — the Ogre |
| 5 | `+0x0CF27` | $2A6B (10,859) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 02 — ornate gorgon-medallion door ("obstacles") |
| 6 | `+0x0F992` | $26E5 (9,957) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 03 — Dragonlich |
| 7 | `+0x12077` | $279C (10,140) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 04 — Medusa |
| 8 | `+0x14813` | $1AD2 (6,866) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 05 — Possessor Demon |
| 9 | `+0x162E5` | $2074 (8,308) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 06 — Waterlord |
| 10 | `+0x18359` | $1D80 (7,552) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 07 — Ram Demon |
| 11 | `+0x1A0D9` | $2688 (9,864) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 08 — skull-banner crypt door |
| 12 | `+0x1C761` | $266E (9,838) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 09 — an armoured minion of Estoroth |
| 13 | `+0x1EDCF` | $267D (9,853) | LAB_0022 | RLE → `+$BB80` | 11,880 | Panel 10 — Estoroth |
| 14 | `+0x2144C` | $6754 (26,452) | LAB_0039 | RLE → `+0` | 40,000 | **Black Crypt facade, intact** (320×200, planes 0–4) |
| 15 | `+0x27BA0` | $678C (26,508) | LAB_003A | raw → `+$BB80` | 32,000 | **Black Crypt facade, destroyed** — see correction below |
| 16 | `+0x2E32C` | $0A81 (2,689) | LAB_0040 | RLE → `+$BB80` | 4,590 | **Credits graphic** |

`sum(sizes) = 191,917` exactly, and every RLE block's decompressor consumes
its input to the byte with the terminating `0x00` landing on the last byte —
**16/16 blocks, zero deviation**. That is the invariant `bclib.bcdfv.read_blocks`
enforces.

> **Correction — block 15 is *not* raw.** `LAB_003A` reads it verbatim, but
> `LAB_005E` (bcdfu `+0xEB4`) RLE-decompresses it later, at the moment of the
> white flash, with `A0 = 12(A5)+$BB80`, `A1 = 12(A5)+0`, `BSR LAB_0043`. It
> yields 32,000 B = planes 0–3, deliberately leaving **plane 4 intact from
> block 14** — which is what puts palette indices 16–31 (the red/orange fire
> colours of `LAB_000F`) into the destroyed screen's sky. Rendered at 4bpp it
> looks like a plausible but flat grey ruin; the retained fifth plane is the
> difference between "renders" and "correct".

> **Correction — the old "Phase 1 / Phase 2" split was an artefact.** Blocks
> 1–13 are the epilogue's *screens in presentation order*, not an "intro" that
> gets thrown away. The COPY step (`LAB_003D`, `$BB80` → `+0`, 48,000 B) is
> just how the frame reaches the screen; and the "9× LAB_0022 calls totalling
> 83,237 B" are blocks 5–13, nine of the ten panels.

#### Picture panels — 160×99, 6 sequential planes (block type A)

`20 bytes/row × 99 rows = 1,980 B/plane × 6 planes = 11,880 B`, exactly, for
all ten panels. Geometry is read straight off the blitter in `LAB_0064`
(bcdfu `+0xF38`), the dissolve that reveals each panel — **not** guessed from
renders:

| Register | Value | Meaning |
|----------|-------|---------|
| `BLTSIZE` ($DFF058) | `$064A` / `$060A` | 10 words × 25 (or 24) rows → **160 px wide** |
| `BLTBMOD` ($DFF062) | 60 | source row stride = 20 + 60 = 80 B = four 20-byte rows |
| `BLTCMOD`/`BLTDMOD` | $8C (140) | dest row stride = 20 + 140 = 160 B = four 40-byte screen rows |
| `BLTCON0` | `$07CA` | USEB/USEC/USED, LF `$CA` = `A ? B : C` (cookie-cut through a mask) |
| `BLTADAT` ($DFF074) | `$8888`/`$4444`/`$2222`/`$1111` | the 4-column dither mask |
| `LEA 1980(A1),A1` | 1,980 | **source plane stride** |
| `LEA 8000(A2),A2` | 8,000 | dest plane stride (320×200) |

The 16 passes walk a 4×4 ordered dissolve: source byte offsets 0 / 20 / 40 /
60 (rows 0–3 of each 4-row group, from `LAB_0068`) paired with screen offsets
`$02DA` / `$0302` / `$032A` / `$0352` = rows 18 / 19 / 20 / 21 at byte 10.
So the panel lands at **(x=80, y=18)**, perfectly centred horizontally
(`(320−160)/2 = 80`).

Height falls straight out of the pass table: phases 0–2 blit 25 rows, phase 3
blits 24 (`$060A`), so the last row touched is `2 + 4×24 = 98` → **99 rows**.

#### Text panel — 256×55 at (32,135)

`LAB_0072` (bcdfu `+0x1140`) copies the narration area off-screen: 8 longs
(32 B) per row then `ADDQ.L #8,A0` (stride 40 = one screen row), 55 rows,
`A2 += 8000` per plane, starting at buffer offset **5,404** = row 135, byte 4.
`LAB_006B`/`LAB_006F` blit it back with `BLTDMOD = 8` (40 − 32) and
`BLTSIZE` height `55 − (row − 135)` for rows `$88`…`$BA`, an ease-out
roll-off animation between panels.

#### Font — 8×8, 6 planes, 48 B/glyph (block 3)

`LAB_0020` (bcdfu `+0x93E`) is the whole spec:

```asm
0942  MULU  #$0028,D1        ; D1 = pixelRow * 40
0946  ADD.W D0,D1            ; + charColumn      → screen byte offset
094C  ADDA.L #$0001a5e0,A0   ; A0 = buffer + font base
0952  SUBI.W #$0020,D2       ; D2 = char - ' '
0956  MULU  #$0030,D2        ; * 48 bytes per glyph
0962  MOVEQ #5,D0            ; 6 bitplanes
      ; per plane: 8 x { MOVE.B (A0)+,(A1) ; LEA 40(A1),A1 }
099A  LEA   8000(A2),A2      ; next screen plane
```

- Glyph stride `$30` = 48 B; layout is **plane-major within the glyph**:
  `[plane0 rows 0–7][plane1 rows 0–7] … [plane5 rows 0–7]`.
- First character is `0x20` (space); `2,832 / 48 = 59` glyphs **exactly**,
  covering ASCII `0x20`–`0x5A` (space … `Z`) — which is precisely the
  character set the uppercase narration strings use.

Narration records (`LAB_001A`/`LAB_001E`, table at bcdfu `+0x5EC`) are
`[charColumn, pixelRow, "STRING", 0x00]…`, terminated by `0xFF`; ten blocks
follow contiguously. `LAB_001E` waits three vblanks per character — a
typewriter effect. All 29 decoded lines use column 6 and rows 139–179 at a
10-pixel line pitch, i.e. entirely inside the 256×55 text panel.

#### Credits graphic — 240×153, **one** bitplane (block 16)

`LAB_0076` (bcdfu `+0x1178`), the scroll step:

| Evidence | Value | Meaning |
|----------|-------|---------|
| `MOVE.W #$264F,D2` → `BLTSIZE` | `$264F` | 15 words × 153 rows → **240×153** |
| `MULU #$001E,D1` | 30 | source row stride = **30 B/row** |
| `MOVE.W #$000A,102(A6)` | `BLTDMOD` = 10 | dest stride 30 + 10 = 40 = screen row |
| `ADDA.L #$00007D00,A0` → `BLTDPT` | 32,000 | dest is **plane 4 only** — a 1-plane overlay |
| `BLTCON0 = $59F0`, `BLTCON1 = $5000` | LF `$F0`, ASH/BSH 5 | plain `D = A`, shifted right 5 px |
| `LAB_007C` loop `D2 = $C7 … $FF67` | 199 → −153 | scrolls the full 153-row height off the top |

`30 × 153 = 4,590` — the block's decompressed size, **exactly**, zero
remainder. Drawn into plane 4 over the intact facade, so it takes palette
index 16 (`LAB_000D` word 16 = `$A0E`, purple).

#### Palettes (in bcdfu, 32 big-endian 12-bit words each)

File offsets, i.e. disassembly address + the `0x24` hunk delta:

| Name | File offset | asm | Used for |
|------|-------------|-----|----------|
| `congrats` | `0x3AC` | LAB_0007 | Congratulations screen — 16 colours **duplicated** into both halves (it is a 4-plane image loaded through a 32-entry `LoadRGB4`) |
| `panel_a` | `0x3EC` | LAB_0008 | Panels 01–03 |
| `panel_b` | `0x42C` | LAB_0009 | Panel 08 |
| `panel_c` | `0x46C` | LAB_000A | Panels 04, 05, 07 |
| `panel_d` | `0x4AC` | LAB_000B | Panels 09, 10 |
| `panel_e` | `0x4EC` | LAB_000C | Panel 06 |
| `crypt` | `0x52C` | LAB_000D | Facade intact + credits |
| `crypt_lit` | `0x56C` | LAB_000E | Lightning-flash variant (`LAB_0023` alternates 000E/000D) |
| `crypt_ruin` | `0x5AC` | LAB_000F | Facade destroyed |

`LAB_004F` calls `LoadRGB4(vp, table, 32)` while the screen is 6 planes deep —
32 registers for 64 indices, i.e. **EHB**, the same convention as the rest of
the game. The panel↔palette mapping comes from the `LAB_0022` call sequence at
bcdfu asm `0x0FE`–`0x19C`; note `LAB_0022` sets the palette for the panel
*already on screen* and then reads the *next* block, so call *i*'s palette
belongs to panel *i*.

> The first five of these are already in `bclib.palette` as
> `BCDFU_DUNGEON_PALETTES = [0x3EC, 0x42C, 0x46C, 0x4AC, 0x4EC]`, described
> there as "the epilogue overlay's copies of dungeon accent ramps 0–4". That
> independently pins the `0x24` hunk delta used for every offset in this
> section, and explains the resemblance: the panels show boss monsters standing
> in dungeon corridors, so they reuse the dungeon ramps.

Measured across the five panel palettes: registers **0–25 are byte-identical**
in all five, and they differ **only** at registers 26–31 — exactly the 6-entry
swappable dungeon accent ramp documented in the Palette section, independently
confirming that reading. Practically this means the panel↔palette mapping only
moves colour registers 26–31 and their EHB half-brights 58–63; the frame's
stonework is identical under every panel palette, which is why the ten scenes
all show the same grey frame.

#### Verification

| Check | Result | Oracle |
|-------|--------|--------|
| Container parse | 16/16 blocks decompress to their expected size; RLE terminator lands on the last input byte of every block; `sum = 191,917` | byte-exact structural invariant |
| Panel geometry | 160×99×6 = 11,880 B for all 10 panels, zero remainder | blitter registers (`LAB_0064`) |
| Panel placement | frame's black picture window measures **162×101 at (79,17)**; the code-derived 160×99 at (80,18) sits centred inside it with a 1 px bevel on all four sides | block 2's own bitmap, independent of the blit trace |
| Text-panel placement | region (32,135,256,55) has **0 of 14,080** non-black pixels; the 1-px ring outside is non-black on **all four sides (256/256, 256/256, 55/55, 55/55)** | block 2's own bitmap |
| Font | 2,832 / 48 = **59** glyphs exactly; all 29 narration lines render legibly | composited screens |
| Credits | 30 × 153 = **4,590** exactly | `LAB_0076` `BLTSIZE`/`MULU` |
| Full reconstruction | all 10 scenes composite to coherent, correctly-coloured, correctly-typeset screens | see `public/assets/blackcrypt/amiga/screens/ending-scene*.png` |
| Extractor regression | committed extractor vs. verified probe: **0 differing pixels** on the two non-EHB screens; on the 10 EHB scenes all 138,359 differing pixels have palette index ≥ 32 and differ by ≤ 8/255 — the probe's naive `c//2` half-bright vs. `bclib`'s correct `(nibble>>1)*17`. **0 unexplained differences.** | pixel diff |
| "Two Head is in bcdfv" | **refuted.** bcdfb map-1's 14 sprites match the DOS `clipper.clp` Two Head + Rock Eye bucket at **100.00 %** silhouette agreement, 14/14, dimensions identical | `public/assets/blackcrypt/dosvga/sprites/monsters.*` |

#### Paths tried (historical, now closed)

| Approach | Result | Why it failed |
|----------|--------|---------------|
| Block 2 as 6bpp sequential planar sprites, 64×96 | 69 % shape match (best prior result) | Block 2 is a 320×200×5bpp full screen, not sprites; 40,000 = 5 × 8,000 |
| Block 2 as 6bpp word-interleaved | 65 % shape match | same |
| 7-plane mask + word-interleave | mask runs avg 2.4 px, incoherent | same |
| Sweeping start offsets for a hidden sprite stream | n/a | there is no sprite stream; every byte is accounted for by the 16-block table |
| Font search at decompressed `$A148` | found a font sheet | coincidental — the real font is block 3 at buffer `+$1A5E0`, and it is 8×8×6bpp, not what was saved |

#### Output

| Asset | Contents |
|-------|----------|
| `screens/ending-congrats.png` | Congratulations screen |
| `screens/ending-frame.png` | Empty picture frame |
| `screens/ending-scene01…10.png` | The ten narrated scenes, composited exactly as bcdfu draws them |
| `screens/ending-crypt.png` | Black Crypt facade, intact |
| `screens/ending-crypt-ruined.png` | Black Crypt facade, destroyed (planes 0–3 from block 15 + plane 4 from block 14) |
| `screens/ending-credits.png` | Credits graphic over the facade |
| `sprites/ending-panels.{png,json}` | 10 × 160×99 panels |
| `sprites/ending-font.{png,json}` | 59 × 8×8 glyphs, ASCII `0x20`–`0x5A` |
| `palettes/ending-*.json` | The nine epilogue palettes |
| `data/ending-script.json` | 29 narration lines with their screen coordinates |

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
- Plot text: the main 32-color palette at bcdfq `+0x02C6` (same table used for
  monsters and portraits — see the Palette section; there is no separate
  "dungeon" palette)

> **Not disassembly-confirmed — a visually-eyeballed composite position,
> useful for a reimplementation's title screen.** No on-screen dest-position
> for overlaying chunk 3 (the "Black Crypt" logo banner, 320x44) onto chunk 2
> (the title screen, 320x200) is documented anywhere in this file — the four
> chunks read as discrete screens in an intro sequence, not necessarily one
> composited frame, and no code trace has settled the question either way.
> Sharing a palette (both chunks read `+0x0286`) is suggestive but not
> conclusive. Compositing them by eye for the project's docs site
> (`www/scripts/generate_hero.mjs`), the banner reads best at `(left=0,
> top=147)` — flush above the burned-in copyright text band (which starts
> around row 182) and clear of the castle/gargoyle art above it. Treat this
> as "looks right for an illustration", not a confirmed in-game screen
> layout — if a future pass finds the real compositing code (or determines
> there isn't one), update or remove this note.

### bcdfo — Character Portraits + UI Elements — **SOLVED**

| Property         | Value                                      |
|------------------|--------------------------------------------|
| File size        | 63,010 B                                   |
| Loader           | bcdfp LAB_00AB → LAB_00AE (reads entire file) |
| Header           | 96 bytes of `0xFF 0xFF 0xFF 0xFE` repeating |
| Portraits        | **36** tiles × 32×24×6bpp sequential planar, starting at buffer+$60 |
| UI elements      | 23 elements at bcdfp `LAB_010D` descriptor offsets — **all 23 are 7-plane masked sprites** |
| Fonts            | Three 8×8 fonts + one hardware-sprite bank between `chargen_stats` and the sigils |
| Unaccounted      | **none** — the layout below tiles all 63,010 B with 0 remainder and 0 overlap |

> **Correction:** this was previously documented (and extracted!) as **109**
> portrait tiles — `(63,010 − 0x60) / 576 = 109.2`, i.e. simply "how many
> 576-byte slots fit in the rest of the file" with no check that the content
> at slot 36+ was still a face. It isn't. **Tile 36 starts at exactly
> `0x60 + 36×576 = 0x5160`**, which is bcdfp's `LAB_010D` **desc00** source
> offset (`chargen_ui` — see the table below). Past that point the file is
> the UI descriptor data, not more 32×24 portrait tiles. Fixed:
> `N_REAL_PORTRAITS = 36` in `tools/shared/game-config.ts`'s `buildAssets`.

#### UI Element Descriptor Table (bcdfp `LAB_010D` — 28-byte entries)

The 28-byte entry is fully decoded (field offsets are from the entry base;
`LAB_011E`, `bcdfp.asm:4091`, is the consumer):

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| `+0`  | word | A5 pointer-table offset | `0` for every entry → `0(A5)` = the bcdfo buffer |
| `+2`  | long | source offset | `ADDA.L 2(A0),A3` / `ADDA.L 2(A0),A1` |
| `+6`  | long | plane stride | `(w/8) × h`; also `ADDA.L 6(A0),A1` per plane in the blit loop |
| `+10` | long | **mask offset** | `ADDA.L 10(A0),A3` — used only when flag bit 1 is set |
| `+14` | word | `BLTSIZE` | `(h << 6) \| words` |
| `+16` | word | screen modulo | written to `BLTCMOD` and `BLTDMOD` |
| `+18` | word | X | runtime, written by `LAB_011E` |
| `+20` | word | Y | runtime, written by `LAB_011E` |
| `+22` | byte | flags | bit 0 → clipped path (`LAB_0124`); **bit 1 → mask lives at `+10`** |
| `+24` | word | width (px) | |
| `+26` | word | height (px) | |

> **Correction — every one of the 23 elements is a *7-plane masked* sprite,
> and the earlier "appended mask plane" reading of three of them was
> wrong.** `LAB_011E` picks between two storage layouts on **bit 1 of the
> flag byte at `+22`** (`BTST #1,22(A0)` — a *byte* test, so the `$0200`
> longword literal in the descriptor source sets bit 1, not bit 9):
>
> ```asm
> ; flag bit1 = 0  (desc00-02):  mask FIRST, colour planes follow
>   ADDA.L  2(A0),A3        ; A3 = BLTAPT = mask   = base + source_off
>   MOVEA.L A3,A1
>   ADDA.L  6(A0),A1        ; A1 = BLTBPT = colour = base + source_off + stride
> ; flag bit1 = 1  (desc03-22):  colour at source, mask at the separate +10 offset
>   MOVEA.L A3,A1
>   ADDA.L  2(A0),A1        ; A1 = colour = base + source_off
>   ADDA.L  10(A0),A3       ; A3 = mask   = base + alt_off   (shared per group)
> ```
>
> An earlier pass read desc00–02 as 6-plane **opaque** images starting at
> their source offset. That is off by exactly one plane: the byte at the
> source offset is the *mask*, so every colour plane was read one plane
> early and the element's true last colour plane fell outside the span and
> was catalogued as an "unaccounted gap". Rendering under that reading
> silently produced a legible but **mis-coloured** image (a rotated palette:
> `chargen_ui`'s stone border came out purple/olive instead of grey, the
> guild banners lost their distinct backgrounds). It also invented three of
> the four "gaps": `0x78C0` is `chargen_ui`'s colour plane 5, `0x99C0` is
> `chargen_stats`' colour plane 5, and `0xEE98` is `chargen_title`'s colour
> plane 5 — not masks. The real masks are at the elements' own source
> offsets and at the `+10` field. See "Full file layout" below.

| Entry | Source | Dimensions | Count | Mask | Description |
|-------|--------|------------|-------|------|-------------|
| desc00 | `0x5160` | 128×105 | 1 | first plane, at `0x5160` | `chargen_ui` — 3×3 portrait picker in a stone frame |
| desc01 | `0x7F50` | 192×47 | 1 | first plane, at `0x7F50` | `chargen_stats` — the `STR/DEX/INT/CON/WIS/POOL` readout strip |
| desc02 | `0xD758` | 128×62 | 1 | first plane, at `0xD758` | `chargen_title` — `BLACK CRYPT / CHARACTER GENERATION / ENTER CRYPT` |
| desc03–07 | `0xAE68`–`0xB3A8` | 32×14 | 5 | shared, `0xAE30` | **Mystic sigils** — dithered orange bars carrying 4 rune glyphs (slot 0 blank) |
| desc08–11 | `0xB658`–`0xCF18` | 128×22 | 4 | shared, `0xB4F8` | **Class guild banners** (Fighter, Cleric, Magic User, Druid) |
| desc12–22 | `0xF286`–`0xF5CE` | 16×7 | 11 | shared, `0xF278` | **Numeral font** — one blank slot + digits `0`–`9` |

> **Correction — desc01 and desc02's descriptions were swapped.** desc01
> (192×47) is not a "character gen logo / Enter Crypt UI"; it is the stats
> readout strip. desc02 (128×62) is the panel that carries *both* the
> "BLACK CRYPT" title and the "ENTER CRYPT" button, not an "adjust
> character stats panel". Renamed to `chargen_stats` / `chargen_title` in
> `scripts/render_all.py`. Both are legible in `sprites/ui.png`.

The last numeral (desc22) ends at exactly `0xF622` = 63,010 = the file size.

#### The text machinery — `0x9E28`–`0xAE30` (code-confirmed)

The range the earlier passes called "gap 2" is bcdfp's character-generation
text machinery. Every offset here is taken from bcdfp's own code, not
inferred from the bytes.

`LAB_00FD` (`bcdfp.asm:3614`) is the string printer. Per character it does
`SUBI.B #$20,D0` — so **every bcdfo font is indexed by `ASCII − 0x20`, slot
0 = space** — then fetches from two banks at once:

```asm
LAB_00FF:
    MOVE.B  (A0)+,D0                ; next char; 0 terminates
    BEQ.S   LAB_0102
    SUBI.B  #$20,D0                 ; slot = ASCII - 0x20
    MOVE.L  D0,D1
    LSL.W   #3,D0                   ; slot * 8
    MOVEA.L D0,A3 / ADDA.L 0(A5),A3
    ADDA.L  #$0000a148,A3           ; A3 = bcdfo + 0xA148 + slot*8   (mask font)
    MULU    #$0030,D1               ; slot * 48
    MOVEA.L D1,A4 / ADDA.L 0(A5),A4
    ADDA.L  #$0000a320,A4           ; A4 = bcdfo + 0xA320 + slot*48  (colour font)
    MOVEQ   #7,D2                   ; 8 mask bytes  -> 16(A5), row stride 32
    MOVEQ   #47,D2                  ; 48 colour bytes -> 12(A5), row stride 32
```

`LAB_0102` then blits the assembled line with minterm `$0FCA` (mask in A,
colour in B), plane stride `256`, `BLTSIZE $0211` = 8 rows × 17 words = a
272-pixel, **34-character** line, screen modulo 6.

A second, plain-1-bit printer at bcdfp file `0x02CF4` (inside an IRA `DC.L`
block — `SUBI.B #$20,D0 / LSL.W #3,D0 / MOVEA.L 0(A5),A3 / ADDA.L
#$00009E28,A3 / …/ LEA $2A(A1),A1 / SUBA.W #$14F,A1`) draws the font at
`0x9E28` into a 42-byte-per-row (336 px) 1-bit buffer.

| Font | Offset | Size | Slots | Layout | Confidence |
|------|--------|------|-------|--------|------------|
| `chargen-font-a` | `0x9E28` | 512 B | 64 (ASCII 32–95) | 8 B/glyph, 1bpp | **confirmed** — offset + `ASCII−0x20` indexing read off bcdfp `0x02CF4` |
| `chargen-font-b` | `0xA148` | 472 B | 59 (ASCII 32–90) | 8 B/glyph, 1bpp | **CONFIRMED** — bcdfp `LAB_00FD` `+$A148`; 3,776/3,776 bits vs DOS `"CG Font"` |
| `chargen-font-cg` | `0xA320` | 2,832 B | 59 (ASCII 32–90) | 48 B/glyph, 6 planes **plane-major within the glyph** | **CONFIRMED** — bcdfp `LAB_00FD` `+$A320`; 3,776/3,776 pixels vs DOS `"CG Font"` at full colour depth |

- **Font A** is a complete ASCII 32–95 set. Slots 1–3 (`!"#`) and 59–63
  (`[\]^_`) hold directional-arrow icons instead of their literal glyphs —
  the same "icons replace unused punctuation slots" convention already
  documented for bcdfa's message-log font. Slot 32 (`@`) is a `©` glyph.
- **Font B** is the 1-bit **mask/silhouette** plane of the colour font, and
  a usable 1-bit font in its own right: the first 33 slots are blank, the
  last 26 a bold `A`–`Z`.
- **Font CG** uses only planes 0, 1 and 5 (26 glyphs each; planes 2–4 are
  entirely zero): plane 1 is the letter body (index 2), plane 0 a highlight
  (index 3), plane 5 an EHB shadow (index 34) — a bevelled letter. This is
  the same 59-glyph, 48 B/glyph, plane-major-within-glyph format as
  **`bcdfv` block 3's ending font** (see that section) — the game-wide Amiga
  font convention.

**Verification.**

1. *Structural invariant.* The OR of the colour font's six planes equals the
   1-bit mask font **byte-for-byte for 59/59 slots** — which is exactly why
   one 8-byte mask can drive a 48-byte glyph. Checked in
   `scripts/extract_bcdfo_fonts.py`; it raises if this ever fails.
2. *Cross-platform oracle, silhouette.* DOS `clipper.clp` entry 207
   `"CG Font"` is an 8×472 8bpp raster = 59 slots of 8×8. Thresholded to
   ink/no-ink it agrees with `chargen-font-b` on **3,776 of 3,776 bits
   (100.000%)** across all 59 slots — including the 33 blank ones.
3. *Cross-platform oracle, full colour.* Stronger still: the DOS raster's
   palette indices are the *same numbers* as the Amiga's EHB indices. The
   only values present in the DOS entry are `{0, 2, 3, 34}`, and the DOS →
   Amiga index mapping is the **identity** on **3,776 of 3,776 pixels**.
   (`34` is EHB half-bright of `2`, so this independently confirms the
   plane-5 EHB reading too.)

For contrast, `chargen-font-a` matches no DOS font: its best is 91.340%
against `"Scroll Font 1"`/`"Scroll Font 2"` (21 differing slots). It is a
distinct Amiga face and is documented as **confirmed by code, rendered by
eye**, not cross-platform-verified.

##### `0xA028`–`0xA148` — the mouse-pointer hardware sprite bank

288 B = **3 × 96**, the same bank shape as `bcdfa` entry 5's `0x7110`:
records 0 and 1 are an *attached* SPR0/SPR1 pair (4 planes, 15 colours,
register base `COLOR16`) each with a 4-byte `SPRxPOS`/`SPRxCTL` header
(`$7E000000`, patched at runtime), and record 2 is all zeros (the null
sprite the unused SPR2–SPR7 point at).

**CONFIRMED** — these 288 bytes are **byte-identical (288/288)** to
`bcdfa` entry 5's `0x7110` mouse pointer, which is itself already confirmed
100.000% against DOS `clipper.clp` entry 163 `"Mouse Arrow"`. The pointer is
16×10 with a 11×10 content bounding box. Not re-extracted — `sprites/automap.*`
already carries it from bcdfa; a second copy would be duplicate output.

#### Full file layout — tiles 63,010 B with 0 remainder

| Range | Size | Content |
|-------|------|---------|
| `0x00000`–`0x00060` | 96 | header (`0xFFFFFFFE` repeating) |
| `0x00060`–`0x05160` | 20,736 | 36 portrait tiles, 32×24×6bpp |
| `0x05160`–`0x07F50` | 11,760 | `chargen_ui` 128×105 — mask + 6 colour planes |
| `0x07F50`–`0x09E28` | 7,896 | `chargen_stats` 192×47 — mask + 6 colour planes |
| `0x09E28`–`0x0A028` | 512 | **font A** — 64 slots × 8 B |
| `0x0A028`–`0x0A148` | 288 | **mouse-pointer sprite bank** — 3 × 96 B |
| `0x0A148`–`0x0A320` | 472 | **font B / CG-font mask** — 59 slots × 8 B |
| `0x0A320`–`0x0AE30` | 2,832 | **font CG colour** — 59 slots × 48 B |
| `0x0AE30`–`0x0AE68` | 56 | sigil shared mask (desc03–07 `+10`) — all `0xFF` |
| `0x0AE68`–`0x0B4F8` | 1,680 | 5 sigils × 336 B |
| `0x0B4F8`–`0x0B658` | 352 | guild-banner shared mask (desc08–11 `+10`) |
| `0x0B658`–`0x0D758` | 8,448 | 4 guild banners × 2,112 B |
| `0x0D758`–`0x0F278` | 6,944 | `chargen_title` 128×62 — mask + 6 colour planes |
| `0x0F278`–`0x0F286` | 14 | numeral shared mask (desc12–22 `+10`) |
| `0x0F286`–`0x0F622` | 924 | 11 numerals × 84 B |

Verified programmatically: sorting these 32 records by offset leaves **zero
holes, zero overlaps, and ends at exactly 63,010** — the file size. Every
byte of bcdfo is now attributed, and every attribution above is anchored to
either a `LAB_010D` descriptor field or a `LAB_00FD`/`0x02CF4` code constant.

#### Palette

bcdfo's elements are authored against **bcdfp's own 32-word palette**
(`LAB_0148`, bcdfp file `0x4194` — the loader/character-generation palette,
byte-identical to `BlackCrypt`+0x2848 and to DOS `Character_Gen_Palette`),
not bcdfq's `game` palette. The two differ at index 19 and 26–31, and 26–30
is exactly the accent range the sigils and numerals are drawn in, so the
distinction is visible. Exposed as `bclib.read_chargen_palette` /
`BCDFP_CHARGEN_PALETTE`.

##### Paths tried on the "unaccounted gaps"

Kept because the dead ends are instructive: three separate techniques
returned confident, plausible, and *wrong* answers before the descriptor's
own `+10` field settled it.

| Gap | Approach | Result |
|-----|----------|--------|
| all 4 | Opaque 6-plane render at 16/32/48/64/80/96/128/192 px | No coherent image at any width in any gap — because none of the four is a standalone image; each is one plane of a neighbouring element or a font |
| all 4 | Byte-value/entropy check (unique-byte count per gap) | `0x78C0`: 152 unique/1,680 B; `0x99C0`: 100 unique/5,288 B; `0xB4F8`: **2** unique/352 B; `0xEE98`: 100 unique/1,006 B. Correctly flagged `0xB4F8` as mask-like; said nothing useful about the rest |
| `0x78C0`, `0xEE98` | Structural padding-column scan (constant index per plane, widths 2–12 B, heights 10–39) | **Zero hits** — correct, they are single bitplanes of a larger image, which has no such column |
| `0x99C0` | Same scan | Hundreds of thousands of hits (W=8, H=39) — too undiscriminating |
| `0x99C0` | DOS `clipper.clp` size cross-check for `(⌈w/16⌉×2) × h × {6,7}` = 1,680/5,288/352/1,006 | Exact hits for 1,680 (`Plaque C`, `Plaque D`, `AS Stats`) but none for 5,288. All coincidental — the 1,680 figure is a *plane* size, not an element size, so no DOS entry could ever have matched |
| `0x99C0` | Tested the first 1,128 B as `chargen_logo`'s appended mask plane | "Scattered dots and two solid brown rectangles" — **rejected at the time, and the rejection was right for the wrong reason.** Those bytes *are* part of `chargen_stats`, but as its colour plane 5, and the "two rectangles" are precisely the two dark inset panels visible in the finished element |
| `0x99C0` | Tested the last 280 B as a mask shared by all 5 sigils | Bit density 28.4%, "plausible but low-confidence". **Refuted** — 224 of those 280 B are the colour font's `V`–`Z` glyphs; only the final 56 B are the sigil mask, and the descriptor names that offset (`$AE30`) outright |
| `0x78C0`, `0xB4F8`, `0xEE98` | Mask-adjacency: match each descriptor's *6-plane* end offset to a gap start and render the gap as a 7th plane | 3/3 "hit" with legible art — and 2 of the 3 were **wrong**. `0xB4F8` is genuinely the guild mask; `0x78C0` and `0xEE98` are colour plane 5 of `chargen_ui`/`chargen_title`, and using them as masks rotated every plane by one. Legibility survived the rotation, so "it renders cleanly" was not the discriminator it looked like |
| `0x99C0` | Per-200-byte non-zero density histogram, then 8×8/1bpp render of the dense windows | Found real fonts, but at the **wrong bases and counts** (`0x9E30`/73 slots and `0x9E30`+`0xA250`/26 slots) — a density scan finds where ink is, not where a slot table starts, and both fonts begin with blank slots |
| all 4 | **Read the descriptor.** Decode all 28 bytes of a `LAB_010D` entry, follow `LAB_011E`, and take the `+10` mask pointer and `+22` flag literally | **Solved everything at once.** The three shared masks (`$AE30`, `$B4F8`, `$F278`) are written out in the descriptor table; the mask-first layout for desc00–02 is a two-instruction branch. The whole file then tiles with 0 remainder. Two prior passes had this table in front of them and read only the source offset and the `w`/`h` words out of it |

---

### Palette

The dungeon runs in 6-bitplane EHB: 32 hardware colour registers, with 32–63
generated by hardware as half-intensity copies. The copper list that installs
them is built in `bcdfp` `LAB_00BD` (32 × `COLOR` writes starting at `$0180`,
line 2923).

> **Correction — `bcdfp` `LAB_0137` is a *fade*, not the dungeon palette
> loader, and its "palette table" has exactly one entry.** `LAB_0137`
> (`bcdfp.asm:4397`) does `D3 = (D1−1) << 6` then `LEA LAB_0148(PC),A1 /
> LEA 0(A1,D3.W),A1`, so the `(n−1) × 64` indexing is real — but `LAB_0148`
> (`bcdfp` file `0x4194`) is a *single* 64-byte record immediately followed by
> code (`LAB_0149`, `48E7 2020` = `MOVEM.L D2/A2,-(A7)`), and the only two call
> sites both go through `LAB_0131` with `D0 = 1` (fade in) and `D0 = 0` (fade
> out, `LAB_0132`). `LAB_0140`/`LAB_013B` step each colour nibble one unit per
> vertical blank over 16 frames — a screen transition, not a palette install.
> `bcdfp`'s copper list `COLOR` block (`1108(A5)`, written at `bcdfp.asm:2922`)
> is *only* ever touched by those two fade routines. The dungeon view's palette
> is installed by completely different code living in the decompressed `bcdft`
> image — see "Dungeon accent-ramp selection" in the bcdfx/y/z section.
>
> `bcdfp`'s one palette is also **not** byte-identical to `bcdfq`+0x2C6: it
> differs at index 19 (`0020` vs `033B`) as well as at 26–31. It is
> byte-identical to `BlackCrypt`+0x2848, and matches DOS
> `Character_Gen_Palette` — it is the loader/character-generation palette.

#### The palette is one fixed core plus a swappable accent ramp

Eight 32-word palettes exist across the game files. Comparing them shows a
**fixed core** — indices `0`, `16`, `17`, `18`, `20`–`25` are byte-identical in
every single variant — while **only indices 19 and 26–31 change**:

| File | Offset | idx 19 | idx 26–31 | Character |
|------|--------|--------|-----------|-----------|
| `bcdfp` | `0x004194` | `033b`→`0020` | `0b30 0c40 0d51 0e62 0f73 0f84` | orange / fire |
| `bcdfq` | `0x0002c6` | `033b` | `0b60 0c70 0c80 0d90 0eb0 0fc0` | gold |
| `bcdfu` | `0x0003ec` | `033b` | `0432 0542 0653 0764 0875 0986` | brown |
| `bcdfu` | `0x00042c` | `033b` | `0223 0334 0445 0647 0858 0968` | blue-grey |
| `bcdfu` | `0x00046c` | `033b` | `0332 0443 0654 0987 0ba8 0eeb` | **stone / olive** |
| `bcdfu` | `0x0004ac` | `033b` | `0222 0333 0444 0555 0666 0777` | neutral grey |
| `bcdfu` | `0x0004ec` | `033b` | `0234 0345 0456 0678 089a 09ab` | blue |
| `bcdft` (decompressed) | `0x01e886` | `0fd0` | `0332 0443 0654 0987 0ba8 0eeb` | stone / olive |

Seven distinct accent ramps *in the raw files*.

> **Correction / completion:** the table above is a census of *copies*. The
> authoritative accent-ramp table is in the decompressed `bcdft` image at
> **S_1 `+0x27B00`** and has **12 entries of 12 bytes** (6 words = COLOR26–31);
> the five `bcdfu` records are entries 0–4 duplicated into the epilogue overlay,
> and `bcdft`+0x1E886 is entry 2 duplicated into a UI palette. The `bcdfs`
> action opcodes `0x1E`/`0x1F` **are** confirmed targets of it — the action
> record's byte `0x07` is the ramp index, written to `$1E62(A4)` and applied by
> `SetDungeonPalette` (S_1 `+0x26900`). There is also a per-level default table
> and a per-square override. Full trace: "Dungeon accent-ramp selection
> (confirmed)" in the bcdfx/y/z section.

> **Corrections to earlier notes:**
> - `bcdfu` holds **five** variants, not four, and the previously listed offsets
>   `0x03C8 / 0x0408 / 0x0448 / 0x0488` are **CODE**-relative. File offsets are
>   `+0x24`: `0x03EC / 0x042C / 0x046C / 0x04AC / 0x04EC`.
> - The claim that a "monster palette" sits at `bcdfu` file `0x2C6` is wrong —
>   that offset lands inside the library-name strings
>   (`graphics.library`…). There is no separate monster palette; monsters and
>   walls necessarily share one EHB palette.
> - Index **19 also varies** (`033b` / `0020` / `0fd0`), so the varying set is
>   {19, 26–31}, not {26–31} alone.

#### Palette used for sprite extraction (verified)

Indices 0–25 from `bcdfp` `0x4194`, indices 26–31 from the stone/olive ramp:

| Idx | 12-bit | RGB | Description | Idx | 12-bit | RGB | Description |
|-----|--------|-----|-------------|-----|--------|-----|-------------|
| 0  | `0x000` | 0,0,0       | Black            | 16 | `0x720` | 119,34,0    | Dark orange-brown |
| 1  | `0xC86` | 204,136,102 | Amber / skin     | 17 | `0x952` | 153,85,34   | Medium brown |
| 2  | `0xF00` | 255,0,0     | Red              | 18 | `0xA53` | 170,85,51   | Light brown |
| 3  | `0xB00` | 187,0,0     | Dark red         | 19 | `0x020` | 0,34,0      | *(varies)* |
| 4  | `0xD80` | 221,136,0   | Brown            | 20 | `0x222` | 34,34,34    | Dark grey |
| 5  | `0xFE0` | 255,238,0   | Yellow           | 21 | `0x444` | 68,68,68    | Grey |
| 6  | `0x0F0` | 0,255,0     | Green            | 22 | `0x666` | 102,102,102 | Light grey |
| 7  | `0x0B0` | 0,187,0     | Dark green       | 23 | `0x999` | 153,153,153 | Lighter grey |
| 8  | `0x040` | 0,68,0      | Very dark green  | 24 | `0xCCC` | 204,204,204 | Very light grey |
| 9  | `0x0DD` | 0,221,221   | Cyan             | 25 | `0xFFF` | 255,255,255 | White |
| 10 | `0x00F` | 0,0,255     | Blue             | 26 | `0x332` | 51,51,34    | **accent 1** |
| 11 | `0x07C` | 0,119,204   | Medium blue      | 27 | `0x443` | 68,68,51    | **accent 2** |
| 12 | `0xFD9` | 255,221,153 | Light tan        | 28 | `0x654` | 102,85,68   | **accent 3** |
| 13 | `0xEB8` | 238,187,136 | Tan              | 29 | `0x987` | 153,136,119 | **accent 4** |
| 14 | `0xF0F` | 255,0,255   | Magenta          | 30 | `0xBA8` | 187,170,136 | **accent 5** |
| 15 | `0xE09` | 238,0,153   | Pink             | 31 | `0xEEB` | 238,238,187 | **accent 6** |

**How this was validated.** Indices 0–25 were derived independently by matching
decoded plane data against 14 reference PNGs of map 1, giving a
**purity of 1.000 on every index** (each colour index mapped to exactly one RGB
across all frames) — then confirmed byte-identical to `bcdfp` `0x4194`.
Indices 26–31 were validated against an in-game screenshot of map 7: the render
produces `(68,68,51)` / `(51,51,34)` / `(102,85,68)` as its three dominant
colours, matching the screenshot's `(66,69,49)` / `(49,48,33)` / `(48,47,32)` in
both value (within JPEG noise) and rank order.

Only maps that actually use indices 26–31 are sensitive to the ramp choice:
map 7 (47.1% of pixels), map 8 (31.2%), map 6 (3.0%), map 11 (0.5%),
map 4 (0.3%). Maps 1, 2, 3, 5, 9, 10, 12, 13 are unaffected.

**12-bit → 24-bit conversion:** multiply each nibble by 17
(`0xC86` → 204,136,102). EHB half-bright (32–63) = `(r>>1, g>>1, b>>1)`.

#### Title screen palettes (bcdfq)

| Offset | Size | Used by | Description |
|--------|------|---------|-------------|
| `0x0266` | 16 × 16-bit | Raven logo (4bpp) | Black, golds, greys |
| `0x0286` | 32 × 16-bit | Title + Logo (6bpp) | White, golds, greys, reds |
| `0x02C6` | 32 × 16-bit | Plot text / intro | Gold accent ramp variant |

**Windows VGA palette:** a search of the Windows demo (`crypt.exe`,
`clipper.clp`) found no clean 256-colour VGA DAC table.

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

From the disassembly strings, the game loads resources as follows (see the
correction above — bcdfq loads **bcdfr**, not itself; there is no self-reading
mechanism):

```
GAMEDISK1:bcdfp      — code overlay (game logic)
GAMEDISK1:bcdfq      — code overlay + 82KB appended CHIP data (memory-resident
                        music/palette data, not re-read from disk) + opens bcdfr
GAMEDISK1:bcdfr      — 4 full-screen images, opened and read by bcdfq
GAMEDISK1:bcdft      — code overlay (LZ77-compressed dungeon data, 7 hunks)
GAMEDISK1:bcdfs      — map / dungeon layout data (read by bcdfp)
GAMEDISK2:bcdfu      — endgame/epilogue player (also RLE decompressor, music, text)
GAMEDISK2:bcdfv      — endgame/epilogue sequence data (16-block RLE container, 192KB)
CHARACTERS            — character graphics (read by bcdfp)
OrigDungeons          — dungeon layout data (read by bcdfp)
TempDungeons          — dungeon layout data (written by bcdfp)
GAMESAVE:             — save game directory
Configuration.dat     — keyboard config (8 bytes)
```

bcdfx/bcdfy/bcdfz are NOT opened by name in any code (confirmed by `strings -a`
across every overlay — see the correction above). **How they are loaded is
still unknown**; the "bcdfq self-reading mechanism" theory that previously
stood in for an answer here was checked and is false.

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

### Item bytecode (exactly 20 bytes)

All items share a common 9-byte prefix:

```
Offset  Size  Description
──────  ────  ──────────────────────────────────
0x00    2     gfxNumber (also determines hardcoded weapon stats)
0x02    2     name reference — see below (0 = unnamed)
0x04    1     position on square (N=1, E=2, S=4, W=8; NE=3, SE=6, NW=9, SW=0xC)
              AND class usage (+1 Fighter, +2 Cleric, +4 Druid, +8 Magic User)
0x05    1     itemType (defines the remaining bytes' layout)
0x06    1     position in container (0–7 upper row, 8–15 lower row)
```

> **Correction — "~20 bytes" is exactly 20, and `+0x02` is not a plain
> offset.** The loader reads a fixed `0x14` bytes per record (`pea $14.w`
> before the read helper at S_1 `+0x18A56`), and every consumer indexes the
> runtime array with `unique × 20`; there is no variable-length item record.
> The word at `+0x02` is a **tagged** reference, not a bare offset into
> `bcdft`:
>
> | `+0x02` | meaning |
> |---|---|
> | `0x0000` | no name |
> | bit 15 **clear** | byte offset into the map-item name block at decompressed `bcdft` S_1 `+0x1C4E2` |
> | bit 15 **set** | index (`& 0x7FFF`) into the 19-entry `char *` table at `bcdft` S_2 `+0x07BA` |
>
> Full trace, evidence and the icon join: "bcdfa — Item Icon Bank" →
> "Icon → item-name linkage". 685/685 references in the shipped `bcdfs`
> resolve exactly under this rule.

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
| 0x10 | Illusionary wall / Glyph / Magic field | varies — see the field map below |
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

#### Structure record field map — type `0x10` (Illusionary wall / Magic field / Glyph) — **confirmed**

Type `0x10` is **three** different objects sharing one type byte, told apart by
the record's **word `+0x0C`**. Every consumer switches on it, and the shipped
data partitions cleanly: **97 records → 59 / 25 / 13**, each sub-kind with
exactly one `gfxNumber`, zero mixing.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| +0x00 | 2 | `gfxNumber` | `0x00C1` (sub-kind 1), `0x0048` (2), `0x003C` (3) — **fully determined by `+0x0C`** |
| +0x02 | 2 | name ref | `0x01F3` on 37 illusionary walls, else `0x0000` |
| +0x05 | 1 | type | `0x10` |
| +0x07 | 1 | index / count | sub-kind 2: 0/7/8/9; sub-kinds 1 and 3: always 0 |
| +0x0A | 2 | passable flag | nonzero ⇒ `ResolveTargetSquare` returns "open" before any sub-kind test (S_1 `+0x27CC0`) |
| **+0x0C** | **2** | **sub-kind** | **1** = Illusionary wall (pass through, nothing drawn), **2** = Magic field (blocks, screen-shake), **3** = Glyph |
| +0x0E | 2 | payload magnitude | sub-kind 3: scales the glyph's damage roll (`5 + rand(5×w0E)` for glyph types 2/3) |
| **+0x10** | **2** | **BCSPEED effect selector** | sub-kind 3 only: `1…4`. Drawn in the viewport as effect `w10`, played on trigger as effect `w10 + 4`. Sub-kind 2 carries 0/54/56/57 here but never reaches an effect call |
| +0x12 | 2 | chain-next | same-square object chain |

Consumers (both read the same word `+0x10`; full trace in "bcdfa —
BCSPEED.EFF" → "Which effect belongs to which spell"):

| `+0x0C` | Movement (`ResolveTargetSquare` S_1 `+0x27CBA`) | Render (`DispatchSquareObject` type-`0x10` case S_1 `+0x0231C`) |
|---|---|---|
| 1 — Illusionary wall | falls through ⇒ result 0, party walks through | nothing drawn |
| 2 — Magic field | result **7** ⇒ blocked + screen-shake jolt | `JSR $A155C` (S_1 `+0x21504`) draws the field |
| 3 — Glyph | result **5** ⇒ S_1 `+0x04662` plays effect `w10 + 4` and applies the damage handler | static effect tick `w10`, group `byte(+0x07)`, at depth 1 dead-ahead only |

> **Correction — result codes 5 and 6 were missing from the
> `ResolveTargetSquare` write-up.** That section lists 0/1/2/3/4/7/8/9 and says
> type `0x10` returns "either the default open fall-through or blocked-code 1".
> It returns **5** (glyph, sub-kind 3) and **7** (magic field, sub-kind 2) as
> well, and type `0x1E` returns **6** (S_1 `+0x27CF8`). `MoveParty` handles 5 at
> `+0x16F86` (`JSR $846BA` = S_1 `+0x04662`) and 6 at `+0x16F8E` (`JSR $8CF8C`
> with the party X/Y and a `0x1E` tag), both reached from the two-step `SUBQ.W`
> ladder at `+0x16FA4`.

Sub-kind 2's `+0x10` values (54/56/57 on 5 records, all on map 2) and its
`+0x07` values (7/8/9) are read by neither the movement nor the render path
traced here — they are **not** effect indices despite being in range. Whatever
consumes them is still open.

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

> **Correction — the field table above is shifted by one, and every action is
> 8 bytes.** There is no per-record "action ID" byte at offset `0x00`: an
> action's id is its **index** into the runtime action array at `A4+0x836`
> (stride 8, `slot = 0x836 + id×8`), the first id comes from the owning
> structure's byte `+0x0D`, and each record's byte `+0x07` is the *next* id.
> The confirmed layout, read off three independent consumers — the executor
> `+0x0C4F6`, the chain walker `+0x0CF34` and the deferred-event handler
> `+0x01B70` — is:
>
> | Offset | Size | Field | Evidence |
> |---|---|---|---|
> | `0x00` | 1 | **Action opcode** (the 36-entry table below) | `MOVE.B (a0,d0.l),d0` → `BRA $0CE9C` at S_1 `+0x0C544`; restored from the event at `+0x01B82` |
> | `0x01` | 1 | **Clicks to trigger** — compared against the owning structure's click counter (byte `+0x11`) + 1 | S_1 `+0x0D014`/`+0x0D028` |
> | `0x02` | 1 | **Target column (X)** | `MOVE.B $2(a0,d0.l),d1 → d3` at `+0x0C50E`; used as `col<<2` in the map index |
> | `0x03` | 1 | **Target row (Y)** | `MOVE.B $3(a0,d0.l),d1 → d4` at `+0x0C520`; used as `row<<8` |
> | `0x04` | 1 | **Runs remaining** — decremented per fire; `0xFF` is never decremented (`TST.B`/`BLE` skips it) = infinite | S_1 `+0x0D094`/`+0x0D0AA`/`+0x0D0B8` |
> | `0x05` | 1 | **Delay in turns** — `0` = execute immediately, otherwise schedule at `$1750(a4) + delay` | S_1 `+0x0D0C6`/`+0x0D0BC` |
> | `0x06` | 1 | **Action value** (accent-ramp index, monster type, wall direction, …) | `MOVE.B $6(a0,d0.l),d5` at `+0x0C530` — matches the already-documented `0x1E`/`0x1F` correction below |
> | `0x07` | 1 | **Next action id** — `0` ends the chain, the first action's own id loops it | S_1 `+0x0D138`, and the loader's `$987BC` walk |
>
> The doc's own worked example already reads offset `0x00` as the opcode
> (`0B 01 0C 25 01 00 00` = "teleport off, 1 click, target `0x0C,0x25`,
> 1 run, no delay, no value") — the table was simply out of step with it.

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

**Dispatcher (confirmed):** `bcdft`-decompressed S_1 `+0x0CEA8` —
`CMPI.W #$24,D0 / BCC default / ADD.W D0,D0 / MOVE.W (tbl,PC,D0.W),D0 /
JMP (0,PC,D0.W)`, with a **36-entry** word table at S_1 `+0x0CE54` covering
opcodes `0x00`–`0x23`. So one opcode beyond the list above (`0x23`) exists and
has its own handler at S_1 `+0x0CA08`; its meaning is undetermined.

For opcodes **`0x1E` and `0x1F` the "action value" byte (record offset `0x06`)
is the dungeon accent-ramp index (0–11)** — both handlers (S_1 `+0x0CCE6` and
`+0x0CD3E`) do `MOVEQ #0,D0 / MOVE.B D5,D0 / MOVE.W D0,$1E62(A4) / JSR
SetDungeonPalette`. See "Dungeon accent-ramp selection" in the bcdfx/y/z
section for the ramp table and the per-level defaults.

> **Correction:** this previously read "record offset `0x07`". The 8-byte
> in-memory action record loads its value byte from offset `0x06`
> (S_1 `+0x0C530`); offset `0x07` is the chain-next index. Full field table in
> the "Selector 3" correction block in the Palette section.

**Action chain termination:** After the last action, a single byte follows:
- `0x00` — one-shot, no loop
- Action ID matching the first action — loops back to the beginning

**Verified:** Switch structure `00 3E 00 00 10 1D 00 00 00 00 00 00 00 [actionID] 00 00 00 00`
followed by `00 00` or action bytes matches the documented patterns.
Floor plate actions begin with 7-byte records (e.g., `0B 01 0C 25 01 00 00` for
"teleport off, 1 click, target 0x0C,0x25, 1 run, no delay, no value").

#### `TriggerActionsAt(col, row, structType)` — S_1 `+0x0CF34` — **SOLVED**

> **Correction — supersedes "a generic structure-toggle/animation-slot
> dispatcher … a runtime prop-animation-slot table at `A4+0x836` … a generic
> tag-based resource scheduler".** `A4+0x836` is **not** a prop-animation-slot
> table: it is the **action array** — the very 8-byte `bcdfs` action records
> documented above, indexed by action id (`slot = 0x836 + id×8`). `+0x0CF34`
> is the engine's single **action-chain executor**: "an object of type `T` at
> `(col,row)` was activated — run its action chain." Every explicit-case /
> shared-tail framing in the earlier note describes this one routine.

**Signature (confirmed, all 9 call sites agree).** SAS/C stack args, `LINK
A5,#-8`:

| Frame | Size | Arg | Note |
|---|---|---|---|
| `8(a5)` | word | **col (X)** | → `A6`, then `D1` |
| `0xA(a5)` | word | **row (Y)** | → `D2` |
| `0xC(a5)` | byte | **structure type to activate** | → `D3` (byte pushes land on the even address — verified against `+0x0C4F6`, which reads its own pushed byte arg at `$8(a5)`) |

It calls the confirmed resolver `JSR $A7D80.l` (S_1 `+0x27D28`,
`resolveUnique(col, row, type)`) and works on `A4 − 0x6E7A + unique×20`.

**The nine call sites and the type each passes:**

| Call site | Type arg | Context |
|---|---|---|
| S_1 `+0x0DD48` | `0x1D` Switch | clicking a wall switch |
| S_1 `+0x0E012` | `0x1F` Fountain / Special panel | panel interaction |
| S_1 `+0x11310` | **`0x0F` Door switch** | `OpenDoorAtParty`, **open** branch |
| S_1 `+0x114AA` | **`0x0F` Door switch** | `OpenDoorAtParty`, **close** branch |
| S_1 `+0x11838` | `0x1E` Floor plate / Trap | plate/trap interaction |
| S_1 `+0x11910` | `0x16` Alcove | alcove item match |
| S_1 `+0x11984` | `0x16` Alcove | alcove item match |
| S_1 `+0x16314` | `0x21` Plaque (input) | plaque answer accepted |
| S_1 `+0x16F9A` | `0x1E` Floor plate / Trap | `MoveParty` blocked-code 6, i.e. stepping on a plate |

Each row is byte-exact: every site is `1F3C 00xx` (`MOVE.B #type,-(A7)`)
followed immediately by the two coordinate `MOVE.W` pushes and the `JSR`,
9/9 with zero deviation.

**Type `0x11` (Door frame) is never passed to it by any call site.**

> **The set of types passed is exactly the loader's action-owning set.**
> The nine call sites use `{0x0F, 0x16, 0x1D, 0x1E, 0x1F, 0x21}` — identical,
> with no extras on either side, to the six structure types the `bcdfs` loader
> gives an action chain to (`ACTION_TYPES` at S_1
> `+0x18BB0`/`+0x18BC8`/`+0x18BE0`/`+0x18BF8`/`+0x18C10`/`+0x18C28`, already
> documented under "Walking the on-disk stream"). Two completely independent
> parts of the engine — a loader written years before this trace was made and
> a caller census done by byte pattern — agree on the same six-element set.
> That is the single strongest confirmation that `+0x0CF34` is the action
> executor and nothing else.

**Body (confirmed, instruction for instruction):**

```c
void TriggerActionsAt(int16 col, int16 row, uint8 type) {
    uint16 u = resolveUnique(col, row, type);          /* +0x0CF50, $A7D80 */
    Rec *r = &records[u];                              /* A4-0x6E7A + u*20 */
    if (u == 0 || r->w0A != 0) return;                 /* +0x0CF72 / +0x0CF76 */

    if (r->type == 0x1D) {                             /* Switch: flip visual */
        r->w08 = 1 - r->w08;
        redrawPanel(1); repaint(); flushBlits();       /* $82D9E,$A03F8,$A4A32 */
    }
    if (r->type == 0x1E) r->w08 = 1 - r->w08;          /* Floor plate: flip */

    uint8 wanted = r->b11 + 1;                         /* click counter + 1 */
    uint8 first  = r->b0D;                             /* first action id    */
    uint8 id     = first, maxDelay = 0; int alive = 1;

    dirtyPanel = dirtyMap = dirtyView = 0;             /* $174D/$174C/$1749 */
    if (!(r->type == 0x1E && r->b07 == 1))
        PlaySfx(5, 0, 0, 0);                           /* +0x0CFEC, $80506  */

    while (id && alive) {
        Act *a = &actions[id];                         /* A4+0x836 + id*8   */
        if (a->clicks != wanted) break;                /* +0x0D018          */
        if (a->runs) {
            if (a->runs != 0xFF) a->runs--;            /* 0xFF = infinite   */
            if (a->delay == 0) ExecuteAction(id);      /* +0x0C4F6, now     */
            else {                                     /* or later:         */
                Schedule(0x28, turn + a->delay,
                         a->col, a->row, a->value, a->opcode, 0);
                if (a->delay > maxDelay) maxDelay = a->delay;
            }
        }
        id = a->next;
        if (id == first) alive = 0;                    /* chain looped      */
    }

    if (maxDelay && r->type != 0x1F) {                 /* +0x0D0EE          */
        Schedule(0x29, turn + maxDelay, col, row, r->type, 0, 0);
        r->w0A += 1;                                   /* lock: busy        */
    }
    /* +0x0D126: wrap the click counter once the chain has come full circle */
    if (!alive || (id != 0 && actions[id].clicks <= wanted)) wanted = 0;
    r->w0C = id;            /* next action id to run on the next activation */
    r->w10 = wanted;        /* click counter                               */
    CommitDirtyFlags();                                /* +0x0082A, $80882 */
}
```

**Supporting routines (all confirmed this pass):**

| Address | Role |
|---|---|
| S_1 `+0x0C4F6` (`$8C54E`) | `ExecuteAction(id)` — loads the action's opcode/col/row/value into `D0`/`D3`/`D4`/`D5` and falls into the 36-entry opcode dispatcher at `+0x0CE9C`. The dispatcher's `BRA.W $CEAC` common exit is **not** a return: it is this same function's epilogue, which re-reads the opcode from `$836(a4)+id×8` and runs a *second*, opcode-keyed feedback pass. (This corrects "Consumer 2 — movement blocking" below, which calls the `JSR $80506` at `+0x0CECE` "the action dispatcher's own default/unhandled-opcode fallback" — it is one arm of that feedback pass, playing sfx `0x0A` positioned at the action's own target square `(D3, D4)`.) |
| S_1 `+0x004AE` (`$80506`) | `PlaySfx(id, x, y, flag)` — stereo positional sound: scales two 0–100 volumes (defaults 100/100/64 when `x==0`) and calls `$A6CBC(id, vol, side)` once per side. Muted when `$1746(a4) == 2` |
| S_1 `+0x005EA` (`$80642`) | `Schedule(tag, time, b5, b6, b7, b8, ownerWord)` — inserts into a **150-slot**, 12-byte, time-sorted linked list at `A4+0x1036` (free head `$173E(a4)`, active head `$173F(a4)`, `next` at slot byte `+0x09`, sentinel `150`). Init: S_1 `+0x00272` |
| S_1 `+0x0082A` (`$80882`) | `CommitDirtyFlags()` — acts on `$1748`/`$1749`/`$174A`/`$174C`/`$174D(a4)`; calls **`DrawViewport` S_1 `+0x02D46`** when `$1748` is set |
| S_1 `+0x008C8` | the turn tick: `ADDQ.L #1,$1750(a4)` and clears the same four dirty flags — so `$1750(a4)` is the **turn counter** and action delays are in turns |
| S_1 `+0x012BA` | the event fire loop: pops slots whose longword `+0x00` equals `$1750(a4)`, reads tag `+0x04`, params `+0x05`/`+0x06`, dispatches through the `SUBQ` ladder at `+0x01F34` |
| S_1 `+0x01B70` | **tag `0x28`** handler — reconstructs the action in the scratch slot `$83D(a4)` and calls `ExecuteAction` — i.e. the deferred action fires identically, `delay` turns later |
| S_1 `+0x01BC2` | **tag `0x29`** handler — re-resolves `(col,row,type)` and does `w0A -= 1`, releasing the busy lock |
| S_1 `+0x0B25A` | `CancelEventsForObject(id)` — unlinks pending events by owner word `+0x0A` |

**12-byte scheduled-event record (`A4+0x1036 + slot×12`, confirmed):**

| Offset | Size | Field |
|---|---|---|
| `0x00` | 4 | fire turn (`$1750(a4)` value to match) |
| `0x04` | 1 | tag / kind (`0x01`, `0x05`, `0x0A`, `0x0B`, `0x14`–`0x16`, `0x1E`–`0x25`, `0x28`, `0x29`) |
| `0x05` | 1 | param A — column for tag `0x28`/`0x29` |
| `0x06` | 1 | param B — row |
| `0x07` | 1 | param C — action value (`0x28`) / structure type (`0x29`) |
| `0x08` | 1 | param D — action opcode (`0x28`) |
| `0x09` | 1 | next slot index (`150` = end) |
| `0x0A` | 2 | owner id (used by `CancelEventsForObject`) |

Pending events are **persisted in savegames** — the serializer at S_1
`+0x19370` and the loader at S_1 `+0x19A88` both special-case tags
`0x01`/`0x05`/`0x22`/`0x28`/`0x29`.

##### Verification (structural, zero deviation)

0. **Caller-type set == loader action-type set**, 6/6 with no extras either
   way (box above).
1. **Opcode-3 target-type oracle.** Every action with opcode `0x03`
   (`Pillar toggle`, whose handler S_1 `+0x0C5FA` resolves `MOVEQ #$17,D3`)
   reachable from a Door-switch chain points at a square that really holds a
   type-`0x17` (Pillar) record: **6 / 6, 0 mismatches**. This simultaneously
   confirms the byte-`+0x02` = column / byte-`+0x03` = row assignment and the
   chain walk — a wrong field order would land on unrelated squares.
2. **Two independent one-shot mechanisms agree.** For the four map-12 chains
   the action carries `runs = 1`; after firing, `runs` is decremented to 0
   *and* the write-back `r->w0C = id` stores the chain terminator `0`, which
   makes the caller's own `TST.W $C` guard fail forever. Two unrelated parts
   of the routine independently produce "fires exactly once".
3. **The click ladder round-trips.** Map 9's six-action chain
   (clicks `1,1,1,2,2,2`, `next` looping `15 → 10`) walks to `w0C = 13`,
   `w10 = 1` on the first activation, to `w0C = 10`, `w10 = 0` on the second,
   i.e. exactly back to its initial state — reproducing the documented
   "action id matching the first action = loop back to the beginning"
   termination rule from the opposite direction.
4. **The busy lock is symmetric.** `w0A += 1` on scheduling and `w0A -= 1` in
   the tag-`0x29` handler are the only two writers of that field outside the
   `0x0D`/`0x16` and `0x0E`/`0x17` trigger opcodes (which move it by ±2), and
   the entry gate is `w0A == 0`.

---

### Runtime parser — on-disk stream → in-memory arrays (confirmed)

> **Correction — resolves an apparent contradiction.** A one-line note had
> been added to this document's palette section (paths-tried table, "Selector
> 1") reading roughly: "`bcdfs` is not a flat record array — it is 13 level
> chunks, each a sparse `(row, col, cell-longword)` stream that the parser at
> S_1 `+0x18928` expands... A correct walker must reimplement that parser."
> Taken alone, that read as a competing claim about the *on-disk* format,
> in tension with this section's detailed, byte-verified layout. It wasn't a
> competing format — it was a terse, uncited description of **this exact
> on-disk layout's loader**, traced below. The on-disk file genuinely *is*
> the flat-per-map / sparse-row-and-column layout documented above (confirmed
> against real `bcdfs` bytes and the DOS port); S_1 `+0x18928` is where the
> game reads that same layout into memory and expands it into two runtime
> arrays. Both descriptions are correct — one is the file format, the other
> is its consumer. Retraced end to end against
> `data/blackcrypt/extracted/bcdft_decompressed.bin` (S_1, 166,676 B) to
> confirm rather than take the note on faith.

Traced in decompressed `bcdft` S_1:

1. **Per-map fetch (S_1 `+0x188D0`–`+0x18926`).** `a3` is computed as
   `offsetTable[map+1] − offsetTable[map]` — the two 32-bit entries straight
   out of the 52-byte offset table documented above, confirming the table
   doubles as an implicit length list (each map's byte count is the gap to
   the next entry). AmigaDOS `Read()` (LVO `-42`, `jsr -0x2A(a6)`) then pulls
   exactly `a3` bytes for the current map into a buffer, `Close()` (LVO
   `-36`) follows, and the `beq.w +0x18CF8` at `+0x18928` bails out if zero
   bytes came back. `A4 +0x1EDA` holds the **read cursor** into that buffer;
   every field read from here on advances it through a shared "copy N bytes
   from the cursor, then advance" helper at S_1 `+0xA810E` — this is the
   "parser" the terse note meant.
2. **Row loop (S_1 `+0x18978`–`+0x18C84`).** Reads the documented 2-byte
   `col_start`/`col_end` row header into locals, then loops a column register
   from `col_start` to `col_end` (`+0x18C74`–`+0x18C7A`), reading one 4-byte
   square per iteration — byte-for-byte the "Row format" section above. The
   row register is bounded by the row count read right after the map header
   (`+0x18C7E`–`+0x18C84`). Each square longword lands in the **64×64
   runtime map array at `A4 − 0x37CA`**, index `(row<<8) | (col<<2)`
   (`+0x189CA`/`+0x18A46`–`+0x18A4C`) — the identical array and index formula
   already confirmed independently in "Selector 2" above (S_1 `+0x02D76`) for
   the per-square palette override, now confirmed a second, unrelated way.
3. **Entity expansion.** Whenever a square's low 12 bits (`unique`) are
   non-zero (`andi.l #$FFF,D0` / `+0x189F6`), S_1 `+0x8005E` allocates a slot
   and a fixed **20-byte** record is copied from the stream cursor
   (`pea.l 0x14.w` → `jsr +0xA810E`, repeated at `+0x18630`/`+0x18696`/
   `+0x18A5A`/`+0x18AC2`) into the **object-record array at `A4 − 0x6E7A`**,
   indexed `unique × 20`. Record offset `+0x5` — the "type" byte — is tested
   directly against `0x13`/`0x23` (`+0x186E0`/`+0x18B5C`/`+0x18B74`) and
   `0x0F`/`0x1F` (`+0x18C10`/`+0x18C28`): exactly the Container/Bag,
   Chest/Coffer, Door switch and Fountain/Special-panel values from the
   "Item bytecode" and "Structure bytecode" tables above, at the exact same
   byte offset. This is the same on-disk 20-byte item/structure record,
   copied verbatim into a fixed-stride runtime array — not a differently
   shaped struct.
4. **Chain walk.** A neighbouring function (S_1 `+0x18764`) reads record
   offset `+0xD` and walks it as a next-record index — the runtime analogue
   of the "chains to unique=B/D/E" pattern documented under "Entity
   placement" above. (This is a different field from the *action* record's
   `+0x07` chain-next discussed under "Selector 1" — that's an unrelated,
   smaller 8-byte struct.)

> **Correction — the monster hand-off is not a gap; a monster is literally
> two 20-byte records.** This section previously read: "the monster bytecode
> is documented above as ~40 bytes, twice the 20-byte stride confirmed here…
> Nothing in this trace shows monster records being copied into the
> `A4 − 0x6E7A` array — plausibly only a 20-byte placement stub lands there
> while the full stat block is expanded into separate live-monster instance
> data … that hand-off has not been traced." The loader does copy the whole
> thing: at S_1 `+0x18A90` it tests **bit 7 of the record's byte `+0x00`**
> (the `0x80` monster marker), and if set allocates a *second* slot
> (`JSR $8005E`), stores that slot's index in the **first** record's word
> `+0x10` (`+0x18ABA`), and reads another `0x14` bytes into it (`+0x18ABE`).
> The "~40-byte monster bytecode" is exactly those two records back to back.
> Two clean-up writes follow on the *second* record — `CLR.B +0x0A`
> (`+0x18AF8`) and, if its byte `+0x13` is non-zero, a further **4-byte**
> read plus a `JSR $80642` call (`+0x18B16`-`+0x18B42`).

#### Walking the on-disk stream (confirmed, 13/13 maps)

Everything the loader needs, in one place — `scripts/bclib/bcdfs.py` is a
line-for-line port and `walk_all()` asserts the invariant below:

| Element | Bytes | Source |
|---|---|---|
| Per-map header | 52 (offset-table block, only map 1 filled) + longword guard + **1 byte last-row index** | `+0x18928`/`+0x18958` |
| Row header | 2 — first column, last column, **both signed** | `+0x18978` |
| Square | 4 | `+0x189B0` |
| Item / structure record | **20** | `pea $14.w` at `+0x18A56` |
| Monster | 20 + 20 (+4 if the second record's byte `+0x13` ≠ 0) | `+0x18A90`-`+0x18B42` |
| Container/chest (`0x13`/`0x23`) & monster sub-chain | recurse; head = word `+0x0C` (container) / `+0x0A` (monster) | `$985C8` = S_1 `+0x18570` |
| Action chain (types `0x0F 0x16 0x1D 0x1E 0x1F 0x21`) | **8 per action**; first action id = record byte `+0x0D`; each action's byte `+0x07` is the next id; stops on `0` or on the first id | `$987BC` = S_1 `+0x18764` |
| Same-square chain | continue while record word `+0x12` ≠ 0 | `+0x18C48` |
| Map trailer | 2-byte count + count × 12 (count is `0` in all 13 shipped maps) | `+0x18C92`-`+0x18CF6` |

> **Correction — "first action is 7 bytes, later ones 8" is wrong.** The
> "Action bytecode" section above describes the first action in a chain as a
> 7-byte record without an id. The loader reads a flat `pea $8.w` — **8 bytes
> for every action, including the first**. What is true is that the first
> action's *id* comes from the owning structure record's byte `+0x0D` rather
> than from the action's own bytes; each action's byte `+0x07` is the *next*
> action's id (or the terminator). Reading the first action as 7 bytes
> desynchronises the walk immediately.

**Signed row headers.** The column loop is `addq.b #1,d4 / cmp.b -$c(a5),d4 /
ble` (`+0x18C74`) — a *signed* byte compare. An **empty row** is encoded
`40 FF`: first column `+64`, last column `−1`, so the body executes zero
times. Maps 11, 12 and 13 all contain such rows; treating those bytes as
unsigned is what makes a naive walker desynchronise there and nowhere else.

**Verification.** All 13 maps walk with zero deviation: every square passes
the `[type:4][0xF] [0xF][level:4]` nibble check, and maps 1-12 each end
**exactly 3,948 bytes** before the next map's offset-table entry (map 13 ends
4,000 = 3,948 + 52 before EOF — the last map needs no following offset
block). 2,536 item/structure records recovered. The previously documented
"3,950 bytes of `0x00` padding" is 3,948 padding + the 2-byte trailer count.

---

### Party Movement / Facing State Machine (confirmed)

Traced end to end in decompressed `bcdft` S_1, starting from every OTHER write
site to `$1742(A4)`/`$1740(A4)` besides the already-documented `0x1E` teleport
handler (found by a linear disassembly + grep for `MOVE.W Dn/An,$1740(a4)` /
`$1742(a4)`, cross-checked against a second, independent method — the internal
consistency of the wall-flag bit math below, which has zero free parameters
left once any one fact is pinned down). No amiberry access was used or needed:
every claim here is either a direct, cited instruction, or an *internal*
structural invariant (four jump-table cases landing on exactly the four
compass-consistent coordinate deltas; the wall-check bit position lining up
with the already-documented `wall_flags` layout with no slack). Field names
below (`X`/`Y`/`facing`) are this write-up's labels for the A4-relative
offsets — the code itself has no symbol table for them.

#### Coordinate/facing fields (confirmed)

| Field | Offset | Meaning |
|-------|--------|---------|
| `partyY` | `$1740(A4)` | party row (0–63), same axis as the map array's `row` |
| `partyX` | `$1742(A4)` | party column (0–63), same axis as the map array's `col` |
| `partyFacing` | `$1744(A4)` | facing, 2-bit index **0=N, 1=E, 2=S, 3=W** |
| current input code | `$1EB4(A4)` | the currently-pressed movement key, compared against a per-key scancode table |
| key→verb table | `$1E6C(A4)` (indirect) | pointer to a struct whose bytes `+0x58`.. `+0x5D` hold the 6 movement-key scancodes (Back/Forward/StrafeLeft/StrafeRight/TurnLeft/TurnRight, in that byte order) |

`partyX`/`partyY` are exactly the `$1742(A4)`/`$1740(A4)` fields the `0x1E`
teleport action-opcode writes (confirmed above in "Action bytecode"), and the
same fields the per-square palette override (S_1 `+0x02D76`, "Selector 2")
and the action-opcode X/Y fields (`D3`/`D4`, "Selector 3") index the 64×64
map array with — this trace supplies the ordinary (non-teleport,
non-scripted) writer.

**Facing encoding — confirmed, not assumed.** `partyFacing` is read/written
by exactly one place that changes it under player control (`TurnParty`
below), always via `(partyFacing + delta) & 3` — a plain 2-bit index, not an
angle or an 8-direction value. (Census over the whole of S_1: **71 references
to `$1744(A4)`, only 2 direct writes** — `TurnParty` `+0x1703E` and a `CLR.W`
reset at `+0x1952C`. The one further writer is indirect: `MoveParty` passes
`&facing` via `LEA $1744(A4),A0` at `+0x16D2C`, and `ResolveTargetSquare`'s
special-square tail writes through it at `+0x27C76` — that is the spinner's
180° about-face, see "Special-square sub-kinds".) The N/E/S/W assignment is confirmed by two
independent internal invariants that only agree for one assignment:

1. The wall-collision check (below) tests bit `12 + facing` of the current
   square's longword. The square format documents `wall_flags` as bits
   15–12 of that longword, `+1 N`/`+2 E`/`+4 S`/`+8 W` — i.e. bit 12 = N,
   13 = E, 14 = S, 15 = W. `facing=0` tests bit 12 (N), `facing=1` bit 13
   (E), `facing=2` bit 14 (S), `facing=3` bit 15 (W).
2. `ApplyFacingDelta`'s 4-entry jump table (below) resolves to: `facing=0`
   ⇒ `Y+=1`, `facing=1` ⇒ `X+=1`, `facing=2` ⇒ `Y-=1`, `facing=3` ⇒ `X-=1`.

Both only make geometric sense together as **0=North (+Y), 1=East (+X),
2=South (−Y), 3=West (−X)** — a standard right-handed 2D frame where Y
increases northward and X increases eastward. Any other facing↔direction
assignment would make one of the two invariants nonsensical (e.g. the
wall-check bit wouldn't match the documented `wall_flags` layout, or the
coordinate deltas wouldn't be four distinct unit steps). This is the
verification — no live capture needed or used.

#### `TurnParty(delta)` — S_1 `+0x1702A` (confirmed)

```asm
17032  MOVE.W  $1744(A4),D0      ; D0 = current facing
17036  ADD.W   $8(A5),D0         ; + arg (delta: -1/+1, wrapped)
1703A  ANDI.W  #$3,D0            ; wrap to 0-3
1703E  MOVE.W  D0,$1744(A4)      ; commit new facing
       ... (redraw compass icons ×4, conditional automap update, viewport redraw)
```

No wall check at all — turning in place is never blocked. Called with
`delta=3` (i.e. `facing-1`, turn **left**) and `delta=1` (`facing+1`, turn
**right**) — see the input dispatcher below.

#### `ApplyFacingDelta(&X, &Y, facing)` — S_1 `+0x002B4` (confirmed)

A0=`&X`, A3=`&Y`, D0=`facing` (word). Dispatches through a 4-entry PC-relative
jump table (`+0x2DE`: words `$FFD6 $FFDA $FFDE $FFE4`, resolved targets
`0x2CA/0x2CE/0x2D2/0x2D8` — table itself read with `px` and hand-resolved,
not guessed):

```asm
2CA  ADDQ.W  #1,(A3)     ; facing 0 (N): Y += 1
2CE  ADDQ.W  #1,(A2)     ; facing 1 (E): X += 1
2D2  ADDI.W  #-1,(A3)    ; facing 2 (S): Y -= 1
2D8  ADDI.W  #-1,(A2)    ; facing 3 (W): X -= 1
```

Facing values ≥4 fall through to a no-op default. This is the entire
delta-move formula: exactly one axis changes by ±1 per call, selected by
facing, never a diagonal step.

#### `MoveParty(verb)` — S_1 `+0x16CC4` (confirmed)

The function that actually commits a translation. `verb` (word arg at
`$8(A5)`) is **not itself a facing** — it is added to `partyFacing` to get
the *direction of travel*, which lets one function serve forward, backward
and both strafes:

```asm
16CCC  MOVE.W  $1744(A4),D0        ; D0 = current facing
16CD0  ADD.W   $8(A5),D0           ; + verb
16CD4  ANDI.W  #$3,D0              ; wrap
16CD8  MOVEA.W D0,A6               ; A6 = travel direction (0-3)

; --- wall check against the CURRENT square, in the travel direction ---
16CDC  MOVE.W  $1740(A4),D0 / ASL.L #8,D0     ; D0 = Y<<8
16CE4  MOVE.W  $1742(A4),D1 / ASL.L #2,D1     ; D1 = X<<2
16CEA  ADD.L   D1,D0                          ; D0 = index = (Y<<8)|(X<<2)
16CEC  LEA     -$37CA(A4),A0                  ; the confirmed 64×64 map array
16CF4  MOVEQ   #1,D0 / ASL.L D1,D0 (D1=A6)    ; D0 = 1 << facing
16CF8  MOVEQ   #$C,D1 / ASL.L D1,D0           ; D0 = (1<<facing) << 12
16CFE  MOVE.L  (A0,D1.L),D1                   ; D1 = current square longword
16D02  AND.L   D0,D1
16D04  BNE.W   +0x17014                       ; wall in the way ⇒ abandon move entirely
```

If the current square has no wall on the edge facing the direction of
travel, the move proceeds:

```asm
16D08  MOVE.W  $1742(A4),D3        ; save old X
16D0C  MOVE.W  $1740(A4),D4        ; save old Y
16D12  PEA.L   $1740(A4) / PEA.L $1742(A4)
16D1A  JSR     ApplyFacingDelta    ; writes new X/Y in place (speculative)
16D3C  JSR     ResolveTargetSquare ; A0=&X A1=&Y A2=&facing ⇒ D0 = result code (see below)
16D46  MOVE.W  D0,D2
16D48  CMPI.W  #1,D2 / BEQ +0x16D5E
16D52  CMPI.W  #7,D2 / BEQ +0x16D5E
16D58  CMPI.W  #8,D2 / BNE +0x16D94
16D5E  MOVE.W  D3,$1742(A4)        ; blocked: revert to the saved old X
16D62  MOVE.W  D4,$1740(A4)        ; blocked: revert to the saved old Y
```

So the move is applied *speculatively* (new X/Y written in place by
`ApplyFacingDelta`), then checked, then reverted if blocked — rather than
being checked before writing. Result codes 1/7/8 are the "blocked" set;
everything else (0, 2, 3, 4, 9) commits.

Called from four sites, all via the same absolute target (`JSR $96D1C.l` =
`0x16CC4 + BASE`, `BASE = 0x80058` — see below), one per verb, each preceded
by a call to a UI-feedback helper (`S_1 +0xDA6C`, updates the on-screen
movement-compass icons documented in AGENTS.md's bcdfa `up_arrows` bank) with
the same verb code:

| Verb (`$8(A5)`) | Travel direction | Meaning |
|------------------|------------------|---------|
| `0` | `facing + 0` | **Forward** |
| `1` | `facing + 1` | **Strafe right** |
| `2` | `facing + 2` | **Backward** |
| `3` | `facing + 3` (= `facing - 1`) | **Strafe left** |

(Turning uses the *same* 0–3 numbering space one step further — `TurnParty`
is called with delta `3` for turn-left and `1` for turn-right, i.e. the input
dispatcher below reuses "which way relative to current facing" for both
translation and rotation, just routed to two different functions.)

#### `ResolveTargetSquare(&X, &Y, &facing)` — S_1 `+0x027BAA` (confirmed)

Re-derives `index = ((Y<<6)+X)<<2` from the (already-updated) `*X`/`*Y`,
reads the target square's longword from the map array, and masks out only
the low 12 bits (`unique`) — **it does not re-test the target square's own
`wall_flags`**; collision is single-sided, decided entirely by the current
square's wall in the travel direction (above). If `unique==0` (empty square)
it returns **0** immediately — ordinary unobstructed move. Otherwise it walks
into the 20-byte object record at `A4 − 0x6E7A + unique×0x14` (same array
and stride confirmed in the "Runtime parser" section above) and dispatches
on its own fields:

- **Byte `+0x00` bit 7 set** (the Monster bytecode's `0x80` marker,
  confirmed in "Monster bytecode" above) ⇒ result **8**: blocked by a
  monster on the square, no bump sound (combat/other handling happens
  elsewhere, not chased further here).
- **Byte `+0x05`** (the structure "type" byte, same offset as Item's
  `itemType`/Structure's type field) is then switched on:
  - `0x11` (Door frame): tests bit 0 of byte `+0x0F` — **set ⇒ door open,
    move succeeds** (falls through keeping the default result); **clear ⇒
    door closed**, result **1** (generic blocked-and-bump). Full writeup of
    this bit — the action opcodes that set/clear it and the render-side
    consumer that reads it to pick open- vs. closed-door art — is in the new
    "Door State" section directly below this one.
  - `0x14` (Pit) and `0x12` (Stairs/Teleport/Spinner) — **fully solved and
    externally verified; see "Special-square sub-kinds" immediately below.**
    Both type branches gate on `record[+0x0A] != 0` (⇒ default result 0,
    open) and the global `$B2586 == 1` (else result **1**, blocked)
    identically, then **both fall into one shared commit tail** at S_1
    `+0x27C4E` which optionally writes `*X`/`*Y` from the record's words
    `+0x0C`/`+0x0E`, always rotates `*facing` by the record's **word**
    `+0x08`, and finally demultiplexes the result code on the record's own
    type byte and word `+0x10`.

> **Correction — two errors in the previous pass's trace of this block, both
> now overturned by re-reading the branch bytes.**
>
> 1. **The Pit branch does not skip the commit tail.** It was written up as
>    "falls straight to result 9 without ever reaching the `*X`/`*Y`/facing
>    commit block at all (`BRA.B` jumps past it)". The instruction at S_1
>    `+0x27C30` is `601C` = `BRA.B $27C4E` — a **forward jump *into* the
>    commit tail**, not past it. Its direction was inverted.
> 2. **Consequently `CMPI.B #$14,record[+0x05]` at S_1 `+0x27C7A` is not a
>    dead comparison, and result code 2 is not unreachable.** It reads false
>    for type-`0x12` records (correctly — they are not pits), but it is
>    reached by *pits*, for which it reads **true**. It is the tail's
>    Pit-vs-Stairs/Teleport/Spinner discriminator. **Result 2 is exactly and
>    only the floor-pit case**, which is what the doc's original label for
>    code 2 said — only the reachability claim was wrong.

##### Special-square sub-kinds (`0x14` Pit, `0x12` Stairs/Teleport/Spinner) — **confirmed**

The shared tail, byte for byte:

```asm
; ---- type 0x14 (Pit) ----
27C0A  CMPI.B  #$14,D5              ; structure type = Pit?
27C0E  BNE.B   $27C32
27C10  CMPI.W  #$0,$A(A5,D4.W)      ; passable flag
27C16  BNE.W   $27D18               ;   nonzero  -> leave D3 as-is, chain-walk on
27C1A  CMPI.W  #$1,$B2586.l         ; global gate
27C22  BNE.W   $27D16               ;   != 1     -> D3 = 1 (blocked), chain-walk on
27C26  CMPI.W  #$1,$10(A5,D4.W)
27C2C  BEQ.W   $27D18               ;   +0x10==1 -> ceiling pit: no fall, chain-walk on
27C30  BRA.B   $27C4E               ;   else     -> INTO the shared tail  (was mis-read as "past it")

; ---- shared commit tail (reached by Pit above and by type 0x12) ----
27C4E  MOVEM.L D0-D1/A0-A1,-(A7)
27C52  JSR     $83882.l             ; S_1 +0x0382A — automap neighbour-reveal, gated on $1E2A(A4)
27C58  MOVEM.L (A7)+,D0-D1/A0-A1
27C5C  CMPI.W  #$4,$10(A5,D4.W)
27C62  BEQ.B   $27C6C               ; sub-kind 4 (Spinner): skip the destination write
27C64  MOVE.W  $C(A5,D4.W),(A0)     ; *X = record.word(+0x0C)
27C68  MOVE.W  $E(A5,D4.W),(A1)     ; *Y = record.word(+0x0E)
27C6C  MOVE.W  $8(A5,D4.W),D5       ; facing delta = record.WORD(+0x08)
27C70  ADD.W   (A2),D5
27C72  ANDI.W  #$3,D5
27C76  MOVE.W  D5,(A2)              ; *facing = (*facing + delta) & 3
27C78  MOVEQ   #$2,D3
27C7A  CMPI.B  #$14,$5(A5,D4.W)     ; LIVE: true for a Pit, false for type 0x12
27C80  BEQ.W   $27D18               ;   -> D3 = 2   (floor pit)
27C84  MOVEQ   #$3,D3
27C86  CMPI.W  #$2,$10(A5,D4.W)
27C8C  BEQ.W   $27D18               ;   -> D3 = 3   (stairs)
27C90  CMPI.W  #$3,$10(A5,D4.W)
27C96  BEQ.W   $27D18               ;   -> D3 = 3   (stairs)
27C9A  MOVEQ   #$4,D3
27C9C  CMPI.W  #$4,$10(A5,D4.W)
27CA2  BEQ.W   $27D18               ;   -> D3 = 4   (spinner)
27CA6  MOVEQ   #$9,D3               ;   -> D3 = 9   (teleport)
27CA8  BRA.B   $27D18

; ---- chain walk / return ----
27D16  MOVEQ   #$1,D3               ; blocked
27D18  MOVE.W  $12(A5,D4.W),D4      ; D4 = chain-next unique
27D1C  BRA.W   $27BD0               ; loop: if D4 == 0 fall out to the return
27D20  MOVE.L  D3,D0                ; result = D3 as last written by the chain
```

**`$27D18` is the chain walk, not a return.** Every arm above sets `D3` and
then re-enters the per-record switch for the next record chained to the same
square, so the code a square finally yields is the one written by the **last**
record in its chain. This matters for exactly one square in the game (below).

The complete sub-kind table. Every row is confirmed against the shipped
`bcdfs` data *and* against the official **Black Crypt Manual & Clue Book**
(see "Verification" below); `n` counts all 257 special-square records in the
file, walked with `bclib.bcdfs`:

| Structure type | word `+0x10` | `gfxNumber` | n | result | **Meaning** | dest `+0x0C`/`+0x0E` | facing Δ word `+0x08` |
|---|---|---|---|---|---|---|---|
| `0x14` Pit | 0 | `0x3A` | 18 | **2** | **Floor pit** — party falls to the landing square | populated **18/18** | 0 |
| `0x14` Pit | 1 | `0x3B` | 15 | **0** | **Ceiling pit** — opening overhead, walk under freely | zero **15/15** | 0 |
| `0x12` | 0 | `0x41` | 61 | **9** | **Inviso teleport** (not drawn) | populated | 0 |
| `0x12` | 1 | `0x40` | 82 | **9** | **Teleport** (visible) | populated | 0 (73), 1–3 (9 — sets arrival facing) |
| `0x12` | 2 | `0x43` | 38 | **3** | **Stairs** (variant a) | populated | 0 (37) |
| `0x12` | 3 | `0x44` | 36 | **3** | **Stairs** (variant b) | populated | 0 (35) |
| `0x12` | 4 | `0x1E` | 7 | **4** | **Spinner** — never moves the party, always turns it 180° | zero **7/7** | **2 on 7/7** |

`+0x10` determines `gfxNumber` with **zero mixing** across all 224 type-`0x12`
and all 33 type-`0x14` records — a clean 7-way partition.

The clue book's map legend lists **eight** stairs/teleport/spinner/pit
features, and the eighth is accounted for exactly: FLOOR PIT, CEILING PIT,
**FLOOR/CEILING PIT**, TELEPORT, INVISO TELEPORT, STAIRS UP, STAIRS DOWN,
SPINNER. "Floor/ceiling pit" is not an eighth record sub-kind — it is a
square carrying **both** pit records on one chain, and there is exactly
**one** such square in the whole game (map 7, x=35 y=15, chain
`gfx 0x3B` → `gfx 0x3A`). The census closes without remainder: 33 pit records
over 32 distinct squares = 17 floor-only + 14 ceiling-only + 1 both. On that
one square the chain walk means the ceiling record leaves `D3` at 0 and the
floor record then sets it to 2, so the party falls — the correct reading of
"floor **and** ceiling pit".

> **Correction — the doc's original `4 = Teleport` / `9 = Spinner` labels were
> swapped.** They are now confirmed the other way round: **4 = Spinner,
> 9 = Teleport**. Code 4 stores no destination (7/7 records have
> `+0x0C`/`+0x0E` = 0) and carries a uniform 180° facing delta; code 9 always
> relocates the party. See "Verification" for the external ground truth.

> **Correction — `+0x08` is a *word*, not a byte.** Earlier text called it
> "the record's byte `+0x08` (a spinner-style forced turn)". The instruction
> at `+0x27C6C` is `MOVE.W $8(A5,D4.W),D5`. Read as a byte it is 0 on all 224
> type-`0x12` records, which makes the forced turn look like dead data; read
> correctly as a word it is **2 on all 7 spinners** (`facing + 2 & 3` = a 180°
> about-face) and 0 on almost everything else. The turn is not
> "spinner-style" — it *is* the spinner, exclusively.

**Verification.** Five independent lines, no live capture used:

1. **`+0x10` ↔ `gfxNumber` partition** — zero deviation across all 257
   records (7 sub-kinds, 7 distinct gfx numbers, no record mixing).
2. **Destination-field invariant, 33/33 pits** — all 18 floor pits (code 2)
   carry a non-zero landing square; all 15 ceiling pits (code 0) carry
   `(0,0)`. Exactly what the corrected control flow requires: the code-2 path
   passes through the `*X`/`*Y` write, the code-0 path returns before it.
   Likewise all 7 spinners (code 4, the one sub-kind that *skips* the write)
   carry `(0,0)`, and all 217 other type-`0x12` records carry real
   destinations.
3. **Clue book names four teleports by coordinate** — Level 10 note 14:
   *"BUTTON: REMOVES ALL TELEPORTS AT (26,13,10), (24,11,10), (22,13,10), AND
   (24,15,10)"*. `bcdfs` map 4 / level-nibble 1 holds `+0x10 == 1` records at
   exactly (24,11), (22,13), (26,13), (24,15) — **4/4 exact**, and the book
   calls them teleports. This alone settles code 9 = Teleport.
4. **Clue book teleport destinations** — 13 exact `+0x0C`/`+0x0E` matches
   across three independently anchored levels. Level 7 (map 3 / nibble 2):
   *"TELEPORT: GOES TO (21,13,7) / (1,13,7) / (5,9,7) / (5,6,7)"* → 4/4 exact;
   its two *"INVISO PRESSURE PLATE: CREATES TELEPORT AT (5,7,7) / (2,12,7)"*
   also match record source squares. Level 2 note 1, *"SWITCH: TOGGLES
   TELEPORT AT (3,14,2) BETWEEN DESTINATIONS (28,23,2) AND (6,9,1)"*, matches
   the **two type-`0x12` records stacked on the single square (3,14)**, one of
   whose destinations is the cross-level (6,9) exactly.
5. **Clue book SPINNER symbols — 7/7, zero extras, zero misses.** Every one
   of the 7 code-4 records sits on a cell drawn with the legend's spinner
   symbol, and no cell drawn with that symbol lacks a code-4 record.
   Classified by normalised cross-correlation of each map page against the
   legend page's own SPINNER and GLYPH symbol tiles; label = argmax of the
   two scores, and the **margin** is the evidence (both symbols are a boxed
   "G", so absolute scores cross-match — the spinner has a solid inner block,
   the glyph is a uniform stipple):

   | Clue-book level | `bcdfs` region | Spinner cells found | Spinner NCC | Glyph NCC | Other boxed symbols on page |
   |---|---|---|---|---|---|
   | 1 | map 1 / nib 1 | (10,1) | 0.821 | 0.630 | 2, both GLYPH (−0.19, −0.21) |
   | 2 | map 1 / nib 2 | (13,11) (17,11) (11,13) | 0.933 / 0.929 / 0.942 | 0.743 / 0.712 / 0.738 | 5, all GLYPH |
   | 10 | map 4 / nib 1 | (9,31) (7,33) | 0.872 / 0.876 | 0.740 / 0.598 | 6, all GLYPH |
   | 14 | map 6 / nib 1 | (24,4) | 0.861 | 0.745 | 7, all GLYPH |

   The "other boxed symbols" column is the control: 20 non-spinner boxed
   symbols across the four pages, every one classified GLYPH with a negative
   margin, so the classifier is not simply labelling everything SPINNER.
   (Level 10's row origin was anchored on the four teleport coordinates the
   clue book names in evidence 3, not read by eye — an eyeballed origin put
   this page one row out.)
   Clue-book pit coordinates agree too: Level 7 note 13 *"REMOVES PIT AT
   (18,17,7)"* ↔ the single type-`0x14` record on map 3 / nibble 2, at
   (18,17), `gfx 0x3A`, `+0x10 = 0` → code **2**, landing square (35,29) on a
   different level of the same map (a fall to the level below).
6. **Which teleport variant is "inviso" — settled by a controlled pair.** The
   phrase "INVISO TELEPORT" occurs exactly **twice** in the whole clue book,
   and both times it lands on `+0x10 = 0` / `gfx 0x41`:
   - Level 24 (map 11 / nib 1) gives the clean A/B pair — two adjacent notes,
     *"INVISO TELEPORT: SENDS PARTY TO (4,19,24)"* and *"TELEPORTS PARTY TO
     (5,19,24)"*, against two records on that level whose destinations are
     exactly (4,19) — `gfx 0x41`, at (2,28) — and (5,19) — `gfx 0x40`, at
     (2,30). The destinations disambiguate which note is which record.
   - Level 14 (map 6 / nib 1) note 9, *"GLYPH OF DEATH; INVISO TELEPORT SENDS
     PARTY TO (8,21,14)"*, matches that level's **only** `gfx 0x41` record,
     at (9,26), destination (8,21) exact.

   Every plain-"TELEPORT" mention checked (Level 7 ×5, Level 10 ×4, Level 24
   ×1) is `gfx 0x40`. So `0x41` = **inviso** (invisible on the floor),
   `0x40` = the visible teleport.

   > **Update — the render-side mechanism is now traced and it confirms the
   > labelling independently of the clue book.** The type-`0x12` render case is
   > not in `DispatchSquareObject` at all; it is in the **kind-4/12 handler
   > `+0x0224C`** (`+0x022BE`), which switches on `word +0x10` through a
   > `SUBQ.W #1` ladder: `1` → `+0x214F4` (the stipple field), `2`/`3` →
   > `+0x251FE` (stairs flight A/B), and **anything else — including `0` —
   > falls off the ladder and draws nothing**. `word +0x10` is a perfect
   > function of `gfxNumber` across all 13 maps: `0 ↔ 0x41` (61 records),
   > `1 ↔ 0x40` (82), `2 ↔ 0x43` (39), `3 ↔ 0x44` (36), `4 ↔ 0x1E` (7, the
   > spinner — also correctly invisible). So `0x41` is invisible by omission,
   > not by a special-cased skip. See "Kinds 4 and 12" in "3D Viewport
   > Compositing".

Level anchoring for 3–5 is itself evidence-based, not assumed: `bcdfs`
(map, level-nibble) regions were matched to clue-book level numbers by exact
teleport-destination coordinate overlap, giving map 1/nib 1 → L1, map 1/nib 2
→ L2, map 3/nib 2 → L7, map 4/nib 1 → L10, map 6/nib 1 → L14, map 11/nib 1
→ L24. Level-local coordinates equal `bcdfs` grid coordinates minus the
level region's column/row base (0 for most levels; 28 for map 1/nib 2).

**What a spinner actually does.** It is the one sub-kind that neither blocks
nor relocates: the party steps on, `*X`/`*Y` are left at the stepped-onto
square, and `*facing` is rotated by `+0x08 = 2` — turned to face back the way
it came. `MoveParty` then falls through to the same generic finish-move tail
as code 0, so there is no distinct sound or screen effect; the disorientation
*is* the silent about-face. `partyFacing` (`$1744(A4)`) has only three writers
in the whole of S_1 — `TurnParty` `+0x1703E`, a `CLR.W` reset at `+0x1952C`,
and this tail's `MOVE.W D5,(A2)` reached through the `LEA $1744(A4),A0`
`MoveParty` passes at `+0x16D2C` (71 references total, 2 direct writes).
  - `0x17`/`0x10`/`0x1E`/`0x1F`/`0x2F` and a couple of other type bytes
    return either the default "open" fall-through or blocked-code **1**,
    gated on the same byte `+0x0A` field seen in the pit/stairs cases.
  - Anything else (byte `+0x05` unmatched) falls through with **no match**,
    which the surrounding loop treats as blocked-and-bump: result **7**
    (the caller additionally shows a message for this code — see below).
- **Chain walk:** whenever a case doesn't resolve immediately, D4 is
  reloaded from the record's own `+0x12` field (a chain-next index) and the
  whole switch re-runs — the same object-chain mechanism ("chains to
  unique=B/D/E") documented under "Entity placement" above, now confirmed
  from the *movement* side rather than just the *loader* side.

**Caller's handling of the result code** (back in `MoveParty`, after the
revert block above):

| Code | Meaning (per doc's original labels) | Caller behaviour (this pass — traced to the instruction) |
|------|---------|-------------------|
| 0 | Open floor / empty square | commits, falls to the generic "finish move" tail (`+0x16EE8`: `JSR $A4982.l`, viewport redraw, `JSR $A3826.l`) |
| 1 | Blocked (closed door / generic wall-ish obstacle) | reverts X/Y, plays a bump SFX (`JSR $80506.l`, effect id 8), returns immediately — no viewport redraw |
| 2 | **Floor pit** (confirmed — reachable after all) | The **only** code reaching S_1 `+0x16DC2`'s fallthrough (every other code that lands there — 3, 4, 9 — is bounced away by an immediate `BNE`): reverts to the pre-`ResolveTargetSquare` position **temporarily** (draws the old square, `JSR $82D9E.l` + 2 more calls), then re-applies `ResolveTargetSquare`'s own `*X`/`*Y`, redraws again (`JSR $82D9E.l` + 2 more) — a confirmed "step in, animate, then land" sequence, i.e. the **fall animation**, landing on the record's `+0x0C`/`+0x0E` square. Not traced further than this call sequence (what the 4 intermediate `JSR`s individually do). **Emitted only by a type-`0x14` record with `gfx 0x3A` / `+0x10 = 0` (18 of the 33 pits)** — see "Special-square sub-kinds" above; the earlier "code 2 is unreachable / set by a dead comparison" note is retracted there. |
| 3 | Stairs | **Dedicated handler at `+0x16E14`, traced this pass.** Re-resolves the structure's `unique` at the (now-committed) destination via the confirmed `JSR $A7D80.l` helper, then reads the record's own **byte `+0x07`** (a field not previously mapped) and, if nonzero, pushes it and calls S_1 `+0x16C62` — a small self-contained routine that indexes a table at `A4−0x7C60` by `(record[+0x07]−1)×2`, stores the looked-up word into `$1E62(A4)`, then calls a "load resource by tag" routine (`JSR $82250.l`, pushing a PC-relative string constant) and a DOS-library call (`JSR −0xC6(A6)` off the base at `$1E58(A4)`, `D1=0x12C`). `$1E62(A4)` feeds the already-confirmed `SetDungeonPalette` mechanism ("Dungeon accent ramp"), so this reads as **stairs picking a destination level/ramp from `record[+0x07]`** and triggering a level-transition load — consistent with the doc's "Stairs" label, not contradicted by anything found this pass. |
| 4 | **Spinner** (confirmed — was mislabelled "Teleport") | **No dedicated handling found** — falls straight through to the same generic tail as code 0 (`+0x16EE8`), no distinct sound, no distinct call. `ResolveTargetSquare` never writes a new `*X`/`*Y` for this code; only the facing rotation applies, and that rotation is **+2 (180°) on all 7 records**. So the square reads as **"don't move, turn to face back the way you came"** — a spinner, silently. Confirmed against the clue book's SPINNER map symbol at all 7 record coordinates (levels 1, 2, 10, 14) — see "Special-square sub-kinds" above. |
| 5 | **Glyph triggered** (new — was missing from this table) | `ResolveTargetSquare` `+0x27CC8` returns 5 for a type-`0x10` record whose word `+0x0C` is 3. `MoveParty` `+0x16F86` calls S_1 `+0x04662`, which plays BCSPEED effect `record.word(+0x10) + 4` and applies the glyph's damage handler. See the `bcdfs` "Structure record field map — type `0x10`" section |
| 6 | **Type-`0x1E` floor-plate/trap trigger** (new — was missing from this table) | `ResolveTargetSquare` `+0x27CF8`. `MoveParty` `+0x16F8E` pushes `0x1E` plus the party X/Y and calls `JSR $8CF8C.l` |
| 7 | Blocked, with "message" | reverts X/Y, plays the same bump SFX, **and** calls `JSR $A39B0.l` with `D0=1`. **Traced this pass — it is not a text message.** `+0x23958` picks one of two small byte tables (S_1 `+0x239A8`/`+0x239F4`, `D0=1` selects the second) that are short **numeric** sequences terminated by `0xFF` (e.g. `0C 10 14 10 0C 08 0C 10 14 18 14 10 …`, an oscillating ramp, not text/ASCII) and passes it to S_1 `+0x26482` — a **hardware blitter setup routine** (writes `BLTCON0`/`BLTCON1`/`BLTAFWM`/`BLTALWM`/`BLTAPT`/`BLTCPT`/`BLTSIZE` off an exec/graphics library base, minterm `$09F0` = confirmed straight screen-to-screen copy) using the table's oscillating values as a per-step position delta. This is a **screen-shake / jolt visual effect**, not a message box — the field/table layout it reads (which words are X/Y/W/H) was not fully mapped this pass, but "text message" is now a retracted premise, not an open question. |
| 8 | Blocked by monster | reverts X/Y, **no** bump sound, returns immediately |
| 9 | **Teleport** (confirmed — was mislabelled "Spinner/other") | **`record[+0x10]`-fallback case only**, and — per the corrected trace above — reached **exclusively from type-`0x12` records with `+0x10 ∈ {0,1}`** (143 records, `gfx 0x41`/`0x40`). **A Pit never reaches it:** the earlier claim that a pit with `record[+0x10] != 1` also lands on 9 is retracted — such a pit falls into the shared tail and hits the `CMPI.B #$14` discriminator first, returning **2**. `*X`/`*Y` **is** overwritten from `record[+0xC]`/`[+0xE]` (a real relocation) and the caller plays a **distinct sound effect (id `0xD`=13)** before the generic tail. Confirmed by the clue book naming four of these squares "TELEPORTS" at exact coordinates (Level 10 note 14) plus 13 exact destination-coordinate matches — see "Special-square sub-kinds" above. |

After a successful (non-blocked) move, the code that follows (not detailed
above) calls `JSR $82D9E.l` (viewport redraw — the same call `TurnParty`
makes after rotating) and conditionally `JSR $A3D4C.l` when automap mode is
active (`$174A(A4)==1` and `$1E28(A4)!=0`) — i.e. movement and rotation
share one "redraw + automap update" tail, confirmed by both functions
calling the identical pair.

#### Input dispatcher — S_1 `+0xDAB4` (confirmed)

Reads `$1EB4(A4)` (current pressed key/scancode) and compares it against six
scancodes stored at `[$1E6C(A4)] + 0x58..0x5D`, dispatching to `MoveParty`/
`TurnParty` with the verb table above:

```asm
DAC0  cmp table[$58] vs $1EB4(A4)  ⇒ MoveParty(2)         ; Back
DAE6  cmp table[$59] vs $1EB4(A4)  ⇒ MoveParty(0)         ; Forward
DB0A  cmp table[$5A] vs $1EB4(A4)  ⇒ MoveParty(3)         ; Strafe left
DB30  cmp table[$5B] vs $1EB4(A4)  ⇒ MoveParty(1)         ; Strafe right
DB56  cmp table[$5C] vs $1EB4(A4)  ⇒ TurnParty(3)         ; Turn left
DB7C  cmp table[$5D] vs $1EB4(A4)  ⇒ TurnParty(1)         ; Turn right
```

Each case also calls the UI-feedback helper `S_1 +0xDA6C` with its own
0–5 verb code (Back=2, Forward=0, StrafeLeft=3, StrafeRight=1, TurnLeft=4,
TurnRight=5) before the real move/turn call — this drives the on-screen
movement-compass highlight, not game state.

This dispatcher is called (`S_1 +0xD96C`/`+0xDA38`) from a wrapper that first
debounces the input (`JSR $9F4CA.l` polls the input device, then compares
`$1E82(A4)` against `$1E80(A4)` — a last-processed-vs-current edge-detector,
so one keypress/joystick edge yields exactly one `MoveParty`/`TurnParty`
call, not a flood of them per frame). The debounce/polling internals weren't
chased further — out of scope for the movement formula itself.

#### Absolute-address base for this trace

The `bcdft` S_1 file offsets cited throughout this document (`S_1 +0xXXXXX`)
are literal offsets into `data/blackcrypt/extracted/bcdft_decompressed.bin`.
Direct `JSR $XXXXXXXX.l` operands in the disassembly, however, are the
*original linked absolute addresses* the game runs at, not file offsets — a
fixed base of **`0x80058`** converts between the two (`file_offset =
absolute − 0x80058`), confirmed by an exact match on a call already pinned
to a file offset elsewhere in this doc: `SetDungeonPalette` is documented as
S_1 `+0x26900`, and the `JSR $A6958.l` immediately following `MOVE.W
D0,$1E62(A4)` in the `0x1E`/`0x1F` action-opcode handlers (already confirmed
above) is `0xA6958 − 0x80058 = 0x26900` exactly. Every absolute call target
in this section was converted through this same base before being cited as
an `S_1 +0xXXXXX` offset above.

#### Paths tried / not chased further

| Approach | Result | Notes |
|----------|--------|-------|
| Linear disassembly of the whole `bcdft` S_1 image + grep for `, 0x1740(a4)`/`, 0x1742(a4)` (write-position operand only) | 7 write-site pairs found, 1 already known (teleport, `+0xCD0E`) | The read-side grep (`0x1740(a4)`/`0x1742(a4)` as a *source* operand) returns ~40 hits and is not useful for finding writers — had to anchor on operand position, not just presence |
| Trace the 2 unaccounted write pairs at `+0x6C2E`/`+0xC3DC`/`+0xCA40` | All three are palette/message-trigger side paths (level-transition dialogue, "already there" early-outs) that *also* commit X/Y, not the main per-key mover | Documented as confirming `+0x02D46`'s "called on party movement" claim a second time (the `+0x6C40` call site is a direct `JSR $2D46(PC)` right after committing X/Y), not chased further as separate movement paths since they're guarded by dialogue/one-shot conditions, not the input loop |
| ~~Determine exact pit/stairs/teleport/spinner sub-behaviour (`ResolveTargetSquare` codes 2/3/4/9)~~ | **SOLVED — all seven sub-kinds confirmed, see "Special-square sub-kinds" above.** 2 = floor pit, 3 = stairs, 4 = spinner, 9 = teleport, plus ceiling pit → 0. | Superseded; the two rows below record what the intermediate pass got wrong and how it was caught. |
| ~~"Code 2 is unreachable — a dead `CMPI.B #$14` overwrites it"~~ | **Retracted premise.** The comparison at S_1 `+0x27C7A` is live; it is the shared tail's Pit discriminator. The error was upstream: `+0x27C30`'s `601C` = `BRA.B $27C4E` was read as jumping *past* the commit tail when it jumps *into* it, so the Pit path was thought never to reach the comparison. Code 2 = floor pit, fired by 18 of 33 pit records. | Caught by re-disassembling the Pit branch and resolving the `BRA.B` displacement arithmetically (`0x27C32 + 0x1C = 0x27C4E`) instead of trusting the prose description of the branch. The general lesson matches `negative-from-addressing-root-not-shapes.md`: the "unreachable" verdict was reached by inspecting the comparison itself rather than by enumerating who jumps into the block containing it. |
| ~~"4 = Teleport / 9 = Spinner", then "possibly swapped, no oracle available"~~ | **Confirmed swapped: 4 = Spinner, 9 = Teleport.** The "no ground-truth oracle" blocker was wrong — the official Manual & Clue Book PDF is a per-level annotated map set that names teleports at exact grid coordinates and draws spinners with a dedicated legend symbol. | The clue book is a 64-page **scanned** PDF with no text layer; `pdfimages` + `tesseract` OCR of all 64 pages made the coordinate annotations greppable, and the map symbols were classified by normalised cross-correlation against the legend page's own symbol tiles. Worth remembering for any commercial-era title: a scanned strategy guide can be a byte-level oracle, not just prose. |
| Attempt to find a spinner rotation by searching `partyFacing` writers for `0x1744(a4)` | **False negative — 0 hits.** capstone's m68k printer renders the displacement as `$1744(a4)`, not `0x1744(a4)`; the operand-string filter silently matched nothing. Corrected search finds 71 references and 2 direct writes. | Re-ran with the printer's actual syntax after the zero result looked implausible against a known write site (`TurnParty` `+0x1703E`) cited elsewhere in this doc. A census that returns zero should always be re-run against a known-positive control before it is believed. |
| Census the spinner's forced-turn field as `byte +0x08` | **Wrong field width — reads 0 on all 224 type-`0x12` records**, making the forced turn look like unused data. The instruction is `MOVE.W $8(A5,D4.W),D5`: it is a **word**, whose low byte carries the value. Re-read as a word it is **2 on all 7 spinners**. | Caught by disassembling the consumer instead of inferring the width from the surrounding byte-oriented fields. |
| Chase blocked-code-7's "message" content | **Retracted premise — it isn't a text message.** `+0x23958`/`+0x26482` decode to a hardware-blitter screen-shake/jolt effect driven by a small oscillating numeric table, not a string. See the result-code table above. | Found by disassembling the call target directly instead of searching for string tables; the two candidate tables it selects between are visibly non-ASCII (an `0xFF`-terminated oscillating byte ramp), which is what redirected the trace away from "text lookup" |
| Confirm facing encoding and delta formula via amiberry live capture (move party, read `$1742`/`$1740`/`$1744`) | **Not attempted** | Not needed — the wall-check bit position and the `ApplyFacingDelta` jump-table deltas are two independent internal invariants that only agree for one N/E/S/W assignment (see "Facing encoding" above), which meets this project's verification bar without live access. Per the amiberry hard gate, this would have required asking the user first regardless. |

---

### Door State (open / closed) — confirmed

Traced from two independent directions in decompressed `bcdft` S_1: forward
from the action-opcode dispatcher and the dungeon-tile render loop (this
pass), and forward from `MoveParty`/`ResolveTargetSquare` (the concurrent
"Party Movement / Facing State Machine" pass above). Both landed on the
**same field with the same polarity**, which is the verification — no live
capture was used or needed.

**Storage (confirmed):** door open/closed state is **not** a `wall_flags`
mutation of the map array. It lives in the door's own 20-byte structure
record — the same on-disk/runtime record documented in "Structure bytecode"
above and confirmed generic across items/monsters/structures in "Runtime
parser" — at the **word offset `+0x0E`** (big-endian; the state bit is bit 0
of the low byte, record offset `+0x0F`):

| Value of bit 0 (byte `+0x0F`) | Meaning |
|---|---|
| 0 | Door **closed** |
| 1 | Door **open** |

This settles the two competing hypotheses from the task brief: **Hypothesis
2 is correct** (state lives in the structure's own object record); Hypothesis
1 (a `wall_flags` bit mutation on the live 64×64 map array at `A4 − 0x37CA`)
is refuted for doors specifically — none of the three door action handlers
below ever touch that array, and `ResolveTargetSquare` (movement section)
confirms collision for a doorway edge is decided entirely by the structure
record, with the static `wall_flags` bit on that edge staying clear (a plain
floor connection) the whole time.

#### Mutation — `bcdfs` action opcodes `0x18`/`0x19`/`0x1A` (confirmed)

Located via the action-opcode dispatcher documented above (jump table at
S_1 `+0x0CE54`, PC-relative base `0x0CEAA`, `JMP` at `+0x0CEA8`) — walked
programmatically (not by hand) after an initial hand-arithmetic slip (see
"Paths tried" below):

| Opcode | Action | Handler | Effect on word `@+0x0E` |
|---|---|---|---|
| `0x18` | Door toggle | S_1 `+0x0CB90` | `BCHG.B #0,` low byte — flips bit 0 |
| `0x19` | Door off | S_1 `+0x0CC0C` | `(word & 0xFE) + 1` — forces bit 0 = **1** (open) |
| `0x1A` | Door on | S_1 `+0x0CC68` | `word & 0xFE` — forces bit 0 = **0** (closed) |

All three resolve the target structure's `unique` from the action record's
`(X, Y)` fields (`D3`/`D4`, "Selector 3" above) via the same helper,
`JSR $A7D80.l` = S_1 `+0x27D28` (absolute→file offset via the `0x80058` base
documented in the movement section above) — a "resolve structure-unique at
`(row, col)`" routine also used by `MoveParty`'s neighbourhood scans and by
the render consumer below. If the lookup returns `unique == 0` (no structure
there), all three handlers skip straight to the dispatcher's shared exit.
Otherwise they index the record at `A4 − 0x6E7A + unique×0x14`, read/modify/
write the word at `+0x0E`, set the screen-dirty flag `MOVE.B #1,$1748(A4)`,
and (Door toggle only) additionally call a local sound/redraw routine
(`JSR +0xC41A(PC)`) when the bit ends up clear (closing). All three then
`BRA.W` to the dispatcher's common exit at S_1 `+0x0CEAC`.

This "on = feature active, off = feature inactive, toggle = flip" naming
convention matches the dispatcher's sibling handlers for other structure
classes, which confirms the *pattern* independently of doors: opcodes
`0x00`–`0x02` ("Spell-failed toggle/on/off", S_1 `+0x0C54C`/`+0x0C584`/
`+0x0C5C2`) use the identical `BCHG`/`BCLR` idiom but against **bit `0x1E`
(30) of the map square's own longword** at `A4 − 0x37CA` — the type nibble's
spell-failed flag, *not* the structure record. Doors use the same verb
naming but a completely different storage location; this is direct evidence
against Hypothesis 1, not just an absence of counter-evidence.

**A third writer** exists at S_1 `+0x11226`: `MOVE.W #1, 0xE(A0,D0.L)`
unconditionally sets a structure record's word `+0x0E` to literal `1`
(open), inside a routine (S_1 `+0x1120A`–`+0x11294`) that also reads/writes
the dungeon accent-ramp state (`$1E5C(A4)`/`$1E60(A4)`) — consistent with a
scripted or spell-triggered "force this door open" effect (e.g. a `Knock`-
type spell or a quest trigger), but the caller wasn't identified this pass.

#### Consumer 1 — render selection (confirmed)

**S_1 `+0x112FC`**, inside the dungeon wall-tile blit dispatcher that
composes the 3D viewport per visible square: after confirming a structure
occupies the square (`TST.W` word `+0x0C` at `+0x112E6`, nonzero), it does
`BTST.B #0, 0xF(A0,D0.L)` — the identical bit tested by the action handlers
above. If **set** (open), it additionally calls a doorway sub-blit at
S_1 `+0x0CF34` (passing a constant `0x0F` plus the square's local X/Y)
*before* falling into the base wall-tile blit at S_1 `+0x0B614`, which
always runs regardless of door state. If **clear** (closed) or no structure
is present, only the base blit runs.

> **Correction — `+0x0CF34`'s interpretation above was a guess, and this pass
> traced its body far enough to retract it.** It is **not** a door-specific
> "paint the open-doorway frame" routine. `+0x0CF34` re-resolves the
> structure's `unique` via the confirmed `JSR $A7D80.l` helper as documented,
> then switches on the record's type byte `+0x05` — but the two branches it
> actually implements explicitly are types `0x1D` and `0x1E` (both toggle the
> record's own `+0x08` word, index a **runtime** (BSS, level-populated) 8-byte
> "prop animation slot" table at `A4+0x836`, and — when the slot's stored
> generation/id matches — call a generic tag-based resource scheduler at S_1
> `+0x0005EA` (absolute `$80642`) that allocates a 12-byte timed-event slot in
> a table at `A4+0x1036`, not a pixel blit). Type `0x11` (Door frame) has
> **no explicit case** in this function; it falls through the same shared
> tail as `0x1D`/`0x1E`, meaning the door render call at `+0x112FC` drives this
> generic lever/panel/fountain-style animation-slot mechanism, not a direct
> "blit doorway frame N" call. The actual door **frame** art for every depth
> except the immediate depth-1/lateral-0 square is now known to come from a
> completely different, fully-static mechanism — see "Kind 11 …" in "3D
> Viewport Compositing" above, which is byte-exact confirmed against the door
> chunk's sub-image offsets. What `+0x0CF34` does for the depth-0 (immediately
> adjacent) doorway square specifically — whether it's simply inert for type
> `0x11` (no case, no effect beyond the shared toggle/table-lookup scaffolding)
> or does something not surfaced by this trace — is genuinely unresolved; see
> "Still open" below.

> **Correction — everything above about `+0x112FC`, including the correction
> block itself, is reading the wrong record. Now SOLVED.** Both the `TST.W $C`
> at `+0x112E6` and the `BTST.B #0,$F` at `+0x112FC` compute `D0` from
> **`D3`** — the **Door switch** (`0x0F`) record found by the chain walk at
> `+0x11198` — not from `D4`, the Door frame. `+0x112FC` therefore has nothing
> to do with the door's open/closed bit, and the `#$0F` byte pushed at
> `+0x11304` immediately below it is the **structure-type argument**
> `+0x0CF34` resolves by. Four consequences:
>
> 1. **`+0x0CF34` never receives a type-`0x11` record from anywhere.** All
>    nine of its call sites pass `0x0F`, `0x16`, `0x1D`, `0x1E`, `0x1F` or
>    `0x21` (table in "bcdfs — Action bytecode" → "`TriggerActionsAt`") —
>    exactly the six structure types the loader gives an action chain to.
>    "What does the shared tail do for a Door frame" is therefore a malformed
>    question: a Door frame never enters the function. What it *does* receive
>    here is the door's companion Door-switch record.
> 2. **`+0x0CF34` is not an animation dispatcher at all.** It is the engine's
>    generic **action-chain executor** and `A4+0x836` is the **action array**
>    (8-byte `bcdfs` action records indexed by action id), not a
>    prop-animation-slot table. Full trace, pseudocode and verification:
>    "bcdfs — Map / Dungeon Format" → "Action bytecode" →
>    "`TriggerActionsAt(col, row, structType)` — S_1 `+0x0CF34` — SOLVED".
> 3. **`+0x112FC` is on the door-OPENING branch, not the closing one.** The
>    branch structure is `TST.W $E(door)` at `+0x111EA` → **zero ⇒ open**
>    (fall through, `MOVE.W #$1,$E` at `+0x11226`, then the `+0x11310` call);
>    **non-zero ⇒ `BNE.W $1131E`**, where `1` ⇒ close (`CLR.W $E` at
>    `+0x113CE`/`+0x113F0`, then a *second* call at `+0x114AA`) and anything
>    else ⇒ `THE DOOR IS LOCKED`. The earlier correction had the two branches
>    the wrong way round.
> 4. **`+0x0B614` is not "the base wall-tile blit".** It is a ±3-square
>    neighbourhood scan around the party (`$1742(a4)−3 … +3`, `$1740(a4)−3 …
>    +3`, S_1 `+0x0B624`–`+0x0B640`) inside the monster-instance region — a
>    post-interaction monster/awareness pass, not a render call.

#### Consumer 1 (corrected) — the door switch fires the door's action chain — **SOLVED**

Every door interaction is bracketed by two calls to `TriggerActionsAt` on the
**Door switch** (type `0x0F`) record that sits on the same square as the Door
frame:

| Call site | Branch | Guard on the `0x0F` record |
|---|---|---|
| S_1 `+0x11310` | door was **opened** (state `0` → `1`) | `TST.W +0x0C ≠ 0` **and** `BTST #0, +0x0F` |
| S_1 `+0x114AA` | door was **closed** (state `1` → `0`) | `TST.W +0x0C ≠ 0` **and** `BTST #1, +0x0F` |

Word `+0x0C` of the switch record is its **first action id** (its low byte is
the byte `+0x0D` the loader's `$987BC` chain walk reads), so the first guard
is simply "does this door switch have an action chain". Bits 0 and 1 of byte
`+0x0F` select **fire-on-open** and **fire-on-close**.

**Shipped-data census (`bcdfs`, all 13 maps, walked with
`scripts/bclib/bcdfs.py` + action capture):**

* **96** type-`0x0F` records; **96 / 96 sit on a square that also holds a
  type-`0x11` Door frame**, zero exceptions — the "Door switch" name is
  structurally confirmed, it is a door's companion trigger record, not a
  free-standing switch (that is type `0x1D`).
* byte `+0x0F` bit 0 (fire-on-open) is **0 on all 96** records, and no code
  anywhere writes word `+0x0E` of a `0x0F` record (see "Paths tried" below).
  **The open-branch call at `+0x11310` is therefore dead on shipped data.**
* byte `+0x0F` bit 1 (fire-on-close) is set on **6**; word `+0x0C` is non-zero
  on **5**. The two sets overlap in exactly **5** records — those five doors,
  and only those, run an action chain, and only when the party *closes* them.

| Map | Switch (row, col) | Actions | Effect |
|---|---|---|---|
| 12 | (8, 12) | 1 × op `0x12` `Monster gen trigger`, value 15, runs 1, delay 0 | spawns immediately, one-shot |
| 12 | (14, 6) | same, target (14, 2) | " |
| 12 | (14, 18) | same, target (14, 22) | " |
| 12 | (20, 12) | same, target (24, 12) | " |
| 9 | (21, 25) | 6 × op `0x03` `Pillar toggle`, runs `0xFF`, clicks `1,1,1,2,2,2`, delays `23,78,23,25,36,80` | a two-stage timed pillar puzzle: closing the door once moves three pillars, closing it again moves the other three, then the chain wraps |

**So the answer to "is it a no-op for the door path": no.** Even for the 91
door switches with no action chain the call is never reached (the `TST.W
+0x0C` guard rejects them), and for the 5 that are reached the routine
(a) plays **sound effect 5** through the stereo `PlaySfx` at `$80506`,
(b) clears and then commits the three redraw flags `$1749`/`$174C`/`$174D(a4)`
via `$80882` (which calls `DrawViewport` when `$1748` is set),
(c) executes or schedules the actions, and
(d) writes the switch's click counter (word `+0x10`) and next-action id
(word `+0x0C`) back to the record — state that is saved in savegames.

#### Structure record field map — Door switch (type `0x0F`) — confirmed

| Offset | Size | Field | Evidence |
|---|---|---|---|
| `0x00` | 2 | `gfxNumber` — `0x0037` on 96/96 | on-disk |
| `0x02` | 2 | transient "interaction in progress" flag — set to `1` at S_1 `+0x111D4`, cleared at `+0x11362`/`+0x114DC`; `0` on disk in 96/96 | `OpenDoorAtParty` |
| `0x04` | 1 | wall-direction mask (`0x50` on 36, `0xA0` on 60) | read at S_1 `+0x032D8` (render/visibility) |
| `0x05` | 1 | type `0x0F` | on-disk |
| `0x07` | 1 | sub-image / orientation selector (`1`, `5`, `10`) | read at S_1 `+0x032E6` |
| `0x0A` | 2 | busy/disabled counter — `+0x0CF34` requires `0`; `+1` while a delayed chain is pending (released by event tag `0x29`), `±2` by action opcodes `0x0D`/`0x16` and `0x0E`/`0x17` | S_1 `+0x0CF76`, `+0x0D11E`, `+0x01BFC`, `+0x0CADC`, `+0x0CB36` |
| **`0x0C`** | **2** | **next action id** — low byte is the loader's "first action id" byte `+0x0D`; rewritten by `+0x0CF34` as the chain advances. `0` ⇒ no chain, guard fails | S_1 `+0x112E6`, `+0x11480`, `+0x0D146` |
| **`0x0F`** | **bits** | **bit 0 = fire chain when the door opens** (never set on disk), **bit 1 = fire chain when the door closes** (set on 6) | S_1 `+0x112FC`, `+0x11496` |
| `0x10` | 2 | **click counter** — compared as `+1` against each action's `clicks` byte; reset to `0` when the chain wraps | S_1 `+0x0CFC0`, `+0x0D14E` |
| `0x12` | 2 | chain-next (same-square object chain) | generic |

Note `+0x0E`/`+0x0F` here is **not** the door-state word: that lives in the
Door *frame* (`0x11`) record on the same square. The two records' `+0x0E`
fields are unrelated, which is exactly the confusion the correction above
unwinds.

#### Consumer 2 — movement blocking (confirmed, independently by the concurrent movement pass)

See `ResolveTargetSquare` in "Party Movement / Facing State Machine" above:
for a target square whose structure record has type byte `+0x05 == 0x11`
(Door frame), it `BTST`s the identical bit — **set ⇒ door open, move
succeeds; clear ⇒ door closed, result 1** (generic blocked-and-bump,
`MoveParty` reverts X/Y and plays a bump SFX via `JSR $80506.l` =
S_1 `+0x4AE`, effect id 8). The same absolute call target (byte pattern
`4EB900080506`) is also called at S_1 `+0xCECE` — the action dispatcher's
own default/unhandled-opcode fallback, immediately adjacent to the door
handlers documented above — and at S_1 `+0x112CE`, a few instructions
before the door-open bit test at `+0x112FC`, inside the *same* render
function. Both are consistent with `+0x80506` being a general-purpose
"play sound effect N" routine (not door-specific), but their proximity to
the door-handling code in both traces is a useful independent landmark for
anyone re-tracing this region.

Collision is two-stage and single-sided: `MoveParty` first tests the
**current** square's static `wall_flags` bit (bits 12–15 of the map-array
longword, direction-selected) and aborts immediately if a hard wall is
present, *before* ever calling `ResolveTargetSquare`. Only when that
static check is clear does it resolve the **target** square and consult the
structure record's dynamic bit. A doorway edge therefore always has
`wall_flags` clear (an open floor connection, not a wall) — passability is
decided entirely by the structure record, never by flipping a `wall_flags`
bit. This is the second, independent confirmation that Hypothesis 2 holds
and Hypothesis 1 does not.

#### Consumer 3 — kind-11 viewport render, depths 1–3 (confirmed byte-exact, new this pass)

A **third** door render consumer, found this pass and traced independently of
Consumers 1 and 2: `DrawViewport`'s Phase-1 sight-line walk enqueues doorway
squares as jump-table **kind 11** (S_1 `+0x034EE`), whose stub tests the
identical bit (`BTST.B #0, $F(A0,D0.L)`, at S_1 `+0x03508` — this is the
"unrelated spell/status-effect" hit flagged and set aside in the Consumer-2
"Paths tried" byte-pattern census below; it is not unrelated, it's this
consumer). **Unlike Consumer 1, this path is fully static and was walked all
the way to specific tileset byte offsets**: the frame (`Door Way 1/2/3`) is
drawn unconditionally by `+0x025CAE`, and the leaf (`Door Type 0/1`, selected
by the record's own `gfxNumber`) is drawn on top only when this bit is clear,
by `+0x02613E` — all 13 descriptors involved (7 frame + 6 leaf) are
byte-exact, zero deviation, against the door chunk's already-documented
cumulative sub-image offset table. Full trace, tables and verification: "3D
Viewport Compositing" → "Kind 11 …" above. This covers every doorway square
at depth 1–3; only the single depth-1/lateral-0 "door right next to the
party" case still routes through Consumer 1's `DrawDoorAtDepth`, whose own
descriptor tables turned out to be runtime BSS scratch (unresolvable
statically, not an unchased lead — see the correction above "Kind 11" in the
viewport section).

#### Structure record field map — Door Frame (type `0x11`) — partial (confirmed subset)

| Offset | Size | Field | Evidence |
|---|---|---|---|
| `0x00`–`0x01` | 2 | `gfxNumber` (`0x0035`/`0x0036`) | "Structure bytecode" table above |
| `0x05` | 1 | Structure type (`0x11` = Door frame) | Tested in `ResolveTargetSquare` (movement section) and at S_1 `+0x1117C`/`+0x16C08` (further door-frame-type dispatch sites, not chased this pass) |
| `0x0C` | 2 (word) | ~~"Structure present" gate / occupancy flag~~ **Not mapped for type `0x11`.** The `TST.W` at S_1 `+0x112E6` cited here reads the *Door switch* (`0x0F`) record, not the Door frame — see the correction under "Consumer 1" above. On a `0x0F` record this word is the next-action id; on `0x10` it is the sub-kind; on `0x22` it is the `lockNumber`. What it means on a Door frame is untraced | — |
| `0x0E`–`0x0F` | 2 (word, big-endian) | **Door open/closed state** — bit 0 of byte `+0x0F`: 0=closed, 1=open. Rest of the word not characterized (see caveat below). | Write: S_1 `+0x0CB90`/`+0x0CC0C`/`+0x0CC68`, `+0x11226`. Read: S_1 `+0x112FC` (render), `ResolveTargetSquare` (movement) |
| `0x12` | 2 (word) | Chain-next index (`unique` of next record chained to this square) | "Runtime parser" section above; independently re-confirmed from the movement side in `ResolveTargetSquare`'s "Chain walk" |

Fields `0x02`–`0x04`, `0x06`–`0x0B`, `0x10`–`0x11`, `0x13` are not mapped for
the Door Frame type this pass.

**Caveat — the same byte offset is not universally the door bit.** The word
at `+0x0E` is a generic structure-record field whose meaning is
type-dependent, not door-specific by construction: S_1 `+0x4CE8`/`+0x4EAE`/
`+0xB924` all load the identical word and `CMP.W`/`BHI`/`BCS` it against an
unrelated local — but those sites sit inside a **monster-generator**
neighbourhood scan (structure type `0x2E`, confirmed via a `CMPI.B #0x2E`
a few instructions earlier at `+0xB81C`), not a door context. Only the
Door Frame (`0x11`) type's interpretation of `+0x0E`/`+0x0F` — the bit-0
open/closed flag — is confirmed; other structure types reuse the same byte
range for other purposes.

#### Locked doors — **SOLVED**

> **Correction —** this section previously read "not traced this pass …
> whether 'locked' is a third state of the same word, a precondition checked
> before Door toggle/on is allowed to run, or gates a separate interaction
> entirely, is open." It is the **first** of those three: `locked` is
> **bit 1 of the very same word `+0x0E`**, and it is checked by the *manual*
> open/close interaction only — the `bcdfs` action opcodes `0x18`/`0x19`/
> `0x1A` deliberately preserve it (all three mask with `0x00FE`, i.e. they
> touch bit 0 and nothing else).

**Encoding — Door frame (`0x11`) word `+0x0E`:**

| bit | meaning |
|---|---|
| 0 | 0 = closed (impassable), 1 = open (passable) — as already documented |
| 1 | **locked**: the party cannot open or close this door by hand |
| 2-15 | unused (never non-zero on disk, never written) |

All four combinations ship in `bcdfs`; the histogram over **291** Door-frame
records across all 13 maps is `{0: 121, 1: 16, 2: 65, 3: 89}` — so bit 1 is
**not** "untouched and possibly unused", it is set on 154 of 291 doors.

**Consumer 1 — the manual open/close verb.** `OpenDoorAtParty`,
S_1 **`+0x1110A`** (absolute `$91162`). It resolves the square the party
faces (`ApplyFacingDelta` via `JSR $8030C`), walks that square's record chain
keeping the Door frame (`CMPI.B #$11,$5(A0,D0.L)` at `+0x1117C` → `d4`) and
any Door switch (`#$0F` at `+0x11198` → `d3`), then:

```asm
+0x111EA  tst.w   $e(a0,d0.l)        ; d4 = the door frame
+0x111EE  bne.w   $91376             ; non-zero -> "not simply closed"
          ...                        ; sfx, screen update
+0x11226  move.w  #$1,$e(a0,d0.l)    ; 0 -> 1 : OPEN the door
...
$91376 = +0x1131E:
+0x1132E  cmpi.w  #$1,$e(a0,d0.l)
+0x11334  bne.w   $9150a             ; not 1 either -> LOCKED
          ...                        ; == 1 : try to close it
$9150a = +0x114B2:
+0x114BA  pea     $9d76e.l           ; "THE DOOR IS LOCKED"  (S_1 +0x1D716)
+0x114C0  jsr     $9f400.l
```

So the rule is literally *"`0` → open it, `1` → close it, anything else →
print `THE DOOR IS LOCKED`"*. With only bit 1 ever set on disk, "anything
else" is exactly "bit 1 set".

> **Correction — S_1 `+0x112FC` is not a render site, and the `+0x11226`
> writer's caller is now known.** "Consumer 1 — render selection" above
> describes `+0x112FC` as sitting "inside the dungeon wall-tile blit
> dispatcher that composes the 3D viewport per visible square". It does not:
> `+0x112FC` is inside `OpenDoorAtParty` (`+0x1110A` … `+0x114FE`), on the
> *close-the-door* branch, and the `JSR $8CF8C` it guards is the generic
> structure-toggle/animation dispatcher `+0x0CF34`, not a blit. The genuine
> render consumer is the kind-11 handler documented under "3D Viewport
> Compositing". Likewise, the "third writer … at S_1 `+0x11226`, caller not
> identified, likely a `Knock`-style spell" is simply this routine's own
> open action. (The nearby `BTST #1,$F(A0,D0.L)` at `+0x11496` is **not** a
> door-lock test — its `d0` comes from `d3`, the *Door switch* record, whose
> `+0x0E` is an unrelated type-dependent field.)
>
> > **Correction to this correction — the branch labels are swapped, and the
> > two `BTST`s are now identified.** `+0x112FC` is on the **open**-the-door
> > branch (`TST.W $E` = 0 ⇒ open); the close branch's equivalent call is at
> > `+0x114AA`. And the two bits are not "unrelated type-dependent" mystery
> > fields: on a Door-switch (`0x0F`) record, `+0x0F` bit 0 = *fire the action
> > chain when the door opens* and bit 1 = *fire it when the door closes*.
> > See "Consumer 1 (corrected) — the door switch fires the door's action
> > chain" above.

**Consumer 2 — movement.** Unchanged and re-verified here:
`ResolveTargetSquare` `+0x27BFC` does `BTST.B #0,$F(A5,D4.W)` and takes the
passable path when set. A locked-but-open door (state `3`) is therefore
walkable; a locked-and-closed door (state `2`) blocks.

#### Key → lock → door, end to end (confirmed)

The "use the held item on the square in front" handler at S_1 **`+0x16AC0`**:

| Step | Code | Effect |
|---|---|---|
| 1 | `CMPI.B #$6,$5(A0,D0.L)` at `+0x16AD0` | held item (`$1A22(A4)`) must be itemType `0x06` = **Key**, else nothing happens |
| 2 | `+0x16ADA`-`+0x16B02` | play sfx 6, compute the square in front via `ApplyFacingDelta` |
| 3 | `MOVEQ #$22,D3` / `JSR $A7D80.l` at `+0x16B0E` | resolve a **Door lock** (structure type `0x22`) on that square; none ⇒ abort |
| 4 | `MOVE.W $C(A0,D1.L),D1` / `CMP.W $C(A1,D0.L),D1` at `+0x16B56` | the lock's word **`+0x0C`** must equal the key's word **`+0x0C`** — this is the `lockNumber` |
| 5 | `TST.W $E(A0,D0.L)` at `+0x16B70` | the lock's word **`+0x0E`** is a *turns remaining* counter and must be non-zero |
| — | mismatch at 4 **or** zero at 5 | `PEA $9D8F8.l` = **`THE KEY DOES NOT FIT`** (S_1 `+0x1D8A0`), `JSR $9F400` |
| 6 | `SUBQ.W #$1,$E(A0)` at `+0x16BA0` | decrement the lock's counter |
| 7 | `JSR $8009E` / `CLR.W $1A22(A4)` | **consume the key** and clear the held-item slot |
| 8 | `TST.W $E(A0,D0.L)` / `BNE $96CA0` at `+0x16BCA` | counter still non-zero ⇒ feedback only, door stays locked |
| 9 | `+0x16BD2`-`+0x16C24` | else walk the square's chain for the Door frame (`CMPI.B #$11`) |
| 10 | `CLR.W $E(A0,D0.L)` at `+0x16C36` | **clear the whole state word** — bit 1 (locked) *and* bit 0 → state `0` |
| 11 | `JSR $91162(pc)` at `+0x16C42` | call `OpenDoorAtParty`, which sees state `0` and immediately opens it |

**Door lock (`0x22`) record field map** — read off 61 records in the shipped
`bcdfs`:

| Offset | Size | Field | Evidence |
|---|---|---|---|
| `0x00` | 2 | `gfxNumber` `0x0051`-`0x0053` | on-disk, matches the structure table |
| `0x05` | 1 | type `0x22` | on-disk |
| `0x06` | 2 | wall direction (`1` N / `2` E / `4` S / `8` W) — which wall carries the lock plate | on-disk; only these four values occur |
| `0x0C` | 2 | **`lockNumber`** — matched against the Key's `+0x0C` | S_1 `+0x16B56` |
| `0x0E` | 2 | **turns remaining** — decremented per matching key; `1` in **61/61** shipped records | S_1 `+0x16B70`/`+0x16BA0` |
| `0x12` | 2 | chain-next | generic |

**Verification (structural, no live capture).** Cross-tabulating the 291 Door
frames against the 61 Door locks by square:

| door state | lock on the same square | no lock |
|---|---|---|
| `0` (closed, unlocked) | 2 | 119 |
| `1` (open, unlocked) | 0 | 16 |
| `2` (**closed, locked**) | **59** | 6 |
| `3` (open, locked) | 0 | 89 |

Locks pair with bit-1 doors and with nothing else: 59 of 61 sit on a state-2
door, and **not one** sits on a state-1 or state-3 door. Widening the search
to the 8 neighbouring squares changes none of these counts, so the two
outliers are genuinely lock-plates whose door has already been authored
unlocked, not an addressing artefact. The 89 state-3 doors (bit 1 set, bit 0
set, no lock plate) are open archways the player can neither close nor
unlock — only the `0x18`/`0x19`/`0x1A` action opcodes can move their bit 0,
which is exactly what those opcodes' `ANDI.W #$00FE` masking preserves.

#### Still open

| Item | Status |
|---|---|
| ~~Locked-door state representation~~ | **SOLVED** — bit 1 of the same word `+0x0E`; full key/lock trace above |
| The 6 state-`2` doors with no Door lock record on or beside them | Unexplained residual (6 of 65). Nothing found so far clears bit 1 except S_1 `+0x16C36`, which requires a `0x22` record, so on the present reading those doors can never be opened by the party — plausible for scenery, not verified |
| ~~`+0x0CF34`'s exact sub-image selection~~ / ~~whether it has any visible effect for a depth-0 door~~ | **SOLVED, on a refuted premise.** `+0x0CF34` is `TriggerActionsAt(col, row, structType)` — the engine's generic **action-chain executor** (`A4+0x836` is the action array, not an animation-slot table). It is never called with a Door-frame (`0x11`) record by any of its nine call sites; the door path passes type **`0x0F`** (Door switch), and `+0x112FC`/`+0x112E6` were reading that record all along. It is **not** a no-op: for 5 of the 96 shipped door switches (4 monster-generator triggers on map 12, one 6-action timed pillar puzzle on map 9) closing the door executes or schedules real actions, plus sound effect 5 and a viewport commit. The open-branch call at `+0x11310` is dead on shipped data (its bit is clear on 96/96 records and nothing writes it). Full trace: "Action bytecode" → "`TriggerActionsAt`"; door-side summary and census: "Consumer 1 (corrected)" above. |
| Caller of the literal `word=1` writer at S_1 `+0x11226` | Not identified — likely a spell effect (`Knock`-style) or scripted trigger, not chased to its own caller |
| ~~Bits 1–15 of the door-state word beyond bit 0~~ | **RESOLVED — bit 1 is the `locked` flag** (set on 154 of 291 shipped Door frames; read at S_1 `+0x111EA`/`+0x1132E`, cleared at `+0x16C36`). Bits 2-15 really are unused: never non-zero on disk, never written. The old wording ("untouched by every write site found this pass") was a false negative — the three action handlers preserve bit 1 *on purpose* (`ANDI.W #$00FE`), which reads as "untouched" only if you don't look at the on-disk values |

#### Paths tried

| Approach | Result | Why / lesson |
|---|---|---|
| Hand-computed the action dispatcher's jump-table targets for opcodes `0x18`/`0x19`/`0x1A` from the 36-entry table at S_1 `+0x0CE54` | Got Door toggle's target wrong by one hex digit (`0xBB90` instead of the correct `0xCB90`); Door off/on (`0xCC0C`/`0xCC68`) happened to come out right | Redid all 36 entries at once in Python (`struct.unpack('>h', ...)` against every table slot, converting via the confirmed `target = 0xCEAA + signed16(entry)` formula) instead of hand arithmetic — the error was caught immediately because `0x1E`/`0x1F`'s recomputed targets no longer matched the already-confirmed `SetDungeonPalette` handlers, an internal consistency check worth doing on any jump-table walk, not just this one |
| Assumed the record word at `+0x0E` means "door open/closed" at every site that touches it | Refuted as a blanket claim | See "Caveat" above — the field is structure-type-dependent; only confirmed for type `0x11` |
| Searched for a direct `wall_flags` mutation (`BSET`/`BCLR`/`BCHG` on the map-array longword's bits 12–15) inside the Door toggle/on/off handlers | None found | Positive evidence against Hypothesis 1: the three handlers only ever read/write the structure-record word at `+0x0E`, never the map array at `A4 − 0x37CA` |
| Byte-pattern census for `BTST.B #0, 0xF(A0,D0.L)` (the confirmed door-bit test) across the whole S_1 image | 3 hits: `+0x3508`, `+0xCBF0` (inside the toggle handler itself), `+0x112FC` (render) | **Corrected this pass — `+0x3508` *is* a third door consumer, not unrelated.** It sits inside `DrawViewport`'s Phase-2 drain loop, specifically the kind-11 jump-table stub (indexed off `$1E64(A4)`/`$1E68(A4)`, the confirmed display-list head/pointer globals — "spell/status-effect dispatch table" was the wrong read of what that indexing is). See Consumer 3 above and "3D Viewport Compositing" → "Kind 11 …" for the full trace. **Corrected again — `+0x112FC` is the *third* wrong reading of that hit.** It is neither a render site nor a door-frame test: `D0` there comes from `D3`, the Door-*switch* record. A `BTST` census keyed on the *instruction shape* cannot tell you which record it indexes; only the provenance of the index register can (`indexed-operand-needs-base-provenance.md`). |
| Read the `+0x0CF34` body's `CMPI.B #$1D`/`#$1E` cases and concluded "type `0x11` has no case, so it falls through a shared tail" | **Wrong question.** The function is never called with a `0x11` record; its type argument comes from the *caller's* pushed byte, which is `0x0F` at both door call sites. | The type constant is 6 bytes above the `JSR` at every call site (`MOVE.B #$xx,-(A7)`); enumerating the call sites first would have cost minutes and made the whole "what happens to `0x11` in the tail" investigation unnecessary. Census the callers before reasoning about a switch's default branch. |
| Read `A4+0x836` (8-byte stride, `+0x01` compare, `+0x07` chain) as a "runtime prop-animation-slot table + event scheduler" | **Refuted — it is the documented `bcdfs` action array.** The tell was already in this document: "Action chain … **8 per action**; first action id = record byte `+0x0D`; each action's byte `+0x07` is the next id" — an exact match for the walk in `+0x0CF34`. | A stride + chain-field + terminator signature that matches an already-documented on-disk struct is almost never a coincidence. Grep the doc for the stride before naming a new table. |
| Establish whether the open-branch call can ever fire, by checking bit 0 of the Door-switch `+0x0F` on disk | 0 on 96/96 records — but "never set on disk" is not "never set" | Closed it properly instead: censused all 37 `JSR $A7D80` sites for the type constant in `D3` and all `CMPI.B #$F,$5(…)` gates. Only `+0x0CF50` (inside `+0x0CF34` itself), the `0x0D`/`0x16`/`0x0E`/`0x17` trigger handlers (which touch `+0x0A` only), the renderer `+0x02ABA`, the visibility test `+0x032C8`, the loader `+0x18C10` and the savegame walk `+0x192FE` ever see a `0x0F` record — **none of them writes `+0x0E`**. That is the closure argument, not the on-disk histogram. |

Cross-references: "bcdfs — Map / Dungeon Format" → "Structure bytecode" /
"Action bytecode" / "Runtime parser" (storage format, on-disk origin);
"Party Movement / Facing State Machine" → `ResolveTargetSquare` above
(independent movement-side confirmation).

---

### `@seer/dungeon` walker exports (Phase C, confirmed)

Real, verified exporters replacing `docs/blackcrypt/walker-plan.md`'s M1
hand-authored files, per that plan's Phase C. All three scripts are
committed under `scripts/`; none of their JSON/PNG output is committed
(gitignored build output, per repo convention).

#### `scripts/export_dungeon_levels.py` → `dungeon/levels.json`

Densifies all 13 sparse `bcdfs` maps to flat 64×64 `DungeonLevelFile` units
(`wallFlags`/`type`/`sublevel`/`objectHandle` planes), using
`bcdfs.read_dungeon_world` (new; see below). Per-map `tileset`/`paletteRamp`
come straight from `bclib.palette.read_level_tileset_indices`/
`read_level_ramp_indices` — **confirmed this pass that both tables are
indexed by *map number* (1–13), not the global 28-level number**, despite
the "level" naming inherited from the game's own code: the `$1E5C(A4)`
dispatch variable's range checks (`<=4`, `==5`, `6..11`, `>=12`) match the
map-file↔tileset-disk-layout table exactly (maps 1–4 & 12–13 on GAMEDISK2
with `bcdfx`; maps 5–11 on GAMEDISK3 with `bcdfy`/`bcdfz`), not the 28-level
numbering. (An earlier draft of this section briefly mis-stated maps 3/4 as
`bcdfz`/ramp 2 by reading the "levels 6-11" prose literally as global level
numbers instead of map numbers — caught by re-deriving the table
programmatically from `bclib.palette`'s own functions instead of by hand,
and confirmed against the per-map validated table below.)

**Validated, 13/13 maps:**

| Map | File | Tileset | Ramp | Sub-levels |
|-----|------|---------|------|------------|
| 1 | bcdfb | bcdfx | 0 | 1, 2 |
| 2 | bcdfc | bcdfx | 0 | 3, 4, 5 |
| 3 | bcdfd | bcdfx | 0 | 6, 7, 8, 9 |
| 4 | bcdfe | bcdfx | 0 | 10, 11, 12 |
| 5 | bcdff | bcdfy | 1 | 13 |
| 6 | bcdfg | bcdfz | 2 | 14, 15 |
| 7 | bcdfh | bcdfz | 2 | 16, 17, 18, 19 |
| 8 | bcdfi | bcdfz | 2 | 20 |
| 9 | bcdfj | bcdfz | 2 | 21, 22 |
| 10 | bcdfk | bcdfz | 2 | 23 |
| 11 | bcdfl | bcdfz | 2 | 24, 25, 26 |
| 12 | bcdfm | bcdfx | 3 | 27 |
| 13 | bcdfn | bcdfx | 3 | 28 |

**`bcdfs.read_dungeon_world` (new public function in `scripts/bclib/bcdfs.py`)**
walks entities keyed `(row, col, slot)` rather than a bare per-map slot
number. This was forced by a genuine, previously-undiscovered latent
property of the shipped data, found while writing this exporter: a raw
on-disk "unique"/slot number is only guaranteed distinct *within the
same-square chain that names it*, not across a whole map. **Map 4 (`bcdfe`)
has 4 top-level chain-head slot numbers (42, 54, 55, 57) that collide with
an unrelated square elsewhere in the same map**, and container/monster
sub-chain head fields (`+0x0A`/`+0x0C`) collide even more often (7 hits on
the first map tested) because — confirmed empirically this pass, matching
a code comment already in `bcdfs.py` that had not previously been load-
bearing — those fields are **not** real slot references at all, only a
nonzero/zero gate; the loader allocates a fresh runtime slot for sub-chain
contents exactly the way it does for a monster's second (stat-continuation)
record, whose own placeholder field (`+0x10`, "always `0x0000`" per the
Monster bytecode table) already established the same pattern. Practical
consequence: `bcdfs.load_world` (used unchanged by `automap_tiles.py`,
re-verified below) keeps its pre-existing, harmless last-write-wins
behaviour on those 4 map-4 collisions; a from-cold export must not, so
`read_dungeon_world` scopes every entity key by its originating `(row,
col)` instead of a bare slot, and does not attempt to key sub-chain
contents at all (walked byte-for-byte for correct stream positioning, but
not independently returned — see the function's own docstring for the
full argument). A monster's second record is folded directly onto the
first's `raw` bytes rather than invented a key for it.

**Refactor verification (`scripts/automap_tiles.py`'s `load_world` promoted
to `bcdfs.load_world`):** the full tile census and all 22 valid
(map, level)-nibble ASCII-map renders are byte-for-byte identical before and
after the refactor (diffed against the pre-refactor script).

#### `scripts/export_dungeon_slots.py` → `dungeon/slots.json`

Re-reads the raw blit-descriptor bytes directly — front-wall table at S_1
`+0x22CE2` (9×20 B) and side-wall table at `+0x22E4A` (8×28 B) — rather than
trusting the M1 hand transcription. **Result: 17/17 slots re-verified with
zero deviation** against the hand-authored file (all `destX`/`destY`/
`frame` values agree exactly); the script would have printed a loud
`MISMATCH` line per disagreeing field had one existed. The side descriptors'
three self-validating invariants (`bytesPerPlane == (w/8)*h`; `BLTSIZE ==
(h<<6)|(w/16+1)`; `modulo + blitBytes == 40`) all pass on all 8 records, and
every descriptor's `src` offset is cross-checked against
`bcdfxyz.SUB_IMAGES`'s independently-authored offset table (also zero
deviation) — two structurally independent sources agreeing byte-for-byte.

#### `scripts/export_dungeon_tileset_indexed.py` → indexed tileset assets

Emits `textures/dungeon-<x|y|z>-indexed.png` (8-bit palette-indexed, the raw
0–63 EHB index domain, `{transparentIndex: null}`), a matching
`-indexed-mask.png` opacity plane, and **every** accent ramp each tileset
serves (`palettes/dungeon-<name>-ramp<N>.json`) rather than only the
already-shipped primary-ramp bake (`textures/dungeon-<name>.png`, which is
wrong for `bcdfx` on levels 12–13 — see "Dungeon accent-ramp selection").
**Verified byte-exact against the existing, already-confirmed RGBA atlas**:
reconstructing 5 sampled frames (`wall0-face`, `ceiling`, `floor`,
`sidewall-depth0-near`, `alcove-a`) from the indexed PNG + ramp-0 palette
JSON reproduces the RGBA atlas with **0 mismatches across 52,787 opaque
pixels**, and the separate mask plane agrees with the RGBA atlas's own
alpha channel with **0 mismatches** on both a masked (`sidewall-depth0-near`,
2,240 px) and an opaque (`wall0-face`, 21,648 px) frame. New shared helpers:
`bclib.atlas.pack_atlas_indexed` and `bclib.paths.write_indexed_png`/
`write_indexed_png_mask` (Python-side equivalents of `@seer/pipeline`'s
`writeIndexedPNG`, which had no prior Python counterpart). The 1-plane
door-clip-stencil sub-image (no colour data) is intentionally excluded —
83/84 (or 46/47 for `bcdfy`) sub-images per tileset, not the full count.
Wiring the walker's *runtime* to pick a ramp is out of scope for this pass
(`walker-plan.md` M4); this only produces the verified data for it.

#### `scripts/verify_dungeon_export.py`

Validates `levels.json`/`slots.json` against `@seer/dungeon/schema`'s real
TypeScript runtime validators (shelled out via `npx tsx`, not a hand-ported
reimplementation of the validation rules) and checks every unit's planes
densify to exactly 4,096 elements. `python3 scripts/verify_dungeon_export.py`
reports `OVERALL: PASS`.

---

## Executable Data Tables

Disassembly (IRA) of the game overlays revealed several runtime data tables
embedded in the executables.

### Item Table (`bcdfp` DATA section, offset ~0x585C)

Default item definitions are stored in `bcdfp`'s DATA hunk using the same
~20-byte format as items placed in the dungeon (`bcdfs`).

> **Correction — the item *names* below were guesses and are wrong.** The
> table is **20 records = 4 characters x 5 starting items** (record 20 fails
> the `prefix == 0 && marker == 0x80` test). Rendering each record's `+2..+3`
> field as a bank-0 item-icon index gives coherent per-class starting kit --
> and shows the old labels do not match the graphics: `0x0007` is a **ring**,
> not a War Hammer; `0x0014` is a **Magic-User spellbook**, not an Apple;
> `0x002E` is a **shirt**, not Brown Pants. Only `0x0033` (gold pants) agrees.
> See "gfxNumber -> icon index" in the item icon section for the full table
> and the evidence.

Field values, unchanged from the earlier note (names withdrawn):
`0x0007`, `0x0014`, `0x002E`, `0x0033`, `0x001C`, and others.

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

### Character-creation screen layout table (`bcdfp` file offset 0x566C)

> **Correction:** this table was previously labelled "Tile Table" and
> guessed to "define the dungeon viewport rendering", with pointers into
> `bcdfa`. Both claims are wrong — re-checked directly against the raw file
> bytes and the calling code, this is a **character-creation screen layout
> table**, unrelated to the 3D viewport or to `bcdfa`.
>
> The table is 15 fixed 14-byte records at **file** offset `0x566C`–`0x573D`
> (`bcdfp` byte-parsed directly, not from IRA's text — IRA renders parts of
> this region as bogus `BCLR`/`EORI` opcodes): `[u16 X][u16 Y][u16 width]
> [u16 height][u16 packed][u16 zero][u16 next_offset]`, terminated by a
> record whose `next_offset` field is `0x0000`. Records 0–8 give **9 screen
> positions at width×height = 32×24** — X cycles `12,45,78` (Δ33, matching
> tile width 32+1px gutter) and Y steps `106,132,158` (Δ26, matching tile
> height 24+2px gutter), i.e. a 3×3 grid — and records 9–12 give **4
> positions at 192×47** (X=128 constant, Y = `5,54,103,152`, Δ49).
>
> This is not a hypothesis: `LAB_0068` (`bcdfp.asm:1886` onward, the routine
> that builds the character-creation screen — its own comment already reads
> "character creation UI") calls `LAB_010E` (render bcdfo UI descriptor by
> index D2, at position D0=X/D1=Y) with the **exact same literal
> numbers**: `D1=90` at `(0,0)`→desc0 (128×105, "Character creation UI" per
> the descriptor table below), then desc1 (192×47, "Enter Crypt UI") four
> times at Y=`5,54,103,152`, then desc2 at `(0,0)`, then desc8 at `(0,65)`.
> Every one of those Y values is a value from this table. The table's 9
> 32×24 entries were not matched to a specific `LAB_0068` call in this pass
> but are almost certainly the race/gender or stat-adjust icon grid on the
> same screen, not dungeon tiles — the direct `LAB_0068` call-site trace
> above (literal position/descriptor-index matches, not a byte-accounting
> argument) is what establishes this is a character-creation layout table;
> whatever these 9 slots render, it reuses existing bcdfo assets via
> `LAB_010E`/desc0-8, not new pixel data at this table's location.
>
> **Correction:** this paragraph previously also argued "bcdfo's file size is
> fully accounted for between the 109 portraits and the LAB_010D UI
> descriptors, so there's no room for a separate dungeon-tile set" as
> supporting evidence. That argument was reached by the wrong route (bcdfo
> has only **36** real portraits, not 109 — see the bcdfo section), even
> though the file *is* in fact fully accounted for: the 23 UI elements are
> 7-plane masked sprites, and the region between them holds three 8×8 fonts
> and the mouse-pointer sprite bank, tiling bcdfo with 0 remainder. There is
> no spare room — but the `LAB_0068` trace is separately conclusive on its
> own, so nothing downstream needs the "no room" argument either way.
>
> **Front-facing wall tiles remain unlocated** — this table is not the lead
> plan.md previously treated it as.

### Monster Data

Monster statistics were **not found** in any executable DATA section. Monsters
appear to be defined only at placement time in the dungeon file (`bcdfs`),
with per-instance stats (HP, XP, attack strength, spell flags) embedded in the
~40-byte monster records. Core monster behavior (AI, attack patterns) is
hardcoded in the game code.

### Palette Variants (`bcdfu`)

**Five** 32-colour palettes are embedded in `bcdfu` at **file** offsets
`0x03EC`, `0x042C`, `0x046C`, `0x04AC`, `0x04EC` (the previously recorded
`0x03C8 / 0x0408 / 0x0448 / 0x0488` are CODE-relative and miscounted).
Indices 0, 16–18 and 20–25 are byte-identical across every variant; only
indices 19 and 26–31 change. These are the accent ramps swapped by the
`bcdfs` action opcodes `0x1E` / `0x1F` (dungeon colour change).
See the Palette section for the full cross-file table.

---

## Extracted Assets

Original game data lives in `data/blackcrypt/{amiga,dosvga}/` (gitignored — never
committed). Everything derived from it is build output, written to
`public/assets/blackcrypt/<platform>/` (also gitignored — regenerate with
`npm run extract-all`, or its two halves separately):

```
public/assets/
  index.json                             # [{game, platform, manifest}]
  blackcrypt/amiga/
    manifest.json                        # merged by both pipelines below
    palettes/{raven,title,game}.json     # see "Palette" section above
    palettes/ui.json                     # scripts/extract_items.py — `game` + the two runtime-corrected registers
    data/{items,classes}.json            # tools/shared/game-config.ts
    sprites/portraits.{png,json,pal.json}  # 36 bcdfo character portraits — tools/shared/game-config.ts
    sprites/items.{png,json}             # 180 bcdfa item icons, 24×24 @ 6bpp — scripts/extract_items.py
    sprites/floor-items.{png,json}       # 147 bcdfa dungeon-floor item sprites (49 items × 3 depths) — scripts/extract_floor_items.py
    data/floor-item-gfx-table.json       # scripts/extract_floor_items.py — gfxNumber → floor-graphics group
    data/floor-item-names.json           # scripts/extract_floor_items.py — 49 confirmed group names (DOS clipper.clp cross-check)
    sprites/{monsters,ui,bcspeed}.{png,json}  # scripts/extract_monsters.py, scripts/render_all.py
    sprites/keys.{png,json}              # 29 bcdfa entry-5 key icons — scripts/extract_bcdfa_keys.py
    sprites/{ui-side-panel,fire-animation,automap}.{png,json}  # the rest of bcdfa entry 5 — scripts/extract_bcdfa_ui_bank.py
    palettes/automap.json                # 32-word dual-playfield automap palette (bcdft S_1 +0x1E886)
    data/fire-animation.json             # 15-frame flame: 4 brazier positions + per-corner phase
    sprites/wall-decorations.{png,json}   # scripts/extract_bcdfbn_decor.py — see "Trailing Data — Wall Decorations + Monster Sound Bank"
    audio/level<NN>-sfx.raw              # scripts/extract_bcdfbn_decor.py — per-level monster sound bank (pcm_s8)
    data/level-sfx-banks.json            # scripts/extract_bcdfbn_decor.py
    sprites/chargen-font-{a,b,cg}.{png,json}  # bcdfo's three 8x8 fonts — scripts/extract_bcdfo_fonts.py
    screens/{raven,title,logo,plot}.png  # scripts/render_all.py
    textures/dungeon-{bcdfx,bcdfy,bcdfz}.{png,json}  # one frame per sub-image; bcdfy is partial (8 of 18)
  blackcrypt/dosvga/
    manifest.json
    palettes/*.json                      # 7 clipper.clp palettes
    sprites/{dungeon,items,misc,monsters,ui}.{png,json}  # scripts/extract_clipper.py
    screens/title.{png,json}             # the four "Title N" clipper entries
    audio/*.{wav,iff,raw}
```

Both a TypeScript pipeline (`npm run extract-data`, via `tools/shared/game-config.ts`)
and Python scripts (`scripts/render_all.py`, `scripts/extract_monsters.py`,
`scripts/extract_clipper.py`) write into this same tree and merge into one
`manifest.json` — see `scripts/bclib/paths.py` and `tools/shared/asset-paths.ts`.
Shared decode logic lives in `scripts/bclib/` (Python) and
`tools/shared/amiga-planar.ts` (TypeScript); both implement the sequential-planar
layout confirmed in this document, not the row-interleaved layout an earlier
copy of the TS decoder used.

### Extraction script status

| Script | Extracts | Output | Status |
|--------|----------|--------|--------|
| `tools/shared/game-config.ts` (`buildAssets`) | 36 bcdfo character portraits (corrected from a 109-tile miscount that ran 73 tiles past the real portrait/UI-descriptor boundary — see the bcdfo section) | `sprites/portraits.*` | Verified pixel-exact against the reference decode in `scripts/render_all.py` for tiles 0-35; tiles 36+ no longer extracted here (already covered by `sprites/ui.*`) |
| `scripts/extract_monsters.py` | 204 monster sprites, bcdfb–bcdfn, all 13 maps | `sprites/monsters.*` | Verified — see "bcdfb–bcdfn" above; 0 unknown palette indices across 864,128 rendered pixels |
| `scripts/extract_clipper.py` | 751 images, 7 palettes, 22 sounds from clipper.clp | `sprites/*`, `palettes/*.json`, `audio/*` | Verified — transparency keys confirmed, 0 stray background pixels |
| `scripts/extract_bcdfo_fonts.py` | bcdfo's three 8×8 fonts: `0x9E28` (64 slots, 1bpp), `0xA148` (59 slots, 1bpp — the colour font's mask) and `0xA320` (59 slots, 6 planes, 48 B/glyph) | `sprites/chargen-font-{a,b,cg}.*` | **Confirmed.** Offsets and the `ASCII − 0x20` slot indexing are read straight out of bcdfp's string printer (`LAB_00FD`, `bcdfp.asm:3614`, and the second printer at bcdfp `0x02CF4`). Fonts B and CG match DOS `clipper.clp` entry 207 `"CG Font"` at **3,776/3,776 bits** (silhouette) and **3,776/3,776 pixels** (full colour — the DOS palette indices `{0,2,3,34}` map to the Amiga EHB indices by the identity). The script also asserts the structural invariant that the colour font's 6-plane OR equals the mask font for **59/59** slots |
| `scripts/render_all.py` (dungeon textures via `scripts/bclib/bcdfxyz.py`) | Screens, dungeon textures, bcdfo UI elements (all 23 as 7-plane masked sprites, under the corrected `LAB_010D` `+10`/`+22` mask semantics and bcdfp's own chargen palette), BCSPEED.GFK sprites | `screens/*`, `textures/*`, `sprites/{ui,bcspeed}.*` | Verified for screens/UI. `textures/dungeon-*` now driven by the real in-executable chunk directory (`bclib.read_chunk_directory`/`read_chunks`) and the confirmed per-sub-image `SUB_IMAGES` geometry (`bclib.iter_sub_images`), not the retired size-based `find_payload_by_size` search — that search was blind to raw-stored chunks (e.g. `bcdfz`'s pillar chunk) and to chunks whose compressed size collides with nothing in `bcdfx`/`bcdfz` (e.g. `bcdfy`'s doors). Run confirms **84 sub-images for bcdfx and bcdfz, 47 for bcdfy** — the documented counts, zero short-data warnings — (the 84th being the 1-plane `door-clip-stencil` that closes slot `$0C`; before it was identified the counts were 83/46/83 with a 320-byte hole) and the per-tileset accent ramp from `read_dungeon_palette_for_tileset` (ramp 0 for bcdfx, 1 for bcdfy, 2 for bcdfz), not a blanket bcdfu-variant-0 default. Regression-checked against the `re-codebreaker` escalation's verified probe: identical pixel-image counts (83/46/83, before the stencil entry existed) and the same "22 of 654,736 opaque pixels have an out-of-palette index" result, unchanged. The old `floor-ceiling`/`wall-sides`/`viewport-mask` outputs are deleted — they used refuted geometry (P2 as one 208×356 image, P4/P5 as 80×193) and the wrong palette tail |
| `scripts/extract_items.py` | 180 item icons (bcdfa banks at `0x1B5B3` + `0x2FE5C`), 24×24 @ 6bpp, no mask | `sprites/items.*`, `palettes/ui.json` | Confirmed — bank byte-exact against chip RAM in 3 savestates (75,600/75,600 B); 100.000% DOS silhouette match (103,680/103,680 px, 180/180 frames); 100.000% pixel match against 13 icon placements in 3 real screenshots (3,683/3,683 opaque px) |
| `scripts/extract_floor_items.py` | 147 dungeon-floor item sprites (49 items × 3 view depths, `bcdfa+0x270C4` + descriptor table in `bcdft` S_1 `+0x271B6`), masked mask+6bpp EHB, variable geometry; group names from `bclib.FLOOR_ITEM_NAMES` | `sprites/floor-items.*`, `data/floor-item-gfx-table.json`, `data/floor-item-names.json` | Confirmed — 147/147 descriptors satisfy all three self-describing invariants and tile the 31,388-byte bank with 0 gaps/overlaps ending exactly on its length; 100.000% pixel match against 43 sprite placements in 10 real screenshots (7,474/7,474 visible opaque px); regression vs. the verified probe has **0** differing index/mask pixels over 35,872. Names cross-checked against DOS `clipper.clp`'s own `Start Floor Items`/`End Floor Items` block: 147/147 dimensions exact, 35,869/35,872 silhouette pixels agree (99.992%) — see `scripts/verify_floor_item_dos_names.py` |
| `scripts/extract_bcdfa_ui_bank.py` (+ `scripts/verify_bcdfa_entry5_dos.py`) | The 11 remaining records of bcdfa entry 5: the "Stone" side panel, its blank-stone erase strip, Scroll Top + Scroll Piece, the 15-frame Fire Animation (with its 4 brazier positions and per-corner phase), the mouse-pointer and bubble hardware sprites, Auto Map Block + the 24 Auto Map Tiles, and the two Treasure Chest states — plus the 32-word automap palette from `bcdft` S_1 `+0x1E886` | `sprites/{ui-side-panel,fire-animation,automap}.*`, `palettes/automap.json`, `data/fire-animation.json` | Confirmed — the 13 records tile the 34,340-byte chunk with **0 remainder** (`bclib.check_text_resource_layout`), and `verify_bcdfa_entry5_dos.py` reports **12/12 comparisons at ≥99.9%** against named DOS `clipper.clp` entries (ten at exactly 100.000%; "Stone" at 99.986% with its 2-px residue and baked-in "Castor 0" both accounted for; the automap palette within 10/255 over 11 entries). Regression vs. the verified probe: **0 differing pixels** across all eleven records |
| `scripts/extract_bcdfa.py`, `scripts/extract_bcdfb_bcdfn.py` | Debug renders under superseded premises (bcdfa as flat 64×24 tiles; bcdfb even-height frame splitting) | `build/cache/blackcrypt/*_debug/` | Superseded — kept for reference only, do not treat their output as ground truth |
| `scripts/decompress_bcdft.py`, `tools/bcdft_decompress/` | Raw decompressed blobs (not images) | `build/cache/blackcrypt/*.bin` | Working; `bcdft` decompression is byte-verified (contains "POTION OF WATER BREATHING" at offset 118185) |
| `scripts/extract_bcdfv.py` (+ `scripts/bclib/bcdfv.py`) | The whole bcdfv endgame sequence: 15 screens, 10 × 160×99 panels, 59 font glyphs, 9 palettes, 29 narration lines | `screens/ending-*.png`, `sprites/ending-{panels,font}.*`, `palettes/ending-*.json`, `data/ending-script.json` | Confirmed — 16/16 blocks decode to their exact expected size with zero deviation; panel and text-panel placement independently confirmed against the frame bitmap (0/14,080 non-black pixels in the text rectangle, non-black 1-px ring on all four sides); regression vs. the verified probe has **0 unexplained differing pixels**. Supersedes the deleted `decompress_bcdfv.py` and `extract_bcdfv_sprites.py`, both of which encoded the refuted "monster sprites in bcdfv" premise |
| `scripts/extract_bcdfbn_decor.py` | 117 wall-decoration sprites (13 maps × 3 decorations × 3 view sizes: 16×20 / 16×15 / 16×11, mask+6bpp EHB) **plus** 13 per-level raw signed-8-bit PCM sound banks, bcdfb–bcdfn trailing data | `sprites/wall-decorations.*`, `audio/level<NN>-sfx.raw`, `data/level-sfx-banks.json` | Confirmed — sound bank verified **byte-exact** against 8 DOS `clipper.clp` samples (bcdfb 100% tiled); graphics boundary at 1932 B holds 13/13 with zero deviation; 0 unknown palette indices across 23,550 opaque pixels. Supersedes the deleted `extract_bcdfbn_icons.py` and its "92 icons" claim |
