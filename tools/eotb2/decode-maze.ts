/**
 * Eye of the Beholder II (DOS/VGA) `.MAZ` decoder -- `docs/eotb2/dosvga/
 * data-structure.md` § "MAZ -- Dungeon level grids": "Confirmed,
 * byte-identical to EOB1 (6-byte header + 1024x4-byte cell array)". Reuses
 * `tools/eotb/decode-maze.ts` directly rather than duplicating a
 * byte-identical format.
 */
export { decodeMaze, cellIndex, wallTypeAt, SIDES, type Side, type MazeData } from '../eotb/decode-maze.ts';
