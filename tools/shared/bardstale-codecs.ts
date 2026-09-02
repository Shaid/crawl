/**
 * Bard's Tale (Amiga) codec family — the compression/encryption schemes
 * used by the "animated picture" (view-window portrait) resource across
 * Bard's Tale I, II and III on Amiga.
 *
 * Ported directly (line-for-line, preserving statement order and 16-bit
 * wraparound arithmetic) from Kroah's "Bard's Tale Picture Viewer" C#
 * source (`Huffman.cs`, `RLE.cs`, `Picture_Amiga.cs` — see
 * http://bringerp.free.fr/RE/BardsTale/utility1.php5). That tool ships a
 * `Files/` directory containing byte-identical copies of this project's
 * own WHDLoad corpus files (`bard3`, `all.pic`, `pics`, `pics2` all
 * cmp-identical — see docs/bardstale1/amiga/data-structure.md), so the
 * C# source is a byte-exact ground-truth oracle here, not just a
 * plausible-shaped reimplementation.
 *
 * Three distinct schemes are covered:
 *  - BT1/BT2 "pics"/"pics2": a static Huffman tree (rebuilt per-file from
 *    a serialized bitstream) decodes a 4bpp-planar 112x88 base picture,
 *    itself further RLE-packed (BT1) or bit-transposed (BT2).
 *  - BT3 "all.pic": a from-scratch LZ77-with-adaptive-Huffman codec
 *    (structurally the classic Okumura LZHUF / LHarc family — a 4096-byte
 *    ring buffer, positions/lengths split into a hardcoded log2-bucketed
 *    "hard" table pair) decodes to 4 chunky 4bpp 112x88 sub-frames, then
 *    an inter-frame XOR delta is undone.
 */

// ---------------------------------------------------------------------------
// Small big-endian byte/word helpers over plain Uint8Array buffers.
// ---------------------------------------------------------------------------

export interface Cursor {
  v: number;
}

/**
 * Bounds-checked byte read. Deliberately throws rather than returning
 * `undefined` on overrun: several of the ported decode loops below test
 * `while (b !== 0)` against a running counter, and JS's `undefined - 1 ===
 * NaN` combined with `NaN !== 0 === true` turns a silent out-of-bounds
 * read into an infinite loop instead of a clean failure — a real bug this
 * module hit once already (probing an out-of-range picture index hung the
 * process with no error). Throwing here converts every such case into a
 * fast, catchable exception.
 */
function readU8(buf: Uint8Array, at: Cursor): number {
  if (at.v >= buf.length) throw new Error(`bardstale codec: read past end of buffer (offset ${at.v}, length ${buf.length})`);
  return buf[at.v++]!;
}

function readU16BE(buf: Uint8Array, at: Cursor): number {
  if (at.v + 2 > buf.length) throw new Error(`bardstale codec: read past end of buffer (offset ${at.v}, length ${buf.length})`);
  const v = ((buf[at.v]! << 8) | buf[at.v + 1]!) & 0xffff;
  at.v += 2;
  return v;
}

function readU32BE(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

function readU32BERef(buf: Uint8Array, at: Cursor): number {
  const v = readU32BE(buf, at.v);
  at.v += 4;
  return v;
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

function wordAt(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 8) | buf[off + 1]!) & 0xffff;
}

function writeWordAt(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

// ---------------------------------------------------------------------------
// Huffman tree decoder (BT1/BT2 "pics" picture payload).
//
// Ported from `Huffman.cs`. The tree is 769 nodes x 10 bytes
// {u32 left, u32 right, u8 leaf, 1 pad}, `0xFFFFFFFF` meaning "no child /
// leaf". It is rebuilt from a serialized bitstream: bit 0 = internal node
// (recurse left then right, allocating two fresh nodes), bit 1 = leaf
// (next 8 bits, MSB first, are the leaf's byte value). The 16-bit bit
// reader refills from big-endian words and — a real quirk of the
// original, preserved here — silently stops refilling (reusing whatever
// bits remain in the window) once fewer than 2 bytes remain in the
// source, rather than throwing or zero-filling.
// ---------------------------------------------------------------------------

class BitReader16 {
  mask = 0x8000;
  value: number;
  private buf: Uint8Array;
  private at: Cursor;
  constructor(buf: Uint8Array, at: Cursor) {
    this.buf = buf;
    this.at = at;
    this.value = readU16BE(buf, at);
  }
  nextBit(): boolean {
    const d0 = this.value & this.mask;
    this.mask >>>= 1;
    if (this.mask === 0) {
      this.mask = 0x8000;
      if (this.at.v + 2 <= this.buf.length) {
        this.value = readU16BE(this.buf, this.at);
      }
      // else: leave `value` as-is (matches the original's no-op branch).
    }
    return d0 !== 0;
  }
  nextByte(): number {
    let b = 0;
    for (let i = 0; i < 8; i++) {
      b = (b << 1) & 0xff;
      if (this.nextBit()) b |= 1;
    }
    return b;
  }
}

/**
 * A single Huffman decoder instance: builds its tree from a serialized
 * bitstream, then decodes payload bytes from further along the SAME
 * bit-reader (mask/value state, and the underlying word-refill cursor,
 * both persist across the tree build and every subsequent `decode()`
 * call — mirroring the C# `Huffman` object's field lifetime exactly:
 * `Decode_Amiga` is called twice against one instance in
 * `LoadBard_1_2_Single` — once for the 32-byte palette, once for the
 * main picture payload — with no reset in between).
 */
export class BardstaleHuffmanDecoder {
  tree = new Uint8Array(7690);
  private bits: BitReader16;

  constructor(bufferTree: Uint8Array, at: Cursor) {
    for (let i = 0; i < 7690; i += 10) {
      writeU32BE(this.tree, i + 0, 0xffffffff);
      writeU32BE(this.tree, i + 4, 0xffffffff);
    }
    let nextFree = 10;
    this.bits = new BitReader16(bufferTree, at);

    const advanceToNext = (): number => {
      nextFree += 10;
      const node = nextFree - 10;
      // 7690 bytes / 10 = 769 nodes is the tree's fixed capacity (matches
      // the original's fixed-size allocation). Corrupted/out-of-range
      // input (e.g. probing a picture index past the real directory) can
      // otherwise drive this into unbounded recursion — fail fast instead.
      if (node + 10 > this.tree.length) throw new Error(`bardstale huffman: tree overflow (corrupt or out-of-range record)`);
      if (readU32BE(this.tree, node + 0) !== 0xffffffff) throw new Error('bardstale huffman: node already allocated');
      writeU32BE(this.tree, node + 0, 0xffffffff);
      if (readU32BE(this.tree, node + 4) !== 0xffffffff) throw new Error('bardstale huffman: node already allocated');
      writeU32BE(this.tree, node + 4, 0xffffffff);
      return node;
    };

    const recurse = (offsetTree: number): void => {
      if (!this.bits.nextBit()) {
        let prev = advanceToNext();
        if (readU32BE(this.tree, offsetTree + 4) !== 0xffffffff) throw new Error('bardstale huffman: right already set');
        writeU32BE(this.tree, offsetTree + 4, prev);

        prev = advanceToNext();
        if (readU32BE(this.tree, offsetTree + 0) !== 0xffffffff) throw new Error('bardstale huffman: left already set');
        writeU32BE(this.tree, offsetTree + 0, prev);

        recurse(prev);
        this.bits.nextBit();
        recurse(readU32BE(this.tree, offsetTree + 4));
      } else {
        this.tree[offsetTree + 8] = this.bits.nextByte();
      }
    };
    recurse(0);
  }

  /** Decode `nbBytes` symbols by walking the tree once per output byte. */
  decode(nbBytes: number): Uint8Array {
    const out = new Uint8Array(nbBytes);
    for (let i = 0; i < nbBytes; i++) {
      let offsetTree = 0;
      for (;;) {
        if (readU32BE(this.tree, offsetTree) === 0xffffffff) break;
        offsetTree = this.bits.nextBit()
          ? readU32BE(this.tree, offsetTree + 4)
          : readU32BE(this.tree, offsetTree + 0);
      }
      out[i] = this.tree[offsetTree + 8]!;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// RLE (BT1 base picture, after Huffman decode).
// Marker byte b: b==0 -> stop. b&0x80 -> literal run of (b&0x7F) raw
// bytes. Else -> run of `b` repeats of the following single byte.
// ---------------------------------------------------------------------------

export function decodeBardstaleRLE(src: Uint8Array, at: Cursor): Uint8Array {
  const out: number[] = [];
  for (;;) {
    let b = readU8(src, at);
    if (b === 0) break;
    if (b & 0x80) {
      b &= 0x7f;
      while (b !== 0) {
        if (at.v === src.length) return Uint8Array.from(out);
        out.push(readU8(src, at));
        b--;
      }
    } else {
      const fill = readU8(src, at);
      while (b !== 0) {
        out.push(fill);
        b--;
      }
    }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// BT2 base-picture transforms: a 4-plane bit transpose (Uncrypt1) followed
// by a per-plane running XOR against the previous row group (Uncrypt2).
// Ported from `Picture_Amiga.Uncrypt1`/`Uncrypt2`.
// ---------------------------------------------------------------------------

export function bardstale2Uncrypt1(dump: Uint8Array): Uint8Array {
  const dst = new Uint8Array(1232 * 4);
  const bp0 = 1232 * 0;
  const bp1 = 1232 * 1;
  const bp2 = 1232 * 2;
  const bp3 = 1232 * 3;

  let index = 0;
  for (let byteIndexInPlan = 0; byteIndexInPlan < 1232; byteIndexInPlan++) {
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    let lng = BigInt(readU32BE(dump, index));
    index += 4;
    for (let bitIndexInByte = 0; bitIndexInByte < 8; bitIndexInByte++) {
      v0 = (v0 << 1) & 0xff;
      v0 = Number(lng & 1n) | (v0 & 0xff);
      lng >>= 1n;

      v1 = (v1 << 1) & 0xff;
      v1 = Number(lng & 1n) | (v1 & 0xff);
      lng >>= 1n;

      v2 = (v2 << 1) & 0xff;
      v2 = Number(lng & 1n) | (v2 & 0xff);
      lng >>= 1n;

      v3 = (v3 << 1) & 0xff;
      v3 = Number(lng & 1n) | (v3 & 0xff);
      lng >>= 1n;
    }
    dst[bp0 + byteIndexInPlan] = v0;
    dst[bp1 + byteIndexInPlan] = v1;
    dst[bp2 + byteIndexInPlan] = v2;
    dst[bp3 + byteIndexInPlan] = v3;
  }
  return dst;
}

export function bardstale2Uncrypt2(dump: Uint8Array): void {
  let index = 0;
  for (let bp = 0; bp < 4; bp++) {
    for (let d6 = 14; d6 < 1232; d6++) {
      const b1 = dump[index + 14]!;
      const b2 = dump[index]!;
      dump[index + 14] = (b1 ^ b2) & 0xff;
      index++;
    }
    index += 14;
  }
}

// ---------------------------------------------------------------------------
// BT3 "all.pic" LZ77 + adaptive-Huffman decompressor (structurally the
// classic Okumura LZHUF/LHarc family: 4096-byte ring buffer, split
// length/position coding via the `_hard1`/`_hard2` log2-bucket tables).
// Ported from `Picture_Amiga.Unpack_Bard3` and its four helpers.
// ---------------------------------------------------------------------------

const HARD1 = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9,
  10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15,
  16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23,
  24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39,
  40, 40, 41, 41, 42, 42, 43, 43, 44, 44, 45, 45, 46, 46, 47, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
]);

const HARD2 = Uint8Array.from([
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
]);

function copyWithin(data: Uint8Array, offsetSrc: number, offsetDst: number, length: number): void {
  if (offsetSrc === offsetDst) return;
  if (offsetDst > offsetSrc) {
    let s = offsetSrc + length;
    let d = offsetDst + length;
    for (let i = 0; i < length; i++) {
      s--;
      d--;
      data[d] = data[s]!;
    }
  } else {
    let s = offsetSrc;
    let d = offsetDst;
    for (let i = 0; i < length; i++) {
      data[d] = data[s]!;
      s++;
      d++;
    }
  }
}

function unpackBard3Init(tab2: Uint8Array, tab3: Uint8Array, tab4: Uint8Array): void {
  for (let i = 0; i < 314; i++) {
    const d0 = i * 2;
    writeWordAt(tab2, d0, 1);
    const d1 = i + 627;
    writeWordAt(tab4, d0, d1);
    writeWordAt(tab3, d1 * 2, i);
  }

  for (let d4 = 0, d5 = 314; d5 <= 626; d4 += 2, d5++) {
    const d0 = d5 * 2;
    let d1 = d4 * 2;
    let d3 = wordAt(tab2, d1);
    d1 += 2;
    d3 = (d3 + wordAt(tab2, d1)) & 0xffff;
    writeWordAt(tab2, d0, d3);
    writeWordAt(tab4, d0, d4);
    writeWordAt(tab3, d1, d5);
    d1 -= 2;
    writeWordAt(tab3, d1, d5);
  }

  writeWordAt(tab2, 0x4e6, 0xffff);
  writeWordAt(tab3, 0x4e4, 0x0000);
}

function unpackBard3HelperCCopy(data: Uint8Array, offsetSrc: number, offsetDst: number, length: number): void {
  copyWithin(data, offsetSrc, offsetDst, length);
}

function unpackBard3HelperB(tab2: Uint8Array, tab3: Uint8Array, tab4: Uint8Array): void {
  {
    let d4 = 0;
    let d5 = 0;
    while (d4 < 627) {
      if (wordAt(tab4, d4 * 2) >= 627) {
        const d0 = d5 * 2;
        const d1 = d4 * 2;
        let d2 = wordAt(tab2, d1);
        d2 = (d2 + 1) >> 1;
        writeWordAt(tab2, d0, d2);
        writeWordAt(tab4, d5 * 2, wordAt(tab4, d4 * 2));
        d5++;
      }
      d4++;
    }
  }
  {
    let d4 = 0;
    let d5 = 627;
    while (d5 < 627) {
      const d6first = d4 + 1;
      const d0 = d5 * 2;
      const d1 = d4 * 2;
      const d2 = d6first * 2;
      const d3 = (wordAt(tab2, d1) + wordAt(tab2, d2)) & 0xffff;
      writeWordAt(tab2, d0, d3);
      const var2 = d3;
      let d6 = d5;
      for (;;) {
        d6--;
        if (var2 >= wordAt(tab2, d6 * 2)) break;
      }
      d6++;
      const var4 = d5 - d6 * 2;
      const offsetDst = d6 * 2;
      const offsetSrc = (d6 + 1) * 2;
      unpackBard3HelperCCopy(tab2, offsetSrc, offsetDst, var4);
      writeWordAt(tab2, d6 * 2, var2);
      unpackBard3HelperCCopy(tab4, offsetSrc, offsetDst, var4);
      writeWordAt(tab4, d6 * 2, d4);
      d4 += 2;
      d5++;
    }
  }
  {
    let d4 = 0;
    while (d4 < 627) {
      const d6 = wordAt(tab4, d4 * 2);
      if (d6 >= 627) {
        writeWordAt(tab3, d6 * 2, d4);
      } else {
        writeWordAt(tab3, (d6 + 1) * 2, d4);
        writeWordAt(tab3, d6 * 2, d4);
      }
      d4++;
    }
  }
}

function unpackBard3HelperA(arg0: number, tab2: Uint8Array, tab3: Uint8Array, tab4: Uint8Array): void {
  if (wordAt(tab2, 0x4e4) === 0x8000) unpackBard3HelperB(tab2, tab3, tab4);
  let d0 = (arg0 + 627) * 2;
  let d4 = wordAt(tab3, d0);
  for (;;) {
    let d2 = d4 * 2;
    writeWordAt(tab2, d2, (wordAt(tab2, d2) + 1) & 0xffff);
    const d7 = wordAt(tab2, d2);
    let d3 = d4 + 1;
    let d1 = d2 + 2;
    if (d7 > wordAt(tab2, d1)) {
      for (;;) {
        d3++;
        d1 += 2;
        if (d7 <= wordAt(tab2, d1)) break;
      }
      d3--;
      d1 -= 2;
      writeWordAt(tab2, d2, wordAt(tab2, d1));
      writeWordAt(tab2, d1, d7);
      const d5 = wordAt(tab4, d2);
      d0 = d5 * 2;
      writeWordAt(tab3, d0, d3);
      if (d5 < 627) {
        d0 += 2;
        writeWordAt(tab3, d0, d3);
      }
      const d6 = wordAt(tab4, d1);
      writeWordAt(tab4, d1, d5);
      d0 = d6 * 2;
      writeWordAt(tab3, d0, d4);
      if (d6 < 627) {
        d0 += 2;
        writeWordAt(tab3, d0, d4);
      }
      writeWordAt(tab4, d2, d6);
      d4 = d3;
    }
    d2 = d4 * 2;
    d4 = wordAt(tab3, d2);
    if (d4 === 0) break;
  }
}

/** BT3's LZ77+adaptive-Huffman decompressor. `at` is advanced past the compressed stream. */
export function unpackBard3(src: Uint8Array, at: Cursor, uncompressedSize: number): Uint8Array {
  const dst = new Uint8Array(19712);
  if (uncompressedSize !== 19712) {
    // Every observed BT3 picture record decompresses to exactly this size
    // (4 x 112x88 4bpp chunky sub-frames) — flag anything else loudly
    // rather than silently truncating/overrunning `dst`.
    throw new Error(`unpackBard3: unexpected uncompressedSize ${uncompressedSize} (expected 19712)`);
  }

  const tab1 = new Uint8Array(4036 + 60); // 4096-byte LZ ring buffer
  const tab2 = new Uint8Array(628 * 2);
  const tab3 = new Uint8Array(627 * 2 + 314 * 2);
  const tab4 = new Uint8Array(627 * 2);

  unpackBard3Init(tab2, tab3, tab4);

  for (let d5 = 4035; d5 >= 0; d5--) tab1[d5] = 32;

  let offsetTab1 = 4036;
  let d3 = 0;
  let d7 = 0;
  let offsetDst = 0;

  while (offsetDst < uncompressedSize) {
    let d6 = wordAt(tab4, 0x4e4);
    // This chain walk doesn't consume input bytes on every step (only
    // when `d3 <= 8`), so it isn't transitively bounded by `readU8`
    // throwing at end-of-stream — a corrupted/out-of-range `tab4` chain
    // (e.g. probing a picture index past the real directory) can cycle
    // without ever reaching `d6 >= 627`. 4096 is generous (real chains
    // are far shorter); fail fast rather than hang.
    for (let guard = 0; d6 < 627; guard++) {
      if (guard > 4096) throw new Error('unpackBard3: tab4 chain walk exceeded bound (corrupt or out-of-range record)');
      while (d3 <= 8) {
        const d2 = readU8(src, at);
        d7 = (d7 | ((d2 << (8 - d3)) & 0xffff)) & 0xffff;
        d3 += 8;
      }
      if ((d7 << 16) >> 16 < 0) d6++; // (short) d7 < 0
      d7 = (d7 << 1) & 0xffff;
      d3--;
      d6 = wordAt(tab4, d6 * 2);
    }

    d6 -= 627;
    unpackBard3HelperA(d6, tab2, tab3, tab4);

    if (d6 < 256) {
      dst[offsetDst++] = d6 & 0xff;
      tab1[offsetTab1++] = d6 & 0xff;
      offsetTab1 &= 0xfff;
    } else {
      while (d3 <= 8) {
        const d2 = readU8(src, at);
        d7 = (d7 | ((d2 << (8 - d3)) & 0xffff)) & 0xffff;
        d3 += 8;
      }
      let varE = d7 >>> 8;
      d7 = (d7 << 8) & 0xffff;
      d3 -= 8;
      const var12 = HARD1[varE]! << 6;
      let var10 = HARD2[varE]!;
      var10 -= 2;

      for (;;) {
        var10--;
        if (var10 === -1) break;
        while (d3 <= 8) {
          const d2 = readU8(src, at);
          d7 = (d7 | ((d2 << (8 - d3)) & 0xffff)) & 0xffff;
          d3 += 8;
        }
        varE = (varE << 1) & 0xffff;
        if ((d7 << 16) >> 16 < 0) varE++;
        d7 = (d7 << 1) & 0xffff;
        d3--;
      }

      const z4d0 = (varE & 0x3f) | var12;
      const d5 = (offsetTab1 - z4d0 - 1) & 0xfff;
      const var4 = d6 - 0xfd;
      for (let j = 0; j < var4; j++) {
        d6 = tab1[(d5 + j) & 0xfff]!;
        dst[offsetDst++] = d6;
        tab1[offsetTab1++] = d6;
        offsetTab1 &= 0xfff;
      }
    }
  }

  if (offsetDst !== dst.length) throw new Error('unpackBard3: short output');
  return dst;
}

/** Undo the inter-sub-frame XOR delta chain applied on top of `unpackBard3`'s output. */
export function uncryptXorBard3(data: Uint8Array): void {
  for (let d5 = 4928, offset = 0; d5 < 19712; d5++, offset++) {
    data[offset + 4928] = (data[offset + 4928]! ^ data[offset]!) & 0xff;
  }
}

// ---------------------------------------------------------------------------
// High-level container readers.
// ---------------------------------------------------------------------------

export const BARDSTALE_PICTURE_WIDTH = 112;
export const BARDSTALE_PICTURE_HEIGHT = 88;

export interface BardstalePicture {
  /** 4bpp-planar (BT1/BT2) or 4bpp-chunky (BT3) pixel bytes — decode with the matching helper. */
  basePicture: Uint8Array;
  paletteWords: number[];
}

/** Read a 16-word (32-byte) big-endian Amiga palette out of a decoded byte buffer. */
function paletteWordsFromBytes(bytes: Uint8Array, offset = 0, count = 16): number[] {
  const words: number[] = [];
  for (let i = 0; i < count; i++) {
    words.push(((bytes[offset + i * 2]! << 8) | bytes[offset + i * 2 + 1]!) & 0xffff);
  }
  return words;
}

/**
 * BT1/BT2 "pics"/"pics2" — self-describing container: a `u32BE` directory
 * of per-picture start offsets (`dump[pictureIndex*4]`, no explicit count
 * field), each pointing at a record shaped
 * `[u32 sizeDst][u32 unk][huffman tree][huffman-coded: 32B palette + (sizeDst-32)B picture]`.
 * BT2 additionally bit-transposes + XOR-deltas the huffman output; BT1
 * RLE-decodes it. Both converge on a 112x88 4bpp PLANAR base picture (the
 * static "view window" frame — animation overlay data follows, not yet
 * decoded here). Ported from `Picture_Amiga.LoadBard_1_2[_Single]`.
 */
export function loadBard12Picture(dump: Uint8Array, pictureIndex: number, bardVersion: 1 | 2): BardstalePicture {
  const recordOffset = readU32BE(dump, pictureIndex * 4);
  if (recordOffset >= dump.length) {
    throw new Error(`loadBard12Picture: record offset ${recordOffset} past end of buffer (bad pictureIndex ${pictureIndex}?)`);
  }
  const at: Cursor = { v: recordOffset };
  const sizeDst = readU32BERef(dump, at);
  readU32BERef(dump, at); // `unk` in the C# source — always 0x167B6 there, role unconfirmed.

  // A garbage `sizeDst` (e.g. probing a pictureIndex past the real
  // directory, landing the "record" inside unrelated payload bytes) can
  // otherwise drive `huffman.decode(sizeDst - 32)` into allocating/looping
  // over billions of "bytes" — the tree-walk inside decode() only touches
  // the bit reader, which silently goes stale at EOF (a faithful port of
  // the original's quirk) rather than throwing, so it never hits `readU8`'s
  // bounds check. Every real record's picture is 112x88 4bpp (4928 bytes)
  // plus the 32-byte palette, so a generous cap catches corrupt records
  // fast instead of hanging or exhausting memory.
  if (sizeDst < 32 || sizeDst > 200_000) {
    throw new Error(`loadBard12Picture: implausible sizeDst ${sizeDst} (bad pictureIndex ${pictureIndex}?)`);
  }

  const huffman = new BardstaleHuffmanDecoder(dump, at);
  const paletteBytes = huffman.decode(32);
  const payload = huffman.decode(sizeDst - 32);

  let basePicture: Uint8Array;
  if (bardVersion === 1) {
    const bb = decodeBardstaleRLE(payload, { v: 0 });
    const expected = (BARDSTALE_PICTURE_WIDTH * BARDSTALE_PICTURE_HEIGHT) / 2;
    if (bb.length !== expected) throw new Error(`loadBard12Picture: BT1 RLE output ${bb.length}B, expected ${expected}B`);
    basePicture = bb;
  } else {
    const b1 = bardstale2Uncrypt1(payload);
    bardstale2Uncrypt2(b1);
    basePicture = b1;
  }

  return { basePicture, paletteWords: paletteWordsFromBytes(paletteBytes) };
}

export interface BardstaleBard3Picture {
  /** 4 chunky (packed-nibble) 112x88 4bpp sub-frames, concatenated (4928 bytes each). */
  subFrames: Uint8Array;
  paletteWords: number[];
}

/**
 * BT3 "all.pic" — same directory-of-offsets convention as `pics`/`pics2`
 * (`u32BE[N+1]`, last entry == file length), but each record is
 * `[u32 uncompressedSize][LZ77+adaptive-Huffman stream]` decoding to 4
 * chunky 112x88 4bpp sub-frames (19712 = 4 x 4928 bytes) with an
 * inter-frame XOR delta on top. Palette comes from a *separate* file,
 * `bard3`, via a small id-remap table (`0x2589E`, 88 entries: value =
 * this all.pic index, position = the row consumed by the palette-select
 * table at `0x25A98`) — not every all.pic index need appear in it. Ported
 * from `Picture_Amiga.LoadBard_3`/`GetPictureIndexGame`/`GetPalette_Bard3`.
 */
export function loadBard3Picture(allPic: Uint8Array, bard3: Uint8Array, pictureIndex: number): BardstaleBard3Picture {
  const offsetStart = readU32BE(allPic, pictureIndex * 4);
  const offsetNext = readU32BE(allPic, (pictureIndex + 1) * 4);
  const compressedSize = offsetNext - offsetStart;

  const at: Cursor = { v: offsetStart };
  const uncompressedSize = readU32BERef(allPic, at);
  const subFrames = unpackBard3(allPic, at, uncompressedSize);
  if (offsetStart + compressedSize !== at.v - 1) {
    throw new Error(
      `loadBard3Picture: compressed-size mismatch at index ${pictureIndex} (expected end ${offsetStart + compressedSize}, got ${at.v - 1})`,
    );
  }
  uncryptXorBard3(subFrames);

  return { subFrames, paletteWords: getPaletteBard3Words(bard3, pictureIndex) };
}

/** `bard3`'s id-remap table: which of its 88 rows corresponds to `all.pic` index `pictureIndex`. */
function getPictureIndexGame(bard3: Uint8Array, pictureIndex: number): number {
  for (let i = 0; i < 88; i++) {
    if (bard3[0x2589e + i] === pictureIndex) return i;
  }
  throw new Error(`getPictureIndexGame: no row in bard3's id-remap table for all.pic index ${pictureIndex}`);
}

function getPaletteBard3Words(bard3: Uint8Array, pictureIndex: number): number[] {
  const i = getPictureIndexGame(bard3, pictureIndex);
  const paletteIndex = bard3[0x25a98 + i]!;
  const paletteOffset = 0x25978 + paletteIndex * 16 * 2;
  return paletteWordsFromBytes(bard3, paletteOffset);
}
