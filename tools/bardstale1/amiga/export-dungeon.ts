/**
 * Bard's Tale I (Amiga): dungeon walker assets.
 *
 * Usage: npx tsx tools/bardstale1/amiga/export-dungeon.ts [dataDir]
 *
 * Decodes (all `[u32 size][u32 bitcount][Huffman]`, docs/bardstale-picture-format.md §8):
 *   levs        16-entry u32BE directory -> 16 records of 2,048 B (walls @0, flags @0x200, header/name @0x400)
 *   big_dung    30,304 B of 4-plane bitmaps (wall/door/side/mark pieces; layout in `dungeon.ts`)
 *   dung_blank  32 B palette + RLE 112x88x4 background
 * Writes public/assets/bardstale1/amiga/data/dungeon/{levels.json,level<N>.json,view.json}.
 * Verifies that the piece table tiles big_dung with no gap/overlap before writing.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BardstaleHuffmanDecoder, decodeBardstaleRLE } from '../../shared/bardstale-codecs.ts';
import { assetDir, writeJson, writeManifest, dataManifestEntry, writePlatformIndex } from '../../shared/asset-paths.ts';
import { buildArt, pieceRanges, GRID } from './dungeon.ts';

const GAME = 'bardstale1';
const PLATFORM = 'amiga';

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

export function decodeHuffmanRecord(buf: Uint8Array, offset: number): Uint8Array {
  const size = u32(buf, offset);
  return new BardstaleHuffmanDecoder(buf, { v: offset + 8 }).decode(size);
}

export interface LevsRecord {
  walls: number[];
  flags: number[];
  header: number[];
  name: string;
}

export function parseLevs(levs: Uint8Array): LevsRecord[] {
  const out: LevsRecord[] = [];
  for (let i = 0; i < 16; i++) {
    const rec = decodeHuffmanRecord(levs, u32(levs, i * 4));
    if (rec.length !== 2048) throw new Error(`levs record ${i}: ${rec.length} B`);
    // Name = high-bit ASCII from +0x416 up to the `\` (0x5c) terminator (overlay 0x800a2..0x800d4).
    let name = '';
    for (let o = 0x416; o < 0x480; o++) {
      const c = rec[o]! & 0x7f;
      if (c === 0x5c) break;
      name += String.fromCharCode(c);
    }
    out.push({
      walls: Array.from(rec.subarray(0, GRID * GRID)),
      flags: Array.from(rec.subarray(0x200, 0x200 + GRID * GRID)),
      header: Array.from(rec.subarray(0x400, 0x416)),
      name: name.trim(),
    });
  }
  return out;
}

/** Check the piece table covers every byte of big_dung exactly once. */
export function verifyTiling(total: number): void {
  const ranges = pieceRanges().sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [o, l] of ranges) {
    if (o !== pos) throw new Error(`big_dung piece table gap/overlap at ${pos} vs ${o}`);
    pos += l;
  }
  if (pos !== total) throw new Error(`big_dung piece table ends at ${pos}, file is ${total}`);
}

export function exportBardsTale1Dungeon(dataDir: string): void {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const levels = parseLevs(rd('levs'));
  const bigDung = decodeHuffmanRecord(rd('big_dung'), 0);
  verifyTiling(bigDung.length);
  const blank = decodeHuffmanRecord(rd('dung_blank'), 0);
  const palette: number[] = [];
  for (let i = 0; i < 16; i++) palette.push((blank[i * 2]! << 8) | blank[i * 2 + 1]!);
  const bgPlanar = decodeBardstaleRLE(blank, { v: 32 });
  if (bgPlanar.length !== 4928) throw new Error(`dung_blank RLE ${bgPlanar.length} B`);
  const art = buildArt(bigDung, palette, bgPlanar);

  const dir = resolve(assetDir('data', GAME, PLATFORM), 'dungeon');
  mkdirSync(dir, { recursive: true });
  levels.forEach((l, i) => writeJson(resolve(dir, `level${i}.json`), { id: i, width: GRID, height: GRID, ...l }, false));
  writeJson(resolve(dir, 'levels.json'), { levels: levels.map((l, i) => ({ id: i, name: l.name })) });
  const flat = (p: { w: number; h: number; px: Uint8Array }) => ({ w: p.w, h: p.h, px: Array.from(p.px) });
  writeJson(
    resolve(dir, 'view.json'),
    {
      palette,
      background: Array.from(art.background),
      front: { wall: art.front.wall.map(flat), door: art.front.door.map(flat) },
      sideC: art.sideC.map((r) => r.map(flat)),
      sideO: art.sideO.map((r) => r.map(flat)),
      marks: { floor: art.marks.floor.map((r) => r.map(flat)), ceiling: art.marks.ceiling.map((r) => r.map(flat)) },
    },
    false,
  );
  writeManifest([dataManifestEntry('dungeon/levels')], GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`  bardstale1/amiga: ${levels.length} dungeon levels + view art (big_dung tiled exactly, ${bigDung.length} B)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale1Dungeon(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTaleNTSC/data/bards_data'));
}
