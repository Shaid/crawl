/**
 * Stage 2: Decode Black Crypt resource files → web-native PNG + JSON.
 * Produces tile atlas, palette, and map data for the browser engine.
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeJson, writePNG, writeIndexedPNG } from '@seer/pipeline';

const TILE_W = 32;
const TILE_H = 24;
const BPP = 6;
const TILE_BYTES = 576;

// Palette from bcdfq offset 0x2C6 (verified)
const PALETTE_WORDS = [
  0x000, 0xc86, 0xf00, 0xb00, 0xd80, 0xfe0, 0x0f0, 0x0b0,
  0x040, 0x0dd, 0x00f, 0x07c, 0xfd9, 0xeb8, 0xf0f, 0xe09,
  0x720, 0x952, 0xa53, 0x33b, 0x222, 0x444, 0x666, 0x999,
  0xccc, 0xfff, 0xb60, 0xc70, 0xc80, 0xd90, 0xeb0, 0xfc0,
];

function buildEhbPalette(): number[] {
  const pal: number[] = [];
  for (const v of PALETTE_WORDS) {
    pal.push(((v >> 8) & 0xF) * 17, ((v >> 4) & 0xF) * 17, (v & 0xF) * 17);
  }
  // Half-bright copies for EHB mode (colors 32-63)
  for (const v of PALETTE_WORDS) {
    pal.push(((v >> 8) & 0xF) * 17 >> 1, ((v >> 4) & 0xF) * 17 >> 1, (v & 0xF) * 17 >> 1);
  }
  return pal;
}

/** Decode a non-interleaved Amiga planar tile → RGBA pixels */
function decodeTile(data: Uint8Array, palette: number[]): Uint8Array {
  const pixels = new Uint8Array(TILE_W * TILE_H * 4);
  const bpr = TILE_W >> 3; // bytes per plane per row = 4
  const planeSize = bpr * TILE_H; // 96 bytes per plane

  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      let color = 0;
      for (let p = 0; p < BPP; p++) {
        const byteIdx = p * planeSize + y * bpr + (x >> 3);
        if (byteIdx < data.length) {
          const bit = (data[byteIdx] >> (7 - (x & 7))) & 1;
          color |= bit << p;
        }
      }
      const pi = (y * TILE_W + x) * 4;
      const ci = color * 3;
      pixels[pi] = palette[ci];
      pixels[pi + 1] = palette[ci + 1];
      pixels[pi + 2] = palette[ci + 2];
      pixels[pi + 3] = color === 0 ? 0 : 255; // transparent if color 0
    }
  }
  return pixels;
}

/** Stitch tiles into a single RGBA atlas image */
function buildAtlas(
  tiles: Uint8Array[],
  columns: number,
): { pixels: Uint8Array; width: number; height: number } {
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * TILE_W;
  const height = rows * TILE_H;
  const atlas = new Uint8Array(width * height * 4);

  for (let ti = 0; ti < tiles.length; ti++) {
    const col = ti % columns;
    const row = Math.floor(ti / columns);
    const tilePx = tiles[ti];
    for (let y = 0; y < TILE_H; y++) {
      const srcOff = y * TILE_W * 4;
      const dstOff = ((row * TILE_H + y) * width + col * TILE_W) * 4;
      atlas.set(tilePx.subarray(srcOff, srcOff + TILE_W * 4), dstOff);
    }
  }
  return { pixels: atlas, width, height };
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/blackcrypt/build-assets.ts <dataDir>');
    process.exit(1);
  }

  const outDir = resolve('public/assets/blackcrypt/amiga');
  mkdirSync(outDir, { recursive: true });

  const palette = buildEhbPalette();

  // === Build tile atlas from bcdfa ===
  try {
    const bcdfa = readFileSync(resolve(dataDir, 'bcdfa'));
    const headerSize = 8;
    const nTiles = Math.floor((bcdfa.length - headerSize) / TILE_BYTES);
    const tiles: Uint8Array[] = [];

    for (let ti = 0; ti < nTiles; ti++) {
      const off = headerSize + ti * TILE_BYTES;
      const tile = decodeTile(bcdfa.subarray(off, off + TILE_BYTES), palette);
      tiles.push(tile);
    }

    const columns = 20;
    const atlas = buildAtlas(tiles, columns);

    writePNG(resolve(outDir, 'tiles.png'), atlas.pixels, atlas.width, atlas.height);
    writeJson(resolve(outDir, 'tiles.json'), {
      imageUrl: '/assets/blackcrypt/amiga/tiles.png',
      tileWidth: TILE_W,
      tileHeight: TILE_H,
      columns,
      tileCount: nTiles,
    });

    console.log(`Built tile atlas: ${nTiles} tiles (${columns}x${Math.ceil(nTiles / columns)})`);
  } catch (e) {
    console.log('bcdfa not found — skipping tile atlas');
  }

  // === Write palette as JSON for runtime ===
  writeJson(resolve(outDir, 'palette.json'), {
    colors: PALETTE_WORDS.map((v, i) => ({
      index: i,
      value: v,
      rgb: [((v >> 8) & 0xF) * 17, ((v >> 4) & 0xF) * 17, (v & 0xF) * 17],
    })),
  });

  console.log(`Pipeline complete — assets written to ${outDir}`);
}

main();
