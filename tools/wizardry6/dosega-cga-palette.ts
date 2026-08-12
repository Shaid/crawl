/**
 * Wizardry 6 (DOS/EGA) CGA hardware palette.
 *
 * Confirmed via `wroot.exe` disassembly (real-mode x86, offsets
 * ~0x1de9-0x1df6): `mov ax,4; int 0x10` selects BIOS video mode 4
 * (320x200 CGA 4-color), immediately followed by `mov ah,0xb; mov
 * bx,0x0101; int 0x10` -- INT 10h AH=0Bh BH=01h BL=01h, the standard BIOS
 * "select 4-color palette" call with BL=1 choosing the fixed hardware
 * "Palette 1" (background/cyan/magenta/white). No separate call sets the
 * intensity bit in this code path, so the color-select register is left
 * at its default state -- low-intensity Palette 1.
 *
 * Cross-checked by rendering: the resulting cyan/magenta dithered sky in
 * graveyrd.cga visually matches the EGA release's own documented
 * "speckled magenta/white dithered sky" for the same scene (see
 * docs/wizardry6/dosega/data-structure.md), and a pixel-co-occurrence
 * check against the already-confirmed EGA decode (same coordinates, same
 * artwork) shows the two darkest/brightest CGA index values cleanly
 * separating dark vs. light EGA pixels.
 *
 * Split into its own module (rather than living alongside the screen
 * decoder) so other dosega CGA decoders (mazedata, wfont, wport) can
 * import just the palette constant without also pulling in and running
 * decode-dosega-ega-screen.ts's CLI `main()`.
 */
import type { RGB } from '../shared/amiga-planar.ts';

export const CGA_PALETTE: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 0, g: 170, b: 170 },
  { r: 170, g: 0, b: 170 },
  { r: 170, g: 170, b: 170 },
];
