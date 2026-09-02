/**
 * Eye of the Beholder II (Amiga) `.MAZ` decoder -- confirmed byte-identical
 * to both EOB1 (any platform) and EOB2 DOS/VGA (6-byte header + 1024x4-byte
 * cell array). Spot-checked `LEVEL1.MAZ`: header `(32, 32, 4)`, file size
 * 4102 bytes exactly matching `6 + 32*32*4` -- same invariant already
 * confirmed for both sibling ports. Reuses `../decode-maze.ts` (itself a
 * re-export of EOB1's `../../eotb/decode-maze.ts`) directly.
 */
export { decodeMaze, cellIndex, wallTypeAt, SIDES, type Side, type MazeData } from '../decode-maze.ts';
