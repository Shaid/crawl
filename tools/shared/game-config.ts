import {
  defineGameConfig,
  flattenConfigs,
  resolveDataDir,
  findFileCI,
  resType,
  getGameConfig as _getGameConfig,
  getSupportedPlatforms as _getSupportedPlatforms,
  type GameConfig as BaseGameConfig,
  type PlatformConfig as BasePlatformConfig,
} from '@seer/pipeline';
import {
  GAME_IDS,
  PLATFORM_IDS,
  DEFAULT_GAME,
  DEFAULT_PLATFORM,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

export { GAME_IDS, PLATFORM_IDS, DEFAULT_GAME, DEFAULT_PLATFORM, flattenConfigs, resolveDataDir, findFileCI, resType };
export type { GameId, PlatformId };

export interface PlatformConfig extends Omit<BasePlatformConfig, "platform"> {
  platform: PlatformId;
}

export interface GameConfig extends Omit<BaseGameConfig, "id" | "platforms"> {
  id: GameId;
  platforms: PlatformConfig[];
}

import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TILE_W = 32, TILE_H = 24, TILE_BYTES = 576, BPP = 6;

const PAL_WORDS = [
  0x000, 0xc86, 0xf00, 0xb00, 0xd80, 0xfe0, 0x0f0, 0x0b0,
  0x040, 0x0dd, 0x00f, 0x07c, 0xfd9, 0xeb8, 0xf0f, 0xe09,
  0x720, 0x952, 0xa53, 0x33b, 0x222, 0x444, 0x666, 0x999,
  0xccc, 0xfff, 0xb60, 0xc70, 0xc80, 0xd90, 0xeb0, 0xfc0,
];

function ehbPalette(): number[] {
  const p: number[] = [];
  for (const v of PAL_WORDS) p.push(((v>>8)&0xF)*17, ((v>>4)&0xF)*17, (v&0xF)*17);
  for (const v of PAL_WORDS) p.push(((v>>8)&0xF)*17>>1, ((v>>4)&0xF)*17>>1, (v&0xF)*17>>1);
  return p;
}

function amiga12ToRGB(v: number): [number,number,number] {
  return [((v>>8)&0xF)*17, ((v>>4)&0xF)*17, (v&0xF)*17];
}

function decodeTile(data: Uint8Array, pal: number[]): Uint8Array {
  const px = new Uint8Array(TILE_W * TILE_H * 4);
  const bpr = TILE_W >> 3;     // 4 bytes per plane per row
  const rowBytes = bpr * BPP;  // 24 bytes per row (all 6 planes interleaved)
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      let c = 0;
      for (let p = 0; p < BPP; p++) {
        const bi = y * rowBytes + p * bpr + (x >> 3);
        if (bi < data.length) c |= ((data[bi] >> (7 - (x & 7))) & 1) << p;
      }
      const ci = c * 3, pi = (y * TILE_W + x) * 4;
      px[pi] = pal[ci]; px[pi+1] = pal[ci+1]; px[pi+2] = pal[ci+2]; px[pi+3] = 255;
    }
  }
  return px;
}

async function writePNG(path: string, px: Uint8Array, w: number, h: number) {
  const { PNG } = await import('pngjs');
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(px);
  writeFileSync(path, PNG.sync.write(png));
}

export const GAME_CONFIGS: GameConfig[] = defineGameConfig([{
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
      try {
        const d = readFileSync(resolve(dataDir, 'bcdfq'));
        const p = Array.from({length: 32}, (_, i) => {
          const off = 0x2c6 + i*2;
          const v = (d[off]<<8)|d[off+1];
          return {index:i, value:v, rgb:amiga12ToRGB(v)};
        });
        writeFileSync(resolve(outDir, 'palette.json'), JSON.stringify(p));
        console.log('  Extracted 32-color palette from bcdfq');
      } catch { console.log('  Skipped palette'); }

      try {
        const d = readFileSync(resolve(dataDir, 'bcdfp'));
        const dataOff = 0x566c;
        // Item table: 20-byte records starting at 0x585C
        // Format: [2B prefix(0x0000)] [2B uniq] [1B marker(0x80)] [1B subGfx]
        //  [2B flags] [2B ?] [2B weight] [2B size] [1B ?] [1B AC] [2B extra] [2B extra]
        const itemStart = 0x585c;
        const itemSize = 20;
        const items: Record<string,unknown>[] = [];
        for (let i = 0; i < 22; i++) {
          const off = itemStart + i * itemSize;
          if (off + itemSize > d.length) break;
          const prefix = (d[off]<<8)|d[off+1];
          const uniq = (d[off+2]<<8)|d[off+3];
          const marker = d[off+4];
          const subGfx = d[off+5];
          const weight = (d[off+10]<<8)|d[off+11];
          const size = (d[off+12]<<8)|d[off+13];
          const ac = d[off+15];
          // Stop when record no longer has expected prefix + marker
          if (prefix !== 0 || marker !== 0x80) break;
          items.push({ uniq, subGfx, weight, size, ac });
        }
        writeFileSync(resolve(outDir, 'items.json'), JSON.stringify(items, null, 2));
        console.log(`  Extracted ${items.length} items from bcdfp`);
      } catch { console.log('  Skipped items'); }
    },

    async buildAssets(_cfg, dataDir) {
      const outDir = resolve('public/assets/blackcrypt/amiga');
      mkdirSync(outDir, { recursive: true });
      const pal = ehbPalette();
      try {
        const d = readFileSync(resolve(dataDir, 'bcdfa'));
        const n = Math.floor((d.length - 8) / TILE_BYTES);
        const cols = 20, rows = Math.ceil(n / cols);
        const aw = cols*TILE_W, ah = rows*TILE_H;
        const atlas = new Uint8Array(aw*ah*4).fill(0);

        // Build per-tile frames array for viewer
        const frames: { name: string; x: number; y: number; w: number; h: number }[] = [];
        for (let ti = 0; ti < n; ti++) {
          const td = decodeTile(d.subarray(8+ti*TILE_BYTES, 8+(ti+1)*TILE_BYTES), pal);
          const col = ti%cols, row = Math.floor(ti/cols);
          frames.push({ name: `tile_${ti}`, x: col*TILE_W, y: row*TILE_H, w: TILE_W, h: TILE_H });
          for (let y = 0; y < TILE_H; y++) {
            atlas.set(td.subarray(y*TILE_W*4, (y+1)*TILE_W*4),
              ((row*TILE_H+y)*aw + col*TILE_W)*4);
          }
        }

        await writePNG(resolve(outDir, 'tiles.png'), atlas, aw, ah);
        // Write atlas metadata in viewer-compatible format
        writeFileSync(resolve(outDir, 'tiles.json'), JSON.stringify({
          frames, width: aw, height: ah,
        }));
        // Write palette in viewer-compatible format
        const paletteColors = PAL_WORDS.map(v => ({
          r: ((v>>8)&0xF)*17, g: ((v>>4)&0xF)*17, b: (v&0xF)*17
        }));
        writeFileSync(resolve(outDir, 'tiles.pal.json'), JSON.stringify({ colors: paletteColors }));
        // Write manifest
        writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify([{
          name: 'tiles',
          sprites: n,
          hasPalette: true,
          png: 'tiles.png',
        }]));
        console.log(`  Built tile atlas: ${n} tiles (${cols}x${rows})`);
      } catch (e) { console.log('  Skipped tiles:', e); }
    },
  }],
}]);

export const GAME_PLATFORMS = flattenConfigs(GAME_CONFIGS);

export function getGameConfig(game: GameId, platform: PlatformId): PlatformConfig | undefined {
  return _getGameConfig(GAME_PLATFORMS, game, platform) as PlatformConfig | undefined;
}

export function getSupportedPlatforms(game: GameId): PlatformId[] {
  return _getSupportedPlatforms(GAME_PLATFORMS, game) as PlatformId[];
}
