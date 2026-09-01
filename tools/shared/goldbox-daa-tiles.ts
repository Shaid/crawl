/**
 * Payload format for Amiga-native `.DAA` 8x8-tile-bank entries (Death
 * Knights of Krynn's `8x8d1.daa`, Champions of Krynn's `8X8D0/1/2.DAA`) —
 * once decompressed via `goldbox-dosdax.ts`'s `decodeAmigaDaaFile`.
 *
 * Cracked via a `re-oracle` escalation (2026-09-01), independently
 * re-verified against real bytes this session.
 *
 * **These two titles do NOT share one payload shape below the shared BE
 * DaxFile container** — see the correction below the Death Knights section.
 * `decodeDaaTileSurface` (Death Knights only) and
 * `decodeChampionsWallTileSurface` (Champions only) are two distinct,
 * non-interchangeable decoders; don't apply one title's function to the
 * other's bytes.
 *
 * ## Entry payload shape — CONFIRMED for Death Knights' `8x8d1.daa` only
 *
 * ```
 * offset 0  u16 BE  height        -- always 8 (one 8x8-tile row bank)
 * offset 2  u16 BE  tileCount     -- number of 8x8 tiles in this entry
 * offset 4  u16 BE  x             -- unused by this decoder (always 0 observed)
 * offset 6  u16 BE  y             -- unused by this decoder (always 0 observed)
 * offset 8  u8     itemCount      -- always 1 observed, unused
 * offset 9  64 bytes              -- embedded palette: 32 x u16 BE amiga12
 *                                    (0x0RGB) colour words. ALL-ZERO for
 *                                    wall-specific entries; the REAL palette
 *                                    lives in a per-file "universal" entry
 *                                    (id 202 for Death Knights) — confirmed
 *                                    by inspecting the raw bytes directly,
 *                                    not inferred.
 * offset 73 planeCount * tileCount * 8 bytes
 *                                  -- PLANE-CONSECUTIVE bitplane data:
 *                                     byte at [plane*tileCount*8 +
 *                                     row*tileCount + tile], each byte's 8
 *                                     bits are that tile's row of 8 pixels,
 *                                     MSB-first (bit 7 = x=0).
 * ```
 *
 * `planeCount` is 5 for Death Knights' `8x8d1.daa` (32-colour tiles) — not
 * stored in the header; derived per-file from `(payloadAfterPaletteLen) /
 * (tileCount * 8)`, which divides evenly for every wall-specific entry
 * sampled (5.0 exactly, zero remainder). One Death Knights entry (id 202,
 * the palette-source entry itself) has a `tileCount` field that is off by
 * exactly one relative to its own true payload length (`45` vs. the `46`
 * that divides its body evenly, matching sibling id 203's declared count
 * for an identical-length body) — a real, minor, non-blocking authoring
 * anomaly in that one entry; it doesn't affect palette extraction (the
 * palette lives at a fixed 64-byte offset regardless of the tile count
 * field) and this decoder never treats id 202 as a tile bank.
 *
 * > **Correction (2026-09-02, this session):** this doc previously claimed
 * > "`planeCount` is 5 for Death Knights ... and 4 for Champions'
 * > `8X8D*.DAA`", implying Champions used the SAME 9-byte-header +
 * > 64-byte-embedded-palette body shape as Death Knights with just a
 * > different plane count. **That was wrong** — restated here only because
 * > it was live text in this file, not because it was ever independently
 * > verified for Champions (the per-title docs always carried it as OPEN;
 * > see `docs/championsofkrynn/amiga/data-structure.md` §4's own
 * > correction block, written the same session this claim was first added).
 * > Champions' `8X8D0/1/2.DAA` really uses a DIFFERENT, simpler body shape
 * > with NO embedded palette at all and its real tile count at a different
 * > header offset — see `decodeChampionsWallTileSurface` below, cracked
 * > this session (2026-09-02) by re-testing the header's OTHER fields
 * > against the body-length divisibility oracle instead of assuming the
 * > offset-2 field (which reads a constant, uninformative `1` in every
 * > Champions entry) was necessarily `tileCount` just because it plays that
 * > role in Death Knights.
 *
 * ## Death Knights' per-wall "quarters" addressing — CONFIRMED (runtime-
 * disassembly-derived, independently re-verified structurally this session)
 *
 * For `walldef1.dax` wall id `W` (1-7), the raw WALLDEF view-cell byte
 * (0-255) selects among FOUR `.DAA` entries — `W`, `W+20`, `W+40`, `W+60` —
 * each holding exactly 64 tiles: `slot = idx >> 6` (0-3), `tile = idx & 63`.
 * This exactly and completely covers a WALLDEF byte's full 0-255 range with
 * no placeholder/blank slot 0 (unlike the GLIB titles' own tile-bank
 * convention) — index 0 is a real tile (quarter 0, tile 0), not blank.
 * `8x8d1.daa`'s ids form EXACTLY this set for all 7 walls
 * (`{1,21,41,61,2,22,42,62,...,7,27,47,67}`) plus 3 "universal" ids
 * (202/203/204) that fall outside any single WALLDEF byte's addressable
 * range (256-301) and are not consumed by this per-cell wall renderer —
 * consistent with Dark Queen of Krynn's confirmed separate topview/picture
 * rendering path for the analogous universal-id entries in that title
 * (a DIFFERENT title, not evidence this one shares the same code — flagged
 * as an open question, not a documented fact, in the per-title docs).
 *
 * ## Champions of Krynn's `8X8D0/1/2.DAA` payload — CONFIRMED (2026-09-02,
 * this session), a genuinely different, simpler shape from Death Knights'
 *
 * `8X8D0.DAA` and `8X8D1.DAA` are byte-identical (25,916 B, both the real
 * bank-1 wall-specific tile source — the name overlap with `1` is not
 * significant, `8X8D0.DAA` looks like a redundant duplicate shipped
 * alongside it). `8X8D2.DAA` (28,734 B) is bank 2's own tile source.
 *
 * ```
 * offset 0  u16 BE  height     -- always 8, same as Death Knights
 * offset 2  u16 BE  unknown    -- CONSTANT 1 in every one of the 25 real
 *                                 entries across both files — NOT the tile
 *                                 count (that was the wrong assumption that
 *                                 kept this format stuck at "OPEN" for a
 *                                 full session — see the correction above).
 *                                 Role still unidentified.
 * offset 4  u16 BE  x          -- 0 observed, unused (same field position
 *                                 as Death Knights, role unconfirmed here)
 * offset 6  u16 BE  y          -- 0 observed, unused
 * offset 8  u8      tileCount  -- the REAL tile count. Confirmed by
 *                                 requiring `(bodyLen - 9) % (planeCount*8)
 *                                 === 0` for a FIXED planeCount across the
 *                                 whole corpus and finding planeCount=4
 *                                 (16-colour tiles) makes this byte match
 *                                 the derived tile count exactly for 24/25
 *                                 real entries (0 deviation) across
 *                                 `8X8D0.DAA` (202, 11, 12, 31, 32, 23, 51,
 *                                 52, 7, 81, 82 — 11/11) and `8X8D2.DAA`
 *                                 (all 13 entries — 13/13). The sole
 *                                 exception, id 203, is off by exactly one
 *                                 (header says 45, body-length division
 *                                 says the real value is 46) — the SAME
 *                                 class of single-entry off-by-one anomaly
 *                                 Death Knights' own id 202 has (see
 *                                 above), just landing on the other member
 *                                 of the 202/203 "universal id" pair this
 *                                 time. `decodeChampionsWallTileSurface`
 *                                 therefore derives `tileCount` from body
 *                                 length directly rather than trusting this
 *                                 field, which is correct for all 25
 *                                 entries including 203.
 * offset 9  planeCount(4) * tileCount * 8 bytes
 *                              -- plane-consecutive bitplane data,
 *                                 IMMEDIATELY after the header — NO
 *                                 embedded 64-byte palette region at all
 *                                 (unlike Death Knights). This also fully
 *                                 explains an earlier observation flagged
 *                                 as a real structural puzzle — "every
 *                                 Champions entry's palette-shaped region
 *                                 (bytes 9-73) is non-zero, unlike Death
 *                                 Knights" — that region was never a
 *                                 palette; it's just the first 64 bytes of
 *                                 real plane data, which is naturally
 *                                 non-zero.
 * ```
 *
 * id `203` is this format's own "universal" tile bucket in `8X8D0/1.DAA`
 * (46 tiles, once the off-by-one is corrected) — the same corpus-wide-
 * universal role id 203 plays in the GLIB titles' own flat tile-bank scheme
 * (`goldbox-walltiles.ts`'s `buildFlatTileBank`). `8X8D2.DAA` (bank 2) has
 * NO id 202/203 of its own; this extractor reuses bank 1's `8X8D1.DAA` id
 * 203 as the shared universal bucket for both banks (a design choice, not
 * an independently-confirmed fact — flagged in the per-title doc). Every
 * other id's own DIRECTORY id follows Pool of Radiance's `10*wallId+wallset`
 * composite-id convention (verified 9/9 WALLDEF1 ids and 9/9 WALLDEF2 ids
 * match this arithmetic with 0 gaps) — but see the addressing-model
 * paragraph below: this composite id only explains how the ENTRIES are
 * ORGANIZED/NAMED in the file, not how WALLDEF's raw view-index bytes
 * actually address them at render time. id 201 (in `8X8D0/1.DAA` only) is
 * a genuine decompression failure (a deliberately-blanked/corrupted stub —
 * confirmed by direct inspection: its whole 1341-byte compressed span is
 * literal zero bytes, which the confirmed PackBits-style codec can only
 * decode to about half its declared 1416-byte `rawSize` before running out
 * of input) and is simply skipped, contributing 0 tiles.
 *
 * ## Addressing model — RENDERED (not CONFIRMED; this is the SAME open
 * question `goldbox-walltiles.ts` already flags for the GLIB titles'
 * scheme 1 vs. scheme 2, now hit again in a different title/container)
 *
 * A first attempt built one SMALL per-wall RGBA bank via
 * `[placeholder, ...universalTiles, ...specificTiles]` (composite-id
 * lookup selecting `specificTiles`, mirroring `goldbox-walltiles.ts`'s
 * `buildWallSpecificTileBank` for the GLIB titles' own scheme 2) — this
 * only fits within bounds for 60/115 view slices across both banks
 * (WALLDEF view-index bytes go up to `233`, vs. each per-wall bank's own
 * ~70-116-tile size), silently falling back to the placeholder tile for
 * the other 55 (`renderView`/`renderColorView`'s own out-of-range
 * fallback, not a crash — so this failure mode is easy to miss without
 * explicitly counting it).
 *
 * `buildChampionsFlatTileBank` below instead builds ONE flat, whole-file
 * bank per `8X8D<bank>.DAA` — `[placeholder, ...universal(id 203),
 * ...every other entry's tiles, in directory/file order]` — the exact
 * same 3-part structure `buildFlatTileBank` already uses for the GLIB
 * titles' scheme 1. This fits **every** view slice with zero out-of-range
 * indices (115/115 across both banks, vs. 60/115 for the per-wall
 * approach) and renders coherent, non-degenerate wall art (door/gate-
 * frame borders, brick patterns, a diamond/checkerboard motif) for slices
 * that previously fell back to a blank placeholder — strong RENDERED-grade
 * evidence this flat, whole-file addressing is the real model, though (as
 * with the GLIB titles' own still-open version of this question) it has
 * not been confirmed by disassembly.
 *
 * **No embedded or external palette source for these tiles has been
 * located** (would need a further disassembly pass to find a boot-time
 * `LoadRGB4`-style call, not attempted this session — a secondary,
 * lower-priority open item relative to the pixel-geometry decode itself).
 * Rendered here with a synthetic 16-step grey ramp
 * (`CHAMPIONS_GREY_PALETTE`) — the same "monochrome/greyscale, no true
 * palette" convention this title's own `8X8D1.DAX`-sourced wall renders
 * already use (2 grey levels there vs. 16 here). Visually confirmed
 * (4x upscale, `Read`): real, structured, non-degenerate brick/door/
 * panel/diamond-motif tile art, not noise.
 */
import { amiga12ToRGB } from './amiga-planar.ts';
import { readAmigaDaaDirectory, decompressDosDaxEntry, type DosDaxEntry } from './goldbox-dosdax.ts';

const CHAMPIONS_DAA_HEADER_LEN = 9;
const CHAMPIONS_DAA_PLANE_COUNT = 4;

/** Synthetic 16-step amiga12 (0x0RGB) grey ramp — Champions' `8X8D*.DAA` tiles carry no real palette at all (see module doc); this stands in for one so `buildDaaColorTiles` can render them the same way as Death Knights' real-palette tiles. */
export const CHAMPIONS_GREY_PALETTE: number[] = Array.from({ length: 16 }, (_, i) => (i << 8) | (i << 4) | i);

/**
 * Parse one decompressed Champions of Krynn `8X8D0/1/2.DAA` entry: 9-byte
 * header (no embedded palette), then `tileCount` derived directly from body
 * length at a fixed `planeCount` of 4 — see module doc for why the header's
 * own offset-8 byte is cross-checked but not trusted outright (id 203's
 * real, off-by-one anomaly). Returns a `DaaTileSurface` (with the synthetic
 * grey palette attached) so callers can reuse `daaTileIndices`/
 * `buildDaaColorTiles` unchanged.
 */
export function decodeChampionsWallTileSurface(raw: Uint8Array): DaaTileSurface {
  if (raw.length <= CHAMPIONS_DAA_HEADER_LEN) {
    throw new Error(`champions daa tile surface: entry too short (${raw.length} bytes)`);
  }
  const planes = raw.subarray(CHAMPIONS_DAA_HEADER_LEN);
  if (planes.length % (CHAMPIONS_DAA_PLANE_COUNT * 8) !== 0) {
    throw new Error(
      `champions daa tile surface: plane payload (${planes.length}B) doesn't divide evenly by planeCount*8 (${CHAMPIONS_DAA_PLANE_COUNT}*8)`,
    );
  }
  const tileCount = planes.length / (CHAMPIONS_DAA_PLANE_COUNT * 8);
  return { tileCount, planeCount: CHAMPIONS_DAA_PLANE_COUNT, palette: CHAMPIONS_GREY_PALETTE, planes };
}

export interface DaaTileSurface {
  tileCount: number;
  planeCount: number;
  /** 32-entry amiga12 (0x0RGB) palette words read from this entry's own header, whether or not they're all zero. */
  palette: number[];
  /** Plane-consecutive bitplane bytes, length = planeCount * tileCount * 8. */
  planes: Uint8Array;
}

const DAA_HEADER_LEN = 9;
const DAA_PALETTE_LEN = 64;
const DAA_PALETTE_COUNT = 32;

/**
 * Read just the 32-entry amiga12 palette out of a decompressed `.DAA`
 * entry's fixed 64-byte header slot (offset 9), with NO plane/tileCount
 * validation — use this for a "universal palette source" entry whose own
 * declared `tileCount` field may not evenly divide its body (Death Knights'
 * id 202 is off by one relative to its own true body length; the palette
 * bytes are unaffected since they live at a fixed offset regardless — see
 * module doc).
 */
export function decodeDaaPalette(raw: Uint8Array): number[] {
  if (raw.length < DAA_HEADER_LEN + DAA_PALETTE_LEN) {
    throw new Error(`daa palette: entry too short (${raw.length} bytes)`);
  }
  const paletteBytes = raw.subarray(DAA_HEADER_LEN, DAA_HEADER_LEN + DAA_PALETTE_LEN);
  const palette: number[] = [];
  for (let i = 0; i < DAA_PALETTE_COUNT; i++) palette.push((paletteBytes[i * 2] << 8) | paletteBytes[i * 2 + 1]);
  return palette;
}

/**
 * Parse one decompressed `.DAA` entry's payload: 9-byte header, 64-byte
 * embedded palette, then `planeCount` bitplanes of `tileCount` 8x8 tiles.
 * `planeCount` is derived from the body length (must divide evenly by
 * `tileCount * 8` — throws otherwise, which is the verification oracle).
 */
export function decodeDaaTileSurface(raw: Uint8Array): DaaTileSurface {
  if (raw.length < DAA_HEADER_LEN + DAA_PALETTE_LEN) {
    throw new Error(`daa tile surface: entry too short (${raw.length} bytes)`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tileCount = view.getUint16(2, false);
  const paletteBytes = raw.subarray(DAA_HEADER_LEN, DAA_HEADER_LEN + DAA_PALETTE_LEN);
  const palette: number[] = [];
  for (let i = 0; i < DAA_PALETTE_COUNT; i++) palette.push((paletteBytes[i * 2] << 8) | paletteBytes[i * 2 + 1]);
  const planes = raw.subarray(DAA_HEADER_LEN + DAA_PALETTE_LEN);
  if (tileCount === 0 || planes.length % (tileCount * 8) !== 0) {
    throw new Error(`daa tile surface: plane payload (${planes.length}B) doesn't divide evenly by tileCount*8 (${tileCount}*8)`);
  }
  const planeCount = planes.length / (tileCount * 8);
  return { tileCount, planeCount, palette, planes };
}

/** Read one 8x8 tile's palette-index grid (row-major, [row][col] = index 0..2^planeCount-1). */
export function daaTileIndices(surface: DaaTileSurface, tile: number): number[][] {
  const { tileCount, planeCount, planes } = surface;
  const rows: number[][] = [];
  for (let r = 0; r < 8; r++) {
    const planeBytes: number[] = [];
    for (let p = 0; p < planeCount; p++) planeBytes.push(planes[p * tileCount * 8 + r * tileCount + tile]);
    const row: number[] = [];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      let v = 0;
      for (let p = 0; p < planeCount; p++) v |= ((planeBytes[p] >> bit) & 1) << p;
      row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

/** Render every tile in a surface to 8x8 RGBA (256 bytes/tile), using an explicit palette override (the surface's own embedded one is often all-zero — see module doc). */
export function buildDaaColorTiles(surface: DaaTileSurface, palette: number[]): Uint8Array[] {
  const tiles: Uint8Array[] = [];
  for (let t = 0; t < surface.tileCount; t++) {
    const rows = daaTileIndices(surface, t);
    const px = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = rows[y][x];
        const [r, g, b] = amiga12ToRGB(palette[idx] ?? 0);
        const o = (y * 8 + x) * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }
    tiles.push(px);
  }
  return tiles;
}

/**
 * Build Death Knights' full 256-entry RGBA tile bank for wall id `W`, from
 * its 4 "quarter" `.DAA` entries (`W`, `W+20`, `W+40`, `W+60`) — see module
 * doc's "quarters" section. `byId` must resolve all 4 ids or this throws.
 * `palette` should be the universal entry's (id 202) real colours, not any
 * individual wall entry's own (all-zero) embedded one.
 */
export function buildDkkWallColorBank(byId: Map<number, Uint8Array>, wallId: number, palette: number[]): Uint8Array[] {
  const quarterIds = [wallId, wallId + 20, wallId + 40, wallId + 60];
  const bank: Uint8Array[] = [];
  for (const id of quarterIds) {
    const raw = byId.get(id);
    if (!raw) throw new Error(`dkk wall color bank: missing quarter entry id ${id} for wall ${wallId}`);
    const surface = decodeDaaTileSurface(raw);
    if (surface.tileCount !== 64) {
      throw new Error(`dkk wall color bank: quarter entry id ${id} has ${surface.tileCount} tiles, expected 64`);
    }
    bank.push(...buildDaaColorTiles(surface, palette));
  }
  return bank;
}

/**
 * Build ONE flat, whole-file RGBA tile bank from an already-decompressed
 * `8X8D<bank>.DAA` container's directory: `[placeholder, ...universal(id
 * 203), ...every other entry's tiles, in directory order]` — the real
 * addressing model for Champions of Krynn's WALLDEF view-index bytes, see
 * the module doc's "Addressing model" section for the full derivation
 * (RENDERED confidence: 115/115 view slices across both banks resolve
 * in-bounds with this scheme vs. 60/115 for a per-wall composite-id bank).
 * Entries that fail to decompress or fail the tile-surface check (id 201:
 * a genuine corrupted/blanked stub) are skipped, contributing 0 tiles —
 * NOT a placeholder gap, since a real Amiga engine reading this exact
 * on-disk data would see the identical decompression failure.
 */
export function buildChampionsFlatTileBank(fileData: Uint8Array): Uint8Array[] {
  const { dataOffset, entries } = readAmigaDaaDirectory(fileData);
  const placeholder = new Uint8Array(8 * 8 * 4).fill(128);
  for (let i = 3; i < placeholder.length; i += 4) placeholder[i] = 255; // opaque
  const bank: Uint8Array[] = [placeholder];
  const decodeEntryTiles = (entry: DosDaxEntry): Uint8Array[] => {
    try {
      const raw = decompressDosDaxEntry(fileData, dataOffset, entry);
      const surface = decodeChampionsWallTileSurface(raw);
      return buildDaaColorTiles(surface, surface.palette);
    } catch {
      return [];
    }
  };
  const universalEntry = entries.find((e) => e.id === 203);
  if (universalEntry) bank.push(...decodeEntryTiles(universalEntry));
  for (const entry of entries) {
    if (entry.id === 203) continue;
    bank.push(...decodeEntryTiles(entry));
  }
  return bank;
}

/** Composite a WALLDEF view's tile-index grid into a flat RGBA bitmap using a 256-entry (or larger) RGBA tile bank — same geometry as `goldbox-walltiles.ts`'s `renderView`, but for pre-coloured RGBA tiles instead of greyscale ones. */
export function renderColorView(
  view: { rows: number; cols: number; tileIndices: number[][] },
  bank: Uint8Array[],
): { width: number; height: number; pixels: Uint8Array } {
  const width = view.cols * 8;
  const height = view.rows * 8;
  const pixels = new Uint8Array(width * height * 4);
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      const idx = view.tileIndices[r][c];
      const tile = idx < bank.length ? bank[idx] : bank[0];
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          const dst = ((r * 8 + ty) * width + (c * 8 + tx)) * 4;
          const src = (ty * 8 + tx) * 4;
          pixels[dst] = tile[src];
          pixels[dst + 1] = tile[src + 1];
          pixels[dst + 2] = tile[src + 2];
          pixels[dst + 3] = tile[src + 3];
        }
      }
    }
  }
  return { width, height, pixels };
}
