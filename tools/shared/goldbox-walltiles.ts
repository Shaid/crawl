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
 * **Tile pixel format (corrected 2026-11-18 — the earlier "header-less 1bpp,
 * 8 bytes per tile" reading was WRONG in every title, see
 * `docs/<game>/audit-2026-11-13-changes.md`).** Every "TILE" sub-block is ONE
 * 8x8 glyph: an 8-byte header `(u16 height=8, u16 x, u16 y, u8 widthBytes=1,
 * u8 flag)` followed by P bitplanes stored plane-major, 8 bytes (one per
 * row, MSB = leftmost pixel) per plane. 48 B = 5 planes (Curse/Secret walls
 * and the universal bank 203), 40 B = 4 planes (bank 202, UI/arrow glyphs —
 * not wall art), 56 B = 6 planes (Pools wallsets). A sub-block with
 * `height = 0` is a palette (8-byte header + 16 or 32 RGB888 triplets), not
 * a glyph. The header grammar fits 1325/1325 (Curse), 1395/1395 (Secret) and
 * 1536/1536 (Pools) glyph blocks. One WALLDEF byte indexes one GLYPH:
 * 0 = none, 1..45 = universal glyphs 0..44, then the wallset's own 70
 * glyphs (Curse/Secret); Pools has 256 glyphs per bank and no universal
 * bank. Colours are palette indices; no palette is wired up yet
 * (`goldbox-glib-palette`), so renders use a grey ramp of the index.
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
 *    reused here rather than re-derived. The tile-vs-block index-unit question
 *    (`docs/goldbox-glib-format.md` §5.6) is settled: one byte = one 8x8
 *    glyph (the "one byte = one block" correction, recorded as confirmed
 *    but never applied to this decoder until 2026-11-18). Validated by the
 *    seam-continuity oracle in `tools/shared/__tests__/goldbox-glyph.test.ts`.
 */
import {
  decodeWallSlices,
  glyphFromPlanes,
  renderView,
  VIEW_OFFSET,
  VIEW_COLS,
  VIEW_ROWS,
  WALL_SLICE_SIZE,
  type WallSlice,
  type WallView,
} from '../poolofradiance/amiga/walldef.ts';
import {
  parseGlibContainer,
  readBlock,
  type GlibBlock,
} from './goldbox-glib.ts';
import { decompressGlibBlock } from './goldbox-glib-codecs.ts';

export { decodeWallSlices, glyphFromPlanes, renderView, VIEW_OFFSET, VIEW_COLS, VIEW_ROWS, WALL_SLICE_SIZE };
export type { WallSlice, WallView };

export interface GlibGlyph {
  planes: number;
  /** 8x8 greyscale tile (index mapped to a grey ramp, see `glyphFromPlanes`). */
  tile: Uint8Array;
}

/**
 * Decode one GLIB "TILE" sub-block: 8-byte header + P plane-major bitplanes.
 * Returns `undefined` for a palette block (`height = 0`) or anything that
 * does not match the glyph grammar (`height = 8`, `widthBytes = 1`,
 * `(len - 8) % 8 == 0`, 1..8 planes) — callers that need an exact census
 * should count the `undefined`s.
 */
export function decodeGlibGlyph(block: Uint8Array): GlibGlyph | undefined {
  if (block.length < 16 || (block.length - 8) % 8 !== 0) return undefined;
  const height = (block[0] << 8) | block[1];
  const widthBytes = block[6];
  const planes = (block.length - 8) / 8;
  if (height !== 8 || widthBytes !== 1 || planes < 1 || planes > 8) return undefined;
  const planeRows: number[][] = [];
  for (let p = 0; p < planes; p++) planeRows.push(Array.from(block.subarray(8 + p * 8, 16 + p * 8)));
  return { planes, tile: glyphFromPlanes(planeRows) };
}

/**
 * Decode one nested GLIB "TILE" bucket into a flat glyph array (palette blocks skipped). Compression-
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
  for (const b of sub.blocks) {
    const glyph = decodeGlibGlyph(readBlock(image, b));
    if (glyph) tiles.push(glyph.tile); // palette blocks (height 0) are skipped
  }
  return tiles;
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
 */
export function buildWallSpecificTileBank(
  universalTiles: Uint8Array[],
  specificTiles: Uint8Array[] | undefined,
): Uint8Array[] {
  // Pools of Darkness has no universal bank: its 256-glyph banks are indexed
  // directly (index n = glyph n, no leading "none" slot) — seam-continuity
  // lift 0.40 vs 0.17 for the placeholder-shifted alignment.
  if (universalTiles.length === 0) return specificTiles ?? [new Uint8Array(64).fill(128)];
  const placeholder = new Uint8Array(64).fill(128);
  return [placeholder, ...universalTiles, ...(specificTiles ?? [])];
}

/** Glyphs in one bundled wallset's own bank (Curse/Secret and PoR: 70 = 35 16x8 items in PoR); the slot stride of the glyph index space. */
export const GLYPHS_PER_WALLSET = 70;

/**
 * Compose the glyph bank one WALLDEF ENTRY draws from. Glyph index space:
 * 0 = none, 1..45 = universal glyphs, then wallset slot `k` at
 * `46 + GLYPHS_PER_WALLSET*k`. A multi-wallset entry (`wallsetCount > 1`)
 * whose composite banks `10*id+n` exist has wallset `n` in slot `n-1`;
 * otherwise the entry's own direct id is the (single) bank. `lookup(id)`
 * returns a bank's glyphs or `undefined`. A missing composite is padded
 * with `GLYPHS_PER_WALLSET` placeholders to keep later slots aligned.
 * With no universal bank (Pools of Darkness) the bank is the direct id's
 * glyphs unshifted (see `buildWallSpecificTileBank`). Returns `[]` when the
 * entry has no bank at all.
 *
 * Why per entry: in Curse/Secret, 17/19 multi-wallset-entry slices draw
 * glyphs from more than one slot, so the old per-slice single-bank render
 * fell out of range (13 Curse and 57 Secret views were skipped) while this
 * layout renders every view in range.
 */
export function buildEntryTileBank(
  universalTiles: Uint8Array[],
  baseId: number,
  wallsetCount: number,
  lookup: (id: number) => Uint8Array[] | undefined,
): Uint8Array[] {
  const direct = lookup(baseId);
  if (direct) return buildWallSpecificTileBank(universalTiles, direct);
  const specific: Uint8Array[] = [];
  let any = false;
  for (let n = 1; n <= Math.max(wallsetCount, 1); n++) {
    const g = lookup(baseId * 10 + n);
    if (g) any = true;
    specific.push(...(g ?? Array.from({ length: GLYPHS_PER_WALLSET }, () => new Uint8Array(64).fill(128))));
  }
  return any ? buildWallSpecificTileBank(universalTiles, specific) : [];
}
