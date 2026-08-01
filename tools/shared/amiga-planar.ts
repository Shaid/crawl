/**
 * Amiga planar bitmap and palette decoding for Black Crypt.
 *
 * Single source of truth for the pipeline. The layout here mirrors
 * `decode_seq()` in `scripts/render_all.py`, which is the extraction that
 * produced the verified PNGs under `data/blackcrypt/extracted/`.
 */

/** One 12-bit Amiga colour word (0x0RGB) → 24-bit RGB. */
export function amiga12ToRGB(word: number): [number, number, number] {
  return [((word >> 8) & 0xf) * 17, ((word >> 4) & 0xf) * 17, (word & 0xf) * 17];
}

/**
 * Palette locations in `bcdfq`, as **file** offsets.
 *
 * The three tables are contiguous (0x266 + 16 words = 0x286, + 32 words =
 * 0x2C6, + 32 words = 0x306) and each begins with 0x000, which is what
 * confirms the alignment. Earlier notes described these as `CODE + 0x266`
 * etc.; that is off by the 36-byte hunk header and misaligns every entry —
 * reading 32 words at 0x2EA runs off the end of the table into 68k opcodes.
 */
export const BCDFQ_PALETTES = {
  /** Raven logo intro screen, 16 colours. */
  raven: { offset: 0x266, count: 16 },
  /** Title screen and logo banner, 32 colours. */
  title: { offset: 0x286, count: 32 },
  /** Main in-game palette — portraits, monsters, dungeon. 32 colours. */
  game: { offset: 0x2c6, count: 32 },
} as const;

/** Read `count` big-endian 12-bit colour words starting at `offset`. */
export function readPaletteWords(data: Uint8Array, offset: number, count: number): number[] {
  const words: number[] = [];
  for (let i = 0; i < count; i++) {
    words.push((data[offset + i * 2] << 8) | data[offset + i * 2 + 1]);
  }
  return words;
}

/**
 * Expand base colour words into a flat RGB triplet table.
 *
 * For 6bpp EHB the 32 base colours are followed by 32 half-bright copies
 * (indices 32-63). The Amiga halves each 4-bit component *before* scaling,
 * so the correct expression is `(nibble >> 1) * 17` — not `(nibble * 17) >> 1`,
 * which is off by up to 8 per channel.
 */
export function ehbPalette(words: number[]): number[] {
  const rgb: number[] = [];
  for (const w of words) {
    rgb.push(((w >> 8) & 0xf) * 17, ((w >> 4) & 0xf) * 17, (w & 0xf) * 17);
  }
  for (const w of words) {
    rgb.push((((w >> 8) & 0xf) >> 1) * 17, (((w >> 4) & 0xf) >> 1) * 17, ((w & 0xf) >> 1) * 17);
  }
  return rgb;
}

/**
 * Decode sequential-planar Amiga bitmap data into palette indices.
 *
 * Planes are stored one whole plane after another, each `(width / 8) * height`
 * bytes. Plane 0 contributes bit 0 (LSB), so on a 6-plane EHB sprite plane 5
 * is the half-bright bit.
 *
 * This is *not* row-interleaved (`y * planes * bpr + p * bpr`). An earlier
 * copy of this function in the pipeline used that layout and produced
 * scrambled output.
 */
export function decodePlanar(
  data: Uint8Array,
  width: number,
  height: number,
  planes: number,
): Uint8Array {
  const bpr = width >> 3;
  const planeSize = bpr * height;
  const out = new Uint8Array(width * height);

  for (let p = 0; p < planes; p++) {
    const planeBase = p * planeSize;
    const bit = 1 << p;
    for (let y = 0; y < height; y++) {
      const rowBase = planeBase + y * bpr;
      for (let x = 0; x < width; x++) {
        const byte = data[rowBase + (x >> 3)];
        if (byte === undefined) continue;
        if ((byte >> (7 - (x & 7))) & 1) out[y * width + x] |= bit;
      }
    }
  }
  return out;
}

/**
 * Decode a sprite stored as a 1-bit transparency mask plane followed by
 * `colorPlanes` colour planes — the bcdfb–bcdfn monster sprite layout.
 * Returns indices plus the mask, so callers can key transparency off the
 * mask rather than off colour 0.
 */
export function decodeMaskedPlanar(
  data: Uint8Array,
  width: number,
  height: number,
  colorPlanes = 6,
): { indices: Uint8Array; mask: Uint8Array } {
  const planeSize = (width >> 3) * height;
  return {
    mask: decodePlanar(data, width, height, 1),
    indices: decodePlanar(data.subarray(planeSize), width, height, colorPlanes),
  };
}

/**
 * Palette indices → RGBA bytes.
 *
 * `opacity` decides per-pixel alpha. Pass a mask plane for masked sprites, or
 * omit it to treat colour 0 as transparent (correct for atlas tiles, where
 * index 0 is the background key).
 */
export function indicesToRGBA(
  indices: Uint8Array,
  palette: number[],
  opts: { mask?: Uint8Array; transparentIndex0?: boolean } = {},
): Uint8Array {
  const { mask, transparentIndex0 = false } = opts;
  const out = new Uint8Array(indices.length * 4);

  for (let i = 0; i < indices.length; i++) {
    const c = indices[i];
    const ci = c * 3;
    const o = i * 4;
    out[o] = palette[ci] ?? 0;
    out[o + 1] = palette[ci + 1] ?? 0;
    out[o + 2] = palette[ci + 2] ?? 0;
    if (mask) out[o + 3] = mask[i] ? 255 : 0;
    else out[o + 3] = transparentIndex0 && c === 0 ? 0 : 255;
  }
  return out;
}

/** Blit an RGBA cell into a larger RGBA atlas at (dx, dy). */
export function blitRGBA(
  dst: Uint8Array,
  dstWidth: number,
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < srcHeight; y++) {
    const srcOff = y * srcWidth * 4;
    dst.set(src.subarray(srcOff, srcOff + srcWidth * 4), ((dy + y) * dstWidth + dx) * 4);
  }
}
