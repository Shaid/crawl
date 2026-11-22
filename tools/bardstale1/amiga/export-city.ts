/**
 * Bard's Tale I (Amiga): Skara Brae city walker assets.
 *
 * Usage: npx tsx tools/bardstale1/amiga/export-city.ts [dataDir]
 *
 * Decodes (all `[u32 size][u32 bitcount][Huffman]`, docs/bardstale-picture-format.md §8):
 *   CITY/city.path  900 B: 30x30 building/street grid (the city overlay loads it as "CITY/CITY.PATH")
 *   CITY/city.name  900 B: 30x30 street-name grid ("CITY/CITY.NAME")
 *   big_city        136,000 B: palette + street-wall halves + fronts + side faces (layout in city.ts)
 *   pics            the special-building pictures the view shows straight ahead (0x8729a)
 * Street names are the overlay's own string table (0x845d8), copied here as data.
 * Writes public/assets/bardstale1/amiga/data/city/{city.json,view.json}.
 * Verifies that the front / side rect tables tile big_city's front and side images exactly before writing.
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBard12Picture } from '../../shared/bardstale-codecs.ts';
import { decodePlanar } from '../../shared/amiga-planar.ts';
import { assetDir, writeJson, writeManifest, dataManifestEntry } from '../../shared/asset-paths.ts';
import { decodeHuffmanRecord } from './export-dungeon.ts';
import {
  BIG_CITY_SIZE,
  HALF_OFF,
  FRONT_OFF,
  SIDE_OFF,
  FRONT_BYTES,
  SIDE_BYTES,
  FRONT_WORDS,
  SIDE_WORDS,
  SIDE_RECTS,
  SPECIAL_PICS,
  frontRectWords,
  sideRectWords,
  START,
  buildingAction,
  levsRecord,
} from './city.ts';

const GAME = 'bardstale1';
const PLATFORM = 'amiga';

/** Overlay-1 string table 0x845d8 (20 pointers): street names by CITY.NAME value. */
export const STREET_NAMES = [
  'Alley', 'Rakhir', 'Blacksmith', 'Main', 'Trumpet', 'Gray Knife', 'Stonework', 'Emerald', 'Hawk Scabard',
  'Bard Blazon', 'Tempest', 'Fargoer', 'a Blue Highway', 'Night Archer', 'Serpentskin', 'Corbomite', 'Sinister',
  'Marksman', 'Dilvish', 'Death Archer',
];

/** The front (0x21ff0) and side (0x8718c / 0x8719e) offset tables must tile one image of each kind exactly. */
export function verifyCityTiling(): void {
  let pos = 0;
  for (let i = 0; i < 9; i++) {
    if (FRONT_WORDS[i] !== pos) throw new Error(`front rect ${i} at word ${FRONT_WORDS[i]}, expected ${pos}`);
    // Front rect 1 (distance 3, walk frame 1) draws one word column but its block is stored two wide (128 words):
    // the only entry that does not tile; frame 1 is never drawn by the walker.
    pos += i === 1 ? 2 * frontRectWords(i) : frontRectWords(i);
  }
  if (pos * 2 !== FRONT_BYTES) throw new Error(`front rects end at ${pos * 2} B, image is ${FRONT_BYTES}`);
  pos = 0;
  for (let i = 0; i < 9; i++) {
    if (SIDE_WORDS[i] !== pos) throw new Error(`side rect ${i} at word ${SIDE_WORDS[i]}, expected ${pos}`);
    if (SIDE_RECTS[i]![6] !== sideRectWords(i, false)) throw new Error(`side rect ${i}: right part offset mismatch`);
    pos += sideRectWords(i, false) + sideRectWords(i, true);
  }
  if (pos * 2 !== SIDE_BYTES) throw new Error(`side rects end at ${pos * 2} B, image is ${SIDE_BYTES}`);
  if (SIDE_OFF + 4 * SIDE_BYTES !== BIG_CITY_SIZE || HALF_OFF !== 32 || FRONT_OFF !== 32 + 16 * 0x9a0)
    throw new Error('big_city layout does not add up to 136,000 B');
}

export interface CityEntrance {
  row: number;
  col: number;
  name: string;
  /** walker dungeon level (= levs record) */
  level: number;
  dungeon: number;
  dungeonLevel: number;
  /** dungeon arrival (dungeon overlay 0x80042: (0,0) facing north; (16,17) for dungeon 1 level 4) */
  to: { a: number; b: number; facing: number };
}

export function cityEntrances(path: Uint8Array): CityEntrance[] {
  const out: CityEntrance[] = [];
  for (let row = 0; row < 30; row++)
    for (let col = 0; col < 30; col++) {
      const v = path[row * 30 + col]!;
      if (!v) continue;
      const act = buildingAction(v, row, col, 0);
      if (act.kind !== 'dungeon') continue;
      const special = act.dungeon === 1 && act.level === 4;
      out.push({
        row,
        col,
        name: act.message,
        level: levsRecord(act.dungeon, act.level),
        dungeon: act.dungeon,
        dungeonLevel: act.level,
        to: special ? { a: 16, b: 17, facing: 0 } : { a: 0, b: 0, facing: 0 },
      });
    }
  return out;
}

export function exportBardsTale1City(dataDir: string): void {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const cityDir = existsSync(resolve(dataDir, 'CITY')) ? 'CITY' : 'city';
  const path = decodeHuffmanRecord(rd(`${cityDir}/city.path`), 0);
  const name = decodeHuffmanRecord(rd(`${cityDir}/city.name`), 0);
  if (path.length !== 900 || name.length !== 900) throw new Error(`city grids ${path.length}/${name.length} B, expected 900`);
  const big = decodeHuffmanRecord(rd('big_city'), 0);
  if (big.length !== BIG_CITY_SIZE) throw new Error(`big_city ${big.length} B, expected ${BIG_CITY_SIZE}`);
  verifyCityTiling();
  const palette: number[] = [];
  for (let i = 0; i < 16; i++) palette.push((big[i * 2]! << 8) | big[i * 2 + 1]!);

  const pics = rd('pics');
  const pictures: Record<number, { px: number[]; palette: number[] }> = {};
  for (const n of new Set(SPECIAL_PICS.filter((p) => p > 0))) {
    const p = loadBard12Picture(pics, n, 1);
    pictures[n] = { px: Array.from(decodePlanar(p.basePicture, 112, 88, 4)), palette: p.paletteWords };
  }

  const dir = resolve(assetDir('data', GAME, PLATFORM), 'city');
  mkdirSync(dir, { recursive: true });
  const entrances = cityEntrances(path);
  writeJson(resolve(dir, 'city.json'), {
    name: 'Skara Brae',
    width: 30,
    height: 30,
    path: Array.from(path),
    nameGrid: Array.from(name),
    streetNames: STREET_NAMES,
    start: START,
    entrances,
  }, false);
  writeJson(resolve(dir, 'view.json'), { palette, bigCity: Array.from(big), pictures }, false);
  writeManifest([dataManifestEntry('city/city')], GAME, PLATFORM);
  console.log(`  bardstale1/amiga: Skara Brae 30x30 + big_city view art (${entrances.length} dungeon entrances)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale1City(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTaleNTSC/data/bards_data'));
}
