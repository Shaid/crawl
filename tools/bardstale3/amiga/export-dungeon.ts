/**
 * Bard's Tale III (Amiga): dungeon walker assets.
 *
 * Usage: npx tsx tools/bardstale3/amiga/export-dungeon.ts [dataDir]
 *
 * Reads the game program `bard3` (HUNK: CODE 0x1eb00 B at flat 0, DATA at flat 0x1eb00, BSS) and pulls every view /
 * move table out of its DATA hunk (addresses documented in dungeon.ts), the 61 dungeon records out of maps.lo/maps.hi
 * (map index -> file/record table at DATA 0x206ed; dungeon index d = map index - 10), and the wall pieces out of
 * GDUNG.GRP (the only wall file any shipped dungeon selects, see dungeon.ts).
 *
 * Writes public/assets/bardstale3/amiga/data/dungeon/{view.json,levels.json,level<d>.json}.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { lzhufDecode } from './lzhuf.ts';
import { parseLevel, type ViewTables, type Bt3Level } from './dungeon.ts';

const GAME = 'bardstale3';
const PLATFORM = 'amiga';

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const s8 = (v: number) => (v << 24) >> 24;

export interface Bard3Image {
  /** flat image: hunks laid out back to back (CODE 0, DATA, BSS), relocations NOT applied */
  flat: Uint8Array;
  bases: number[];
}

/** Minimal HUNK reader for bard3 (CODE/DATA/BSS + RELOC32 + END); relocations are not applied. */
export function readBard3(buf: Uint8Array): Bard3Image {
  if (u32(buf, 0) !== 0x3f3) throw new Error('bard3: not a HUNK executable');
  if (u32(buf, 4) !== 0) throw new Error('bard3: unexpected resident library names');
  const first = u32(buf, 12);
  const last = u32(buf, 16);
  const n = last - first + 1;
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push((u32(buf, 20 + 4 * i) & 0x3fffffff) * 4);
  const bases: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    bases.push(acc);
    acc += s;
  }
  const flat = new Uint8Array(acc);
  let p = 20 + 4 * n;
  let h = -1;
  while (p < buf.length) {
    const tag = u32(buf, p) & 0x3fffffff;
    p += 4;
    if (tag === 0x3e9 || tag === 0x3ea) {
      h++;
      const len = u32(buf, p) * 4;
      p += 4;
      flat.set(buf.subarray(p, p + len), bases[h]!);
      p += len;
    } else if (tag === 0x3eb) {
      h++;
      p += 4;
    } else if (tag === 0x3ec) {
      for (;;) {
        const c = u32(buf, p);
        p += 4;
        if (c === 0) break;
        p += 4 + 4 * c;
      }
    } else if (tag === 0x3f2) {
      continue;
    } else throw new Error(`bard3: unhandled hunk tag 0x${tag.toString(16)} at ${p - 4}`);
  }
  if (bases[1] !== 0x1eb00) throw new Error(`bard3: DATA hunk at 0x${bases[1]!.toString(16)}, expected 0x1eb00`);
  return { flat, bases };
}

export function readViewTables(img: Bard3Image): ViewTables {
  const f = img.flat;
  const bytes = (a: number, n: number) => Array.from(f.subarray(a, a + n));
  const sbytes = (a: number, n: number) => bytes(a, n).map(s8);
  const words = (a: number, n: number) => Array.from({ length: n }, (_, i) => u16(f, a + 2 * i));
  const cellOffsets: Array<Array<[number, number]>> = [];
  for (let d = 0; d < 4; d++) {
    // stored pointer is DATA-hunk-relative (RELOC32 against hunk 1)
    const ptr = u32(f, 0x20d62 + 4 * d) + img.bases[1]!;
    const row: Array<[number, number]> = [];
    for (let k = 0; k < 34; k++) row.push([s8(f[ptr + 2 * k]!), s8(f[ptr + 2 * k + 1]!)]);
    cellOffsets.push(row);
  }
  const xy = sbytes(0x20e7c, 122);
  const t: ViewTables = {
    cellOffsets,
    pieceOfNibble: bytes(0x20d72, 16),
    moveClass: bytes(0x20c32, 16),
    startSlot: bytes(0x20d82, 6),
    slotCell: bytes(0x20e02, 61),
    slotShift: bytes(0x20e3f, 61),
    slotEnable: bytes(0x20ef6, 61),
    slotX: xy.filter((_, i) => i % 2 === 0),
    slotY: xy.filter((_, i) => i % 2 === 1),
    slotW: sbytes(0x20b6a, 61),
    slotGrp: sbytes(0x20be4, 61),
    slotScale: sbytes(0x20ba7, 61),
    slotMirror: sbytes(0x20dc5, 61),
    portalWord: bytes(0x1f238, 4),
    darkOff: words(0x20fd6, 5),
    darkLen: words(0x20fe0, 5),
    palette: words(0x20868, 16),
  };
  // Self-checks: the player cell is view cell 23 at (0,0) for every facing; facing 0 looks +y.
  for (let d = 0; d < 4; d++) {
    const c = t.cellOffsets[d]![23]!;
    if (c[0] !== 0 || c[1] !== 0) throw new Error(`view table ${d}: cell 23 is not the party square`);
  }
  if (t.cellOffsets[0]![20]![1] !== 1) throw new Error('view table 0: cell 20 is not one square north');
  return t;
}

/** Map index -> [file, record] (DATA 0x206ed; file 1 = maps.lo, 2 = maps.hi; 71 maps). */
export function readMapTable(img: Bard3Image): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 71; i++) out.push([img.flat[0x206ed + 2 * i]!, img.flat[0x206ed + 2 * i + 1]!]);
  return out;
}

export function decodeMapRecords(buf: Uint8Array): Uint8Array[] {
  const n = u32(buf, 0) / 4;
  const out: Uint8Array[] = [];
  for (let i = 0; i < n - 1; i++) {
    const o = u32(buf, i * 4);
    out.push(lzhufDecode(buf, o + 4, u32(buf, o)).data);
  }
  return out;
}

export interface GrpEntry {
  bpr: number;
  h: number;
  data: number[];
}

/** GRP directory -> raw entries (13-byte "RAW" header, pixels at +13). */
export function readGrpEntries(buf: Uint8Array): Array<GrpEntry | null> {
  const n = (buf[0]! | (buf[1]! << 8)) / 2;
  const out: Array<GrpEntry | null> = [];
  for (let i = 0; i < n; i++) {
    const a = buf[2 * i]! | (buf[2 * i + 1]! << 8);
    const bpr = buf[a + 9]!;
    const h = buf[a + 10]!;
    if (!bpr || !h) {
      out.push(null);
      continue;
    }
    out.push({ bpr, h, data: Array.from(buf.subarray(a + 13, a + 13 + bpr * h)) });
  }
  return out;
}

export interface Bt3DungeonExport {
  tables: ViewTables;
  levels: Array<{ id: number; level: Bt3Level }>;
  entries: Array<GrpEntry | null>;
}

export function buildBardsTale3Dungeon(dataDir: string): Bt3DungeonExport {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(dataDir, n)));
  const img = readBard3(rd('bard3'));
  const tables = readViewTables(img);
  const files: Record<number, Uint8Array[]> = { 1: decodeMapRecords(rd('maps.lo')), 2: decodeMapRecords(rd('maps.hi')) };
  const map = readMapTable(img);
  const levels: Array<{ id: number; level: Bt3Level }> = [];
  for (let m = 10; m < map.length; m++) {
    const [file, rec] = map[m]!;
    const r = files[file]?.[rec];
    if (!r) throw new Error(`map ${m}: file ${file} record ${rec} missing`);
    const lv = parseLevel(r);
    if ((lv.flags >> 6) === 3) throw new Error(`dungeon ${m - 10} selects dung.tst, which is not shipped`);
    levels.push({ id: m - 10, level: lv });
  }
  return { tables, levels, entries: readGrpEntries(rd('GDUNG.GRP')) };
}

export function exportBardsTale3Dungeon(dataDir: string): void {
  const { tables, levels, entries } = buildBardsTale3Dungeon(dataDir);
  const dir = resolve(assetDir('data', GAME, PLATFORM), 'dungeon');
  mkdirSync(dir, { recursive: true });
  writeJson(resolve(dir, 'view.json'), { tables, entries }, false);
  for (const { id, level } of levels) writeJson(resolve(dir, `level${id}.json`), { id, ...level, cells: Array.from(level.cells) }, false);
  writeJson(
    resolve(dir, 'levels.json'),
    { levels: levels.map(({ id, level }) => ({ id, name: level.name, levelIndex: level.levelIndex, w: level.w, h: level.h, ox: level.ox, oy: level.oy })) },
    false,
  );
  console.log(`  bardstale3/amiga: ${levels.length} dungeon levels + GDUNG view art -> data/dungeon/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportBardsTale3Dungeon(resolve(process.argv[2] ?? 'data/_unexplored_/BardsTale3/data'));
}
