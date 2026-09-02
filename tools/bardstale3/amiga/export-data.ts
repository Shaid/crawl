/**
 * Bard's Tale III: Thief of Fate (Amiga, WHDLoad dump).
 *
 * Usage: npx tsx tools/bardstale3/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/_unexplored_/BardsTale3/data`.)
 *
 * Identity: confirmed as game 3 via `BardsTale3.slave`'s WHDLoad header text
 * — see docs/bardstale3/amiga/data-structure.md §0.
 *
 * Decodes `all.pic` — same `u32BE[N+1]`-directory convention as BT1/BT2's
 * `pics` (here with an explicit sentinel: the last directory entry ==
 * file length), but each record is a from-scratch LZ77+adaptive-Huffman
 * stream (structurally the classic Okumura LZHUF/LHarc family — 4096-byte
 * ring buffer, position/length split-coded via hardcoded `_hard1`/`_hard2`
 * log2-bucket tables) decoding to 19712 bytes = 4 chunky (packed-nibble)
 * 112x88 4bpp sub-frames, with an inter-sub-frame XOR delta undone on top.
 *
 * Palette comes from a SEPARATE file, `bard3`, via a small 88-row id-remap
 * table at file offset 0x2589E (all.pic index -> row) feeding a
 * palette-select table at 0x25A98 (row -> palette index) feeding 16-word
 * palettes at 0x25978 + paletteIndex*32. Not every all.pic index appears in
 * the remap table (see docs/bardstale3/TODO.md for indices this leaves
 * unresolved).
 *
 * Codec: `tools/shared/bardstale-codecs.ts` (see that module's doc for the
 * byte-exact ground-truth oracle this was ported from).
 *
 * Real picture count: empirically probed (sequential decode until failure)
 * at exactly 84 (indices 0-83), all decoding cleanly.
 *
 * Writes:
 *   public/assets/bardstale3/amiga/sprites/pics.png + .json (atlas + frames)
 *     — one atlas cell per (picture, sub-frame) pair, 84*4 = up to 336 cells.
 */
import { resolve } from 'node:path';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { loadBard3Picture, BARDSTALE_PICTURE_WIDTH as W, BARDSTALE_PICTURE_HEIGHT as H } from '../../shared/bardstale-codecs.ts';
import { decodePackedPixelLinear } from '../../shared/packed-pixel.ts';
import { blitRGBA, amiga12ToRGB, indicesToRGBA } from '../../shared/amiga-planar.ts';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';

const GAME = 'bardstale3';
const PLATFORM = 'amiga';
const REAL_PICTURE_COUNT = 84;
const SUBFRAMES = 4;
const SUBFRAME_BYTES = (W * H) / 2; // 4928, chunky 4bpp
const COLS = 8; // in sub-frame cells

export async function exportBardsTale3Data(dataDir: string) {
  const allPic = readBinary(resolve(dataDir, 'all.pic'));
  const bard3 = readBinary(resolve(dataDir, 'bard3'));

  const cells: { picIndex: number; frame: number; rgba: Uint8Array }[] = [];
  let ok = 0;
  let paletteMisses = 0;
  for (let i = 0; i < REAL_PICTURE_COUNT; i++) {
    let picture;
    try {
      picture = loadBard3Picture(allPic, bard3, i);
    } catch (e) {
      console.log(`  pic ${i}: FAILED (${(e as Error).message})`);
      continue;
    }
    const rgb: number[] = [];
    for (const w of picture.paletteWords) rgb.push(...amiga12ToRGB(w));
    if (picture.paletteWords.every((w) => w === 0)) paletteMisses++;

    const usedPalette = rgb.length ? rgb : DEFAULT_PALETTE;
    for (let f = 0; f < SUBFRAMES; f++) {
      const sub = picture.subFrames.subarray(f * SUBFRAME_BYTES, (f + 1) * SUBFRAME_BYTES);
      const { indices } = decodePackedPixelLinear(sub, 0, W, H, 4);
      const rgba = indicesToRGBA(indices, usedPalette, { transparentIndex0: false });
      cells.push({ picIndex: i, frame: f, rgba });
    }
    ok++;
  }

  const rows = Math.ceil(cells.length / COLS);
  const atlasW = COLS * W;
  const atlasH = rows * H;
  const atlas = new Uint8Array(atlasW * atlasH * 4);
  const frames: { name: string; x: number; y: number; w: number; h: number }[] = [];
  cells.forEach((cell, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    blitRGBA(atlas, atlasW, cell.rgba, W, H, col * W, row * H);
    frames.push({ name: `pic${cell.picIndex}_frame${cell.frame}`, x: col * W, y: row * H, w: W, h: H });
  });

  const spriteDir = assetDir('sprites', GAME, PLATFORM);
  await writePNG(resolve(spriteDir, 'pics.png'), atlas, atlasW, atlasH);
  writeJson(resolve(spriteDir, 'pics.json'), { frames, width: atlasW, height: atlasH });

  writeManifest([manifestEntry('sprites/pics', cells.length, true)], GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(
    `  bardstale3/amiga: ${ok}/${REAL_PICTURE_COUNT} pictures decoded from all.pic (${cells.length} sub-frame cells, ${paletteMisses} with no resolved palette) -> sprites/pics.png (${atlasW}x${atlasH})`,
  );
}

/** Fallback greyscale ramp for the rare picture whose id-remap-table lookup misses (see module doc). */
const DEFAULT_PALETTE: number[] = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17, i * 17]).flat();

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale3/data');
  exportBardsTale3Data(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
