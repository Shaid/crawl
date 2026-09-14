/**
 * Decodes Wizardry 6 (DOS/EGA) `.pic` cel-sprite files: credits.pic and
 * mon00.pic-mon58.pic (60 files).
 *
 * Format cracked via a `re-codebreaker` escalation this session (see
 * docs/wizardry6/dosega/data-structure.md section 5 and
 * docs/wizardry6/TODO.md): every file is compressed with a block-oriented
 * byte RLE (`dos-rle.ts`, 4096-byte blocks, no token crosses a block
 * boundary), and once decompressed the image is the *exact same* format
 * as the Amiga release's `.PIC` cels (`pic-format.ts`) with one narrower
 * field: the directory's per-slot offset is `u16` little-endian instead
 * of `u32` big-endian (24-byte slots instead of 26, 600-byte directory
 * instead of 650). Verified byte-exact against the Amiga corpus:
 * 712/712 `mon*.pic` cels, 3,414,272 pixels, 0 byte deviation in the tile
 * payload once each DOS offset is compared against its Amiga counterpart
 * minus 50 (= 25 slots x 2 bytes saved per slot).
 *
 * Usage: npx tsx tools/wizardry6/decode-dosega-pic.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodePicCel, celIndicesToRGBA, PIC_PALETTE } from './pic-format.ts';
import { readDosPic } from './pic-format-dos.ts';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const ATLAS_MAX_WIDTH = 1024;

interface FrameSource {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

function decodeFile(file: Uint8Array, baseName: string): FrameSource[] {
  const { data, cels } = readDosPic(file);
  return cels.map((cel) => {
    const indices = decodePicCel(data, cel);
    const rgba = celIndicesToRGBA(indices, cel.widthPx, cel.heightPx);
    return {
      name: `${baseName}_cel${String(cel.index).padStart(2, '0')}`,
      width: cel.widthPx,
      height: cel.heightPx,
      rgba,
    };
  });
}

interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Atlas {
  rgba: Uint8Array;
  width: number;
  height: number;
  frames: AtlasFrame[];
}

function buildAtlas(sources: FrameSource[]): Atlas {
  const packInputs: ShelfPackInput[] = sources.map((s) => ({ name: s.name, width: s.width, height: s.height }));
  const packed = shelfPack(packInputs, ATLAS_MAX_WIDTH);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const byName = new Map(sources.map((s) => [s.name, s]));
  const frames: AtlasFrame[] = [];
  for (const frame of packed.frames) {
    const src = byName.get(frame.name)!;
    for (let y = 0; y < src.height; y++) {
      const srcRowOff = y * src.width * 4;
      const dstRowOff = ((frame.y + y) * packed.width + frame.x) * 4;
      atlas.set(src.rgba.subarray(srcRowOff, srcRowOff + src.width * 4), dstRowOff);
    }
    frames.push({ name: frame.name, x: frame.x, y: frame.y, w: frame.w, h: frame.h });
  }
  return { rgba: atlas, width: packed.width, height: packed.height, frames };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-dosega-pic.ts <dataDir>');
    process.exit(1);
  }

  const spritesDir = resolve('public/assets/wizardry6/dosega/sprites');
  const palettesDir = resolve('public/assets/wizardry6/dosega/palettes');
  mkdirSync(spritesDir, { recursive: true });
  mkdirSync(palettesDir, { recursive: true });

  writeJson(resolve(palettesDir, 'pic.json'), { colors: PIC_PALETTE });

  const creditsData = readBinary(resolve(dataDir, 'credits.pic'));
  const creditsFrames = decodeFile(creditsData, 'credits');
  const creditsAtlas = buildAtlas(creditsFrames);
  writePNG(resolve(spritesDir, 'credits.png'), creditsAtlas.rgba, creditsAtlas.width, creditsAtlas.height);
  writeJson(resolve(spritesDir, 'credits.json'), {
    frames: creditsAtlas.frames,
    width: creditsAtlas.width,
    height: creditsAtlas.height,
  });

  const monFiles = readdirSync(dataDir)
    .filter((f) => /^mon\d+\.pic$/i.test(f))
    .sort();
  const monsterFrames: FrameSource[] = [];
  for (const fn of monFiles) {
    const data = readBinary(resolve(dataDir, fn));
    const baseName = fn.replace(/\.pic$/i, '').toLowerCase();
    monsterFrames.push(...decodeFile(data, baseName));
  }
  const monstersAtlas = buildAtlas(monsterFrames);
  writePNG(
    resolve(spritesDir, 'monsters.png'),
    monstersAtlas.rgba,
    monstersAtlas.width,
    monstersAtlas.height,
  );
  writeJson(resolve(spritesDir, 'monsters.json'), {
    frames: monstersAtlas.frames,
    width: monstersAtlas.width,
    height: monstersAtlas.height,
  });

  console.log(
    `Wrote credits.png/.json (${creditsFrames.length} cels) and monsters.png/.json (${monsterFrames.length} cels from ${monFiles.length} files)`,
  );
}

main();
