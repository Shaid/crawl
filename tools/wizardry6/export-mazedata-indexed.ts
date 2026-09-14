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
 * plus an opaque mask PNG — W6 only ever uses `or`/`replace` blends, which
 * ignore the mask, so a fully-opaque mask is correct.
 *
 * Usage: npx tsx tools/wizardry6/export-mazedata-indexed.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodeDirRecord, parseMazeData, type MazeDirRecord } from './decode-maze.ts';
import { PIC_PALETTE } from './pic-format.ts';
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

/** True-indexed atlas: each pixel = the game's real 4bpp index, encoded as its palette colour. */
function buildIndexedAtlas(
  data: Uint8Array,
  records: MazeDirRecord[],
): {
  rgba: Uint8Array;
  maskRgba: Uint8Array;
  width: number;
  height: number;
  frames: AtlasFrame[];
} {
  const packInputs: ShelfPackInput[] = records.map((r) => ({
    name: `mazedata_dir${String(r.index).padStart(3, '0')}`,
    width: r.widthPx,
    height: r.heightPx,
  }));
  const packed = shelfPack(packInputs, ATLAS_MAX_WIDTH);
  const rgba = new Uint8Array(packed.width * packed.height * 4);
  const maskRgba = new Uint8Array(packed.width * packed.height * 4);
  const byName = new Map(records.map((r, i) => [packInputs[i].name, r]));
  const frames: AtlasFrame[] = [];
  for (const frame of packed.frames) {
    const rec = byName.get(frame.name)!;
    const indices = decodeDirRecord(data, rec);
    for (let y = 0; y < rec.heightPx; y++) {
      for (let x = 0; x < rec.widthPx; x++) {
        const srcIdx = y * rec.widthPx + x;
        const dstIdx = ((frame.y + y) * packed.width + frame.x + x) * 4;
        const c = PIC_PALETTE[indices[srcIdx]!]!;
        rgba[dstIdx] = c.r;
        rgba[dstIdx + 1] = c.g;
        rgba[dstIdx + 2] = c.b;
        rgba[dstIdx + 3] = 255;
        // Opaque mask: W6's 'or'/'replace' blends never consult it, and
        // background pixels are never blitted (frames cover only their rect).
        maskRgba[dstIdx] = 255;
        maskRgba[dstIdx + 1] = 255;
        maskRgba[dstIdx + 2] = 255;
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

  const { rgba, maskRgba, width, height, frames } = buildIndexedAtlas(data, maze.dirRecords);

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
    `Wrote mazedata-indexed.{png,json} + mazedata-indexed-mask.png (${maze.dirRecords.length} frames, ${width}x${height}, ${PLANES} planes, ${PIC_PALETTE.length}-colour palette)`,
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
