/**
 * Hired Guns (Amiga) map file (`Maps/NN.map`, RNC1-unpacked, 157,738 B) — browser-safe parser.
 *
 * Layout (all offsets in the unpacked file; struct shapes learned from the DMA CD32
 * dev archive `MapEditor/HGmapstructure.h` + `Location.dat` (542 B), sizes re-derived
 * here and checked against all 41 retail maps — the file is `struct locn` followed by
 * `struct map`, exactly what the editor `Read()`s / `Write()`s in `HGedit1.c`):
 *
 *   0x0000  struct locn (542 B): briefing legend/info text, then at +525
 *           disk, map_num, picture, music, atmos, mons1, mons2, sky, style; +534 4 x u16 destinations
 *   0x021E  struct map: +0 pred/succ/name[120], +128 pl1..pl4 x/y/z, exit x/y/z, time_limit,
 *           water levels; explosions, horizons, triggers, text, monsters[128] (16 B), buttons[32] (28 B),
 *           lifts, doors, pushables, texts[36]; then three cell planes, each wrapped in
 *           460-byte zero "safety nets" (5 rows x 23 cells x 4 B):
 *   0x6F3E  plane 1 (map_cell1)  20 x 23 x 23 u32 BE, index = z*529 + y*23 + x
 *   0x11826 plane 2 (map_cell2)  (+0xA8E8)
 *   0x1C10E plane 3 (map_cell3)  (+2*0xA8E8), ends 460 B before EOF
 *
 * > Correction (2026-11-21): the recon note put plane 1 at 0x6F40 — that is 2 bytes late,
 * > which is why it read solid rock as "byte 1 = 0x42". The long at 0x6F3E is 0x00000042 =
 * > opaque_bit | block_here_bit, block type 0 (stone).
 *
 * z (MAP_HEIGHT, 20) runs **upwards**: the renderer's "above" row is `+529` cells
 * (`north` table, retail exe file 0x188FC) and its bobs are the top of the view; z=0 is
 * bedrock, z=19 the closed cap. y (MAP_DEPTH) grows southwards, x (MAP_WIDTH) eastwards.
 */

export const MAP_W = 23;
export const MAP_D = 23;
export const MAP_H = 20;
export const LAYER = MAP_W * MAP_D; // 529
export const CELLS = LAYER * MAP_H; // 10,580
export const MAP_FILE_SIZE = 157_738;
export const LOCN_SIZE = 542;
export const PLANE1_OFFSET = 0x6f3e;
export const PLANE_STRIDE = 0xa8e8;

// map_cell1 bitfields (HGmapstructure.h `keep_*` masks/shifts; verified on the retail maps).
export const FLOOR_HERE = 0x1;
export const BLOCK_HERE = 0x2;
export const WATER_HERE = 0x4;
export const PANEL_HERE = 0x8;
export const EXPLOSION_HERE = 0x10;
export const AUX_HERE = 0x20;
export const OPAQUE = 0x40;
export const INVISIBLE = 0x80;
export const PUSHABLE = 0x100;
export const KEEP_FLOOR = 0x601;
export const KEEP_BLOCK = 0x1f802;
export const KEEP_WATER = 0x60004;

export const floorOf = (v: number): number => (v >>> 9) & 3;
export const blockOf = (v: number): number => (v >>> 11) & 63;
export const waterOf = (v: number): number => (v >>> 17) & 3;
export const panelOf = (v: number): number => (v >>> 19) & 3;
export const variantOf = (v: number): number => (v >>> 23) & 31;
export const auxOf = (v: number): number => (v >>> 28) & 15;

/** Block type numbers (Equates.i `block_addresses`, cross-checked against the retail Style banks). */
export const BLOCK = {
  STONE: 0, PUSH: 1, BOOST: 2, EXIT: 3, TREE: 4, FIELD: 5, TELEPORT: 6, HYDRAULIC: 7,
  MONSTER_FIRST: 8, MONSTER_LAST: 15, STAIRS_DOWN_FIRST: 16, STAIRS_DOWN_LAST: 19, DOOR_FRONT: 20, DOOR_SIDE: 21,
  PLAYER_FIRST: 32, PLAYER_LAST: 47,
} as const;

export interface HgPos { x: number; y: number; z: number }

export interface HgMap {
  num: number;
  /** locn_style: which `Styles/StyleNN.gfx` bank (0..4). */
  style: number;
  sky: number;
  mons: [number, number];
  name: string;
  title: string;
  players: HgPos[];
  exit: HgPos;
  timeLimit: number;
  /** Plane 1 (map_cell1), CELLS u32. */
  cells: Uint32Array;
  /** Plane 3 bits 24..27 (sky_north/east/south/west) per cell. */
  sky4: Uint8Array;
}

/** Index into a plane; -1 when outside the cube. */
export function cellIndex(x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= MAP_W || y >= MAP_D || z >= MAP_H) return -1;
  return z * LAYER + y * MAP_W + x;
}

function cstr(b: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = b[off + i]!;
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
  }
  return s.replace(/~+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The first `LOG ENTRY N. <title>.` line of the locn info text (map 01: "Artificial Island"). */
function titleFrom(b: Uint8Array): string {
  let text = '';
  for (let i = 0; i < LOCN_SIZE; i++) { const c = b[i]!; text += c >= 0x20 && c < 0x7f && c !== 0x7e ? String.fromCharCode(c) : ' '; }
  const m = /LOG ENTRY \d+\.\s*([^.~]+)\./.exec(text);
  return m ? m[1]!.trim() : '';
}

export function parseMap(buf: Uint8Array): HgMap {
  if (buf.length !== MAP_FILE_SIZE) throw new Error(`hiredguns map: ${buf.length} B, expected ${MAP_FILE_SIZE}`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cells = new Uint32Array(CELLS);
  for (let i = 0; i < CELLS; i++) cells[i] = dv.getUint32(PLANE1_OFFSET + 4 * i);
  const sky4 = new Uint8Array(CELLS);
  const p3 = PLANE1_OFFSET + 2 * PLANE_STRIDE;
  for (let i = 0; i < CELLS; i++) sky4[i] = (dv.getUint32(p3 + 4 * i) >>> 24) & 0xf;
  const M = LOCN_SIZE;
  const pl = (k: number): HgPos => ({ x: buf[M + 128 + 3 * k]!, y: buf[M + 129 + 3 * k]!, z: buf[M + 130 + 3 * k]! });
  return {
    num: buf[526]!,
    style: buf[533]!,
    sky: buf[532]!,
    mons: [buf[530]!, buf[531]!],
    name: cstr(buf, M + 8, 120),
    title: titleFrom(buf),
    players: [0, 1, 2, 3].map(pl),
    exit: pl(4),
    timeLimit: buf[M + 143]!,
    cells,
    sky4,
  };
}
