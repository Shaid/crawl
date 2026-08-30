/**
 * Silmarils "ALIS" engine script/resource depacker — the compression codec
 * used by every `.DO`/`.CO` file in the Ishar trilogy and Crystals of
 * Arborea (see `docs/ishar-container-format.md`).
 *
 * This is a faithful, line-for-line TypeScript port of the reference C
 * implementation at https://github.com/maestun/alis (`src/unpack.c`,
 * itself reverse-engineered by that project's author from the original
 * ALIS interpreter) — NOT an independent re-derivation. It matches this
 * project's own structural findings exactly:
 *
 * - `magic = readU32BE(0)`; `packerKind = magic >>> 24` is exactly this
 *   project's `classByte` (`ishar-container.ts`): `0x81` = "old" RLE,
 *   `0x80` = "old interlaced" RLE, `0xA1` = "new" LZ77-style codec.
 * - `unpackedSize = magic & 0x00ffffff` is exactly `(sizeHigh << 16) |
 *   sizeLow` from `parseIsharHeader`.
 * - The `u16` at file offset 4 (this project's "table[0:2]", always `0x0001`
 *   in every non-`MAIN.DO`/`MAIN.CO` file sampled) is `isMain` — 0 means
 *   this file is the engine's root/main script (`MAIN.DO`/`MAIN.CO`), which
 *   carries an extra 16-byte "VM specs" block right after it. This
 *   explains why this project found `MAIN.DO`'s header bytes 4-5 read as
 *   `00 00` while every other file's read `00 01`.
 * - For `packerKind === 0xA1` only, the 8 bytes at file offset 6-13 are a
 *   real per-value bit-width dictionary (indexed by a 3-bit decoded value)
 *   — this project's "10-byte constant table at offset 4-13" was actually
 *   `[isMain u16][8-byte dictionary]`, not one 10-byte blob; the dictionary
 *   itself (`00 01 0B 09 0A 0B 07 05 06 07`[2:10] = `0B 09 0A 0B 07 05 06
 *   07`) being corpus-wide constant just means every Ishar 1/2/3 `0xA1`
 *   file reuses the identical bit-width table, i.e. a shared codec
 *   constant, not per-file tuning.
 *
 * The "old" codec (`0x81`/`0x80`) is classic high-bit-flag RLE (PackBits-
 * style): a control byte with bit 7 clear starts a literal run of
 * `byte & 0x7f` bytes copied verbatim; bit 7 set starts a run-length run
 * (`byte & 0x7f` repeats of the next byte). This is exactly why this
 * project found `MAIN.DO` (an `0x81` file) leaking long readable ASCII
 * filename strings under a plain `strings` pass — RLE literal runs pass
 * incompressible text through unmodified — while `0xA1` pixel-data files
 * showed zero readable fragments and near-maximal body entropy.
 *
 * The "new" codec (`0xA1`) is a genuine LZ77-style bitstream: a 32-bit
 * rotating shift register (`d5`) refilled 16 bits at a time from the
 * packed stream (`d7` tracks bits remaining before the next refill),
 * decoding either a literal run or a back-reference match (self-
 * referencing copy, distance/length pairs looked up via the dictionary's
 * per-index bit-width). Ported as literally as possible from the C source
 * — including its exact 8/16/32-bit signed/unsigned truncation semantics,
 * via the `s8`/`s16`/`u32rot` helpers below — rather than "cleaned up",
 * since a byte-inexact LZ port fails silently on real data (see this
 * project's `byte-exact-adpcm-needs-exact-integer-sequence.md`-style
 * pitfall, same principle for LZ literal/match decoders).
 */

const PACKER_KIND_OLD = 0x81;
const PACKER_KIND_OLD_INTERLACED = 0x80;
const PACKER_KIND_NEW = 0xa1;
const PACKED_HEADER_SIZE = 6; // magic (4) + isMain u16 (2)
const PACKED_DICTIONARY_SIZE = 8;
const VM_SPECS_SIZE = 16;

export interface UnpackResult {
  packerKind: number;
  isMain: boolean;
  data: Uint8Array;
}

/** Sign-extend the low 8 bits of `v` (C's `s8` truncation). */
function s8(v: number): number {
  return (v << 24) >> 24;
}

/** Sign-extend the low 16 bits of `v` (C's `s16` truncation). */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/** 32-bit rotate-left, matching `rotll()` (`shift` masked to 0-31 like C's `sizeof(u32)*8-1`). */
function rotl32(shift: number, value: number): number {
  shift = shift & 31;
  if (shift === 0) return value | 0;
  const uv = value >>> 0;
  return ((uv << shift) | (uv >>> (32 - shift))) | 0;
}

/** Swap high/low 16-bit halves of a 32-bit value, matching `swap()`. */
function swapHalves(value: number): number {
  const uv = value >>> 0;
  const hi = uv & 0xffff0000;
  const lo = uv & 0x0000ffff;
  return ((lo << 16) | (hi >>> 16)) | 0;
}

/**
 * Decoder state + `decode()`/`count()`/`writeNeg()`, ported as a small
 * class instead of C's file-scope globals (`d5`, `d7`, `__unpack_counter`)
 * to keep this reentrant.
 */
class NewUnpacker {
  private d5 = 0;
  private d7 = 0;
  private packedPos = 0;
  private readonly packed: Uint8Array;
  private readonly dictionary: Uint8Array;
  private readonly unpacked: Uint8Array;
  private unpackedPos = 0;

  constructor(packed: Uint8Array, unpacked: Uint8Array, dictionary: Uint8Array) {
    this.packed = packed;
    this.unpacked = unpacked;
    this.dictionary = dictionary;
  }

  private readPackedByte(): number {
    // C's `write_neg`/`decode` don't bounds-check packed reads at all
    // (the reference implementation trusts `packed_size` to be enough) --
    // clamp defensively instead of reading undefined/throwing.
    if (this.packedPos >= this.packed.length) return 0;
    return this.packed[this.packedPos++];
  }

  /** Port of `decode(u8** ptr_packed, u16 bit)`. */
  private decode(bit: number): void {
    this.d5 = this.d5 & 0xffff0000;
    this.d7 = (this.d7 & 0xffffff00) + (((s8(this.d7) - s8(bit)) & 0xff) | 0);
    this.d7 |= 0;
    if (s8(this.d7) < 0) {
      // "worm" -- refill the 16-bit window from the packed stream.
      this.d7 = ((this.d7 & 0xffffff00) + (((s8(this.d7) + s8(bit)) & 0xff) | 0)) | 0;
      this.d5 = this.d5 & 0xffff0000;
      this.d5 = rotl32(this.d7 & 0xff, this.d5);
      this.d5 = swapHalves(this.d5);

      const hi = this.readPackedByte();
      const lo = this.readPackedByte();
      const packWord = ((hi << 8) + lo) & 0xffff;
      this.d5 = ((this.d5 & 0xffff0000) + packWord) | 0;
      this.d5 = swapHalves(this.d5);

      const newBit = ((s8(bit) - s8(this.d7)) & 0xff) | 0;
      this.d7 = 0x10;
      this.d5 = rotl32(newBit & 0xff, this.d5);
      this.d7 = (this.d7 & 0xffffff00) + (((s8(this.d7) - s8(newBit)) & 0xff) | 0);
    } else {
      this.d5 = rotl32(bit & 0xff, this.d5);
    }
  }

  /** Port of `count(u8** ptr_packed, u8 start, u8 stop, s16* counter)`. */
  private countBits(start: number, stop: number): number {
    let counter = 0;
    for (;;) {
      this.decode(start);
      counter = s16(counter + s16(this.d5 & 0xffff));
      if (s16(this.d5 & 0xffff) !== stop) break;
    }
    return counter;
  }

  /** Port of `write_neg(u8** ptr_unpacked, s16 val, s16* counter)`. */
  private writeNeg(val: number, counter: number): void {
    const offset = s16(val * -1);
    for (;;) {
      const src = this.unpackedPos + offset - 1;
      const c = src >= 0 && src < this.unpacked.length ? this.unpacked[src] : 0;
      if (this.unpackedPos < this.unpacked.length) this.unpacked[this.unpackedPos] = c;
      this.unpackedPos++;
      counter = s16(counter - 1);
      if (counter === -1) break;
    }
  }

  /** Port of `unpack_new()`'s main loop. Returns bytes written. */
  run(unpackedSize: number): number {
    const end = unpackedSize - 1;
    this.d7 = 0;
    while (this.unpackedPos < end) {
      this.decode(1);
      if (s8(this.d5 & 0xff) !== 0) {
        let counter = this.countBits(2, 3);
        for (;;) {
          this.decode(8);
          if (this.unpackedPos < this.unpacked.length) {
            this.unpacked[this.unpackedPos] = this.d5 & 0xff;
          }
          this.unpackedPos++;
          counter = s16(counter - 1);
          if (counter === -1) break;
        }
        if (this.unpackedPos >= end) break;
      }

      this.decode(3);
      const bit = this.dictionary[s8(this.d5 & 0xff) & 0xff] ?? 0;
      this.d5 = (this.d5 & 0xffff0000) + s16(this.d5 & 3);
      const lowWord = s16(this.d5 & 0xffff);
      if (lowWord !== 0) {
        const counter = lowWord;
        this.decode(bit);
        this.writeNeg(s16(this.d5 & 0xffff), counter);
      } else {
        this.decode(bit);
        const savedLowWord = s16(this.d5 & 0xffff);
        let counter = this.countBits(3, 7);
        counter = s16(counter + 4);
        this.writeNeg(savedLowWord, counter);
      }
    }
    return this.unpackedPos;
  }
}

/** Port of `unpack_new()`: LZ77-style bitstream, `classByte === 0xA1`. */
export function unpackNew(packed: Uint8Array, unpackedSize: number, dictionary: Uint8Array): Uint8Array {
  const unpacked = new Uint8Array(unpackedSize);
  new NewUnpacker(packed, unpacked, dictionary).run(unpackedSize);
  return unpacked;
}

/** Port of `unpack_old()`: high-bit-flag RLE, `classByte === 0x81`/`0x80`. */
export function unpackOld(
  packed: Uint8Array,
  packedSize: number,
  unpackedSize: number,
  interlaced: boolean,
): Uint8Array {
  const unpacked = new Uint8Array(unpackedSize);
  const inc = interlaced ? 8 : 1;
  let cnt = inc;
  let packedPos = 0;
  let base = 0;

  const readByte = (): number => (packedPos < packedSize && packedPos < packed.length ? packed[packedPos++] : 0);

  do {
    let pos = base;
    while (pos < unpackedSize) {
      let d1 = readByte();
      let counter = d1 & 0x7f;
      if (d1 & 0x80) {
        d1 = readByte();
        while (counter-- > 0) {
          if (pos < unpackedSize) unpacked[pos] = d1;
          pos += inc;
        }
      } else {
        while (counter-- > 0) {
          d1 = readByte();
          if (pos < unpackedSize) unpacked[pos] = d1;
          pos += inc;
        }
      }
    }
    base++;
    packedPos++;
    cnt--;
  } while (cnt > 0);

  return unpacked;
}

/**
 * Top-level entry point, matching `unpack_script()`. Returns `null` if the
 * buffer's leading byte isn't a recognized packer-kind magic (i.e. it's
 * not a packed Silmarils resource at all).
 */
export function unpackSilmarilsScript(buf: Buffer | Uint8Array): UnpackResult | null {
  const view = buf instanceof Buffer ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.length < PACKED_HEADER_SIZE) return null;

  const magic = view.readUInt32BE(0);
  const packerKind = magic >>> 24;
  if (packerKind !== PACKER_KIND_OLD && packerKind !== PACKER_KIND_OLD_INTERLACED && packerKind !== PACKER_KIND_NEW) {
    return null;
  }

  const isMain = view.readUInt16BE(4) === 0;
  let pos = PACKED_HEADER_SIZE;
  let packedSize = view.length - PACKED_HEADER_SIZE;
  let unpackedSize = (magic & 0x00ffffff) - PACKED_HEADER_SIZE;

  if (isMain) {
    pos += VM_SPECS_SIZE;
    packedSize -= VM_SPECS_SIZE;
    unpackedSize -= VM_SPECS_SIZE;
  }

  let dictionary: Uint8Array = new Uint8Array(0);
  if (packerKind === PACKER_KIND_NEW) {
    dictionary = view.subarray(pos, pos + PACKED_DICTIONARY_SIZE);
    pos += PACKED_DICTIONARY_SIZE;
    packedSize -= PACKED_DICTIONARY_SIZE;
  }

  const packedBuffer = view.subarray(pos, pos + Math.max(packedSize, 0));

  let data: Uint8Array;
  if (unpackedSize <= 0) {
    data = new Uint8Array(0);
  } else if (packerKind === PACKER_KIND_NEW) {
    data = unpackNew(packedBuffer, unpackedSize, dictionary);
  } else if (packerKind === PACKER_KIND_OLD) {
    data = unpackOld(packedBuffer, packedSize, unpackedSize, false);
  } else {
    data = unpackOld(packedBuffer, packedSize, unpackedSize, true);
  }

  return { packerKind, isMain, data };
}
