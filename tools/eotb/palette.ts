/**
 * Eye of the Beholder (Amiga)'s own 12-bit-Amiga-word -> RGB scaling.
 *
 * Confirmed from source (`docs/eotb/amiga/data-structure.md` §
 * "Palette (VCN offset 0x02...)", porting `Palette::loadAmigaPalette`):
 * each nibble scales to the engine's internal 6-bit (0-63) range via
 * `(nibble * 0x3F) / 0xF`, NOT the naive `nibble * 17` Black Crypt's
 * `amiga12ToRGB` (`tools/shared/amiga-planar.ts`) uses -- that formula is
 * confirmed correct for Black Crypt but wrong for EOB, so this is a
 * separate function, not a shared one.
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
