/**
 * Bard's Tale II (Amiga): dungeon walker assets.
 *
 * Usage: npx tsx tools/bardstale2/amiga/export-dungeon.ts [dataDir]
 * (`dataDir` defaults to `data/_unexplored_/BardsTale2/data/bards_data`.)
 *
 * Decodes (all `[u32 size][u32 bitcount][Huffman]`, docs/bardstale-picture-format.md §8):
 *   levs      25-entry u32BE directory -> 25 records of 3,072 B (walls @0, flags @0x200, name @0x600)
 *   big_dung  22,424 B = 32 B palette + 56x88x4 half background + 4-plane pieces (layout in `dungeon.ts`)
 * `dung_blank` is NOT read by the BT2 executable (no reference in `data/bard`), so it is not used.
 * Writes public/assets/bardstale2/amiga/data/dungeon/{levels.json,level<N>.json,view.json}.
 * Verifies that the piece table tiles big_dung with no gap/overlap before writing.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson, writeManifest, dataManifestEntry, writePlatformIndex } from '../../shared/asset-paths.ts';
import { decodeHuffmanRecord } from '../../bardstale1/amiga/export-dungeon.ts';
import { buildArt, bigDungLayout, levelName, GRID, LEVEL_SIZE, LEVEL_COUNT } from './dungeon.ts';

const GAME = 'bardstale2';
const PLATFORM = 'amiga';

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

export interface Bt2Level {
  walls: number[];
  flags: number[];
  name: string;
}

/** `levs`: the first 25 u32BE entries are record offsets (entry 25 is already the first record's size field region). */
export function parseLevs(levs: Uint8Array): Bt2Level[] {
  const out: Bt2Level[] = [];
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const rec = decodeHuffmanRecord(levs, u32(levs, i * 4));
    if (rec.length !== LEVEL_SIZE) throw new Error(`levs record ${i}: ${rec.length} B`);
    out.push({
      walls: Array.from(rec.subarray(0, GRID * GRID)),
      flags: Array.from(rec.subarray(0x200, 0x200 + GRID * GRID)),
      name: levelName(rec),
    });
  }
  return out;
}

export function verifyTiling(total: number): void {
  const end = bigDungLayout().end;
  if (end !== total) throw new Error(`big_dung piece layout ends at ${end}, decoded file is ${total}`);
}

export function exportBardsTale2Dungeon(dataDir: string): void {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const levels = parseLevs(rd('levs'));
  const bigDung = decodeHuffmanRecord(rd('big_dung'), 0);
  verifyTiling(bigDung.length);
  const art = buildArt(bigDung);

  const dir = resolve(assetDir('data', GAME, PLATFORM), 'dungeon');
  mkdirSync(dir, { recursive: true });
  levels.forEach((l, i) => writeJson(resolve(dir, `level${i}.json`), { id: i, width: GRID, height: GRID, ...l }, false));
  writeJson(resolve(dir, 'levels.json'), { levels: levels.map((l, i) => ({ id: i, name: l.name })) });
  const flat = (p: { w: number; h: number; px: Uint8Array }) => ({ w: p.w, h: p.h, px: Array.from(p.px) });
  writeJson(
    resolve(dir, 'view.json'),
    { palette: art.palette, background: Array.from(art.background), a: art.a.map(flat), b: art.b.map(flat), c: art.c.map(flat) },
    false,
  );
  writeManifest([dataManifestEntry('dungeon/levels')], GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`  bardstale2/amiga: ${levels.length} dungeon levels + view art (big_dung tiled exactly, ${bigDung.length} B)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale2Dungeon(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale2/data/bards_data'));
}
