/**
 * Pool of Radiance (Amiga) `walldef.dax` + `8x8d.dax` — the real-time
 * dungeon-corridor wall renderer's data, and the answer to the standing
 * "is the first-person view a small library of static scene pictures
 * selected by wall pattern?" hypothesis (see
 * `docs/walker-map-format-future-decision.md` and
 * `docs/poolofradiance/amiga/data-structure.md`).
 *
 * ANSWER: no. The dungeon view is composited per depth/viewing-angle from
 * small reusable 8x8 tiles (`8x8d.dax`), referenced by index from
 * `walldef.dax`'s per-wall-type view records — the same general strategy
 * used by every other game in this repo's corpus (Black Crypt, EOB, MM,
 * Wizardry 6), just at a finer 8x8-tile granularity than those games' larger
 * wall-piece bitmaps.
 *
 * Wall-slice geometry (`WALL_SLICE_SIZE`, `VIEW_OFFSET`/`VIEW_COLS`/
 * `VIEW_ROWS`) is **not derived from this game's own disassembly** — it is
 * ported verbatim from the Gold Box Explorer community tool
 * (https://github.com/bsimser/Gold-Box-Explorer,
 * `src/Common/Plugins/Dax/DaxWallDefFile.cs`'s `loadWallDefs`), whose own
 * comment credits it to "Simeon Pilgrim's Curse of the Azure Bonds code,
 * ovr031.cs, seg600:0ADA/0AE4/0AEE" (a disassembly of a *different*,
 * DOS-side Gold Box title). That tool's own container format (9-byte
 * directory entries + a byte-oriented PackBits-style RLE, see its
 * `DaxFile.cs`) is a completely different, DOS-specific scheme from this
 * project's confirmed Amiga container (`dax.ts`) — the two platforms do NOT
 * share a container or compressor. What DOES appear to carry over, and is
 * independently confirmed against this project's own real Amiga bytes
 * (not assumed from the DOS source), is the **per-block wall-tile-index
 * layout downstream of decompression**:
 *
 *  - Every walldef.dax entry's decompressed length is an exact multiple of
 *    156 bytes (`WALL_SLICE_SIZE`) with zero remainder, for all 17 entries
 *    in the corpus (5, 10, or 15 slices per entry — see data-structure.md).
 *  - The 10 view sub-arrays inside one 156-byte slice
 *    (`VIEW_OFFSET`/`VIEW_ROWS`/`VIEW_COLS` below) sum to exactly 156 bytes
 *    with zero gap or overlap (2+4+4+12+16+16+56+22+22+2 = 156).
 *  - `8x8d.dax`'s own indexIDs {1-9,17-20,23} are byte-for-byte the same set
 *    as walldef.dax's single-wallset ids, and its extra ids {101,102,103},
 *    {211,212}, {241,242}, and {203} exactly match Gold Box Explorer's
 *    `baseBlockId = 10*blockId (+1/+2/+3)` / "universal tile block 203"
 *    arithmetic for walldef's multi-wallset entries (id 0 -> 3 wallsets ->
 *    101/102/103 present; id 21 -> 2 wallsets -> 211/212 present; id 24 ->
 *    2 wallsets -> 241/242 present). This is a strong independent
 *    ID-arithmetic cross-check, not a coincidence.
 *
 * The **pixel format** of `8x8d.dax`'s tiles is a lower-confidence,
 * "rendered" (not code-confirmed) extension of this: each block's
 * decompressed data is 4 bytes shorter than a clean multiple of 8
 * (2252 = 4 + 8*281, 1036 = 4 + 8*129, 1484 = 4 + 8*185 — all exact), so
 * `decode8x8Tiles` below skips a 4-byte per-block header and treats the
 * rest as 8-byte, 1-bit-per-pixel, MSB-first tiles — identical to Gold Box
 * Explorer's DOS-side `MonoBlock` decoder, minus that leading header (whose
 * own meaning is not decoded). Rendered wall composites using this decode
 * show clear, non-random brick/stone crosshatch texture and symmetric
 * door/frame structure (see `docs/poolofradiance/amiga/data-structure.md`),
 * which is real visual evidence the decode is basically right, but no
 * disassembly trace confirms it — flagged "rendered" throughout.
 */
import { readDaxDirectory, decompressDaxEntry, type DaxEntry } from './dax.ts';

export const WALL_SLICE_SIZE = 156;

/** Byte offset, column count, and row count of each of the 10 view sub-arrays inside one 156-byte wall slice. */
export const VIEW_OFFSET = [0, 2, 6, 10, 22, 38, 54, 110, 132, 154];
export const VIEW_COLS = [1, 1, 1, 3, 2, 2, 7, 2, 2, 1];
export const VIEW_ROWS = [2, 4, 4, 4, 8, 8, 8, 11, 11, 2];

export interface WallView {
  view: number;
  rows: number;
  cols: number;
  /** row-major tile indices into the block's combined tile bank. */
  tileIndices: number[][];
}

export interface WallSlice {
  wallNumber: number;
  views: WallView[];
}

/** Split one walldef.dax entry's decompressed bytes into its wall slices and view grids. */
export function decodeWallSlices(data: Uint8Array): WallSlice[] {
  if (data.length % WALL_SLICE_SIZE !== 0) {
    throw new Error(`walldef slice: expected a multiple of ${WALL_SLICE_SIZE} bytes, got ${data.length}`);
  }
  const wallCount = data.length / WALL_SLICE_SIZE;
  const slices: WallSlice[] = [];
  for (let w = 0; w < wallCount; w++) {
    const base = w * WALL_SLICE_SIZE;
    const views: WallView[] = [];
    for (let v = 0; v < VIEW_OFFSET.length; v++) {
      const rows = VIEW_ROWS[v];
      const cols = VIEW_COLS[v];
      let i = base + VIEW_OFFSET[v];
      const tileIndices: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < cols; c++) row.push(data[i++]);
        tileIndices.push(row);
      }
      views.push({ view: v, rows, cols, tileIndices });
    }
    slices.push({ wallNumber: w, views });
  }
  return slices;
}

/**
 * Decode one `8x8d.dax` block's tiles: skip its 4-byte leading header, then
 * read 8x8 1bpp MSB-first tiles (one bit per pixel, 255 = set / 0 = clear).
 * Returns a flat array of 64-byte (8x8) greyscale tiles, one per index.
 */
export function decode8x8Tiles(data: Uint8Array): Uint8Array[] {
  const body = data.subarray(4);
  const count = Math.floor(body.length / 8);
  const tiles: Uint8Array[] = [];
  const bitMask = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];
  for (let t = 0; t < count; t++) {
    const tile = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      const b = body[t * 8 + y];
      for (let x = 0; x < 8; x++) {
        tile[y * 8 + x] = b & bitMask[x] ? 255 : 0;
      }
    }
    tiles.push(tile);
  }
  return tiles;
}

/**
 * Assemble the tile bank a given walldef.dax block id draws from: index 0 is
 * a placeholder (grey — no real tile has been observed to need it, but
 * indices are read unchecked from the wall data), followed by the
 * "universal" tile block (id 203, present in every corpus 8x8d.dax) and
 * then this block's own specific tiles (matching Gold Box Explorer's
 * `load8x8Bitmaps` ordering).
 */
export function buildTileBank(fileData: Uint8Array, blockId: number): Uint8Array[] {
  const { entries } = readDaxDirectory(fileData);
  const byId = new Map<number, DaxEntry>(entries.map((e) => [e.indexID, e]));
  const placeholder = new Uint8Array(64).fill(128);
  const bank: Uint8Array[] = [placeholder];

  const universal = byId.get(203);
  if (universal) bank.push(...decode8x8Tiles(decompressDaxEntry(fileData, universal)));

  const specific = byId.get(blockId);
  if (specific) bank.push(...decode8x8Tiles(decompressDaxEntry(fileData, specific)));

  return bank;
}

/** Composite a view's tile-index grid into a flat 8bpp greyscale bitmap (width*height bytes, one byte per pixel). */
export function renderView(view: WallView, bank: Uint8Array[]): { width: number; height: number; pixels: Uint8Array } {
  const width = view.cols * 8;
  const height = view.rows * 8;
  const pixels = new Uint8Array(width * height);
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      const idx = view.tileIndices[r][c];
      const tile = idx < bank.length ? bank[idx] : bank[0];
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          pixels[(r * 8 + ty) * width + (c * 8 + tx)] = tile[ty * 8 + tx];
        }
      }
    }
  }
  return { width, height, pixels };
}
