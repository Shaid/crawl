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
- **bcdfb-bcdfn** (monster sprites): 12B header + 28B directory entries + 7-plane sequential bitplanes. Format validated (offsets, bpr, dimensions all self-consistent). Rendering produces noise. Palette confirmed correct. Shape match with PC demo ~70% at best.
- **bcdfa** (item tiles): RLE + sequential planar 6bpp. Both 64×24 (280 tiles) and 32×24 (599 tiles) produce unrecognizable output.
- **bcdfv** (sound + sprite container): RLE block extraction + sequential 6bpp gives ~69% shape match with PC demo Two Head (64×96, 17 frames). Best result: seq_64x96 F14 at 68.9% with plane order reversed, MSB-first, shift=6. Word-interleaved decode produces same shape match (~65%). Not close enough to identify correctly.
- **bcdft** (LZ77 compressed data): Custom backwards-reading LZ77 with 8-byte FIFO and embedded tables. Multiple implementation attempts failed.

### Extraction Paths Tried

| Format | Approach | Result | Notes |
|--------|----------|--------|-------|
| bcdfb | 7-plane seq planar at directory offsets | Noise | 25-56% opaque pixels, structure wrong |
| bcdfb | RLE streams as 6bpp at var sizes | Noise | Stream sizes don't divide cleanly |
| bcdfa | 64×24 tiles, 6bpp, RLE streams | 280 tiles, unrecognizable | |
| bcdfa | 32×24 tiles, 6bpp, RLE streams | 599 tiles, unrecognizable | |
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
- **7 hunks**: S_0 CODE (entry stub), S_1 BSS (166KB target), S_2 BSS (40KB target), S_3 BSS (1L), S_4 CODE (LZ77 engine), S_5 DATA (85KB compressed), S_6 BSS (18KB read buffer)
- **S_0 entry**: chain resolver frees S_3/S_5/S_6, returns modified A1
- **S_4 engine**: LZ77 decompresses S_5 into S_1/S_2, then applies pointer relocation fixups
- **S_5 DATA**: 84,976 bytes LZ77-compressed dungeon data (walls, floors, monster sprites)
- **WHDLoad slave**: matches by hunk size $4c1ac, patches at $496ba/$496c2 (trainer)
- **bcdfb-bcdfn (~750KB on floppy)**: NEVER referenced by name in any code. They are the UNCOMPRESSED originals — the runtime uses bcdft's compressed data only. The WHDLoad/cracked version we analyze uses bcdft exclusively.

### bcdfq — Intro + Music Only
- Contains intro/title screens (loaded from bcdfr) and OctaMED music engine
- **ZERO dungeon rendering code** — all 3D rendering is in bcdfp

### File Loading Summary
Only these files are ever loaded by name in the WHDLoad version:
| File | Loaded By | Contents |
|------|-----------|----------|
| bcdfp | BlackCrypt (LoadSeg) | Game logic, blitters, save/load |
| bcdfq | BlackCrypt (LoadSeg) | Intro screens, music engine |
| bcdft | BlackCrypt (LoadSeg) | LZ77-compressed wall/floor textures + text tables (85KB) |
| bcdfu | BlackCrypt (LoadSeg) | RLE decompressor, sound engine |
| bcdfo | bcdfp (LAB_00AE) | 109 portraits + UI graphics (63KB) |
| bcdfs | bcdfp (LAB_0047) | Map data (all 13 maps, NOT a save file) |
| bcdfv | bcdfu (LAB_0033) | Sound + monster sprite data (192KB) |
| Configuration.Dat | BlackCrypt | Game config (8 bytes) |

bcdfb-bcdfn (b through n, 13 files) are **per-map monster sprite files** on floppy.
In the WHDLoad version, bcdfb-bcdfn filenames are NOT referenced — data comes from bcdfv.
bcdfx/bcdfy/bcdfz — purpose unknown, never loaded.

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

Confirmed by reading LAB_0033-LAB_003A in bcdfu.asm:

| Block | File Offset | Read Size | Type | Output | Buffer Target |
|-------|-------------|-----------|------|--------|---------------|
| 1 | $00000 | $4EB0 (20144) | RLE | 32000 bytes | 12(A5)+0 |
| 2 | $04EB0 | $6754 (26452) | RLE | 48000 bytes | 12(A5)+32000 |
| 3 | $0B604 | $678C (26508) | RAW | 26508 bytes | 12(A5)+$BB80 |
| 4 | $11D90 | ??? | RLE | ??? | 12(A5)+$17700 |
| 5 | ??? | $5067 | RLE | ??? | APPEND to sprite |
| 6 | ??? | $0B10 | RAW | ??? | buffer |

Blocks 1+2 combine to 80000 bytes of decompressed sprite data at 12(A5)+0.
Block 1 RLE stream exactly fills $4EB0 bytes and decompresses to exactly 32000 bytes (end marker at last byte).
Block 3 reads raw data (not RLE) into a separate buffer area at 12(A5)+$BB80.

### bcdfb-bcdfn — Monster Sprite Format
13 files, one per map (b=map1, c=map2, ..., n=map13). Contains raw (NOT RLE)
7-plane sequential bitplane sprite data (mask + 6bpp EHB color), prefixed by
metadata/copper data.

**File structure:**
- **12-byte header**: 2 pad + 2 type ID + 2 col/row + 6 pad
- **28-byte directory entries** (starting at byte 12): data_offset, bpr, reserved,
  bltsize, modulo, reserved, type, width, height, reserved
- **Sprite data blocks** at file offsets listed in directory entries
- Data blocks are **7 sequential planes**: plane 0 = transparency mask, planes 1-6 = 6bpp EHB color

**Directory entry fields:**
| Offset | Size | Field |
|--------|------|-------|
| +0 | 4 | data offset (file or decompressed buffer) |
| +4 | 4 | bpr = bytes per row = width/8 × height |
| +8 | 4 | reserved (0) |
| +12 | 2 | BLTSIZE = (h<<6) \| (width/16 + 1) |
| +14 | 2 | screen modulo |
| +16 | 4 | reserved (0) |
| +20 | 2 | type: 0x0100 = normal, 0x0500 = alternate |
| +22 | 2 | width (pixels) |
| +24 | 2 | height (rows) |
| +26 | 2 | reserved (0) |

**Data block layout:**
```
plane_0 = raw_data[0 : bpr]               ; mask (1-bit, 1=opaque)
plane_1 = raw_data[bpr : bpr*2]           ; color bit 0
plane_2 = raw_data[bpr*2 : bpr*3]         ; color bit 1
...
plane_6 = raw_data[bpr*6 : bpr*7]         ; color bit 5
```

**Verified sprite dimensions (from bcdfb):**
| Entry | Width | Height | Data Offset | Type | Opaque % |
|-------|-------|--------|-------------|------|----------|
| 0-1 | 96 | 124 | 10836 | 0x0100 | 24.8% |
| 2 | 96 | 126 | 21252 | 0x0100 | 30.0% |
| 3 | 96 | 124 | 10836 | 0x0500 | 24.8% |
| 4-5 | 64 | 79 | 31836 | 0x0100 | 43.9% |
| 6 | 64 | 81 | 36260 | 0x0100 | 49.7% |
| 7 | 64 | 79 | 31836 | 0x0500 | 43.9% |
| 8-9 | 48 | 52 | 40796 | 0x0100 | 56.5% |
| 10 | 48 | 53 | 42980 | 0x0100 | 39.3% |
| 11 | 48 | 52 | 40796 | 0x0500 | 56.5% |
| 12+ | 64 | 55 | 56154 | 0x0100 | 47.5% |

Entries beyond the file size reference data in the decompressed copper list buffer.


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
1. **52-byte offset table** — 13 longwords (offsets to each map), but only first map's table is filled; maps 2-13 = 52 bytes of 0x00
2. **Variable-length map data** — up to 64×64 squares. Format per line:
   - 2 bytes: vertical bounds (first_line, last_line), once at start
   - Per line: 2 bytes (left_square, right_square), followed by N square records
3. **Square (4 bytes)**: `0F F1 00 00`
   - nibble0: floor(+0)/wall(+1)/dark(+2)/spell_fail(+4)/water(+8) flags
   - nibble2-3: always `0F`
   - nibble3 nybble: 4 bits = level number (1-N per 64×64 map)
   - nibble4: 4 bits = wall flags (+1 N / +2 E / +4 S / +8 W)
   - nibble5-6: 12 bits = unique number (0=empty, 1-FFF=item/monster/structure data follows)
4. **3950 bytes 0x00** — per-map scratch space for items dropped on floor
5. **Items/monsters/structures** — inserted between squares using unique numbers; stacking uses chained unique numbers

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
