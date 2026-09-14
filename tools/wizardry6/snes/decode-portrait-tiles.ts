/**
 * Extracts the SNES ROM's monster/NPC face-portrait tile bank -- this
 * project's first confirmed SNES pixel-graphics decode (see
 * docs/wizardry6/snes/data-structure.md section 3).
 *
 * Format: a 2-byte-per-entry pointer table at file offset 0x105D1 (bank 2,
 * CPU $82:85D1 / mirror $02:85D1 -- reached from a resource-loader function
 * at file 0x10279 that sets Data Bank = $82 before indexing this table).
 * Each entry is a 16-bit CPU address within ROM bank $85 (mirror of bank
 * $05); converting to a file offset via `0x28000 + (word - 0x8000)` yields,
 * for table indices 0-29, thirty pointers that -- once *sorted* by target
 * address -- turn out to be **exactly 288 bytes (0x120) apart with zero
 * deviation across all 29 gaps**: a byte-exact structural invariant
 * confirming a uniform array of 30 fixed-size records, contiguous in ROM
 * from file 0x28b97 to 0x2ad57 (right after an item-name ASCII string
 * table, and followed by unrelated non-tile data -- both clean boundaries).
 * Six more entries (indices 30-35) point at a second, separately-located
 * run of six more 288-byte records at file 0x2e000-0x2e6c0 (also evenly
 * spaced, same stride).
 *
 * Each 288-byte record is 9 standard SNES 4bpp bitplane-interleaved 8x8
 * tiles (see tools/shared/snes-ppu.ts), composed 3x3 into one 24x24px
 * portrait. This is **confirmed** by the render itself, not just a
 * plausible shape: entries decode to unambiguous, recognisable creature/NPC
 * faces (a wolf-like head, a cat/fox head, hooded humanoid figures, an
 * oni/demon mask, etc) -- not noise, not a repeating abstract pattern.
 *
 * **Palette -- confirmed** (see docs/wizardry6/snes/data-structure.md
 * section 3.3). A shared 32-byte-per-group CGRAM colour table lives at file
 * offset 0x10764 (CPU $82:8764); each *pair* of consecutive directory
 * indices shares one 16-colour group (`paletteGroup = floor(directoryIndex
 * / 2)`), read as `data[0x10764 + paletteGroup*32 .. +32]` (16 BGR555 words,
 * see `decodeCgramPalette`). This was found by tracing the tile loader's own
 * callers to a sibling palette-load routine (file 0x1067f) and confirmed
 * both structurally (the generic per-frame CGRAM-DMA dispatch table at file
 * 0x4162/0x4163/0x4165, indexed by DP variable $ca, has exactly one sane
 * record at $ca=10 matching this source/destination) and by render (all 36
 * portraits render coherent, face-plausible colour -- skin tones, fur
 * colours, etc -- not noise). Colour index 0 is `(0,0,255)` pure blue in
 * every group (a dev-tool transparency placeholder) and is rendered as
 * alpha 0, same convention as before.
 *
 * Entries 36-59 of the same nominal 60-slot table were tried too: 36-41
 * point at a differently-strided (0x90 = 144 byte) region at file 0x24010
 * that does *not* decode cleanly as tile data at 2bpp or 4bpp (still open),
 * and 42-59 hold small values that fail the ">= 0x8000 valid SNES address"
 * sanity check entirely and are treated as unused/padding table slots, not
 * further resource pointers -- both left out of this extractor's output.
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-portrait-tiles.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { readBinary, writeJson, writePNG } from '@seer-project/pipeline';
import { composeTileGrid, decodeCgramPalette } from '../../shared/snes-ppu';
import { shelfPack, type ShelfPackInput } from '@seer-project/core';

const DIRECTORY_OFFSET = 0x105d1; // file offset of the 2-byte-per-entry pointer table (bank 2)
const DIRECTORY_ENTRY_COUNT = 36; // indices 0-35 -- the confirmed-address portion of the nominal 60-slot table
const ROM_BANK5_BASE = 0x28000; // file offset of ROM bank $05 (CPU bank $85 mirror), addr $8000
const RECORD_BYTES = 0x120; // 288 bytes = 9 tiles x 32 bytes/tile (4bpp)
const TILE_GRID = 3; // 3x3 tiles/record -> 24x24px, 9 tiles/record
const PORTRAIT_PX = TILE_GRID * 8; // 24
const PALETTE_TABLE_BASE = 0x10764; // file offset -- confirmed shared CGRAM colour-group table (CPU $82:8764)
const PALETTE_GROUP_BYTES = 32; // 16 BGR555 colours/group

function directoryWordToFileOffset(word: number): number {
  return ROM_BANK5_BASE + (word - 0x8000);
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-portrait-tiles.ts <path-to-sfc>');
    process.exit(1);
  }

  const data = readBinary(romPath);

  const entries: { index: number; fileOffset: number }[] = [];
  for (let i = 0; i < DIRECTORY_ENTRY_COUNT; i++) {
    const off = DIRECTORY_OFFSET + i * 2;
    const word = data[off] | (data[off + 1] << 8);
    entries.push({ index: i, fileOffset: directoryWordToFileOffset(word) });
  }

  // Oracle check: indices 0-29, sorted by target address, must be exactly
  // RECORD_BYTES apart with zero deviation -- this is the structural
  // invariant that confirms the directory/record-size hypothesis. Refuse to
  // write output if it doesn't hold (same pattern as decode-class-titles.ts).
  const poolA = entries.slice(0, 30).slice().sort((a, b) => a.fileOffset - b.fileOffset);
  let mismatches = 0;
  for (let i = 1; i < poolA.length; i++) {
    const gap = poolA[i].fileOffset - poolA[i - 1].fileOffset;
    if (gap !== RECORD_BYTES) {
      mismatches++;
      console.error(
        `MISMATCH: gap between sorted entries ${poolA[i - 1].index} and ${poolA[i].index} is 0x${gap.toString(16)}, expected 0x${RECORD_BYTES.toString(16)}`,
      );
    }
  }
  console.log(`Directory stride oracle: ${poolA.length - 1 - mismatches}/${poolA.length - 1} gaps match 0x${RECORD_BYTES.toString(16)} exactly`);
  if (mismatches > 0) {
    console.error('Oracle check FAILED -- directory offset or record size is wrong. Not writing output.');
    process.exit(1);
  }

  // Pool B (indices 30-35): same record size, separately-located run of 6.
  const poolB = entries.slice(30, 36).slice().sort((a, b) => a.fileOffset - b.fileOffset);
  for (let i = 1; i < poolB.length; i++) {
    const gap = poolB[i].fileOffset - poolB[i - 1].fileOffset;
    if (gap !== RECORD_BYTES) {
      console.error(`WARNING: pool B gap between entries ${poolB[i - 1].index}/${poolB[i].index} is 0x${gap.toString(16)}, expected 0x${RECORD_BYTES.toString(16)} -- pool B is lower-confidence than pool A.`);
    }
  }

  // Decode all 36 in directory-index order (not sorted-by-address order) --
  // this is the natural "resource ID" order a future consumer would use.
  const packItems: ShelfPackInput[] = entries.map((e) => ({
    name: `portrait_${String(e.index).padStart(2, '0')}`,
    width: PORTRAIT_PX,
    height: PORTRAIT_PX,
  }));
  const packed = shelfPack(packItems, 8 * PORTRAIT_PX, 1);

  const rgba = new Uint8Array(packed.width * packed.height * 4);
  // Per-frame palette group: floor(directoryIndex / 2) -- confirmed, see header comment.
  const paletteGroupOf = (directoryIndex: number) => Math.floor(directoryIndex / 2);
  const paletteCache = new Map<number, number[]>();
  const paletteFor = (group: number): number[] => {
    let pal = paletteCache.get(group);
    if (!pal) {
      pal = decodeCgramPalette(data, PALETTE_TABLE_BASE + group * PALETTE_GROUP_BYTES, 16);
      paletteCache.set(group, pal);
    }
    return pal;
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const frame = packed.frames[i];
    const group = paletteGroupOf(entry.index);
    const palette = paletteFor(group);
    const indices = composeTileGrid(data, entry.fileOffset, TILE_GRID, TILE_GRID, 4);
    for (let y = 0; y < PORTRAIT_PX; y++) {
      for (let x = 0; x < PORTRAIT_PX; x++) {
        const idx = indices[y * PORTRAIT_PX + x];
        const [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
        const px = ((frame.y + y) * packed.width + (frame.x + x)) * 4;
        rgba[px] = r;
        rgba[px + 1] = g;
        rgba[px + 2] = b;
        // Index 0 is (0,0,255) pure blue in every group -- a dev-tool
        // transparency placeholder, not real content. Alpha 0, same
        // convention used before the palette was confirmed.
        rgba[px + 3] = idx === 0 ? 0 : 255;
      }
    }
  }

  const outDir = resolve('public/assets/wizardry6/snes');
  mkdirSync(resolve(outDir, 'sprites'), { recursive: true });

  writePNG(resolve(outDir, 'sprites/portraits.png'), rgba, packed.width, packed.height);
  writeJson(resolve(outDir, 'sprites/portraits.json'), {
    frames: packed.frames.map((f, i) => ({
      name: f.name,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      directoryIndex: entries[i].index,
      fileOffset: entries[i].fileOffset,
      paletteGroup: paletteGroupOf(entries[i].index),
      paletteFileOffset: PALETTE_TABLE_BASE + paletteGroupOf(entries[i].index) * PALETTE_GROUP_BYTES,
    })),
    width: packed.width,
    height: packed.height,
  });

  const manifestPath = resolve(outDir, 'manifest.json');
  type ManifestEntry = { name: string; group: string; png: string; atlas: string | null; palette: string | null; sprites: number };
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const withoutOld = manifest.filter((e) => e.name !== 'portraits');
  withoutOld.push({
    name: 'portraits',
    group: 'sprites',
    png: 'sprites/portraits.png',
    atlas: 'sprites/portraits.json',
    palette: null, // colours are baked into the PNG (confirmed CGRAM palette) -- see docs/wizardry6/snes/data-structure.md section 3.3
    sprites: entries.length,
  });
  writeJson(manifestPath, withoutOld);

  console.log(`Decoded ${entries.length} 24x24px face-portrait tiles (full colour, confirmed CGRAM palette) into a ${packed.width}x${packed.height} atlas.`);
  console.log('Wrote public/assets/wizardry6/snes/sprites/portraits.png, portraits.json, and updated manifest.json');
}

main();
