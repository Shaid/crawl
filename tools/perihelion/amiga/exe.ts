/**
 * Perihelion (Amiga): readers for the main program image `000316B00105D570` (Table.Dat record 1)
 * and the first-person dungeon data it carries. Spec: docs/perihelion/amiga/data-structure.md
 * "First-person dungeons (decoded 2026-11-21)".
 *
 * The main program is an absolute-load image (no HUNK header) loaded at $80000: the slave ends with
 * `JMP $80000`, and the image's `JMP $0B7454` lands on `MOVE.L #$B74D8,$80 / TRAP #0` (file +0x37454).
 * Every address below is a runtime address; file offset = address - $80000.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const LOAD_BASE = 0x80000;
export const MAIN_PROGRAM = '000316B00105D570';

export const dataDir = () => resolve('data', 'perihelion', 'amiga', 'PerihelionData');

/** File name of Table.Dat record `index` (8 bytes printed as 16 hex digits). */
export function tableFileNames(table: Uint8Array): string[] {
  if (String.fromCharCode(...table.subarray(0, 4)) !== 'PHLN') throw new Error('Table.Dat: no PHLN magic');
  const out: string[] = [];
  for (let i = 0; i < 99; i++) {
    out.push(Array.from(table.subarray(6 + 8 * i, 14 + 8 * i), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  return out;
}

export class MainProgram {
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  static load(dir = dataDir()): MainProgram {
    return new MainProgram(new Uint8Array(readFileSync(resolve(dir, MAIN_PROGRAM))));
  }
  off(addr: number): number {
    const o = addr - LOAD_BASE;
    if (o < 0 || o >= this.bytes.length) throw new Error(`address $${addr.toString(16)} outside the image`);
    return o;
  }
  u8(a: number) { return this.bytes[this.off(a)]!; }
  u16(a: number) { const o = this.off(a); return (this.bytes[o]! << 8) | this.bytes[o + 1]!; }
  s16(a: number) { const v = this.u16(a); return v >= 0x8000 ? v - 0x10000 : v; }
  u32(a: number) { return ((this.u16(a) << 16) >>> 0) + this.u16(a + 2); }
  slice(a: number, n: number) { const o = this.off(a); return this.bytes.subarray(o, o + n); }
}

/** In-game palette: 32 $0RGB words at $E7BDE, faded into the copper list's COLOR00-31 ($7D8DC)
 *  by `$B7344` when the game screen comes up (`$B768C`) and after every full-screen interlude
 *  (`$C0E74`). No other palette table is faded in while the dungeon view is up. */
export const PALETTE_ADDR = 0xe7bde;
export function readPalette(p: MainProgram): number[] {
  return Array.from({ length: 32 }, (_, i) => p.u16(PALETTE_ADDR + 2 * i));
}

/** Dungeon number `$F2C1E` (1..5) indexes these tables. */
export const DUNGEON_COUNT = 5;
/** `$BED5A`: per-dungeon Table.Dat indices of the view atlas (loaded to $25FB0), the music module
 *  (to $3CD50 for dungeon 1, else $39880) and the ambient 8SVX (to $44D58). */
export const ATLAS_FILE_TABLE = 0xbedd6;
export const MOD_FILE_TABLE = 0xbedea;
export const SAMPLE_FILE_TABLE = 0xbedfe;
/** `$BEE12`: start x ($F2C06), y ($F2C0A) and facing ($F2C0E) per dungeon. */
export const START_X = 0xbee48;
export const START_Y = 0xbee52;
export const START_FACING = 0xbee5c;
/** `$C4B22` copies one column of this table into the live struct at $C4C86: word 0 = map width
 *  ($C4C86, the `MULU` row stride of every map access), then 11 pointer lists of 5 longs; list 0
 *  ($C4C88) is the map grid, list 4 ($C4C98) the door-lock table that follows the grids. */
export const DUNGEON_TABLE = 0xc4b8c;

export interface DungeonInfo {
  index: number; // 1..5 = $F2C1E
  width: number;
  height: number;
  mapAddr: number;
  cells: number[];
  start: { x: number; y: number; facing: number };
  atlasFile: number; modFile: number; sampleFile: number;
}

export function readDungeons(p: MainProgram): DungeonInfo[] {
  const list = (k: number, i: number) => p.u32(DUNGEON_TABLE + 10 + 20 * k + 4 * i);
  const maps = Array.from({ length: DUNGEON_COUNT }, (_, i) => list(0, i));
  const out: DungeonInfo[] = [];
  for (let i = 0; i < DUNGEON_COUNT; i++) {
    const width = p.u16(DUNGEON_TABLE + 2 * i);
    // grids are stored back to back; the last one ends where the door-lock table of dungeon 1 starts
    const end = i + 1 < DUNGEON_COUNT ? maps[i + 1]! : list(4, 0);
    const bytes = end - maps[i]!;
    if (bytes <= 0 || bytes % width) throw new Error(`dungeon ${i + 1}: grid span ${bytes} not a multiple of width ${width}`);
    out.push({
      index: i + 1, width, height: bytes / width, mapAddr: maps[i]!,
      cells: Array.from(p.slice(maps[i]!, bytes)),
      start: { x: p.u16(START_X + 2 * i), y: p.u16(START_Y + 2 * i), facing: p.u16(START_FACING + 2 * i) },
      atlasFile: p.u32(ATLAS_FILE_TABLE + 4 * i), modFile: p.u32(MOD_FILE_TABLE + 4 * i), sampleFile: p.u32(SAMPLE_FILE_TABLE + 4 * i),
    });
  }
  return out;
}

/** Piece table (8 B: src x in bytes, src y, height, width in bytes) and destination table
 *  (4 B: signed dest x in bytes, dest y) of the two view composers ($C30EC / $C30F0 are set to
 *  these by `$C2A94` for dungeons 2-5 and by `$C2FA0` for dungeon 1). */
export const FAR_PIECES = 0xc45a4; export const FAR_PIECE_COUNT = 25;
export const FAR_DESTS = 0xc466c; export const FAR_DEST_COUNT = 26;
export const NEAR_PIECES = 0xc397e; export const NEAR_PIECE_COUNT = 19;
export const NEAR_DESTS = 0xc3a16; export const NEAR_DEST_COUNT = 5;

export interface Piece { sx: number; sy: number; w: number; h: number }
export interface Dest { dx: number; dy: number }

export function readPieces(p: MainProgram, addr: number, n: number): Piece[] {
  return Array.from({ length: n }, (_, i) => {
    const a = addr + 8 * i;
    return { sx: p.u16(a) * 8, sy: p.u16(a + 2), h: p.u16(a + 4), w: p.u16(a + 6) * 8 };
  });
}
export function readDests(p: MainProgram, addr: number, n: number): Dest[] {
  return Array.from({ length: n }, (_, i) => ({ dx: p.s16(addr + 4 * i) * 8, dy: p.u16(addr + 4 * i + 2) }));
}

/** The three piece blitters: `$C30F4` masked (colour 0 transparent, 352-px atlas, 220 B/row),
 *  `$C3244` opaque (352-px atlas) and `$C3332` opaque (416-px atlas, 260 B/row). All honour the
 *  mirror flag `$C3424` (draw right-to-left through the bit-reverse table at $C3428). */
export const BLIT_MASKED = 0xc30f4;
export const BLIT_OPAQUE_352 = 0xc3244;
export const BLIT_OPAQUE_416 = 0xc3332;

/** One blit: piece index ($C3420), dest index ($C3422), mirror ($C3424), masked or opaque. */
export type Blit = [piece: number, dest: number, mirror: number, masked: number];
/** A leaf routine's blits for parity `$C3426` = 0 and = 1. */
export interface Leaf { p0: Blit[]; p1: Blit[] }

/**
 * Decode one composer leaf routine. They are all built from the same five instructions:
 * `MOVE.W #imm,$C3420/$C3422/$C3424.L`, `CLR.W $C3424.L`, `TST.W $C3426.L` + `BNE.W` (the
 * checkerboard-parity alternative), `BSR.W` (a blitter or another leaf) and `RTS`/`BRA`.
 * Anything else throws, so an unexpected routine shape cannot be silently mis-read.
 */
export function decodeLeaf(p: MainProgram, addr: number, parity: number, depth = 0): Blit[] {
  if (depth > 4) throw new Error(`leaf $${addr.toString(16)}: nesting too deep`);
  const out: Blit[] = [];
  const st = { p: -1, d: -1, m: -1 };
  let a = addr;
  let lastTst = false;
  for (let guard = 0; guard < 64; guard++) {
    const op = p.u16(a);
    if (op === 0x33fc && p.u16(a + 4) === 0x000c && [0x3420, 0x3422, 0x3424].includes(p.u16(a + 6))) {
      const v = p.u16(a + 2), r = p.u16(a + 6);
      if (r === 0x3420) st.p = v; else if (r === 0x3422) st.d = v; else st.m = v;
      a += 8; lastTst = false; continue;
    }
    if (op === 0x4279 && p.u32(a + 2) === 0xc3424) { st.m = 0; a += 6; lastTst = false; continue; }
    if (op === 0x4a79 && p.u32(a + 2) === 0xc3426) { a += 6; lastTst = true; continue; }
    if (op === 0x6600 && lastTst) { a = parity ? a + 2 + p.s16(a + 2) : a + 4; lastTst = false; continue; }
    if (op === 0x6100) {
      const t = a + 2 + p.s16(a + 2);
      if (t === BLIT_MASKED || t === BLIT_OPAQUE_352 || t === BLIT_OPAQUE_416) {
        if (st.p < 0 || st.d < 0 || st.m < 0) throw new Error(`leaf $${addr.toString(16)}: blit before state is set`);
        out.push([st.p, st.d, st.m, t === BLIT_MASKED ? 1 : 0]);
      } else {
        out.push(...decodeLeaf(p, t, parity, depth + 1));
      }
      a += 4; lastTst = false; continue;
    }
    // A few leaves (the closed door one row ahead, $C3F3C..) also run a raw blitter copy that
    // saves the doorway behind the door ($1C9C0 -> $1763C) for the opening animation. Those
    // custom-chip writes ($DFF000-relative via A6) and the BTST/BNE blitter-busy wait don't draw
    // into the view, so they are stepped over — only these exact forms.
    if (op === 0x3d7c && p.u16(a + 4) < 0x200) { a += 6; lastTst = false; continue; }
    if (op === 0x2d7c && p.u16(a + 6) < 0x200) { a += 8; lastTst = false; continue; }
    if (op === 0x082e && p.u32(a + 2) === 0x00060002 && p.u32(a + 6) === 0x6600fff8) { a += 10; lastTst = false; continue; }
    if (op === 0x4e75) return out;
    if (op === 0x6000) { a = a + 2 + p.s16(a + 2); lastTst = false; continue; }
    if ((op & 0xff00) === 0x6000 && (op & 0xff) !== 0) { a = a + 2 + ((op & 0xff) << 24 >> 24); lastTst = false; continue; }
    throw new Error(`leaf $${addr.toString(16)}: unexpected opcode $${op.toString(16)} at $${a.toString(16)}`);
  }
  throw new Error(`leaf $${addr.toString(16)}: no RTS`);
}

/** Decode a row-interleaved 5-plane bitmap (each row = 5 plane rows of w/8 bytes) to indices. */
export function decodeInterleaved(src: Uint8Array, w: number, planes = 5): { w: number; h: number; px: Uint8Array } {
  const bpr = w >> 3;
  const h = Math.floor(src.length / (bpr * planes));
  if (h * bpr * planes !== src.length) throw new Error(`bitmap size ${src.length} is not a whole number of ${w}-px ${planes}-plane rows`);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let pl = 0; pl < planes; pl++) {
      const row = (y * planes + pl) * bpr;
      for (let x = 0; x < w; x++) if (src[row + (x >> 3)]! & (0x80 >> (x & 7))) px[y * w + x] = px[y * w + x]! | (1 << pl);
    }
  }
  return { w, h, px };
}
