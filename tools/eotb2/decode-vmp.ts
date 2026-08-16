/**
 * Eye of the Beholder II (DOS/VGA) `.VMP` wall-view mapping table decoder --
 * `docs/eotb/dosvga/data-structure.md` § "VMP -- Viewport tile-index map"
 * (confirmed byte-identical structure for EOB2). Unlike `.VCN`/`.INF`, this
 * is **not** LCW-compressed -- just a bare u16 LE `count` prefix followed
 * by `count` u16 LE entries, no Kyra-bitmap header at all. Per-entry bit
 * layout (14-bit tile index + bit14 h-flip + bit15 floor/ceiling-overlay
 * flag) is confirmed identical to the Amiga port's (`tools/eotb/decode-
 * vmp.ts`), reused verbatim below; only the byte order (LE here, BE for
 * Amiga) and the absence of Amiga's hard 5834-byte assumption differ.
 *
 * `count` is `2916` (= 330 backdrop + 6*431 wall) for every standard
 * dungeon wall set, matching the Amiga layout exactly -- reuses that same
 * `WALL_RENDER_SLOTS`/`CELL_OFFSETS` geometry table directly, since it's
 * the shared ModdingWiki spec ("Games: EOB, EOB2, LoL"), not Amiga-only.
 * EOB2's `FOREST` wall set is the one exception (`count=1192`, an outdoor
 * terrain set needing fewer viewport-layer mappings) -- `decodeVmp` throws
 * a clear error for any non-2916 count rather than guessing at a different
 * split; `export-dungeon.ts` skips FOREST for this reason, a documented
 * gap rather than a silent wrong render.
 */
export { CELL_OFFSETS, WALL_RENDER_SLOTS, type WallRenderSlot } from '../eotb/decode-vmp.ts';

export interface VmpTileRef {
  tileIndex: number;
  mirrorX: boolean;
  zMask: boolean;
}

export interface VmpData {
  /** [x][y], 22 wide x 15 tall. */
  backdrop: VmpTileRef[][];
  /** [wallType 0-5][431]. */
  wallTiles: VmpTileRef[][];
}

const BACKDROP_W = 22;
const BACKDROP_H = 15;
const WALL_TYPES = 6;
const WALL_RUN = 431;
const STANDARD_COUNT = BACKDROP_W * BACKDROP_H + WALL_TYPES * WALL_RUN; // 2916

function decodeRef(word: number): VmpTileRef {
  return {
    tileIndex: word & 0x3fff,
    mirrorX: (word & 0x4000) !== 0,
    zMask: (word & 0x8000) !== 0,
  };
}

export function decodeVmp(data: Uint8Array, numTiles: number): VmpData {
  const count = data[0]! | (data[1]! << 8);
  const expected = 2 + count * 2;
  if (data.length !== expected) {
    throw new Error(`decodeVmp: oracle check failed -- count=${count} implies ${expected} bytes, got ${data.length}`);
  }
  if (count !== STANDARD_COUNT) {
    throw new Error(
      `decodeVmp: non-standard entry count ${count} (expected ${STANDARD_COUNT}) -- this wall set's layout ` +
        `(e.g. an outdoor/terrain set like FOREST) doesn't match the backdrop+6*wallType split this decoder ` +
        `implements; not supported, documented gap rather than a guessed split`,
    );
  }

  let p = 2;
  const readWord = () => {
    const w = data[p]! | (data[p + 1]! << 8);
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
  for (let t = 0; t < WALL_TYPES; t++) {
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
