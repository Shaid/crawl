/**
 * Pool of Radiance (Amiga) `.dax` image / animation grammar — one grammar
 * covers all 511 image-class entries of 16 files with zero remainder
 * (audit 2026-11-13; `docs/poolofradiance/amiga/data-structure.md` §4/§5):
 *
 *  - IMAGE: 12-byte header `(u16 h, u16 wBytes, u16 x, u16 y, u16 count,
 *    u16 bpi)` with `bpi == h * even(wBytes)`, then 4 bitplanes, each holding
 *    all `count` items back to back (`bpi` bytes per item per plane, rows
 *    padded to an even byte count). Entry length == `12 + bpi*4*count`.
 *  - ANIMATION: `u16 0, u16 frames`, then per frame `u32 delay` + one IMAGE.
 *
 * Used by `8x8d` (items of 16x8 = two glyphs), `pic` (animated 88x88),
 * `cpic`, `sprit`, `cbody`, `head`, `body`, `chead`, `comspr`, `final`,
 * `icon`, `dungcom` (13 frames of 48x24), `wildcom`, `randcom`, `bacpac`,
 * `sqrpaci`. 4 planes = 16 colour indices; the palette has NOT been found
 * (`por-palette` in TODO.md), so this module returns indices only.
 */
export interface PorImage {
  h: number;
  /** Pixel width = wBytes * 8. */
  wBytes: number;
  x: number;
  y: number;
  count: number;
  /** Bytes per item per plane (= h * even(wBytes)). */
  bpi: number;
  /** Total bytes consumed, header included. */
  length: number;
  /** Item `i` as h*w colour indices (0..15), row-major, plane 0 = bit 0. */
  item(i: number): Uint8Array;
}

/** Parse one IMAGE at `pos`; `undefined` if the header or its exact-length invariant fails. */
export function parsePorImage(b: Uint8Array, pos = 0): PorImage | undefined {
  if (pos + 12 > b.length) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h = dv.getUint16(pos, false);
  const wBytes = dv.getUint16(pos + 2, false);
  const x = dv.getUint16(pos + 4, false);
  const y = dv.getUint16(pos + 6, false);
  const count = dv.getUint16(pos + 8, false);
  const bpi = dv.getUint16(pos + 10, false);
  const stride = wBytes + (wBytes & 1);
  if (h === 0 || wBytes === 0 || bpi !== h * stride) return undefined;
  const length = 12 + bpi * 4 * count;
  if (pos + length > b.length) return undefined;
  const item = (i: number): Uint8Array => {
    const out = new Uint8Array(h * wBytes * 8);
    for (let p = 0; p < 4; p++) {
      const base = pos + 12 + p * count * bpi + i * bpi;
      for (let row = 0; row < h; row++) {
        for (let cb = 0; cb < wBytes; cb++) {
          const v = b[base + row * stride + cb];
          for (let bit = 0; bit < 8; bit++) if (v & (0x80 >> bit)) out[row * wBytes * 8 + cb * 8 + bit] |= 1 << p;
        }
      }
    }
    return out;
  };
  return { h, wBytes, x, y, count, bpi, length, item };
}

export type PorEntryKind =
  | { kind: 'image'; image: PorImage }
  | { kind: 'anim'; frames: { delay: number; image: PorImage }[] }
  | { kind: 'other' };

/** Classify a decompressed entry as IMAGE, ANIMATION (frames tile the entry exactly) or neither. */
export function classifyPorEntry(b: Uint8Array): PorEntryKind {
  const img = parsePorImage(b, 0);
  if (img && img.length === b.length) return { kind: 'image', image: img };
  if (b.length >= 4 && b[0] === 0 && b[1] === 0) {
    const n = (b[2] << 8) | b[3];
    if (n > 0) {
      const frames: { delay: number; image: PorImage }[] = [];
      let pos = 4;
      for (let k = 0; k < n; k++) {
        if (pos + 4 > b.length) return { kind: 'other' };
        const delay = ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
        const image = parsePorImage(b, pos + 4);
        if (!image) return { kind: 'other' };
        frames.push({ delay, image });
        pos += 4 + image.length;
      }
      if (pos === b.length) return { kind: 'anim', frames };
    }
  }
  return { kind: 'other' };
}
