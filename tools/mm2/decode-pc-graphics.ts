/**
 * Decode every MM2 PC DOS `.4` (CGA) / `.16` (EGA) graphics file in `<dataDir>`
 * to PNG + JSON under `public/assets/mm2/dosega/`.
 *
 * Usage: npx tsx tools/mm2/decode-pc-graphics.ts <dataDir>
 *
 * `dataDir` is normally `data/mm2/dosega` (GOG release). Each wall/sprite
 * sheet (`THROW.16`, `CASTLE.16`, `SKY.4`, ...) becomes a shelf-packed atlas
 * in `textures/`; `MONSTERS.4` / `MONSTERS.16` become per-picture composed
 * combat frames in `sprites/monsters/`. JSON sidecars carry the parsed frame
 * table and (for monsters) the animation script sequences.
 */
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import {
  parseWallSheet,
  parseMonstersAtlas,
  renderWallFrameRGBA,
  compositeCombatFrame,
  type WallSheet,
  type MonsterAtlas,
  type MonsterFrame,
} from './pc-gfx.ts';
import { shelfPack } from '../shared/atlas-pack.ts';
import { manifestEntry, writeManifest, type ManifestEntry } from '../shared/asset-paths.ts';

export interface PcGraphicsExportResult {
  game: 'mm2';
  platform: 'dosega';
  dataDir: string;
  sheets: string[];
  monsters: string[];
  skipped: string[];
}

function writeWallSheet(dataDir: string, name: string, outDir: string): boolean {
  const file = resolve(dataDir, name);
  let sheet: WallSheet;
  try {
    sheet = parseWallSheet(name, readBinary(file));
  } catch {
    return false;
  }
  const frames = sheet.frames.map((f, i) => ({
    name: `${name}.frame${i}`, width: f.width, height: f.height,
  }));
  const packed = shelfPack(frames, 1024);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const frameMeta: unknown[] = [];
  for (const slot of packed.frames) {
    const idx = Number(slot.name.split('.frame')[1]);
    const fr = sheet.frames[idx];
    const rgba = renderWallFrameRGBA(fr.width, fr.height, fr.pixels, sheet.bpp, { frame: idx, outdoor: isOutdoorSheet(name) }).rgba;
    for (let y = 0; y < fr.height; y++) {
      const srcOff = y * fr.width * 4;
      atlas.set(rgba.subarray(srcOff, srcOff + fr.width * 4), ((slot.y + y) * packed.width + slot.x) * 4);
    }
    frameMeta.push({ name: slot.name, x: slot.x, y: slot.y, w: fr.width, h: fr.height, offset: fr.offset });
  }
  const base = name.toLowerCase().replace(/\./, ''); // e.g. 'throw4' / 'throw16'
  writePNG(resolve(outDir, `${base}.png`), atlas, packed.width, packed.height);
  writeJson(resolve(outDir, `${base}.json`), {
    source: name,
    bpp: sheet.bpp,
    uncompressedSize: sheet.uncompressedSize,
    tableSlotCount: sheet.tableSlotCount,
    offsetKind: sheet.offsetKind,
    groupedU16: sheet.groupedU16,
    frames: frameMeta,
    width: packed.width,
    height: packed.height,
  });
  return true;
}

/**
 * Outdoor biome sheets key transparent index 0 on front panels. Must match
 * the Amiga outdoor-sheet set (`docs/mm2/amiga/data-structure.md`) — DESERT/
 * OCEAN/OUTDOOR1-3/SWAMP/TUNDRA are the only outdoor biomes actually shipped
 * (GRASS/HIGHGRASS/LAVA/SNOW correspond to no file on either platform and
 * were a copy-paste from an unrelated game's biome list; OCEAN was missing).
 */
export function isOutdoorSheet(name: string): boolean {
  const base = name.replace(/\.(4|16)$/i, '').toUpperCase();
  return ['DESERT', 'OCEAN', 'SWAMP', 'TUNDRA', 'OUTDOOR1', 'OUTDOOR2', 'OUTDOOR3'].includes(base);
}

function writeMonsters(dataDir: string, name: string, outDir: string, outEntries: ManifestEntry[]): boolean {
  const file = resolve(dataDir, name);
  let atlas: MonsterAtlas;
  try {
    atlas = parseMonstersAtlas(name, readBinary(file));
  } catch {
    return false;
  }
  const dir = resolve(outDir, 'monsters');
  mkdirSync(dir, { recursive: true });
  const base = name.toLowerCase().replace(/\./, ''); // e.g. 'monsters16' / 'monsters4'
  const summary: unknown[] = [];
  const pictureIds = [...atlas.pictures.keys()].sort((a, b) => a - b);
  for (const picId of pictureIds) {
    const pic = atlas.pictures.get(picId)!;
    const frames: MonsterFrame[] = pic.frames;
    // compose every script-referenced frame index (plus base) as a horizontal strip
    const indices: number[] = [];
    for (const s of pic.scripts) {
      for (let k = 0; k + 1 < s.length; k += 2) {
        const idx = s[k];
        if (!indices.includes(idx)) indices.push(idx);
      }
    }
    if (!indices.includes(0)) indices.unshift(0);
    const framesRGBA: { idx: number; rgba: Uint8Array }[] = [];
    for (const idx of indices) {
      const rgba = compositeCombatFrame(frames, idx, 1);
      framesRGBA.push({ idx, rgba });
    }
    const w = 96;
    const h = 96;
    const strip = new Uint8Array(framesRGBA.length * w * h * 4);
    for (let k = 0; k < framesRGBA.length; k++) {
      for (let y = 0; y < h; y++) {
        strip.set(framesRGBA[k].rgba.subarray(y * w * 4, (y + 1) * w * 4), (y * framesRGBA.length + k) * w * 4);
      }
    }
    const fname = `${base}_pic${String(picId).padStart(2, '0')}`;
    writePNG(resolve(dir, `${fname}.png`), strip, framesRGBA.length * w, h);
    const atlasFrames = framesRGBA.map((fr, k) => ({
      name: `pic${String(picId).padStart(2, '0')}.step${fr.idx}`,
      x: k * w, y: 0, w, h,
    }));
    writeJson(resolve(dir, `${fname}.json`), {
      pictureId: picId,
      blobOffset: pic.blobOffset,
      frameCount: pic.frameCount,
      flags: pic.flags,
      scripts: pic.scripts,
      frameRecords: frames.map((f) => ({ index: f.frameIndex, x: f.x, y: f.y, w: f.width, h: f.height, frameOffset: f.frameOffset })),
      composedIndices: indices,
      atlasFrames,
      frames: atlasFrames,
      width: framesRGBA.length * w,
      height: h,
    });
    summary.push({ pictureId: picId, frameCount: pic.frameCount, frames: frames.length, scripts: pic.scripts.length });
    outEntries.push({
      name: `sprites/monsters/${fname}`,
      sprites: atlasFrames.length,
      hasPalette: false,
      png: `sprites/monsters/${fname}.png`,
    });
  }
  writeJson(resolve(outDir, `${base}.json`), {
    source: name,
    bpp: atlas.bpp,
    blobOffsets: atlas.offsets,
    pictures: summary,
  });
  return true;
}

export function exportMm2PcGraphics(dataDir: string): PcGraphicsExportResult {
  const texturesDir = resolve('public/assets/mm2/dosega/textures');
  const spritesDir = resolve('public/assets/mm2/dosega/sprites');
  mkdirSync(texturesDir, { recursive: true });
  mkdirSync(spritesDir, { recursive: true });

  const sheets: string[] = [];
  const monsters: string[] = [];
  const skipped: string[] = [];
  const pictureEntries: ManifestEntry[] = [];

  for (const name of readdirSync(dataDir).sort()) {
    const lower = name.toLowerCase();
    if (lower.startsWith('monsters.') && (lower.endsWith('.4') || lower.endsWith('.16'))) {
      const entries: ManifestEntry[] = [];
      if (writeMonsters(dataDir, name, spritesDir, entries)) {
        monsters.push(name);
        pictureEntries.push(...entries);
      } else skipped.push(name);
    } else if (lower.endsWith('.4') || lower.endsWith('.16')) {
      if (writeWallSheet(dataDir, name, texturesDir)) sheets.push(name);
      else skipped.push(name);
    }
  }

  const manifest: ManifestEntry[] = [
    ...sheets.map((n) => manifestEntry(`textures/${n.toLowerCase().replace(/\./, '')}`, 0)),
    ...pictureEntries,
  ];
  writeManifest(manifest, 'mm2', 'dosega');

  return { game: 'mm2', platform: 'dosega', dataDir, sheets, monsters, skipped };
}

export function main(): void {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/mm2/decode-pc-graphics.ts <dataDir>');
    process.exit(1);
  }
  if (!existsSync(dataDir)) {
    console.error(`Data dir not found: ${dataDir}`);
    console.error('Place your MM2 GOG DOS files (MONSTERS.16, THROW.16, ...) there and re-run.');
    process.exit(1);
  }

  const result = exportMm2PcGraphics(dataDir);
  for (const s of result.sheets) console.log(`  sheet: ${s}`);
  for (const m of result.monsters) console.log(`  monster atlas: ${m}`);
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
  console.log(`${result.sheets.length} sheets, ${result.monsters.length} monster atlases, ${result.skipped.length} skipped`);
}

const isStandalone =
  process.argv[1]?.endsWith('decode-pc-graphics.ts') ||
  process.argv[1]?.endsWith('decode-pc-graphics');

if (isStandalone) main();
