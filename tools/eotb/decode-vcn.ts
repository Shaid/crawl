/**
 * Eye of the Beholder (Amiga) `.VCN` wall-view tile decoder --
 * `docs/eotb/amiga/data-structure.md` § "VCN -- Wall View Data",
 * "Structure -- confirmed... (2026-08-02, ScummVM source)", porting
 * `EoBEngine::loadVcnData`'s `kPlatformAmiga` branch byte-for-byte:
 * `numTiles` (u16 LE) -> 5 BE Amiga palette words (patched into palette
 * slots 1-5) -> 22 reserved bytes -> `numTiles` raw (uncompressed) 8x8
 * 5-bitplane tiles, 40 bytes each.
 *
 * **Per-tile plane layout -- row-interleaved, not plane-sequential.**
 * The cited doc's "8 rows x 1 byte/row x 5 planes = 40 bytes/tile" phrase
 * is agnostic about which dimension varies fastest, and a first pass here
 * assumed plane-sequential (all 8 rows of plane 0, then plane 1, ...) --
 * the convention full-screen Amiga bitmaps (and this repo's own `.CPS`
 * decoder, `decode-cps.ts`) use. That produced structurally-plausible-
 * looking but pixel-garbled tiles (confirmed by rendering both a raw
 * sequential tile grid and real in-game poses -- coherent-looking index
 * *sequences* from `.VMP`, but visual noise once decoded to pixels).
 * Row-interleaved (row0's 5 planes together, then row1's, ...) -- tried
 * next because it's the more common convention for small Amiga
 * sprite/tile graphics -- produces a decisive, legible brick-coursing
 * stone texture instead. `tools/shared/amiga-planar.ts`'s
 * `decodePlanarRowInterleaved` already implements this (built for a
 * different game); reused directly rather than re-implementing.
 */
import { decodePlanarRowInterleaved } from '../shared/amiga-planar.ts';
import { eobAmigaWordToRGB, readBEWords } from './palette.ts';

const TILE_SIZE = 8;
const TILE_PLANES = 5;
const TILE_BYTES = 40; // 8 rows * 1 byte/row * 5 planes

export interface VcnData {
  numTiles: number;
  /** 5 patch colours for palette slots 1-5, already RGB. */
  patchColors: [number, number, number][];
  /** One Uint8Array (8x8 palette indices, 0-31) per tile. */
  tiles: Uint8Array[];
}

export function decodeVcn(data: Uint8Array): VcnData {
  const numTiles = data[0]! | (data[1]! << 8);
  const expectedSize = 0x22 + numTiles * TILE_BYTES;
  if (data.length !== expectedSize) {
    throw new Error(
      `decodeVcn: oracle check failed -- numTiles=${numTiles} implies file size ${expectedSize}, got ${data.length}`,
    );
  }

  const patchWords = readBEWords(data, 0x02, 5);
  const patchColors = patchWords.map(eobAmigaWordToRGB);

  const tiles: Uint8Array[] = [];
  for (let i = 0; i < numTiles; i++) {
    tiles.push(decodePlanarRowInterleaved(data, 0x22 + i * TILE_BYTES, TILE_SIZE, TILE_SIZE, TILE_PLANES).indices);
  }

  return { numTiles, patchColors, tiles };
}

/**
 * Build the effective 32-colour wall-set palette: `basePalette` (from
 * `INVENT.CPS`'s embedded palette) with slots 1-5 overwritten by this
 * VCN's patch colours.
 */
export function applyVcnPalette(basePalette: [number, number, number][], vcn: VcnData): [number, number, number][] {
  const palette = basePalette.slice();
  for (let i = 0; i < 5; i++) palette[1 + i] = vcn.patchColors[i]!;
  return palette;
}
