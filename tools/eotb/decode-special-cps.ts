/**
 * Eye of the Beholder (Amiga) "special" CPS codec --
 * `docs/eotb/amiga/data-structure.md` § "A second, distinct Amiga-only
 * codec (`loadSpecialAmigaCPS`) -- bonus finding".
 *
 * Byte-for-byte port of `Screen_EoB::loadSpecialAmigaCPS` and its two
 * helper functions `decodeFrameAmiga_readNextBit`/`decodeFrameAmiga_readBits`
 * (`engines/kyra/graphics/screen_eob_amiga.cpp:36-154`, fetched 2026-08-29).
 * A backwards-reading, bit-level LZ variant, distinct from the "Format 80"
 * (LCW) codec `../lcw.ts` implements -- **not** used for the same files
 * on every platform release; see "Verification" below for which files in
 * *this* corpus actually exercise it (none, as it turns out).
 *
 * ## The bit reader -- 31 usable bits per 32-bit word, not 32
 *
 * `decodeFrameAmiga_readNextBit` shifts `val` right by 1 and returns the
 * bit that fell out, UNLESS the shift leaves `val === 0` -- in that case
 * the just-computed bit is **discarded**, a new 32-bit big-endian word is
 * read from 4 bytes *before* the current read position (the stream is
 * consumed from its end backwards toward its start), and a synthetic `1`
 * sentinel bit is OR'd into bit 31 of the freshly-loaded word before the
 * *new* word's bit 0 is returned instead. Working through the arithmetic:
 * a freshly-loaded 32-bit value (whether the initial "primed" word or a
 * refilled one) always reaches exactly 0 after 32 shifts regardless of its
 * top bit's real value, so the 32nd extraction from any word is always
 * the one that triggers a refill and has its own bit thrown away -- every
 * word therefore contributes exactly **31** real bits to the stream, with
 * the 32nd position permanently reserved as an implicit "word exhausted"
 * marker. `readBits(count)` composes `count` such bits MSB-first (the
 * first-read bit becomes the most significant of the result).
 *
 * ## Verification
 *
 * The outer call sites (`readLevelFileData`, `scene_eob.cpp:144-145`, and
 * the `TEXT.CPS` loader, `eobcommon.cpp:1743`) both gate on
 * `stream.readSint32BE() + 12 === stream.size()` before invoking this
 * codec at all -- otherwise they fall through to the ordinary Kyra-bitmap
 * (LCW) path. **A whole-corpus check of every file in `data/eotb/amiga/`
 * against this exact gate found zero matches** (see
 * `__tests__/eotb-savegame.test.ts`'s sibling `decode-special-cps.test.ts`)
 * -- every `LEVELn.INF` and `TEXT.CPS` in this EOB1 (English) Amiga corpus
 * has a standard `compType=4` Kyra bitmap header instead and is already
 * served by `../lcw.ts`. This matches the doc's own hedge that this codec
 * is "an EOB2-Amiga-German fallback for `.CPS` files whose header size
 * doesn't match the normal LCW convention" -- this corpus is EOB1,
 * English, so nothing here ever takes this branch. **This codec is
 * therefore unverifiable against any real file in this project's data
 * directories** (same honest-negative shape as `eotb1-amiga-dec-verify`'s
 * "no `.DEC` file exists in this corpus either").
 *
 * In place of a real-file oracle, `__tests__` includes a from-first-
 * principles hand-constructed test vector: a 16-byte synthetic file
 * (`inSize=4, outSize=1`, one compressed word chosen bit-by-bit to drive
 * the literal-byte decode path to emit exactly `0x41` ('A')) with its
 * header `chk` field set so the running XOR checksum -- the format's own
 * self-check, `error("checksum error")` in the source -- lands on exactly
 * 0. This exercises the bit reader and the literal-byte path for real
 * (not just "the port looks right"), though the match-copy paths (the
 * `code<2`/`code===2`/`code===3` branches) remain ported-from-source only,
 * with no oracle in this corpus to exercise them.
 */

export interface SpecialAmigaCpsResult {
  /** Present only when the file's own outer size-gate detected an embedded palette (see module doc). Raw 64 bytes, 32 x 16-bit BE Amiga colour words -- decode with `readBEWords`/`eobAmigaWordToRGB` from `./palette.ts`. */
  palette?: Uint8Array;
  /** Decoded payload, exactly `outSize` bytes. */
  pixels: Uint8Array;
}

function readBE32(data: Uint8Array, off: number): number {
  return ((data[off]! << 24) | (data[off + 1]! << 16) | (data[off + 2]! << 8) | data[off + 3]!) >>> 0;
}

/**
 * The exact gate ScummVM's own call sites use to decide whether a file
 * should go through this codec instead of the ordinary LCW path:
 * `stream.readSint32BE() + 12 === stream.size()` on the *whole file*, read
 * from offset 0 (before any palette-prefix detection this module's own
 * header parse does internally for files that DO take this branch).
 */
export function usesSpecialAmigaCodec(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  // readSint32BE: same 32 bits as readBE32, reinterpreted as signed.
  const u = readBE32(data, 0);
  const s = u >= 0x80000000 ? u - 0x100000000 : u;
  return s + 12 === data.length;
}

export function decodeSpecialAmigaCps(data: Uint8Array): SpecialAmigaCpsResult {
  const fileSize = data.length;
  const inSize0 = readBE32(data, 0);

  let headerPos = 0;
  let palette: Uint8Array | undefined;
  // "Check whether the file starts with the actual compression header. If
  // this is not the case, there should [be] a palette before the header.
  // Unlike normal CPS files these files never have more than one palette."
  if (((inSize0 + 15) & ~3) !== ((fileSize + 3) & ~3)) {
    palette = data.slice(0, 64);
    headerPos = 64;
  }

  const inSize = readBE32(data, headerPos);
  const outSize = readBE32(data, headerPos + 4);
  let chk = readBE32(data, headerPos + 8);

  const dataPtrEnd = headerPos + 8 + inSize; // == data_end - 4, per module doc
  let dataPtr = dataPtrEnd;
  if (dataPtr < headerPos + 12 || dataPtr + 4 > fileSize) {
    throw new Error(
      `decodeSpecialAmigaCps: computed read pointer (${dataPtr}) out of bounds for a ${fileSize}-byte file (inSize=${inSize})`,
    );
  }

  let val = readBE32(data, dataPtr);
  chk ^= val;

  const dst = new Uint8Array(outSize);
  let d = outSize;

  const readNextBit = (): number => {
    let x = val & 1;
    val = val >>> 1;
    if (val !== 0) return x;
    dataPtr -= 4;
    if (dataPtr < 0) throw new Error('decodeSpecialAmigaCps: bit reader ran past the start of the file');
    const newVal = readBE32(data, dataPtr);
    chk ^= newVal;
    val = newVal;
    x = val & 1;
    val = (val >>> 1) | 0x80000000;
    return x;
  };

  const readBits = (count: number): number => {
    let res = 0;
    for (let i = 0; i < count; i++) res = ((res << 1) | readNextBit()) >>> 0;
    return res;
  };

  const dstStart = 0;
  while (d > dstStart) {
    let para = -1;
    let para2 = 0;

    if (readNextBit()) {
      const code = readBits(2);
      if (code === 3) {
        para = para2 = 8;
      } else {
        let cnt: number;
        if (code < 2) {
          cnt = 3 + code;
          para2 = 9 + code;
        } else {
          cnt = readBits(8) + 1;
          para2 = 12;
        }
        const backCode = readBits(para2);
        while (cnt--) {
          d--;
          dst[d] = dst[d + backCode]!;
        }
      }
      // readNextBit() is side-effecting (consumes the next bit from the
      // stream) -- this is NOT a duplicate of the outer `if
      // (readNextBit())` condition, it's reading the *next* bit in
      // sequence, faithfully mirroring the source's
      // `else if (decodeFrameAmiga_readNextBit(...))`.
      // eslint-disable-next-line no-dupe-else-if
    } else if (readNextBit()) {
      const backCode = readBits(8);
      d--;
      dst[d] = dst[d + backCode]!;
      d--;
      dst[d] = dst[d + backCode]!;
    } else {
      para = 3;
    }

    if (para > 0) {
      let code = readBits(para);
      let cnt = (code & 0xffff) + para2 + 1;
      while (cnt--) {
        for (let i = 0; i < 8; i++) code = ((code << 1) | readNextBit()) >>> 0;
        d--;
        dst[d] = code & 0xff;
      }
    }
  }

  if (chk !== 0) {
    throw new Error(`decodeSpecialAmigaCps: checksum error -- expected 0 at EOF, got 0x${chk.toString(16)}`);
  }

  return palette ? { palette, pixels: dst } : { pixels: dst };
}
