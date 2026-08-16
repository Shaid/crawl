/**
 * Eye of the Beholder II (DOS/VGA) `.VCN` wall-tileset decoder --
 * `docs/eotb/dosvga/data-structure.md` § "VCN -- Wall tileset" (confirmed
 * byte-identical structure for EOB2, `docs/eotb2/dosvga/data-structure.md`
 * § "VCN / VMP -- Wall tilesets"). Port of `EoBCoreEngine::loadVcnData` /
 * `KyraRpgEngine::vcnDraw_fw_4bit` (`_vcnSrcBitsPerPixel = 4` for DOS
 * VGA/EGA, vs. 5 for Amiga -- this is a genuinely different pixel format
 * from `tools/eotb/decode-vcn.ts`'s Amiga decoder, not a reusable one).
 *
 * A `.VCN` file is a "Kyra bitmap" (shared header: `compType` u16 LE at
 * 0x02, `imgSize` u32 LE at 0x04, `palSize` u16 LE at 0x08, payload at
 * `0x0A + palSize`), LCW-compressed (`compType=4`), parsed header-at-offset-0
 * with NO 4-byte prefix skip (confirmed empirically in this repo: the
 * `skip=true` call-site convention doesn't match this project's
 * PAK-extracted file bytes).
 *
 * Decompressed payload layout:
 * - 0x00: `numTiles` (u16 LE)
 * - 0x02: `colMap`, 32 bytes -- per-nibble palette-index remap; only
 *   `colMap[0:16]` is used by this static (no dynamic lighting) renderer
 * - 0x22: `numTiles*32` bytes tile data -- 8x8 tiles, 4 bits/pixel, packed
 *   2px/byte (high nibble = even x, low nibble = odd x), 8 rows x 4 bytes.
 *   Each nibble is looked up as `colMap[nibble]` for the true palette index.
 */
import { decompressLCW } from '../eotb/lcw.ts';

const TILE_SIZE = 8;
const TILE_BYTES = 32; // 8 rows * 4 bytes/row

export interface VcnData {
  numTiles: number;
  colMap: Uint8Array;
  /** One Uint8Array (8x8 palette indices) per tile, already remapped through colMap. */
  tiles: Uint8Array[];
}

export function decodeVcn(data: Uint8Array): VcnData {
  const compType = data[2]! | (data[3]! << 8);
  const imgSize = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  const palSize = data[8]! | (data[9]! << 8);
  const body = data.subarray(10 + palSize);

  let decompressed: Uint8Array;
  if (compType === 0) {
    decompressed = body.subarray(0, imgSize);
  } else if (compType === 4) {
    decompressed = decompressLCW(body, imgSize);
  } else {
    throw new Error(`decodeVcn: unsupported compType ${compType} (only 0/raw and 4/LCW are implemented)`);
  }
  if (decompressed.length < imgSize) {
    throw new Error(
      `decodeVcn: LCW decompression produced ${decompressed.length} bytes, expected ${imgSize} -- decoder bug or corrupt input`,
    );
  }

  const numTiles = decompressed[0]! | (decompressed[1]! << 8);
  const expectedSize = 0x22 + numTiles * TILE_BYTES;
  if (decompressed.length < expectedSize) {
    throw new Error(
      `decodeVcn: oracle check failed -- numTiles=${numTiles} implies decompressed size >= ${expectedSize}, got ${decompressed.length}`,
    );
  }
  const colMap = decompressed.subarray(0x02, 0x22);

  const tiles: Uint8Array[] = [];
  for (let i = 0; i < numTiles; i++) {
    const base = 0x22 + i * TILE_BYTES;
    const indices = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let byteInRow = 0; byteInRow < 4; byteInRow++) {
        const byte = decompressed[base + row * 4 + byteInRow]!;
        const hi = (byte >> 4) & 0xf;
        const lo = byte & 0xf;
        const x0 = byteInRow * 2;
        indices[row * TILE_SIZE + x0] = colMap[hi]!;
        indices[row * TILE_SIZE + x0 + 1] = colMap[lo]!;
      }
    }
    tiles.push(indices);
  }

  return { numTiles, colMap: Uint8Array.from(colMap), tiles };
}
