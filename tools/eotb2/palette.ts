/**
 * Eye of the Beholder II (DOS/VGA) `.PAL` loader -- `docs/eotb/dosvga/
 * data-structure.md` § "VGA palette", confirmed shared with EOB2. Each
 * wall-set `.PAL` is 768 bytes: 256 colours x 3 raw bytes (R,G,B), each a
 * 6-bit VGA DAC value (top 2 bits are noise, masked off). Expansion to
 * 8-bit is `(v << 2) | (v & 3)`, not a naive `v * 4` -- they only disagree
 * in the low 2 bits, e.g. `v=63` -> `252|3=255` correctly vs. `63*4=252`.
 */
const PALETTE_COLORS = 256;

export function decodePal(data: Uint8Array): [number, number, number][] {
  if (data.length !== PALETTE_COLORS * 3) {
    throw new Error(`decodePal: oracle check failed -- expected ${PALETTE_COLORS * 3} bytes, got ${data.length}`);
  }
  const expand6to8 = (v: number) => ((v & 0x3f) << 2) | (v & 3);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < PALETTE_COLORS; i++) {
    const o = i * 3;
    palette.push([expand6to8(data[o]!), expand6to8(data[o + 1]!), expand6to8(data[o + 2]!)]);
  }
  return palette;
}
