/**
 * Ishar-engine (Silmarils "ALIS") per-script sprite/image directory + pixel
 * decoder. Applies to the DECOMPRESSED payload of any `.DO`/`.CO` resource
 * once `unpackSilmarilsScript()` (`silmarils-unpack.ts`) has stripped the
 * container header — see `docs/ishar-sprite-format.md` for the full
 * derivation and verification evidence.
 *
 * Ground truth for this whole module: `github.com/maestun/alis` (MIT), a
 * real, from-scratch, source-available reimplementation of the ALIS VM that
 * the project's own README documents as "Playable" for Ishar 1/2/3 on
 * Amiga AGA specifically (not just some other platform) — i.e. an oracle at
 * exactly the confidence level this project's Method §4 calls out for a
 * third-party reimplementation. Two mechanisms are ported from it here:
 *
 * 1. `adresdes()` (`src/alis.c`) — the VM's per-script resource-lookup
 *    formula. A script's own decompressed bytes hold, at fixed offset
 *    0x0E, a 32-bit self-relative pointer to a small "directory" header:
 *    `u32 baseDelta` (offset +0) then `u16 length` (offset +4, resource
 *    count). Each resource `idx` (0..length-1) has a 4-byte "slot" at
 *    `dirOff + baseDelta + idx*4`; the slot itself holds a FURTHER
 *    self-relative `s32` delta which, added to the slot's own address,
 *    gives the real bitmap-header address (a 2-level indirection: slot
 *    address -> stored delta -> real header). `baseDelta` was observed
 *    corpus-wide as one of exactly two small constants (1144 or 88) —
 *    consistent with a real, engine-fixed directory-header size, not
 *    per-file tuning.
 * 2. `destofen()`/`draw_4to8bit_0`/`draw_8bit_0`/`draw_st_4bit_0`
 *    (`src/image.c`) — the bitmap-header layout and pixel decode. A
 *    resolved bitmap header starts with `u8 type`, `s16 BE storedWidth`/
 *    `storedHeight` (real dimension = stored+1), then a type-dependent
 *    payload:
 *    - `0x00`/`0x02` ("draw_st_4bit_*", masked/opaque) — 4-bit nibble-
 *      packed, pixel data starting immediately at header+6, values used
 *      as raw palette indices 0-15. Almost the only type seen in Crystals
 *      of Arborea (an older/related-but-not-identical engine revision).
 *    - `0x10`/`0x12` ("draw_4to8bit_*", masked/opaque) — 4-bit nibble-
 *      packed, `u8 palOffset` at header+6 (a 16-colour bank selector into
 *      a 256-colour AGA palette, added to each decoded nibble) + 1
 *      reserved byte, pixel data starting at header+8. The dominant type
 *      across Ishar 1-3.
 *    - `0x14`/`0x16` ("draw_8bit_*", masked/opaque) — one palette-index
 *      byte per pixel (no bank offset), 2 reserved bytes, pixel data at
 *      header+8. Common in Ishar 3 specifically.
 *    Every other type byte in the reference source (rect fills, Mac mono,
 *    DOS CGA, FLI video, the Transarctica/Robinson's-Requiem-specific map
 *    renderer) is not implemented here — not observed in this corpus.
 *    4-bit rows are `width/2` bytes (high nibble = first pixel, low
 *    nibble = second); 8-bit rows are `width` bytes, one index per pixel.
 *    "Masked" types (0x00/0x10/0x14) treat index 0 as transparent (never
 *    written by the reference draw routine); "opaque" types (0x02/0x12/
 *    0x16) draw every pixel including index 0.
 *
 * Verification (this session): applied blind to real corpus bytes with
 * zero hand-tuning beyond the ported formulas above. `ARBRE.DO` ("tree")
 * idx1/idx4, `ORC.DO` ("orc") idx0, and `DRAGON.DO` idx0 all decode to
 * immediately recognisable game art (a tree canopy+trunk, a hunched
 * humanoid/monster silhouette) when rendered greyscale (no real palette
 * recovered yet — see the module doc). Corpus-wide: 86-119/98-148 files
 * per title have a structurally valid directory (plausible `length`,
 * `baseDelta` matching the two known constants); of ~3100-5100 resolved
 * entries per title, 82-90% resolve to a plausible width/height (0 <
 * dimension <= 2000) — the remainder are `type=0xff`/other placeholder
 * slots or types genuinely not implemented here (Mac/DOS-CGA/FLI-video/
 * map-renderer types; see `docs/ishar-sprite-format.md` "Open").
 *
 * NOT yet recovered: the real AGA colour palette a `palOffset` bank
 * indexes into (palettes are resolved by VM bytecode via the same
 * `adresdes()` index space, contextually, not by any static marker on the
 * palette resource itself — see the doc's "Open" section). Every render
 * this module produces is therefore RENDERED/greyscale, not CONFIRMED
 * colour.
 *
 * Visualization caveat found this session: `isharBitmapToGreyscaleRGBA()`'s
 * fixed 0-255 scale silently renders any bitmap whose real index range sits
 * in a narrow `palOffset`-shifted band (common for `palOffset` > ~40) as a
 * near-flat block, even though the underlying decode is fine and the real
 * indices vary normally — see `isharBitmapToNormalizedGreyscaleRGBA()`'s doc
 * comment for the confirming histogram. The already-shipped sprite atlas
 * (`ishar-sprite-atlas.ts`) still uses the fixed-scale function and was NOT
 * re-rendered this session (out of scope for the first-person-view task that
 * found this) — a corpus-wide re-check of the atlas with the normalized
 * function is a plausible, undone follow-up.
 */

export type IsharBitmapType = 0x00 | 0x02 | 0x10 | 0x12 | 0x14 | 0x16;

/** "draw_st_4bit_*" in the reference source -- raw 4-bit nibble, NO palette-bank byte/skip (pixel data starts at header+6, not +8). Seen almost exclusively in Crystals of Arborea. */
const MASKED_4BIT_RAW: IsharBitmapType = 0x00;
const OPAQUE_4BIT_RAW: IsharBitmapType = 0x02;
/** "draw_4to8bit_*" -- 4-bit nibble + a per-image 16-colour bank byte (palOffset) into a 256-colour palette. The dominant type across Ishar 1-3. */
const MASKED_4BIT: IsharBitmapType = 0x10;
const OPAQUE_4BIT: IsharBitmapType = 0x12;
/** "draw_8bit_*" -- one palette-index byte per pixel, no bank offset. */
const MASKED_8BIT: IsharBitmapType = 0x14;
const OPAQUE_8BIT: IsharBitmapType = 0x16;

const SUPPORTED_TYPES = new Set<number>([
  MASKED_4BIT_RAW,
  OPAQUE_4BIT_RAW,
  MASKED_4BIT,
  OPAQUE_4BIT,
  MASKED_8BIT,
  OPAQUE_8BIT,
]);

export interface IsharDirectory {
  /** File-relative offset of the directory header (`xread32(data, 0xe)`). */
  dirOff: number;
  /** Resource count (`xread16(dirOff+4)`). */
  length: number;
  /** Self-relative base delta from the directory header to the slot array (`xread32(dirOff)`). */
  baseDelta: number;
}

export interface IsharBitmap {
  index: number;
  /** Resolved absolute offset of the bitmap header within `data`. */
  headerOffset: number;
  type: IsharBitmapType;
  /** Real pixel width (`storedWidth + 1`). */
  width: number;
  /** Real pixel height (`storedHeight + 1`). */
  height: number;
  /** 16-colour bank offset for 4-bit types; 0 for 8-bit types. */
  palOffset: number;
  /** One palette-index byte per pixel, row-major. 0 means "transparent" for masked types (0x10/0x14) only. */
  indices: Uint8Array;
  masked: boolean;
}

function u32(data: Uint8Array, o: number): number {
  return ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
}
function i32(data: Uint8Array, o: number): number {
  return u32(data, o) | 0;
}
function u16(data: Uint8Array, o: number): number {
  return (data[o] << 8) | data[o + 1];
}
function i16(data: Uint8Array, o: number): number {
  const v = u16(data, o);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Locate a script's own resource directory. Returns `null` if the file is
 * too short or the header fields fail basic sanity (directory offset out
 * of range, resource count implausibly large) -- callers should treat that
 * as "this resource has no directory" (e.g. plain text/table resources),
 * not an error.
 */
export function findIsharDirectory(data: Uint8Array): IsharDirectory | null {
  if (data.length < 0x14) return null;
  const dirOff = u32(data, 0x0e);
  if (dirOff <= 0 || dirOff + 8 > data.length) return null;
  const baseDelta = u32(data, dirOff);
  const length = u16(data, dirOff + 4);
  if (length <= 0 || length >= 4096) return null;
  return { dirOff, length, baseDelta };
}

/** Resolve resource `idx`'s bitmap-header offset via the slot's self-relative delta. Returns -1 if out of bounds. */
export function resolveIsharSlot(data: Uint8Array, dir: IsharDirectory, idx: number): number {
  const slotAddr = dir.dirOff + dir.baseDelta + idx * 4;
  if (slotAddr < 0 || slotAddr + 4 > data.length) return -1;
  const delta = i32(data, slotAddr);
  const headerOffset = slotAddr + delta;
  if (headerOffset < 0 || headerOffset + 8 > data.length) return -1;
  return headerOffset;
}

/** Decode one resolved bitmap header + its pixel data. Returns `null` for an unsupported/placeholder type byte. */
export function decodeIsharBitmap(data: Uint8Array, index: number, headerOffset: number): IsharBitmap | null {
  const type = data[headerOffset];
  if (!SUPPORTED_TYPES.has(type)) return null;

  const storedW = i16(data, headerOffset + 2);
  const storedH = i16(data, headerOffset + 4);
  const width = storedW + 1;
  const height = storedH + 1;
  if (width <= 0 || height <= 0 || width > 2000 || height > 2000) return null;

  const isRaw4bit = type === MASKED_4BIT_RAW || type === OPAQUE_4BIT_RAW;
  const palOffset = isRaw4bit ? 0 : data[headerOffset + 6];
  const pixelStart = isRaw4bit ? headerOffset + 6 : headerOffset + 8;
  const indices = new Uint8Array(width * height);
  const masked = type === MASKED_4BIT_RAW || type === MASKED_4BIT || type === MASKED_8BIT;
  const is4bit = isRaw4bit || type === MASKED_4BIT || type === OPAQUE_4BIT;

  if (is4bit) {
    const rowBytes = width >> 1;
    if (pixelStart + rowBytes * height > data.length) return null;
    for (let y = 0; y < height; y++) {
      const rowOff = pixelStart + y * rowBytes;
      for (let xb = 0; xb < rowBytes; xb++) {
        const byte = data[rowOff + xb];
        const hi = byte >> 4;
        const lo = byte & 0x0f;
        indices[y * width + xb * 2] = hi === 0 ? 0 : palOffset + hi;
        indices[y * width + xb * 2 + 1] = lo === 0 ? 0 : palOffset + lo;
      }
    }
  } else {
    if (pixelStart + width * height > data.length) return null;
    for (let y = 0; y < height; y++) {
      const rowOff = pixelStart + y * width;
      for (let x = 0; x < width; x++) {
        indices[y * width + x] = data[rowOff + x];
      }
    }
  }

  return { index, headerOffset, type: type as IsharBitmapType, width, height, palOffset, indices, masked };
}

/** Walk a script's whole directory, decoding every resolvable entry (skipping unsupported/OOB ones). */
export function decodeIsharDirectory(data: Uint8Array): IsharBitmap[] {
  const dir = findIsharDirectory(data);
  if (!dir) return [];
  const out: IsharBitmap[] = [];
  for (let idx = 0; idx < dir.length; idx++) {
    const headerOffset = resolveIsharSlot(data, dir, idx);
    if (headerOffset < 0) continue;
    const bmp = decodeIsharBitmap(data, idx, headerOffset);
    if (bmp) out.push(bmp);
  }
  return out;
}

/**
 * Render a decoded bitmap's palette-index buffer as greyscale RGBA (Method
 * §3: render candidates as greyscale first -- no real AGA palette has been
 * recovered for this engine yet, see the module doc). Index 0 is
 * transparent for masked types, opaque black otherwise.
 */
export function isharBitmapToGreyscaleRGBA(bmp: IsharBitmap): Uint8Array {
  const rgba = new Uint8Array(bmp.width * bmp.height * 4);
  for (let i = 0; i < bmp.indices.length; i++) {
    const idx = bmp.indices[i];
    const transparent = bmp.masked && idx === 0;
    const grey = idx === 0 ? 0 : Math.min(255, 40 + Math.round((idx / 255) * 200));
    rgba[i * 4] = grey;
    rgba[i * 4 + 1] = grey;
    rgba[i * 4 + 2] = grey;
    rgba[i * 4 + 3] = transparent ? 0 : 255;
  }
  return rgba;
}

/**
 * Same as `isharBitmapToGreyscaleRGBA()`, but min-max-stretches the grey
 * value against the bitmap's OWN observed non-transparent index range
 * instead of a fixed 0-255 scale. `isharBitmapToGreyscaleRGBA()`'s fixed
 * scale assumes the raw index spans close to the full 0-255 range; for a
 * 4-bit bitmap with a non-zero `palOffset` bank (`palOffset + nibble`,
 * nibble 1-15), the real value range is a ~15-wide band positioned
 * anywhere in 0-255 (e.g. `palOffset=86` -> indices 87-101), which the
 * fixed scale compresses into a handful of adjacent grey levels -- real
 * internal structure becomes visually indistinguishable from a flat block
 * even though the underlying decoded indices vary normally (confirmed via
 * a raw index histogram on two `FOND.bin` backdrop sprites this session:
 * 9 distinct values, well-distributed, silently rendered near-flat by the
 * fixed-scale function). Use this whenever a render needs to be visually
 * legible for verification purposes (Method §3); use the fixed-scale
 * version when comparing greyscale levels ACROSS different bitmaps needs
 * to stay meaningful (e.g. the shared sprite atlas, unchanged here to avoid
 * altering its already-shipped output as a side effect of an unrelated
 * task -- see `docs/ishar-sprite-format.md`'s Open section for the
 * generalized version of this finding).
 */
export function isharBitmapToNormalizedGreyscaleRGBA(bmp: IsharBitmap): Uint8Array {
  let min = 255;
  let max = 0;
  for (const idx of bmp.indices) {
    if (bmp.masked && idx === 0) continue;
    if (idx < min) min = idx;
    if (idx > max) max = idx;
  }
  const span = Math.max(1, max - min);
  const rgba = new Uint8Array(bmp.width * bmp.height * 4);
  for (let i = 0; i < bmp.indices.length; i++) {
    const idx = bmp.indices[i];
    const transparent = bmp.masked && idx === 0;
    const grey = transparent ? 0 : Math.round(30 + ((idx - min) / span) * 210);
    rgba[i * 4] = grey;
    rgba[i * 4 + 1] = grey;
    rgba[i * 4 + 2] = grey;
    rgba[i * 4 + 3] = transparent ? 0 : 255;
  }
  return rgba;
}
