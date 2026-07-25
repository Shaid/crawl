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
- **bcdfa**: RLE icon/item tile set — **477 RLE streams → 280 tiles × 64×24×6bpp**
  sequential planar. Contains character faces, automap icons, item icons (necklaces,
  amulets). Rendered correctly with EHB palette and bit-7-left-most planar decoding.
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

- **bcdfb–bcdfn**: Structured image files — 13 files with 12-byte BE headers and
  directory records, containing 32px-wide 6bpp planar strips at varying heights.
  Directory format not yet fully parsed (heuristic extraction produced false positives).
- **bcdfr**: 4 full-screen images with per-screen BPP, sized by bcdfq chunk readers:
  Raven logo (4bpp, 320×200, 32KB), Title screen (6bpp, 320×200, 48KB),
  BC logo banner (6bpp, 320×44, 10,560B), Plot text (6bpp, 320×200, 48KB).
  Sequential planar, per-screen BPP, confirmed clean — no ghosting.
- **bcdfw**: Workbench drawer icon (457 B, `0xE3100001`).
- **configuration.dat**: 8 bytes — `MLONF_` + `0x0100`.

#### Undecoded

- **bcdfb–bcdfn directory format**: Proper directory record parsing needed — heuristic
  approach found too many false positives. Records appear to use 28-byte entries.
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

### Key Discovery: bcdfa RLE Icon Tiles (confirmed)

bcdfa contains **477 individually RLE-compressed streams** (same algorithm, `0x00` terminators).
36 streams ≥1,152 B produce **280 tiles × 64×24×6bpp** sequential planar. Content confirmed:
character/monster faces, automap mini-icons, item icons (necklaces, amulets). Rendered
correctly with EHB palette.

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
4. **What do the bcdfb–bcdfn image strips represent?** They contain 32px-wide
   pre-rendered wall views at varying heights — likely composed at runtime into
   the dungeon viewport. Directory format needs proper parsing. 

---

## Plan Going Forward

### Phase 1: Visual Identification of Payloads (COMPLETE)

**Goal:** Determine what each RLE payload in bcdfx/bcdfz contains.

**Results:**
- P2 confirmed as 208×356 @ 6bpp floor/ceiling atlas ✓
- P4/P5 confirmed as 80×193 @ 6bpp wall side textures ✓
- P3 confirmed as 320×269 viewport mask ✓
- P0 identified as depth shading lookup table ✓
- bcdfa confirmed as 280 tiles × 64×24×6bpp RLE icon set ✓
- P1 remains partially unidentified (background/fill data)
- P6 (bcdfx only) is all 0xFF fill
- P7/P8/P9 (bcdfx only) are small data blocks

All 751 DOS VGA images extracted from clipper.clp. EHB palette rendering confirmed
correct for bcdfo portraits and bcdfa icon tiles.

### Phase 2: Data Format Analysis (In Progress)

**Goal:** Understand the internal structure of each payload and post-payload data.

1. **Analyze P0 depth shading table** — 32-byte progressive mask header.
2. **Analyze P1 background data** — 42,754 bytes, 256 unique values.
3. **Analyze bcdfb–bcdfn directory format** — parse 12B BE header + directory
   records to extract 32px-wide image strips.
4. **Find front-facing wall tiles** — the 32×24 tiles used by the blitter must be
   in bcdfq's appended data or bcdfr. Trace bcdfq chunk readers.

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
