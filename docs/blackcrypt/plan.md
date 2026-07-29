# Black Crypt — Reverse Engineering Plan

## Current Status

### What We Know

Black Crypt (1992, Attention to Detail / Psygnosis) is a first-person dungeon
crawler for Amiga (EHB, 64 colors) and DOS (VGA, 256 colors). The Amiga version
spans 3 floppy disks with 26 `bcdf*` data files, 4 executable overlays, and a
main executable.

#### Fully Decoded

- **bcdfs**: Dungeon map format — 13 maps with interleaved entity data (items,
  monsters, structures, actions). Cross-validated against DOS `maindung.gam`.
- **bcdfa**: RLE-compressed container/archive — **887 RLE streams** (408,030 bytes
  decompressed, 2.06:1 ratio). Contains **BCSPEED** sprite animation system:
  - **Stream 407**: 16 **BCSPEED.GFK** sprite graphics (32×14 @ 4bpp, multi-frame) —
    cursors, targeting reticles, UI indicators
  - **Streams 708-739**: 283 **BCSPEED.PRG** animation keyframe entries across 30 streams,
    with 7 distinct action types (0x09, 0x0b, 0x0d, 0x10, 0x13, 0x15, 0x1f)
  - **Streams 0–1**: Viewport masks for 3D dungeon rendering (18-19KB each,
    repeating bit patterns `1FFFFFF8` and `FFFFF000`)
  - Streams 708-718: 16-18 entries each (full animation set per actor/monster)
  - Streams 719-724: 14 entries each (reduced set)
  - Streams 725-737: taper to 1 entry (type 0x15 only — death animation?)
  - Each stream = one "actor" (monster) with animation sequences
  - **NOT item tile data** — the old 64×24 extraction assumption was wrong
- **bcdfx/bcdfy/bcdfz**: RLE multi-payload data files. **bcdfx**: 10 payloads
  (P0–P9). **bcdfz**: 6 payloads (P0–P5). **bcdfy**: 4 sparse payloads (P0–P3).
  Confirmed dimensions: P2 = 208×356×6bpp floor/ceiling atlas, P4/P5 = 80×193×6bpp
  wall sides, P3 = 320×269 viewport mask, P0 = depth shading table. All rendered
  and confirmed.
- **bcdfo**: UI/chrome graphics — face tiles, blit descriptors.
- **bcdfq**: Overlay with 81.7 KB CHIP data — embedded MMD0 music, 8SVX sounds,
  palette variants, game text.
- **bcdfu**: Overlay — 3 MMD0 modules, 8SVX sound effects, 4 palette variants,
  and the **RLE decompressor** at LAB_0043.
- **bcdfv**: RLE-compressed screen data — decompresses to exactly 32,000 bytes
  (4bpp, 320×200).
- **clipper.clp** (DOS): Resource archive — 816 entries (751 images, 7 palettes,
  22 sounds). Format fully decoded.
- **maindung.gam** (DOS): Dungeon data — identical structure to Amiga `bcdfs`,
  differing only in endianness.

- **bcdfb–bcdfn**: Monster sprite files — 13 files with 12-byte BE headers and
  28-byte directory entries (exactly **42 entries** per file, verified across all 13).
  Files are RLE-compressed (bcdfu LAB_0043); data offsets point into the **concatenated
  decompressed stream**, not the raw file. 7 sequential bitplanes per sprite (plane 0 =
  mask, planes 1–6 = 6bpp EHB color). RLE decompression + 42-entry directory produces
  **204 sprites** across 13 files, but **bitplane alignment is still wrong** — sprites
  appear vertically scrambled. Likely the same bitplane offset issue as title screens.
  Loaded via bcdfv as part of each level's data (NOT floppy-only). `scripts/extract_bcdfb_bcdfn.py`
  outputs `*_ehb.png` via `data/blackcrypt/extracted/monsters_corrected/`.
- **bcdfr**: 4 full-screen images with per-screen BPP, sized by bcdfq chunk readers:
  Raven logo (4bpp, 320×200, 32KB), Title screen (6bpp, 320×200, 48KB),
  BC logo banner (6bpp, 320×44, 10,560B), Plot text (6bpp, 320×200, 48KB).
  Sequential planar, per-screen BPP, confirmed clean — no ghosting.
- **bcdfw**: Workbench drawer icon (457 B, `0xE3100001`).
- **configuration.dat**: 8 bytes — `MLONF_` + `0x0100`.

#### Undecoded

- **bcdfq appended data**: 81,908 B of chunked data after HUNK code — contains tile
  and texture resources loaded via self-reading mechanism.
- **P1 (42,754 B)**: Background/fill data — not a standard image dimension at any
  bpp. Contains 256 unique byte values.

### Key Discovery: RLE Decompression

Found in `bcdfu.asm` at LAB_0043 (line 643). Shared across bcdfv, bcdfx, bcdfy,
bcdfz.

```
Control byte:
  0x00      → end of stream
  bit0 = 1  → literal copy: copy (byte >> 1) bytes
  bit0 = 0  → RLE fill: repeat next byte (byte >> 1) times
```

Max 127 bytes per command. Stream-oriented, no block boundaries.

### Key Discovery: bcdfa RLE Decompression (container format identified)

bcdfa contains **887 individually RLE-compressed streams** (same algorithm, `0x00` terminators).
Total decompressed: 408,030 bytes (2.06:1 ratio). **NOT simple sequential tiles** — the
file is a container/archive. Streams 407+ contain "BCSPEED.GFK" and "BCSPEED.PRG" filename
markers at regular intervals (~1134 bytes), suggesting a sub-archive structure. Streams 0–1
(~19KB each) may contain tile atlas data. Existing 64×24 tile extraction produces
unrecognizable output — format needs further reverse-engineering.

### Key Discovery: Multi-Payload Structure

bcdfx and bcdfz contain multiple sequential RLE payloads with **identical
decompressed sizes** — confirming the same data structure. bcdfx has 10 payloads,
bcdfz has 6, bcdfy has 4 (all zeros).

#### Identified Payloads (bcdfx numbering)

| Payload | Decomp Size | Content | Status |
|---------|-------------|---------|--------|
| P0 | 14,448 B | **Depth shading lookup table** — 32-byte progressive mask (5→7→10→12→15→16 leading ones) + data. Identical header in bcdfx/bcdfz, different body. | Identified |
| P1 | 42,754 B | **Background/fill data** — first 32 bytes all 0xFF (bcdfx) or gradient (bcdfz), rest varies. 256 unique byte values. Not standard image data. | Partial |
| P2 | 55,536 B | **Floor/ceiling texture atlas** — 208×356 @ 6bpp. Confirmed (greyscale correct, EHB palette may be wrong for this data) | **Confirmed** |
| P3 | 10,780 B | **Viewport mask** — 320×269 binary (transparent regions for doors/openings) | **Confirmed** |
| P4 | 11,580 B | **Left wall side textures** — 80×193 @ 6bpp. Rendered. | Rendered |
| P5 | 11,580 B | **Right wall side textures** — 80×193 @ 6bpp. Rendered. | Rendered |
| P6 | 12,460 B | bcdfx only — all 0xFF fill in bcdfx, not present in bcdfz. | Partial |
| P7 | 54 B | bcdfx only — small data block. | Unknown |
| P8 | 1,523 B | bcdfx only — small data block. | Unknown |
| P9 | 5,393 B | bcdfx only — all 0x72 fill. | Partial |

#### Remaining Data (post-payload)

- **bcdfx** (31,867 B): 125 × `00100800` copper MOVE pairs to COLOR00, plus
  `18ff05f7` patterns. Likely copper list or display configuration data.
- **bcdfz** (51,274 B): No copper pairs. Contains ramp patterns
  (`ffffffe0`, `07ffffff`, `fffffff0`). Different data structure.
- **bcdfy** (116,818 B): 102 × `00100800` copper MOVE pairs. Mostly ramp
  patterns with `fff00fff` repeating. Template/placeholder data.

### Disk Layout (Confirmed)

| Disk 1 (GAMEDISK1:) | Disk 2 (GAMEDISK2:) | Disk 3 (GAMEDISK3:) |
|----------------------|----------------------|----------------------|
| bcdfa, bcdfo | bcdfb, bcdfc, bcdfd | bcdff, bcdfg, bcdfh |
| bcdfp, bcdfq | bcdfe, bcdfm, bcdfn | bcdfi, bcdfj, bcdfk |
| bcdfr, bcdfs, bcdft | bcdfu, bcdfv, bcdfx | bcdfl, bcdfy, bcdfz |
| bcdfw (icon) | — | — |

### Open Questions

1. **What is P0's exact purpose?** The 32-byte progressive mask header suggests
   depth-based shading. Needs code tracing.
2. **What is P1's role?** 42,754 bytes, 256 unique values. May be color ramp or
   palette mapping.
3. **Where are the front-facing wall tiles?** The blitter uses 32×24 tiles from a
   CHIP buffer loaded by bcdfp, but bcdfa contains 64×24 icons, bcdfo has 32×24
   portraits, and bcdfx P2 is a 208×356 texture atlas. The actual 32×24 dungeon
   wall tiles may be in bcdfq's appended data or bcdfr.
4. **How are bcdfb–bcdfn loaded at runtime?** They are the 13 dungeon level graphic stores, loaded via bcdfv as part of each level's data. Each file contains RLE-compressed sprite data for that map's monsters. Directory format decoded: 12-byte header + 42 × 28-byte entries. RLE decompression produces 204 sprites, but **bitplane alignment is still wrong** (vertically scrambled). Same issue as title screens.
5. **What do the +0C/+0E fields in monster directory entries represent?** +0C = BLTSIZE = (height << 6) | (width/16 + 1). +0E = screen modulo. Both confirmed correct. The BLTSIZE width field encodes width in words, not pixels.
6. **What are the 7 BCSPEED PRG action types (0x09, 0x0b, 0x0d, 0x10, 0x13, 0x15, 0x1f)?** Likely: 0x0b = walk N/S/E/W, 0x10 = walk diagonals, 0x09 = attack, 0x13 = cast spell, 0x0d = take damage, 0x15 = die, 0x1f = idle/stand. Needs code tracing in bcdfp to confirm.
7. **What do streams 0-1 in bcdfa contain?** Repeating bit patterns: stream 0 = `1FFFFFF8` (32px viewport mask), stream 1 = `FFFFF000` (alternate mask). Likely viewport shape masks for the 3D dungeon rendering.

---

## Plan Going Forward

### Phase 1: Visual Identification of Payloads (COMPLETE)

**Goal:** Determine what each RLE payload in bcdfx/bcdfz contains.

**Results:**
- P2 confirmed as 208×356 @ 6bpp floor/ceiling atlas ✓
- P4/P5 confirmed as 80×193 @ 6bpp wall side textures ✓
- P3 confirmed as 320×269 viewport mask ✓
- P0 identified as depth shading lookup table ✓
- bcdfa confirmed as BCSPEED sprite animation archive ✓ (NOT item tiles)
- P1 remains partially unidentified (background/fill data)
- P6 (bcdfx only) is all 0xFF fill
- P7/P8/P9 (bcdfx only) are small data blocks

All 751 Windows VGA images extracted from clipper.clp. EHB palette rendering confirmed
correct for bcdfo portraits and bcdfa icon tiles.

### Phase 2: Data Format Analysis (Mostly Complete)

**Goal:** Understand the internal structure of each payload and post-payload data.

**Completed:**
- P2 confirmed as 208×356 @ 6bpp floor/ceiling atlas ✓
- P4/P5 confirmed as 80×193 @ 6bpp wall side textures ✓
- P3 confirmed as 320×269 viewport mask ✓
- P0 identified as depth shading lookup table ✓
- bcdfa confirmed as BCSPEED sprite animation archive ✓ (NOT item tiles)
- bcdfr confirmed as 4 mixed-BPP screens (chunk reader sizes) ✓
- bcdfo confirmed: 109 portraits + UI elements at descriptor offsets ✓
- Palettes mapped: 3 in bcdfq (title 16-color, title 32-color, dungeon 32-color) ✓

**Remaining:**
- P1: 42,754 bytes, 256 unique values — may be color ramp or palette mapping
- bcdfb–bcdfn bitplane alignment fix (same issue as title screens)
- Front-facing wall tiles — must be in bcdfq appended data or bcdfr chunks
- Item sprites (dungeon floor) — in bcdft S_5 LZ77-compressed data, blocked by decompression
- bcdft S_5 LZ77 decompression — multiple attempts failed, needs fresh approach
- bcdfa BCSPEED GFK sprite rendering → proper extraction script needed

### Phase 3: Overlay Disassembly (In Progress)

**Goal:** Trace remaining data loading paths and rendering pipeline.

1. **Trace bcdfq chunk readers** — size tables at LAB_0026 (8×4000 B),
   LAB_002A (12×4000 B), LAB_002E (4×2640 B), LAB_002F (48,000 B).
   Determine what data each chunk contains.

2. **Identify standalone file loading** — Find the code that opens bcdfx/bcdfz
   by constructing the filename at runtime (likely via LAB_002C device name
   builder + a character index). Trace the RLE decompression calls and buffer
   allocation.

3. **Identify buffer allocation** — find the sizes of buffers used to hold
   decompressed payloads. This will confirm the expected decompressed sizes
   and data format.

### Phase 4: Cross-Platform Validation (Low Priority)

**Goal:** Verify Amiga/DOS data equivalence.

1. **Map DOS clipper.clp entries to Amiga files** — identify which bcdf* files
   correspond to which clipper.clp entries.

2. **Compare image dimensions and content** — validate that the same game
   resources are stored in both versions.

---

## Files Reference

### Amiga
- `data/blackcrypt/amiga/bcdfx` — 144,169 B, RLE multi-payload (GAMEDISK2)
- `data/blackcrypt/amiga/bcdfy` — 117,937 B, RLE multi-payload (GAMEDISK3)
- `data/blackcrypt/amiga/bcdfz` — 160,806 B, RLE multi-payload (GAMEDISK3)
- `data/blackcrypt/amiga/bcdfv` — 191,917 B, RLE-compressed screen (GAMEDISK2)
- `data/blackcrypt/amiga/bcdfu.asm` — RLE decompressor at LAB_0043 (line 643)
- `data/blackcrypt/amiga/adf/` — 3 ADF disk images (901,120 B each)

### DOS
- `data/blackcrypt/dosvga/clipper.clp` — 1,151,267 B, resource archive
- `data/blackcrypt/dosvga/crypt.exe` — 253,952 B, PE32 executable
- `data/blackcrypt/dosvga/maindung.gam` — 15,099 B, dungeon data

### Documentation
- `docs/blackcrypt/amiga/data-structure.md` — Amiga format specification
- `docs/blackcrypt/dos/data-structure.md` — DOS format specification
- `docs/blackcrypt/plan.md` — This file
