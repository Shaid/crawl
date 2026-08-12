/**
 * Wizardry 6 (Amiga) `.PIC` cel-sprite format.
 *
 * Confirmed via `re-codebreaker` disassembly of `Bane`'s cel drawer
 * (`CODE+0x35e6`) and independently re-verified in this session (731/731
 * cels' byte lengths match the mask-popcount formula with zero deviation;
 * 3,504,128 total decoded pixels with 0 out-of-range indices; palette
 * cross-checked against real rendered pixel colours). See
 * docs/wizardry6/amiga/data-structure.md section 2 for the full writeup.
 *
 * Container: a fixed 650-byte directory (25 slots x 26 bytes). Each slot:
 *   +0  u32 BE   absolute file offset of this cel's tile data (0 = unused
 *                slot / end of directory)
 *   +4  u8       tilesW  -- cel width in 8px tiles
 *   +5  u8       tilesH  -- cel height in 8px tiles
 *   +6  u8[20]   tile-presence bitmask, LSB-first, tilesW*tilesH bits
 *
 * Only *present* tiles (mask bit set) are stored, 32 bytes each
 * (4 bitplanes x 8 rows x 1 byte/row, plane-major, MSB = leftmost pixel),
 * in row-major tile order. Colour index 15 (all 4 planes set) is the
 * transparent/background key.
 */
import { decodePlanarPlaneMajor } from '../shared/amiga-planar.ts';
import type { RGB } from '../shared/amiga-planar.ts';

export interface PicCel {
  /** Index into the file's directory (0-based). */
  index: number;
  offset: number;
  tilesWide: number;
  tilesHigh: number;
  widthPx: number;
  heightPx: number;
  mask: Uint8Array;
}

const DIRECTORY_SLOTS = 25;
const SLOT_SIZE = 26;
const TILE_SIZE = 32; // 4 planes * 8 rows * 1 byte/row
const TRANSPARENT_INDEX = 15;

/** Parse a `.PIC` file's fixed directory into its real (non-zero) cel records. */
export function readPicDirectory(data: Uint8Array): PicCel[] {
  const cels: PicCel[] = [];
  for (let i = 0; i < DIRECTORY_SLOTS; i++) {
    const base = i * SLOT_SIZE;
    const offset =
      ((data[base] << 24) | (data[base + 1] << 16) | (data[base + 2] << 8) | data[base + 3]) >>>
      0;
    if (offset === 0) break;
    const tilesWide = data[base + 4];
    const tilesHigh = data[base + 5];
    const mask = data.slice(base + 6, base + 26);
    cels.push({
      index: i,
      offset,
      tilesWide,
      tilesHigh,
      widthPx: tilesWide * 8,
      heightPx: tilesHigh * 8,
      mask,
    });
  }
  return cels;
}

function maskBit(mask: Uint8Array, tileIndex: number): boolean {
  return ((mask[tileIndex >> 3] >> (tileIndex & 7)) & 1) === 1;
}

/**
 * Decode one cel to an 8-bit chunky index buffer (own width x height).
 * Blank/absent tiles render as the transparent index (15), matching the
 * game's own work-buffer pre-fill (0xFF bytes -> all-planes-set -> index 15).
 */
export function decodePicCel(data: Uint8Array, cel: PicCel): Uint8Array {
  const { tilesWide, tilesHigh, widthPx, heightPx, mask, offset } = cel;
  const indices = new Uint8Array(widthPx * heightPx).fill(TRANSPARENT_INDEX);
  let src = offset;
  let tileIndex = 0;
  for (let ty = 0; ty < tilesHigh; ty++) {
    for (let tx = 0; tx < tilesWide; tx++) {
      if (maskBit(mask, tileIndex)) {
        const tile = decodePlanarPlaneMajor(data, src, 8, 8, 4);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            indices[(ty * 8 + y) * widthPx + (tx * 8 + x)] = tile.indices[y * 8 + x];
          }
        }
        src += TILE_SIZE;
      }
      tileIndex++;
    }
  }
  return indices;
}

/** Compute this cel's expected byte length from its mask (verification helper). */
export function picCelByteLength(cel: PicCel): number {
  const n = cel.tilesWide * cel.tilesHigh;
  const nbytes = Math.ceil(n / 8);
  let popcount = 0;
  for (let i = 0; i < nbytes; i++) {
    let b = cel.mask[i];
    while (b) {
      popcount += b & 1;
      b >>= 1;
    }
  }
  return TILE_SIZE * popcount;
}

/**
 * Confirmed palette (`Bane` `CODE+0x17b6`, loaded via graphics.library
 * `LoadRGB4`): standard EGA/CGA 16-colour set in a permuted pen order.
 * Index 15 doubles as the transparent key.
 */
export const PIC_PALETTE: RGB[] = [
  0x000, 0xfff, 0x55f, 0xf5f, 0xf55, 0xff5, 0x5f5, 0x5ff, 0x555, 0xaaa, 0x00a, 0xa0a, 0xa00, 0xa50,
  0x0a0, 0x0aa,
].map((v) => ({
  r: ((v >> 8) & 0xf) * 17,
  g: ((v >> 4) & 0xf) * 17,
  b: (v & 0xf) * 17,
}));

/** Convert a decoded cel's index buffer to RGBA, index 15 rendered transparent. */
export function celIndicesToRGBA(indices: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const c = PIC_PALETTE[idx];
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = idx === TRANSPARENT_INDEX ? 0 : 255;
  }
  return rgba;
}
