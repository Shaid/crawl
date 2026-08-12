/**
 * Wizardry 6 (DOS/EGA) block-oriented byte RLE.
 *
 * Every `*.PIC` file in the DOS release is stored with this codec; the
 * decompressed bytes are the DOS-native `.PIC` image (see `pic-format-dos.ts`).
 *
 * Token stream (confirmed -- 59/59 `mon##.pic` files decompress byte-exactly
 * to the Amiga release's own tile payload, 939,144 bytes, zero deviation):
 *
 *   c = 0x01..0x7F   copy the next `c` bytes literally
 *   c = 0x80..0xFF   emit `256 - c` copies of the next byte (i.e. `-(int8)c`,
 *                    so 0xFF = 1 and 0x80 = 128)
 *
 * There is no end-of-stream marker; decoding runs to the end of the input.
 *
 * Block rule: the compressed stream is cut into 4096-byte blocks and **no
 * token straddles a block boundary** -- the game reads the file a 4 KB disk
 * buffer at a time. Because the shortest possible token is 2 bytes, an encoder
 * that fills a block can be left with at most one unusable byte, which is
 * emitted as filler and must be skipped. Observed corpus-wide: 85 of 210
 * blocks carry exactly one filler byte (65 of them `0x00`, 20 an arbitrary
 * stale value such as 0x20/0x7F/0xFF -- it is *not* a sentinel), and no block
 * ever has two or more bytes left over.
 *
 * Consequently `c == 0x00` is never a real token: all 65 occurrences in the
 * corpus sit at exactly `blockEnd - 1`.
 *
 * The block size is uniquely determined: decoding the corpus with a block size
 * of 1024/2048/4096/8192/16384/none yields 2/4/59/49/42/40 byte-exact files out
 * of 59 -- only 4096 decodes the whole corpus.
 */

/** Compressed blocks are 4096 bytes; tokens never cross a block boundary. */
export const RLE_BLOCK_SIZE = 4096;

/** Shortest legal token (`literal-1` or a run) -- both are 2 bytes. */
const MIN_TOKEN_SIZE = 2;

/**
 * Decompress a DOS Wizardry 6 RLE stream.
 *
 * @param src        the whole compressed file
 * @param blockSize  block granularity (only ever 4096 in the shipped data)
 */
export function decompressDosRle(src: Uint8Array, blockSize = RLE_BLOCK_SIZE): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let i = 0;

  while (i < src.length) {
    const blockEnd = Math.min((Math.floor(i / blockSize) + 1) * blockSize, src.length);

    // Fewer bytes left in this block than the shortest token: filler, skip it.
    if (blockEnd - i < MIN_TOKEN_SIZE) {
      i = blockEnd;
      continue;
    }

    const ctrl = src[i++];
    if (ctrl >= 0x80) {
      const count = 256 - ctrl;
      const run = new Uint8Array(count).fill(src[i++]);
      chunks.push(run);
      total += count;
    } else {
      // ctrl === 0 cannot occur mid-block in the shipped data; treated as a
      // zero-length literal so a malformed stream still terminates.
      const lit = src.subarray(i, i + ctrl);
      i += ctrl;
      chunks.push(lit);
      total += lit.length;
    }
  }

  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
