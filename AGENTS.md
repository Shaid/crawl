# AGENTS.md — Project conventions for AI assistants

## ⚠️ Extraction Status — Most formats NOT correctly decoded

Multiple extraction approaches have been tried. Most produce incorrect results.
Documented here to avoid repeating dead ends:

### What DOES work:
- **bcdfr**: 4 full-screen images (Raven logo, Title, Logo banner, Plot text) — extract correctly
- **bcdfo**: 109 character portraits (32×24×6bpp) + UI elements via LAB_010D descriptors — extract correctly
- **bcdfq palette at 0x2C6**: 32-color EHB palette confirmed correct against live Amiberry screenshot
- **Screenshot capture**: Amiberry IPC screenshot endpoint works (`/runtime/screenshot`)

### What DOES NOT work (root cause unknown):
- **bcdfb-bcdfn** (monster sprites): **FIXED** — Files are RLE-compressed (bcdfu LAB_0043). Each file has exactly **42 directory entries** with 12-byte header + 28-byte entries. Entries sharing `data_off` are **animation frames** of the same sprite. The frame heights are distributed evenly across the total height (bpr = bpr_row × total_height). Sequential planar decode is correct — 7 planes (mask + 6bpp EHB). RLE decompression produces data with sprites in order; directory offsets index into this decompressed data. 495 individual animation frames extracted across all 13 files. See `data/blackcrypt/extracted/monsters_corrected/`.
- **bcdfa** (BCSPEED animation archive): Container with 887 RLE streams. Contains 16 BCSPEED.GFK sprite bitmaps (32×14 @4bpp, 2-6 frames each) in stream 407, 283 BCSPEED.PRG animation keyframe entries across streams 708-739 with 7 action types (walk N/S/E/W/diag, attack, spell, damage, die, idle), and viewport masks in streams 0-1. **NOT item tiles** — the 64×24 tile assumption was wrong.
- **Item icons**: From **bcdfo** portrait tiles (32×24×6bpp, 109 tiles) via LAB_010F — ALREADY EXTRACTED. Item record stores tile index at +36.
- **Item sprites (dungeon floor)**: In bcdft S_5 LZ77-compressed data (Block 1: item sprites + text tables). Not yet extractable.
- **bcdfv** (sound + sprite container): RLE block extraction + sequential 6bpp gives ~69% shape match with PC demo Two Head (64×96, 17 frames). Best result: seq_64x96 F14 at 68.9% with plane order reversed, MSB-first, shift=6. Word-interleaved decode produces same shape match (~65%). Not close enough to identify correctly.
- **bcdft** (LZ77 compressed data): Custom backwards-reading LZ77 with 8-byte FIFO and embedded tables. **DECOMPRESSED** via musashi 68k emulator (see `tools/bcdft_decompress/`).

### Extraction Paths Tried

| Format | Approach | Result | Notes |
|--------|----------|--------|-------|
| bcdfb | RLE decompress all streams, use dir offsets into concatenated output | **204 sprites correct** | Root cause: offsets into decompressed data, not raw file |
| bcdfb | 7-plane seq planar at directory offsets (raw file) | Noise | Was reading raw compressed data as if uncompressed |
| bcdfb | 42-entry dir + RLE decompress + 7-plane sequential | 204 sprites, bitplane misaligned | Opacity/colors correct but planes vertically scrambled |
| bcdfb | 42-entry dir + RLE decompress + 7-plane seq + **frame splitting by entry count** | **495 animation frames** | Correct! Entry groups sharing data_off = frames of same sprite |
| bcdfa | 64×24 tiles, 6bpp, RLE streams | 280 tiles, unrecognizable | |
| bcdfa | 32×24 tiles, 6bpp, RLE streams | 599 tiles, unrecognizable | |
| bcdfa | Archive/stream analysis | 887 streams, BCSPEED markers | Container format, not sequential tiles |
| bcdfa | 32×14 @4bpp, BCSPEED.GFK 16 entries | **16 multi-frame sprites** | GFK sprites (cursors, targeting reticles, UI indicators) |
| bcdfa | PRG analysis, streams 708-739 | **283 keyframe entries, 7 action types** | 0x0b=walkNSEW, 0x10=walkDiag, 0x09=attack, 0x13=spell, 0x0d=damage, 0x15=die, 0x1f=idle |
| bcdfv | RLE block + raw, 6bpp seq planar | 69% shape match | seq_64x96 F14 best = 68.9% |
| bcdfv | RLE block + raw, 6bpp word-interleaved | 65% shape match | wintl_64x96 F14 = 65.2% |
| bcdfv | RLE block + raw, 7-plane (mask) word-intl | Mask runs avg 2.4px | Fragmented, not coherent |
| bcdfv | Font at decompressed offset $A148 | saved font sheet | |
| bcdft | Simple backwards token LZ77 | 0 bytes | |
| bcdft | Simple bit-stream LZ77 | 182 bytes | |
| bcdfq palette | 0x2C6 offset verified vs screenshot | Confirmed correct | EHB palette matches in-game colors |
| bcdfo UI | Descriptors from LAB_010D | Correct | |
| bcdfr | 4 screens at documented BPP | Correct | |

### Likely Systematic Issue
All planar bitplane decode is wrong despite matching documented format. Possible causes
(not yet exhausted):
- Bitplane ordering (reverse plane order for color bits)
- Bit significance within byte (MSB vs LSB first)
- Missing RLE-decompression step before bitplane decode
- 7th plane (mask) being used differently than expected
- Amiga word-alignment issues (row_pitch rounding affecting non-power-of-2 widths)
- **bcdfv blocks may not be concatenated** — they may be stored in separate areas of the buffer at 12(A5), leaving gaps between them that corrupt frame alignment
- Code comment says "64×96 interleaved" but inline sprite copy code uses stride=12 ($0C) between plane words, and 10-byte/12-byte header skips — the exact layout within each sprite entry remains unclear

## Agent: amiga-re (Amiga 68k Reverse Engineering Specialist)

Available via the `task` tool with `subagent_type="amiga-re"`. Loads the profile from
`.opencode/skills/amiga-re.md` and has access to radare2 MCP + openground (amigadocs).

Use for: analyzing 68k disassembly, custom chipset usage, AmigaOS LVO resolution,
custom compression formats, bootblock analysis.

## Reverse Engineering

### What to annotate
- Data tables: decoded values, sizes, counts, purpose
- Functions: what they do, parameters, return values
- Constants: magic numbers, addresses, offsets
- Structures: field layout, byte-level format
- File format discoveries: chunk sizes, palette locations, descriptor tables

### How to annotate
Use `; ── ... ──` style comments for section headers, and `;` for inline notes:
```asm
; ── Portrait tile descriptor (32×24×6bpp sequential planar) ──
; Source = $60 + index×$240 (96 + index×576). Stride = $60/plane.
LAB_010C:
    DS.L    1               ; runtime source offset
    DC.L    $00600000        ; $60 = 96 (plane stride)
```

### Priority files
- `data/blackcrypt/amiga/BlackCrypt.asm` — main executable
- `data/blackcrypt/amiga/bcdfp.asm` — game logic overlay (blitter, BCSub, tile descriptors)
- `data/blackcrypt/amiga/bcdfq.asm` — rendering overlay (chunk readers, palettes)
- `data/blackcrypt/amiga/bcdft.asm` — data carrier overlay (7 hunks, no file I/O)
- `data/blackcrypt/amiga/bcdfu.asm` — RLE decompressor, sound, 4 palette variants

### bcdfa — BCSPEED Animation Archive
- 197,894 bytes, 887 RLE streams → 408,030 bytes decompressed
- **Stream 0** (18,932 bytes): Viewport mask — repeating `1FFFFFF8` pattern (32px bitmask shape for 3D dungeon viewport)
- **Stream 1** (18,184 bytes): Viewport mask — repeating `FFFFF000` pattern (alternate mask)
- **Stream 407** (17,190 bytes): **BCSPEED.GFK** — 16 sprite bitmap entries. Preamble (333 bytes) at stream start, then 16 × `BCSPEED\0GFK\0` (12 bytes) + type (2 bytes BE) + type×224 bytes of sprite data (32×14×4bpp sequential planar). Type = frame count (0x02–0x06). Entry 0 has 281 extra bytes after its data (possible4th frame or unrelated). 74 total frames. Extracted to `data/blackcrypt/extracted/bcspeed_gfk/`.
- **Streams 708-739**: **BCSPEED.PRG** — 283 animation keyframe entries across 30 streams. 7 distinct action types: 0x000b (walk N/S/E/W), 0x0010 (walk diag), 0x0009 (attack), 0x0013 (spell), 0x000d (damage), 0x0015 (die), 0x001f (idle). Each stream = one "actor" (monster). Streams 708-718 have 16-18 entries (full set), streams 719-724 have 14 entries, streams 725-737 taper to 1 entry (type 0x0015 = death). Entries contain 3-byte records: direction (0x40/0xFF), displacement (-3/+3), flags.
- "BCSPEED" is the game's **combat/movement animation system** for sprites, spells, and cursors. The name refers to animation speed/timing. **NOT an executable program** — GFK and PRG are data formats parsed by the game engine.
- **NEVER loaded by Open()** in any overlays — data accessed differently, possibly via bcdfv block loading or direct file read by bcdfu.

### Known conventions
- IRA disassembly: BCLR instructions at label data are raw bytes, not code
- DOS LVO offsets: Open=-30, Close=-36, Read=-42, Write=-48, Lock=-84, etc.
- A6 = library base (dos, exec, graphics), A5 = local data frame, A4 = overlay data
- BLTSIZE encoding: (height << 6) | width_in_words
- 6bpp EHB: colors 0-31 base, 32-63 half-bright (color >> 1)
- 12-bit Amiga RGB → 24-bit: each nibble × 17
- **Minterm $0FCA**: D = (A AND B) OR (NOT A AND C) — mask+color sprite blit
  - Channel A = transparency mask (1=pixel, 0=transparent), fixed per plane loop
  - Channel B = color data, advances by stride each plane
  - Channel C/D = screen (read/write), same pointer
- **Minterm $09F0**: D = C — straight screen-to-screen copy
- **Minterm $03CA**: D = B — opaque source-to-screen copy (no mask)
- **Minterm $00F0**: D = C — full word fill/copy
- **LAB_010D**: 28-byte descriptor table entries for UI elements (source offset, stride, BLTSIZE, modulo, flags, width, height)
- **LAB_010E**: Render UI element by descriptor index → LAB_011E
- **LAB_010F**: Render portrait by tile index → LAB_011E (uses LAB_010C as live descriptor)
- **LAB_011E**: Main sprite blitter with clipping (flag bit0=LAB_0124 path)
  - Minterm $0FCA: A=mask(fixed), B=color(stride), C/D=screen
  - 6 iterations (DBF D0,5) — one per color bitplane
- **LAB_0110**: Simple opaque screen blitter (2-pass: aligned words + edge pixels)
- **LAB_011B**: Screen-to-screen blit for scrolling
- **LAB_0124**: Alternate sprite blitter with screen-edge clipping

### bcdft — Data Carrier Overlay
- **7 hunks**: S_0 CODE (entry stub), S_1 BSS (166KB target), S_2 BSS (40KB target), S_3 BSS (1L), S_4 CODE (LZ77+relocation engine), S_5 DATA (85KB compressed), S_6 BSS (18KB read buffer)
- **S_0 entry**: chain resolver frees S_3/S_5/S_6, returns modified A1
- **S_4 engine**: LZ77 decompresses S_5 into S_1/S_2, then applies pointer relocation fixups
- **S_5 DATA**: 84,976 bytes custom LZ77-compressed game data (item names, game strings, quest text, data tables). **NOT** wall/floor textures — those come from bcdfx/y/z.
- **Decompression**: Achieved via **musashi 68k emulator** (see `tools/bcdft_decompress/`). The S_4 engine is run directly by emulating the 496 bytes of 68k code, avoiding hand-translation bugs.
  - Build: `cd tools/bcdft_decompress && bash build.sh run`
  - Output: 166,676 bytes, ~113KB non-zero, containing all item names, game strings, and data structures
  - Key finding: `POTION OF WATER BREATHING` at offset 118185, `CANNOT PLACE ITEM IN INVENTORY` at 120287
- **WHDLoad slave**: matches by hunk size $4c1ac, patches at $496ba/$496c2 (trainer)
- **bcdfb-bcdfn**: 13 dungeon level graphic stores (one per map, b=map1 through n=map13). Loaded via bcdfv as part of each level's data. Each file contains RLE-compressed sprite data for that map's monsters. Format: 12-byte header + 42 × 28-byte entries. Entries sharing data_off are **animation frames** of the same sprite. Frame heights distributed evenly across total height. 7-plane sequential bitplane (mask + 6bpp EHB). RLE decompression + frame splitting produces **495 animation frames** across all 13 files.

### bcdfx/bcdfy/bcdfz — Wall/Floor Texture Data
- 144KB / 118KB / 161KB. RLE-compressed (bcdfu LAB_0043 exact algorithm, 0x00 = end marker).
- **bcdfx**: 144,169 raw → 14,448 decompressed. bcdfz decompresses to same size but NOT identical bytes.
- **bcdfy**: 117,937 raw → ONLY 632 decompressed (probably a different format or palette data).
- Rendering at 32×516 @ 7bpp (mask + 6 color planes) gives 50 unique colors with strong vertical repetition (27/32 similar columns) — consistent with 3D wall texture strips.
- PALETTE: dungeon palette at bcdfq CODE+0x2C6 (= file offset 0x2EA): 32 brown/blue/grey base colors + 32 EHB half-bright = 64 colors total.
- **NOT loaded by Open() in WHDLoad** (unlike bcdfp/q/t/u). Possibly embedded in bcdfv Block 3 (RAW, 26KB at offset 0xB604) or accessed by raw offset.
- Tile candidates: 32×516 (vertical strips), 64×301, 64×258, 128×129 @ 6/7bpp — try viewing PNGs at `/tmp/bcdfx_*.png`.

### bcdfq — Intro + Music Only
- Contains intro/title screens (loaded from bcdfr) and OctaMED music engine
- **ZERO dungeon rendering code** — all 3D rendering is in bcdfp
- Contains TWO palettes at different file offsets:
  - **Monster palette** at file offset 0x2C6: red/orange/tan (ogre colors)
  - **Dungeon palette** at CODE+0x2C6 = file offset 0x2EA: brown/blue/grey (wall/floor colors)

### File Loading Summary
Only these files are ever loaded by name in the WHDLoad version:
| File | Loaded By | Contents |
|------|-----------|----------|
| bcdfp | BlackCrypt (LoadSeg) | Game logic, blitters, save/load |
| bcdfq | BlackCrypt (LoadSeg) | Intro screens, music engine |
| bcdft | BlackCrypt (LoadSeg) | LZ77-compressed text tables + item names (85KB) |
| bcdfu | BlackCrypt (LoadSeg) | RLE decompressor, sound engine |
| bcdfo | bcdfp (LAB_00AE) | 109 portraits + UI graphics (63KB) |
| bcdfs | bcdfp (LAB_0047) | Map data (all 13 maps, NOT a save file) |
| bcdfv | bcdfu (LAB_0033) | Sound + monster sprite data (192KB) |
| Configuration.Dat | BlackCrypt | Game config (8 bytes) |

bcdfb-bcdfn (b through n, 13 files) are **per-map monster sprite files** on floppy.
In the WHDLoad version, bcdfb-bcdfn filenames are NOT referenced — data comes from bcdfv.
bcdfx/bcdfy/bcdfz — wall/floor texture data, not loaded by Open() in WHDLoad.

### Monster Sprite Rendering Pipeline (bcdfp.asm)

The monster sprite rendering code is entirely within **inline raw data blocks** that IRA encoded as `DC.L` (failed to disassemble). There are **no labeled callers** of LAB_011E for monster sprites in the disassembly.

#### VBlank Handler LAB_00D3 (line 3100)
Drives the 3D viewport rendering pipeline. Dispatches through a jump table (lines 3104-3107) to rendering phases.

#### Direction Dispatch (lines 3156-3183)
For each player direction (0=N, 1=E, 2=S, 3=W), calls different viewport + monster rendering functions via `BSR.W`. Each direction target renders walls AND monsters for that viewing angle.

#### Sprite Descriptor Construction (inline, around line 3212-3213)
After LAB_00D8, the inline code:
- Loads sprite data pointer from `A5+$03CE`
- Loads sprite descriptor base from `A5+$03C2`
- Writes sprite dimensions to descriptor offset +2 (width) and +6 (height/BLTSIZE)
- Loads sprite data buffer base from `A5+$03C6` (bcdfv decompressed data)
- Skips 12 bytes of header (`LEA $000C(A1),A1`)
- Copies sprite data in a loop: `MOVE.W (A0)+,(A1)+` followed by `LEA $000C(A1),A1` — stride of 12 bytes ($0C) between plane words

#### Sprite Copy Loop (inline)
```
MOVEQ #7,D0            ; 8 iterations
loop: MOVE.W (A0)+,(A1)+
      LEA $000C(A1),A1  ; stride 12 between planes
      DBF D0,loop
```
Copies 8 words (16 bytes) from a lookup table into the sprite buffer, spacing them 12 bytes apart. This may be setting up a render descriptor, not the source sprite data itself.

#### Source Data Access Pattern (inline)
```
MOVEA.L $03C6(A5),A1   ; sprite data buffer base
LEA $000A(A1),A1       ; offset 10 bytes into sprite entry
```
Two different header offsets appear: `$000A` (10) and `$000C` (12). The purpose of each is unclear.

#### Sprite Blit Invocation (inline)
The inline code at line 3229 calls `BSR.W *+$886` — a function that eventually reaches LAB_011E or does an inline blit with the same $0FCA minterm setup.

#### Key A5 Offsets for Monster Sprite Rendering
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

### Text Rendering Blitter (bcdfp.asm LAB_0103, line 3646)
A separate blitter for rendering text characters:
- Plane stride: 256 bytes ($100)
- BLTSIZE: $0211 = height=8, width_words=17 (272 pixels/34 bytes per row)
- Screen modulo: 6 bytes
- 6 iterations (DBF D0,5)
- Font data loaded from 0(A5)+$A148

### bcdfv — Block Loading Structure

Confirmed by reading LAB_0033-LAB_003A in bcdfu.asm. File size = 191,917 bytes (0x2EDAD).
All bytes accounted for across Phase 1 (intro, overwritten) and Phase 2 (game data).

**Phase 1 (intro screens)** — data overwritten by Phase 2:
| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 61 | 1 | $4EB0 (20144) | RLE | buffer+0 → 32000B output |
| 68 | 5 | $5067 (20583) | RLE | $17700 → $BB80 → 48000B |
| 74 | 6 | $0B10 (2832) | RAW | $1A5E0 |
| 76 | 4 | $2500 (9472) | RLE | $EA60 → $BB80 |
| 72 | — | — | COPY | LAB_003D: $BB80 → buffer+0, 48000 bytes |

**9× LAB_0022 calls** (intro screens): total $14525 (83237) bytes

**Phase 2 (game data — final buffer state)**:
| Line | Block | Read Size | Type | Destination |
|------|-------|-----------|------|-------------|
| 131 | 2 | $6754 (26452) | RLE | $BB80 → buffer+0 (**40,000B output**) |
| 132 | 3 | $678C (26508) | RAW | $BB80 |
| 148 | 7 | $0A81 (2689) | RLE | $EA60 → $BB80 (**4,590B output**, overwrites Block 3 start) |

### bcdfb-bcdfn — Monster Sprite Format (CORRECT EXTRACTION)
13 files (b=map1, c=map2, ..., n=map13). RLE-compressed (bcdfu LAB_0043).
Each file has exactly **42 directory entries** with 12-byte header + 28-byte entries.
Entries sharing `data_off` are **animation frames** of the same sprite.
7-plane sequential planar decode (mask=plane0, color=plane1-6, EHB).
⚠ **Bit order: standard.** Plane 1 → bit 0 (LSB), plane 6 → bit 5 (EHB half-bright MSB).
The half-bright problem was the palette loading (`range(64)` vs `range(32)`), not the bit order.
546 animation frames extracted across all 13 files.

**⚠ CRITICAL: TWO different palettes in bcdfq — monsters vs dungeon!**
- **Monster sprites**: palette at FILE offset `0x2C6` (NOT CODE+0x2C6).
  Has RED, ORANGE, TAN — correct for ogres. Loading from `36+0x2C6` gives blue ogres.
- **Dungeon walls/floors**: palette at CODE+0x2C6 = file offset `36 + 0x2C6 = 0x2EA`.
  Has BROWN, BLUE, GREY — for the 3D dungeon view, not monsters.

Both palettes store only **32 base colors** (64 bytes). EHB half-bright entries 32-63
must be COMPUTED as `(r//2, g//2, b//2)` of colors 0-31.
Using `range(64)` reads past palette data → garbage half-bright colors.

**File structure:**
- **12-byte header**: 2 pad + 2 map_id + 2 extra_id + 2 extra_id2 + 4 pad
- **42 × 28-byte directory entries** (starting at byte 12)
- **RLE-compressed data** after the directory (bcdfu LAB_0043 algorithm)
- Directory data offsets index into **concatenated decompressed stream**

**Directory entry (28 bytes):**
| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| +0 | 4 | data_off | offset into concatenated decompressed data |
| +4 | 4 | bpr | bytes per plane = (width/8) × total_height |
| +8 | 4 | reserved | 0 |
| +12 | 2 | BLTSIZE | (height<<6) \| (width/16 + 1) |
| +14 | 2 | modulo | screen modulo |
| +16 | 4 | reserved | 0 |
| +20 | 2 | type | 0x0100/0x0500 (frame variant) |
| +22 | 2 | width | pixels |
| +24 | 2 | height | total rows (sum of all frame heights) |
| +26 | 2 | reserved | 0 |

**Animation frames:** Entries sharing data_off are frames of the same sprite.
Frame heights = base_h or base_h+1, where base_h = height // n_frames.
Frames are concatenated within each plane: frame0 rows, frame1 rows, etc.

**Data block layout (per sprite, 7-plane sequential):**
```
plane_0 = raw_data[0 : bpr]               ; mask (1-bit, 1=opaque)
plane_1 = raw_data[bpr : bpr*2]           ; color bit 0 (LSB)
plane_2 = raw_data[bpr*2 : bpr*3]         ; color bit 1
...
plane_6 = raw_data[bpr*6 : bpr*7]         ; color bit 5 (MSB/half-bright)
```

**Example frame splits (from bcdfb):**
| data_off | Width | Total H | Frames | Frame Heights | Description |
|----------|-------|---------|--------|---------------|-------------|
| 0 | 96 | 129 | 2 | 65, 64 | Two-frame monster animation |
| 10836 | 96 | 124 | 3 | 42, 41, 41 | Three-frame animation |
| 31836 | 64 | 79 | 3 | 27, 26, 26 | Three-frame small monster |
| 65394 | 32 | 32 | 8 | 4,4,4,4,4,4,4,4 | 8-frame tiny sprite |
| 66290 | 16 | 17 | 8 | 3,2,2,2,2,2,2,2 | 8-frame very small sprite |


### Character Record Layout (from WHDLoad trainer)
0xA8 (168) bytes per character, 4 chars:
- +$00: name
- +$4E: current HP (w)
- +$50: max HP (w)
- +$52: experience (l)
- +$56: gold (w)
- +$64..$68: current STR/INT/WIS/CON/CHR (b)
- +$6E..$72: max STR/INT/WIS/CON/CHR (b)
- +$A2: level/XP (w)
Base: $1758(A5), offsets: +0, +$A8, +$150, +$1F8

### RLE Algorithm (bcdfu.asm LAB_0043)
- ctrl byte 0x00 = end of stream
- bit0=1: literal copy (byte>>1) bytes from source
- bit0=0: fill next byte (byte>>1) times

### bcdfs — Map Data Format (220KB, all 13 maps)
**NOT a save file** despite being read by LAB_0047. Contains ALL map layouts.

Each of 13 maps has:
1. **52-byte global offset table** at file offset 0 (13 longwords, buffer-relative offsets). Maps 2-13 have 52 zero bytes (their tables are at the start of each map's section).
2. **Per-map header** (7 bytes): starts at file offset 52 for map 1; subsequent maps at absolute position `52 + offset_table[N]`. Header = `height 00 00 00 00 00 00`. For map 1, height = 30 lines.
3. **Variable-length line data** — grid is **256 columns wide** (not 64). Format per line:
   - **Per-line header (2 bytes)**: `col_start col_end` (each 0-255, e.g. `1F F2` = cols 31-242). Lines with `00 00` encode a **single transition cell** (col 0).
   - **Square records (4 bytes each)**: `0F F1 00 00`
     - nibble0: terrain flags (+1 wall, +2 dark, +4 spell_fail, +8 water; 0=floor/open)
     - nibble2-3: always `0F`
     - nibble3 nybble: 4 bits = level number (1-N per 256×N map)
     - nibble4: 4 bits = wall flags (+1 N / +2 E / +4 S / +8 W)
     - nibble5-6: 12 bits = unique number (0=empty, 1-FFF=item/monster/structure data follows)
4. **Line count per map**: maps 1-5 have 30 lines (rows 0-29), maps 6-7 have 24 lines, maps 8-13 have 22 lines, except map 13 which has only 1 line with cols 64-255 (a special transition row).
5. **3950+ bytes 0x00** — per-map scratch space for items dropped on floor
6. **Items/monsters/structures** — inserted between squares using unique numbers; stacking uses chained unique numbers

### Monster Entry (~40 bytes, referenced from bcdfs square unique number)
```
a aa 80 bb cc de F0 fg 0h ii jj jj 0k kk ll ll 00 0m 00 00 0n nn ...
```
- `bb`: **graphics file selector** (which bcdfX file provides the sprite)
- `cc`: chance-to-hit / XP variance
- `d`: door-pass flag (bit)
- `e`: attack speed (nibble)
- `f/g`: move speed (nibbles)
- `h`: attack method (nibble)
- `ii`: magic attack intensity
- `jjjj`: HP
- `kkk`: carry item number
- `llll`: spell set flags
- `m`: movement type
- `nnn`: stacking number
- `oooo`: XP gain
- `pppp`: attack strength
- `q`: position on square (0-4: NW/NE/SE/SW/center)

### Item Entry (~20 bytes, referenced from bcdfs square unique number)
```
a aa bb bb cc cc d e ff gg ...
```
- `bbbb`: gfx number (determines weapon properties)
- `cccc`: **name offset into bcdft** (decompressed data); 0 = first name at byte 115978
- `d`: position on square (nibble)
- `e`: who can use (bitmask: +1 Fighter, +2 Cleric, +4 Druid, +8 MU)
- `ff`: item type (defines trailing bytes)
- `gg`: position in container

### bcdfo Descriptor Table (bcdfp.asm LAB_010D)
28-byte entries:
- +0: word → pointer table index (base address)
- +2: long → source data offset (added to base)
- +6: long → stride per bitplane
- +10: long → alternate source offset (if flag bit1=1)
- +14: word → BLTSIZE = (h<<6)|<w/8
- +16: word → screen modulo
- +18: word → X position (runtime)
- +20: word → Y position (runtime)
- +22: word → flags (bit0=clipped path LAB_0124, bit1=alternate addr)
- +24: word → width pixels
- +26: word → height pixels

## Extracted Assets

All extraction scripts live in `scripts/`. Output goes to `data/blackcrypt/extracted/`.
Use greyscale by default unless the palette is confirmed correct by the user.
