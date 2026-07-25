# Eye of the Beholder — Amiga Data Structures

## Overview

Eye of the Beholder (1991, Westwood Associates / SSI) and Eye of the Beholder II
(1992) are first-person dungeon crawlers for the Amiga using the AD&D ruleset.
Both use Westwood's proprietary file formats built around CPS (Compressed Picture
System) images and LCW compression.

**EOB1:** 158 files in `data/eotb/amiga/`
**EOB2:** 261 files in `data/eotb2/amiga/data/` (WHDLoad installation)

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

### Structure

| Offset | Description                                    |
|--------|------------------------------------------------|
| 0x00   | Header (CPS-like, version byte `0x04`)          |
| 0x40   | Palette — 32 colors × 3 bytes (24-bit RGB)      |
| …      | Tile data (compressed or run-length encoded)     |

The first tile in each VCN is fully transparent. The remaining tiles form
7 groups: 1 backdrop tile plus 6 wall-type tilesets (solid wall 1, solid wall 2,
door frame, stairs up, stairs down, portal).

### Palette (VCN offset 0x40)

32 colors stored as 8-bit RGB triplets (96 bytes). The encoding maps to Amiga
4-bit-per-channel colors but uses a non-standard scaling (not the typical ×17).
The first 3 entries are always black. The exact conversion to Amiga 12-bit
values is not yet fully decoded.

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

Decoration placement data. Defines wall-mounted decorations (torches, banners,
alcoves) with x/y coordinates and tile indices.

### OUT Files

Overhead map data for outdoor areas. References wall sets and defines the
outdoor terrain layout.

### DCR Files

Binary creature and decoration resources. Likely contain additional sprite
frames, animation data, or creature behavior parameters.

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

1. **VCN palette encoding** — The 24-bit RGB palette at VCN offset 0x40 uses
   non-standard 8-bit-per-channel values that don't map cleanly to Amiga
   12-bit colors (not multiples of 17). The exact scaling factor or bit depth
   is unknown.
2. **VCN tile decompression** — The tile data after the palette may use
   compression. The decompression algorithm has not been implemented.
3. **DEC file format** — Decoration data structure is documented in the
   [Shikadi wiki](https://moddingwiki.shikadi.net/wiki/Eye_of_the_Beholder_Decorations_Format)
   but not verified against the data files.
4. **DCR file format** — Creature resources are undocumented and not analyzed.
5. **Save game format** — `EOBDATA.SAV` structure is documented but not
   verified against the actual file.
6. **EOB2 multi-palette CPS** — Some EOB2 CPS files contain multiple palettes
   for different screen quadrants or effects (e.g., lightning flashes). The
   multi-palette rendering logic needs implementation.
