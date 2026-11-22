/**
 * Export `mazedata.ega`'s 153 graphics as a **true palette-indexed atlas** —
 * the M6 gap tracked in `docs/wizardry6/TODO.md` (`dungeon-walker-m6-wiring`:
 * "no true-indexed atlas export for mazedata.ega").
 *
 * The existing `decode-maze.ts` writes a plain RGBA atlas whose pixels are
 * the *rendered* 16-colour palette colours. `@seer-project/dungeon`'s
 * `PieceBank.fromIndexedRGBA` instead wants each pixel to *be* an index
 * (recovered by exact RGB match against the palette), because Wizardry 6's
 * renderer (`DrawMazePiece`, `data-structure.md` §4.4) has a **bitwise-OR
 * blit mode** (`mode=1`) that only means anything if the values being OR-ed
 * are the game's real palette indices (0-15), not an arbitrary per-atlas
 * dedup numbering. This exporter produces that indexed atlas so W6 can
 * composite through the package's `PieceBank`/`compositeDrawList` with
 * `blend: 'or'` — the path the walker plan calls "the only approach that
 * reproduces Wizardry 6's mode=1 bitwise-OR blit exactly".
 *
 * The index PNG is a palette-coloured RGBA image (same packing layout and
 * frame names as `decode-maze.ts`'s atlas, so the two are interchangeable),
 * plus a mask PNG. The maze pieces get an opaque mask — `DrawMazePiece`
 * only ever uses `or`/`replace` blends, which ignore it.
 *
 * The same atlas also carries every cel of the two `.PIC` files the game
 * keeps resident for the whole session — `LAB_032B` (`CODE+0x5726`) loads
 * `MON01.PIC` into resource slot 1 and `MON02.PIC` into slot 2 at startup —
 * as frames `mon01_celNN` / `mon02_celNN` (NN = the game's 1-based cel index
 * minus one, the same naming as `sprites/monsters.json`). These are the
 * view's `.PIC`-cel queue records (kind 1 = wall torches, kind 2 = fountain,
 * portcullis and doorway shadow, §4.7.8). Their mask is 0 on the transparent
 * index 15: the cel drawer (`CODE+0x35e6`) skips exactly those pixels
 * (harness-verified, 0 mismatched pixels over a random background).
 *
 * Usage: npx tsx tools/wizardry6/export-mazedata-indexed.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodeDirRecord, parseMazeData, type MazeDirRecord } from './decode-maze.ts';
import { PIC_PALETTE, decodePicCel, readPicDirectory } from './pic-format.ts';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const PLANES = 4;
const ATLAS_MAX_WIDTH = 1024;

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `.PIC` files resident in resource slots 1/2 for the whole session (`LAB_032B`). */
export const RESIDENT_PICS = [1, 2] as const;
const TRANSPARENT_INDEX = 15;

interface IndexedPiece {
  name: string;
  width: number;
  height: number;
  indices: Uint8Array;
  /** true = honour index 15 as transparent in the mask; false = fully opaque. */
  keyed: boolean;
}

/** True-indexed atlas: each pixel = the game's real 4bpp index, encoded as its palette colour. */
function buildIndexedAtlas(pieces: IndexedPiece[]): {
  rgba: Uint8Array;
  maskRgba: Uint8Array;
  width: number;
  height: number;
  frames: AtlasFrame[];
} {
  const packInputs: ShelfPackInput[] = pieces.map((p) => ({ name: p.name, width: p.width, height: p.height }));
  const packed = shelfPack(packInputs, ATLAS_MAX_WIDTH);
  const rgba = new Uint8Array(packed.width * packed.height * 4);
  const maskRgba = new Uint8Array(packed.width * packed.height * 4);
  const byName = new Map(pieces.map((p) => [p.name, p]));
  const frames: AtlasFrame[] = [];
  for (const frame of packed.frames) {
    const rec = byName.get(frame.name)!;
    const indices = rec.indices;
    for (let y = 0; y < rec.height; y++) {
      for (let x = 0; x < rec.width; x++) {
        const srcIdx = y * rec.width + x;
        const dstIdx = ((frame.y + y) * packed.width + frame.x + x) * 4;
        const c = PIC_PALETTE[indices[srcIdx]!]!;
        rgba[dstIdx] = c.r;
        rgba[dstIdx + 1] = c.g;
        rgba[dstIdx + 2] = c.b;
        rgba[dstIdx + 3] = 255;
        // Maze pieces: opaque ('or'/'replace' never consult the mask).
        // Resident .PIC cels: index 15 is the cel drawer's transparent key.
        const m = rec.keyed && indices[srcIdx] === TRANSPARENT_INDEX ? 0 : 255;
        maskRgba[dstIdx] = m;
        maskRgba[dstIdx + 1] = m;
        maskRgba[dstIdx + 2] = m;
        maskRgba[dstIdx + 3] = 255;
      }
    }
    frames.push({ name: frame.name, x: frame.x, y: frame.y, w: frame.w, h: frame.h });
  }
  return { rgba, maskRgba, width: packed.width, height: packed.height, frames };
}

/** Core export logic, reusable from a pipeline `buildAssets` step as well as the CLI below. */
export function exportMazedataIndexed(dataDir: string): void {
  const data = readBinary(resolve(dataDir, 'mazedata.ega'));
  const maze = parseMazeData(data);
  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  mkdirSync(outDir, { recursive: true });

  const pieces: IndexedPiece[] = maze.dirRecords.map((r: MazeDirRecord) => ({
    name: `mazedata_dir${String(r.index).padStart(3, '0')}`,
    width: r.widthPx,
    height: r.heightPx,
    indices: decodeDirRecord(data, r),
    keyed: false,
  }));
  let nCels = 0;
  for (const pic of RESIDENT_PICS) {
    const picData = readBinary(resolve(dataDir, `mon${String(pic).padStart(2, '0')}.pic`));
    for (const cel of readPicDirectory(picData)) {
      pieces.push({
        name: `mon${String(pic).padStart(2, '0')}_cel${String(cel.index).padStart(2, '0')}`,
        width: cel.widthPx,
        height: cel.heightPx,
        indices: decodePicCel(picData, cel),
        keyed: true,
      });
      nCels++;
    }
  }
  const { rgba, maskRgba, width, height, frames } = buildIndexedAtlas(pieces);

  // Palette-encoded index image + opaque mask, same frame names as the
  // RGBA atlas so PieceBank.fromIndexedRGBA / compositeDrawList can use it.
  writePNG(resolve(outDir, 'mazedata-indexed.png'), rgba, width, height);
  writePNG(resolve(outDir, 'mazedata-indexed-mask.png'), maskRgba, width, height);
  writeJson(resolve(outDir, 'mazedata-indexed.json'), {
    frames,
    width,
    height,
    planes: PLANES,
    palette: 'palettes/mazedata.json',
  });

  console.log(
    `Wrote mazedata-indexed.{png,json} + mazedata-indexed-mask.png (${maze.dirRecords.length} maze frames + ${nCels} resident .PIC cels, ${width}x${height}, ${PLANES} planes, ${PIC_PALETTE.length}-colour palette)`,
  );
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/export-mazedata-indexed.ts <dataDir>');
    process.exit(1);
  }
  exportMazedataIndexed(dataDir);
}

const isStandalone =
  process.argv[1]?.endsWith('export-mazedata-indexed.ts') ||
  process.argv[1]?.endsWith('export-mazedata-indexed');

if (isStandalone) main();
