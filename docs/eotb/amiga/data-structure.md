# Eye of the Beholder — Amiga Data Structures

## Overview

Eye of the Beholder (1991, Westwood Associates / SSI) and Eye of the Beholder II
(1992) are first-person dungeon crawlers for the Amiga using the AD&D ruleset.
Both use Westwood's proprietary file formats built around CPS (Compressed Picture
System) images and LCW compression.

**EOB1:** 158 files in `data/eotb/amiga/`
**EOB2:** 261 files in `data/eotb2/amiga/data/` (WHDLoad installation)

**Note on DOS versions as format oracle:** Both EOB1 and EOB2 DOS versions are fully
supported by [ScummVM's KYRA engine](https://www.scummvm.org/compatibility/2.7.0/kyra:eob/).
The ScummVM source code (`engines/kyra/`) provides a byte-accurate reference implementation
for format parsing and can be used to cross-validate Amiga format structures. See
`docs/eotb2/eotb2-formats-research.md` for links to ScummVM source files.

**Confirmed (2026-08-02): ScummVM's Kyra engine has full, first-class Amiga
support, not just DOS.** `engines/kyra/detection_tables.h` lists real
`kPlatformAmiga` detection entries for both `"eob"` (EOB1, EN/DE/FR/IT) and
`"eob2"` (EOB2, EN/DE), and there's a dedicated
`engines/kyra/graphics/screen_eob_amiga.cpp` plus `kPlatformAmiga`
branches throughout `engine/eob.cpp`, `engine/eobcommon.cpp`,
`engine/scene_eob.cpp`, `engine/sprites_eob.cpp`, `engine/magic_eob.cpp`,
`gui/gui_eob.cpp`, `gui/saveload_eob.cpp`, `script/script_eob.cpp`,
`sequence/sequences_eob.cpp`, `resource/staticres_eob.cpp`. This settles
the standing question for every Amiga-specific TODO item in this doc: an
authoritative oracle **does** exist for all of them (no "real
disassembly required, no oracle available" re-flagging needed) — see each
section below for what was traced this pass.

---

## File Types

| Extension | Content                              | Size Range  |
|-----------|--------------------------------------|-------------|
| `.CPS`    | Compressed images (walls, monsters, UI) | 1–60 KB   |
| `.VCN`    | Wall view tile data + palette         | 55–61 KB    |
| `.VMP`    | Wall view tile mapping table          | 5.7 KB      |
| `.MAZ`    | Maze / dungeon layout                 | 4.1 KB      |
| `.INF`    | Level configuration (monsters, items) | 2–5 KB      |
| `.DAT`    | Wall parameters, items, text          | 1–16 KB     |
| `.PAL`    | Standalone palettes (EOB2 only)       | 64 B        |
| `.DEC`    | Decoration data (EOB2)                | varies      |
| `.OUT`    | Overhead map data (EOB2)              | varies      |
| `.DCR`    | Creature/decoration resources (EOB2)  | varies      |
| `.SAM`    | Sound samples (EOB2)                  | varies      |
| `EOBDATA.SAV` | Save game                         | —           |

---

## CPS — Compressed Picture System

The primary image format. All CPS files are 320×200 pixels, 5 bitplanes
(32 colors), 40,000 bytes when uncompressed. Used for wall sets, monster
sprites, UI screens, title screens, and item icons.

### Header (little-endian)

| Offset | Size | Type     | Description                                |
|--------|------|----------|--------------------------------------------|
| 0x00   | 2    | UINT16LE | FileSize — bytes after this field           |
| 0x02   | 2    | UINT16LE | CompressionType (4 = LCW)                   |
| 0x04   | 4    | UINT32LE | UncompressedSize (40000 or 40064)           |
| 0x08   | 2    | UINT16LE | PaletteSize (0 = none, or multiple of 64)   |
| 0x0A   | —    | —        | Compressed data (or palette if PaletteSize>0) |

**Compression types:**
- `0x0000` — Uncompressed
- `0x0001` — LZW-12
- `0x0002` — LZW-14
- `0x0003` — RLE (with 16-bit LE long-repeat commands on Amiga)
- `0x0004` — **LCW** (used by all EOB1/EOB2 Amiga files)

**FileSize note:** For types 0 and 4, FileSize counts bytes behind itself,
making it 2 less than the actual file size.

### Palette Locations

**EOB1 style:** When `UncompressedSize == 40064`, the final 64 bytes of the
uncompressed data contain a 32-color Amiga palette (16-bit big-endian, 0x0RGB
format). Used by: `TITLE.CPS`, `CHARGEN.CPS`, `INVENT.CPS`, `TOWRMAGE.CPS`,
`KING.CPS`, `ORB.CPS`, `WTRDP1.CPS`.

**EOB2 style:** When `PaletteSize > 0`, the palette is embedded in the file
header at offset 10, before the compressed data. `PaletteSize` is typically 64
(one palette) or a multiple of 64 for multi-palette files. Palette entries are
16-bit big-endian Amiga color registers.

**Multi-palette CPS — mechanism confirmed (2026-08-02, ScummVM source).**
`Screen_EoB::setDualPalettes` (`graphics/screen_eob_amiga.cpp:156-163`) is
the real handler: it composites two independently-loaded 32-colour
palettes into one 64-colour combined palette (`_palettes[0]`, copying the
"top" palette into slots 0-31 and the "bottom" palette into slots 32-63),
then calls `Screen::enableDualPaletteMode(splitY=120)`
(`graphics/screen.cpp:1004`) which makes the renderer use the top-half
palette for scanlines above `splitY` and the bottom-half palette below it
— **a horizontal screen-split effect (distinct top/bottom colour sets),
not a fading/flash effect**. Only one call site:
`EoBCoreEngine::???` via `_screen->setDualPalettes(_screen->getPalette(amigaPalIndex),
_screen->getPalette(7))` (`engine/eobcommon.cpp:1783`) — not traced
further to find which specific screen/context calls this (time budget);
this settles the previous open question of "how" (confirmed: split-screen
dual palette, not multi-frame animation) even though "which CPS files use
it and when" wasn't individually re-verified against real files this pass.
This narrows `eotb1-amiga-multipalette-cps` from "logic not implemented"
to "logic identified and cited, not yet ported to the extractor."

**Standalone (.PAL files, EOB2 only):** 64-byte files containing 32 × 16-bit
big-endian colors. Wall sets: `AZURE.PAL`, `CRIMSON.PAL`, `DUNG.PAL`,
`FOREST.PAL`, `MEZZ.PAL`, `SILVER.PAL`. `FINALE.PAL` is 384 bytes (6 palettes).

**VCN-embedded (EOB1 wall sets):** Each `.VCN` file contains a 32-color palette
at offset 0x40 stored as 24-bit RGB (3 bytes per color, 96 bytes total). The
first 3 colors are always black (RGB 0,0,0). This palette format uses 8-bit
per channel values that need the correct interpretation (not yet fully decoded).

**Palette structure** (shared across all EOB palettes):
- Colors 0–5: Wall-set or image-specific
- Colors 6–7: Shared UI elements (`0x0A0A`, `0x0DC2`)
- Colors 8–10: Grayscale ramp
- Colors 11–25: Mixed shared colors
- Colors 26–30: Highlight ramp
- Color 31: White (`0x0FFF`)

### LCW Decompression

Westwood's proprietary "Format 80" compression (internally called LCW).
Five command types, 1–5 bytes each:

**Command 1 — Short literal copy** (1 byte): `10xxxxxx`
Copy next `xxxxxx` bytes literally. A value of 0x80 (`10 000000`) marks EOF.

**Command 2 — Existing block copy** (2 bytes): `0xxxyyyy yyyyyyyy`
Copy `xxx + 3` bytes from `Dest[current - (yyyy|yyyyyyyy)]`.

**Command 3 — Medium copy** (3 bytes): `11xxxxxx yyyyyyyy yyyyyyyy`
Copy `xxxxxx + 3` bytes from absolute or relative position.

**Command 4 — Fill** (4 bytes): `11111110 cccccccc cccccccc vvvvvvvv`
Write byte `vvvvvvvv` repeated `cccccccc|cccccccc` times.

**Command 5 — Long copy** (5 bytes): `11111111 cccccccc cccccccc pppppppp pppppppp`
Copy `cccccccc|cccccccc` bytes from position `pppppppp|pppppppp`.

Pseudo-code for decompression:

```
sp = 0; relative = (src[sp] == 0); if relative: sp += 1
while sp < len(src):
    cmd = src[sp++]
    if (cmd & 0x80) == 0:        # Command 2
        count = ((cmd >> 4) & 7) + 3
        pos = ((cmd & 0x0F) << 8) | src[sp++]
        copy count bytes from dst[len(dst) - pos]
    elif (cmd & 0x40) == 0:       # Command 1
        count = cmd & 0x3F
        if count == 0: break      # EOF
        copy count literal bytes
    else:                          # Commands 3/4/5
        count = cmd & 0x3F
        if count == 0x3E:          # Command 4 (fill)
            count = src[sp] | (src[sp+1] << 8); sp += 2
            val = src[sp++]
            fill count bytes with val
        elif count == 0x3F:        # Command 5 (long copy)
            count = src[sp] | (src[sp+1] << 8); sp += 2
            pos = src[sp] | (src[sp+1] << 8); sp += 2
            copy count bytes from position
        else:                      # Command 3 (medium copy)
            count += 3
            pos = src[sp] | (src[sp+1] << 8); sp += 2
            copy count bytes from position
```

### A second, distinct Amiga-only codec (`loadSpecialAmigaCPS`) — bonus finding

Not one of this pass's requested items, but discovered while tracing
Amiga `.INF`-equivalent level loading and worth recording: some Amiga
files are **not** LCW at all. `Screen_EoB::loadSpecialAmigaCPS`
(`graphics/screen_eob_amiga.cpp:62-154`) implements a second, unrelated
compression scheme — a **backwards-reading bit-level LZ variant with an
XOR checksum**, reading both the compressed input and the decompressed
output from high addresses down to low:
```cpp
// graphics/screen_eob_amiga.cpp:36-60 (bit reader) + 62-154 (decoder)
// input header: u32 BE inSize, u32 BE outSize, u32 BE chk (running XOR checksum, must == 0 at end)
// reads a 32-bit "code" register 1 bit at a time, refilling 4 bytes (BE) from
// `pos -= 4` whenever exhausted -- both pos (input) and dst (output) count DOWN
```
Used for: the Amiga equivalent of `readLevelFileData`'s DOS `.INF` LCW
branch (`engine/scene_eob.cpp:144-145`, gated on
`s->readSint32BE() + 12 == s->size()`), `TEXT.CPS`
(`engine/eobcommon.cpp:1406,1721,1972`), and as an EOB2-Amiga-German
fallback for `.CPS` files whose header size doesn't match the normal LCW
convention (`graphics/screen_eob.cpp:492-499,516-517` — "some localized
versions... simply check for certain file names which aren't actual CPS
files"). Also carries its own 32-colour palette (64 raw bytes, Amiga
12-bit RGB, loaded via the same `loadAmigaPalette` as VCN) **before** the
compression header, but only when a size-check fails
(`screen_eob_amiga.cpp:75-79`) — "unlike normal CPS files these files
never have more than one palette" (source comment). Not implemented as a
decoder this pass — logged here as a confirmed, named, cited algorithm for
a future pass on Amiga `.INF`/`TEXT.CPS`, not a new open TODO item (out of
this pass's requested scope).

### Image Data

After decompression: 40,000 bytes = 5 bitplanes × 8,000 bytes each.
Each bitplane is 320×200 pixels (320/8 = 40 bytes per row).

Pixel at (x, y) color index:
```
byte_pos = y * 40 + x // 8
bit_pos = 7 - (x % 8)
color = 0
for plane in 0..4:
    color |= ((bitplane[plane][byte_pos] >> bit_pos) & 1) << plane
```

**Verified:** 62 CPS files rendered correctly at 320×200 5bpp including all
wall sets, UI screens, and 48 monster/animation files.

---

## VCN — Wall View Data

Pre-rendered wall graphics organized as 8×8 pixel tiles indexed by the VMP
mapping table. Each VCN file contains a tileset for one wall theme.

**EOB1 wall sets:** BLUE, BRICK, DROW, GREEN, XANATHA
**EOB2 wall sets:** AZURE, CRIMSON, DUNG, FOREST, MEZZ, SILVER

### Structure — confirmed, and simpler than the previous guess (2026-08-02, ScummVM source)

Port of `EoBEngine::loadVcnData` (`engine/eob.cpp:693-715`, the
`kPlatformAmiga` branch). The previous "0x40 header, compressed tile data"
description was a guess from generic CPS-file conventions and is
**superseded** — the real Amiga VCN layout is different and,
importantly, **entirely uncompressed**:

```cpp
Common::SeekableReadStream *in = _res->createReadStream(fn);
uint32 vcnSize = in->readUint16LE() * (_vcnSrcBitsPerPixel << 3);  // bitsPerPixel=5 on Amiga -> 40 bytes/tile
_vcnBlocks = new uint8[vcnSize];
_screen->getPalette(1).loadAmigaPalette(*in, 1, 5);   // 5 colours, into palette slots [1..5]
in->seek(22, SEEK_CUR);                                // skip 22 reserved bytes
in->read(_vcnBlocks, vcnSize);                          // raw tile data, NO decompression
```

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 2 | `numTiles` (u16 LE) | tile data size = `numTiles * 40` bytes (5 bitplanes × 8 bytes/plane per 8×8 tile) |
| 0x02 | 10 | 5 Amiga palette colours (u16 BE each) | loaded into **palette slots 1-5** (not 0-4) — a small palette *patch*, not the full 32-colour wall-set palette (see below) |
| 0x0C | 22 | reserved, skipped | unread/unaccounted — same total header size (34 = `0x22`) as the DOS `.VCN` header (`numTiles` u16 + 32-byte colMap), just Amiga substitutes 10 bytes of palette + 22 bytes reserved for DOS's 32-byte colMap — a structural echo, not yet explained further |
| 0x22 | `numTiles*40` | tile data | **raw, uncompressed** — 8×8 tiles, 5 bitplanes, standard Amiga planar (8 rows × 1 byte/row × 5 planes = 40 bytes/tile) |

**This closes `eotb1-amiga-vcn-decompress` as "no algorithm exists to
implement" — Amiga `.VCN` tile data is never compressed on this platform.**
(The earlier open item's premise — "tile data after the palette may be
compressed" — is refuted directly by the reader code: it's a straight
`stream->read()` into the tile buffer, no decode step at all.)

### Palette (VCN offset 0x02, not 0x40 — supersedes the earlier guess)

**Confirmed.** `Palette::loadAmigaPalette` (`graphics/screen.cpp:4193-4202`):
each colour is a **16-bit big-endian Amiga colour register**, `0x0RGB`
(4 bits per channel, top nibble unused), scaled to the engine's internal
6-bit (0-63) palette range via `(nibble * 0x3F) / 0xF` — **not** a naive
left-shift/multiply-by-17:
```python
def amiga12_to_6bit(nibble):  # e.g. 0xF -> 63, 0x8 -> 33 (not 0x88=136 or 8*17=136)
    return (nibble * 0x3F) // 0xF
```
This closes `eotb1-amiga-vcn-palette`. Correction to the earlier text: the
VCN file does **not** carry a full 32-colour palette at offset 0x40 in
8-bit RGB — it carries only **5** colours (12-bit Amiga RGB, u16 BE) at
offset 0x02, loaded into palette slots 1-5 as a small patch on top of
whatever 32-colour palette is already active (the wall-set's `.PAL`,
loaded separately — same "name-matched `<wallStem>.PAL`" mechanism
confirmed for DOS in `docs/eotb/dosvga/data-structure.md` § "VGA palette";
not independently re-traced for the Amiga palette-load call site this
pass, but the DOS mechanism's structural analogue — `.INF`'s embedded
wall-set stem — is shared code, `EoBCoreEngine::initLevelData`, so very
likely identical). Not yet re-rendered with the corrected offset/scaling
this pass — logged as confirmed-from-source, re-render is a follow-up.

---

## VMP — Wall View Mapping Table

5,834 bytes. Maps VCN tile indices to viewport positions. Identical across all
wall sets within each game (BRICK.VMP = BLUE.VMP, etc.).

Organizes the 22×15 tile viewport into 5 layers:
- 330 backdrop tile indices
- 431 indices per wall type (6 types × 431)
- Each 16-bit entry: 14-bit VCN tile index + 1-bit z-mask + 1-bit horizontal flip

---

## MAZ — Maze Layout

~4,102 bytes per level. Defines a 32×32 grid with 4 sides (N/E/S/W) per cell.

### Header

| Offset | Size | Description                    |
|--------|------|--------------------------------|
| 0x00   | 2    | Width (always 32)              |
| 0x02   | 2    | Height (always 32)             |
| 0x04   | 2    | Tile size flag (always 4)      |

### Cell Data

1,024 cells × 4 sides = 4,096 bytes. Each side encodes:
- Wall type (0 = none, other values for solid/door/stairs/etc.)
- Decoration count
- Click event index
- Passability bitflags

### Additional Data

After the cell grid:
- Door state sequences (3–7, 8–12, etc.)
- Stair connections
- Pit/teleport destinations
- Event scripts

---

## INF — Level Configuration

Each `.INF` file configures a dungeon level:

- **Header:** Filename references (MAZ file, VCN wall set, PAL file)
- **Monster spawns:** Up to 30 entries with monster type name, spawn coordinates,
  quantity, and level
- **Decoration commands:** `0xEC` loads CPS overlay images, `0xFB` defines wall
  type mappings
- **Event scripts:** 18+ bytecode commands for triggers, teleports, damage,
  sound, messages, conditionals

**Verified:** `LEVEL1.INF` references `level1.maz`, `brick` wall set, and
monsters `kobold`, `leech`.

---

## DAT — Data Files

### ITEM.DAT (9,601 bytes, EOB1)

Doubly-linked list of item instances. Each entry: 15 bytes with identified/
unidentified name indices, bitflags (glow, identified, cursed, life-drain),
icon index, type (0–56), sub-position, x/y position, level, value. Ends with
a name string table (35 characters per name).

**Verified item names:** Leather armor, Robe, Staff, Dagger, Short sword,
Lock picks, Spellbook, Cleric Holy symbol, Leather boots, Iron Rations,
Jeweled Key, Potion, Wand, Scroll, Ring, Severious, Backstabber,
Drow Cleaver, Slicer, Flicka, and many more.

### ITEMTYPE.DAT (914 bytes, EOB1)

Item type templates. Each entry: inventory slot bitmask (quiver, armour,
bracers, backpack, boots, helmet, necklace, belt, ring), hand usage,
AC modifier, class permissions (fighter/mage/cleric/thief), damage dice
(rolls/sides/base) for small and large targets. 57 item types total.

### TEXT.DAT (16 KB, EOB1)

Game narrative text, UI strings, and system messages. Null-terminated strings
organized in a lookup table.

### Wall Set DAT Files (EOB1)

`BLUE.DAT`, `BRICK.DAT`, `DROW.DAT`, `GREEN.DAT`, `XANATHA.DAT`. Contain
wall rendering parameters, decoration offsets, and viewport configuration.
Palettes for these wall sets are stored in the corresponding `.VCN` files.

---

## EOBDATA.SAV — Save game (confirmed available from source, not fully ported)

**Confirmed: a byte-exact, source-derived spec exists** in
`GUI_EoB::loadGameOld`/related (`gui/saveload_eob.cpp:690-780+`), including
a platform **auto-detection heuristic** the engine itself uses to load
save files from any of DOS/Amiga/FM-Towns without a format flag:
```cpp
test.seek(_flags.gameID == GI_EOB1 ? 39 : 61);
uint32 exp = test.readUint32LE();
test.seek(_flags.gameID == GI_EOB1 ? 61 : 27);
bool padding = !test.readByte();
if (sourcePlatform == DOS && padding && (exp & 0xFF000000))
    sourcePlatform = Amiga;
```
**Verified against the real `data/eotb/amiga/EOBDATA.SAV` (33,107 bytes):**
applying this exact heuristic to the real file — `byte[61] == 0` (padding
true) and `u32_LE(bytes[39:43]) & 0xFF000000 == 0x13000000` (nonzero) —
correctly identifies it as Amiga-sourced, matching its known origin
(it's in the Amiga data directory). This is a clean, cheap, real-data
confirmation that the detection logic and byte offsets are right for this
project's actual file.

The subsequent per-character record (`saveload_eob.cpp:730-780+`) is
fully byte-exact from the reader (id, flags, name[11 or 21 depending on
platform], 7 stat pairs (cur/max) as signed bytes, HP as byte (EOB1) or
u16 (EOB2), AC, disabledSlots, raceSex, class, alignment, portrait, food,
level[3], experience[3] as u32, spell slots, etc.) with explicit
Amiga-vs-DOS field-width differences already handled in the reader (e.g.
`if (_flags.gameID == GI_EOB2 && sourcePlatform == Amiga) in.skip(1);` at
`saveload_eob.cpp:751-752`). This is well past "documented but not
verified" — the full record layout is directly readable from
`saveload_eob.cpp:690-900+`ish and the platform-detection prefix is now
byte-verified against the real file. Not ported into a standalone
Python decoder this pass (the source itself is the practical reference;
committing a full port of this ~200-line reader was deprioritized in
favour of closing the remaining unopened-format items) — narrows
`eotb1-amiga-savegame` from "structure unknown, needs verification" to
"structure fully known and spot-verified, extractor not yet written."

---

## Monster Graphics

Monster sprites are stored as standard CPS files at 320×200 5bpp. Each file
contains one or more animation frames arranged within the 320×200 canvas.

**EOB1 monsters (22 types):** KENKU, KOBOLD, KUOTOA, LEECH, GOLEM, SKELETON,
SKELWAR, ZOMBIE, SPIDER1, MANTIS1, DRIDER1, HELLHND, FLIND, DROWELF, DWARF,
MAGE, WIZARD, XANATH1, XORN1, HUM1, MFLAYER, KING.

**EOB1 attack animations (8):** BEASTATK1, FLAYERATK1, HOUNDATK1, RUSTATK1,
BLADE1, SCREAM1.

**EOB1 movement animations (4):** LEECHMOV1, KUOTOAMOV1, SPIDERMOV1,
MANTISMOV1, SLOSHSUCK1.

**EOB1 special effects (3):** WTRDP1, WTRDP2, WTRDP3 (water drop effects).

**EOB2 monsters (8):** BEHOLDER, DRAGON, WOLF, ANT, MEDUSA, GARGOYLE,
BASILISK, BULETTE.

Most monster CPS files use the INVENT palette or their wall-set palette.
A few (TOWRMAGE, KING, ORB, WTRDP1) have embedded palettes.

---

## EOB2 — Additional Formats

### PAL Files

Standalone palette files (64 bytes = 32 × 16-bit big-endian Amiga colors).
`FINALE.PAL` is 384 bytes containing 6 palettes.

### DEC Files

**Confirmed, format shared with DOS.** `EoBEngine::getDecDefinitions` has
no Amiga-specific override (only SegaCD overrides it) — it falls straight
through to the base `EoBCoreEngine::getDecDefinitions`
(`engine/scene_eob.cpp:420-422`), which reads via
`createEndianAwareReadStream(decFile, Resource::kForceLE)` — **forced
little-endian regardless of platform**. So `.DEC` on Amiga uses the exact
same byte layout as DOS. See `docs/eotb/dosvga/data-structure.md` § "INF —
Level configuration" → ".DEC — decoration definitions" for the full
confirmed record layout (52-byte `LevelDecorationProperty` records + an
8-byte `EoBRect8` array). This closes `eotb1-amiga-dec-format` — the
Shikadi-wiki-derived description can be replaced by this source-confirmed
one; not independently re-verified against a real Amiga `.DEC` file this
pass (the DOS-side verification target didn't exist in this corpus either
— logged as confirmed-from-source only).

### OUT Files

Overhead map data for outdoor areas. References wall sets and defines the
outdoor terrain layout. Not traced this pass (not in the requested item
list — EOB2-specific, `docs/eotb2/TODO.md` doesn't carry an OUT item
either).

### DCR Files

**Confirmed structure (EOB2 only — genuinely does not apply to EOB1).**
`EoBCoreEngine::loadMonsterShapes` (`engine/sprites_eob.cpp:34-51`) only
opens a monster's `.DCR` file when its `hasDecorations` parameter is
`true`; tracing every call site (`engine/scene_eob.cpp:275,280`) shows
**EOB1 always passes `false`** (`if (*pos != 0xFF) loadMonsterShapes(...,
false, ...)`, `scene_eob.cpp:275`) while **EOB2 passes it per-monster from
the `.INF` data** (`pos[15] ? true : false`, `scene_eob.cpp:280`). This
matches the corpus directly: `data/eotb/amiga/` (and DOS `data/eotb/dosvga/`)
contain **zero** `.DCR` files, while EOB2 does (`docs/eotb2/dosvga/`'s
`BEHOLDER.DCR` etc.). **`eotb1-amiga-dcr-format` is closed as "does not
apply to EOB1" rather than "undecoded"** — the real format (for EOB2) is
now documented in `docs/eotb2/dosvga/data-structure.md`, decoded from
`DarkMoonEngine::loadMonsterDecoration` (`engine/darkmoon.cpp:310-336`):
```
u16 LE  setCount
repeat setCount:
    repeat 6:                    # one per facing/pose variant
        u8[6]  dc = [encX, encY, encW, encH, s8 offsetX, s8 offsetY]
        # dc[2]==0 or dc[3]==0 -> this slot is inactive/unused, skipped
```
i.e. `setCount * 36 + 2` bytes total. Verified against the EOB2 DOS
`BEHOLDER.DCR` (38 bytes, per `docs/eotb2/dosvga/TODO.md`):
`2 + 1*36 = 38` — **exact match, zero residue**, for `setCount=1`.

### SAM Files

Raw 8-bit PCM audio samples. Level-specific sounds: `LEVEL1.SAM` through
`LEVEL16.SAM`, plus `INTRO.SAM`, `FINALE.SAM`.

---

## File List — EOB1

| Category | Files |
|----------|-------|
| Wall CPS | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall VCN | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall VMP | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall DAT | BLUE, BRICK, DROW, GREEN, XANATHA |
| Wall samples | LEVELSAM1–LEVELSAM12 |
| Maze | LEVEL1–LEVEL12.MAZ |
| Info | LEVEL1–LEVEL12.INF |
| Monsters | KENKU, KOBOLD, KUOTOA, LEECH, GOLEM, SKELETON, SKELWAR, ZOMBIE, SPIDER1, MANTIS1, DRIDER1, HELLHND, FLIND, DROWELF, DWARF, MAGE, WIZARD, XANATH1, XORN1, HUM1, MFLAYER, TOWRMAGE, KING, DAND, SHINDIA |
| Animations | BEASTATK1, FLAYERATK1, HOUNDATK1, RUSTATK1, BLADE1, SCREAM1, LEECHMOV1, KUOTOAMOV1, SPIDERMOV1, MANTISMOV1, SLOSHSUCK1, WTRDP1–3 |
| UI | TITLE, CHARGEN, CHARGENA, CHARGENB, INVENT, ITEMICN, ITEML1, ITEMS1, DOOR, PLAYFLD |
| Cutscenes | INTRO1–5, FINALE1–2, OUTTAKE, PRESENT, WESTWOOD, SSI, COUNCIL, COUNCILA–B |
| Effects | ORB, PORTALA, PORTALB, TUNNEL, ZOOMTUNL, AVALANCH, DECORATE, SFX1–4 |
| Data | ITEM.DAT, ITEMTYPE.DAT, TEXT.DAT, EOBDATA.SAV, LEVELS.TMP |
| Executables | eob, EOB1, eob2 |

---

## Open Questions

See `docs/eotb/TODO.md`.
