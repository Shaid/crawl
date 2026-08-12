/**
 * Extracts the SNES ROM's opening/title sequence graphics and the dialogue
 * font tile bank (see docs/wizardry6/snes/data-structure.md section 3.8/4.3).
 *
 * **This session added the two previously-unextracted opening resources**
 * (`snes-opening-screens-4-5` in docs/wizardry6/TODO.md), independently
 * re-derived from scratch (fresh Python probe, not any escalation script):
 *
 * - **Panorama** (files 0x023b2a chr + 0x0272ff tilemap): the tilemap
 *   decompresses to exactly `240*15*2 = 7200` bytes (byte-exact match to the
 *   claimed 240x15 grid) and the chr to exactly `659*32 = 21088` bytes.
 *   Composing it **column-major** (`col = idx/15, row = idx%15`, matching
 *   the doc's autocorrelation-derived claim) produces an unambiguous,
 *   legible scrolling scene: a night sky with a crescent moon, a row of
 *   dead/bare trees with root silhouettes, still-water reflections, and a
 *   distant tower/ruin silhouette at the far right -- a decisive render
 *   oracle, not just "coherent, not noise". Row-major composition (tried
 *   for comparison) is unambiguous garbage. **Confirmed.**
 * - **Mode 7 sequence** (file 0x02112c): decompresses to 16216 bytes total.
 *   The first 24 bytes are not part of the tile data (byte pattern:
 *   11 zero bytes then an ascending `01 02 03 ... 0b` ramp -- role not
 *   determined, possibly a small per-effect parameter block); the
 *   remaining 16192 bytes are exactly 253 whole 8bpp **linear** (not
 *   bitplane -- Mode 7's BG1 is always 8bpp linear, 1 byte/pixel, 64
 *   bytes/tile) tiles. No stored tilemap was found alongside it (Mode 7
 *   scenes are commonly built from a runtime-computed or much smaller
 *   map than the usual 128x128 BG grid) so this extractor renders the raw
 *   CHR as a flat contact-sheet texture atlas, not a composed picture.
 *   The render shows repeating blocky/stippled texture consistent with a
 *   rotating ground/floor effect, plus one small distinct icon-like
 *   fragment -- structurally coherent, not noise, but not independently
 *   legible the way the panorama is. **Rendered**, not confirmed.
 * - **Ending screen** (file 0x060000, BG2 layer only, slices at decompressed
 *   offset 0x0aa0/0x11a0 per the DMA descriptor chain documented in
 *   docs section 3.13): composes to unmistakably legible **"To Be
 *   Continued..."** text on a starfield -- a decisive render oracle.
 *   **Confirmed.** BG1 (the 8bpp starfield backdrop proper) is not
 *   composed here -- its tilemap is constant-filled at load and written
 *   dynamically at runtime, so there's no static ROM tilemap for it.
 *
 * Found via a `re-codebreaker` escalation, independently re-verified this
 * session (LZSS decoder re-implemented from scratch from the escalation's
 * cited algorithm -- not copy-pasted -- and run against the ROM directly;
 * see `verify-escalation-artifacts-not-just-claims.md`).
 *
 * All compressed resources use the LZSS codec at ROM `$83:8000`, see
 * `tools/shared/snes-lzss.ts`. Each resource is `[tilemap][chr tiles]`, a
 * standard SNES BG-mode screen layout: a `32x28`-entry (896-word) tilemap
 * (2 bytes/entry, `vhopppcc cccccccc`: tile number in the low 10 bits) is
 * followed immediately by the tile graphics it references.
 *
 * **Verified this session (independent renders, not just byte-count
 * matches)**:
 * - **Logo** (file 0x020000, 3648 B unpacked = 1792 B tilemap + 1856 B / 58
 *   tiles of 4bpp chr): composed render is the unmistakable, fully legible
 *   **"ASCII" wordmark** (ASCII Corporation, the Japanese publisher) --
 *   confirmed.
 * - **Copyright screen** (file 0x06a136, 7920 B = 1792 B tilemap + 6128 B /
 *   383 tiles of **2bpp** chr): composed render is fully legible English
 *   copyright text ("Bane of the Cosmic Forge, Copyright (c) 1995 David W.
 *   Bradley and Sir-tech Software, Inc. ... Japanese Translation by Game
 *   Studio, Inc. and ASCII Corporation.") -- confirmed.
 * - **Dialogue font** (file 0x04c653, 4096 B, **uncompressed**, 256 tiles
 *   2bpp): rendered as a full, legible glyph set -- digits, A-Z, hiragana,
 *   katakana, and UI symbols (arrows/boxes) -- confirmed. This closes the
 *   previously-open `snes-font-tile-bank` item.
 *
 * **Rendered, not fully verified (structurally coherent, not noise, but no
 * legible-text-level oracle)**:
 * - **Title backdrop** (file 0x0693c6, 8416 B = 4096 B / 64x32-entry
 *   tilemap + 4320 B / 135 tiles of 4bpp chr): renders as a coherent
 *   horizon/cloud/mountain-silhouette scene across the double-wide (64-tile)
 *   tilemap -- plausible "night sky title backdrop", not random noise, but
 *   not independently confirmed the way text screens are.
 * - **Lightning overlay** (file 0x06aecd, 7904 B, same 64x32 tilemap
 *   layout, 3808 B / 119 tiles of 4bpp chr): sparse (~22% of tilemap cells
 *   populated), renders as jagged bolt-shaped fragments -- plausible overlay
 *   effect layered on the backdrop, not independently confirmed.
 *
 * **Not yet extracted** (located by the escalation but not implemented
 * here, left for a future session -- see the TODO row `snes-opening-
 * screens-4-5`): a Mode 7 sequence (file 0x02112c, BGMODE=$07, 253 8bpp
 * tiles) and a scrolling stone-vault panorama (files 0x023b2a + 0x0272ff,
 * 659 tiles, 240x15 column-major tilemap) -- both need composition logic
 * this extractor doesn't implement yet.
 *
 * **Palette -- not confirmed for any of these** (a boot-time full-CGRAM
 * snapshot was tried against a sample and gave a plausible but unverified
 * result). All rendered in greyscale, per project convention.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-opening-sequence.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { decodeTile2bpp, decodeTile4bpp, TILE_SIZE_PX } from '../../shared/snes-ppu';
import { decodeLzss } from '../../shared/snes-lzss';

interface ScreenSpec {
  name: string;
  fileOffset: number;
  compressed: boolean;
  bpp: 2 | 4;
  tilemapWidth: number; // tiles
  tilemapHeight: number; // tiles
  confidence: 'confirmed' | 'rendered';
}

const SCREENS: ScreenSpec[] = [
  { name: 'logo', fileOffset: 0x020000, compressed: true, bpp: 4, tilemapWidth: 32, tilemapHeight: 28, confidence: 'confirmed' },
  { name: 'copyright', fileOffset: 0x06a136, compressed: true, bpp: 2, tilemapWidth: 32, tilemapHeight: 28, confidence: 'confirmed' },
  { name: 'title-backdrop', fileOffset: 0x0693c6, compressed: true, bpp: 4, tilemapWidth: 64, tilemapHeight: 32, confidence: 'rendered' },
  { name: 'title-lightning', fileOffset: 0x06aecd, compressed: true, bpp: 4, tilemapWidth: 64, tilemapHeight: 32, confidence: 'rendered' },
];

const FONT_OFFSET = 0x04c653;
const FONT_TILE_COUNT = 256;
const FONT_BPP = 2;

function decodeTile(data: Uint8Array, off: number, bpp: 2 | 4): Uint8Array {
  return bpp === 4 ? decodeTile4bpp(data, off) : decodeTile2bpp(data, off);
}

function composeScreen(spec: ScreenSpec, rom: Uint8Array): { rgba: Uint8Array; width: number; height: number; tileCount: number } {
  const tileBytes = spec.bpp === 4 ? 32 : 16;
  const full = spec.compressed ? decodeLzss(rom, spec.fileOffset).data : rom.slice(spec.fileOffset);
  const tilemapBytes = spec.tilemapWidth * spec.tilemapHeight * 2;
  const tilemap = full.slice(0, tilemapBytes);
  const chr = full.slice(tilemapBytes);
  const tileCount = Math.floor(chr.length / tileBytes);

  const width = spec.tilemapWidth * TILE_SIZE_PX;
  const height = spec.tilemapHeight * TILE_SIZE_PX;
  const rgba = new Uint8Array(width * height * 4);

  for (let idx = 0; idx < spec.tilemapWidth * spec.tilemapHeight; idx++) {
    const word = tilemap[idx * 2] | (tilemap[idx * 2 + 1] << 8);
    const tileNum = word & 0x3ff;
    if (tileNum === 0 || tileNum >= tileCount) continue; // 0 = blank cell, convention shared with the confirmed tile banks
    const tx = idx % spec.tilemapWidth;
    const ty = Math.floor(idx / spec.tilemapWidth);
    const tile = decodeTile(chr, tileNum * tileBytes, spec.bpp);
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const paletteIdx = tile[row * TILE_SIZE_PX + col];
        const grey = paletteIdx * 17;
        const px = ((ty * TILE_SIZE_PX + row) * width + (tx * TILE_SIZE_PX + col)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = paletteIdx === 0 ? 0 : 255;
      }
    }
  }

  return { rgba, width, height, tileCount };
}

// --- Panorama (column-major tilemap, see header comment) ---
const PANORAMA_CHR_OFFSET = 0x023b2a;
const PANORAMA_TILEMAP_OFFSET = 0x0272ff;
const PANORAMA_COLS = 240;
const PANORAMA_ROWS = 15;

function composePanorama(rom: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  const chr = decodeLzss(rom, PANORAMA_CHR_OFFSET).data;
  const tilemap = decodeLzss(rom, PANORAMA_TILEMAP_OFFSET).data;
  const tileCount = Math.floor(chr.length / 32);
  const width = PANORAMA_COLS * TILE_SIZE_PX;
  const height = PANORAMA_ROWS * TILE_SIZE_PX;
  const rgba = new Uint8Array(width * height * 4);

  for (let idx = 0; idx < PANORAMA_COLS * PANORAMA_ROWS; idx++) {
    const col = Math.floor(idx / PANORAMA_ROWS); // column-major, confirmed by render (see header comment)
    const row = idx % PANORAMA_ROWS;
    const word = tilemap[idx * 2] | (tilemap[idx * 2 + 1] << 8);
    const tileNum = word & 0x3ff;
    if (tileNum === 0 || tileNum >= tileCount) continue;
    const tile = decodeTile4bpp(chr, tileNum * 32);
    const tx = col * TILE_SIZE_PX;
    const ty = row * TILE_SIZE_PX;
    for (let r = 0; r < TILE_SIZE_PX; r++) {
      for (let c = 0; c < TILE_SIZE_PX; c++) {
        const paletteIdx = tile[r * TILE_SIZE_PX + c];
        const grey = paletteIdx * 17;
        const px = ((ty + r) * width + (tx + c)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = paletteIdx === 0 ? 0 : 255;
      }
    }
  }
  return { rgba, width, height };
}

// --- Mode 7 sequence (flat 8bpp-linear texture atlas, see header comment) ---
const MODE7_OFFSET = 0x02112c;
const MODE7_HEADER_BYTES = 24; // leading non-tile bytes, role undetermined -- see header comment
const MODE7_TILE_BYTES = 64; // 8bpp linear, 1 byte/pixel
const MODE7_COLS = 16;

function composeMode7(rom: Uint8Array): { rgba: Uint8Array; width: number; height: number; tileCount: number } {
  const full = decodeLzss(rom, MODE7_OFFSET).data;
  const chr = full.slice(MODE7_HEADER_BYTES);
  const tileCount = Math.floor(chr.length / MODE7_TILE_BYTES);
  const rows = Math.ceil(tileCount / MODE7_COLS);
  const width = MODE7_COLS * TILE_SIZE_PX;
  const height = rows * TILE_SIZE_PX;
  const rgba = new Uint8Array(width * height * 4);
  for (let t = 0; t < tileCount; t++) {
    const off = t * MODE7_TILE_BYTES;
    const tx = (t % MODE7_COLS) * TILE_SIZE_PX;
    const ty = Math.floor(t / MODE7_COLS) * TILE_SIZE_PX;
    for (let r = 0; r < TILE_SIZE_PX; r++) {
      for (let c = 0; c < TILE_SIZE_PX; c++) {
        const v = chr[off + r * TILE_SIZE_PX + c] ?? 0;
        const grey = (v & 0x0f) * 17; // low nibble only, greyscale render -- palette unconfirmed
        const px = ((ty + r) * width + (tx + c)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = v === 0 ? 0 : 255;
      }
    }
  }
  return { rgba, width, height, tileCount };
}

// --- Ending screen ("To Be Continued...", see docs section 3.13) ---
// LZSS resource 0x060000 decompresses to a full [BG1 8bpp][misc][BG2 tilemap+chr]
// blob whose pieces are DMA'd to VRAM at specific byte-slice offsets (found by
// reading the screen-setup routine's DMA descriptor chain, section 3.13). Only
// the BG2 slice (tilemap + chr) is composed here -- BG2 alone is what carries the
// legible "To Be Continued..." text; BG1 is 461 8bpp tiles, a starfield/backdrop
// layer whose tilemap is constant-filled at load and written dynamically at
// runtime (no static tilemap to compose from ROM, per the doc).
const ENDING_OFFSET = 0x060000;
const ENDING_BG2_TILEMAP_OFFSET = 0x0aa0; // offset within the decompressed blob
const ENDING_BG2_TILEMAP_BYTES = 0x700; // 32x28 entries x 2 bytes
const ENDING_BG2_CHR_OFFSET = 0x11a0;
const ENDING_BG2_CHR_BYTES = 0x600; // 48 tiles x 32 bytes (4bpp)
const ENDING_COLS = 32;
const ENDING_ROWS = 28;

function composeEndingScreen(rom: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  const full = decodeLzss(rom, ENDING_OFFSET).data;
  const tilemap = full.slice(ENDING_BG2_TILEMAP_OFFSET, ENDING_BG2_TILEMAP_OFFSET + ENDING_BG2_TILEMAP_BYTES);
  const chr = full.slice(ENDING_BG2_CHR_OFFSET, ENDING_BG2_CHR_OFFSET + ENDING_BG2_CHR_BYTES);
  const tileCount = Math.floor(chr.length / 32);
  const width = ENDING_COLS * TILE_SIZE_PX;
  const height = ENDING_ROWS * TILE_SIZE_PX;
  const rgba = new Uint8Array(width * height * 4);
  for (let idx = 0; idx < ENDING_COLS * ENDING_ROWS; idx++) {
    const word = tilemap[idx * 2] | (tilemap[idx * 2 + 1] << 8);
    const tileNum = word & 0x3ff;
    if (tileNum === 0 || tileNum >= tileCount) continue;
    const tile = decodeTile4bpp(chr, tileNum * 32);
    const tx = (idx % ENDING_COLS) * TILE_SIZE_PX;
    const ty = Math.floor(idx / ENDING_COLS) * TILE_SIZE_PX;
    for (let r = 0; r < TILE_SIZE_PX; r++) {
      for (let c = 0; c < TILE_SIZE_PX; c++) {
        const paletteIdx = tile[r * TILE_SIZE_PX + c];
        const grey = paletteIdx * 17;
        const px = ((ty + r) * width + (tx + c)) * 4;
        rgba[px] = grey;
        rgba[px + 1] = grey;
        rgba[px + 2] = grey;
        rgba[px + 3] = paletteIdx === 0 ? 0 : 255;
      }
    }
  }
  return { rgba, width, height };
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-opening-sequence.ts <path-to-sfc>');
    process.exit(1);
  }
  const rom = readBinary(romPath);

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'screens'), { recursive: true });
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  let manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];

  for (const spec of SCREENS) {
    const { rgba, width, height, tileCount } = composeScreen(spec, rom);
    const pngPath = resolve(outDir, `screens/${spec.name}.png`);
    writePNG(pngPath, rgba, width, height);
    console.log(`Wrote screens/${spec.name}.png (${width}x${height}px, ${tileCount} tiles, ${spec.confidence})`);

    manifest = manifest.filter((e) => e.name !== `opening-${spec.name}`);
    manifest.push({
      name: `opening-${spec.name}`,
      group: 'screens',
      png: `screens/${spec.name}.png`,
      atlas: null,
      palette: null, // greyscale, unconfirmed real colour
      sprites: 1,
    });
  }

  // Panorama -- confirmed by render (column-major composition, see header comment).
  {
    const { rgba, width, height } = composePanorama(rom);
    writePNG(resolve(outDir, 'screens/panorama.png'), rgba, width, height);
    manifest = manifest.filter((e) => e.name !== 'opening-panorama');
    manifest.push({ name: 'opening-panorama', group: 'screens', png: 'screens/panorama.png', atlas: null, palette: null, sprites: 1 });
    console.log(`Wrote screens/panorama.png (${width}x${height}px, column-major 240x15 tilemap, confirmed)`);
  }

  // Mode 7 sequence -- rendered (flat 8bpp-linear texture atlas, no tilemap found, see header comment).
  {
    const { rgba, width, height, tileCount } = composeMode7(rom);
    writePNG(resolve(outDir, 'screens/mode7-texture.png'), rgba, width, height);
    manifest = manifest.filter((e) => e.name !== 'opening-mode7-texture');
    manifest.push({ name: 'opening-mode7-texture', group: 'screens', png: 'screens/mode7-texture.png', atlas: null, palette: null, sprites: 1 });
    console.log(`Wrote screens/mode7-texture.png (${width}x${height}px, ${tileCount} 8bpp tiles, rendered -- not composed via a tilemap)`);
  }

  // Ending screen -- confirmed by render (legible "To Be Continued..." text on BG2).
  {
    const { rgba, width, height } = composeEndingScreen(rom);
    writePNG(resolve(outDir, 'screens/ending.png'), rgba, width, height);
    manifest = manifest.filter((e) => e.name !== 'opening-ending');
    manifest.push({ name: 'opening-ending', group: 'screens', png: 'screens/ending.png', atlas: null, palette: null, sprites: 1 });
    console.log(`Wrote screens/ending.png (${width}x${height}px, BG2 layer only, confirmed -- legible "To Be Continued..." text)`);
  }

  // Dialogue font: flat, uncompressed 2bpp tile bank, individually addressable glyphs.
  const fontTileBytes = FONT_BPP === 2 ? 16 : 32;
  const fontCols = 16;
  const fontRows = Math.ceil(FONT_TILE_COUNT / fontCols);
  const fontWidth = fontCols * TILE_SIZE_PX;
  const fontHeight = fontRows * TILE_SIZE_PX;
  const fontRgba = new Uint8Array(fontWidth * fontHeight * 4);
  for (let t = 0; t < FONT_TILE_COUNT; t++) {
    const tile = decodeTile(rom, FONT_OFFSET + t * fontTileBytes, FONT_BPP);
    const tx = (t % fontCols) * TILE_SIZE_PX;
    const ty = Math.floor(t / fontCols) * TILE_SIZE_PX;
    for (let row = 0; row < TILE_SIZE_PX; row++) {
      for (let col = 0; col < TILE_SIZE_PX; col++) {
        const idx = tile[row * TILE_SIZE_PX + col];
        const grey = idx * 85; // 2bpp -- 4 levels
        const px = ((ty + row) * fontWidth + (tx + col)) * 4;
        fontRgba[px] = grey;
        fontRgba[px + 1] = grey;
        fontRgba[px + 2] = grey;
        fontRgba[px + 3] = idx === 0 ? 0 : 255;
      }
    }
  }
  writePNG(resolve(outDir, 'sprites/font.png'), fontRgba, fontWidth, fontHeight);
  writeJson(resolve(outDir, 'sprites/font.json'), {
    width: fontWidth,
    height: fontHeight,
    tileSize: TILE_SIZE_PX,
    tileCount: FONT_TILE_COUNT,
    cols: fontCols,
    bpp: FONT_BPP,
    fileOffset: FONT_OFFSET,
    note:
      'Uncompressed 2bpp glyph bank, 256 tiles (16x16 grid, tile index = row*16+col). ' +
      'Confirmed legible: digits, A-Z, hiragana, katakana, UI symbols. Glyph-to-character-code mapping not decoded ' +
      '(this extractor exposes the raw tile bank only). See docs/wizardry6/snes/data-structure.md section 4.3.',
  });
  manifest = manifest.filter((e) => e.name !== 'font');
  manifest.push({
    name: 'font',
    group: 'sprites',
    png: 'sprites/font.png',
    atlas: 'sprites/font.json',
    palette: null,
    sprites: FONT_TILE_COUNT,
  });
  console.log(`Wrote sprites/font.png (${fontWidth}x${fontHeight}px, ${FONT_TILE_COUNT} glyphs, confirmed)`);

  writeJson(manifestPath, manifest);
  console.log('Updated manifest.json');
}

main();
