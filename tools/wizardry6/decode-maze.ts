/**
 * Decodes Wizardry 6 (Amiga) `mazedata.ega` (102456 bytes): the dungeon
 * wall/corridor/floor graphics bank plus a compose-list sub-table.
 *
 * Format confirmed by disassembling `Bane`'s own loader for this specific
 * file (not inferred from the bytes alone -- see
 * docs/wizardry6/amiga/investigations/mazedata.md for the full derivation
 * and verification evidence):
 *
 *   +0   u16 BE   dirCount    -- number of directory records (153)
 *   +2   u16 BE   subCount    -- number of compose-list sub-records (366)
 *   +4   dirCount x 6 bytes   -- directory records:
 *          +0  u32 BE   offset       -- absolute file offset of this
 *                                       record's pixel data
 *          +4  u8       widthUnits   -- width in 8px units (px = *8)
 *          +5  u8       heightRows   -- height in rows (px)
 *   (4 + dirCount*6)
 *        subCount x 5 bytes  -- compose-list records. CONFIRMED by tracing
 *                               the dungeon-view renderer at `CODE+0x3d72`
 *                               (see data-structure.md section 4.4):
 *          +0  u8  dirIndex  -- index into the directory above (all 366
 *                               values are in 0..152 and every one of the
 *                               153 directory entries is referenced)
 *          +1  i8  destXByte -- destination byte column, SIGN-EXTENDED
 *                               (`ext.w` at CODE+0x3daa); 0xFF is a real
 *                               -1, not a sentinel
 *          +2  u8  destY     -- destination row (multiplied by 40 = the
 *                               320px screen's bytes-per-row)
 *          +3  u8  srcClip   -- left-clip: skip this many bytes from the
 *                               source graphic's left edge, and shift the
 *                               destination right by the same amount
 *          +4  u8  widthBytes-- number of bytes copied per row (clipped
 *                               width); 0 means "draw nothing" (early-out
 *                               at CODE+0x3d9c), used by 49/366 records as
 *                               alignment padding in the depth cascade
 *
 * The renderer computes the record address as
 * `composeListBase + index*5` (`mulu.w #5` at CODE+0x3d88) and the
 * graphic's directory address as `mazeBuffer + 4 + dirIndex*6`
 * (`mulu.w #6; addq.l #4` at CODE+0x3dce). Destination address is
 * `screenBase + destY*40 + destXByte + srcClip`.
 *
 * Each directory record's pixel data is `widthUnits * heightRows * 4`
 * bytes: 4 Amiga bitplanes, **plane-major** (all rows of plane 0, then all
 * of plane 1, ...), MSB-first/leftmost -- identical convention to the
 * confirmed `.PIC` cel format and `.EGA` full-screen images in this corpus.
 * Rendered with the same confirmed 16-colour `.PIC` palette
 * (`PIC_PALETTE`), these decode as clean, legible dungeon art: mortared
 * stone brick walls (several perspective-scaled sizes of the same
 * texture), a full corridor/archway scene with hanging red drapes and a
 * receding stairway, wall decorations (hanging chains), floor/ceiling
 * perspective strips, and a run of 20 consecutive 16x16 UI icons (a sword,
 * rings/dials, robed figures, ships/statues, and text-bearing dial icons)
 * at the end of the directory.
 *
 * Ground truth: `Bane` `CODE+0x3c56`-`0x3cf6` (the function that loads
 * `mazedata.ega`) computes `total_size = dirRecords[last].offset +
 * widthUnits*heightRows*4` to know how many bytes to read from disk --
 * the exact formula this module implements, read directly out of the
 * game's own code, not just inferred from the file's byte layout. The
 * partition invariant `dirRecords[i+1].offset - dirRecords[i].offset ===
 * widthUnits[i]*heightRows[i]*4` (or, for the last record, `fileSize -
 * offset`) holds with zero deviation across all 153 records.
 *
 * Usage: npx tsx tools/wizardry6/decode-maze.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodePlanarPlaneMajor, indicesToPaletteRGBA } from '../shared/amiga-planar.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { shelfPack, type PackInput } from '../shared/atlas-pack.ts';

const HEADER_SIZE = 4;
const DIR_RECORD_SIZE = 6;
const SUB_RECORD_SIZE = 5;
const PLANES = 4;
const ATLAS_MAX_WIDTH = 1024;

export interface MazeDirRecord {
  index: number;
  offset: number;
  widthUnits: number;
  heightRows: number;
  widthPx: number;
  heightPx: number;
}

export interface MazeComposeRecord {
  index: number;
  /** Index into `dirRecords` -- the graphic to draw. Always 0..dirCount-1. */
  dirIndex: number;
  /** Destination byte column, sign-extended (can legitimately be -1). */
  destXByte: number;
  /** Destination screen row (renderer multiplies by 40 bytes/row). */
  destY: number;
  /** Bytes skipped from the source graphic's left edge (and added to destX). */
  srcClip: number;
  /** Bytes copied per row; 0 = draw nothing (renderer early-outs). */
  widthBytes: number;
}

export interface MazeData {
  dirCount: number;
  subCount: number;
  dirRecords: MazeDirRecord[];
  composeList: MazeComposeRecord[];
}

/** Parse `mazedata.ega`'s header, directory, and compose-list sub-table. */
export function parseMazeData(data: Uint8Array): MazeData {
  const dirCount = (data[0] << 8) | data[1];
  const subCount = (data[2] << 8) | data[3];

  const dirRecords: MazeDirRecord[] = [];
  let off = HEADER_SIZE;
  for (let i = 0; i < dirCount; i++) {
    const offset =
      ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;
    const widthUnits = data[off + 4];
    const heightRows = data[off + 5];
    dirRecords.push({
      index: i,
      offset,
      widthUnits,
      heightRows,
      widthPx: widthUnits * 8,
      heightPx: heightRows,
    });
    off += DIR_RECORD_SIZE;
  }

  const composeList: MazeComposeRecord[] = [];
  for (let i = 0; i < subCount; i++) {
    const b1 = data[off + 1];
    composeList.push({
      index: i,
      dirIndex: data[off],
      // CODE+0x3daa sign-extends this byte (`ext.w d0`) before use.
      destXByte: b1 >= 0x80 ? b1 - 0x100 : b1,
      destY: data[off + 2],
      srcClip: data[off + 3],
      widthBytes: data[off + 4],
    });
    off += SUB_RECORD_SIZE;
  }

  return { dirCount, subCount, dirRecords, composeList };
}

/** Byte length of a directory record's pixel data (verification helper). */
export function dirRecordByteLength(rec: MazeDirRecord): number {
  return rec.widthUnits * rec.heightRows * PLANES;
}

/** Decode one directory record to an 8-bit chunky index buffer. */
export function decodeDirRecord(data: Uint8Array, rec: MazeDirRecord): Uint8Array {
  const { indices } = decodePlanarPlaneMajor(
    data,
    rec.offset,
    rec.widthPx,
    rec.heightPx,
    PLANES,
  );
  return indices;
}

/** Screen geometry the renderer at `CODE+0x3d72` assumes (320x200, 4 planes). */
const SCREEN_BYTES_PER_ROW = 0x28;
const SCREEN_PLANE_BYTES = 0x2000;
const SCREEN_ROWS = 200;

/**
 * Verify the compose-list invariants implied by the renderer's own
 * arithmetic at `CODE+0x3d72`. Every one of these must hold for the game's
 * blit to stay inside both the source graphic and the destination screen
 * plane -- so zero violations is strong confirmation of the field
 * semantics, independent of any rendered output. Returns violations
 * (empty = clean).
 */
export function verifyComposeListInvariants(maze: MazeData): string[] {
  const violations: string[] = [];
  for (const rec of maze.composeList) {
    if (rec.dirIndex >= maze.dirCount) {
      violations.push(`compose[${rec.index}]: dirIndex ${rec.dirIndex} >= dirCount ${maze.dirCount}`);
      continue;
    }
    // widthBytes == 0 is the renderer's explicit "draw nothing" early-out
    // (CODE+0x3d9c) -- the other fields are then never read.
    if (rec.widthBytes === 0) continue;
    const gfx = maze.dirRecords[rec.dirIndex];
    const x = rec.destXByte + rec.srcClip;
    if (rec.srcClip + rec.widthBytes > gfx.widthUnits) {
      violations.push(
        `compose[${rec.index}]: srcClip+widthBytes ${rec.srcClip + rec.widthBytes} exceeds source widthUnits ${gfx.widthUnits}`,
      );
    }
    if (x < 0 || x + rec.widthBytes > SCREEN_BYTES_PER_ROW) {
      violations.push(`compose[${rec.index}]: destination x range ${x}..${x + rec.widthBytes} outside 0..${SCREEN_BYTES_PER_ROW}`);
    }
    if (rec.destY + gfx.heightPx > SCREEN_ROWS) {
      violations.push(`compose[${rec.index}]: destY+height ${rec.destY + gfx.heightPx} exceeds ${SCREEN_ROWS} rows`);
    }
    const lastByte = (rec.destY + gfx.heightPx - 1) * SCREEN_BYTES_PER_ROW + x + rec.widthBytes;
    if (lastByte > SCREEN_PLANE_BYTES) {
      violations.push(`compose[${rec.index}]: last written byte ${lastByte} exceeds plane size ${SCREEN_PLANE_BYTES}`);
    }
  }
  return violations;
}

/** Verify the offset-partition invariant across the whole directory. Returns violations (empty = clean). */
export function verifyPartitionInvariant(data: Uint8Array, maze: MazeData): string[] {
  const violations: string[] = [];
  for (let i = 0; i < maze.dirRecords.length; i++) {
    const rec = maze.dirRecords[i];
    const expectedLen = dirRecordByteLength(rec);
    const next = maze.dirRecords[i + 1];
    const actualLen = next ? next.offset - rec.offset : data.length - rec.offset;
    if (actualLen !== expectedLen) {
      violations.push(
        `record ${i}: expected length ${expectedLen}, actual gap to next offset ${actualLen}`,
      );
    }
  }
  return violations;
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
): { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[] } {
  const packInputs: PackInput[] = records.map((r) => ({
    name: `mazedata_dir${String(r.index).padStart(3, '0')}`,
    width: r.widthPx,
    height: r.heightPx,
  }));
  const packed = shelfPack(packInputs, ATLAS_MAX_WIDTH);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const byName = new Map(records.map((r, i) => [packInputs[i].name, r]));
  const frames: AtlasFrame[] = [];
  for (const frame of packed.frames) {
    const rec = byName.get(frame.name)!;
    const indices = decodeDirRecord(data, rec);
    // NOT celIndicesToRGBA: that function's index-15-is-transparent rule is
    // the `.PIC` cel drawer's own convention (CODE+0x35e6 et al) and does
    // not apply here. mazedata.ega's tiles are consumed by a different
    // renderer, DrawMazePiece (CODE+0x3d72), which has only two blit modes
    // -- opaque replace and bitwise-OR overlay (see data-structure.md
    // section 4.4) -- neither keyed on palette index 15. Applying the .PIC
    // rule here previously punched alpha holes in ordinary opaque pixels
    // that happen to be index 15 (a real, visible colour in this palette),
    // wrongly marking 2156/199408 in-frame pixels transparent. Render fully
    // opaque with the real palette colour instead.
    const rgba = indicesToPaletteRGBA({ indices, width: rec.widthPx, height: rec.heightPx }, PIC_PALETTE);
    for (let y = 0; y < rec.heightPx; y++) {
      const srcRowOff = y * rec.widthPx * 4;
      const dstRowOff = ((frame.y + y) * packed.width + frame.x) * 4;
      atlas.set(rgba.subarray(srcRowOff, srcRowOff + rec.widthPx * 4), dstRowOff);
    }
    frames.push({ name: frame.name, x: frame.x, y: frame.y, w: frame.width, h: frame.height });
  }
  return { rgba: atlas, width: packed.width, height: packed.height, frames };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-maze.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'mazedata.ega'));
  const maze = parseMazeData(data);

  const violations = verifyPartitionInvariant(data, maze);
  if (violations.length > 0) {
    console.warn(`mazedata.ega: ${violations.length} partition-invariant violations:`);
    for (const v of violations.slice(0, 10)) console.warn(`  ${v}`);
  } else {
    console.log(
      `mazedata.ega: partition invariant holds with zero deviation across ${maze.dirRecords.length} directory records`,
    );
  }

  const composeViolations = verifyComposeListInvariants(maze);
  if (composeViolations.length > 0) {
    console.warn(`mazedata.ega: ${composeViolations.length} compose-list invariant violations:`);
    for (const v of composeViolations.slice(0, 10)) console.warn(`  ${v}`);
  } else {
    const drawn = maze.composeList.filter((r) => r.widthBytes > 0).length;
    console.log(
      `mazedata.ega: compose-list renderer invariants (source clip, screen X/Y, plane bounds) hold with zero deviation across ${drawn}/${maze.composeList.length} drawn records`,
    );
  }

  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  const palettesDir = resolve('public/assets/wizardry6/amiga/palettes');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(palettesDir, { recursive: true });

  writeJson(resolve(palettesDir, 'mazedata.json'), { colors: PIC_PALETTE });

  const atlas = buildAtlas(data, maze.dirRecords);
  writePNG(resolve(outDir, 'mazedata.png'), atlas.rgba, atlas.width, atlas.height);
  writeJson(resolve(outDir, 'mazedata.json'), {
    frames: atlas.frames,
    width: atlas.width,
    height: atlas.height,
  });

  // Compose-list sub-table: field semantics confirmed against the renderer
  // at CODE+0x3d72 (see data-structure.md section 4.4).
  writeJson(resolve(outDir, 'mazedata-composelist.json'), {
    dirCount: maze.dirCount,
    subCount: maze.subCount,
    records: maze.composeList,
  });

  console.log(
    `Wrote mazedata.png/.json (${maze.dirRecords.length} directory records) and mazedata-composelist.json (${maze.composeList.length} sub-records)`,
  );
}

const isStandalone =
  process.argv[1]?.endsWith('decode-maze.ts') ||
  process.argv[1]?.endsWith('decode-maze');

if (isStandalone) main();
