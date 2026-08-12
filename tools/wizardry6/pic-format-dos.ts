/**
 * Wizardry 6 (DOS/EGA) `.PIC` cel-sprite format.
 *
 * The DOS release ships the *same artwork* as the Amiga release in the *same*
 * 4-plane 8x8-tile encoding; only two things differ:
 *
 *  1. the file is compressed with the block RLE in `dos-rle.ts`, and
 *  2. the directory slot is 24 bytes instead of 26, because the cel offset is
 *     a `u16` little-endian instead of a `u32` big-endian.
 *
 * Decompressed layout (confirmed):
 *
 *   +0x000  25 slots x 24 bytes -- the directory (always 600 bytes)
 *   +0x258  cel tile data, 32 bytes per present tile
 *
 * Directory slot:
 *
 *   | Offset | Size | Field   | Notes                                        |
 *   |--------|------|---------|----------------------------------------------|
 *   | +0     | 2    | offset  | u16 LE, absolute offset *into the decompressed |
 *   |        |      |         | image*; 0 = unused slot / end of directory     |
 *   | +2     | 1    | tilesW  | cel width in 8px tiles                        |
 *   | +3     | 1    | tilesH  | cel height in 8px tiles                       |
 *   | +4     | 20   | mask    | tile-presence bitmask, LSB-first, tilesW*tilesH bits |
 *
 * Every field except the offset's width/endianness is byte-identical to the
 * Amiga slot, and each DOS offset is exactly its Amiga counterpart minus 50
 * (= 25 slots x the 2 bytes saved per slot).
 *
 * Tile data, palette and transparency are unchanged from the Amiga format, so
 * `decodePicCel`, `picCelByteLength`, `PIC_PALETTE` and `celIndicesToRGBA` in
 * `pic-format.ts` are reused verbatim -- see `docs/wizardry6/dosega/data-structure.md`
 * section 2 for the verification evidence.
 */
import { decompressDosRle } from './dos-rle.ts';
import type { PicCel } from './pic-format.ts';

const DIRECTORY_SLOTS = 25;
const DOS_SLOT_SIZE = 24;

/** Size in bytes of the decompressed directory (25 x 24). */
export const DOS_DIRECTORY_SIZE = DIRECTORY_SLOTS * DOS_SLOT_SIZE;

/** Decompress a DOS `.PIC` file to its native uncompressed image. */
export function decompressPic(file: Uint8Array): Uint8Array {
  return decompressDosRle(file);
}

/**
 * Parse a *decompressed* DOS `.PIC` image's directory into its real
 * (non-zero) cel records. Offsets are relative to `data`'s own start, so the
 * returned records can be fed straight to `decodePicCel(data, cel)`.
 */
export function readPicDirectoryDos(data: Uint8Array): PicCel[] {
  const cels: PicCel[] = [];
  for (let i = 0; i < DIRECTORY_SLOTS; i++) {
    const base = i * DOS_SLOT_SIZE;
    const offset = data[base] | (data[base + 1] << 8);
    if (offset === 0) break;
    const tilesWide = data[base + 2];
    const tilesHigh = data[base + 3];
    cels.push({
      index: i,
      offset,
      tilesWide,
      tilesHigh,
      widthPx: tilesWide * 8,
      heightPx: tilesHigh * 8,
      mask: data.slice(base + 4, base + 24),
    });
  }
  return cels;
}

/** Convenience: decompress a DOS `.PIC` file and parse its directory. */
export function readDosPic(file: Uint8Array): { data: Uint8Array; cels: PicCel[] } {
  const data = decompressPic(file);
  return { data, cels: readPicDirectoryDos(data) };
}
