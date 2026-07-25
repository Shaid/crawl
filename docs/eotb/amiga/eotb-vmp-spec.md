# Eye of the Beholder VMP Format

From ModdingWiki

*This article is partially complete. This means that all known information is here, but there is still more information that needs to be discovered and/or reverse engineered.*

**Eye of the Beholder VMP Format**

Format type: Map/level
Map type: 2D tile-based
Layer count: 5
Tile size (pixels): 8×8
Viewport (pixels): 176×120

Games: Eye of the Beholder, Eye of the Beholder II: The Legend of Darkmoon, Lands of Lore: The Throne of Chaos

The `.VMP` file assembles the tiles from the associated `.VCN` tileset. It functions similarly to a map file in other video games, except that in Eye of the Beholder it does not represent a top-down layout. Instead, it defines the 3D view of the dungeon, often referred to as the *view cone*.

In essence, the `.VMP` file contains a collection of indices that reference tile graphics within the `.VCN` file. These indices are interpreted by the game's main executable to construct the player's first-person view of the world.

## File Format (PC version)

In Lands of Lore: The Throne of Chaos, `.VMP` files are compressed, using the Westwood LCW compression (see Westwood CPS Format). The uncompressed format is defined as follows:

```c
struct VMP { 
    unsigned short index_count; 
    unsigned short indices[index_count]; 
};
```

Each entry in `indices` represents an index that references a specific block in the associated `.VCN` file.

## File Format (Amiga version)

```c
struct VMP { 
    unsigned short header; 
    unsigned short backdrop_tiles[22][15]; 
    unsigned short padding[101]; 
    unsigned short wall_tiles[wall_types_count][431]; 
};
```

- **header** – Not yet fully investigated, but most likely specifies the number of wall types defined in the file.
- **backdrop_tiles** – Tile indices defining the static backdrop (ceiling/floor) image.
- **padding** – Each wall type uses 431 tile indices. To match this count for the backdrop tiles, a padding of 101 empty indices is added (`22 × 15 + 101 = 431`).
- **wall_tiles** – Tile indices defining the wall graphics for each wall type.
- **wall_types_count** – Probably stored in the header, but can also be calculated as: `(filesize - 2) / (431 * 2) - 1`

## Tile Index

Each index is represented as a 16-bit value using the following bit structure (most significant bits first):

```c
struct TileIndex { 
    bool z_mask: 1; 
    bool mirror_x: 1; 
    unsigned tile_index: 14; 
};
```

- **z_mask** – When `true`, only draw onto the transparent pixels of the tile(s) below. In effect, acts as a mask for z-order, so the drawn tile appears behind the tile being drawn over.
- **mirror_x** – When `true` flip the tile horizontally.
- **tile_index** – A 14-bit index selecting a specific tile from the corresponding `.VCN` tileset.

## Rendering the View Cone

The 3D view in Eye of the Beholder covers an area of **22 × 15 tiles** and is composed of five layers — the backdrop (ceiling and floor) and four wall layers. The backdrop is rendered first and provides the ceiling and floor as a single combined image. The wall layers are then drawn on top, alternating between front-facing and side-facing walls to construct the 3D perspective.

```
Layer 5 (backdrop)  
                                  ─────────────────────────────────
Layer 4                               A | B | C | D | E | F | G 
                                         ─── ─── ─── ─── ─── 
Layer 3                                   H | I | J | K | L 
                                             ─── ─── ─── 
Layer 2                                       M | N | O 
                                             ─── ─── ─── 
Layer 1 (closest)                             P | ^ | Q  
```

The caret (`^`) represents the party's position. Vertical bars (`|`) and overbars (`───`) in the diagram denote walls at various distances.

In total, there are 25 distinct wall positions within the player's field of vision. To render all walls correctly, the engine must read 17 map cells (A–Q) from the dungeon layout.

The first 22 × 15 = **330** tile indices are used for the backdrop. The background is horizontally flipped when `party.x & party.y & party.direction == 1`. In other words, certain movements or rotations from the current position cause the background to appear mirrored.

What follows are **431** tile indices per wall type. Eye of the Beholder has 6 different wall types: solid wall type 1, solid wall type 2, door frame, stairs up, stairs down and portal. The wall types are defined in the Maze Format files. Each block in the MAZ file has wall information for all 4 walls (north, east, south, west) from which the wall type is inferred - for each wall in the level.

## Render Code

Pseudo code for rendering the background:

```c
void drawBackground(bool xflip)
{
   for (int y=0; y<15; y++)
   {
      for (int x=0; x<22; x++)
      {
         int tile;
 
         if (xflip)
            tile=vmp.backgroundTiles[21-x][y];
         else
            tile=vmp.backgroundTiles[x][y];
 
         /* xor with xflip to make block flip and background flip cancel each other out. */
         int blockFlip = (tile&0x4000)^flipX;
         int blockIndex= tile&0x3fff;
 
         if (blockFlip)
            drawBlockXFlip(x*8, y*8, vcn.blocks[blockIndex]);
         else
            drawBlock(x*8, y*8, vcn.blocks[blockIndex]);
      }
   }
}
```

To render the walls, use this structure:

```c
struct WallRenderData
{
   int baseOffset;
   int offsetInViewPort;
   int visibleWidthInBlocks;
   int visibleHeightInBlocks;
   int skipValue;
   int flipFlag;
} wallRenderData[25] /* 25 different wall positions */
```

- **baseOffset** – Base offset into tileIndices[wallType-1]. This is an offset into the 431 index block for each wall type. So for stairs up (type 4) at position B the total offset would be 330 + (4-1) * 431 + 102.
- **offsetInViewPort** – Where to start rendering in the viewport: `xpos = offsetInViewPort % 22; ypos = offsetInViewPort / 22;`
- **visibleWidthInBlocks** – how many tiles to render in x direction.
- **visibleHeightInBlocks** – how many tiles to render in y direction.
- **skipValue** – Number of tiles to the next row in the tileIndices[wallType-1] array.
- **flipFlag** – `True` if the wall is to be x-flipped in the viewport. Generally all right-walls are x-flipped.

```c
{
   /* Side-Walls left back */
   { 104, 66,  5,  1,  2, 0},             /* A-east */
   { 102, 68,  5,  3,  0, 0},             /* B-east */
   {  97, 74,  5,  1,  0, 0},             /* C-east */
 
   /* Side-Walls right back */
   {  97, 79,  5,  1,  0, 1},              /* E-west */
   { 102, 83,  5,  3,  0, 1},              /* F-west */
   { 104, 87,  5,  1,  2, 1},              /* G-west */
 
   /* Frontwalls back */
   { 133, 66,  5,  2,  4, 0},              /* B-south */
   { 129, 68,  5,  6,  0, 0},              /* C-south */
   { 129, 74,  5,  6,  0, 0},              /* D-south */
   { 129, 80,  5,  6,  0, 0},              /* E-south */
   { 129, 86,  5,  2,  4, 0},              /* F-south */
 
   /* Side walls middle back left */
   { 117, 66,  6,  2,  0, 0},              /* H-east */
   {  81, 50,  8,  2,  0, 0},              /* I-east */
 
   /* Side walls middle back right */
   {  81, 58,  8,  2,  0, 1},              /* K-west */
   { 117, 86,  6,  2,  0, 1},              /* L-west */
 
   /* Frontwalls middle back */
   { 163, 44,  8,  6,  4, 0},              /* I-south */
   { 159, 50,  8, 10,  0, 0},              /* J-south */
   { 159, 60,  8,  6,  4, 0},              /* K-south */
 
   /* Side walls middle front left */
   {  45, 25, 12,  3,  0, 0},              /* M-east */
 
   /* Side walls middle front right */
   {  45, 38, 12,  3,  0, 1},              /* O-west */
 
   /* Frontwalls middle front */
   { 252, 22, 12,  3, 13, 0},              /* M-south */
   { 239, 41, 12,  3, 13, 0},              /* O-south */
   { 239, 25, 12, 16,  0, 0},              /* N-south */
 
   /* Side wall front left */
   {  0,  0, 15,  3,  0, 0},              /* P-east */
 
   /* Side wall front right */
   {  0, 19, 15,  3,  0, 1},              /* Q-west */
};
```

Pseudo code for rendering a wall:

```c
/* wallType = wallType index acquired from the wallMapping[mazeByte].wallType. See the .inf file.
 * wallPosition = index to wall position in the viewport.
 */
void drawWall(int wallType, int wallPosition)
{
   /* 0x4000 because when x-ored with this flip flag in the tile data,
      the resulting flip state will be correct */
   int flipX=wallRenderData[wallPosition].flipFlag ? 0:0x4000;
   int offset=wallRenderData[wallPosition].baseOffset;
 
   for (int y=0; y<wallRenderData[wallPosition].visibleHeightInBlocks; y++)
   {
      for (int x=0; x<wallRenderData[wallPosition].visibleWidthInBlocks; x++)
      {
         int blockIndex;
         if (flipX==0)
         {
            blockIndex=x+y*22+wallRenderData[wallPosition].offsetInViewPort;
         }
         else
         {
            blockIndex=wallRenderData[wallPosition].offsetInViewPort+
                       wallRenderData[wallPosition].visibleWidthInBlocks-
                       1-
                       x+y*22;
         }
 
         int xpos=blockIndex%22;
         int ypos=blockIndex/22;
 
         int tile=vmp.wallTiles[wallType][offset];
 
         /* xor with wall flip-x to make block flip and wall flip cancel each other out. */
         int blockFlip = (tile&0x4000)^flipX;
         int blockIndex= tile&0x3fff;
 
         if (blockFlip)
            drawBlockXFlip(xpos*8, ypos*8, vcn.blocks[blockIndex]);
         else
            drawBlock(xpos*8, ypos*8, vcn.blocks[blockIndex]);
 
         offset++;
      }
      offset+=wallRenderData[wallPosition].skipValue;
   }
}
```

## Relationship to INF, VMP, and MAZ

Each level in Eye of the Beholder references a set of resource files that define its appearance. The **INF** file serves as the level's manifest, specifying which **VNP**, **VCN**, and **MAZ** files to use.

- **VCN** – Contains the raw 8×8 tiles for walls and backdrop components.
- **VMP** – Provides a layout map: it stores indices into the VCN file, defining which tile to place where in the view cone.
- **MAZ** – Defines the wall parameters for each wall in each block (north, east, south, west). From the wall parameters, the wall types are determined (type 1, type 2, doorway, stairs up, stairs down, portal).

Together, these files allow the engine to construct the **view cone** dynamically:
1. The MAZ file tells the engine which wall type to use for which location. (Sidenote: this can be dynamically changed via scripts in the INF file, so the MAZ file only supplies initial values)
2. The VMP file tells the engine which 8×8 tiles from the VCN to use for each wall projection and the backdrop.
3. The engine combines the tiles according to the VMP layout to render the final 3D view.

## Summary

- Defines the 3D dungeon view ("view cone") by indexing tiles from the associated .VCN tileset.
- Contains 330 backdrop tile indices and 431 tile indices per wall type.
- Used together with VCN (tile graphics), MAZ (wall definitions), and INF (level manifest) files.
- Tile indices include bit flags for horizontal flip and z-mask rendering.

Sources: https://web.archive.org/web/20180521005936/http://eob.wikispaces.com/eob.vmp
