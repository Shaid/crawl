/**
 * Composites Wizardry 6's (Amiga) confirmed static first-person corridor
 * frame -- the 16 `DrawMazePiece` calls in `static-corridor-calls.ts` --
 * into an actual PNG, using `@seer-project/dungeon`'s `IndexedSurface.blit`.
 *
 * This is the M1-equivalent verification target: not a per-cell-driven
 * render (no `slots.json`/general slot-key scheme exists yet -- see
 * `docs/wizardry6/TODO.md`'s `dungeon-walker-m6-wiring` row), just this one
 * known-good frame, faithfully reproduced from confirmed disassembly.
 *
 * ## Why not `PieceBank`/`compositeSlotTable`
 *
 * `PieceBank.fromRGBA` (the only atlas path this repo's existing
 * `mazedata.png` fits) derives an *arbitrary* per-atlas palette by
 * deduplicating RGBA colors -- fine for `blend: 'replace'`/`'mask'`, but
 * wrong for `blend: 'or'`: OR-ing two arbitrarily-reassigned indices bears
 * no relationship to OR-ing the game's real 4-bit indices. `mazedata.ega`
 * has no true-indexed PNG export yet (`decode-maze.ts` only writes the
 * RGBA-baked atlas), so this script decodes the ~10 directory records the
 * 16 calls actually reference directly from the raw file via
 * `decodeDirRecord` -- real index buffers, not reassigned ones -- and
 * blits them straight onto an `IndexedSurface`, bypassing `PieceBank`
 * entirely. A general indexed-atlas export is real future work, not
 * needed for this one fixed verification frame.
 *
 * ## Coordinate conversion
 *
 * Every compose-list field (`destXByte`, `srcClip`, `widthBytes`) and every
 * directory field (`widthUnits`) is in **bytes** -- 1 byte = 8 pixels in
 * this 1-bit-per-pixel-per-bitplane format (`data-structure.md` §4.2/§4.4).
 * Multiply by 8 for pixel-space `IndexedSurface.blit` calls. Direct-path
 * (`dstIdx===0xffff`) placement/graphic both come from `composeList[srcIdx]`;
 * mirrored-path graphic comes from `composeList[srcIdx].dirIndex` but
 * placement (`destXByte`/`destY`/`srcClip`/`widthBytes`) comes from
 * `composeList[dstIdx]`, and the source byte-columns read are
 * `[widthUnits-srcClip-widthBytes, widthUnits-1-srcClip]` (derived from the
 * doc's own "walks backwards from offset+widthUnits-1-srcClip" address
 * formula) -- a normal *forward* sub-rectangle that `IndexedSurface.blit`'s
 * `mirrorX: true` then reverses, which is exactly equivalent to the game's
 * own backward/bit-reversed read (bit-reversing a byte's 8 bits is exactly
 * reversing its 8 pixels' order).
 *
 * Usage: npx tsx tools/wizardry6/render-static-corridor.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { IndexedSurface } from '@seer-project/dungeon';
import { parseMazeData, decodeDirRecord, type MazeData, type MazeDirRecord } from './decode-maze.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { STATIC_CORRIDOR_CALLS, type DrawMazePieceCall } from './static-corridor-calls.ts';

const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;

/** One resolved draw, in pixel space, ready for `IndexedSurface.blit`. */
interface ResolvedDraw {
  dirIndex: number;
  srcXPx: number;
  widthPx: number;
  destXPx: number;
  destY: number;
  heightPx: number;
  mirror: boolean;
  mode: 0 | 1;
}

/** Resolve one `DrawMazePiece(srcIdx, mode, dstIdx)` call into pixel-space placement, per the confirmed CODE+0x3d72 semantics. */
function resolveCall(maze: MazeData, call: DrawMazePieceCall): ResolvedDraw {
  const direct = call.dstIdx === 0xffff;
  const placementRec = direct ? maze.composeList[call.srcIdx]! : maze.composeList[call.dstIdx]!;
  const graphicRec = maze.composeList[call.srcIdx]!;
  const gfx = maze.dirRecords[graphicRec.dirIndex]!;

  const destXPx = (placementRec.destXByte + placementRec.srcClip) * 8;
  const widthPx = placementRec.widthBytes * 8;

  const srcByteStart = direct
    ? placementRec.srcClip
    : gfx.widthUnits - placementRec.srcClip - placementRec.widthBytes;

  return {
    dirIndex: graphicRec.dirIndex,
    srcXPx: srcByteStart * 8,
    widthPx,
    destXPx,
    destY: placementRec.destY,
    heightPx: gfx.heightPx,
    mirror: !direct,
    mode: call.mode,
  };
}

function indicesToRGBA(indices: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const color = PIC_PALETTE[indices[i]!]!;
    rgba[i * 4] = color.r;
    rgba[i * 4 + 1] = color.g;
    rgba[i * 4 + 2] = color.b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/render-static-corridor.ts <dataDir>');
    process.exit(1);
  }

  const data = readBinary(resolve(dataDir, 'mazedata.ega'));
  const maze = parseMazeData(data);

  const surface = new IndexedSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
  surface.clear(0);

  const decodedByDirIndex = new Map<number, { data: Uint8Array; width: number; height: number }>();
  const decodeCache = (rec: MazeDirRecord) => {
    let cached = decodedByDirIndex.get(rec.index);
    if (!cached) {
      cached = { data: decodeDirRecord(data, rec), width: rec.widthPx, height: rec.heightPx };
      decodedByDirIndex.set(rec.index, cached);
    }
    return cached;
  };

  for (const [i, call] of STATIC_CORRIDOR_CALLS.entries()) {
    const resolved = resolveCall(maze, call);
    const gfxRec = maze.dirRecords[resolved.dirIndex]!;
    const src = decodeCache(gfxRec);
    console.log(
      `call ${i + 1}: dirIndex=${resolved.dirIndex} src=(${resolved.srcXPx},0) ${resolved.widthPx}x${resolved.heightPx} -> dest=(${resolved.destXPx},${resolved.destY}) mirror=${resolved.mirror} mode=${resolved.mode === 1 ? 'or' : 'replace'}`,
    );
    surface.blit(
      src,
      resolved.srcXPx,
      0,
      resolved.widthPx,
      resolved.heightPx,
      resolved.destXPx,
      resolved.destY,
      resolved.mirror,
      resolved.mode === 1 ? 'or' : 'replace',
    );
  }

  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  mkdirSync(outDir, { recursive: true });
  const rgba = indicesToRGBA(surface.data, surface.width, surface.height);
  writePNG(resolve(outDir, 'static-corridor.png'), rgba, surface.width, surface.height);
  console.log(`Wrote static-corridor.png (${surface.width}x${surface.height}) to ${outDir}`);
}

main();
