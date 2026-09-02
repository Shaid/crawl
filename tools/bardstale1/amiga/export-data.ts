/**
 * Bard's Tale I: Tales of the Unknown — The Bard's Tale (Amiga, WHDLoad dump).
 *
 * Usage: npx tsx tools/bardstale1/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/_unexplored_/BardsTaleNTSC/data/bards_data`.)
 *
 * Identity: confirmed as game 1 via `BardsTaleNTSC.slave`'s WHDLoad header
 * text ("Bard's Tale I" / "Tales of the Unknown") — see
 * docs/bardstale1/amiga/data-structure.md §0.
 *
 * Decodes `pics` — the "animated picture" (view-window portrait/monster art)
 * resource: a `u32BE[N]` directory (`offset = dump[pictureIndex*4]`, no
 * explicit count field) of per-picture records
 * `[u32 sizeDst][u32 unk][serialized Huffman tree][huffman-coded: 32B
 * palette + (sizeDst-32)B RLE-packed 112x88 4bpp-planar picture]`.
 *
 * Codec: `tools/shared/bardstale-codecs.ts`, ported line-for-line from
 * Kroah's "Bard's Tale Picture Viewer" C# source (byte-exact ground-truth
 * oracle — that tool's bundled `Files/` dir is cmp-identical to this
 * project's own `pics`/`all.pic`/`bard3` corpus files). See that module's
 * doc for the full codec derivation and docs/bardstale1/amiga/data-structure.md
 * for the byte-level spec.
 *
 * Real picture count: empirically probed (sequential decode until failure,
 * see docs/bardstale1/TODO.md) at exactly 55 (indices 0-54), all decoding
 * cleanly with no placeholder/sentinel records (unlike BT2's `pics`, which
 * has 3 confirmed placeholder slots).
 *
 * Writes:
 *   public/assets/bardstale1/amiga/sprites/pics.png + .json (atlas + frames)
 *   public/assets/bardstale1/amiga/sprites/pics.pal.json (per-picture palettes are NOT
 *     merged — each picture has its own 16-colour palette; see .json sidecar
 *     `frames[i].paletteWords`)
 */
import { resolve } from 'node:path';
import { readBinary, writePNG } from '@seer-project/pipeline';
import { loadBard12Picture, BARDSTALE_PICTURE_WIDTH as W, BARDSTALE_PICTURE_HEIGHT as H } from '../../shared/bardstale-codecs.ts';
import { decodePlanar, indicesToRGBA, blitRGBA, amiga12ToRGB } from '../../shared/amiga-planar.ts';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex } from '../../shared/asset-paths.ts';

const GAME = 'bardstale1';
const PLATFORM = 'amiga';
const REAL_PICTURE_COUNT = 55;
const COLS = 8;

export async function exportBardsTale1Data(dataDir: string) {
  const dump = readBinary(resolve(dataDir, 'pics'));

  const rows = Math.ceil(REAL_PICTURE_COUNT / COLS);
  const atlasW = COLS * W;
  const atlasH = rows * H;
  const atlas = new Uint8Array(atlasW * atlasH * 4);
  const frames: { name: string; x: number; y: number; w: number; h: number; paletteWords: number[] }[] = [];

  let ok = 0;
  for (let i = 0; i < REAL_PICTURE_COUNT; i++) {
    let picture;
    try {
      picture = loadBard12Picture(dump, i, 1);
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
  console.log(`  bardstale1/amiga: ${ok}/${REAL_PICTURE_COUNT} pictures decoded from pics -> sprites/pics.png (${atlasW}x${atlasH})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/_unexplored_/BardsTaleNTSC/data/bards_data');
  exportBardsTale1Data(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
