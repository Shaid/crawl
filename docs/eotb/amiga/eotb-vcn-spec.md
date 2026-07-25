# Eye of the Beholder VCN Format

From ModdingWiki

**Eye of the Beholder VCN Format**

Format type: Tileset
Hardware: VGA
Max tile count: 65535
Palette: Internal, External
Tile names: No
Minimum tile size (pixels): 8×8
Maximum tile size (pixels): 8×8
Plane count: 1
Plane arrangement: Linear
Transparent pixels: Palette-based
Hitmap pixels: No
Metadata: None
Supports sub-tilesets: No
Compressed tiles: No
Hidden data: No

Games: Eye of the Beholder, Eye of the Beholder II: The Legend of Darkmoon, Lands of Lore: The Throne of Chaos

The **VCN** file stores 8×8 image tiles that form the game's 3D view window, the "view cone." These tiles are used to build the backdrop of a level (floor and ceiling), as well as the wall segments shown from different distances and angles.

The VCN tiles are combined at runtime according to layout data in the corresponding **VMP** file, which defines how each wall and corridor segment is assembled from these tiles. Together, the VCN and VMP files generate the illusion of depth as the player moves through the grid-based dungeon. The VCN and VMP file are referenced in the level's **INF** file.

The name **VCN** possibly stands for View Cone, referring to the visible area of the 3D viewport, or View Compressed Nibble, reflecting that each tile stores 4-bit (nibble) pixel data.

## Contents

- File Structure (PC version)
- Amiga Version (16-color planar)
- Lands of Lore Version (128-color extended format)
- Tiles
- Rendering
- Relationship to INF, VMP, and PAL
- Summary
- See Also
- Sources

## File Structure (PC version)

In the PC version, VCN files are compressed, using the Westwood LCW compression (see Westwood CPS Format). In the demo, they are uncompressed.

The uncompressed data has this structure:

| Offset | Size | Description |
|--------|------|-------------|
| 0x00 | 2 bytes (LE) | Number of 8×8 tiles contained in the file. |
| 0x02 | 16 bytes | Backdrop palette – 16 color indices (0–255). |
| 0x12 | 16 bytes | Wall palette – 16 color indices (0–255). |
| 0x22 | 32 × N bytes | Pixel data for N tiles, each 8×8 pixels (4 bits per pixel, i.e. two pixels per byte). |

```c
struct VCN {
    uint16_t tile_count;
    uint8_t  back_palette[16];
    uint8_t  wall_palette[16];
    struct Tile {
        uint8_t pixels[4][8]; // 8×8 pixels, 4 bytes per row
    } blocks[tile_count];
};
```

- **tile_count** – Number of 8×8 tiles in the file.
- **back_palette** – 16 palette indices used for backdrop tiles (floor/ceiling).
- **wall_palette** – 16 palette indices used for wall tiles.
- **tiles** – Array of tile data. Each byte encodes two 4-bit pixel indices.

## Amiga Version (16-color planar)

The Amiga version uses a slightly different layout and 5-bit planar graphics instead of nibble-packed pixels.

```c
struct VCN {
    uint16_t tile_count;
    uint16_t palette[16];
    struct Tile {
        uint8_t pixels[5][8];
    } tiles[tile_count];
};
```

- **tile_count** – Number of tiles in the file.
- **palette** – 16-entry palette in the same format as CPS files.
  - Each entry replaces index [I]+1 in the global palette from `INVENT.CPS`.
  - Colors of value `0x0000` are ignored.
  - *EOB2* uses an external 32-color palette in $xRGB format.
- **tiles** – Array of 8×8 planar tiles, 5 bitplanes deep.

Planar → chunky conversion example:
```c
uint8_t chunky[8][8];
for (int y = 0; y < 8; y++)
  for (int x = 0; x < 8; x++) {
    int bit = 1 << (7 - x);
    uint8_t data = 0;
    for (int plane = 0; plane < 5; plane++)
      if (rawPlanarData[plane][y] & bit) data |= (1 << plane);
    chunky[y][x] = data;
  }
```

## Lands of Lore Version (128-color extended format)

The *Lands of Lore* engine uses an extended variant of the VCN format supporting 128 colors and multiple palette tables.

```c
struct VCN {
    uint16_t tile_count;
    uint8_t  tile_palette_pos_table[tile_count];
    struct PosPaletteTables {
        uint8_t backdrop_wall_palettes[16];
    } pos_palette_tables[8];
    uint8_t palette[3*128]; // 128 colors, 24-bit
    struct Tile {
        uint8_t pixels[4][8];
    } tiles[tile_count];
};
```

- **tile_count** – Number of 8×8 tiles.
- **tile_palette_pos_table** – For each tile, an index (0–7) into the `pos_palette_tables`.
- **pos_palette_tables** – 8 tables of 16 entries each, defining color positions within the 256-color master palette.
- **palette** – Local 128-color palette (3 bytes per entry, EOB-format RGB).
- **tiles** – Tile data (two pixels per byte).

**Notes:**
- PC and LoL versions use 4-bit "nibble" pixels; Amiga uses 5-bit planar data.
- All versions rely on external palettes to map indices to RGB colors.
- The number of blocks determines the total number of 8×8 tiles available for constructing the dungeon view.

## Tiles

The very first tile is fully transparent, 7 tilesets follow. The first are the tiles for the backdrop (ceiling/floor), then 6 different wall types (including doorways and stairs) follow.

## Rendering

Each 8×8 tile stores pixel values as **palette indices**, which are mapped in two steps:

1. **Local palette lookup** – Each tile references either the **backdrop palette** or the **wall palette**. Which palette is used depends on the tile index, as specified by the VMP layout.
2. **Global palette lookup** – The palette index is then used to select an actual RGB color from the **level's PAL file** (e.g., BRICK.PAL), as specified in the level's INF file.

### Example (wall tile)

```
raw pixel byte = 0x53
→ high nibble = 5 → pixel 1
→ low nibble  = 3 → pixel 2

Step 1: Local palette lookup
pixel 1: wall_palette[5] → 7
pixel 2: wall_palette[3] → 4

Step 2: Global palette lookup
pixel 1 RGB = BRICK.PAL[7]
pixel 2 RGB = BRICK.PAL[4]
```

**Note:** A palette index of 0 is treated as *transparent*, and no pixel is drawn for that position in the viewport.

## Relationship to INF, VMP, and PAL

Each level in *Eye of the Beholder* references a set of resource files that define its appearance. The **INF** file serves as the level's manifest, specifying which **VNP**, **VCN**, and **PAL** files to use.

- **VCN** – Contains the raw 8×8 tiles for walls and backdrop components.
- **VMP** – Provides a layout map: it stores indices into the VCN file, defining which tile to place where in the view cone.
- **PAL** – Defines the RGB colors corresponding to palette indices used in the VCN tiles.

Together, these files allow the engine to construct the **view cone** dynamically:
1. The VMP file tells the engine which 8×8 tiles from the VCN to use for each wall projection and the backdrop.
2. Each tile references either the backdrop or wall palette.
3. The palette indices are then mapped to RGB values from the level's PAL file.
4. The engine combines the tiles according to the VMP layout to render the final 3D view.

## Summary

- Contains 8×8 nibble-encoded tiles.
- Uses two intermediate 16-color palettes (backdrop and wall) and PAL palette from level INF file.
- Indexed by matching VMP layout file.

Sources: https://web.archive.org/web/20180521003835/http://eob.wikispaces.com/eob.vcn
