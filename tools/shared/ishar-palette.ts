/**
 * Ishar-engine (Silmarils "ALIS") real AGA colour palette resolution + pixel
 * mapping. Resolves `docs/ishar/TODO.md`'s `ishar-sprite-palette` open item
 * (§5 of `docs/ishar-sprite-format.md`) for Ishar 1 specifically -- see that
 * doc section for the full derivation, corpus evidence, and remaining scope.
 *
 * Ground truth: `github.com/maestun/alis` (MIT) -- `topalette()` in
 * `src/image.c` (the palette-byte-decode formats) and `cpalette`/`ctopalet`
 * in `src/opcodes.c` (the two VM opcodes that call it, both resolving their
 * directory index via the SAME `adresdes()` mechanism `ishar-sprites.ts`
 * already implements for bitmaps -- see `resolveIsharSlot()`/
 * `findIsharDirectory()`, reused unmodified here).
 *
 * ## The two on-disk palette encodings (`topalette()`, AmigaAGA branch only)
 *
 * A resolved palette resource's header: `paldata[0]` unused by `topalette()`
 * itself but empirically CONFIRMED as a dedicated marker byte `0xFE` across
 * every palette resource found this session (62 hits across the Ishar 1
 * `.DO` corpus, 0 false positives when
 * cross-checked against known bitmap `type` bytes 0x00/0x02/0x10/0x12/0x14/
 * 0x16 and the 0xFF placeholder marker -- see `findIsharPaletteSlotIndex()`).
 * `paldata[1]` (`colors`) selects the format:
 *
 * - `colors === 0`: 16-colour Amiga/AmigaAGA-native nibble-packed format,
 *   `paldata[2..2+32)` -- 16 entries x 2 bytes, byte0 low nibble = R, byte1
 *   high nibble = G, byte1 low nibble = B (classic Amiga 12-bit `$0RGB`
 *   colour-register word read as two big-endian bytes), each scaled `<<4` to
 *   8-bit. Always written starting at palette slot 0 (no offset field).
 * - `colors !== 0`: AmigaAGA 24-bit RGB-triplet format (the code branch
 *   `topalette()` takes for every platform kind EXCEPT plain `EPlatformAmiga`
 *   -- Ishar 1-3 are `EPlatformAmigaAGA`; Crystals (`.CO`) is plain
 *   `EPlatformAmiga`, `platform.c:41`, but every Crystals palette is
 *   `colors === 0` so it takes the 16-colour path either way). `paldata[2]` = starting
 *   slot `offset`, `count = colors + 1` entries of raw `(r,g,b)` bytes from
 *   `paldata[4]` onward, written to slots `offset .. offset+count-1`
 *   INCLUSIVE (`for (i = offset; i <= offset + colors; i++)` in the C
 *   source -- an off-by-one trap if read as `count = colors` instead).
 *
 * `image.atpalet` (the VM's live 256-slot palette buffer) is never cleared
 * between `topalette()` calls -- each call only overwrites its own
 * `offset..offset+count-1` sub-range, leaving every other slot exactly as a
 * PRIOR call left it. This is CONFIRMED directly from `image.c`'s source (no
 * `memset`/full-buffer write anywhere in `topalette()`), and it is the real
 * engine mechanism this module's `mergeIsharPalettes()` reproduces: a
 * location's shared "world" palette (from `FOND.bin`'s own directory, see
 * below) supplies the persistent base, and a monster/entity script's own
 * dedicated palette resource (a small 16-colour bank, e.g. `DRAGON.bin`'s
 * slot 17 writing bank 64) overlays on top of it -- exactly reproducing what
 * a real play session's palette buffer would hold at that moment, NOT a
 * convenient rendering hack.
 *
 * ## Which directory index holds a scene's active palette
 *
 * `cpalette`/`ctopalet`'s index operand is frequently a runtime-computed
 * expression (a `basemain`-relative global byte, or a boolean condition
 * selecting between "restore" and a literal directory slot -- see
 * `docs/ishar-sprite-format.md` §5's "paths tried" table for the disassembly
 * trace that established this), so it cannot always be resolved by pure
 * static disassembly for an arbitrary scene. This module instead uses a
 * STRUCTURAL shortcut that sidesteps needing the runtime index at all: since
 * every palette resource carries its own `0xFE` marker byte,
 * `findIsharPaletteSlotIndex()` finds it directly by scanning a script's own
 * directory -- no bytecode trace required. This works cleanly for the
 * corpus's many single-purpose scripts (each monster/portrait/location-
 * interior script ships at most one dedicated `0xFE` palette, confirmed by
 * corpus census) and is the mechanism this module relies on throughout.
 * Outdoor location scripts (`FORET.bin`, `VILLAGE.bin`, etc.) carry NO
 * palette load of their own -- the BACKDROP script does it: `FOND.bin`
 * yields at `+0x64 cstop` and on its next tick runs `cselpalet(0);
 * cpalette(8)` (`cstop` is a per-frame yield in the reference, not an end;
 * 2026-11-13, `docs/ishar-sprite-format.md` §5 follow-up). Every backdrop
 * in Ishar 1-3 does the same with its own `0xFE` slot.
 */
import { findIsharDirectory, resolveIsharSlot, type IsharBitmap } from './ishar-sprites.js';

/** A resolved AGA palette. `colors[i]` is `undefined` for any slot no decoded palette resource ever wrote (never loaded, out of every resolved range). */
export interface IsharPalette {
  colors: Array<[number, number, number] | undefined>;
}

/** Empirically-confirmed marker byte at header+0 for every real palette resource in this corpus (distinct from all 6 bitmap `type` bytes and the `0xFF` placeholder marker -- see module doc). */
const PALETTE_MARKER = 0xfe;

interface DecodedPaletteChunk {
  /** First palette slot this chunk writes (`paldata[2]` for the 24-bit branch, always 0 for the 16-colour nibble-packed branch). */
  offset: number;
  colors: Array<[number, number, number]>;
}

function decodePaletteChunk(data: Uint8Array, headerOffset: number): DecodedPaletteChunk | null {
  const colors = data[headerOffset + 1];
  if (colors === undefined) return null;
  if (colors === 0) {
    // 16-colour Amiga/AmigaAGA nibble-packed format (topalette()'s `colors == 0` branch).
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const b0 = data[headerOffset + 2 + i * 2];
      const b1 = data[headerOffset + 2 + i * 2 + 1];
      if (b0 === undefined || b1 === undefined) return null;
      out.push([(b0 & 0x0f) << 4, (b1 >> 4) << 4, (b1 & 0x0f) << 4]);
    }
    return { offset: 0, colors: out };
  }
  // AmigaAGA 24-bit RGB-triplet format (topalette()'s non-plain-Amiga `else` branch).
  const offset = data[headerOffset + 2];
  const count = colors + 1; // INCLUSIVE range in the C source -- see module doc's off-by-one note.
  const out: Array<[number, number, number]> = [];
  let p = headerOffset + 4;
  if (p + count * 3 > data.length) return null;
  for (let i = 0; i < count; i++) {
    out.push([data[p]!, data[p + 1]!, data[p + 2]!]);
    p += 3;
  }
  return { offset, colors: out };
}

/** Find the first directory slot whose resolved header is marked as a palette resource (`0xFE`), or `null` if this script carries none of its own. */
export function findIsharPaletteSlotIndex(data: Uint8Array): number | null {
  const dir = findIsharDirectory(data);
  if (!dir) return null;
  for (let idx = 0; idx < dir.length; idx++) {
    const headerOffset = resolveIsharSlot(data, dir, idx);
    if (headerOffset < 0) continue;
    if (data[headerOffset] === PALETTE_MARKER) return idx;
  }
  return null;
}

/** Resolve + decode a script's own dedicated palette resource (its first `0xFE`-marked directory slot), if any. */
export function resolveIsharOwnPalette(data: Uint8Array): IsharPalette | null {
  const idx = findIsharPaletteSlotIndex(data);
  return idx === null ? null : resolveIsharPaletteSlot(data, idx);
}

/** Decode the palette resource at directory slot `idx` (what `cpalette idx` installs), or null if that slot is not a `0xFE` palette. */
export function resolveIsharPaletteSlot(data: Uint8Array, idx: number): IsharPalette | null {
  const dir = findIsharDirectory(data);
  if (!dir || idx < 0 || idx >= dir.length) return null;
  const headerOffset = resolveIsharSlot(data, dir, idx);
  if (headerOffset < 0 || data[headerOffset] !== PALETTE_MARKER) return null;
  const chunk = decodePaletteChunk(data, headerOffset);
  if (!chunk) return null;
  const colors: Array<[number, number, number] | undefined> = [];
  chunk.colors.forEach((c, i) => { colors[chunk.offset + i] = c; });
  return { colors };
}

/**
 * Overlay `own` on top of `fallback` (own entries win on overlap, unwritten
 * `own` slots fall through to `fallback`) -- reproduces the real engine's
 * persistent-palette-buffer semantics (see module doc). Either argument may
 * be `null`.
 */
export function mergeIsharPalettes(own: IsharPalette | null, fallback: IsharPalette | null): IsharPalette | null {
  if (!own) return fallback;
  if (!fallback) return own;
  const colors = [...fallback.colors];
  own.colors.forEach((c, i) => { if (c) colors[i] = c; });
  return { colors };
}

/** Neutral fallback colour for a decoded pixel index no resolved palette (own or merged-fallback) ever wrote -- deliberately a plain mid-grey rather than a garish/attention-grabbing colour, so a handful of uncovered indices don't wreck an otherwise-plausible render. */
const UNCOVERED_RGB: [number, number, number] = [128, 128, 128];

/** Map a decoded bitmap's palette-index buffer through a resolved AGA palette. Index 0 is transparent for masked types, as in `isharBitmapToGreyscaleRGBA()`. */
export function isharBitmapToPaletteRGBA(bmp: IsharBitmap, palette: IsharPalette): Uint8Array {
  const rgba = new Uint8Array(bmp.width * bmp.height * 4);
  for (let i = 0; i < bmp.indices.length; i++) {
    const idx = bmp.indices[i];
    const transparent = bmp.masked && idx === 0;
    const [r, g, b] = palette.colors[idx] ?? UNCOVERED_RGB;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = transparent ? 0 : 255;
  }
  return rgba;
}
