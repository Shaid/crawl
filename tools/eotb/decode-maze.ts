/**
 * Eye of the Beholder (Amiga) `.MAZ` decoder -- `docs/eotb/amiga/
 * data-structure.md` § "MAZ -- Maze Layout". Empirically confirmed
 * against the real corpus this session: every `data/eotb/amiga/LEVEL*.MAZ`
 * is exactly 4102 bytes = 6-byte header (width, height, tileSize, all LE
 * u16) + 1024 cells x 4 sides x 1 byte. The per-side byte is the
 * `S_TILESIDE` "number of wall graphics" field (`docs/eotb/amiga/
 * eotb-maze-spec.md`): 0=none, 1=solid wall type 1, 2=solid wall type 2,
 * 3=doorway, 4=stairs up, 5=stairs down, 6=magic doorway -- i.e. this
 * byte IS the VMP wallType index directly (0-6), one byte per side, not
 * the fuller 4-field `S_TILESIDE` struct the DOS-era ModdingWiki spec
 * describes (decoration count / event index / passability bits aren't
 * present in this file at all -- door open/closed state, decorations and
 * events live in the companion `.INF` file's event-script/decoration
 * data, out of scope for this pass, see `docs/eotb/TODO.md`).
 */
export type Side = 'N' | 'E' | 'S' | 'W';
export const SIDES: Side[] = ['N', 'E', 'S', 'W'];

export interface MazeData {
  width: number;
  height: number;
  /** [cellIndex][side index 0=N,1=E,2=S,3=W] -> wallType 0-6. */
  cells: Uint8Array[];
}

export function decodeMaze(data: Uint8Array): MazeData {
  const width = data[0]! | (data[1]! << 8);
  const height = data[2]! | (data[3]! << 8);
  const tileSize = data[4]! | (data[5]! << 8);
  if (width !== 32 || height !== 32 || tileSize !== 4) {
    throw new Error(`decodeMaze: oracle check failed -- expected 32x32/tileSize=4, got ${width}x${height}/tileSize=${tileSize}`);
  }
  const cellCount = width * height;
  const expectedSize = 6 + cellCount * 4;
  if (data.length !== expectedSize) {
    throw new Error(`decodeMaze: oracle check failed -- expected ${expectedSize} bytes, got ${data.length}`);
  }

  const cells: Uint8Array[] = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push(data.subarray(6 + i * 4, 6 + i * 4 + 4));
  }
  return { width, height, cells };
}

export function cellIndex(maze: MazeData, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return y * maze.width + x;
}

/** Wall-type byte (0-6) for a cell's absolute side, or 1 (solid wall) out of bounds. */
export function wallTypeAt(maze: MazeData, x: number, y: number, side: Side): number {
  const idx = cellIndex(maze, x, y);
  if (idx === null) return 1; // out of the 32x32 grid: treat as solid wall
  return maze.cells[idx]![SIDES.indexOf(side)]!;
}
