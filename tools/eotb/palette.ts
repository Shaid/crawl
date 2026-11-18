/**
 * Eye of the Beholder (Amiga)'s own 12-bit-Amiga-word -> RGB scaling.
 *
 * Confirmed from source (`docs/eotb/amiga/data-structure.md` §
 * "Palette (VCN offset 0x02...)", porting `Palette::loadAmigaPalette`):
 * each nibble scales to the engine's internal 6-bit (0-63) range via
 * `(nibble * 0x3F) / 0xF`. Scaled back to 8 bits that is numerically
 * `nibble * 17`, the same value Black Crypt's `amiga12ToRGB`
 * (`tools/shared/amiga-planar.ts`) produces (2026-11 audit correction: this
 * comment used to say it was NOT `nibble * 17`; ScummVM's own truncation to 6
 * bits would give e.g. 134 for nibble 8 vs our 136, <= 3 per channel). Kept as a
 * separate function to mirror the source's two-step scaling.
 */
export function eobAmigaWordToRGB(word: number): [number, number, number] {
  const nibbleTo6bit = (n: number) => Math.round(((n * 0x3f) / 0xf) * (255 / 63));
  return [nibbleTo6bit((word >> 8) & 0xf), nibbleTo6bit((word >> 4) & 0xf), nibbleTo6bit(word & 0xf)];
}

/** Read `count` big-endian 12-bit Amiga colour words starting at byte `offset`. */
export function readBEWords(data: Uint8Array, offset: number, count: number): number[] {
  const words: number[] = [];
  for (let i = 0; i < count; i++) {
    words.push(((data[offset + i * 2]! << 8) | data[offset + i * 2 + 1]!) & 0xffff);
  }
  return words;
}
