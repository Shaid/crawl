/**
 * Crystal Dragon (Amiga) packed-file codecs, ported from `Unpack` in the main executable
 * `Crystal_Dragon` (hunk 0 +0x0004; HUNK offsets below = hunk-0-relative, file offset = +0x24).
 *
 *   SF  (+0x5F2..+0x708)  backward bit-stream LZ77 for generic files (level maps, screens).
 *   SA  (+0x086..+0x250)  graphic set: frame headers + a backward bit-stream that feeds a 16 KB
 *                         chunky history ring (LZ / RLE / literal tokens, jump table +0x360) and a
 *                         chunky->planar stage (+0x498 table, one handler per plane count).
 *
 * Both are original TypeScript written from the 68k code; spec in
 * docs/crystaldragon/amiga/data-structure.md ("SF codec", "SA codec").
 */

export class CdCodecError extends Error {}

const be16 = (d: Uint8Array, o: number) => (d[o]! << 8) | d[o + 1]!;
const be32 = (d: Uint8Array, o: number) => ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;

export function tagOf(d: Uint8Array): string {
  return String.fromCharCode(d[0] ?? 0, d[1] ?? 0);
}

/** SF: 'SF', u32 unpacked, u32 packed, payload read backward; output filled backward. */
export function unSF(d: Uint8Array, strict = true): Uint8Array {
  if (tagOf(d) !== 'SF') throw new CdCodecError('not an SF file');
  const usize = be32(d, 2), psize = be32(d, 6);
  const src = d.subarray(10, 10 + psize);
  if (src.length !== psize) throw new CdCodecError('truncated payload');
  let ip = psize;
  const out = new Uint8Array(usize);
  let op = usize;
  const rd = () => { if (ip <= 0) throw new CdCodecError('read past start'); return src[--ip]!; };
  let b = rd();
  const bit = () => {
    let c = (b >> 7) & 1;
    b = (b << 1) & 0xff;
    if (b === 0) { const nb = rd(); c = (nb >> 7) & 1; b = ((nb << 1) | 1) & 0xff; }
    return c;
  };
  const bits = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
  const gamma = (start: number) => {
    let k = 1, full = 1, n = start;
    for (;;) { const v = bits(k); n += v; if (v !== full) return n; k++; full = full * 2 + 1; }
  };
  while (op > 0) {
    if (bit() === 0) {
      const n = gamma(1);
      if (n > op) throw new CdCodecError('literal overrun');
      for (let i = 0; i < n; i++) out[--op] = rd();
    } else {
      let L: number, ob: number;
      if (bit() === 0) { L = 2; ob = 9; } else if (bit() === 0) { L = 3; ob = 10; } else if (bit() === 0) { L = 4; ob = 12; } else { ob = bit() ? 9 : 14; L = gamma(5); }
      let p = op + bits(ob);
      if (L > op || p > usize) throw new CdCodecError('match out of range');
      for (let i = 0; i < L; i++) out[--op] = out[--p]!;
    }
  }
  if (strict && ip !== 0) throw new CdCodecError(`${ip} payload bytes left over`);
  return out;
}

/** Base lengths indexed by the set's plane count (+0x6A match base, +0x78 run base). */
const MATCH_BASE = [0, 0, 0, 7, 5, 4, 4];
const RUN_BASE = [0, 0, 0, 4, 4, 3, 3];

/** Extra header bytes after the 8-byte w/h/flags part (+0x0D8 / +0x17C): edge masks + plane refs. */
export function extraBytes(flags: number): number {
  const top = flags >>> 24;
  const low = top & 3;
  let n = low === 1 || low === 2 ? low * 2 : 0;
  for (let k = 0, m = top >> 2; k < 6; k++, m >>= 1) if (m & 1) n += 4;
  return n;
}

/** Stored plane count of a frame (+0x252): one per distinct source nibble < 7 not flagged shared, +1 mask. */
export function storedPlanes(flags: number): number {
  let d7 = flags >>> 0;
  let d1 = (d7 >>> 24) & 0xff;
  const d3 = d1 & 7;
  d1 >>= 3;
  let n = d3 === 0 ? 1 : 0;
  let max = -1;
  for (let i = 0; i < 6; i++) {
    const nib = d7 & 0xf;
    if (nib < 7 && nib > max) { max = nib; const c = d1 & 1; d1 >>= 1; if (!c) n++; }
    d7 >>>= 4;
  }
  return n;
}

/**
 * SA: returns the decoded set exactly as the game lays it out in memory:
 *   u16 planes; u32 frameOffset[frames] (from set start); then per frame
 *   u16 w, u16 h, u16 bytesPerPlane, u32 flags, extra bytes, stored planes (plane-major).
 */
/** Bytes of the packed SA stream left unread by the last `unSA` call (0 on every shipped set). */
export let saLeftover = 0;

export function unSA(d: Uint8Array): Uint8Array {
  if (tagOf(d) !== 'SA') throw new CdCodecError('not an SA file');
  const P = be16(d, 2), F = be16(d, 4), U = be32(d, 6), K = be32(d, 10);
  if (P < 3 || P > 6) throw new CdCodecError(`unsupported plane count ${P}`);
  const out = new Uint8Array(U);
  const dv = new DataView(out.buffer);
  const matchBase = MATCH_BASE[P]!, runBase = RUN_BASE[P]!;
  // walk the frame headers forward to find where the bit stream ends
  let a0 = 14;
  for (let f = 0; f < F; f++) {
    a0 += 4;
    const fl = be32(d, a0); a0 += 4;
    a0 += extraBytes(fl) + 2;
  }
  let a1 = a0; // end of header block (read backward per frame)
  let ip = a0 + K; // end of packed stream
  if (ip > d.length) throw new CdCodecError('truncated stream');
  dv.setUint16(0, P);
  let a4 = U;
  // bit reader (+0x3A0 / +0x050): 32-bit buffer refilled from -(A0) with a sentinel bit
  let buf = 0;
  const rdLong = () => { ip -= 4; if (ip < a0) throw new CdCodecError('stream underrun'); return be32(d, ip); };
  buf = rdLong();
  const bit = (): number => {
    let c = buf >>> 31;
    buf = (buf << 1) >>> 0;
    if (buf === 0) { const l = rdLong(); c = l >>> 31; buf = ((l << 1) | 1) >>> 0; }
    return c;
  };
  const bits = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = ((v << 1) | bit()) & 0xffff; return v; };
  const pixel = () => { let v = 0; for (let i = 0; i < P; i++) v = (v >> 1) | (bit() << 7); return v; };
  const ring = new Uint8Array(0x4000);
  let d2 = 0, d4 = 0x4000, d5 = 0x4000;
  for (let c = 0; c < F; c++) {
    let x = (d[a1 - 2]! << 8) | d[a1 - 1]!; a1 -= 2;
    if (x & 0x8000) x = 0;
    a1 -= x + 8;
    const h0 = a1;
    const w = be16(d, h0), h = be16(d, h0 + 2), fl = be32(d, h0 + 4);
    const bpp = (((w + 15) >> 4) * h * 2) >>> 0;
    const np = storedPlanes(fl);
    const planeStart = a4 - np * bpp;
    const ex = extraBytes(fl);
    let hdr = planeStart - ex - 10;
    if (hdr < 2 + 4 * F) throw new CdCodecError('output underrun');
    dv.setUint16(hdr, w); dv.setUint16(hdr + 2, h); dv.setUint16(hdr + 4, bpp); dv.setUint32(hdr + 6, fl);
    out.set(d.subarray(h0 + 8, h0 + 8 + ex), hdr + 10);
    dv.setUint32(2 + 4 * (F - c - 1), hdr);
    if (np > 0) {
      let p0 = planeStart + bpp; // plane 0 filled backward down to planeStart
      while (p0 !== planeStart) {
        if (d2 < 16) {
          const code = bits(4);
          if (code <= 11) {
            let len: number;
            if (code <= 5) len = code; else if (code === 6) len = 6 + bits(1); else if (code === 7) len = 8 + bits(1);
            else if (code === 8) len = 10 + bits(2); else if (code === 9) len = 14 + bits(3); else if (code === 10) len = 22 + bits(5); else len = 54 + bits(8);
            len += matchBase;
            const dist = bits(bit() ? 14 : 9);
            let s = (dist + d4) & 0x3fff;
            for (let i = 0; i < len; i++) { s = (s - 1) & 0x3fff; d4 = (d4 - 1) & 0x3fff; ring[d4] = ring[s]!; d2++; }
          } else if (code === 12 || code === 13) {
            const len = (code === 12 ? bits(4) : 16 + bits(8)) + runBase;
            const v = pixel();
            for (let i = 0; i < len; i++) { d4 = (d4 - 1) & 0x3fff; ring[d4] = v; d2++; }
          } else {
            const len = code === 14 ? 1 : 2 + bits(3);
            for (let i = 0; i < len; i++) { const v = pixel(); d4 = (d4 - 1) & 0x3fff; ring[d4] = v; d2++; }
          }
          continue;
        }
        d5 = (d5 - 16) & 0x3ff0;
        d2 -= 16;
        p0 -= 2;
        for (let k = 0; k < np; k++) {
          let word = 0;
          for (let i = 0; i < 16; i++) word = (word << 1) | ((ring[d5 + i]! >> (7 - k)) & 1);
          dv.setUint16(p0 + k * bpp, word);
        }
      }
    }
    a4 = hdr;
  }
  if (a4 !== 2 + 4 * F) throw new CdCodecError(`frames do not tile the output (${a4})`);
  saLeftover = ip - a0;
  return out;
}
