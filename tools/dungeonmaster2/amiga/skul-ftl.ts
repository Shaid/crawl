/**
 * Dungeon Master II (Amiga) `SKUL.FTL` reader: the game's main 68k module.
 *
 * Original code. Layout established by reading the file and the module's
 * own start-up routine (CODE+0x44 `ZERO`/`DATA`/`DREL` init, CODE+0x80 relocation):
 *
 *   0x00  u16 0x6160 (BSR.S), ... header; u16 @0x12 = section count (3)
 *   0x14  3 x 12-byte section entries {u16 id, u16 ?, u32 fileOffset, u32 size}:
 *         0x10 = jump-table header (Mac `CODE 0` shape: above-A5 size, below-A5
 *                size, jump-table size, jump-table A5 offset, ...) followed at
 *                +0x28 by one u32 CODE offset per jump-table entry (648);
 *         0x11 = initialised data: `u16 1, u32 dataLen, u32 drelLen`, then the
 *                DATA stream (words copied verbatim; a zero word is followed by a
 *                u16 count of extra zero bytes) which expands to exactly the
 *                below-A5 size, then `drelLen` bytes of u16 A5-relative offsets of
 *                longwords that get A5 added (740 entries in SKUL.FTL);
 *         0x12 = CODE (calls go through the A5 jump table: entry k's JMP sits at
 *                A5 + 0x22 + 8k).
 *
 * The viewport tables below live in that initialised data (A5-relative,
 * negative offsets) and were located from the code that reads them:
 * DRAW_WALL-equivalent at CODE+0x17e4a (reads -0x462a/-0x4612/-0x45fa, adds
 * 0x22 to the cell for the wall piece and 0x2be for its rect), the tile loop
 * that walks -0x4086, and the flip-parity routine at CODE+0x187d0.
 */

export interface FtlSection { id: number; offset: number; size: number }

export interface SkulImage {
  sections: FtlSection[];
  /** Bytes below A5 (index 0 = A5 - belowA5). */
  below: Uint8Array;
  belowA5: number;
  aboveA5: number;
  /** CODE offsets of the jump-table entries. */
  jumpTable: number[];
  code: Uint8Array;
}

const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;

export function parseSkulFtl(file: Uint8Array): SkulImage {
  const n = u16(file, 0x12);
  const sections: FtlSection[] = [];
  for (let i = 0; i < n; i++) {
    const o = 0x14 + i * 12;
    sections.push({ id: u16(file, o), offset: u32(file, o + 4), size: u32(file, o + 8) });
  }
  const sec = (id: number) => {
    const s = sections.find((x) => x.id === id);
    if (!s) throw new Error(`SKUL.FTL: section 0x${id.toString(16)} missing`);
    return file.subarray(s.offset, s.offset + s.size);
  };
  const hdr = sec(0x10);
  const aboveA5 = u32(hdr, 0);
  const belowA5 = u32(hdr, 4);
  const jtSize = u32(hdr, 8);
  const jumpTable: number[] = [];
  for (let k = 0; k < jtSize / 8; k++) jumpTable.push(u32(hdr, 0x28 + k * 4));

  const d = sec(0x11);
  const dataLen = u32(d, 2);
  const drelLen = u32(d, 6);
  if (10 + dataLen + drelLen !== d.length) throw new Error('SKUL.FTL: data section does not tile');
  const below = new Uint8Array(belowA5);
  let src = 10;
  let dst = 0;
  while (src < 10 + dataLen) {
    const w = u16(d, src);
    below[dst] = d[src]!; below[dst + 1] = d[src + 1]!;
    src += 2; dst += 2;
    if (w === 0) { dst += u16(d, src); src += 2; }
  }
  if (dst !== belowA5) throw new Error(`SKUL.FTL: DATA expands to ${dst}, expected ${belowA5}`);
  return { sections, below, belowA5, aboveA5, jumpTable, code: sec(0x12) };
}

/** Read `n` bytes at A5-relative offset `off` (negative) from the initialised data. */
export function a5Bytes(img: SkulImage, off: number, n: number): Uint8Array {
  const i = img.belowA5 + off;
  if (i < 0 || i + n > img.belowA5) throw new Error(`A5${off}: outside initialised data`);
  return img.below.subarray(i, i + n);
}

export interface ViewportTables {
  /** Per viewport cell (23): lateral distance (-left/+right) and forward distance. */
  xDist: number[];
  yDist: number[];
  /** Per cell: the mirror-partner cell used when the scene is drawn flipped. */
  flipPartner: number[];
  /** Per cell: wall-ornament placement class (0 none, 1 front, 2 side, 3 both). */
  ornateClass: number[];
  /** The 20 cells in far-to-near draw order. */
  drawOrder: number[];
  /** Per cell 0-15: is a door panel drawn when the door faces the party (DRAW_DOOR_TILE gate). */
  doorVisible: number[];
  /** Per cell 0-15: rect id of a closed door panel (-1 none); +state for half-open states. */
  doorRect: number[];
}

/** A5 offsets of the viewport tables (Amiga SKUL.FTL). */
export const VIEWPORT_TABLE_A5 = {
  xDist: -0x462a, // CODE+0x17e64 move.b -0x462a(a0),d5
  yDist: -0x4612, // CODE+0x17e6e move.b -0x4612(a0),d3
  flipPartner: -0x45fa, // CODE+0x17f3a add.b -0x45fa(a0),d4
  ornateClass: -0x409e, // CODE+0x17fba move.b -0x409e(a5,d7.w),d0
  drawOrder: -0x4086, // CODE+0x1801c move.b -0x4086(a5,d5.w),d4 (tile loop)
  doorVisible: -0x4164, // CODE+0x17c5c tst.b -0x4164(a5,d7.w) (door tile)
  doorRect: -0x4184, // CODE+0x17958 move.w -0x4184(a5,d0.w*2),d0 (door panel)
} as const;

export function readViewportTables(img: SkulImage): ViewportTables {
  const s8 = (b: Uint8Array) => Array.from(b, (v) => (v > 127 ? v - 256 : v));
  const s16 = (b: Uint8Array) => Array.from({ length: b.length >> 1 }, (_, i) => { const v = (b[i * 2]! << 8) | b[i * 2 + 1]!; return v >= 0x8000 ? v - 0x10000 : v; });
  return {
    xDist: s8(a5Bytes(img, VIEWPORT_TABLE_A5.xDist, 23)),
    yDist: s8(a5Bytes(img, VIEWPORT_TABLE_A5.yDist, 23)),
    flipPartner: Array.from(a5Bytes(img, VIEWPORT_TABLE_A5.flipPartner, 23)),
    ornateClass: Array.from(a5Bytes(img, VIEWPORT_TABLE_A5.ornateClass, 23)),
    drawOrder: Array.from(a5Bytes(img, VIEWPORT_TABLE_A5.drawOrder, 20)),
    doorVisible: Array.from(a5Bytes(img, VIEWPORT_TABLE_A5.doorVisible, 16)),
    doorRect: s16(a5Bytes(img, VIEWPORT_TABLE_A5.doorRect, 32)),
  };
}
