# Black Crypt — Windows VGA Data Structures

## Overview

Black Crypt (1992, Raven Software / Electronic Arts) was ported to Windows
by Rick Johnson starting October 21, 1995, using DirectX 3.0 (GameSDK). The
Windows version uses DirectDraw for graphics and DirectSound for audio.

The demo contains a subset of the full game's data, with a resource archive
format (`clipper.clp`) that stores images, palettes, and sound effects in a
structured container.

**Note:** The data files live in `data/blackcrypt/dosvga/` but the executable
is a PE32 Windows GUI application (not DOS). It requires DirectX 3.0+ and
runs on Windows 95/98/NT 4.0.

---

## File Inventory

| File          | Size       | Description                            |
|---------------|------------|----------------------------------------|
| `crypt.exe`   | 253,952 B  | Windows PE32 GUI executable (DirectX 3.0) |
| `clipper.clp` | 1,151,267 B| Resource archive (images, palettes, sounds) |
| `maindung.gam`| 15,099 B   | Dungeon/map data (demo subset)         |
| `Config.dat`  | 14 B       | Configuration file                     |

---

## clipper.clp — Resource Archive

### Format

The archive uses a simple directory + raw data layout:

```
[2 bytes]   Entry count (uint16 LE) → 816
[816 × 56 bytes]  Directory entries
[Raw data...]
```

### Directory Entry (56 bytes)

| Offset | Size | Type    | Description                              |
|--------|------|---------|------------------------------------------|
| 0x00   | 40   | char[]  | Null-terminated name string              |
| 0x28   | 1    | uint8   | Entry type (see below)                   |
| 0x2A   | 4    | uint32  | Data size (bytes)                        |
| 0x2E   | 4    | uint32  | Data offset (from start of file)         |
| 0x34   | 2    | uint16  | Width (images only)                      |
| 0x36   | 2    | uint16  | Height (images only)                     |

### Entry Types

| Type Code | Count | Description                               |
|-----------|-------|-------------------------------------------|
| 0x01      | 34    | Markers (separator/navigation entries)    |
| 0x02      | 751   | Images (raw 8-bit indexed, no compression)|
| 0x03      | 7     | Palettes (256 × 3 bytes RGB, 768 bytes)   |
| 0x04      | 22    | Sound effects (raw IFF or WAV format)     |
| 0x05      | 2     | Speed effects (unknown format)            |

### Image Format

Images are stored as raw indexed pixel data:
- 1 byte per pixel (8-bit indexed)
- Dimensions vary per entry (width/height stored in directory)
- No compression — raw pixel data
- Palette is determined by image name context (see `pick_palette()` in `scripts/extract_clipper.py`)
- Transparency uses two known background colors: brown (95,67,51 = palette ~idx 33)
  and cyan (0,255,255). These are detected and made fully transparent.
- 751 images, 0 remaining cyan pixels. Verification: `scripts/extract_clipper.py`

### Palette Format

Each palette is 768 bytes: 256 entries × 3 bytes (R, G, B).
Seven palette variants:

| Palette Name       | Usage                            |
|--------------------|----------------------------------|
| Palette             | Default/dungeon rendering        |
| Automap Palette     | Automap view                     |
| Character Gen Palette | Character generation screen    |
| Options Palette     | Options/UI screens               |
| Title Palette       | Title screen                     |
| Title Palette 2     | Title screen variant             |
| Title Palette 3     | Title screen variant             |

### Extraction Script

```bash
python3 scripts/extract_clipper.py
```

Output: `data/blackcrypt/extracted/clipper/`
- `images/` — 745 PNG files (name matches direction/size from entry name)
- `palettes/` — 7 `.pal` raw palette files + PNG palette swatches
- `sounds/` — 22 sound files (`.wav`, `.iff`, or `.raw`)

---

## maindung.gam — Dungeon Data

### Format

The Windows dungeon format is **structurally identical** to the Amiga `bcdfs` format,
with the only difference being CPU endianness (little-endian on Windows vs big-endian
on Amiga).

**Confirmed identical:**
- Offset table: Map 1 = `0x00000000`, Map 2 = `0x00003AC7`
- Maps 3–13 have offset 0 in the Windows file (demo only has 2 maps)
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
- Windows (little-endian): `F1 1F 00 00`

---

## crypt.exe — Windows Executable

PE32 Windows GUI executable (253,952 B). Imports: DDRAW.dll (DirectDraw),
DSOUND.dll (DirectSound), WINMM.dll (Windows Multimedia), GDI32.dll,
USER32.dll, KERNEL32.dll.

Contains embedded text by Rick Johnson describing the port:
- Original Amiga version by Raven Software (Brian Raffel, Steve Raffel,
  Ben Gokey, Rick Johnson), released March 20, 1992
- Windows port started October 21, 1995 using DirectX (GameSDK)
- Requires DirectX 3.0+, runs on Windows 95/98/NT 4.0
- Demo contains only the first dungeon map (two playable levels)

References `clipper.clp` for resource loading and `MainDung.gam` for
dungeon data. Character files use `char%d.dat` pattern (same as Amiga).

---

## Cross-Platform Comparison

### Resource Mapping

The Amiga version stores game resources across 26 `bcdf*` files, while the
Windows version consolidates most resources into `clipper.clp`. The mapping is not
1:1 — the Windows version has 751 images and 22 sounds vs the Amiga's distributed
file structure.

### Rendering Differences

| Property     | Amiga                    | Windows VGA                 |
|-------------|--------------------------|-----------------------------|
| Display     | EHB (64 colors)          | VGA (256 colors)            |
| Color depth | 6 bitplanes              | 8 bits/pixel                |
| Resolution  | 320×200                  | 320×200                     |
| Compression | RLE (custom scheme)      | None (raw indexed)          |
| Palette     | 32 × 16-bit + half-bright | 256 × 8-bit RGB            |
| Graphics API| Custom blitter           | DirectDraw                  |
| Audio       | 4-channel Paula          | DirectSound                 |

### File Size Comparison

| Data Type       | Amiga Source       | Amiga Size  | Windows Source   | Windows Size  |
|-----------------|--------------------|-------------|------------------|---------------|
| Dungeon maps    | bcdfs              | 171,005 B   | maindung.gam     | 15,099 B      |
| All resources   | bcdfa–bcdfz        | ~3.5 MB     | clipper.clp      | 1,151,267 B   |
| Executable      | BlackCrypt + overlays | ~600 KB  | crypt.exe        | 253,952 B     |

The Windows demo contains only 2 maps (vs 13 in the full game), explaining the
small `maindung.gam` size.

---

## Extracted Assets

Rendered Windows images from `clipper.clp` are stored at:
```
data/blackcrypt/bcdf_images/   (246 PNG files)
```

These include dungeon textures, title screens, item graphics, monster sprites,
UI elements, and character portraits.

Runtime-rendered captures from the Windows executable are at:
```
data/blackcrypt/extracted/     (214 PNG files)
```

These include title screens, character generation, in-game views, and various
format experiments (different bitplane interpretations, interleaving modes).
