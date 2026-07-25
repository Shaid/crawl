import { defineGameConfig } from '@seer/pipeline';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

// Amiga 12-bit color → 24-bit RGB
function amiga12ToRGB(v: number): [number, number, number] {
  return [((v >> 8) & 0xF) * 17, ((v >> 4) & 0xF) * 17, (v & 0xF) * 17];
}

// Palette from bcdfq offset 0x2C6
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
  for (const v of PALETTE_WORDS) {
    pal.push(((v >> 8) & 0xF) * 17 >> 1, ((v >> 4) & 0xF) * 17 >> 1, (v & 0xF) * 17 >> 1);
  }
  return pal;
}

const TILE_W = 32;
const TILE_H = 24;
const TILE_BYTES = 576;
const BPP = 6;

function decodeTile(data: Uint8Array, palette: number[]): Uint8Array {
  const pixels = new Uint8Array(TILE_W * TILE_H * 4);
  const bpr = TILE_W >> 3;
  const planeSize = bpr * TILE_H;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      let color = 0;
      for (let p = 0; p < BPP; p++) {
        const bi = p * planeSize + y * bpr + (x >> 3);
        if (bi < data.length) {
          color |= ((data[bi] >> (7 - (x & 7))) & 1) << p;
        }
      }
      const ci = color * 3;
      const pi = (y * TILE_W + x) * 4;
      pixels[pi] = palette[ci];
      pixels[pi + 1] = palette[ci + 1];
      pixels[pi + 2] = palette[ci + 2];
      pixels[pi + 3] = 255;
    }
  }
  return pixels;
}

async function writePNG(p: string, px: Uint8Array, w: number, h: number) {
  const { PNG } = await import('pngjs');
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(px);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(p, PNG.sync.write(png));
}

async function writeJson(p: string, data: unknown) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export default defineGameConfig([{
  id: 'blackcrypt',
  displayName: 'Black Crypt',
  platforms: [{
    platform: 'amiga',
    dataDirs: ['blackcrypt/amiga'],
    executable: 'BlackCrypt',
    expectedFiles: ['bcdfa'],
    supported: true,
    assetDir: 'blackcrypt',
    features: {},

    async exportGameData(_cfg, dataDir) {
      const outDir = resolve('data/extracted/blackcrypt');
      mkdirSync(outDir, { recursive: true });

      // Extract palette
      try {
        const bcdfq = readFileSync(resolve(dataDir, 'bcdfq'));
        const pal = [];
        for (let i = 0; i < 32; i++) {
          const off = 0x2c6 + i * 2;
          const v = (bcdfq[off] << 8) | bcdfq[off + 1];
          pal.push({ index: i, value: v, rgb: amiga12ToRGB(v) });
        }
        writeJson(resolve(outDir, 'palette.json'), pal);
        console.log(`  Extracted 32-color palette`);
      } catch { console.log('  Skipped palette (bcdfq not found)'); }

      // Extract items from bcdfp
      try {
        const bcdfp = readFileSync(resolve(dataDir, 'bcdfp'));
        const dataOff = 0x566c;
        const chunk = bcdfp.subarray(dataOff, dataOff + 1748);
        const items: Record<string, unknown>[] = [];
        for (let pos = 0; pos < chunk.length - 8; pos += 2) {
          const gfx = (chunk[pos] << 8) | chunk[pos + 1];
          const nameOff = (chunk[pos + 2] << 8) | chunk[pos + 3];
          const itemType = chunk[pos + 5];
          if (gfx > 0 && gfx <= 0xffff && nameOff > 0 && itemType >= 1 && itemType <= 0x30) {
            items.push({
              gfxNumber: gfx,
              nameOffset: nameOff,
              itemType,
              weight: (chunk[pos + 8] << 8) | chunk[pos + 9],
              size: (chunk[pos + 10] << 8) | chunk[pos + 11],
              ac: chunk[pos + 12],
            });
            pos += 16;
          }
        }
        writeJson(resolve(outDir, 'items.json'), items);
        console.log(`  Extracted ${items.length} items`);
      } catch { console.log('  Skipped items (bcdfp not found)'); }
    },

    async buildAssets(_cfg, dataDir) {
      const outDir = resolve('public/assets/blackcrypt/amiga');
      mkdirSync(outDir, { recursive: true });
      const palette = buildEhbPalette();

      // Build tile atlas from bcdfa
      try {
        const bcdfa = readFileSync(resolve(dataDir, 'bcdfa'));
        const nTiles = Math.floor((bcdfa.length - 8) / TILE_BYTES);
        const cols = 20;
        const rows = Math.ceil(nTiles / cols);
        const aw = cols * TILE_W;
        const ah = rows * TILE_H;
        const atlas = new Uint8Array(aw * ah * 4).fill(0);

        for (let ti = 0; ti < nTiles; ti++) {
          const off = 8 + ti * TILE_BYTES;
          const tile = decodeTile(bcdfa.subarray(off, off + TILE_BYTES), palette);
          const col = ti % cols;
          const row = Math.floor(ti / cols);
          for (let y = 0; y < TILE_H; y++) {
            const srcOff = y * TILE_W * 4;
            const dstOff = ((row * TILE_H + y) * aw + col * TILE_W) * 4;
            atlas.set(tile.subarray(srcOff, srcOff + TILE_W * 4), dstOff);
          }
        }

        await writePNG(resolve(outDir, 'tiles.png'), atlas, aw, ah);
        await writeJson(resolve(outDir, 'tiles.json'), {
          imageUrl: '/assets/blackcrypt/amiga/tiles.png',
          tileWidth: TILE_W,
          tileHeight: TILE_H,
          columns: cols,
          tileCount: nTiles,
        });
        console.log(`  Built tile atlas: ${nTiles} tiles (${cols}x${rows})`);
      } catch (e) { console.log('  Skipped tiles (bcdfa not found)'); }
    },
  }],
}]);
