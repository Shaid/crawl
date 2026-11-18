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
 * The **pixel format** of `8x8d.dax`'s tiles (corrected 2026-11-18 — the
 * earlier "4-byte header + 1bpp 8-byte tiles" reading was WRONG, see
 * `docs/poolofradiance/audit-2026-11-13-changes.md`): every entry is one
 * 12-byte image header `(u16 h=8, u16 wBytes=2, u16 x, u16 y, u16 count,
 * u16 bytesPerItem=16)` followed by FOUR bitplanes, each holding the whole
 * bank (`count` items of 16x8 px = two 8x8 glyphs side by side). Exact:
 * `len == 12 + count*16*4` on 23/23 entries. One walldef byte indexes one
 * glyph: index 0 = none, 1..45 = universal bank (id 203) glyphs 0..44
 * (glyph 45 is all-zero padding of the last 16-wide item), then the
 * wallset's own 70 glyphs (`program+0x6D53E` holds the matching slot-base
 * table 1, 46, 116, 186, 256). 4 planes = 16 index values; no palette has
 * been located (`por-palette`), so renders map the index to a grey ramp.
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
 * Build one 8x8 greyscale tile (64 bytes, row-major) from planar glyph data:
 * `planeRows[p][y]` is the byte for plane `p`, row `y` (MSB = leftmost
 * pixel, plane 0 = bit 0 of the colour index). The colour index is mapped
 * to a grey ramp (`index * 255 / (2^planes - 1)`) because no palette is
 * known yet; the mapping is injective, so equality tests on the grey value
 * are equality tests on the index.
 */
export function glyphFromPlanes(planeRows: number[][]): Uint8Array {
  const planes = planeRows.length;
  const max = (1 << planes) - 1;
  const tile = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let idx = 0;
      for (let p = 0; p < planes; p++) if (planeRows[p][y] & (0x80 >> x)) idx |= 1 << p;
      tile[y * 8 + x] = Math.round((idx * 255) / max);
    }
  }
  return tile;
}

/**
 * Decode one `8x8d.dax` entry (12-byte image header + 4 whole-bank bitplanes,
 * 16x8-px items = two glyphs) into 8x8 greyscale glyph tiles, left glyph of
 * item 0 first. Throws if the exact-length invariant `len == 12 + count*16*4`
 * does not hold.
 */
export function decodePorGlyphs(data: Uint8Array): Uint8Array[] {
  if (data.length < 12) throw new Error('8x8d entry shorter than its 12-byte header');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [h, wBytes, , , count, bpi] = [0, 2, 4, 6, 8, 10].map((o) => dv.getUint16(o, false));
  if (h !== 8 || wBytes !== 2 || bpi !== 16 || data.length !== 12 + count * bpi * 4) {
    throw new Error(`8x8d entry: bad header h=${h} wBytes=${wBytes} count=${count} bpi=${bpi} len=${data.length}`);
  }
  const glyphs: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    for (let half = 0; half < 2; half++) {
      const planeRows: number[][] = [];
      for (let p = 0; p < 4; p++) {
        const rows: number[] = [];
        for (let y = 0; y < 8; y++) rows.push(data[12 + p * count * bpi + i * bpi + y * 2 + half]);
        planeRows.push(rows);
      }
      glyphs.push(glyphFromPlanes(planeRows));
    }
  }
  return glyphs;
}

/** Number of real glyphs in the universal bank (id 203): its 46th glyph is all-zero padding that fills the last 16-px item. */
export const POR_UNIVERSAL_GLYPHS = 45;

/**
 * Open `8x8d.dax` once: the universal glyphs (id 203, glyph 45 padding
 * dropped) and a `lookup(id)` for a wallset's own 70 glyphs. Compose a
 * walldef entry's bank with `buildEntryTileBank`
 * (`tools/shared/goldbox-walltiles.ts`): `[none, universal(45), wallset
 * glyphs at 46 + 70*slot]`.
 */
export function openTileBanks(fileData: Uint8Array): {
  universal: Uint8Array[];
  lookup: (id: number) => Uint8Array[] | undefined;
} {
  const { entries } = readDaxDirectory(fileData);
  const byId = new Map<number, DaxEntry>(entries.map((e) => [e.indexID, e]));
  const u = byId.get(203);
  const universal = u ? decodePorGlyphs(decompressDaxEntry(fileData, u)).slice(0, POR_UNIVERSAL_GLYPHS) : [];
  return {
    universal,
    lookup: (id) => {
      const e = byId.get(id);
      return e ? decodePorGlyphs(decompressDaxEntry(fileData, e)) : undefined;
    },
  };
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
