/**
 * Eye of the Beholder (Amiga) `.CPS` decoder -- `docs/eotb/amiga/
 * data-structure.md` § "CPS -- Compressed Picture System". Used here only
 * to pull `INVENT.CPS`'s embedded 32-colour base palette that each wall
 * set's `.VCN` file patches 5 entries into (§ "Palette (VCN offset
 * 0x02...)"): "loaded into palette slots 1-5... as a small patch on top
 * of whatever 32-colour palette is already active".
 */
import { decompressLCW } from './lcw.ts';
import { decodePlanar } from '../shared/amiga-planar.ts';
import { eobAmigaWordToRGB, readBEWords } from './palette.ts';

const CPS_WIDTH = 320;
const CPS_HEIGHT = 200;
const CPS_PLANES = 5;

export interface CpsImage {
  indices: Uint8Array; // 320x200, one byte per pixel, palette index
  palette: [number, number, number][] | null; // 32 colours if this CPS carries its own (EOB1-style, trailing 64 bytes), else null
}

export function decodeCps(data: Uint8Array): CpsImage {
  const compressionType = data[2]! | (data[3]! << 8);
  const uncompressedSize = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  const paletteSize = data[8]! | (data[9]! << 8);
  const body = data.subarray(10 + paletteSize);

  let raw: Uint8Array;
  if (compressionType === 0) {
    raw = body.subarray(0, uncompressedSize);
  } else if (compressionType === 4) {
    raw = decompressLCW(body, uncompressedSize);
  } else {
    throw new Error(`decodeCps: unsupported compression type ${compressionType} (only 0/uncompressed and 4/LCW are implemented)`);
  }
  if (raw.length < uncompressedSize) {
    throw new Error(
      `decodeCps: LCW decompression produced ${raw.length} bytes, expected ${uncompressedSize} -- decoder bug or corrupt input`,
    );
  }

  const imageByteCount = (CPS_WIDTH / 8) * CPS_HEIGHT * CPS_PLANES; // 40000
  const indices = decodePlanar(raw.subarray(0, imageByteCount), CPS_WIDTH, CPS_HEIGHT, CPS_PLANES);

  let palette: [number, number, number][] | null = null;
  if (uncompressedSize === 40064) {
    // EOB1 style: trailing 64 bytes = 32 BE Amiga colour words.
    const words = readBEWords(raw, uncompressedSize - 64, 32);
    palette = words.map(eobAmigaWordToRGB);
  }

  return { indices, palette };
}
