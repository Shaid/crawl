# Lands of Lore: The Throne of Chaos — File Format Research

**Status:** Unverified — Internet research. Not cross-checked against real game files.

## ScummVM Support

Lands of Lore (1993) is **fully supported by ScummVM** via the **KYRA engine**. The game uses the same Westwood resource architecture as the Kyrandia series.

**Supported platforms:**
- DOS (primary version; supported since early ScummVM versions)
- CD-ROM versions (multiple language variants: ENG, FRE, GER)
- GOG.com version (known compatibility; may require file setup)

**Compatibility:** No known critical issues in recent ScummVM versions (2.7.0+).

## Format Overview

Lands of Lore uses Westwood's Kyra engine resource system but with a different game loop and 3D dungeon rendering pipeline. The architecture shares PAK containers and compression formats with EOB1/2 but introduces new tileset formats (CMZ, WLL, VMP, VCN).

### Level Rendering Pipeline

The reverse-engineered community documentation establishes this data flow for rendering:

```
CMZ (compressed level) → WLL (wall definitions) → VMP (viewport mapping) → VCN (palette/tileset)
```

This is distinct from EOB's direct VMP→VCN mapping.

### Resource Container Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.PAK` | Westwood resource archive | Language-specific: `ENG/*.PAK`, `FRE/*.PAK`, `GER/*.PAK` |
| `.TLK` | Dialogue/text container | Separate from PAK; stores game dialogue strings |
| `.FDT` | File data index | Maps filenames to PAK offsets (optional/metadata) |

**ScummVM Source Files:**
- `engines/kyra/detection_tables.h` — Game detection for LOL variants
- `engines/kyra/kyra_pak.cpp` / `kyra_pak.h` — PAK unpacking (shared with EOB)
- `engines/kyra/script/script_lol.cpp` — LoL-specific script interpreter
- `engines/kyra/resource/*_lol.cpp` — LOL-specific resource loaders

### Level / Dungeon Formats

| Format | Purpose | Size Range | Notes |
|--------|---------|------------|-------|
| `.CMZ` | Compressed level data | Variable | Level layout, dungeon structure |
| `.WLL` | Wall definitions | Variable | Wall type table; used with CMZ |
| `.MAP` | Level map data (alternate?) | Variable | Possibly alternative to CMZ/WLL |

**Level data structure (inferred from LoL reverse engineering):**
- Compressed dungeon grid (CMZ format)
- Wall type lookups (WLL format)
- Tile references to VCN/VMP tileset
- Decorator/object placement tables
- Script bytecode references

### Graphics / Tileset Formats

| Format | Purpose | Palette | Notes |
|--------|---------|---------|-------|
| `.VCN` | Viewport tileset data | Embedded 256-color? | Pre-rendered tile graphics for dungeon rendering |
| `.VMP` | Viewport mapping table | — | Maps VCN tiles to viewport positions (different structure from EOB) |
| `.CPS` | Full-screen images (UI, backgrounds) | Embedded or standalone | 320×200; used for menus, cutscenes |
| `.SHP` | Sprite/shape format (Westwood) | Palette dependent | Animation frames, character sprites, monsters |
| `.WSA` | Animation frames (Westwood) | Palette dependent | Multi-frame animations with compression |

**Animation/sprite formats:**
- **SHP format:** Westwood sprite/shape format; used for LOL character/monster sprites
- **WSA format:** Multi-frame animation; full extraction and decompression documented

**Palette handling:**
- Embedded in CPS files (header + 64-byte palette)
- Standalone palette data in PAK files
- WSA/SHP may reference external palettes

### Text / Dialogue Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.TLK` | Dialogue container | Stores all game text, NPC dialogue, UI strings |
| `.DIP` / `.ENG` / `.FRE` / `.GER` | Translation files | Language-specific dialogue overrides (via lollibs) |

**Dialogue structure:**
- TLK file contains indexed string table
- Multiple language variants packed in same location but different filenames
- Null-terminated strings with length prefix or fixed-length records

### Audio / Sound Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.VOC` | Creative Voice audio file | 8-bit PCM samples; used for sound effects and speech |
| `*.DAT` (audio) | Music/score data | Format unspecified; may be MIDI or proprietary |

### Data Tables / Configuration

| Format | Purpose | Notes |
|--------|---------|-------|
| `.DAT` | Miscellaneous data tables | Game mechanics, item definitions, NPC data, etc. |
| `STARTUP.PAK` | Intro/menu resources | Contains initialization data, splashscreens |

**STARTUP.PAK contents (from loldipxls tool):**
- Intro sequence data
- Menu screens
- Palette data for startup

### Other Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `.FNT` | Westwood Font v2 | UI text rendering |
| `.SAV` | Save game files | Player progress, party state, inventory |

## Community Format Documentation

### Lands of Lore Reverse-Engineering Projects

**GitHub repositories with complete format documentation:**

**[KForestland/lands-of-lore-1-re](https://github.com/KForestland/lands-of-lore-1-re)**
- **Status:** Formats solved and cross-checked against ScummVM
- **Documented formats:**
  - PAK and TLK container formats
  - CPS image format (extracted)
  - SHP sprite/shape format (extracted, multi-frame animation)
  - WSA multi-frame animation (full extraction completed)
  - CMZ → WLL → VMP → VCN level rendering pipeline (fully documented)
  - VOC audio format (extracted)
  - EMC2 script decompilation (fully completed)
  - Dialogue data structures
  - Music and palettes
  - Automap legend definitions

This is the **most authoritative public source** for LoL file formats.

### Specialized Tools

**[arcanecoast/lollibs](https://github.com/arcanecoast/lollibs)**
- C++ library for parsing Lands of Lore file formats
- **Supported formats:**
  - Translation files (`.ENG`, `.DIP`, `.GER`, `.FRE`)
  - Package files (`.PAK`)
  - File data index (`.FDT`)
- Source code provides struct definitions for format parsing

**[arcanecoast/loldipxls](https://github.com/arcanecoast/loldipxls)**
- Utility for converting DIP (dialogue) files to/from XLS (spreadsheet)
- Used for localization/translation editing
- Enables reverse engineering of dialogue structure

**[arcanecoast/lolfonteditor](https://github.com/arcanecoast/lolfonteditor)**
- Editor for Westwood Font v2 files in Lands of Lore
- Provides font data structure documentation

**[Son1x90/WSXFileExtractor](https://github.com/Son1x90/WSXFileExtractor)**
- Extracts files from LOL3 WSX archive format
- Note: This is for LoL3, not LoL1; included for reference

### ModdingWiki (Shikadi)

**[Westwood SHP Format (Lands of Lore)](https://moddingwiki.shikadi.net/wiki/Westwood_SHP_Format_(Lands_of_Lore))**
- Sprite/shape format documentation
- Covers animation frames, palettes, rendering

**[PAK Format (Westwood)](https://moddingwiki.shikadi.net/wiki/PAK_Format_(Westwood))**
- Container format used by EOB, Kyrandia, and Lands of Lore
- Shared across Westwood games

### ScummVM Source Code

**GitHub Repository:** [scummvm/scummvm/engines/kyra/](https://github.com/scummvm/scummvm/tree/master/engines/kyra)

**Relevant files for LOL format handling:**
- `kyra_v1.h` — Shared structures for KYRA and LOL
- `script/script_lol.cpp` — LOL script interpreter; contains format parsing hints
- `resource/resource.cpp` — Generic resource loader
- `resource/*_lol.cpp` — LOL-specific resource handling (if it exists)
- `detection_tables.h` — LOL variant detection (DOS, CD, GOG versions)

The ScummVM source is the **most reliable oracle** for understanding how formats are actually parsed.

## Format Details from Community Research

### Level Rendering Pipeline (CMZ → WLL → VMP → VCN)

**CMZ (Compressed Level Data):**
- Compressed dungeon layout using Westwood compression (likely LCW, same as CPS)
- Decompresses to a 2D grid (height/width TBD, likely 32×32 like EOB)
- Each cell may contain wall type ID, decoration index, property flags

**WLL (Wall Lookups):**
- Maps wall type IDs to tileset references
- Links CMZ cell identifiers to specific wall rendering data
- May include transformation/flip flags for wall rendering

**VMP (Viewport Mapping):**
- Different structure from EOB's VMP (EOB maps tiles to screen positions)
- For LOL, likely maps wall types to viewport layer structure (foreground/midground/background)
- Organizes rendering layers for 3D dungeon view

**VCN (Tileset + Palette):**
- Contains pre-rendered wall graphics (similar to EOB)
- Embedded color palette (8-bit or higher, vs. EOB's 32-color)
- Multiple wall angles and light levels for first-person rendering

### PAK File Structure

Simple Westwood container:
- File index (filename → offset mapping)
- Data blocks (compressed or uncompressed)
- Multiple PAK files per game (language-specific: `GENERAL.PAK`, `STARTUP.PAK`, etc.)

### Resource Extraction

**ScummVM tool:** `scummvm-tools-cli --tool extract_kyra -x [-o outputdir] <infile.pak>`

This tool can extract all PAK contents; format-specific parsing requires additional steps.

## Amiga / Platform Notes

**Lands of Lore was NOT released for Amiga.** The game is DOS/CD-only. No platform-specific format variants expected.

**Platform variants documented:**
- DOS (floppy version)
- DOS/CD (multiple language editions)
- GOG.com version (modern distribution; file structure may differ)

## Format Documentation Confidence

- **PAK / TLK containers:** Documented in ScummVM source and community projects; extraction tools available.
- **CMZ → WLL → VMP → VCN pipeline:** Fully documented by community reverse-engineering; considered authoritative.
- **CPS / SHP / WSA graphics:** Documented in ModdingWiki and ScummVM; extraction tools confirmed working.
- **EMC2 script format:** Fully decompiled by KForestland project; bytecode documented.
- **Dialogue / translation formats:** Partially documented via lollibs and loldipxls; structure inferred from tool implementations.
- **Audio (VOC, music):** Documented as extracted but format details sparse.
- **Save game format:** Mentioned but not fully documented in public sources.

## What a Future RE Session Should Check First

1. **Verify CMZ → WLL → VMP → VCN pipeline:**
   - Download KForestland reverse-engineering results
   - Hexdump actual CMZ, WLL, VMP, VCN files from game data
   - Trace through ScummVM's rendering code to confirm structure

2. **Reverse-engineer VMP differences from EOB:**
   - Compare EOB VMP (5,834 bytes, 22×15 viewport mapping) to LOL VMP
   - Determine if structure is similar or completely different
   - Check if VMP size and cell interpretation match

3. **Extract and verify graphics pipeline:**
   - Use `extract_kyra` to unpack PAK files
   - Hexdump CPS, SHP, WSA files
   - Confirm compression format (LCW vs. RLE vs. other)
   - Render extracted tileset images to verify palette interpretation

4. **Analyze dialogue and localization:**
   - Examine TLK and DIP file structure in hex
   - Cross-reference against lollibs source code
   - Identify string encoding, length prefixes, language markers

5. **Document save game format:**
   - Hexdump a saved game file from GOG/DOS version
   - Trace through ScummVM's save/load code to infer structure
   - Compare to EOB1/2 save format to identify differences

6. **Cross-check ScummVM source as oracle:**
   - Grep for struct definitions in script_lol.cpp and resource handlers
   - Examine decompression logic for LCW/RLE variants used by LOL
   - Trace palette loading and rendering to confirm format details

**Note:** The KForestland reverse-engineering project is the single most reliable resource for LOL file formats. Prioritize reading and verifying their work against real files.
