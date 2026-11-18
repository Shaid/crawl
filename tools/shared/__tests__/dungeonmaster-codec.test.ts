import { describe, it, expect } from 'vitest';
import {
  decodeImg1Stream,
  decodeImg1,
  decodeImg3Stream,
  decodeImg4,
  decodeImg1Checked,
  isImg1Image,
  decodeImg4Checked,
  parseCompressedDungeonHeader,
  decompressDungeon,
  isDungeonCompressed,
  ensureDungeonDecompressed,
  DUNGEON_COMPRESSED_SIGNATURE,
} from '../dungeonmaster-codec.ts';

describe('decodeImg1Stream', () => {
  it('decodes a solid run followed by a transparent run', () => {
    // nibbles: [0,5] -> n1<=7: solid run of (0+1)=1 pixel, colour 5.
    // nibbles: [a,2] -> n1=0xa: transparent run of (2+1)=3 pixels.
    const data = new Uint8Array([0x05, 0xa2]);
    const pixels = decodeImg1Stream(data, 0, 4, 1);
    expect(Array.from(pixels)).toEqual([5, -1, -1, -1]);
  });

  it('decodeImg1 reads the big-endian width/height header first', () => {
    // width=4,height=1 header, then the same payload as above.
    const item = new Uint8Array([0x00, 0x04, 0x00, 0x01, 0x05, 0xa2]);
    const img = decodeImg1(item);
    expect(img.width).toBe(4);
    expect(img.height).toBe(1);
    expect(Array.from(img.pixels)).toEqual([5, -1, -1, -1]);
  });

  it('a copy-prev-line-then-one-solid-pixel run (0xb) reproduces the row above plus a trailing pixel', () => {
    // Row 0: 3x solid colour 7 -> nibbles (0,7)x3 -> n1<=7, each count=1.
    // Row 1: n1=0xb, n2=9 (trailing colour), count-byte=0x01 (copy 1+1=2 px
    //        from the row above), then 1 solid pixel of colour 9.
    const data = new Uint8Array([0x07, 0x07, 0x07, 0xb9, 0x01]);
    const pixels = decodeImg1Stream(data, 0, 3, 2);
    expect(Array.from(pixels)).toEqual([7, 7, 7, 7, 7, 9]);
  });
});

describe('decodeImg3Stream (IMG3/IMG4 local-palette codec)', () => {
  const pal = [9, 8, 7, 6, 5, 4];

  it('decodes single-pixel local-palette-indexed runs', () => {
    // control nibbles 0,1,2 (bit3=0 => single pixel, bits2-0 = palette index)
    const data = new Uint8Array([0x01, 0x20]); // nibbles: 0,1,2,(pad)
    const pixels = decodeImg3Stream(data, 0, 3, 1, pal);
    expect(Array.from(pixels)).toEqual([9, 8, 7]);
  });

  it('colour selector 6 copies from the line above', () => {
    // Row0: control 0,0 (both palette[0]=9). Row1: control 6,6 (copy from above).
    const data = new Uint8Array([0x00, 0x66]);
    const pixels = decodeImg3Stream(data, 0, 2, 2, pal);
    expect(Array.from(pixels)).toEqual([9, 9, 9, 9]);
  });

  it('a multi-pixel run (bit3 set) reads a variable-length count', () => {
    // control=0x8 (multi, colourSel=0), then count-nibble=3 -> count=3+2=5.
    const data = new Uint8Array([0x83]);
    const pixels = decodeImg3Stream(data, 0, 5, 1, pal);
    expect(Array.from(pixels)).toEqual([9, 9, 9, 9, 9]);
  });

  it('decodeImg4 reads the big-endian header + 6-nibble local palette', () => {
    const item = new Uint8Array([
      0x00, 0x02, 0x00, 0x01, // width=2, height=1
      0x98, 0x76, 0x54, // palette nibbles 9,8,7,6,5,4
      0x01, // payload: control nibbles 0,1 -> pixel0=pal[0]=9, pixel1=pal[1]=8
    ]);
    const img = decodeImg4(item);
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(Array.from(img.pixels)).toEqual([9, 8]);
  });
});

/** Writes bits MSB-first into a byte buffer — used to build compressed-dungeon fixtures. */
class BitWriter {
  private bytes: number[] = [0];
  private bitPos = 0;
  writeBit(b: number) {
    if (this.bitPos === 8) {
      this.bytes.push(0);
      this.bitPos = 0;
    }
    this.bytes[this.bytes.length - 1] |= (b & 1) << (7 - this.bitPos);
    this.bitPos++;
  }
  writeBits(value: number, n: number) {
    for (let i = n - 1; i >= 0; i--) this.writeBit((value >> i) & 1);
  }
  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

describe('decompressDungeon', () => {
  it('decodes all 3 symbol classes (most-common, less-common, literal)', () => {
    const mostCommon = [10, 20, 30, 40];
    const lessCommon = Array.from({ length: 16 }, (_, i) => 100 + i);

    const bw = new BitWriter();
    // byte0 = mostCommon[2]: '0' + 2-bit index
    bw.writeBit(0);
    bw.writeBits(2, 2);
    // byte1 = lessCommon[5]: '10' + 4-bit index
    bw.writeBit(1);
    bw.writeBit(0);
    bw.writeBits(5, 4);
    // byte2 = literal 200: '11' + 8-bit value
    bw.writeBit(1);
    bw.writeBit(1);
    bw.writeBits(200, 8);
    const bitstream = bw.toBytes();

    const header = new Uint8Array(28);
    const hv = new DataView(header.buffer);
    hv.setUint16(0, DUNGEON_COMPRESSED_SIGNATURE);
    hv.setUint32(2, 3); // uncompressedSize
    hv.setUint16(6, 0); // dungeonId
    header.set(mostCommon, 8);
    header.set(lessCommon, 12);

    const data = new Uint8Array(header.length + bitstream.length);
    data.set(header, 0);
    data.set(bitstream, header.length);

    expect(isDungeonCompressed(data)).toBe(true);
    const hdr = parseCompressedDungeonHeader(data);
    expect(hdr.uncompressedSize).toBe(3);
    expect(hdr.mostCommon).toEqual(mostCommon);
    expect(hdr.lessCommon).toEqual(lessCommon);

    const out = decompressDungeon(data);
    expect(Array.from(out)).toEqual([30, 105, 200]);
    expect(ensureDungeonDecompressed(data)).toEqual(out);
  });

  it('ensureDungeonDecompressed passes uncompressed data through unchanged', () => {
    const plain = new Uint8Array([1, 2, 3, 4]);
    expect(isDungeonCompressed(plain)).toBe(false);
    expect(ensureDungeonDecompressed(plain)).toBe(plain);
  });
});


describe('exact-consumption checks (the w*h assertion is a tautology)', () => {
  it('decodeImg1Checked: a well-formed item consumes exactly its own nibbles', () => {
    const item = new Uint8Array([0x00, 0x04, 0x00, 0x01, 0x05, 0xa2]);
    const r = decodeImg1Checked(item);
    expect(r.exact).toBe(true);
    expect(r.consumedNibbles).toBe(4);
    expect(r.availableNibbles).toBe(4);
    expect(isImg1Image(item)).toBe(true);
  });

  it('null control: a truncated item still yields w*h pixels but is NOT exact', () => {
    const item = new Uint8Array([0x00, 0x04, 0x00, 0x01, 0x05]); // second run missing
    const r = decodeImg1Checked(item);
    expect(r.pixels).toHaveLength(4); // the tautology: always true
    expect(r.exact).toBe(false);
    expect(isImg1Image(item)).toBe(false);
  });

  it('null control: trailing junk after a complete stream is NOT exact', () => {
    const item = new Uint8Array([0x00, 0x04, 0x00, 0x01, 0x05, 0xa2, 0x77]);
    expect(decodeImg1Checked(item).exact).toBe(false);
  });

  function img4Item(trailer: number[], streamBytes: number[], pal: number[]): Uint8Array {
    // 4-byte header (w=4,h=1) + palette nibbles packed + stream + trailer
    const nibs = [...pal];
    const bytes: number[] = [0, 4, 0, 1];
    const all = [...nibs];
    for (const b of streamBytes) all.push(b >> 4, b & 15);
    if (all.length % 2) all.push(0); // pad nibble
    for (let i = 0; i < all.length; i += 2) bytes.push((all[i]! << 4) | all[i + 1]!);
    return new Uint8Array([...bytes, ...trailer]);
  }
  const trailer = Array.from({ length: 16 }, (_, i) => 0xf0 + i);

  it('decodeImg4Checked: 6-nibble palette + run stream + 16-byte trailer tile exactly', () => {
    const item = img4Item(trailer, [0x01, 0x23], [0, 1, 2, 3, 4, 5]);
    const r = decodeImg4Checked(item)!;
    expect(r).not.toBeNull();
    expect(r.paletteNibbles).toBe(6);
    expect(Array.from(r.pixels)).toEqual([0, 1, 2, 3]);
    expect(Array.from(r.trailer)).toEqual(trailer);
  });

  it('decodeImg4Checked: 5-nibble variant (selector 5 = non-palette role) tiles with a pad nibble', () => {
    // pal nibbles 0..4 (5 entries); run stream control nibbles: 0,5,1,5 (two selector-5 pixels).
    const item = img4Item(trailer, [0x05, 0x15], [9, 8, 7, 6, 5]);
    const r = decodeImg4Checked(item, 5)!;
    expect(r).not.toBeNull();
    expect(r.paletteNibbles).toBe(5);
    expect(r.selector5Runs).toBeGreaterThan(0);
  });

  it('null control: dropping one trailer byte (or adding one) breaks the tiling', () => {
    const good = img4Item(trailer, [0x01, 0x23], [0, 1, 2, 3, 4, 5]);
    expect(decodeImg4Checked(good)).not.toBeNull();
    expect(decodeImg4Checked(good.subarray(0, good.length - 2))).toBeNull();
    expect(decodeImg4Checked(new Uint8Array([...good, 0x00, 0x00]))).toBeNull();
  });
});
