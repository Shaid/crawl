/**
 * Decodes Wizardry 6 (DOS/EGA) `mazedata.ega`/`.cga`/`.t16`: the dungeon
 * wall/corridor/floor graphics bank plus a compose-list sub-table, in all
 * three platform-variant bit depths.
 *
 * Same overall shape as the Amiga release (tools/wizardry6/decode-maze.ts)
 * -- 4-byte header (dirCount, subCount as u16 LE here), a directory, a
 * compose-list sub-table, then back-to-back graphics blocks -- but the
 * DOS directory record is **5 bytes, not 6**: the per-record absolute
 * file-offset field present on Amiga is dropped entirely. Confirmed
 * zero-deviation (see docs/wizardry6/dosega/data-structure.md section 3):
 *
 *   +0   dirCount x 5 bytes  -- directory records:
 *          +0  3 bytes  unknown/vestigial (NOT a usable file offset --
 *                       exhaustively brute-forced, no consistent
 *                       relationship to any real file position found)
 *          +3  u8       widthUnits  -- width in 8px units (byte-identical
 *                                      to the Amiga release's values,
 *                                      0/153 mismatches)
 *          +4  u8       heightRows  -- height in rows (byte-identical to
 *                                      Amiga, 0/153 mismatches)
 *   (4 + dirCount*5)
 *        subCount x 5 bytes  -- compose-list records, same byte size as
 *                                Amiga; field semantics not re-examined
 *                                this pass
 *   (4 + dirCount*5 + subCount*5) = gfxBase
 *        graphics blocks, IMPLICIT/CUMULATIVE offsets: block i starts at
 *        gfxBase + sum(widthUnits[j]*heightRows[j]*bpp) for all j < i (no
 *        stored offset needed -- there is none). `bpp` = bits/pixel = 4
 *        for .ega/.t16, 2 for .cga -- the header/directory/compose-list
 *        overhead (2599 bytes) is unchanged across all three variants;
 *        only the per-record pixel payload scales with bit depth.
 *
 * .EGA: verified gfxBase (2599) + sum of all 153 blocks' byte sizes
 * (99704) = 102303, exactly the real file size, zero deviation. Pixel
 * format is plane-major, 4bpp, MSB-first (same as the Amiga release and
 * the `.PIC` tile convention) and the confirmed PIC_PALETTE renders
 * clean, recognisable perspective-scaled brick-wall textures and UI
 * icons.
 *
 * .CGA (52451 bytes) / .T16 (102303 bytes): same directory/header
 * structure, `bpp` swapped to 2/4. Critically, the *pixel* encoding for
 * these two is **packed-pixel (chunky)**, not planar -- a plane-major
 * bitplane decode at 2 (or 4) planes renders as pure noise; only
 * `decodePackedPixelLinear` (the same chunky format `.T16` full screens
 * use, applied per-record with no bank interleave -- these are graphics
 * bank blocks, not a direct-to-video-memory image) produces the expected
 * clean brick-wall/corridor art. This differs from the full-screen
 * `.CGA` format (`decode-dosega-ega-screen.ts`), which *is* hardware-bank
 * interleaved -- the bank layout is a video-memory convention that only
 * applies to images blitted straight to the screen, not to this
 * asset-bank's individual graphics blocks. Verified zero-deviation byte
 * accounting for both (`gfxBase + sum(w*h*bpp) === fileSize`, exact), and
 * clean renders using the same CGA_PALETTE/PIC_PALETTE as the
 * corresponding full-screen format.
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-maze.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { indicesToPaletteRGBA, type PlanarImage, type RGB } from '../shared/amiga-planar.ts';
import { decodePackedPixelLinear, decodePlanar } from '@seer-project/gfx';
import { PIC_PALETTE } from './pic-format.ts';
import { CGA_PALETTE } from './dosega-cga-palette.ts';
import { r16, shelfPack, type ShelfPackInput } from '@seer-project/core';

const HEADER_SIZE = 4;
const DIR_RECORD_SIZE = 5;
const SUB_RECORD_SIZE = 5;
const ATLAS_MAX_WIDTH = 1024;

export interface MazeDirRecord {
  index: number;
  offset: number; // computed cumulative offset, not stored on disk
  widthUnits: number;
  heightRows: number;
  widthPx: number;
  heightPx: number;
  unknown3Bytes: string; // hex, vestigial -- not a usable offset, see doc
}

export interface MazeData {
  dirCount: number;
  subCount: number;
  dirRecords: MazeDirRecord[];
  gfxBase: number;
}

/**
 * Parse a `mazedata`'s header and directory (DOS 5-byte record layout).
 * `bpp` (bits/pixel: 4 for .ega/.t16, 2 for .cga) only affects the
 * cumulative graphics-block offset math -- the header/directory/
 * compose-list layout is identical across all three variants.
 */
export function parseMazeData(data: Uint8Array, bpp = 4): MazeData {
  const dirCount = r16(data, 0, 'le');
  const subCount = r16(data, 2, 'le');

  const raw: Array<{ widthUnits: number; heightRows: number; unknown3Bytes: string }> = [];
  let off = HEADER_SIZE;
  for (let i = 0; i < dirCount; i++) {
    const unknown3Bytes = Buffer.from(data.subarray(off, off + 3)).toString('hex');
    const widthUnits = data[off + 3];
    const heightRows = data[off + 4];
    raw.push({ widthUnits, heightRows, unknown3Bytes });
    off += DIR_RECORD_SIZE;
  }
  // Compose-list sub-table: skip over it (field semantics not re-examined
  // this pass), only its byte size is needed to locate gfxBase.
  off += subCount * SUB_RECORD_SIZE;
  const gfxBase = off;

  let cum = gfxBase;
  const dirRecords: MazeDirRecord[] = raw.map((r, i) => {
    const rec: MazeDirRecord = {
      index: i,
      offset: cum,
      widthUnits: r.widthUnits,
      heightRows: r.heightRows,
      widthPx: r.widthUnits * 8,
      heightPx: r.heightRows,
      unknown3Bytes: r.unknown3Bytes,
    };
    cum += r.widthUnits * r.heightRows * bpp;
    return rec;
  });

  return { dirCount, subCount, dirRecords, gfxBase };
}

export function dirRecordByteLength(rec: MazeDirRecord, bpp = 4): number {
  return rec.widthUnits * rec.heightRows * bpp;
}

export function decodeDirRecord(
  data: Uint8Array,
  rec: MazeDirRecord,
  decode: (d: Uint8Array, o: number, w: number, h: number) => PlanarImage = (d, o, w, h) => ({
    indices: decodePlanar(d, { width: w, height: h, planes: 4, layout: 'plane-major', offset: o }),
    width: w,
    height: h,
  }),
): Uint8Array {
  return decode(data, rec.offset, rec.widthPx, rec.heightPx).indices;
}

/** Verify the cumulative byte accounting exactly reaches the real file size. */
export function verifyByteAccounting(data: Uint8Array, maze: MazeData, bpp = 4): string | null {
  const last = maze.dirRecords[maze.dirRecords.length - 1];
  const end = last.offset + dirRecordByteLength(last, bpp);
  if (end !== data.length) {
    return `computed end offset ${end} !== file size ${data.length}`;
  }
  return null;
}

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildAtlas(
  data: Uint8Array,
  records: MazeDirRecord[],
  decode: (d: Uint8Array, o: number, w: number, h: number) => PlanarImage,
  palette: RGB[],
  namePrefix: string,
): { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[] } {
  const packInputs: ShelfPackInput[] = records.map((r) => ({
    name: `${namePrefix}_dir${String(r.index).padStart(3, '0')}`,
    width: r.widthPx,
    height: r.heightPx,
  }));
  const packed = shelfPack(packInputs, ATLAS_MAX_WIDTH);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const byName = new Map(records.map((r, i) => [packInputs[i].name, r]));
  const frames: AtlasFrame[] = [];
  for (const frame of packed.frames) {
    const rec = byName.get(frame.name)!;
    const img = decode(data, rec.offset, rec.widthPx, rec.heightPx);
    // NOT the "max index = transparent" .PIC-cel convention (that was a
    // bug here too, inherited from the pre-fix Amiga extractor -- see
    // decode-maze.ts). This asset bank's tiles are consumed by
    // DrawMazePiece, which has only opaque-replace and bitwise-OR blit
    // modes, neither keyed on palette index -- render fully opaque with
    // the real palette colour instead.
    const rgba = indicesToPaletteRGBA(img, palette);
    for (let y = 0; y < rec.heightPx; y++) {
      const srcRowOff = y * rec.widthPx * 4;
      const dstRowOff = ((frame.y + y) * packed.width + frame.x) * 4;
      atlas.set(rgba.subarray(srcRowOff, srcRowOff + rec.widthPx * 4), dstRowOff);
    }
    frames.push({ name: frame.name, x: frame.x, y: frame.y, w: frame.w, h: frame.h });
  }
  return { rgba: atlas, width: packed.width, height: packed.height, frames };
}

interface MazeMode {
  ext: string;
  suffix: string;
  bpp: number;
  decode: (d: Uint8Array, o: number, w: number, h: number) => PlanarImage;
  palette: RGB[];
  paletteName: string;
}

const MODES: MazeMode[] = [
  {
    ext: 'ega',
    suffix: '',
    bpp: 4,
    decode: (d, o, w, h) => ({
      indices: decodePlanar(d, { width: w, height: h, planes: 4, layout: 'plane-major', offset: o }),
      width: w,
      height: h,
    }),
    palette: PIC_PALETTE,
    paletteName: 'PIC_PALETTE',
  },
  {
    ext: 'cga',
    suffix: '_cga',
    bpp: 2,
    decode: (d, o, w, h) => ({ indices: decodePackedPixelLinear(d, o, w, h, 2), width: w, height: h }),
    palette: CGA_PALETTE,
    paletteName: 'CGA_PALETTE',
  },
  {
    ext: 't16',
    suffix: '_t16',
    bpp: 4,
    decode: (d, o, w, h) => ({ indices: decodePackedPixelLinear(d, o, w, h, 4), width: w, height: h }),
    palette: PIC_PALETTE,
    paletteName: 'PIC_PALETTE',
  },
];

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-maze.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/dosega/maps');
  const palettesDir = resolve('public/assets/wizardry6/dosega/palettes');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(palettesDir, { recursive: true });

  for (const mode of MODES) {
    const fileName = `mazedata.${mode.ext}`;
    const data = readBinary(resolve(dataDir, fileName));
    const maze = parseMazeData(data, mode.bpp);

    const err = verifyByteAccounting(data, maze, mode.bpp);
    if (err) {
      console.warn(`${fileName}: byte-accounting mismatch: ${err}`);
    } else {
      console.log(
        `${fileName}: cumulative byte accounting exact (gfxBase=${maze.gfxBase} + payload = ${data.length})`,
      );
    }

    const outName = `mazedata${mode.suffix}`;
    writeJson(resolve(palettesDir, `${outName}.json`), { colors: mode.palette });

    const atlas = buildAtlas(data, maze.dirRecords, mode.decode, mode.palette, outName);
    writePNG(resolve(outDir, `${outName}.png`), atlas.rgba, atlas.width, atlas.height);
    writeJson(resolve(outDir, `${outName}.json`), {
      frames: atlas.frames,
      width: atlas.width,
      height: atlas.height,
    });

    console.log(
      `Wrote ${outName}.png/.json (${maze.dirRecords.length} directory records, ${mode.paletteName})`,
    );
  }
}

// Only run when executed directly (`npx tsx decode-dosega-maze.ts ...`), not
// when other decode-dosega-*.ts scripts import parseMazeData/etc. as a
// library -- this file is imported for its exports by
// __tests__/packed-pixel.test.ts.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
