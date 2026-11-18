/**
 * Bard's Tale II: The Destiny Knight (Amiga, WHDLoad dump).
 *
 * Usage: npx tsx tools/bardstale2/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/_unexplored_/BardsTale2/data/bards_data`.)
 *
 * Identity: confirmed as game 2 via `BardsTale2.slave`'s WHDLoad header text
 * — see docs/bardstale2/amiga/data-structure.md §0.
 *
 * Decodes `pics` — same `u32BE[N]`-directory convention as BT1, but each
 * record's Huffman-decoded payload is BT2-specific: a 4-plane bit transpose
 * ("Uncrypt1") followed by a per-plane running XOR delta ("Uncrypt2"),
 * converging on the same 112x88 4bpp-planar layout BT1 reaches via RLE.
 *
 * The directory has 64 slots (0-63); 3 of them (indices 25, 30, 52) are
 * "no picture" slots: a valid 1-byte Huffman record (`sizeDst=1`, single-leaf
 * tree decoding to 0x8C / 0x05; they are NOT byte-identical — 2026-11 audit
 * correction, see docs/bardstale-picture-format.md §5). 61 of the 64 slots
 * hold real pictures. Trailing animation data (sizeDst-32 > 4928 in 50/61
 * records) is dropped here — tracked as `bt2-animation`.
 *
 * Writes:
 *   public/assets/bardstale2/amiga/sprites/pics.png + .json (atlas + frames)
 */
import { resolve } from 'node:path';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { loadBard12Picture, BARDSTALE_PICTURE_WIDTH as W, BARDSTALE_PICTURE_HEIGHT as H } from '../../shared/bardstale-codecs.ts';
import { decodePlanar, indicesToRGBA, blitRGBA, amiga12ToRGB } from '../../shared/amiga-planar.ts';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';

const GAME = 'bardstale2';
const PLATFORM = 'amiga';
const DIRECTORY_SLOTS = 64;
/** Confirmed placeholder-record slots (sizeDst==1, no picture) — see module doc. */
const PLACEHOLDER_SLOTS = new Set([25, 30, 52]);
const COLS = 8;

export async function exportBardsTale2Data(dataDir: string) {
  const dump = readBinary(resolve(dataDir, 'pics'));

  const realCount = DIRECTORY_SLOTS - PLACEHOLDER_SLOTS.size;
  const rows = Math.ceil(realCount / COLS);
  const atlasW = COLS * W;
  const atlasH = rows * H;
  const atlas = new Uint8Array(atlasW * atlasH * 4);
  const frames: { name: string; x: number; y: number; w: number; h: number; paletteWords: number[] }[] = [];

  let ok = 0;
  for (let i = 0; i < DIRECTORY_SLOTS; i++) {
    if (PLACEHOLDER_SLOTS.has(i)) continue;
    let picture;
    try {
      picture = loadBard12Picture(dump, i, 2);
    } catch (e) {
      console.log(`  pic ${i}: FAILED (${(e as Error).message})`);
      continue;
    }
    const rgb: number[] = [];
    for (const w of picture.paletteWords) rgb.push(...amiga12ToRGB(w));
    const indices = decodePlanar(picture.basePicture, W, H, 4);
    const rgba = indicesToRGBA(indices, rgb, { transparentIndex0: false });

    const col = ok % COLS;
    const row = Math.floor(ok / COLS);
    blitRGBA(atlas, atlasW, rgba, W, H, col * W, row * H);
    frames.push({ name: `pic${i}`, x: col * W, y: row * H, w: W, h: H, paletteWords: picture.paletteWords });
    ok++;
  }

  const spriteDir = assetDir('sprites', GAME, PLATFORM);
  await writePNG(resolve(spriteDir, 'pics.png'), atlas, atlasW, atlasH);
  writeJson(resolve(spriteDir, 'pics.json'), { frames, width: atlasW, height: atlasH });

  writeManifest([manifestEntry('sprites/pics', ok, true)], GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`  bardstale2/amiga: ${ok}/${realCount} pictures decoded from pics (${PLACEHOLDER_SLOTS.size} placeholder slots skipped) -> sprites/pics.png (${atlasW}x${atlasH})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale2/data/bards_data');
  exportBardsTale2Data(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
