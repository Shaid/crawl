/**
 * Decodes Wizardry 6 (DOS/EGA) wfont0-4 and wport1-3, in all three
 * platform-variant bit depths: .ega, .cga, .t16.
 *
 * .EGA: byte-identical (or nearly so) to the Amiga release's
 * WFONT0-4.EGA/WPORT1-3.EGA -- confirmed by direct comparison, see
 * docs/wizardry6/dosega/data-structure.md section 4:
 *   wfont0-3.ega, wport1-3.ega: 100% byte-identical
 *   wfont4.ega: 99.5% byte-identical (20/4096 bytes differ, one ~32-byte
 *     run -- a single tile redrawn slightly differently between ports)
 * Format is therefore directly confirmed without re-verification -- same
 * as Amiga (docs/wizardry6/amiga/data-structure.md sections 5.1-5.3):
 *   wfont0.ega: 128 glyphs, 8x8px, 1bpp, MSB-first (128*8 = 1024 bytes) --
 *     a SPECIAL CASE, the only one of these files that isn't the general
 *     tile encoding.
 *   wfont1-4.ega: 128 tiles/file in the .PIC 32-byte-tile encoding
 *     (8x8px, 4bpp planar, plane-major; 128*32 = 4096 bytes)
 *   wport1-3.ega: 14 x 288-byte portrait records, 9 tiles each (3x3,
 *     24x24px)
 *
 * .CGA/.T16: file-size arithmetic (128 tiles x 8 bytes/plane x N planes,
 * N=2 for .cga/16 bytes-tile, N=4 for .t16/32 bytes-tile) is consistent
 * with either hypothesis tested and confirmed by rendering:
 *
 * 1. wfont1-4/wport1-3 use the exact same general **packed-pixel
 *    (chunky)**, not planar, per-tile encoding as `mazedata`'s graphics
 *    blocks and the `.T16` full screens -- a plane-major bitplane decode
 *    at 2/4 planes renders as noise; `decodePackedPixelLinear` per 8x8
 *    tile renders the same UI icons, class-abbreviation pixel text
 *    ("FIG MAG PRI THI RAN ALC BAR PSI VAL BIS LOR SAM MON NIN") and
 *    portrait fragments the Amiga doc describes for wfont1.ega, confirming
 *    the mechanism is shared across all three bit depths, just packed
 *    instead of planar off-EGA.
 *
 * 2. wfont0.cga/.t16 do **NOT** revert to the special 1bpp monochrome-only
 *    case: like wfont1-4, they decode cleanly with the same general
 *    packed-tile mechanism at their mode's bit depth (16/32 bytes/tile).
 *    Rendered, however, the *content* is still recognisably the plain
 *    ASCII glyph sheet (digits, punctuation, uppercase letters -- pixel-
 *    identical glyph shapes to wfont0.ega, just now at higher bit depth)
 *    rather than the wfont1-4-style icon/pixel-text tileset. In other
 *    words: the task's hypothesis that wfont0 "switches to the general
 *    tile scheme" is correct about the *mechanism* (packed tiles, not the
 *    special mono case), but the extra bit depth appears to be spent on
 *    the font itself (headroom for anti-aliased/shaded lettering on
 *    colour-capable modes), not on repurposing the slot for icon content.
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-fonts.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import {
  decodeMonoGlyphSheet,
  decodePlanarPlaneMajor,
  indicesToPaletteRGBA,
  type PlanarImage,
  type RGB,
} from '../shared/amiga-planar.ts';
import { decodePackedPixelLinear, indicesToRGBAWithTransparency } from '../shared/packed-pixel.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { CGA_PALETTE } from './dosega-cga-palette.ts';
import { shelfPack, type PackInput } from '../shared/atlas-pack.ts';

const OUT_DIR = 'public/assets/wizardry6/dosega/sprites';

const GLYPH_W = 8;
const GLYPH_H = 8;
const GLYPH_COUNT = 128;
const GLYPH_COLS = 16;

const TILE_PX = 8;
const WFONT_EXTRA_TILE_COUNT = 128;

const TILES_WIDE = 3;
const TILES_HIGH = 3;
const TILES_PER_PORTRAIT = TILES_WIDE * TILES_HIGH; // 9
const PORTRAIT_PX = TILES_WIDE * 8; // 24
const RECORDS_PER_FILE = 14;

type TileDecoder = (d: Uint8Array, o: number, w: number, h: number) => PlanarImage;

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TileMode {
  ext: string;
  suffix: string;
  bpp: number;
  tileBytes: number; // 8 rows * bpp/8 bytes/row = bpp bytes/tile at 8px wide
  decode: TileDecoder;
  palette: RGB[];
  transparentIndex: number;
  wfontFiles: string[]; // which base names get the general tile treatment
}

const MODES: TileMode[] = [
  {
    ext: 'ega',
    suffix: '',
    bpp: 4,
    tileBytes: 32,
    decode: (d, o, w, h) => decodePlanarPlaneMajor(d, o, w, h, 4),
    palette: PIC_PALETTE,
    transparentIndex: 15,
    wfontFiles: ['wfont1', 'wfont2', 'wfont3', 'wfont4'], // wfont0.ega is the special mono case, handled separately
  },
  {
    ext: 'cga',
    suffix: '_cga',
    bpp: 2,
    tileBytes: 16,
    decode: (d, o, w, h) => decodePackedPixelLinear(d, o, w, h, 2),
    palette: CGA_PALETTE,
    transparentIndex: 3,
    wfontFiles: ['wfont0', 'wfont1', 'wfont2', 'wfont3', 'wfont4'],
  },
  {
    ext: 't16',
    suffix: '_t16',
    bpp: 4,
    tileBytes: 32,
    decode: (d, o, w, h) => decodePackedPixelLinear(d, o, w, h, 4),
    palette: PIC_PALETTE,
    transparentIndex: 15,
    wfontFiles: ['wfont0', 'wfont1', 'wfont2', 'wfont3', 'wfont4'],
  },
];

/** wfont0.ega only: the special-cased 128-glyph 1bpp monochrome font. */
function decodeWfont0Ega(dataDir: string, outDir: string) {
  const data = readBinary(resolve(dataDir, 'wfont0.ega'));
  if (data.length !== 1024) {
    console.warn(`wfont0.ega: expected 1024 bytes, got ${data.length}`);
  }
  const { rgba, width, height } = decodeMonoGlyphSheet(data, GLYPH_W, GLYPH_H, GLYPH_COUNT, GLYPH_COLS);
  writePNG(resolve(outDir, 'wfont0.png'), rgba, width, height);
  const frames = [];
  for (let g = 0; g < GLYPH_COUNT; g++) {
    frames.push({
      name: `glyph_${g.toString(16).padStart(2, '0')}`,
      x: (g % GLYPH_COLS) * GLYPH_W,
      y: Math.floor(g / GLYPH_COLS) * GLYPH_H,
      w: GLYPH_W,
      h: GLYPH_H,
      charCode: g,
    });
  }
  writeJson(resolve(outDir, 'wfont0.json'), { frames, width, height });
  console.log(`Wrote wfont0.png/.json (${GLYPH_COUNT} glyphs)`);
}

/** General 128-tile (8x8) sheet, used by wfont1-4 on every mode and wfont0 on cga/t16. */
function decodeTileSheet(
  data: Uint8Array,
  baseName: string,
  mode: TileMode,
): { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[]; tileCount: number } {
  const tileCount = Math.floor(data.length / mode.tileBytes);
  const packInputs: PackInput[] = [];
  for (let t = 0; t < tileCount; t++) {
    packInputs.push({ name: `${baseName}_tile${String(t).padStart(3, '0')}`, width: TILE_PX, height: TILE_PX });
  }
  const packed = shelfPack(packInputs, 256);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  for (let t = 0; t < tileCount; t++) {
    const frame = packed.frames[t];
    const img = mode.decode(data, t * mode.tileBytes, TILE_PX, TILE_PX);
    // Deliberately opaque, not indicesToRGBAWithTransparency -- matches the
    // original .ega extractor's behavior (regression-tested byte-identical
    // against it) and the Amiga doc's own finding that wfont1-4 tiles don't
    // use the .PIC transparency convention (unlike wport portraits below).
    const rgba = indicesToPaletteRGBA(img, mode.palette);
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
    frames: packed.frames.map((f) => ({ name: f.name, x: f.x, y: f.y, w: f.width, h: f.height })),
    tileCount,
  };
}

function decodeWfontExtra(dataDir: string, outDir: string, mode: TileMode) {
  for (const base of mode.wfontFiles) {
    const fileName = `${base}.${mode.ext}`;
    const data = readBinary(resolve(dataDir, fileName));
    const expected = WFONT_EXTRA_TILE_COUNT * mode.tileBytes;
    if (data.length !== expected) {
      console.warn(`${fileName}: expected ${expected} bytes, got ${data.length}`);
    }
    const outName = `${base}${mode.suffix}`;
    const atlas = decodeTileSheet(data, outName, mode);
    writePNG(resolve(outDir, `${outName}.png`), atlas.rgba, atlas.width, atlas.height);
    writeJson(resolve(outDir, `${outName}.json`), {
      frames: atlas.frames,
      width: atlas.width,
      height: atlas.height,
    });
    console.log(`Wrote ${outName}.png/.json (${atlas.tileCount} 8x8 tiles)`);
  }
}

function decodePortrait(data: Uint8Array, recordOffset: number, mode: TileMode): Uint8Array {
  const indices = new Uint8Array(PORTRAIT_PX * PORTRAIT_PX);
  for (let ty = 0; ty < TILES_HIGH; ty++) {
    for (let tx = 0; tx < TILES_WIDE; tx++) {
      const t = ty * TILES_WIDE + tx;
      const tile = mode.decode(data, recordOffset + t * mode.tileBytes, 8, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          indices[(ty * 8 + y) * PORTRAIT_PX + (tx * 8 + x)] = tile.indices[y * 8 + x];
        }
      }
    }
  }
  return indices;
}

function decodeWportFile(data: Uint8Array, baseName: string, mode: TileMode) {
  const portraitBytes = TILES_PER_PORTRAIT * mode.tileBytes;
  const recordCount = Math.min(RECORDS_PER_FILE, Math.floor(data.length / portraitBytes));
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
    const indices = decodePortrait(data, i * portraitBytes, mode);
    const rgba = indicesToRGBAWithTransparency(
      { indices, width: PORTRAIT_PX, height: PORTRAIT_PX },
      mode.palette,
      mode.transparentIndex,
    );
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

function decodeWport(dataDir: string, outDir: string, mode: TileMode) {
  for (const base of ['wport1', 'wport2', 'wport3']) {
    const fileName = `${base}.${mode.ext}`;
    const data = readBinary(resolve(dataDir, fileName));
    const expected = RECORDS_PER_FILE * TILES_PER_PORTRAIT * mode.tileBytes;
    // .ega's file is 4096 bytes with 64 trailing zero bytes (14*288=4032);
    // scale that same "trailing padding" allowance by bit depth.
    if (data.length < expected) {
      console.warn(`${fileName}: expected at least ${expected} bytes, got ${data.length}`);
    }
    const outName = `${base}${mode.suffix}`;
    const atlas = decodeWportFile(data, outName, mode);
    writePNG(resolve(outDir, `${outName}.png`), atlas.rgba, atlas.width, atlas.height);
    writeJson(resolve(outDir, `${outName}.json`), {
      frames: atlas.frames,
      width: atlas.width,
      height: atlas.height,
    });
    console.log(`Wrote ${outName}.png/.json (${atlas.recordCount} 24x24 portraits)`);
  }
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-fonts.ts <dataDir>');
    process.exit(1);
  }
  const outDir = resolve(OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  decodeWfont0Ega(dataDir, outDir);
  for (const mode of MODES) {
    decodeWfontExtra(dataDir, outDir, mode);
    decodeWport(dataDir, outDir, mode);
  }
}

// Only run when executed directly, not when imported as a library.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
