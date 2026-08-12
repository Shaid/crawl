/**
 * MM2 (Amiga) `.32` image-sheet codec — the shared "Image Chunk" bitmap
 * container used by `.32` sheets at offset 0 and by `.anm` files after their
 * TV header (`FF 00` marker).
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/55-graphics-formats-reference.md`
 * §2; cross-checked against the round-trip encoder `tools/encode_image32.py`
 * and `scifi_town_common.py`). All byte values are **big-endian** (u16be).
 *
 *   +0   u16be         frame_count
 *   +2   u16be         depth_or_mode   — sheet category tag; NOT a plane count
 *   +4   FrameInfo[]   frame_count × 6 bytes: { u16be w, u16be h, u16be flags }
 *   +P   u16be[32]     0x0RGB palette (4 bits/channel)
 *   +Q   byte[]        one nibble-RLE stream per frame, back to back
 *
 * Every frame is exactly 5 bitplanes (word-aligned rows):
 *
 *   bpr        = ((width + 15) >> 3) & ~1
 *   rassize(w,h)= height * bpr
 *   frame_bytes = 5 * rassize(width, height)
 *
 * Pixel index at (x, y) is the 5-bit value assembled from bit
 * `7 - (x & 7)` of byte `y*bpr + (x>>3)` in each plane p (contribution `1<<p`).
 * Palette index 0 is the transparency key at blit time.
 *
 * Nibble-RLE (flat nibble stream that packs MSB-first into the output bytes):
 *   byte p, high nibble H = p>>4:
 *     H == 0x0 or 0xF  -> run: emit nibble H repeated (p & 0x0F) + 1 times
 *     otherwise        -> literal pair: emit (p>>4), then (p & 0x0F)
 *
 * Verified: synthetic round-trip (encode→decode→encode is byte-stable,
 * decode→encode→decode is pixel-stable) plus a real-data round-trip over the
 * decoded frame planes of `51.anm` (see `tools/mm2/fixtures/anm_decoded/51`).
 * The RLE *decoder* is a faithful port of the ground-truth decoder that
 * produced those plane files; the exact original RLE stream bytes are not in
 * this repo (no retail data), so byte-for-byte agreement with the original
 * stream is not asserted — see docs/mm2/TODO.md.
 */
import type { RGB } from '../shared/amiga-planar.ts';

export const IMAGE32_PLANES = 5;
export const IMAGE32_PALETTE_COLORS = 32;

export interface Image32FrameInfo {
  width: number;
  height: number;
  flags: number;
}

export interface Image32Frame extends Image32FrameInfo {
  /** width × height palette indices, row-major. */
  indices: Uint8Array;
}

export interface Image32File {
  frameCount: number;
  depthOrMode: number;
  frames: Image32Frame[];
  /** 32 raw Amiga 0x0RGB words. */
  paletteWords: number[];
  /** Number of bytes consumed by each frame's RLE stream (verification aid). */
  consumed: number[];
}

/** Word-aligned bytes per plane row (`((width + 15) >> 3) & ~1`). */
export function image32BytesPerRow(width: number): number {
  return ((width + 15) >> 3) & ~1;
}

/** Size of one bitplane of a frame (`height * bytesPerRow`). */
export function image32Rassize(width: number, height: number): number {
  return height * image32BytesPerRow(width);
}

/** Total uncompressed size of one frame's 5 concatenated bitplanes. */
export function image32FrameBytes(width: number, height: number): number {
  return IMAGE32_PLANES * image32Rassize(width, height);
}

/**
 * Decode the documented nibble-RLE stream to exactly `outBytes` bytes.
 * Returns the decoded bytes and the offset just past the consumed input.
 */
export function decodeNibbleRle(data: Uint8Array, offset: number, outBytes: number): { bytes: Uint8Array; next: number } {
  const out = new Uint8Array(outBytes);
  let outLen = 0;
  let pending: number | null = null;
  let cur = offset;

  const emit = (nib: number) => {
    if (outLen >= outBytes) return;
    if (pending === null) {
      pending = nib & 0x0f;
    } else {
      out[outLen++] = ((pending & 0x0f) << 4) | (nib & 0x0f);
      pending = null;
    }
  };

  while (outLen < outBytes) {
    if (cur >= data.length) throw new Error(`Unexpected EOF in nibble-RLE stream (wanted ${outBytes} bytes, got ${outLen})`);
    const p = data[cur++];
    const high = p >> 4;
    if (high === 0x0 || high === 0xf) {
      const times = (p & 0x0f) + 1;
      for (let i = 0; i < times; i++) {
        emit(high);
        if (outLen >= outBytes) break;
      }
    } else {
      emit(high);
      emit(p & 0x0f);
    }
  }

  return { bytes: out, next: cur };
}

/**
 * Encode a byte stream to the nibble-RLE format: 0x0/0xF nibble runs up to
 * 16 long, literal pairs for everything else. A trailing lone literal nibble
 * is padded with 0 (harmless — the decoder stops at the byte budget).
 */
export function encodeNibbleRle(stream: Uint8Array): Uint8Array {
  const nibs = new Uint8Array(stream.length * 2);
  for (let i = 0; i < stream.length; i++) {
    nibs[2 * i] = stream[i] >> 4;
    nibs[2 * i + 1] = stream[i] & 0x0f;
  }
  const out: number[] = [];
  let i = 0;
  const n = nibs.length;
  while (i < n) {
    const v = nibs[i];
    if (v === 0x0 || v === 0xf) {
      let j = i + 1;
      while (j < n && nibs[j] === v && j - i < 16) j++;
      out.push((v << 4) | (j - i - 1));
      i = j;
    } else {
      const lo = i + 1 < n ? nibs[i + 1] : 0;
      out.push((v << 4) | lo);
      i += 2;
    }
  }
  return Uint8Array.from(out);
}

/** Pack palette-index pixels into 5 concatenated word-aligned bitplanes. */
export function packPlanes(indices: Uint8Array, width: number, height: number): Uint8Array {
  const bpr = image32BytesPerRow(width);
  const rs = image32Rassize(width, height);
  const planes = new Uint8Array(IMAGE32_PLANES * rs);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x];
      if (v === 0) continue;
      const byteOff = y * bpr + (x >> 3);
      const bit = 7 - (x & 7);
      for (let p = 0; p < IMAGE32_PLANES; p++) {
        if (v & (1 << p)) planes[p * rs + byteOff] |= 1 << bit;
      }
    }
  }
  return planes;
}

/** Unpack 5 concatenated word-aligned bitplanes into palette indices. */
export function unpackPlanes(planes: Uint8Array, width: number, height: number): Uint8Array {
  const bpr = image32BytesPerRow(width);
  const rs = image32Rassize(width, height);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      const byteOff = y * bpr + (x >> 3);
      const bit = 7 - (x & 7);
      for (let p = 0; p < IMAGE32_PLANES; p++) {
        if (planes[p * rs + byteOff] & (1 << bit)) v |= 1 << p;
      }
      indices[y * width + x] = v;
    }
  }
  return indices;
}

/** Decode a `.32` image chunk starting at `offset` (0 for a whole `.32` file). */
export function decodeImage32(data: Uint8Array, offset = 0): Image32File {
  const u16 = (o: number) => (data[o] << 8) | data[o + 1];
  const frameCount = u16(offset);
  const depthOrMode = u16(offset + 2);
  if (frameCount === 0 || frameCount > 1024) {
    throw new Error(`decodeImage32: implausible frame_count ${frameCount} at offset ${offset}`);
  }

  const info: Image32FrameInfo[] = [];
  let cur = offset + 4;
  for (let i = 0; i < frameCount; i++) {
    info.push({ width: u16(cur), height: u16(cur + 2), flags: u16(cur + 4) });
    cur += 6;
  }

  const paletteWords: number[] = [];
  for (let i = 0; i < IMAGE32_PALETTE_COLORS; i++) {
    paletteWords.push(u16(cur));
    cur += 2;
  }

  const frames: Image32Frame[] = [];
  const consumed: number[] = [];
  for (const fi of info) {
    const frameBytes = image32FrameBytes(fi.width, fi.height);
    const { bytes, next } = decodeNibbleRle(data, cur, frameBytes);
    frames.push({ width: fi.width, height: fi.height, flags: fi.flags, indices: unpackPlanes(bytes, fi.width, fi.height) });
    consumed.push(next - cur);
    cur = next;
  }

  return { frameCount, depthOrMode, frames, paletteWords, consumed };
}

/** Convert the raw 0x0RGB words to an RGB table (8-bit per channel). */
export function paletteWordsToRGB(words: number[]): RGB[] {
  return words.map((w) => ({
    r: ((w >> 8) & 0x0f) * 17,
    g: ((w >> 4) & 0x0f) * 17,
    b: (w & 0x0f) * 17,
  }));
}

/**
 * Render one frame to RGBA. Index 0 renders fully transparent (the blitter's
 * pen-0 mask key) — pass `transparentIndex: null` for sheets where index 0 is
 * a real opaque colour.
 */
export function frameToRGBA(frame: Image32Frame, palette: RGB[], opts?: { transparentIndex?: number | null }): Uint8Array {
  const transparentIndex = opts?.transparentIndex === undefined ? 0 : opts.transparentIndex;
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0; i < frame.indices.length; i++) {
    const c = palette[frame.indices[i]] ?? { r: 0, g: 0, b: 0 };
    const o = i * 4;
    rgba[o] = c.r;
    rgba[o + 1] = c.g;
    rgba[o + 2] = c.b;
    rgba[o + 3] = frame.indices[i] === transparentIndex ? 0 : 255;
  }
  return rgba;
}

/** Build a complete `.32` file from indexed frames + palette words + depth tag. */
export function encodeImage32(
  frames: { width: number; height: number; flags: number; indices: Uint8Array }[],
  paletteWords: number[],
  depthOrMode: number,
): Uint8Array {
  if (paletteWords.length !== IMAGE32_PALETTE_COLORS) {
    throw new Error(`encodeImage32: palette must have ${IMAGE32_PALETTE_COLORS} entries, got ${paletteWords.length}`);
  }
  if (frames.length === 0 || frames.length > 1024) {
    throw new Error(`encodeImage32: implausible frame count ${frames.length}`);
  }
  const head = new Uint8Array(4 + frames.length * 6 + IMAGE32_PALETTE_COLORS * 2);
  const w = new DataView(head.buffer);
  w.setUint16(0, frames.length);
  w.setUint16(2, depthOrMode);
  let cur = 4;
  for (const f of frames) {
    if (f.indices.length !== f.width * f.height) {
      throw new Error(`encodeImage32: indices length ${f.indices.length} != ${f.width}×${f.height}`);
    }
    w.setUint16(cur, f.width);
    w.setUint16(cur + 2, f.height);
    w.setUint16(cur + 4, f.flags);
    cur += 6;
  }
  for (let i = 0; i < IMAGE32_PALETTE_COLORS; i++) {
    w.setUint16(cur, paletteWords[i]);
    cur += 2;
  }

  const parts: Uint8Array[] = [head];
  for (const f of frames) {
    parts.push(encodeNibbleRle(packPlanes(f.indices, f.width, f.height)));
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
