/**
 * Payload format for Amiga-native `.DAA` 8x8-tile-bank entries (Death
 * Knights of Krynn's `8x8d1.daa`, Champions of Krynn's `8X8D0/1/2.DAA`) —
 * once decompressed via `goldbox-dosdax.ts`'s `decodeAmigaDaaFile`.
 *
 * Cracked via a `re-oracle` escalation (2026-09-01), independently
 * re-verified against real bytes this session.
 *
 * ## Entry payload shape — CONFIRMED
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
 * `planeCount` is 5 for Death Knights' `8x8d1.daa` (32-colour tiles) and 4
 * for Champions' `8X8D*.DAA` (16-colour tiles) — not stored in the header;
 * derived per-file from `(payloadAfterPaletteLen) / (tileCount * 8)`, which
 * divides evenly for every wall-specific entry sampled (5.0/4.0 exactly,
 * zero remainder) in both files. One Death Knights entry (id 202, the
 * palette-source entry itself) has a `tileCount` field that is off by
 * exactly one relative to its own true payload length (`45` vs. the `46`
 * that divides its body evenly, matching sibling id 203's declared count
 * for an identical-length body) — a real, minor, non-blocking authoring
 * anomaly in that one entry; it doesn't affect palette extraction (the
 * palette lives at a fixed 64-byte offset regardless of the tile count
 * field) and this decoder never treats id 202 as a tile bank.
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
 */
import { amiga12ToRGB } from './amiga-planar.ts';

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
