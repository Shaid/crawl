# Eye of the Beholder 2: File Format Research

**Status:** Unverified — Internet research. Not cross-checked against real game files.

## ScummVM Support

Eye of the Beholder 2 is **fully supported by ScummVM** via the **KYRA engine**. The engine includes a dedicated EOB2 sub-engine with excellent compatibility.

**Supported platforms:**
- DOS (MS-DOS, including talkie version)
- Amiga (confirmed support for Amiga versions)
- FM-Towns version
- Sega-CD (Japanese version)

**Known limitations:**
- PC Speaker sound not supported
- Cannot load original EOB1 save files into EOB2

## Format Overview

The ScummVM KYRA engine uses a resource-loader architecture that unpacks PAK files and interprets game-specific binary formats. EOB2 file formats closely mirror EOB1, but with enhancements:

### Resource Container Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.PAK` | Westwood resource archive | Multiple PAK files per game; extracted by `extract_kyra` tool |
| `.DAT` | Binary data tables | Item definitions, game state, text |

**ScummVM Source Files:**
- `engines/kyra/detection_tables.h` — Game detection and version identification
- `engines/kyra/kyra_pak.cpp` / `engines/kyra/kyra_pak.h` — PAK file format handling and unpacking
- `engines/kyra/resource/*.cpp` — Resource loader implementations for various data types
- `engines/kyra/eobcommon.cpp` / `engines/kyra/eobcommon.h` — Shared EOB1/EOB2 data structures

### Dungeon / Level Formats

| Format | Purpose | Size Range |
|--------|---------|------------|
| `.MAZ` | Maze/dungeon grid layout | ~4.1 KB per level |
| `.INF` | Level configuration (monsters, items, decorations) | 2–5 KB |
| `.OUT` | Outdoor area definitions | Variable |
| `.DEC` | Decoration placement data | Variable |

**Level data structure (known from EOB1 spec):**
- 32×32 cell grid with 4 sides (N/E/S/W) per cell
- Wall type, decoration count, click events, passability flags per side
- Door state sequences, stair connections, pit/teleport destinations
- Event script bytecode

### Graphics / Tileset Formats

| Format | Purpose | Palette | Notes |
|--------|---------|---------|-------|
| `.VCN` | Wall tile data (View Cone tileset) | Embedded 32-color | Pre-rendered 8×8 pixel tiles for walls, doors, stairs |
| `.VMP` | Wall mapping table | — | 5,834 bytes; maps VCN tile indices to 22×15 viewport |
| `.CPS` | General image/sprite data | Embedded or standalone | 320×200 at 5 bitplanes; used for monsters, UI, cutscenes |
| `.PAL` | Standalone color palette | — | 64 bytes (32 colors × 16-bit big-endian); EOB2 wall sets have .PAL files |

**Palette files (Amiga, big-endian 16-bit 0xRGB format):**
- `AZURE.PAL`, `CRIMSON.PAL`, `DUNG.PAL`, `FOREST.PAL`, `MEZZ.PAL`, `SILVER.PAL` — Wall set palettes
- `FINALE.PAL` — 384 bytes (6 palettes)

**CPS compression:**
- Westwood's proprietary LCW (Format 80) compression; 5 command types (short literal, block copy, medium copy, fill, long copy)
- Uncompressed size: 40,000 or 40,064 bytes (with embedded palette)

### Item / Object Data

| Format | Purpose | Notes |
|--------|---------|-------|
| `ITEM.DAT` | Item instance definitions | Doubly-linked list; 15 bytes per entry + string table |
| `ITEMTYPE.DAT` | Item type templates | 57 types; class permissions, damage dice, AC modifiers |

**Item.DAT structure (per EOB1 spec, likely shared with EOB2):**
- Identified/unidentified name indices (UINT16LE)
- Bitflags (glow, identified, cursed, life-drain)
- Icon index, type, sub-position, x/y position, level, value
- Ends with null-terminated name string table

### Text / Dialogue Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `TEXT.DAT` | Game narrative and UI strings | Null-terminated strings in indexed lookup table |
| `.DIP` / `.ENG` / `.FRE` / `.GER` | Translation/localization strings | Language-specific dialogue and text (via lollibs) |

### Animation / Audio Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.SAM` | Audio samples (8-bit PCM) | Level-specific sounds: `LEVEL1.SAM` through `LEVEL16.SAM` |
| `.VOC` | Creative Voice file format | Supported by ScummVM kyra.dat |

### Other Resource Types

| Format | Purpose | Notes |
|--------|---------|-------|
| `.DCR` | Creature/decoration resources | Binary format; not fully reverse-engineered |
| `.FNT` | Westwood Font v2 format | UI text rendering |
| `.SAV` | Save game files | Game state serialization |

## File Format Details from ScummVM Source

### PAK File Structure (Westwood Archive)

ScummVM's `extract_kyra` tool unpacks `.PAK` files. The PAK format is a simple Westwood container with:
- **File index:** Filename → offset mapping
- **Data blocks:** Compressed or uncompressed resource data
- **Variable-length compression:** LCW, RLE, or LZW formats depending on resource type

**Extraction tool:** `scummvm-tools-cli --tool extract_kyra -x [-o outputdir] <infile>`

### Resource Loading Pipeline

ScummVM loads resources via:
1. PAK file unpacking (via `kyra_pak.cpp`)
2. Type-specific parsing (bitplanes, palettes, sound data, etc.)
3. In-memory caching of decoded resources

The kyra.dat file contains hardcoded lookup tables (room definitions, inventory names, default shape tables) needed by the engine at runtime.

## Community Resources

### Fan Tools and Documentation

**Eye of the Beholder 2 Extractors (GitHub):**
- [iliak/eye-of-the-beholder-2](https://github.com/iliak/eye-of-the-beholder-2) — Python extraction tools for EOB2 file formats
- [iliak/EOB2-Extractor](https://github.com/iliak/EOB2-Extractor) — Resource parser for EOB2 data files
- [martinFrank/eob-edit](https://github.com/martinFrank/eob-edit) — Save game editor for EOB

**ModdingWiki (Shikadi):**
- [Eye of the Beholder](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder) — Comprehensive format documentation
  - Covers: PAK, ADL, CPS, Palette, item.dat, itemtype.dat, text.dat, DEC, FNT, INF, MAZ, SAV, VCN, VMP formats
  - Status: "Levels, tiles, and sprites" are documented; "sound, music, text, story, UI/menus" less complete

**ScummVM Source Repository:**
- [scummvm/scummvm/engines/kyra/](https://github.com/scummvm/scummvm/tree/master/engines/kyra) — Complete source for KYRA engine
- [scummvm/scummvm-tools](https://github.com/scummvm/scummvm-tools) — Extract/compress tools with source code documentation

## Amiga-Specific Notes

The EOB1 Amiga spec in `docs/eotb/amiga/data-structure.md` documents:
- CPS format: 320×200 at 5 bitplanes (Amiga planar format)
- VCN palettes: 24-bit RGB at offset 0x40 (96 bytes, 32 colors)
- VMP structure: Amiga-specific tile mapping

**EOB2 Amiga likely shares these formats**, but may include enhancements:
- Standalone `.PAL` files (instead of embedded in VCN)
- `.OUT` and `.DEC` files for outdoor/decoration rendering
- `.DCR` creature resource files
- Language-specific `.DIP` files for localization

The exact Amiga-specific encoding for EOB2 is not yet documented; treat Amiga file structures as "inferred from EOB1" unless cross-checked.

## Research Confidence Notes

- **PAK / KYRA engine:** Documented in ScummVM source; extraction tools publicly available.
- **EOB1 VCN/VMP/MAZ/INF/DAT formats:** Verified in `docs/eotb/amiga/data-structure.md` against real Amiga files.
- **EOB2 format parity:** Assumed high but **unverified** — EOB2 likely reuses EOB1 structures with minor extensions (OUT, DEC, DCR files).
- **Amiga-specific encoding:** Inferred from EOB1; not cross-checked against EOB2 Amiga real files.
- **Text/dialogue formats:** DIP/ENG/FRE/GER formats mentioned by lollibs; not verified against EOB2 files.

## What a Future RE Session Should Check First

1. **Compare EOB2 Amiga vs. DOS file structures:**
   - Are MAZ, VCN, VMP, INF formats identical or extended?
   - Do standalone `.PAL` files differ from VCN-embedded palettes?

2. **Reverse-engineer `.DCR` and `.OUT` formats:**
   - Start with `extract_kyra` output; examine binary structure in hex editor or radare2
   - Compare against ScummVM's dcr/out parsing code (if it exists)

3. **Verify EOB2-specific extensions:**
   - Check which file types are unique to EOB2 (`.OUT`, `.DEC`, `.DCR`, `.SAM`)
   - Trace ScummVM source for how these are loaded vs. EOB1

4. **Cross-reference Amiga encoding with DOS:**
   - Decode actual Amiga CPS files (`data/eotb2/amiga/data/*.CPS`)
   - Confirm bitplane layout, palette encoding, compression matches EOB1 spec

5. **Use ScummVM source as oracle:**
   - `engines/kyra/eobcommon.cpp` and `engines/kyra/items_eob.cpp` contain definitive parsing logic
   - Grep for struct definitions and comparison logic to infer format requirements
