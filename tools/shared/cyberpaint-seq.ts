/**
 * Atari ST Cyber Paint `.SEQ` sequence decoder (public format; written to be
 * movable to `@seer-project/gfx`). Low-res frames only (4 planes, 16 colours).
 *
 * File: 128-B header (`0xFEDB`, version, u32 frame count, u16 speed), then
 * `count` u32 BE absolute frame offsets at +0x80. Frame: 128-B header
 * (`0xFFFF`, u16 resolution, 16 x u16 ST palette, 12-B name, x/y/w/h, op,
 * storage, u32 data length) + data. Storage 1 = word RLE (`c & 0x8000` ->
 * copy `c & 0x7FFF` literal words, else repeat next word `c` times); storage 0
 * = raw, stored as ST screen words (row-major, 4 interleaved plane words per
 * 16 pixels). Compressed pixel data is column-major: `4 * ceil(w/16)` word-columns of `h`
 * words, plane-major (`col = plane * wordsWide + x`), bit 15 = leftmost.
 */

export interface SeqFrame {
  index: number;
  offset: number;
  resolution: number;
  /** 16 raw ST palette words (`0x0RGB`, 3 bits per channel). */
  palette: number[];
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  operation: number;
  /** 0 raw, 1 compressed. */
  storage: number;
  dataLength: number;
  /** Absolute offset of the data bytes. */
  dataOffset: number;
}

export interface SeqFile {
  version: number;
  speed: number;
  frames: SeqFrame[];
}

export class SeqError extends Error {}

const u16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const u32 = (d: Uint8Array, o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

export function parseSeq(d: Uint8Array): SeqFile {
  if (d.length < 0x80 || u16(d, 0) !== 0xfedb) throw new SeqError('not a Cyber Paint SEQ (magic 0xFEDB)');
  const n = u32(d, 4);
  if (0x80 + 4 * n > d.length) throw new SeqError('frame table past EOF');
  const frames: SeqFrame[] = [];
  for (let i = 0; i < n; i++) {
    const o = u32(d, 0x80 + 4 * i);
    if (o + 128 > d.length) throw new SeqError(`frame ${i} header past EOF`);
    if (u16(d, o) !== 0xffff) throw new SeqError(`frame ${i} bad header marker`);
    const palette: number[] = [];
    for (let c = 0; c < 16; c++) palette.push(u16(d, o + 4 + 2 * c));
    let name = '';
    for (let k = 0; k < 12 && d[o + 0x24 + k]; k++) name += String.fromCharCode(d[o + 0x24 + k]);
    frames.push({
      index: i, offset: o, resolution: u16(d, o + 2), palette, name,
      x: u16(d, o + 0x36), y: u16(d, o + 0x38), width: u16(d, o + 0x3a), height: u16(d, o + 0x3c),
      operation: d[o + 0x3e], storage: d[o + 0x3f], dataLength: u32(d, o + 0x40), dataOffset: o + 128,
    });
  }
  return { version: u16(d, 2), speed: u16(d, 8), frames };
}

/** Words per frame: 4 planes x ceil(w/16) columns x h rows. */
export function frameWordCount(f: Pick<SeqFrame, 'width' | 'height'>): number {
  return 4 * Math.ceil(f.width / 16) * f.height;
}

/**
 * Decode a frame's data to big-endian-word column-major planar words.
 * Throws unless the stream decodes to exactly the declared size and (for
 * compressed frames) every input byte is consumed.
 */
export function frameWords(d: Uint8Array, f: SeqFrame, skip = 0): Uint16Array {
  const need = frameWordCount(f);
  const end = f.dataOffset + f.dataLength;
  if (end > d.length) throw new SeqError(`frame ${f.index} data past EOF`);
  let i = f.dataOffset + skip;
  const out = new Uint16Array(need);
  if (f.storage === 0) {
    if (f.dataLength !== need * 2) throw new SeqError(`frame ${f.index} raw length ${f.dataLength} != ${need * 2}`);
    for (let k = 0; k < need; k++, i += 2) out[k] = u16(d, i);
    return out;
  }
  let w = 0;
  while (i + 2 <= end) {
    const c = u16(d, i); i += 2;
    if (c & 0x8000) {
      const n = c & 0x7fff;
      if (i + 2 * n > end || w + n > need) throw new SeqError(`frame ${f.index} literal run overflows`);
      for (let k = 0; k < n; k++, i += 2) out[w++] = u16(d, i);
    } else {
      if (i + 2 > end || w + c > need) throw new SeqError(`frame ${f.index} repeat run overflows`);
      const v = u16(d, i); i += 2;
      for (let k = 0; k < c; k++) out[w++] = v;
    }
  }
  if (w !== need) throw new SeqError(`frame ${f.index} decoded ${w} words, expected ${need}`);
  if (i !== end) throw new SeqError(`frame ${f.index} left ${end - i} input bytes`);
  return out;
}

/** Colour indices (0..15), width*height row-major. */
export function frameIndices(d: Uint8Array, f: SeqFrame): Uint8Array {
  const words = frameWords(d, f);
  const wc = Math.ceil(f.width / 16);
  const out = new Uint8Array(f.width * f.height);
  if (f.storage === 0) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const base = (y * wc + (x >> 4)) * 4;
        const bit = 15 - (x & 15);
        let v = 0;
        for (let p = 0; p < 4; p++) v |= ((words[base + p] >> bit) & 1) << p;
        out[y * f.width + x] = v;
      }
    }
    return out;
  }
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const col = x >> 4;
      const bit = 15 - (x & 15);
      let v = 0;
      for (let p = 0; p < 4; p++) v |= ((words[(p * wc + col) * f.height + y] >> bit) & 1) << p;
      out[y * f.width + x] = v;
    }
  }
  return out;
}

/** ST palette word -> RGB, 3 bits/channel (`0x0RGB`), scaled by 255/7. */
export function stColor(word: number): [number, number, number] {
  const s = (n: number) => Math.round(((n & 7) * 255) / 7);
  return [s(word >> 8), s(word >> 4), s(word)];
}
