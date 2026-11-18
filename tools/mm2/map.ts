/**
 * MM2 `map.dat` codec — 60 map screens × 512 bytes = 30720 bytes.
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/21-map-dat-format.md`).
 * Each screen is two 256-byte pages covering a 16×16 grid, loaded flat at
 * runtime `A4-$EEF4`.
 *
 *   Page 0 (visual, +0x000): four 2-bit wall fields per cell, N/E/S/W:
 *       `0` open, `1` wall, `2` door, `3` wall+torch.
 *       (Correction: earlier text said 2=torch, 3=door — wrong. Vairn's own
 *       ASM-traced walkers treat 2 as door and 3 as torch, and the collision
 *       page agrees: code-2 faces are passable doorways, code-3 faces sit on
 *       blocked walls.)
 *       W = byte&3, S = (byte>>2)&3, E = (byte>>4)&3, N = (byte>>6)&3.
 *   Page 1 (collision, +0x100): wall bits `0x55 & dirmask` (W 0x01, S 0x04,
 *       E 0x10, N 0x40); 0x20 = cell-level DARK flag; 0x80 = special/event
 *       cell (every event.dat triplet sits on one); 0x02 / 0x08 unidentified.
 *
 *   > **Correction (2026-11-13 audit):** the N,E,S,W order above used to be
 *   > documented the other way round (N = byte&3 ... W = byte>>6) and the
 *   > collision "dark<<1" per-direction reading was wrong. Neighbouring-cell
 *   > wall symmetry scores 100% (MM2 indoor) / 99.9% (MM1) with the W,S,E,N
 *   > order vs ~30-37% with the old one; ScummVM MM1 `DIRMASK_N=0xC0, E=0x30,
 *   > S=0x0C, W=0x03` and Vairn's own decomp (`mm2_map_facing_shift`: N=6)
 *   > agree. The engines read raw bytes, so rendering/movement were never
 *   > affected — only field names and `dark`.
 *
 * Row 0 on disk = south. Auto-map draws north-up (disk row 15 → screen row 0).
 */

export const MAP_SCREENS = 60;
export const MAP_SCREEN_SIZE = 512;
export const MAP_GRID = 16;
export const MAP_FILE_SIZE = MAP_SCREENS * MAP_SCREEN_SIZE;

export interface MapCell {
  /** Page-0 wall codes (0 open, 1 wall, 2 door, 3 wall+torch). */
  visual: { n: number; e: number; s: number; w: number };
  /** Page-1 collision fields: w/s/e = raw 2-bit fields (bit0 = wall, bit1
   * unidentified; e's high bit is the 0x20 dark flag), n = wall bit 0x40 only. */
  collision: { n: number; e: number; s: number; w: number };
  /** Collision bit 0x20: cell-level dark flag (ScummVM `CELL_DARK`). Derived;
   * already included in `collision.e`, so encoding ignores it. */
  dark: boolean;
  /** True when collision byte bit 0x80 is set (event trigger). */
  event: boolean;
}

export interface MapScreen {
  index: number;
  /** row-major [row][col]; row 0 is the south edge on disk. */
  cells: MapCell[][];
}

export function decodeMapCell(visualByte: number, collisionByte: number): MapCell {
  return {
    visual: {
      w: visualByte & 3,
      s: (visualByte >> 2) & 3,
      e: (visualByte >> 4) & 3,
      n: (visualByte >> 6) & 3,
    },
    collision: {
      w: collisionByte & 3,
      s: (collisionByte >> 2) & 3,
      e: (collisionByte >> 4) & 3,
      n: collisionByte & 0x40 ? 1 : 0,
    },
    dark: (collisionByte & 0x20) !== 0,
    event: (collisionByte & 0x80) !== 0,
  };
}

export function decodeMap(data: Uint8Array): MapScreen[] {
  if (data.length !== MAP_FILE_SIZE) {
    throw new Error(`map.dat: expected ${MAP_FILE_SIZE} bytes, got ${data.length}`);
  }
  const screens: MapScreen[] = [];
  for (let s = 0; s < MAP_SCREENS; s++) {
    const base = s * MAP_SCREEN_SIZE;
    const page0 = data.subarray(base, base + 256);
    const page1 = data.subarray(base + 256, base + 512);
    const cells: MapCell[][] = [];
    for (let row = 0; row < MAP_GRID; row++) {
      const cellRow: MapCell[] = [];
      for (let col = 0; col < MAP_GRID; col++) {
        cellRow.push(decodeMapCell(page0[row * MAP_GRID + col], page1[row * MAP_GRID + col]));
      }
      cells.push(cellRow);
    }
    screens.push({ index: s, cells });
  }
  return screens;
}

export function encodeMapCell(cell: MapCell): [number, number] {
  const visual =
    (cell.visual.w & 3) |
    ((cell.visual.s & 3) << 2) |
    ((cell.visual.e & 3) << 4) |
    ((cell.visual.n & 3) << 6);
  let collision =
    (cell.collision.w & 3) |
    ((cell.collision.s & 3) << 2) |
    ((cell.collision.e & 3) << 4) |
    (cell.collision.n !== 0 ? 0x40 : 0);
  if (cell.event) collision |= 0x80;
  return [visual, collision];
}

export function encodeMap(screens: MapScreen[]): Uint8Array {
  const out = new Uint8Array(MAP_FILE_SIZE);
  for (const s of screens) {
    const base = s.index * MAP_SCREEN_SIZE;
    for (let row = 0; row < MAP_GRID; row++) {
      for (let col = 0; col < MAP_GRID; col++) {
        const [v, c] = encodeMapCell(s.cells[row][col]);
        out[base + row * MAP_GRID + col] = v;
        out[base + 256 + row * MAP_GRID + col] = c;
      }
    }
  }
  return out;
}
