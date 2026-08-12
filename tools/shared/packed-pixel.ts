/**
 * Chunky (packed, non-planar) pixel decode helpers for DOS CGA/Tandy
 * 16-color graphics.
 *
 * Unlike Amiga's bitplane convention (see amiga-planar.ts), these formats
 * pack N bits per pixel directly into consecutive bytes, pixels MSB-first
 * within each byte (e.g. at bpp=2: 4 pixels/byte, leftmost pixel = bits
 * 7-6). This is the pixel encoding used throughout Wizardry 6's DOS `.CGA`
 * (2bpp) and `.T16` (4bpp Tandy 16-color) asset variants -- full-screen
 * images, the `mazedata` art bank, and the `WFONT`/`WPORT` tile sheets all
 * share it, confirmed by rendering (see
 * docs/wizardry6/dosega/data-structure.md).
 */
import type { PlanarImage } from './amiga-planar.ts';

/**
 * Decode a linear (non-interleaved), packed-pixel chunky image: row-major,
 * `ceil(width / (8/bpp))` bytes per row, pixels packed MSB-first within
 * each byte.
 *
 * Confirmed (dosega): `.T16` full screens, `mazedata.cga`/`.t16` graphics
 * blocks, and `WFONT`/`WPORT` `.cga`/`.t16` tiles all decode cleanly with
 * this function -- only the full-screen `.CGA` layout needs the hardware
 * bank interleave (`decodeCgaBanked` below) instead.
 */
export function decodePackedPixelLinear(
  data: Uint8Array,
  offset: number,
  width: number,
  height: number,
  bpp: number,
): PlanarImage {
  const pixelsPerByte = 8 / bpp;
  const rowBytes = Math.ceil(width / pixelsPerByte);
  const mask = (1 << bpp) - 1;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = offset + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const byteIndex = rowOffset + Math.floor(x / pixelsPerByte);
      const byte = data[byteIndex] ?? 0;
      const pixelInByte = x % pixelsPerByte;
      const shift = (pixelsPerByte - 1 - pixelInByte) * bpp;
      indices[y * width + x] = (byte >> shift) & mask;
    }
  }
  return { indices, width, height };
}

/**
 * Decode a real-mode CGA hardware-video-memory-layout image: two
 * interleaved "banks" (even scanlines 0,2,4,... then odd scanlines
 * 1,3,5,...), each bank a fixed `bankGap` bytes wide in the source data
 * regardless of how much of it holds real pixel data -- the classic IBM
 * CGA video memory convention (even field at segment offset 0, odd field
 * at +0x2000), which this engine's asset files store pre-formatted to
 * match exactly (a straight `memcpy` onto the two banks, no runtime
 * reshuffling).
 *
 * Confirmed via `cga.drv`'s screen-blit routine (`CODE+0x5af` in the
 * dosega corpus): `add si,0x2000` / `add di,0x2000` applied identically to
 * both the source (asset) and destination (video memory `0xB800:`)
 * pointers. Rendering `dragonsc.cga`/`graveyrd.cga`/`titlepag.cga` with
 * this layout (vs. a plain linear or 8000-byte-bank read) is what turns
 * three vertically-repeated noise panels into one clean, legible image --
 * see docs/wizardry6/dosega/data-structure.md.
 */
export function decodeCgaBanked(
  data: Uint8Array,
  offset: number,
  width: number,
  height: number,
  bpp = 2,
  bankGap = 0x2000,
): PlanarImage {
  const pixelsPerByte = 8 / bpp;
  const rowBytes = Math.ceil(width / pixelsPerByte);
  const mask = (1 << bpp) - 1;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const bank = y % 2;
    const rowInBank = Math.floor(y / 2);
    const rowOffset = offset + bank * bankGap + rowInBank * rowBytes;
    for (let x = 0; x < width; x++) {
      const byteIndex = rowOffset + Math.floor(x / pixelsPerByte);
      const byte = data[byteIndex] ?? 0;
      const pixelInByte = x % pixelsPerByte;
      const shift = (pixelsPerByte - 1 - pixelInByte) * bpp;
      indices[y * width + x] = (byte >> shift) & mask;
    }
  }
  return { indices, width, height };
}

/**
 * Convert an 8-bit chunky index buffer to RGBA, with a caller-chosen
 * transparent index (the DOS/EGA `.PIC`-family tile convention uses "max
 * index" -- all bits set -- as the transparent key at every bit depth:
 * 15 at 4bpp, 3 at 2bpp). Generalizes `pic-format.ts`'s `celIndicesToRGBA`
 * (which is hardcoded to `PIC_PALETTE`/index 15) across bit depths.
 */
export function indicesToRGBAWithTransparency(
  img: PlanarImage,
  palette: { r: number; g: number; b: number }[],
  transparentIndex: number,
): Uint8Array {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.indices.length; i++) {
    const idx = img.indices[i];
    const c = palette[idx] ?? { r: 0, g: 0, b: 0 };
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = idx === transparentIndex ? 0 : 255;
  }
  return rgba;
}
