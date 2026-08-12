/**
 * Decodes Wizardry 6 (Amiga) full-screen ".EGA" images: DRAGONSC.EGA,
 * GRAVEYRD.EGA, TITLEPAG.EGA.
 *
 * Format (confirmed, see docs/wizardry6/amiga/data-structure.md §3): 320x200
 * pixels, 4 bitplanes, PLANE-MAJOR layout, starting at file offset 0, no
 * header. Each plane occupies a fixed **8192-byte (0x2000) slot**, not a
 * tightly-packed 8000 bytes (`320/8*200`) -- the trailing 192 bytes of each
 * plane's slot are unused padding, and it's this per-plane padding, not one
 * lump trailer, that accounts for the file's "extra" 768 bytes
 * (4 planes x 192 = 768; 4 x 8192 = 32768 exactly, the whole file). Confirmed
 * two ways: (1) byte-exact (100.000000% index match, all pixels, all 4
 * bitplanes) against the same screens' independently-decoded `.t16` Tandy
 * variant (DOS/EGA release, packed-chunky 4bpp, a structurally unrelated
 * pixel encoding already confirmed clean) for all 3 files on both platforms;
 * (2) the literal constant 0x2000 appears hardcoded in `Bane`'s own
 * maze-piece screen-blit code (CODE+0x3e08-0x3ffa) as the fixed pitch added
 * between successive destination bitplane pointers -- see
 * docs/wizardry6/amiga/investigations/ega-screen-palette.md §3 (added in the
 * stride-bug investigation pass).
 *
 * Before this fix, the decoder assumed a tightly-packed 8000-byte plane
 * stride (planes back-to-back, no gap) with the 768 leftover bytes as inert
 * trailing padding -- structurally plausible (it accounts for all the
 * bytes) but wrong: it silently reads 192 bytes of the *next* plane's slot
 * as if they were the *current* plane's last few rows, corrupting later
 * planes' bit alignment more and more (plane 0 was accidentally read
 * correctly since its slot starts at offset 0; by plane 3 the read region
 * had drifted 576 bytes into wrong data, ~48% agreement with ground truth --
 * indistinguishable from noise). This is what previously read as "genuine
 * EGA dithering speckle" in `graveyrd.ega`/`dragonsc.ega`'s fill regions --
 * fixing the stride resolves it completely for `dragonsc`/`titlepag`, which
 * now render clean. `graveyrd.ega`'s sky area still shows a magenta/cyan
 * speckle pattern after the fix -- but it is now BYTE-IDENTICAL to the
 * independently-decoded `.t16` ground truth, proving that residual speckle
 * really is baked into the source art, not a decode artifact.
 *
 * Palette: `Bane`'s disassembly has exactly ONE LoadRGB4/OpenScreen call in
 * the whole binary (CODE+0x19a8, the same site already confirmed for `.PIC`
 * cels in pic-format.ts's PIC_PALETTE) -- there is no alternate palette load
 * site for full-screen images, so this is confirmed to be the only
 * candidate palette the game has.
 *
 * Usage: npx tsx tools/wizardry6/decode-ega-screen.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { decodePlanarPlaneMajor, indicesToPaletteRGBA } from '../shared/amiga-planar.ts';
import { PIC_PALETTE } from './pic-format.ts';

const SCREENS = ['DRAGONSC.EGA', 'GRAVEYRD.EGA', 'TITLEPAG.EGA'];
const WIDTH = 320;
const HEIGHT = 200;
const PLANES = 4;
const PLANE_STRIDE = 0x2000; // 8192 -- confirmed fixed per-plane slot, see header comment

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-ega-screen.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/amiga/screens');
  mkdirSync(outDir, { recursive: true });

  for (const name of SCREENS) {
    const path = resolve(dataDir, name);
    const data = readBinary(path);
    if (data.length !== 32768) {
      console.warn(`${name}: expected 32768 bytes, got ${data.length} -- skipping`);
      continue;
    }
    const img = decodePlanarPlaneMajor(data, 0, WIDTH, HEIGHT, PLANES, PLANE_STRIDE);
    const rgba = indicesToPaletteRGBA(img, PIC_PALETTE);
    const outName = name.replace(/\.EGA$/i, '').toLowerCase() + '.png';
    writePNG(resolve(outDir, outName), rgba, WIDTH, HEIGHT);
    console.log(`Wrote ${outName} (${WIDTH}x${HEIGHT}, PIC_PALETTE -- confirmed sole palette in Bane)`);
  }
}

main();
