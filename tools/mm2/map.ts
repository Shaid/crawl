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
 *       N = byte&3, E = (byte>>2)&3, S = (byte>>4)&3, W = (byte>>6)&3.
 *   Page 1 (collision, +0x100): per direction `(dark<<1)|wall`; the low bit
 *       is the wall, the high bit darkness. West's dark slot is reused:
 *       bit 0x80 is the event flag (every event.dat triplet sits on a
 *       collision cell with 0x80 set).
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
  /** Page-1 collision: wall low bit, dark high bit (north/east/south/west). */
  collision: { n: number; e: number; s: number; w: number };
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
      n: visualByte & 3,
      e: (visualByte >> 2) & 3,
      s: (visualByte >> 4) & 3,
      w: (visualByte >> 6) & 3,
    },
    collision: {
      n: collisionByte & 3,
      e: (collisionByte >> 2) & 3,
      s: (collisionByte >> 4) & 3,
      w: collisionByte & 0x40 ? 1 : 0,
    },
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
    (cell.visual.n & 3) |
    ((cell.visual.e & 3) << 2) |
    ((cell.visual.s & 3) << 4) |
    ((cell.visual.w & 3) << 6);
  let collision =
    (cell.collision.n & 3) |
    ((cell.collision.e & 3) << 2) |
    ((cell.collision.s & 3) << 4) |
    (cell.collision.w !== 0 ? 0x40 : 0);
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
