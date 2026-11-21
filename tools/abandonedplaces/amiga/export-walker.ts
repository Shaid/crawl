/**
 * Abandoned Places 1 (Amiga): walker data. Emits to public/assets/abandonedplaces/amiga/walker/:
 *   tables.json       view tables read from the unpacked `module` (HUNK offsets = file offset - 0x20)
 *   levels.json       36 dungeon levels (dungeon1/2/3 x 12): grid, 4 theme areas, teleports, doors, start pose
 *   module/<N>.json   the 25 wall pieces of `moduleN` (indexed 0-15, 255 = transparent)
 *   backgnd/<N>.json  the two 144x96 ceiling/floor backdrops of `backgndN`
 *   npx tsx tools/abandonedplaces/amiga/export-walker.ts
 * Spec: docs/abandonedplaces/amiga/data-structure.md section 7 (renderer).
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetRoot, writeJson } from '../../shared/asset-paths.ts';
import { unpackAll } from '../unpack.ts';

const GAME = 'abandonedplaces';
const PLATFORM = 'amiga';
const HUNK_CODE = 0x20; // file offset of hunk 0 data in `module`

export const LEVEL_BYTES = 0x2aa4;
/** Record sizes of the ten object lists after the 0x800+0x100 header (loader 0x10d76). */
export const LIST_SIZES = [0xa, 0xe, 0xc, 0xc, 0xa, 0x10, 0xa, 0x40, 0x20, 0x14];

export interface PieceGeom { w: number; h: number; x: number; y: number; off: number }

export function readTables(module: Uint8Array) {
  const code = module.subarray(HUNK_CODE);
  const dv = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const s8 = (a: number, n: number) => Array.from(code.subarray(a, a + n), (v) => (v > 127 ? v - 256 : v));
  const u8 = (a: number, n: number) => Array.from(code.subarray(a, a + n));
  const u16 = (a: number, n: number) => Array.from({ length: n }, (_, i) => dv.getUint16(a + i * 2));
  const NPIECE = 25;
  const pieces: PieceGeom[] = Array.from({ length: NPIECE }, (_, i) => ({
    w: dv.getUint16(0xd5de + i * 4), h: dv.getUint16(0xd5de + i * 4 + 2),
    x: dv.getUint16(0xd642 + i * 4), y: dv.getUint16(0xd642 + i * 4 + 2) + 4, // draw adds 4 to y (0xd5d4)
    off: dv.getUint32(0xd6a6 + i * 4),
  }));
  // view offset tables: 4 facings, pointer table at 0xaf54, 18 (dx,dy) signed-byte pairs each
  const viewOffsets = Array.from({ length: 4 }, (_, f) => s8(dv.getUint32(0xaf54 + f * 4), 36));
  // draw list at 0xaff4: 41 entries of 2 bytes; byte0 >= 0x80 -> object group (not a wall piece)
  const list: { piece: number; cell: number }[] = [];
  for (let i = 0; i < 41; i++) {
    const b0 = code[0xaff4 + i * 2], b1 = code[0xaff4 + i * 2 + 1];
    if (b0 & 0x80) continue;
    list.push({ piece: b0, cell: b1 });
  }
  const fade = u16(0xdbe4, 256); // 16 colours x 16 fade steps; step 15 = full palette
  const palette = Array.from({ length: 16 }, (_, c) => fade[c * 16 + 15]);
  return { pieces, viewOffsets, drawList: list, backdropParity: u8(0xde96, 16), palette };
}

function b64(a: Uint8Array): string { return Buffer.from(a).toString('base64'); }

/** One piece = 4 colour planes then 1 mask plane, each w*h bytes (blitter 0xd740: A=mask, B=src). */
export function decodePieces(buf: Uint8Array, geom: PieceGeom[]): Uint8Array[] {
  return geom.map((g) => {
    const pw = g.w * 8, sz = g.w * g.h;
    const out = new Uint8Array(pw * g.h);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < pw; x++) {
      const bi = y * g.w + (x >> 3), bit = 0x80 >> (x & 7);
      const mask = buf[g.off + 4 * sz + bi] & bit;
      let c = 0;
      for (let p = 0; p < 4; p++) if (buf[g.off + p * sz + bi] & bit) c |= 1 << p;
      out[y * pw + x] = mask ? c : 255;
    }
    return out;
  });
}

/** backgndN: two 144x96 4-plane images (6912 B each), plane stride 1728 (blit 0xdde4). */
export function decodeBackdrops(buf: Uint8Array): Uint8Array[] {
  return [0, 1].map((half) => {
    const out = new Uint8Array(144 * 96);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 144; x++) {
      const bi = half * 6912 + y * 18 + (x >> 3), bit = 0x80 >> (x & 7);
      let c = 0;
      for (let p = 0; p < 4; p++) if (buf[bi + p * 1728] & bit) c |= 1 << p;
      out[y * 144 + x] = c;
    }
    return out;
  });
}

export interface Teleport { type: number; x: number; y: number; dx: number; dy: number; facing: number; area: number; level: number }

export function parseLevel(rec: Uint8Array) {
  const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const grid = Array.from({ length: 1024 }, (_, i) => dv.getUint16(i * 2));
  const areas = Array.from({ length: 4 }, (_, a) => Array.from({ length: 17 }, (_, k) => dv.getUint16(0x800 + a * 0x40 + k * 2)));
  let p = 0x900;
  const lists: number[][][] = [];
  for (const s of LIST_SIZES) {
    const L: number[][] = [];
    while (dv.getInt16(p) >= 0) { L.push(Array.from({ length: s / 2 }, (_, k) => dv.getUint16(p + k * 2))); p += s; }
    p += 2;
    lists.push(L);
  }
  const teleports: Teleport[] = lists[7].filter((r) => (r[0] === 5 || r[0] === 6) && (r[1] | r[2]) !== 0)
    .map((r) => ({ type: r[0], x: r[1], y: r[2], dx: r[4], dy: r[5], facing: r[6], area: r[7], level: r[8] > 0x7fff ? r[8] - 0x10000 : r[8] }));
  const doors = lists[6].filter((r) => r[0] !== 0).map((r) => ({ type: r[0], x: r[1], y: r[2], orient: r[3], state: r[4] & 7 }));
  return { grid, areas, teleports, doors, end: p, counts: lists.map((l) => l.length) };
}

export function exportWalker(): { levels: number; modules: number; backdrops: number } {
  const { dir: cache } = unpackAll(GAME);
  const root = resolve(assetRoot(GAME, PLATFORM), 'walker');
  mkdirSync(resolve(root, 'module'), { recursive: true });
  mkdirSync(resolve(root, 'backgnd'), { recursive: true });
  const tables = readTables(new Uint8Array(readFileSync(resolve(cache, 'module'))));
  writeJson(resolve(root, 'tables.json'), tables, false);

  const levels: unknown[] = [];
  const parsed: ReturnType<typeof parseLevel>[] = [];
  for (let f = 1; f <= 3; f++) {
    const d = new Uint8Array(readFileSync(resolve(cache, `dungeon${f}`)));
    for (let n = 0; n < 12; n++) parsed.push(parseLevel(d.subarray(n * LEVEL_BYTES, (n + 1) * LEVEL_BYTES)));
  }
  parsed.forEach((p, id) => {
    const f = Math.floor(id / 12), n = id % 12;
    if (p.end !== LEVEL_BYTES) throw new Error(`level ${id}: list walk ends at ${p.end}, expected ${LEVEL_BYTES}`);
    // Start pose: the dungeon entrance record (level -1) carries the arrival cell; other levels arrive
    // through a teleport whose destination level (1-based, same file) is this one.
    let start: { x: number; y: number; facing: number; area: number } | null = null;
    const exit = p.teleports.find((t) => t.level === -1 && (t.dx | t.dy) !== 0);
    if (exit) start = { x: exit.dx, y: exit.dy, facing: exit.facing, area: exit.area };
    if (!start) {
      for (let o = 0; o < 12 && !start; o++) {
        // one shipped record (dungeon1 level 6 -> 5) lands on a wall; skip destinations that are not open cells
        const t = parsed[f * 12 + o].teleports.find((t) => t.level === n + 1 && (p.grid[t.dy * 32 + t.dx] & 1) === 0);
        if (t) start = { x: t.dx, y: t.dy, facing: t.facing === 4 ? 0 : t.facing, area: t.area };
      }
    }
    if (!start) {
      const i = p.grid.findIndex((v) => (v & 1) === 0);
      start = { x: i % 32, y: Math.floor(i / 32), facing: 0, area: 0 };
    }
    levels.push({ id, file: `dungeon${f + 1}`, index: n, label: `Dungeon ${f + 1}, level ${n + 1}`, grid: p.grid, areas: p.areas, teleports: p.teleports, doors: p.doors, start });
  });
  writeJson(resolve(root, 'levels.json'), levels, false);

  let modules = 0, backdrops = 0;
  for (let n = 1; n <= 11; n++) {
    const m = resolve(cache, `module${n}`), b = resolve(cache, `backgnd${n}`);
    if (existsSync(m)) {
      const pcs = decodePieces(new Uint8Array(readFileSync(m)), tables.pieces);
      writeJson(resolve(root, 'module', `${n}.json`), { pieces: pcs.map(b64) }, false);
      modules++;
    }
    if (existsSync(b)) {
      writeJson(resolve(root, 'backgnd', `${n}.json`), { halves: decodeBackdrops(new Uint8Array(readFileSync(b))).map(b64) }, false);
      backdrops++;
    }
  }
  return { levels: levels.length, modules, backdrops };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportWalker();
  console.log(`${GAME}/${PLATFORM} walker: ${r.levels} levels, ${r.modules} modules, ${r.backdrops} backdrops`);
}
