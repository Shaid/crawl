# Black Crypt — DOS VGA Data Structures

## Overview

Black Crypt (1992, Attention to Detail / Psygnosis) was also released for DOS
with VGA graphics. The DOS VGA demo contains a subset of the full game's data,
with a resource archive format (`clipper.clp`) that stores images, palettes,
and sound effects in a structured container.

---

## File Inventory

| File          | Size       | Description                            |
|---------------|------------|----------------------------------------|
| `crypt.exe`   | 253,952 B  | DOS PE32 executable                    |
| `clipper.clp` | 1,151,267 B| Resource archive (images, palettes, sounds) |
| `maindung.gam`| 15,099 B   | Dungeon/map data (demo subset)         |
| `Config.dat`  | 14 B       | Configuration file                     |

---

## clipper.clp — Resource Archive

### Format

The archive uses a simple directory + raw data layout:

```
[2 bytes]  Entry count (uint16, little-endian)
[N × 56 bytes]  Directory entries
[Raw data...]
```

### Directory Entry (56 bytes)

| Offset | Size | Type    | Description                              |
|--------|------|---------|------------------------------------------|
| 0x00   | 4    | uint32  | Data offset (from start of file)         |
| 0x04   | 4    | uint32  | Data size                                |
| 0x08   | 4    | uint32  | Unknown (flags/type?)                    |
| 0x0C   | 44   | char[44]| Null-terminated name string              |

### Entry Types

| Type Code | Count | Description                               |
|-----------|-------|-------------------------------------------|
| 0x01      | 7     | Markers (empty/separator entries)         |
| 0x02      | 751   | Images (1 byte/pixel indexed, variable dimensions) |
| 0x03      | 7     | Palettes (256 × 3 bytes RGB)             |
| 0x04      | 22    | Sound effects                            |
| 0x05      | —     | Speed effects (if present)               |

### Image Format

Images are stored as raw indexed pixel data:
- 1 byte per pixel (8-bit indexed)
- Dimensions vary per entry (stored in the entry metadata)
- Indexed into one of the 7 palette entries
- No compression — raw pixel data

### Palette Format

Each palette is 768 bytes: 256 entries × 3 bytes (R, G, B).
Seven palette variants exist, likely for different game areas or lighting.

---

## maindung.gam — Dungeon Data

### Format

The DOS dungeon format is **structurally identical** to the Amiga `bcdfs` format,
with the only difference being CPU endianness (little-endian on DOS vs big-endian
on Amiga).

**Confirmed identical:**
- Offset table: Map 1 = `0x00000000`, Map 2 = `0x00003AC7`
- Maps 3–13 have offset 0 in the DOS file (demo only has 2 maps)
- Map 1 header: `00 00 00 00 1d 00 39` — byte-identical between platforms
- Square data: stored as native-endian 32-bit values

### Square Format (4 bytes, same as Amiga)

```
Byte 0: [type:4b][0xF]
Byte 1: [0xF][level:4b]
Byte 2: [wall_flags:4b][uniq_hi:4b]
Byte 3: [uniq_lo:8b]
```

### Endianness Difference

A square `0x00001FF1` is stored as:
- Amiga (big-endian): `00 00 1F F1`
- DOS (little-endian): `F1 1F 00 00`

---

## crypt.exe — Executable

DOS PE32 executable (253,952 B). Contains the game engine, rendering code,
and VGA display routines. The executable references `clipper.clp` for resource
loading and `maindung.gam` for dungeon data.

---

## Cross-Platform Comparison

### Resource Mapping

The Amiga version stores game resources across 26 `bcdf*` files, while the DOS
version consolidates most resources into `clipper.clp`. The mapping is not
1:1 — the DOS version has 751 images and 22 sounds vs the Amiga's distributed
file structure.

### Rendering Differences

| Property     | Amiga                    | DOS VGA                     |
|-------------|--------------------------|-----------------------------|
| Display     | EHB (64 colors)          | VGA (256 colors)            |
| Color depth | 6 bitplanes              | 8 bits/pixel                |
| Resolution  | 320×200                  | 320×200                     |
| Compression | RLE (custom scheme)      | None (raw indexed)          |
| Palette     | 32 × 16-bit + half-bright | 256 × 8-bit RGB            |

### File Size Comparison

| Data Type       | Amiga Source       | Amiga Size  | DOS Source     | DOS Size     |
|-----------------|--------------------|-------------|----------------|--------------|
| Dungeon maps    | bcdfs              | 171,005 B   | maindung.gam   | 15,099 B     |
| All resources   | bcdfa–bcdfz        | ~3.5 MB     | clipper.clp    | 1,151,267 B  |
| Executable      | BlackCrypt + overlays | ~600 KB  | crypt.exe      | 253,952 B    |

The DOS demo contains only 2 maps (vs 13 in the full game), explaining the
small `maindung.gam` size.

---

## Extracted Assets

Rendered DOS images from `clipper.clp` are stored at:
```
data/blackcrypt/bcdf_images/   (246 PNG files)
```

These include dungeon textures, title screens, item graphics, monster sprites,
UI elements, and character portraits.

Runtime-rendered captures from the DOS executable are at:
```
data/blackcrypt/extracted/     (214 PNG files)
```

These include title screens, character generation, in-game views, and various
format experiments (different bitplane interpretations, interleaving modes).
