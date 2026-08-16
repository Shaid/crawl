/**
 * Lands of Lore `.VCN` wall-tileset decoder -- `docs/landsoflore/dosvga/
 * data-structure.md` § "VCN" (confirmed structure AND colour). Genuinely
 * different header from both EOB1's Amiga port and EOB2's DOS port
 * (`tools/eotb/decode-vcn.ts`/`tools/eotb2/decode-vcn.ts`) -- LOL embeds
 * its own 384-byte (128-colour) palette inside the decompressed payload
 * rather than sourcing it from a sibling `.PAL` file or a small in-file
 * patch table, so this is a real second decoder, not a re-export.
 *
 * Decompressed payload (`decodeKyraBitmap` strips the outer Kyra-bitmap/
 * LCW wrapper first):
 * - 0x00: u16 LE `numTiles`
 * - 0x02: `numTiles` bytes `vcnShift` -- per-tile brightness/lighting
 *   selector (doc: "not previously documented"). This session's own
 *   re-verification against `CATWALK.VCN` confirmed the byte layout and
 *   total size (`2 + numTiles + 128 + 384 + numTiles*32` exactly), but the
 *   *pixel formula* using `vcnShift` isn't independently confirmed from
 *   source -- see below.
 * - `2 + numTiles`: 128 bytes `vcnColTable`
 * - `2 + numTiles + 128`: 384 bytes `palette` (128 colours x 3 bytes, VGA
 *   6-bit RGB -- same `(v<<2)|(v&3)` expansion as EOB's `.PAL`)
 * - `2 + numTiles + 128 + 384`: `numTiles*32` bytes tile data, same 8x8
 *   4bpp packing as EOB2's `.VCN` (2px/byte, high nibble = even x)
 *
 * **Pixel formula -- inferred, not cited from source, flagged honestly.**
 * `vcnColTable` is 128 = 8*16 bytes: 8 selectable 16-entry nibble->palette-
 * index sub-tables. Real `vcnShift` bytes across every wall set checked
 * this session (KEEP/MANOR/SWAMP/URBISH/CAVE1) take exactly the 8 values
 * `{0,16,32,...,112}` -- i.e. `vcnShift[tileIndex]` IS the sub-table's
 * byte offset directly, not a 0-7 index needing a further `*16` (an
 * earlier version of this module used `(shift & 7) * 16`, which collapses
 * every nonzero multiple of 16 to offset 0 since they all have zero low
 * bits -- caught by CAVE1 rendering as garish, incoherent neon-green
 * noise while the other 4 wall sets happened to look plausible anyway;
 * fixed and re-verified all 5 render coherently). `paletteIndex =
 * vcnColTable[vcnShift[tileIndex] + nibble]`, safely within the 128-byte
 * table for every real value seen (max `112 + 15 = 127`). The *exact*
 * semantics (brightness ramp? per-tile lighting state?) still aren't
 * confirmed against `engine/scene_lol.cpp` source, only the byte-offset
 * reading -- if a future session finds the real `vcnDraw`-equivalent for
 * LOL, check this against it.
 */
import { decodeKyraBitmap } from './kyra-bitmap.ts';

const TILE_SIZE = 8;
const TILE_BYTES = 32; // 8 rows * 4 bytes/row
const COL_TABLE_SIZE = 128;
const PALETTE_BYTES = 384; // 128 colours x 3

export interface VcnData {
  numTiles: number;
  palette: [number, number, number][];
  /** One Uint8Array (8x8 palette indices, already colour-table-remapped) per tile. */
  tiles: Uint8Array[];
}

const expand6to8 = (v: number) => ((v & 0x3f) << 2) | (v & 3);

export function decodeVcn(data: Uint8Array): VcnData {
  const decompressed = decodeKyraBitmap(data);

  const numTiles = decompressed[0]! | (decompressed[1]! << 8);
  const expectedSize = 2 + numTiles + COL_TABLE_SIZE + PALETTE_BYTES + numTiles * TILE_BYTES;
  if (decompressed.length < expectedSize) {
    throw new Error(
      `decodeVcn: oracle check failed -- numTiles=${numTiles} implies decompressed size >= ${expectedSize}, got ${decompressed.length}`,
    );
  }

  const vcnShift = decompressed.subarray(2, 2 + numTiles);
  const colTableOff = 2 + numTiles;
  const vcnColTable = decompressed.subarray(colTableOff, colTableOff + COL_TABLE_SIZE);
  const paletteOff = colTableOff + COL_TABLE_SIZE;
  const paletteRaw = decompressed.subarray(paletteOff, paletteOff + PALETTE_BYTES);
  const tileDataOff = paletteOff + PALETTE_BYTES;

  const palette: [number, number, number][] = [];
  for (let i = 0; i < PALETTE_BYTES / 3; i++) {
    const o = i * 3;
    palette.push([expand6to8(paletteRaw[o]!), expand6to8(paletteRaw[o + 1]!), expand6to8(paletteRaw[o + 2]!)]);
  }

  const tiles: Uint8Array[] = [];
  for (let i = 0; i < numTiles; i++) {
    const base = tileDataOff + i * TILE_BYTES;
    const subTable = vcnShift[i]!;
    const indices = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let byteInRow = 0; byteInRow < 4; byteInRow++) {
        const byte = decompressed[base + row * 4 + byteInRow]!;
        const hi = (byte >> 4) & 0xf;
        const lo = byte & 0xf;
        const x0 = byteInRow * 2;
        indices[row * TILE_SIZE + x0] = vcnColTable[subTable + hi]!;
        indices[row * TILE_SIZE + x0 + 1] = vcnColTable[subTable + lo]!;
      }
    }
    tiles.push(indices);
  }

  return { numTiles, palette, tiles };
}
