/**
 * Eye of the Beholder II (DOS/VGA) `.CPS` full-screen bitmap decoder --
 * used here to decode the decoration shape sheets (`BROWN1.CPS`,
 * `MEZZ2.CPS`, `CRIMSON.CPS`, ...) that `tools/eotb2/decode-inf.ts`'s
 * `resolveWallDecorationAssignments` resolves each wall-mapping override
 * against. **Not the same decoder as `tools/eotb/decode-cps.ts`** (EOB1
 * Amiga): that one deinterleaves 5 Amiga bitplanes; EOB2 DOS/VGA is
 * **chunky 8-bit-per-pixel** (one byte = one palette index, no planar
 * decode at all) -- confirmed empirically this session: every real
 * decoration `.CPS` file in this corpus (`BROWN1/2`, `FOREST`, `MEZZ1/2`,
 * `SILVER1/2`, `AZURE1/2`, `CRIMSON`) decompresses to exactly `320*200 =
 * 64000` bytes with 0 residue via the same Kyra-bitmap-header + LCW
 * pipeline `decode-vcn.ts`/`decode-inf.ts` already use for this port
 * (`compType` u16 LE @0x02, `imgSize` u32 LE @0x04, `palSize` u16 LE
 * @0x08, payload @ `0x0A + palSize`; every sampled file has `palSize=0`
 * and `imgSize=64000`).
 */
import { decompressLCW } from '../eotb/lcw.ts';

const CPS_WIDTH = 320;
const CPS_HEIGHT = 200;
const CPS_SIZE = CPS_WIDTH * CPS_HEIGHT;

export interface CpsImage {
  width: number;
  height: number;
  indices: Uint8Array; // 320x200, one byte per pixel, palette index (chunky, no planar decode)
}

export function decodeCps(data: Uint8Array): CpsImage {
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
    throw new Error(`decodeCps: unsupported compType ${compType} (only 0/raw and 4/LCW are implemented)`);
  }
  if (decompressed.length < CPS_SIZE) {
    throw new Error(`decodeCps: oracle check failed -- decompressed ${decompressed.length} bytes, expected >= ${CPS_SIZE} (320x200 chunky)`);
  }

  return { width: CPS_WIDTH, height: CPS_HEIGHT, indices: decompressed.subarray(0, CPS_SIZE) };
}
