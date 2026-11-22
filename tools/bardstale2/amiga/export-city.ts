/**
 * Bard's Tale II (Amiga): city walker assets (the six cities).
 *
 * Usage: npx tsx tools/bardstale2/amiga/export-city.ts [dataDir]
 *
 * Decodes (all `[u32 size][u32 bitcount][Huffman]`, docs/bardstale-picture-format.md §8):
 *   citys     7-entry u32BE directory: record 0 = 2,304 B wilderness (48x48, not used here), records 1..6 = 512 B
 *             cities (16x16 cells + 16x16 street names)
 *   big_city  92,744 B: palette + 30 four-plane bitmaps (layout in city.ts, checked to fill the file exactly)
 *   pics      the special-building pictures shown straight ahead (0x5a5b0)
 * Writes public/assets/bardstale2/amiga/data/city/{cities.json,city<i>.json,view.json}.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBard12Picture } from '../../shared/bardstale-codecs.ts';
import { decodePlanar } from '../../shared/amiga-planar.ts';
import { assetDir, writeJson, writeManifest, dataManifestEntry } from '../../shared/asset-paths.ts';
import { decodeHuffmanRecord } from '../../bardstale1/amiga/export-dungeon.ts';
import {
  BIG_CITY_SIZE,
  CITY_NAMES,
  CITY_N,
  GUILD_EXIT,
  SPECIAL_PICS,
  bigCityLayout,
  buildingAction,
  type Bt2City,
} from './city.ts';

const GAME = 'bardstale2';
const PLATFORM = 'amiga';
const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

export function parseCitys(citys: Uint8Array): Bt2City[] {
  const out: Bt2City[] = [];
  for (let i = 1; i <= 6; i++) {
    const rec = decodeHuffmanRecord(citys, u32(citys, i * 4));
    if (rec.length !== 512) throw new Error(`citys record ${i}: ${rec.length} B, expected 512`);
    out.push({ index: i, name: CITY_NAMES[i]!, grid: rec });
  }
  return out;
}

export interface CityEntrance {
  row: number;
  col: number;
  name: string;
  dungeonId: number;
  /** walker dungeon level = levs record (base + level 1 - 1) */
  level: number;
  /** dungeon overlay 0x5de2e: (0,0) facing 0 when not arriving by stairs */
  to: { a: number; b: number; facing: number };
}

export function cityEntrances(c: Bt2City): CityEntrance[] {
  const out: CityEntrance[] = [];
  for (let row = 0; row < CITY_N; row++)
    for (let col = 0; col < CITY_N; col++) {
      const v = c.grid[row * CITY_N + col]!;
      if (!v) continue;
      const a = buildingAction(c, v);
      if (a.kind === 'dungeon') out.push({ row, col, name: a.message, dungeonId: a.dungeonId, level: a.record, to: { a: 0, b: 0, facing: 0 } });
    }
  return out;
}

export function exportBardsTale2City(dataDir: string): void {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const cities = parseCitys(rd('citys'));
  const big = decodeHuffmanRecord(rd('big_city'), 0);
  if (big.length !== BIG_CITY_SIZE) throw new Error(`big_city ${big.length} B, expected ${BIG_CITY_SIZE}`);
  bigCityLayout(); // throws unless the carve-up fills big_city exactly
  const palette: number[] = [];
  for (let i = 0; i < 16; i++) palette.push((big[i * 2]! << 8) | big[i * 2 + 1]!);
  const pics = rd('pics');
  const pictures: Record<number, { px: number[]; palette: number[] }> = {};
  for (const n of new Set(SPECIAL_PICS.filter((p) => p > 0))) {
    const p = loadBard12Picture(pics, n, 2);
    pictures[n] = { px: Array.from(decodePlanar(p.basePicture, 112, 88, 4)), palette: p.paletteWords };
  }
  const dir = resolve(assetDir('data', GAME, PLATFORM), 'city');
  mkdirSync(dir, { recursive: true });
  const index = cities.map((c) => {
    const [row, col, facing] = GUILD_EXIT[c.index]!;
    const entrances = cityEntrances(c);
    writeJson(resolve(dir, `city${c.index}.json`), { index: c.index, name: c.name, grid: Array.from(c.grid) }, false);
    return { index: c.index, name: c.name, start: { row, col, facing, from: 'guild exit 0x3bd40/0x3bd47/0x3bd4e' }, entrances };
  });
  writeJson(resolve(dir, 'cities.json'), { cities: index });
  writeJson(resolve(dir, 'view.json'), { palette, bigCity: Array.from(big), pictures }, false);
  writeManifest([dataManifestEntry('city/cities')], GAME, PLATFORM);
  console.log(`  bardstale2/amiga: ${cities.length} cities + big_city view art (${index.reduce((n, c) => n + c.entrances.length, 0)} dungeon entrance cells)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale2City(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale2/data/bards_data'));
}
