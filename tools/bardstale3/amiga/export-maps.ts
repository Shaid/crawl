/**
 * Bard's Tale III (Amiga): `maps.hi` / `maps.lo` -> `data/maps.json`, and the `.GRP` wall-art files.
 *
 * Usage: npx tsx tools/bardstale3/amiga/export-maps.ts [dataDir]
 *
 * Container (confirmed, docs/bardstale3/amiga/data-structure.md §3): `maps.*` = a u32BE directory of
 * record offsets (first entry = directory length, last entry = file length = sentinel), each record
 * `[u32 BE decodedSize][Okumura LZHUF stream]`; the stream consumes exactly `span - 4 + 1` bytes
 * (the decoder's one-byte bit-buffer read-ahead), checked for every record.
 *
 * Decoded record: 16-byte high-bit ASCII name (0xff pad), then:
 *   - "grid" maps (cities / wilderness, 10 of 71): w, h, 2 flag bytes, (h+2) u16BE words (word 0 unresolved,
 *     words 1..h = row start - 1 in reverse order), then h rows of w cell bytes, then an event/special tail;
 *   - "dungeon" maps (61 of 71): [0x10] = size-1, [0x11] = level index, then a different layout that is NOT
 *     decoded yet (kept as raw bytes).
 * Cell values are NOT interpreted (no consumer traced), orientation is unconfirmed.
 *
 * `.GRP` (D0WAL, GDUNG, SKARA, WILDWAL): LE u16 offset directory (entry 0 = directory length); each record
 * `"RAW" w(1) 00000000 bytesPerRow(u16BE) h(1) key(1)` + bytesPerRow*h chunky 4bpp bytes + 1 trailing byte
 * (header says span = 12 + bpr*h + 1 for 32/32 non-empty records). `key` = 5 = the nibble that fills the
 * background (probably the transparent colour). Palette: not located yet -> greyscale.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson, writeManifest, dataManifestEntry, writePlatformIndex } from '../../shared/asset-paths.ts';
import { lzhufDecode } from './lzhuf.ts';

const GAME = 'bardstale3';
const PLATFORM = 'amiga';

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;

export interface Bt3Map {
  file: string;
  index: number;
  name: string;
  kind: 'grid' | 'dungeon';
  width?: number;
  height?: number;
  flags?: [number, number];
  grid?: number[];
  /** dungeon: [0x10] and [0x11] */
  sizeMinus1?: number;
  level?: number;
  raw: number[];
}

export function decodeMapFile(buf: Uint8Array, file: string): Bt3Map[] {
  const first = u32(buf, 0);
  const n = first / 4;
  const offs: number[] = [];
  for (let i = 0; i < n; i++) offs.push(u32(buf, i * 4));
  if (offs[n - 1] !== buf.length) throw new Error(`${file}: last directory entry ${offs[n - 1]} != file size ${buf.length}`);
  const out: Bt3Map[] = [];
  for (let i = 0; i < n - 1; i++) {
    const o = offs[i]!;
    const span = offs[i + 1]! - o;
    const size = u32(buf, o);
    const { data, consumed } = lzhufDecode(buf, o + 4, size);
    if (consumed !== span - 4 + 1) throw new Error(`${file}[${i}]: LZHUF consumed ${consumed}, expected ${span - 3}`);
    let name = '';
    for (let k = 0; k < 16 && data[k] !== 0xff; k++) name += String.fromCharCode(data[k]! & 0x7f);
    const w = data[16]!;
    const h = data[17]!;
    // grid family: row words step down by w
    const isGrid = w === h && w >= 11 && u16(data, 22) - u16(data, 24) === w && 0x14 + 2 * (h + 2) + w * h <= data.length;
    const base: Bt3Map = { file, index: i, name: name.trim(), kind: isGrid ? 'grid' : 'dungeon', raw: Array.from(data) };
    if (isGrid) {
      const g0 = 0x14 + 2 * (h + 2);
      Object.assign(base, { width: w, height: h, flags: [data[18]!, data[19]!], grid: Array.from(data.subarray(g0, g0 + w * h)) });
    } else {
      Object.assign(base, { sizeMinus1: w, level: h });
    }
    out.push(base);
  }
  return out;
}

export interface GrpRecord {
  w: number;
  h: number;
  bpr: number;
  key: number;
  /** palette indices (chunky 4bpp unpacked), w*h; empty for placeholder records */
  px: number[];
}

export function decodeGrp(buf: Uint8Array): GrpRecord[] {
  const first = buf[0]! | (buf[1]! << 8);
  const n = first / 2;
  const offs: number[] = [];
  for (let i = 0; i < n; i++) offs.push(buf[i * 2]! | (buf[i * 2 + 1]! << 8));
  const out: GrpRecord[] = [];
  for (let i = 0; i < n; i++) {
    const a = offs[i]!;
    const b = i + 1 < n ? offs[i + 1]! : buf.length;
    if (String.fromCharCode(buf[a]!, buf[a + 1]!, buf[a + 2]!) !== 'RAW') throw new Error(`grp record ${i}: no RAW magic`);
    const bpr = u16(buf, a + 8);
    const h = buf[a + 10]!;
    if (bpr === 0 || h === 0) {
      out.push({ w: 0, h: 0, bpr: 0, key: 0, px: [] });
      continue;
    }
    if (b - a !== 12 + bpr * h + 1) throw new Error(`grp record ${i}: span ${b - a} != 12+${bpr}*${h}+1`);
    const px: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < bpr; x++) {
        const v = buf[a + 12 + y * bpr + x]!;
        px.push(v >> 4, v & 15);
      }
    out.push({ w: bpr * 2, h, bpr, key: buf[a + 11]!, px });
  }
  return out;
}

export function exportBardsTale3Maps(dataDir: string): void {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const maps = [...decodeMapFile(rd('maps.hi'), 'maps.hi'), ...decodeMapFile(rd('maps.lo'), 'maps.lo')];
  const dir = assetDir('data', GAME, PLATFORM);
  mkdirSync(dir, { recursive: true });
  writeJson(resolve(dir, 'maps.json'), { maps }, false);
  const grp: Record<string, GrpRecord[]> = {};
  for (const f of ['D0WAL.GRP', 'GDUNG.GRP', 'SKARA.GRP', 'WILDWAL.GRP']) grp[f] = decodeGrp(rd(f));
  writeJson(resolve(dir, 'grp-wall-art.json'), grp, false);
  writeManifest([dataManifestEntry('maps', 'data/maps.json'), dataManifestEntry('grp-wall-art', 'data/grp-wall-art.json')], GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  const g = maps.filter((m) => m.kind === 'grid').length;
  console.log(`  bardstale3/amiga: ${maps.length} maps (${g} grid, ${maps.length - g} dungeon raw) + ${Object.values(grp).flat().filter((r) => r.px.length).length} GRP wall-art records`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale3Maps(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale3/data'));
}
