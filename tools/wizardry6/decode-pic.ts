/**
 * Decodes Wizardry 6 (Amiga) `.PIC` cel-sprite files: CREDITS.PIC and
 * mon00.pic-mon58.pic (60 files, 731 cels total).
 *
 * Format confirmed via a `re-codebreaker` disassembly of `Bane`'s cel
 * drawer (`CODE+0x35e6`), independently re-verified in this session
 * (731/731 byte-length checks, 3,504,128 decoded pixels with 0
 * out-of-range indices, palette cross-checked against real rendered pixel
 * colours) -- see docs/wizardry6/amiga/data-structure.md section 2 and
 * ./pic-format.ts.
 *
 * Every cel is extracted as its own independent sprite frame (each cel's
 * directory entry already contains a complete, self-sufficient tile set --
 * cels sharing a file+dimensions are draw-order animation frames or
 * layers of the same picture, per the confirmed cel-list compositing
 * logic, but which specific cel-list a given monster's stats reference is
 * not yet traced -- see the doc's "open" notes). Downstream code can
 * recombine frames by name once that mapping is known.
 *
 * Usage: npx tsx tools/wizardry6/decode-pic.ts <dataDir>
 */
import { resolve } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { readPicDirectory, decodePicCel, celIndicesToRGBA, PIC_PALETTE } from './pic-format.ts';
import { shelfPack, type PackInput } from '../shared/atlas-pack.ts';

const ATLAS_MAX_WIDTH = 1024;

interface FrameSource {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

function decodeFile(data: Uint8Array, baseName: string): FrameSource[] {
  const cels = readPicDirectory(data);
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
  const packInputs: PackInput[] = sources.map((s) => ({ name: s.name, width: s.width, height: s.height }));
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
    frames.push({ name: frame.name, x: frame.x, y: frame.y, w: frame.width, h: frame.height });
  }
  return { rgba: atlas, width: packed.width, height: packed.height, frames };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-pic.ts <dataDir>');
    process.exit(1);
  }

  const spritesDir = resolve('public/assets/wizardry6/amiga/sprites');
  const palettesDir = resolve('public/assets/wizardry6/amiga/palettes');
  mkdirSync(spritesDir, { recursive: true });
  mkdirSync(palettesDir, { recursive: true });

  writeJson(resolve(palettesDir, 'pic.json'), { colors: PIC_PALETTE });

  // CREDITS.PIC gets its own atlas (title/credits art, not a monster).
  const creditsData = readBinary(resolve(dataDir, 'CREDITS.PIC'));
  const creditsFrames = decodeFile(creditsData, 'credits');
  const creditsAtlas = buildAtlas(creditsFrames);
  writePNG(resolve(spritesDir, 'credits.png'), creditsAtlas.rgba, creditsAtlas.width, creditsAtlas.height);
  writeJson(resolve(spritesDir, 'credits.json'), {
    frames: creditsAtlas.frames,
    width: creditsAtlas.width,
    height: creditsAtlas.height,
  });

  // All mon*.pic cels go into one shared "monsters" atlas.
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
