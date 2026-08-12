/**
 * Decodes Wizardry 6 (Amiga) WPORT1.EGA-WPORT3.EGA (4096 bytes each).
 *
 * Format (confirmed by tracing `Bane`'s portrait loader and rendering --
 * see docs/wizardry6/amiga/investigations/fonts-and-portraits.md): each
 * file is a flat, headerless array of 14 fixed-size portrait records, 288
 * bytes each (14 * 288 = 4032; the trailing 64 bytes are zero padding,
 * verified across all three files). Each 288-byte record is 9 tiles in
 * exactly the `.PIC` cel tile encoding (data-structure.md section 2.3):
 * 8x8 pixels, 4 bitplanes, plane-major, MSB-first, 32 bytes/tile
 * (9 * 32 = 288). The 9 tiles are arranged 3 wide x 3 tall (row-major),
 * producing a 24x24 pixel portrait -- confirmed by rendering: all 42
 * portraits (14 per file x 3 files) are unambiguous small character/
 * monster face icons using the `.PIC` palette, and the two alternative
 * arrangements that also total 9 tiles (9 wide x 1 tall, 1 wide x 9 tall)
 * were tried and do not produce coherent images.
 *
 * Traced via the A4 jump-table technique (data-structure.md section 1.4).
 * Three near-identical copies of the loader exist in `Bane`
 * (CODE+0x6692, CODE+0x2f7d0-ish, CODE+0x383d0-ish, matching the three
 * `WPORT1.EGA` string occurrences catalogued in data-structure.md section
 * 1.1) -- traced the first in full:
 *
 *  - The filename string "WPORT1.EGA" is `strcpy`'d (CODE+0x54cac) into a
 *    local buffer, then byte 5 (the '1' in "WPORT1") is overwritten with
 *    `'1' + portrait_id / 14` (CODE+0x671c) -- so `WPORT2.EGA`/`WPORT3.EGA`
 *    are never stored as literal strings anywhere in the binary; they only
 *    exist as this runtime digit patch. This is why only "WPORT1" text was
 *    found by a plain string search.
 *  - The file is opened (CODE+0xf66), then `Seek(fh, (portrait_id % 14) *
 *    288, OFFSET_BEGINNING)` (CODE+0x54db0, called with the caller's mode
 *    0 -> internally converted to AmigaDOS's -1/OFFSET_BEGINNING) and
 *    `Read(fh, buf, 288)` (CODE+0x54f86, the same generic Read routine
 *    WFONT1-4 use) pull out exactly one 288-byte record, then the file is
 *    closed (CODE+0x5585c).
 *  - The 288-byte record is copied (CODE+0x1e9a) into a shared static
 *    tile-work buffer at a computed tile offset (`slot*9 + 72`) -- the same
 *    tile buffer selection mechanism, and literally the same buffer slots,
 *    that WFONT1-4.EGA are loaded into (see decode-wfont-extra.ts); WPORT
 *    and WFONT files are two different *contents* poured through the same
 *    "install N .PIC-format tiles into buffer case C" engine primitive.
 *
 * Colour index 15 renders transparent (matching the confirmed `.PIC`
 * convention -- portrait backgrounds render as the palette's cyan, same as
 * `.PIC` cel backgrounds, consistent with reusing the same tile-buffer/
 * compositing system).
 *
 * Usage: npx tsx tools/wizardry6/decode-wport.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodePlanarPlaneMajor } from '../shared/amiga-planar.ts';
import { celIndicesToRGBA } from './pic-format.ts';
import { shelfPack, type PackInput } from '../shared/atlas-pack.ts';

const TILE_SIZE = 32; // 4 planes * 8 rows * 1 byte/row
const TILES_WIDE = 3;
const TILES_HIGH = 3;
const TILES_PER_PORTRAIT = TILES_WIDE * TILES_HIGH; // 9
const PORTRAIT_BYTES = TILES_PER_PORTRAIT * TILE_SIZE; // 288
const PORTRAIT_PX = TILES_WIDE * 8; // 24
const RECORDS_PER_FILE = 14;
const EXPECTED_FILE_SIZE = 4096;

const FILES = ['WPORT1.EGA', 'WPORT2.EGA', 'WPORT3.EGA'];

function decodePortrait(data: Uint8Array, recordOffset: number): Uint8Array {
  const indices = new Uint8Array(PORTRAIT_PX * PORTRAIT_PX);
  for (let ty = 0; ty < TILES_HIGH; ty++) {
    for (let tx = 0; tx < TILES_WIDE; tx++) {
      const t = ty * TILES_WIDE + tx;
      const tile = decodePlanarPlaneMajor(data, recordOffset + t * TILE_SIZE, 8, 8, 4);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          indices[(ty * 8 + y) * PORTRAIT_PX + (tx * 8 + x)] = tile.indices[y * 8 + x];
        }
      }
    }
  }
  return indices;
}

function decodeFile(data: Uint8Array, baseName: string) {
  if (data.length !== EXPECTED_FILE_SIZE) {
    console.warn(`${baseName}: expected ${EXPECTED_FILE_SIZE} bytes, got ${data.length}`);
  }
  const recordCount = Math.min(RECORDS_PER_FILE, Math.floor(data.length / PORTRAIT_BYTES));

  const packInputs: PackInput[] = [];
  for (let i = 0; i < recordCount; i++) {
    packInputs.push({
      name: `${baseName}_portrait${String(i).padStart(2, '0')}`,
      width: PORTRAIT_PX,
      height: PORTRAIT_PX,
    });
  }
  const packed = shelfPack(packInputs, 512);
  const atlas = new Uint8Array(packed.width * packed.height * 4);

  for (let i = 0; i < recordCount; i++) {
    const frame = packed.frames[i];
    const indices = decodePortrait(data, i * PORTRAIT_BYTES);
    const rgba = celIndicesToRGBA(indices, PORTRAIT_PX, PORTRAIT_PX);
    for (let y = 0; y < PORTRAIT_PX; y++) {
      const srcRowOff = y * PORTRAIT_PX * 4;
      const dstRowOff = ((frame.y + y) * packed.width + frame.x) * 4;
      atlas.set(rgba.subarray(srcRowOff, srcRowOff + PORTRAIT_PX * 4), dstRowOff);
    }
  }

  return {
    rgba: atlas,
    width: packed.width,
    height: packed.height,
    frames: packed.frames.map((f) => ({ name: f.name, x: f.x, y: f.y, w: f.width, h: f.height })),
    recordCount,
  };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-wport.ts <dataDir>');
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
    console.log(`Wrote ${baseName}.png/.json (${atlas.recordCount} 24x24 portraits)`);
  }
}

main();
