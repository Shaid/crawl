/**
 * Curse of the Azure Bonds / Secret of the Silver Blades / Pools of Darkness
 * (Amiga) — wall-slice geometry and 8x8 tile decode built on top of the
 * shared `GLIB` container (`goldbox-glib.ts`).
 *
 * The 156-byte wall-slice / 10-view-sub-array geometry is Pool of Radiance's
 * own confirmed format (`tools/poolofradiance/amiga/walldef.ts`) and is
 * re-exported here UNCHANGED — it operates on plain decoded bytes and does
 * not care whether those bytes came from `.dax`'s LZ77 codec or GLIB's raw
 * storage. Confirmed byte-for-byte identical across all three sibling
 * titles' own `WALLDEF.GLB` files: every entry's raw (uncompressed) block
 * length is an exact multiple of 156 bytes, zero remainder, corpus-wide (see
 * each title's `data-structure.md` §2).
 *
 * The 8x8 tile PIXEL format (1 bit per pixel, MSB-first, 8 bytes per tile —
 * `decode8x8Tiles` below) is also identical to Pool of Radiance's, but with
 * **no leading 4-byte per-block header** — PoR's dax-compressed
 * `8x8d.dax` blocks were each 4 bytes shorter than a clean multiple of 8,
 * so its own `decode8x8Tiles` skips 4 bytes before reading tiles. GLIB's own
 * "TILE"-tagged tile-group sub-blocks (found inside a nested GLIB/HLIB
 * container — see below) are tight, EXACT multiples of 8 bytes with no
 * header at all (confirmed on dozens of sample blocks: 40 = 5*8, 48 = 6*8,
 * etc, zero remainder every time) — a genuine, if minor, format divergence
 * from PoR, not a bug in either decoder.
 *
 * **Two distinct tile-bank organizations are present in this corpus** (see
 * data-structure.md for the full writeup):
 *
 * 1. A simple "universal + specific" flat scheme (`buildFlatTileBank`
 *    below) — CONFIRMED working end-to-end with a real, non-degenerate
 *    rendered PNG (crenellation border + door/torch feature, matching
 *    PoR's own visual grammar). Found on `8X8D.TLB` files that are NOT
 *    co-located with a given disk's `WALLDEF.GLB` (e.g. Curse's
 *    `DISKA/8X8D.TLB`) — likely serving a different subsystem (outdoor/
 *    overland tiles) rather than the dungeon wall renderer specifically.
 * 2. A per-wall-id nested scheme whose ids match `WALLDEF.GLB`'s own ids
 *    exactly, including Pool of Radiance's identical `10*id+n` multi-
 *    wallset composite-id arithmetic (confirmed on BOTH Curse and Secret).
 *    This is the semantically "correct" pairing for the dungeon wall
 *    renderer specifically.
 *
 *    **Correction (2026-08-30):** this was previously recorded here as
 *    "NOT solved — every per-id sub-container's declared header is an
 *    identical template constant that doesn't match the outer directory's
 *    per-entry extent". That header is genuine; the payload is simply
 *    COMPRESSED, and the header describes the container *after*
 *    decompression. Decompress with
 *    `decompressGlibBlock` (`./goldbox-glib-codecs.ts`) and then feed the
 *    result to `parseGlibContainer(image, 0)` — every sub-block is then a
 *    tight, header-less, exact multiple of 8 bytes exactly as in scheme 1.
 *    See `docs/goldbox-glib-format.md` §5.
 *
 *    **Update (2026-08-30, same session): scheme 2 IS now wired up and
 *    rendered.** `decodeGlibTileBucket` below is compression-aware (it
 *    replaces the old inline logic `buildFlatTileBank` used, which silently
 *    assumed method 0 and would have produced garbage on a compressed
 *    input — that bug is fixed as part of this change). `resolveCompositeWallId`
 *    re-derives Pool of Radiance's own `10*id+n` arithmetic to look up a
 *    WALLDEF entry's per-wallset id in the scheme-2 file, and
 *    `buildWallSpecificTileBank` composes `[placeholder, ...universal,
 *    ...specific]` — the exact 3-part structure Pool of Radiance's own
 *    `buildTileBank` (`tools/poolofradiance/amiga/walldef.ts`) already uses,
 *    reused here rather than re-derived. The **tile-vs-block index-unit
 *    question is still open** (`docs/goldbox-glib-format.md` §5.6) — these
 *    renders use the "index = one 8x8 tile" reading, matching Pool of
 *    Radiance's own confirmed convention, and are labelled RENDERED, not
 *    CONFIRMED, pending that question's resolution.
 */
import {
  decodeWallSlices,
  renderView,
  VIEW_OFFSET,
  VIEW_COLS,
  VIEW_ROWS,
  WALL_SLICE_SIZE,
  type WallSlice,
  type WallView,
} from '../poolofradiance/amiga/walldef.ts';
import {
  decodeGlibIndex,
  findBlockById,
  parseGlibContainer,
  readBlock,
  type GlibBlock,
  type GlibContainer,
} from './goldbox-glib.ts';
import { decompressGlibBlock } from './goldbox-glib-codecs.ts';

export { decodeWallSlices, renderView, VIEW_OFFSET, VIEW_COLS, VIEW_ROWS, WALL_SLICE_SIZE };
export type { WallSlice, WallView };

/** Decode raw, uncompressed, header-less 8x8 1bpp MSB-first tiles (8 bytes each) — the GLIB "TILE" sub-block layout. */
export function decode8x8Tiles(data: Uint8Array): Uint8Array[] {
  const count = Math.floor(data.length / 8);
  const tiles: Uint8Array[] = [];
  const bitMask = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];
  for (let t = 0; t < count; t++) {
    const tile = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      const b = data[t * 8 + y];
      for (let x = 0; x < 8; x++) {
        tile[y * 8 + x] = b & bitMask[x] ? 255 : 0;
      }
    }
    tiles.push(tile);
  }
  return tiles;
}

/**
 * Decode one nested GLIB "TILE" bucket into a flat tile array. Compression-
 * aware: decompresses first (a no-op copy for a stored/method-0 block — see
 * `decompressGlibBlock`), THEN parses the result as a container and decodes
 * every sub-block's tiles. Calling `parseGlibContainer` directly on a
 * compressed block's on-disk bytes (the bug this function fixes) silently
 * "succeeds" — the block's own 16-byte header is genuine and parses fine —
 * but the offset table that follows is still compressed data, not real
 * offsets, and the sub-blocks it points at then decode as garbage.
 */
export function decodeGlibTileBucket(data: Uint8Array, block: GlibBlock): Uint8Array[] {
  const image = decompressGlibBlock(data, block);
  const sub = parseGlibContainer(image, 0);
  const tiles: Uint8Array[] = [];
  for (const b of sub.blocks) tiles.push(...decode8x8Tiles(readBlock(image, b)));
  return tiles;
}

/**
 * The confirmed-working "flat" tile bank: index 0 = grey placeholder,
 * followed by every tile from the id-203 "universal" nested sub-container
 * (if present), followed by every tile from all OTHER ids' nested
 * sub-containers concatenated in index-table order. Each id's own block is
 * itself a nested GLIB container (tag "TILE") whose own blocks are raw,
 * header-less, exact-multiple-of-8-byte tile groups.
 */
export function buildFlatTileBank(data: Uint8Array, outer: GlibContainer): Uint8Array[] {
  const index = decodeGlibIndex(data, outer);
  const placeholder = new Uint8Array(64).fill(128);
  const bank: Uint8Array[] = [placeholder];

  const universalBlock = findBlockById(outer, index, 203);
  if (universalBlock) bank.push(...decodeGlibTileBucket(data, universalBlock));
  for (const { id, blockIndex } of index) {
    if (id === 203) continue;
    bank.push(...decodeGlibTileBucket(data, outer.blocks[blockIndex]));
  }
  return bank;
}

/**
 * Pool of Radiance's own confirmed multi-wallset composite-id arithmetic
 * (`tools/poolofradiance/amiga/walldef.ts` module doc; independently
 * re-derived on Curse's and Secret's own scheme-2 index tables — see
 * `docs/goldbox-glib-format.md` §5.6): when a WALLDEF entry decodes to more
 * than one wall slice (`wallsetCount > 1`), its per-wallset tile-bank id in
 * the scheme-2 file is `10*baseId + (wallsetIndex+1)` (1-based wallset
 * number); a single-wallset entry uses `baseId` directly.
 */
export function resolveCompositeWallId(baseId: number, wallsetIndex: number, wallsetCount: number): number {
  return wallsetCount > 1 ? baseId * 10 + (wallsetIndex + 1) : baseId;
}

/**
 * Number of raw 156-byte wall slices that share one bundled wallset — the
 * same quantum `resolveCompositeWallId`'s `wallsetIndex` counts in.
 * Previously a private constant duplicated in `goldbox-glib-export.ts`;
 * hoisted here so `resolveFlatWalldefId` (below, needed by
 * `goldbox-ecl.ts`'s wallset-slot binding consumers) and the render step
 * share one definition.
 */
export const SLICES_PER_WALLSET = 5;

export interface FlatWalldefEntry {
  /** This WALLDEF entry's own directory id. */
  id: number;
  /** `Math.ceil(entrySlices.length / SLICES_PER_WALLSET)` for this entry. */
  wallsetCount: number;
}

export interface FlatWalldefResolution {
  /** The real WALLDEF directory id (what `wall-index.json` keys textures by). */
  baseId: number;
  /** Which of that entry's bundled wallsets (0-based) the flat id named. */
  wallsetIndex: number;
  wallsetCount: number;
}

/**
 * Resolve an ECL "LOAD PIECES"/`LoadWalldef` **flat** piece id to its real
 * WALLDEF entry id + which bundled wallset it names.
 *
 * `LoadWalldef`'s own `block_id` argument (`ovr031.cs:642-687`) is passed
 * straight through to `load_decode_dax(..., block_id, "WALLDEF<area>.dax")`
 * in the DOS original, where WALLDEF is a PER-AREA file — but this
 * project's Amiga corpus has ONE combined `WALLDEF.GLB`/`.dax` per title,
 * whose own directory ids are sparse (Curse: `1-14,16,17` — no `15` or
 * `18`). Real ECL scripts nonetheless reference `15` and `18` directly
 * (Curse blocks 51/53 and 64/69's own `LOAD PIECES` operands) — these are
 * NOT separate ids at all: `14` and `17` are exactly the two Curse entries
 * whose raw byte length is `2 * WALL_SLICE_SIZE * SLICES_PER_WALLSET`
 * (i.e. `wallsetCount === 2`, the same multi-wallset entries
 * `resolveCompositeWallId` already handles for the scheme-2 texture
 * lookup), and `15`/`18` land exactly one past them. The flat id space is
 * therefore contiguous across a multi-wallset entry's own span:
 * `[id, id + wallsetCount)`. Confirmed by construction (every gap in the
 * WALLDEF directory's own id sequence is exactly filled by its immediately
 * preceding multi-wallset entry's span, zero leftover gaps) — see
 * `docs/goldbox-glib-format.md`'s wallset-binding section.
 */
export function resolveFlatWalldefId(entries: FlatWalldefEntry[], flatId: number): FlatWalldefResolution | undefined {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  for (const e of sorted) {
    if (flatId >= e.id && flatId < e.id + e.wallsetCount) {
      return { baseId: e.id, wallsetIndex: flatId - e.id, wallsetCount: e.wallsetCount };
    }
  }
  return undefined;
}

/**
 * Compose the tile bank for one specific wall-id's own scheme-2 tile
 * bucket: `[placeholder, ...universalTiles, ...specificTiles]` — the exact
 * 3-part structure Pool of Radiance's own `buildTileBank`
 * (`tools/poolofradiance/amiga/walldef.ts`) already uses for its
 * `walldef.dax`/`8x8d.dax` pairing, reused here rather than re-derived.
 * `specificTiles` is `undefined` when the composite id has no scheme-2
 * entry (the bank then falls back to universal-only content).
 */
export function buildWallSpecificTileBank(
  universalTiles: Uint8Array[],
  specificTiles: Uint8Array[] | undefined,
): Uint8Array[] {
  const placeholder = new Uint8Array(64).fill(128);
  return [placeholder, ...universalTiles, ...(specificTiles ?? [])];
}
