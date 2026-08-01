# Eye of the Beholder 3: File Format Research

**Status:** Unverified — Internet research. Not cross-checked against real game files.

**CRITICAL:** Eye of the Beholder 3 is **NOT supported by ScummVM.** It uses a completely different engine (AESOP/32) from EOB1/2 and has no official reimplementation. Use [ThirdEye](https://github.com/psi29a/thirdeye) as the primary source for format documentation.

## ScummVM Support

**NOT SUPPORTED.** ScummVM's KYRA engine only covers EOB1 and EOB2. EOB3 was developed with a different engine (AESOP, a 32-bit bytecode VM) and never ported to ScummVM.

**Platforms released:**
- DOS (1992, primary version)
- Amiga (never released for Amiga; EOB3 is DOS-only)

**Why not ScummVM?** The ScummVM decision was to accept only EOB1/2 as Kyra subengines because ScummVM targets adventure games. EOB3's AESOP engine is also used only by Dungeon Hack (a related SSI game). Porting AESOP to ScummVM was deemed out of scope.

## Format Overview

EOB3 uses a bytecode-based engine (AESOP/32) with a single large resource file (`EYE.RES`) and separate level data files. This is fundamentally different from EOB1/2's Westwood PAK-based architecture.

### Primary Resource Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `EYE.RES` | Master resource archive | Bytecode, graphics, audio, cinematic data; **must be decompressed/extracted** |
| `LVLnn.TMP` | Level data files (nn = 01–14) | Dungeon layout, object placement, level-specific state |
| `CREATE.SAV` / `TRANSFER.SAV` | Save game files | Character/party data; atomically staged and committed to disk |

### Graphics Formats

| Format | Purpose | Container | Notes |
|--------|---------|-----------|-------|
| **Packed BMP** | Image data (UI, backgrounds) | Inside `EYE.RES` | 8-bit or higher; different from CPS |
| **GFF** | Cinematic playback (INTRO.GFF) | Inside `EYE.RES` | Video format for intro sequences |

**Key difference from EOB1/2:** CPS is replaced with packed BMP. No VCN/VMP tilesets (different rendering pipeline).

### Level / Dungeon Data

| Format | Purpose | Notes |
|--------|---------|-------|
| `LVLnn.TMP` | Level data (14 levels total) | Dungeon layout, object placement, level-specific bytecode |
| `CHGEN.EXE` / `CHARCOPY.EXE` | Character generation binaries | Reverse-engineered by ThirdEye for party creation |

### Save Game Formats

| Format | Purpose | Notes |
|--------|---------|-------|
| `CREATE.SAV` | Initial party creation state | Character portraits, names, HP, ability scores |
| `TRANSFER.SAV` | Active party state during gameplay | Maintains DOS-compatible disk format |
| `LVLnn.TMP` | Per-level save snapshots | Dungeon state, monster positions, item locations |

**Note:** EOB3 save format is fundamentally different from EOB1/2 single-file saves (`EOBDATA.SAV`).

## AESOP Bytecode Engine

The AESOP/32 virtual machine executes bytecode stored in `EYE.RES`:

- **Engine:** 32-bit bytecode interpreter (vs. 16-bit in EOB1/2)
- **Script format:** Custom bytecode (not documented in public sources, only reverse-engineered)
- **Music format:** XMI (Extended MIDI, vs. ADL in EOB1/2)

**ThirdEye's approach:** The project reverse-engineered and reimplements the AESOP interpreter to run the original bytecode unchanged. This is the most reliable format documentation available.

## Community Resources

### ThirdEye: Open Source AESOP Replacement

**Repository:** [psi29a/thirdeye](https://github.com/psi29a/thirdeye)

An open-source reimplementation of the AESOP engine for playing EOB3 and Dungeon Hack. **This is the primary resource for EOB3 format documentation.**

**Key documentation in ThirdEye:**
- `eob3_research/` directory — Format notes and reverse engineering documentation
- `daesop` disassembler tool — Bytecode analysis
- Source code showing how `EYE.RES`, `LVLnn.TMP`, and `CREATE.SAV` are parsed

**What ThirdEye has reverse-engineered:**
- AESOP/32 bytecode instruction set
- `CREATE.SAV` character creation save format
- EOB1 14-byte `ITEM.DAT` format (used for party item data)
- `EYE.RES` resource container structure (partial)
- `LVLnn.TMP` level data layout (partial)

### ModdingWiki (Shikadi)

**EOB format pages:** [Eye of the Beholder](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder)

Covers primarily EOB1/2 formats but includes:
- [Eye of the Beholder Save Game Format](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder_Save_Game_Format) — Includes EOB3 save structure (less detailed)
- [Eye of the Beholder item.dat Format](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder_item.dat_Format) — Shared across all three games
- [Eye of the Beholder decorations Format](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder_decorations_Format) — Likely not applicable to EOB3
- [PAK Format (Westwood)](https://moddingwiki.shikadi.net/wiki/PAK_Format_(Westwood)) — EOB1/2 only; EOB3 doesn't use PAK

### File Format Research

**Archive Team Wiki:** [Eye of the Beholder saved game](http://fileformats.archiveteam.org/wiki/Eye_of_the_Beholder_saved_game)

Limited documentation; covers EOB1/2 primarily.

## Technical Architecture Differences: EOB1/2 vs. EOB3

| Aspect | EOB1/2 (KYRA Engine) | EOB3 (AESOP Engine) |
|--------|----------------------|-------------------|
| **VM/Engine** | Westwood's Kyrandia engine (16-bit) | AESOP/32 bytecode VM |
| **Resource container** | Multiple `.PAK` files | Single `EYE.RES` file |
| **Level data** | `.MAZ` (maze), `.INF` (config), `.OUT` (outdoor) | `LVLnn.TMP` (combined level + state) |
| **Graphics tileset** | `.VCN` + `.VMP` (pre-rendered walls) | Packed BMP (different rendering) |
| **Sprite format** | `.CPS` (5 bitplane) | Packed BMP (inside `EYE.RES`) |
| **Music format** | ADL (Roland MT-32) | XMI (Extended MIDI) |
| **Save format** | Single `EOBDATA.SAV` | Multiple `LVLnn.TMP` + `CREATE.SAV` / `TRANSFER.SAV` |
| **Character Gen** | Executable-driven (CHARCPY.EXE) | Bytecode-driven (in `EYE.RES`) |
| **Amiga version** | Yes (EOB1 + EOB2) | No (DOS only) |

## Format Documentation Confidence

- **EYE.RES structure:** Partially documented in ThirdEye; extraction and parsing not yet fully reverse-engineered.
- **LVLnn.TMP layout:** Partially documented in ThirdEye; exact schema still incomplete.
- **CREATE.SAV format:** Documented in ThirdEye; known to contain character portraits, names, HP, ability scores.
- **AESOP bytecode:** Reverse-engineered in ThirdEye; instruction set partially documented.
- **Packed BMP / graphics:** Not yet fully documented; inferred from resource extraction attempts.
- **Comparison to EOB1/2:** Confirmed completely different architecture; no format sharing except item.dat schema.

## What a Future RE Session Should Check First

1. **Start with ThirdEye source code:**
   - Clone and examine `eob3_research/` notes
   - Read `daesop` disassembler source; trace `EYE.RES` loading logic
   - Study how `LVLnn.TMP` is parsed and applied to the game state

2. **Extract and analyze `EYE.RES`:**
   - Determine resource container schema (offsets, compression, type markers)
   - Identify bytecode sections vs. asset sections
   - Extract packed BMP images and compare to EOB1/2 CPS format

3. **Reverse-engineer level data:**
   - Hexdump `LVL01.TMP` and compare across levels for patterns
   - Cross-reference against ThirdEye's level loading code to infer structure
   - Identify dungeon grid layout, object table, script references

4. **Document save game evolution:**
   - Trace `CREATE.SAV` → `TRANSFER.SAV` → `LVLnn.TMP` transitions
   - Confirm party state serialization format
   - Check if item.dat schema is identical to EOB1/2

5. **Verify graphics pipeline:**
   - Confirm packed BMP is the only sprite format (no VCN/VMP equivalents)
   - Identify palette data location and encoding
   - Compare rendering to EOB1/2 to understand pipeline differences

**Note:** EOB3 is harder to reverse-engineer than EOB1/2 because it lacks ScummVM's public reference implementation. ThirdEye is currently the best resource; consider contributing findings back to that project.
