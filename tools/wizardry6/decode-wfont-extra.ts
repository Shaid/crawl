/**
 * Decodes Wizardry 6 (Amiga) WFONT1.EGA-WFONT4.EGA (4096 bytes each).
 *
 * Format (confirmed by tracing `Bane`'s loader and rendering -- see
 * docs/wizardry6/amiga/investigations/fonts-and-portraits.md): despite the
 * "WFONT" naming, these are NOT glyph sheets. Each file is a flat, headerless
 * array of 128 tiles in exactly the same tile encoding as the `.PIC` cel
 * format (docs/wizardry6/amiga/data-structure.md section 2.3): 8x8 pixels,
 * 4 bitplanes, plane-major (8 bytes/plane, 4 planes = 32 bytes/tile),
 * MSB-first. 128 * 32 = 4096 -- matches the file size exactly, zero
 * remainder.
 *
 * Traced via the A4 jump-table technique (data-structure.md section 1.4):
 * `Bane`'s font loader (CODE+0x49a2-0x49e4) opens each WFONTn.EGA and reads
 * the whole 4096-byte file in one `Read(fh, buf, 0x1000)` call
 * (CODE+0x4408, via trampoline -0x7d5e(A4) = CODE+0x54f86, the same generic
 * Read call used elsewhere in the corpus) into one of four static tile
 * buffers. Those same four buffer slots are shared with the WPORT portrait
 * loader's tile-install routine (CODE+0x1e9a, see decode-wport.ts) -- WFONT1-4
 * and WPORT1-3 both ultimately populate the same kind of `.PIC`-tile-format
 * scratch buffer, just with different content (icon/label tiles vs. portrait
 * tiles) and different call sites.
 *
 * Rendered content (using the confirmed `.PIC` palette, CODE+0x17b6) is
 * unambiguous:
 *  - WFONT1.EGA: UI icons (wall/maze pieces, "Zz" sleep icon, direction
 *    arrows) plus all 14 Wizardry 6 class abbreviations as pixel-text
 *    labels: FIG, MAG, PRI, THI, RAN, ALC, BAR, PSI, VAL, BIS, LOR, SAM,
 *    MON, NIN.
 *  - WFONT2.EGA: combat command labels ("TURN", "MOVE") plus status/terrain
 *    icons and a few larger multi-tile creature/terrain graphics.
 *  - WFONT3.EGA: a full legible large ASCII font (digits, punctuation,
 *    A-Z) in two shades (normal + dimmed/disabled variant), plus direction
 *    arrows and a flag icon.
 *  - WFONT4.EGA: an item/equipment icon set -- swords, daggers, shields,
 *    armor, potions, rings, wands, keys, scrolls, boots, gauntlets.
 *
 * No transparency convention is applied here (unlike `.PIC` cels/WPORT
 * portraits, which use index 15 as a confirmed transparent key composited
 * against other content) -- these render fully opaque, since these tiles are
 * mostly displayed directly against a fixed UI background rather than
 * composited, and no consumer of index 15 as "transparent" was traced for
 * this specific buffer. Individual per-icon semantic grouping/naming
 * (which tile is which icon) was not attempted -- frames are named by flat
 * tile index only.
 *
 * Usage: npx tsx tools/wizardry6/decode-wfont-extra.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodePlanar } from '@seer-project/gfx';
import { indicesToPaletteRGBA } from '../shared/amiga-planar.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const TILE_SIZE = 32; // 4 planes * 8 rows * 1 byte/row
const TILE_PX = 8;
const EXPECTED_FILE_SIZE = 4096;
const EXPECTED_TILE_COUNT = EXPECTED_FILE_SIZE / TILE_SIZE; // 128

const FILES = ['WFONT1.EGA', 'WFONT2.EGA', 'WFONT3.EGA', 'WFONT4.EGA'];

function decodeFile(data: Uint8Array, baseName: string) {
  const tileCount = Math.floor(data.length / TILE_SIZE);
  if (data.length !== EXPECTED_FILE_SIZE || tileCount !== EXPECTED_TILE_COUNT) {
    console.warn(
      `${baseName}: expected ${EXPECTED_FILE_SIZE} bytes / ${EXPECTED_TILE_COUNT} tiles, got ${data.length} bytes / ${tileCount} tiles`,
    );
  }

  const packInputs: ShelfPackInput[] = [];
  for (let t = 0; t < tileCount; t++) {
    packInputs.push({ name: `${baseName}_tile${String(t).padStart(3, '0')}`, width: TILE_PX, height: TILE_PX });
  }
  const packed = shelfPack(packInputs, 256);
  const atlas = new Uint8Array(packed.width * packed.height * 4);

  for (let t = 0; t < tileCount; t++) {
    const frame = packed.frames[t];
    const indices = decodePlanar(data, { width: TILE_PX, height: TILE_PX, planes: 4, layout: 'plane-major', offset: t * TILE_SIZE });
    const rgba = indicesToPaletteRGBA({ indices, width: TILE_PX, height: TILE_PX }, PIC_PALETTE);
    for (let y = 0; y < TILE_PX; y++) {
      const srcRowOff = y * TILE_PX * 4;
      const dstRowOff = ((frame.y + y) * packed.width + frame.x) * 4;
      atlas.set(rgba.subarray(srcRowOff, srcRowOff + TILE_PX * 4), dstRowOff);
    }
  }

  return {
    rgba: atlas,
    width: packed.width,
    height: packed.height,
    frames: packed.frames.map((f) => ({ name: f.name, x: f.x, y: f.y, w: f.w, h: f.h })),
    tileCount,
  };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-wfont-extra.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/amiga/sprites');
  mkdirSync(outDir, { recursive: true });

  for (const file of FILES) {
    const data = readBinary(resolve(dataDir, file));
    const baseName = file.replace(/\.EGA$/i, '').toLowerCase();
    const atlas = decodeFile(data, baseName);
    writePNG(resolve(outDir, `${baseName}.png`), atlas.rgba, atlas.width, atlas.height);
    writeJson(resolve(outDir, `${baseName}.json`), {
      frames: atlas.frames,
      width: atlas.width,
      height: atlas.height,
    });
    console.log(`Wrote ${baseName}.png/.json (${atlas.tileCount} 8x8 tiles)`);
  }
}

main();
