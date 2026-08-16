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
 * `count` is `330 + N*431` (330-entry backdrop + N wall-type runs of 431
 * entries each); `N=6` for every "standard" dungeon wall set. **`N` is
 * derived from the file's own byte count, not hardcoded** -- this was a
 * real bug in an earlier version of this module: it hardcoded `N=6` and
 * threw on EOB2's `FOREST` wall set (`count=1192`), documenting it as an
 * unsupported "non-standard outdoor layout". `tools/landsoflore/decode-
 * vmp.ts` (written in a later session, for Lands of Lore's own varying
 * wall-type counts 2-6) found the real pattern: `1192 - 330 = 862 = 2*431`
 * divides *exactly* -- FOREST isn't non-standard at all, it's just an
 * `N=2` set (fewer distinct wall appearances needed for outdoor terrain),
 * and LoL's own `FOREST1` (same 1192-entry count) already renders
 * correctly there with this exact derivation. This module now uses the
 * same technique, so FOREST decodes and renders here too (verified:
 * `export-dungeon.ts` no longer skips it). `AZURE` remains genuinely
 * unsupported -- confirmed separately (`docs/eotb2/TODO.md`
 * `eotb2-dos-azure-vcn-missing`) to have no `.VCN`/`.VMP` files at all,
 * an unrelated, already-settled gap, not another instance of this bug.
 *
 * Reuses the shared `WALL_RENDER_SLOTS`/`CELL_OFFSETS` geometry table
 * directly, since it's the shared ModdingWiki spec ("Games: EOB, EOB2,
 * LoL"), not Amiga-only.
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
const WALL_RUN = 431;
const BACKDROP_CELLS = BACKDROP_W * BACKDROP_H; // 330

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
  const remainder = count - BACKDROP_CELLS;
  if (remainder <= 0 || remainder % WALL_RUN !== 0) {
    throw new Error(
      `decodeVmp: non-standard entry count ${count} (${count}-${BACKDROP_CELLS}=${remainder} doesn't divide by ${WALL_RUN}) -- ` +
        `this wall set's layout doesn't fit the backdrop+N*wallType split, not supported`,
    );
  }
  const wallTypes = remainder / WALL_RUN;

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
