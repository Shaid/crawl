/**
 * Eye of the Beholder II (Amiga) `.CPS` full-screen bitmap decoder.
 *
 * **Confirmed (2026-09-02): Amiga bitplane pixel layout (like EOB1
 * Amiga), but EOB2's own header-embedded-palette convention (like EOB2
 * DOS).** Every sampled `.CPS` in `data/eotb2/amiga/data/` decompresses
 * to exactly `40000` bytes (320x200 / 8 * 5 planes -- Amiga 5-bitplane,
 * NOT EOB2 DOS's chunky `64000`-byte 8bpp `../decode-cps.ts`). The
 * container/header shape is the shared 10-byte "Kyra bitmap" header
 * (`compType` u16 LE @0x02, `imgSize` u32 LE @0x04, `palSize` u16 LE
 * @0x08); `palSize` is **not zero** for some files (`DARKMOON.CPS`,
 * `MENU.CPS`, `HEROES.CPS` all have `palSize=64`) and those 64 bytes sit
 * **right after the 10-byte header, before the LCW-compressed body** --
 * this is EOB2's own "PaletteSize > 0, embedded in the file header"
 * convention (`docs/eotb/amiga/data-structure.md` § "Palette Locations" →
 * "EOB2 style"), not EOB1 Amiga's "trailing 64 bytes after decompression
 * when uncompressedSize==40064" convention
 * (`tools/eotb/decode-cps.ts`) -- EOB1's own reader only *skips* those
 * header-palSize bytes without parsing them into a palette, since EOB1
 * never needs to (this game does).
 *
 * 64 bytes / 2 = 32 colours, same BE-Amiga-12-bit-word encoding as `./
 * palette.ts`'s standalone `.PAL` files and EOB1's `.VCN` patch words --
 * reuses `eobAmigaWordToRGB`/`readBEWords` directly.
 *
 * Decoration-sheet `.CPS` files (`BROWN1.CPS`, `CRIMSON.CPS`, etc, the
 * EOB2-specific per-wall-set shape sheets `resolveWallDecorationAssignments`
 * resolves against) have `palSize=0` -- they use the wall set's own
 * `.PAL`, same convention already confirmed for EOB1 Amiga's decoration
 * sheets (`docs/eotb/amiga/data-structure.md` § "Decoration overlays").
 */
import { decodePlanar } from '../../shared/amiga-planar.ts';
import { eobAmigaWordToRGB, readBEWords } from '../../eotb/palette.ts';
import { decompressKyraContainer } from './decode-vcn.ts';

const CPS_WIDTH = 320;
const CPS_HEIGHT = 200;
const CPS_PLANES = 5;
const CPS_IMAGE_BYTES = (CPS_WIDTH / 8) * CPS_HEIGHT * CPS_PLANES; // 40000

export interface CpsImage {
  width: number;
  height: number;
  indices: Uint8Array; // 320x200, one byte per pixel, palette index (0-31)
  /** 32 colours if this file carries a header-embedded palette (`palSize>0`), else null. */
  palette: [number, number, number][] | null;
}

export function decodeCps(data: Uint8Array): CpsImage {
  const palSize = data[8]! | (data[9]! << 8);
  const decompressed = decompressKyraContainer(data);
  if (decompressed.length < CPS_IMAGE_BYTES) {
    throw new Error(`decodeCps: oracle check failed -- decompressed ${decompressed.length} bytes, expected >= ${CPS_IMAGE_BYTES} (320x200x5bpp)`);
  }
  const indices = decodePlanar(decompressed.subarray(0, CPS_IMAGE_BYTES), CPS_WIDTH, CPS_HEIGHT, CPS_PLANES);

  let palette: [number, number, number][] | null = null;
  if (palSize > 0) {
    // Header-embedded palette (EOB2 style): palSize bytes right after the
    // 10-byte header, before the (possibly LCW-compressed) body.
    const palBytes = data.subarray(10, 10 + palSize);
    const count = Math.floor(palSize / 2);
    palette = readBEWords(palBytes, 0, count).map(eobAmigaWordToRGB) as [number, number, number][];
  }

  return { width: CPS_WIDTH, height: CPS_HEIGHT, indices, palette };
}
