/**
 * Lands of Lore `.CMZ` level-grid decoder. Confirmed
 * (`docs/landsoflore/dosvga/data-structure.md` § "CMZ -- Level grid",
 * re-verified this session against the real `LEVEL1.CMZ`): once unwrapped
 * from its Kyra-bitmap/LCW container (`decodeKyraBitmap`), the payload is
 * byte-identical to EOB's raw `.MAZ` format -- same 6-byte header
 * (width/height/tileSize) + `cellCount*4` per-side bytes -- so this reuses
 * `tools/eotb/decode-maze.ts`'s parser directly rather than duplicating it.
 *
 * **Per-side byte values -- resolved this session, see `decode-wll.ts`.**
 * A census of the real `LEVEL1.CMZ` found ~98.7% of cells are clean small
 * values (0=open, 1-3=solid/door), but the rest carry much larger values
 * (8, 53-79 seen). This is NOT the same open gap as EOB1's unresolved
 * `wallMappingIndex` -- LOL's `.WLL` table (`decode-wll.ts`) turned out to
 * be a **sparse** `rawByte -> vmpMapValue` dictionary (keyed by the byte
 * value itself, not a dense 0-51 positional array as `docs/landsoflore/
 * dosvga/data-structure.md`'s "sequential in practice" reading assumed),
 * and empirically its 52 keys for `LEVEL1` exactly cover every raw byte
 * value the level's own `.CMZ` actually uses (0-26 plus the observed
 * 53-79 cluster, zero misses). `view-model.ts`'s `resolveRawWallType`
 * consumes this directly; the old EOB-style clamp is now only a fallback
 * for a raw byte absent from a level's own WLL table (not observed in
 * this corpus, but kept as a safety net rather than a hard throw).
 */
import { decodeKyraBitmap } from './kyra-bitmap.ts';
import { decodeMaze as decodeMazeRaw, cellIndex, wallTypeAt, type MazeData, type Side, SIDES } from '../eotb/decode-maze.ts';

export { cellIndex, wallTypeAt, type MazeData, type Side, SIDES };

export function decodeCmz(data: Uint8Array): MazeData {
  return decodeMazeRaw(decodeKyraBitmap(data));
}
