/**
 * Decodes Wizardry 6 (DOS/EGA) full-screen images: dragonsc/graveyrd/
 * titlepag, in all three platform-variant bit depths: .ega (4bpp planar),
 * .cga (2bpp packed, CGA hardware bank layout), .t16 (4bpp packed, Tandy
 * 16-color, linear).
 *
 * .EGA: same format as the Amiga release
 * (tools/wizardry6/decode-ega-screen.ts): 320x200 pixels, 4 bitplanes,
 * plane-major layout, no header, 32768 bytes. Each plane occupies a fixed
 * 8192-byte (0x2000) slot, not a tightly-packed 8000 bytes -- confirmed
 * byte-exact (100% index match) against this same file's `.t16` sibling
 * (packed-chunky 4bpp, a structurally independent encoding, already
 * confirmed clean), and independently by the literal 0x2000 pitch constant
 * found hardcoded in `Bane`'s screen-blit code. This file (identical stride
 * bug) is byte-identical to the Amiga release's `.ega` (same md5 for all 3
 * screens) -- see decode-ega-screen.ts's header comment for the full
 * writeup and docs/wizardry6/amiga/data-structure.md §3.3. Verified by
 * rendering titlepag.ega: legible "BANE...COSMIC...FORGE" title lettering
 * with clean stonework, matching the Amiga release's confirmed render and
 * the `.t16` ground truth pixel-for-pixel. Palette: the same PIC_PALETTE
 * table as Amiga -- tested against the standard EGA hardware DAC colour
 * order and PIC_PALETTE renders visibly more coherent (subdued stone greys
 * around the title text vs. garish neon under the standard order).
 *
 * .CGA: 320x200 pixels, 2 bits/pixel, packed 4 pixels/byte (NOT planar --
 * a plane-major decode at 2 planes renders as noise). File size 16384 =
 * exactly half of .ega's 32768 (2bpp vs 4bpp, same 320x200 dimensions).
 * The pixel data is laid out exactly as real CGA video hardware expects
 * it: two interleaved fields (even scanlines, then odd), each a fixed
 * 0x2000-byte bank (100 rows x 80 bytes/row = 8000 real bytes + 192 bytes
 * of unused padding per bank -- 2 x 192 = 384, matching the "half of the
 * .ega file's 768 trailing bytes" arithmetic exactly, just split
 * mid-file/end-of-file rather than one trailing block). Confirmed via
 * `cga.drv`'s screen-blit routine (real-mode x86 disassembly,
 * `CODE+0x5af`): the exact same `add si/di,0x2000` bank-gap idiom is
 * applied to *both* the source (asset) and destination (0xB800: video
 * memory) pointers during a straight `rep movsw` copy -- i.e. the asset
 * file is pre-formatted to match hardware layout, no runtime reshuffling.
 * A plain linear (non-banked) decode at the same bpp/width instead
 * renders the image vertically compressed into two near-identical,
 * blurred repeats (one per field) -- a strong independent tell that the
 * banked layout, not the bit depth, was the missing piece.
 *
 * Palette (CGA): confirmed via `wroot.exe` disassembly (real-mode x86,
 * offsets ~0x1de9-0x1df6): `mov ax,4; int 0x10` selects BIOS video mode 4
 * (320x200 CGA 4-color), immediately followed by `mov ah,0xb; mov
 * bx,0x0101; int 0x10` -- INT 10h AH=0Bh BH=01h BL=01h, the standard BIOS
 * "select 4-color palette" call with BL=1 choosing the fixed hardware
 * "Palette 1" (background/cyan/magenta/white). No separate call sets the
 * intensity bit, so the color-select register is left at its BIOS-default
 * state for this call sequence (intensity off) -- low-intensity Palette 1.
 * Cross-checked by rendering: the resulting cyan/magenta dithered sky in
 * graveyrd.cga visually matches the EGA release's own documented
 * "speckled magenta/white dithered sky" for the same scene, and a
 * pixel-co-occurrence check against the already-confirmed EGA decode
 * (same coordinates, same artwork) shows the two darkest/brightest CGA
 * index values cleanly separating dark vs. light EGA pixels.
 *
 * .T16: 320x200 pixels, 4 bits/pixel, packed 2 pixels/byte, LINEAR (no
 * bank interleave -- unlike CGA, `tandy.drv`'s blit routine advances its
 * *source* pointer by a plain row stride between the hardware's 4
 * scanline banks, only the *destination* video-memory pointer takes the
 * 0x2000/0x4000/0x6000 bank jumps -- so the asset file itself is stored
 * as a plain top-to-bottom bitmap and de-interleaved at blit time).
 * File size 32768 = same total as .ega (4bpp either way, just packed
 * instead of planar).
 *
 * Palette (T16): CONFIRMED via `wroot.exe` disassembly -- the Tandy
 * mode-9 setup path (`CODE+0x1ef8..0x1f08`) calls INT 10h AH=10h AL=02h
 * ("Set All Palette Registers") with ES:DX pointing at a 17-byte table
 * (16 palette-register values + overscan) embedded in the executable at
 * that call site. Decoding that table as "register i is programmed with
 * the game's own standard-EGA-order color table[i]" reproduces
 * PIC_PALETTE's exact 16-entry permutation, byte for byte, at every
 * index (0->black, 1->white, 2->ltblue, ... 15->cyan) -- i.e. Tandy 16-
 * color mode uses the *same* palette table as EGA/Amiga, just
 * reprogrammed through the EGA/VGA-compatible BIOS call instead of
 * inherited implicitly. The neighbouring EGA-mode setup path
 * (`CODE+0x1e9b`) makes the identical call with its own table, using the
 * same permutation extended into the 6-bit EGA register range --
 * independent confirmation the register-index -> table-value reading is
 * correct.
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-ega-screen.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { indicesToPaletteRGBA, type PlanarImage, type RGB } from '../shared/amiga-planar.ts';
import { decodeCgaBanked, decodePackedPixelLinear, decodePlanar } from '@seer-project/gfx';
import { PIC_PALETTE } from './pic-format.ts';
import { CGA_PALETTE } from './dosega-cga-palette.ts';

const BASE_NAMES = ['dragonsc', 'graveyrd', 'titlepag'];
const WIDTH = 320;
const HEIGHT = 200;
const EGA_PLANE_STRIDE = 0x2000; // 8192 -- confirmed fixed per-plane slot, see header comment

interface ScreenMode {
  suffix: string; // '' for the original .ega output name, else '_cga'/'_t16'
  ext: string;
  bpp: number;
  fileSize: number;
  decode: (data: Uint8Array, offset: number, w: number, h: number) => PlanarImage;
  palette: RGB[];
  paletteName: string;
}

const MODES: ScreenMode[] = [
  {
    suffix: '',
    ext: 'ega',
    bpp: 4,
    fileSize: 32768,
    decode: (d, o, w, h) => ({
      indices: decodePlanar(d, { width: w, height: h, planes: 4, layout: 'plane-major', offset: o, planeStride: EGA_PLANE_STRIDE }),
      width: w,
      height: h,
    }),
    palette: PIC_PALETTE,
    paletteName: 'PIC_PALETTE',
  },
  {
    suffix: '_cga',
    ext: 'cga',
    bpp: 2,
    fileSize: 16384,
    decode: (d, o, w, h) => ({ indices: decodeCgaBanked(d, o, w, h, 2), width: w, height: h }),
    palette: CGA_PALETTE,
    paletteName: 'CGA_PALETTE',
  },
  {
    suffix: '_t16',
    ext: 't16',
    bpp: 4,
    fileSize: 32768,
    decode: (d, o, w, h) => ({ indices: decodePackedPixelLinear(d, o, w, h, 4), width: w, height: h }),
    palette: PIC_PALETTE,
    paletteName: 'PIC_PALETTE',
  },
];

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-ega-screen.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/dosega/screens');
  mkdirSync(outDir, { recursive: true });

  for (const mode of MODES) {
    for (const base of BASE_NAMES) {
      const fileName = `${base}.${mode.ext}`;
      const path = resolve(dataDir, fileName);
      const data = readBinary(path);
      if (data.length !== mode.fileSize) {
        console.warn(`${fileName}: expected ${mode.fileSize} bytes, got ${data.length} -- skipping`);
        continue;
      }
      const img = mode.decode(data, 0, WIDTH, HEIGHT);
      const rgba = indicesToPaletteRGBA(img, mode.palette);
      const outName = `${base}${mode.suffix}.png`;
      writePNG(resolve(outDir, outName), rgba, WIDTH, HEIGHT);
      console.log(`Wrote ${outName} (${WIDTH}x${HEIGHT}, ${mode.paletteName})`);
    }
  }
}

// Only run when executed directly, not when imported as a library.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
