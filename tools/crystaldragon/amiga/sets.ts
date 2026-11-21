/**
 * Crystal Dragon (Amiga): a decoded `SA` graphic set (codec.ts `unSA`) -> composed indexed frames.
 *
 * Frame layout in the decoded set (Unpack +0x1B8): u16 w, u16 h, u16 bytesPerPlane, u32 flags,
 * extra bytes, stored planes. The blit (draw routine hunk 0 +0x14384, plane setup +0x133A2
 * `LAB_0D3C`, same logic at +0x4C44) reads the flags as:
 *   bits 0-23  six nibbles, one per screen bitplane (only 5 are blitted, DBF #4):
 *              n<7 = stored plane n, 7 = clear, 15 = set, 8+n = inverted plane n
 *   bits 24-25 0 = masked (cookie-cut, minterm $FCA; mask = first stored plane),
 *              1/2 = opaque with 1/2 edge-mask words (BLTAFWM/BLTALWM), 3 = opaque
 *   bit 26     mask plane is a reference (u32 self-relative offset) to a plane stored elsewhere
 *   bits 27-31 stored plane 0-4 is such a reference instead of being stored in this frame
 * A reference is a signed u32 relative to the byte after it (`MOVE.L (A3)+,D7 / ADDA.L D7,A3`).
 */

export const TRANSPARENT = 255;

export interface CdFrame {
  /** header width in pixels (the blit covers `stride` pixels: whole words) */
  w: number;
  h: number;
  /** pixels per row = bytesPerPlane / h * 8 */
  stride: number;
  /** stride*h colour indices 0-31, TRANSPARENT where the mask (or edge mask) is clear */
  px: Uint8Array;
}

const be16 = (d: Uint8Array, o: number) => (d[o]! << 8) | d[o + 1]!;
const be32 = (d: Uint8Array, o: number) => ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
const s32 = (d: Uint8Array, o: number) => be32(d, o) | 0;
const popcount = (v: number) => { let n = 0; for (; v; v &= v - 1) n++; return n; };

export function frameOffsets(set: Uint8Array): number[] {
  const n = (be32(set, 2) - 2) / 4;
  return Array.from({ length: n }, (_, k) => be32(set, 2 + 4 * k));
}

/** Compose one frame (5 screen bitplanes). */
export function composeFrame(set: Uint8Array, a: number, screenPlanes = 5): CdFrame {
  const w = be16(set, a), h = be16(set, a + 2), bpp = be16(set, a + 4), fl = be32(set, a + 6);
  const wb = h ? bpp / h : 0;
  const stride = wb * 8;
  const mode = (fl >>> 24) & 3;
  let p = a + 10;
  let fwm = 0xffff, lwm = 0xffff;
  if (mode === 1 || mode === 2) {
    fwm = be16(set, p); p += 2; lwm = fwm;
    if (mode === 2) { lwm = be16(set, p); p += 2; }
  }
  const refBits = (fl >>> 26) & 0x3f;
  let mask = -1;
  if (refBits & 1) { mask = p + 4 + s32(set, p); p += 4; }
  const shared = refBits >> 1;
  const refsBase = p;
  let plane0 = refsBase + 4 * popcount(shared);
  if (mode === 0 && mask < 0) { mask = plane0; plane0 += bpp; }
  const src = (n: number): number => {
    const below = popcount(shared & ((1 << n) - 1));
    if ((shared >> n) & 1) { const q = refsBase + 4 * below; return q + 4 + s32(set, q); }
    return plane0 + (n - below) * bpp;
  };
  const px = new Uint8Array(stride * h);
  const bit = (addr: number, x: number, y: number) => (set[addr + y * wb + (x >> 3)]! >> (7 - (x & 7))) & 1;
  const planeAddr: number[] = [];
  for (let k = 0; k < screenPlanes; k++) {
    const nib = (fl >>> (4 * k)) & 0xf;
    planeAddr.push(nib === 7 || nib === 15 ? -1 : src(nib & 7));
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < stride; x++) {
    let on: number;
    if (mode === 0) on = bit(mask, x, y);
    else {
      on = 1;
      const word = x >> 4, b = 15 - (x & 15);
      if (word === 0 && !((fwm >> b) & 1)) on = 0;
      if (word === wb / 2 - 1 && !((lwm >> b) & 1)) on = 0;
    }
    if (!on) { px[y * stride + x] = TRANSPARENT; continue; }
    let c = 0;
    for (let k = 0; k < screenPlanes; k++) {
      const nib = (fl >>> (4 * k)) & 0xf;
      let v: number;
      if (nib === 7) v = 0; else if (nib === 15) v = 1; else v = bit(planeAddr[k]!, x, y) ^ (nib >= 8 ? 1 : 0);
      c |= v << k;
    }
    px[y * stride + x] = c;
  }
  return { w, h, stride, px };
}

export function composeSet(set: Uint8Array): CdFrame[] {
  return frameOffsets(set).map((a) => composeFrame(set, a));
}

/**
 * Slot table (`.SCR` companion file, id+1; read by hunk 0 +0x14290 `LAB_0E0E`):
 *   u16 header; if its low byte is 0 the set has two alternating views (chosen by the party's
 *   step parity, `1158(A5)`), else one. Then npos*nsets s16 frame words (frame*4, -1 = none),
 *   then npos*nsets (x, y) word pairs, x relative to the view origin, y in rows.
 */
export interface SlotTable { header: number; npos: number; sets: 1 | 2; frame: number[]; x: number[]; y: number[] }

export function parseSlotTable(d: Uint8Array, npos: number): SlotTable {
  const header = be16(d, 0);
  const sets = (header & 0xff) === 0 ? 2 : 1;
  const n = npos * sets;
  const s16 = (o: number) => { const v = be16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
  const frame: number[] = [], x: number[] = [], y: number[] = [];
  for (let i = 0; i < n; i++) frame.push(s16(2 + 2 * i));
  for (let i = 0; i < n; i++) { x.push(s16(2 + 2 * n + 4 * i)); y.push(s16(2 + 2 * n + 4 * i + 2)); }
  return { header, npos, sets: sets as 1 | 2, frame, x, y };
}
