/**
 * Decode every MM2 Amiga `.32` image sheet and `.anm` animation in `<dataDir>`
 * to PNG + JSON under `public/assets/mm2/amiga/`.
 *
 * Usage: npx tsx tools/mm2/decode-graphics.ts <dataDir>
 *
 * `dataDir` is normally `data/mm2/amiga`. Each `.32` sheet becomes a shelf-packed
 * atlas in `textures/` (frames kept in file order); each `.anm` becomes a
 * horizontal strip of composed frames in `sprites/` plus a JSON with the TV
 * header, sequence blocks, and frame metadata. Palette index 0 renders
 * transparent (the game's blit key). Files that are `.32`-named but not image
 * chunks (`globe.32`, `disk.32` are XOR-obfuscated text blobs, not planar
 * pixel data) are reported and skipped here — `globe.32`'s string tables are
 * decoded separately by `tools/mm2/copy-protection.ts` via `export-data.ts`.
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { decodeImage32, paletteWordsToRGB, frameToRGBA, type Image32File } from './image32.ts';
import { parseAnm, composeAnmFrame, anmFrameCount, type AnmParsed } from './anm.ts';
import { shelfPack } from '../shared/atlas-pack.ts';
import { manifestEntry, writeManifest, syncDataManifest, type ManifestEntry } from '../shared/asset-paths.ts';

export interface GraphicsExportResult {
  game: 'mm2';
  platform: 'amiga';
  dataDir: string;
  sheets: string[];
  animations: string[];
  skipped: string[];
}

const NON_IMAGE_32 = new Set(['globe.32', 'disk.32']);

function writeSheet(dataDir: string, name: string, outDir: string): boolean {
  const file = resolve(dataDir, name);
  let img: Image32File;
  try {
    img = decodeImage32(readBinary(file));
  } catch {
    return false;
  }
  const palette = paletteWordsToRGB(img.paletteWords);
  const packed = shelfPack(
    img.frames.map((f, i) => ({ name: `${name}.frame${i}`, width: f.width, height: f.height })),
    1024,
  );
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const frames = [];
  for (const slot of packed.frames) {
    const idx = Number(slot.name.split('.frame')[1]);
    const frame = img.frames[idx];
    const rgba = frameToRGBA(frame, palette);
    for (let y = 0; y < frame.height; y++) {
      const srcOff = y * frame.width * 4;
      atlas.set(rgba.subarray(srcOff, srcOff + frame.width * 4), ((slot.y + y) * packed.width + slot.x) * 4);
    }
    frames.push({ name: slot.name, x: slot.x, y: slot.y, w: frame.width, h: frame.height, flags: frame.flags });
  }
  const base = name.replace(/\.32$/, '');
  writePNG(resolve(outDir, `${base}.png`), atlas, packed.width, packed.height);
  writeJson(resolve(outDir, `${base}.json`), {
    source: name,
    depthOrMode: img.depthOrMode,
    palette: img.paletteWords.map((w) => ({ word: w, rgb: paletteWordsToRGB([w])[0] })),
    frames,
    width: packed.width,
    height: packed.height,
  });
  return true;
}

function writeAnm(dataDir: string, name: string, outDir: string): boolean {
  const file = resolve(dataDir, name);
  let anm: AnmParsed;
  try {
    anm = parseAnm(readBinary(file));
  } catch {
    return false;
  }
  const palette = paletteWordsToRGB(anm.image.paletteWords);
  const count = anmFrameCount(anm);
  const baseW = anm.image.frames[0]?.width ?? 0;
  const baseH = anm.image.frames[0]?.height ?? 0;
  const strip = new Uint8Array(count * baseW * baseH * 4);
  const composed: { k: number; x: number; y: number; w: number; h: number }[] = [];
  for (let k = 0; k < count; k++) {
    const comp = composeAnmFrame(anm, k, baseW, baseH);
    const rgba = new Uint8Array(baseW * baseH * 4);
    for (let i = 0; i < comp.indices.length; i++) {
      const c = palette[comp.indices[i]] ?? { r: 0, g: 0, b: 0 };
      const o = i * 4;
      rgba[o] = c.r;
      rgba[o + 1] = c.g;
      rgba[o + 2] = c.b;
      rgba[o + 3] = comp.indices[i] === 0 ? 0 : 255;
    }
    for (let y = 0; y < baseH; y++) {
      const srcOff = y * baseW * 4;
      strip.set(rgba.subarray(srcOff, srcOff + baseW * 4), (y * count * baseW + k * baseW) * 4);
    }
    composed.push({ k, x: k * baseW, y: 0, w: baseW, h: baseH });
  }
  const base = name.replace(/\.anm$/, '');
  writePNG(resolve(outDir, `${base}.png`), strip, count * baseW, baseH);
  writeJson(resolve(outDir, `${base}.json`), {
    source: name,
    prelude: anm.tv.prelude,
    seqA: anm.tv.seqA,
    seqB: anm.tv.seqB,
    seqC: anm.tv.seqC,
    sequences: anm.sequences,
    imageChunkOffset: anm.imageChunkOffset,
    depthOrMode: anm.image.depthOrMode,
    palette: anm.image.paletteWords.map((w) => ({ word: w, rgb: paletteWordsToRGB([w])[0] })),
    storedFrames: anm.image.frames.map((f, i) => ({ index: i, width: f.width, height: f.height, flags: f.flags })),
    composedFrames: composed,
    frames: composed,
    width: count * baseW,
    height: baseH,
  });
  return true;
}

export function exportMm2Graphics(dataDir: string): GraphicsExportResult {
  const sheetsDir = resolve('public/assets/mm2/amiga/textures');
  const spritesDir = resolve('public/assets/mm2/amiga/sprites');
  mkdirSync(sheetsDir, { recursive: true });
  mkdirSync(spritesDir, { recursive: true });

  const sheets: string[] = [];
  const animations: string[] = [];
  const skipped: string[] = [];

  for (const name of readdirSync(dataDir).sort()) {
    if (name.endsWith('.32') && !NON_IMAGE_32.has(name)) {
      if (writeSheet(dataDir, name, sheetsDir)) sheets.push(name);
      else skipped.push(name);
    } else if (name.endsWith('.anm')) {
      if (writeAnm(dataDir, name, spritesDir)) animations.push(name);
      else skipped.push(name);
    }
  }

  const manifest: ManifestEntry[] = [
    ...sheets.map((n) => manifestEntry(`textures/${n.replace(/\.32$/, '')}`, 0)),
    ...animations.map((n) => manifestEntry(`sprites/${n.replace(/\.anm$/, '')}`, 0)),
  ];
  writeManifest(manifest, 'mm2', 'amiga');
  syncDataManifest('mm2', 'amiga');

  return { game: 'mm2', platform: 'amiga', dataDir, sheets, animations, skipped };
}

export function main(): void {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/mm2/decode-graphics.ts <dataDir>');
    process.exit(1);
  }
  if (!existsSync(dataDir)) {
    console.error(`Data dir not found: ${dataDir}`);
    console.error('Place your MM2 Amiga files (town.32, 1.anm, ...) there and re-run.');
    process.exit(1);
  }

  const result = exportMm2Graphics(dataDir);
  for (const s of result.sheets) console.log(`  .32 sheet: ${s}`);
  for (const a of result.animations) console.log(`  .anm animation: ${a}`);
  for (const s of result.skipped) console.log(`  skipped (not an image chunk): ${s}`);
  console.log(`${result.sheets.length} sheets, ${result.animations.length} animations, ${result.skipped.length} skipped`);
}

const isStandalone =
  process.argv[1]?.endsWith('decode-graphics.ts') ||
  process.argv[1]?.endsWith('decode-graphics');

if (isStandalone) main();
