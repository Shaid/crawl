/**
 * Lands of Lore's `.CMZ`/`.VCN`/`.VMP` files are all "Kyra bitmap" containers
 * -- the same outer header shape already confirmed for EOB1/EOB2's `.CPS`/
 * `.VCN` (`tools/eotb2/decode-vcn.ts`'s module doc), empirically re-verified
 * against real LOL files this session (`LEVEL1.CMZ`, `CATWALK.VCN`,
 * `CATWALK.VMP` all match byte-for-byte):
 *
 * - 0x00: u16 LE, always `fileSize - 2` (unused by this decoder, a sanity
 *   value only -- not the `sizeUncompressed` field some Kyra docs call it,
 *   since it doesn't match the decompressed size).
 * - 0x02: u16 LE `compType` (0 = raw, 4 = LCW/"Format 80").
 * - 0x04: u32 LE `imgSize` -- the decompressed payload length.
 * - 0x08: u16 LE `palSize` -- always 0 for CMZ/VCN/VMP in this corpus (VCN's
 *   own 384-byte palette lives *inside* the decompressed payload, not here).
 * - `0x0A + palSize`: compressed/raw body.
 *
 * `docs/landsoflore/dosvga/data-structure.md`'s "VMP" section already noted
 * LOL's `.VMP`/`.CMZ` carry this wrapper where EOB's raw files don't; this
 * module is the one shared place that unwraps it for every LOL container.
 */
import { decompressLCW } from '../eotb/lcw.ts';

export function decodeKyraBitmap(data: Uint8Array): Uint8Array {
  const compType = data[2]! | (data[3]! << 8);
  const imgSize = (data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24)) >>> 0;
  const palSize = data[8]! | (data[9]! << 8);
  const body = data.subarray(10 + palSize);

  let decompressed: Uint8Array;
  if (compType === 0) {
    decompressed = body.subarray(0, imgSize);
  } else if (compType === 4) {
    decompressed = decompressLCW(body, imgSize);
  } else {
    throw new Error(`decodeKyraBitmap: unsupported compType ${compType} (only 0/raw and 4/LCW seen in this corpus)`);
  }
  if (decompressed.length < imgSize) {
    throw new Error(
      `decodeKyraBitmap: decompression produced ${decompressed.length} bytes, expected ${imgSize} -- decoder bug or corrupt input`,
    );
  }
  return decompressed.subarray(0, imgSize);
}
