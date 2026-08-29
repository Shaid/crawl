/**
 * Eye of the Beholder (Amiga) `.MAZ` decoder -- `docs/eotb/amiga/
 * data-structure.md` § "MAZ -- Maze Layout". Empirically confirmed
 * against the real corpus this session: every `data/eotb/amiga/LEVEL*.MAZ`
 * is exactly 4102 bytes = 6-byte header (width, height, tileSize, all LE
 * u16) + 1024 cells x 4 sides x 1 byte. The per-side byte is a raw
 * `wallIndex` (0-255), **not** a direct 0-6 VMP wallType -- most of the
 * corpus is clean 0/1/2 (which happen to equal their own default
 * wallType), but many cells carry much larger `wallIndex` values (e.g.
 * 58, 62, ... in `LEVEL1.MAZ`). The real `wallIndex -> wallType`
 * (`vmpIndex`) mapping is a per-level table: `EoBCoreEngine::
 * resetWallData`'s default (`{1:1, 2:2, 3..22:3, 23:4, 24:5}`, else 0)
 * overridden by that level's `.INF` wall-mapping records -- see
 * `docs/eotb/amiga/data-structure.md` § "INF -- Level Configuration" for
 * the full citations, and `decode-inf.ts`'s `buildWallTypeMap` for the
 * implementation. `wallTypeAt` below returns the **raw** byte; callers
 * needing the real render wallType must pass it through a level's
 * `wallTypeMap` (`view-model.ts`'s `resolveWallTypes` does this). Door
 * open/closed state, decorations and events live in the companion `.INF`
 * file's event-script/decoration data, out of scope for this pass, see
 * `docs/eotb/TODO.md`.
 */
export type Side = 'N' | 'E' | 'S' | 'W';
export const SIDES: Side[] = ['N', 'E', 'S', 'W'];

export interface MazeData {
  width: number;
  height: number;
  /** [cellIndex][side index 0=N,1=E,2=S,3=W] -> raw `wallIndex` (0-255; map through a level's `wallTypeMap` for the real 0-6 render wallType -- see module doc). */
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

/** Raw `wallIndex` byte (0-255, not a direct 0-6 wallType -- see module doc) for a cell's absolute side, or 1 out of bounds. */
export function wallTypeAt(maze: MazeData, x: number, y: number, side: Side): number {
  const idx = cellIndex(maze, x, y);
  if (idx === null) return 1; // out of the 32x32 grid: treat as solid wall
  return maze.cells[idx]![SIDES.indexOf(side)]!;
}
