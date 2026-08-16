/**
 * Lands of Lore `.VMP` viewport tile-index map -- `docs/landsoflore/dosvga/
 * data-structure.md` § "VMP" (confirmed: same `backdrop + N*431` index-table
 * layout as EOB, just LCW-wrapped in a Kyra-bitmap container EOB's raw
 * files don't have). Reuses the shared `WALL_RENDER_SLOTS`/`CELL_OFFSETS`
 * geometry table (`tools/eotb/decode-vmp.ts`) directly -- the ModdingWiki
 * spec's own byline ("Games: EOB, EOB2, LoL") already claims this table is
 * engine-shared, and EOB2's session already reused it verbatim.
 *
 * **New finding this session: the wall-type count (`N`) is NOT a fixed 6
 * across wall sets, unlike every EOB wall set seen so far.** Real corpus
 * measurements (`decompressLCW`'d `.VMP` files, this session):
 *
 * | Wall set | entries | `(entries-330)/431` |
 * |---|---|---|
 * | KEEP    | 2916 | 6 (the "standard" EOB count) |
 * | URBISH  | 2916 | 6 |
 * | CATWALK | 2485 | 5 |
 * | CAVE1   | 2485 | 5 |
 * | MANOR   | 2054 | 4 |
 * | SWAMP   | 1623 | 3 |
 * | FOREST1 | 1192 | 2 |
 *
 * **Correction to an earlier draft of this module (and the assumption
 * carried over from `tools/eotb2/decode-vmp.ts`'s own FOREST note):**
 * `FOREST1`'s 1192-entry count was first assumed "non-standard, same
 * outdoor-terrain gap as EOB2's own FOREST" purely by analogy -- but
 * `1192 - 330 = 862 = 2 * 431` divides *exactly*. EOB2's own `decode-
 * vmp.ts` only ever accepts a hardcoded `N=6`, so any other count
 * (including a perfectly valid `N=2`) fails its rigid check -- that's a
 * limitation of that decoder, not evidence FOREST-family sets don't fit
 * the general pattern. This decoder derives `N` from the file itself, so
 * `FOREST1` decodes and renders cleanly here (verified: levels 2 and 3,
 * which use it, render coherent forest/foliage textures, not garbage).
 * `decodeVmp` still throws (rather than guessing) if the remainder after
 * subtracting the 330-entry backdrop doesn't divide evenly by 431 at all
 * -- that case, a genuinely non-standard layout, hasn't been observed in
 * this corpus.
 */
import { decodeKyraBitmap } from './kyra-bitmap.ts';

export { CELL_OFFSETS, WALL_RENDER_SLOTS, type WallRenderSlot } from '../eotb/decode-vmp.ts';

export interface VmpTileRef {
  tileIndex: number;
  mirrorX: boolean;
  zMask: boolean;
}

export interface VmpData {
  /** [x][y], 22 wide x 15 tall. */
  backdrop: VmpTileRef[][];
  /** [wallType 0..wallTypes-1][431]. */
  wallTiles: VmpTileRef[][];
}

const BACKDROP_W = 22;
const BACKDROP_H = 15;
const WALL_RUN = 431;

function decodeRef(word: number): VmpTileRef {
  return {
    tileIndex: word & 0x3fff,
    mirrorX: (word & 0x4000) !== 0,
    zMask: (word & 0x8000) !== 0,
  };
}

export function decodeVmp(data: Uint8Array, numTiles: number): VmpData {
  const decompressed = decodeKyraBitmap(data);
  const count = decompressed[0]! | (decompressed[1]! << 8);
  const expected = 2 + count * 2;
  if (decompressed.length !== expected) {
    throw new Error(`decodeVmp: oracle check failed -- count=${count} implies ${expected} bytes, got ${decompressed.length}`);
  }
  const backdropCells = BACKDROP_W * BACKDROP_H;
  const remainder = count - backdropCells;
  if (remainder <= 0 || remainder % WALL_RUN !== 0) {
    throw new Error(
      `decodeVmp: non-standard entry count ${count} (${count}-${backdropCells}=${remainder} doesn't divide by ${WALL_RUN}) -- ` +
        `this wall set's layout (e.g. an outdoor/terrain set like FOREST1) doesn't fit the backdrop+N*wallType split, not supported`,
    );
  }
  const wallTypes = remainder / WALL_RUN;

  let p = 2;
  const readWord = () => {
    const w = decompressed[p]! | (decompressed[p + 1]! << 8);
    p += 2;
    return w;
  };

  const backdrop: VmpTileRef[][] = [];
  for (let x = 0; x < BACKDROP_W; x++) {
    const col: VmpTileRef[] = [];
    for (let y = 0; y < BACKDROP_H; y++) col.push(decodeRef(readWord()));
    backdrop.push(col);
  }
  const wallTiles: VmpTileRef[][] = [];
  for (let t = 0; t < wallTypes; t++) {
    const run: VmpTileRef[] = [];
    for (let i = 0; i < WALL_RUN; i++) run.push(decodeRef(readWord()));
    wallTiles.push(run);
  }

  let maxIndex = 0;
  for (const col of backdrop) for (const ref of col) maxIndex = Math.max(maxIndex, ref.tileIndex);
  for (const run of wallTiles) for (const ref of run) maxIndex = Math.max(maxIndex, ref.tileIndex);
  if (maxIndex >= numTiles) {
    throw new Error(`decodeVmp: oracle check failed -- a resolved tile index (${maxIndex}) is >= numTiles (${numTiles})`);
  }

  return { backdrop, wallTiles };
}
