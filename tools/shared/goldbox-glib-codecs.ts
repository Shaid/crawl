/**
 * Curse of the Azure Bonds / Secret of the Silver Blades / Pools of Darkness
 * (Amiga) — the two compression codecs used by **nested** `GLIB`
 * sub-containers.
 *
 * ## Why this exists
 *
 * `goldbox-glib.ts` documents the container. What it does not cover is that
 * a nested sub-container's **payload can be compressed**, with the
 * sub-container's own 16-byte header describing the *decompressed* image
 * rather than the bytes on disk. That is why every nested `"TILE"`
 * sub-container inside one `8X8D.TLB` appears to carry an identical
 * "template" header (`totalSize`/`blockCount` constant across every entry,
 * and larger than several entries' real outer allocation): the header is
 * genuine and is read by the game — it just describes the buffer *after*
 * decompression. See `docs/goldbox-glib-format.md` §5.
 *
 * ## Where the method lives
 *
 * The **high byte of the container's `flags` word** (offset 10, i.e. the
 * byte at container+10) is the compression method id. Confirmed from
 * Curse's own loader: `move.b -0x6(a5),d0` at `Curse` CODE+0x3D300 feeds
 * that byte, sign-extended, as the last argument of the decompress driver
 * at CODE+0x3D1B6, which switches on it. (All offsets in this file are
 * **CODE-hunk-relative**, i.e. file offset - 40 for `Curse`, whose single
 * CODE hunk's data starts at file offset 40.)
 *
 * Method ids seen in the corpus (326 nested `"TILE"` sub-containers across
 * all three titles): `0` = stored, `3` = 10-bit LZW, `5` = byte-oriented
 * LZ77. Curse's executable implements 1/2/3 only; Secret's and Pools of
 * Darkness' implement a 6-entry jump table (0..5). Methods 1, 2 and 4 are
 * never used by any shipped data file in this corpus.
 *
 * ## The framing every compressed method shares
 *
 * From the driver at CODE+0x3D1B6 (Curse) / CODE+0x417AE (Secret):
 *
 * ```
 *   payload      = the sub-container's bytes AFTER its 16-byte header
 *   slack        = BE u16 at payload[0..2)        (see below)
 *   stream       = payload[2..]                   <- codec input starts here
 *   outputLength = header.totalSize - 16          <- codec output length
 * ```
 *
 * The game decompresses **in place**: it grows the buffer by
 * `totalSize - allocatedSize + slack` bytes at the payload start (which
 * slides the compressed bytes to the *end* of the enlarged region), then
 * runs the codec forward with the source pointer permanently ahead of the
 * destination pointer. `slack` is the extra head-room the compressor
 * measured as necessary to stop the writer catching the reader; it is not
 * part of the codec. Its practical use here is as a **verification
 * oracle**: a correct decode consumes the stream to within `0..1` bytes of
 * its end, which holds for 318/318 compressed sub-containers corpus-wide.
 *
 * Output is produced in chunks of at most `0x2000` bytes; each chunk is an
 * independently framed codec call (method 3 re-primes its bit register per
 * chunk; method 5 ends each chunk with an explicit end token). The LZW
 * dictionary persists across chunks of the same block.
 *
 * ## Method 3 — 10-bit LZW (`Curse` CODE+0x3D55E / +0x3DAE2 / +0x3DA8C)
 *
 * Textbook LZW, MSB-first, **fixed** 10-bit codes (never widened), over a
 * 1024-entry dictionary held in a 0x1004-byte workspace built by
 * CODE+0x3D4F0:
 *
 * | Workspace offset | Size | Field |
 * |---|---|---|
 * | `0x0000` | `u8[1024]` | slot state: `0` free, `1..0x7F` referenced, `0x80..0xFF` in use |
 * | `0x0400` | `u8[2]` | always `0` — sentinel that ends the free-slot scan at 0x400 |
 * | `0x0402` | `u8[1024]` | suffix byte per code (`0..255` = identity) |
 * | `0x0802` | `u16[1024]` | prefix code per code (`0..255` = `0xFFFF`) |
 * | `0x1002` | `u16` | next free code (starts at `0x100`) |
 *
 * Unusually, the dictionary is never *cleared*. When it fills, CODE+0x3D472
 * prunes it: repeatedly free every in-use entry that no surviving entry
 * uses as a prefix (i.e. every leaf), never freeing the code just emitted,
 * until at least 0x55 slots are free; allocation then resumes at the lowest
 * freed slot. New entries are appended to whatever slots the free-list scan
 * finds, so code numbers are *not* monotonic after the first prune.
 *
 * ## Method 5 — byte-oriented LZ77 (`Secret` CODE+0x454FC)
 *
 * A three-class token stream; the length argument the caller passes is
 * ignored, the stream ends on its own terminator token.
 *
 * | Lead byte | Size | Meaning |
 * |---|---|---|
 * | `0x00-0x7F` | 2 | short match. `lit = (b1>>3)&3` literals, then `dist = ((b1<<2)&0x380) \| b0`, `len = (b1&7)+3` |
 * | `0x80-0xBF` | 3 | long match. `lit = b2&3` literals, then `dist = (b0&0x3F) \| ((b1&0xE0)<<1) \| ((b2<<7)&0x7E00)`, `len = (b1&0x1F)+3` |
 * | `0xC0-0xCF` | 1 | literal run of `((b0&0xF)+1)*4` bytes |
 * | `0xD0-0xDF` | 1 | literal run of `b0&0xF` bytes |
 * | `0xE0-0xFF` | 1 | end of chunk |
 *
 * A match's literals are emitted **before** the copy, and the copy source is
 * `dst - dist - 1` measured *after* those literals, so it can overlap the
 * write cursor (byte-at-a-time copy, run-length semantics).
 *
 * ## Verification
 *
 * - 326/326 nested `"TILE"` sub-containers in all three titles decode to
 *   exactly `totalSize - 16` bytes, and the decompressed body is in every
 *   case a well-formed GLIB body: `offsets[0] == 16 + 4*(blockCount+1)`,
 *   `offsets[blockCount] == totalSize`, monotonic throughout. Zero failures.
 * - 318/318 compressed sub-containers leave 0 or 1 unconsumed input bytes.
 * - **Byte-exact cross-title oracle:** Secret's `DISK1/8X8D.TLB` id 202
 *   (method 5, 242 compressed bytes) decompresses to 884 bytes that are
 *   **identical, all 884/884, zero deviation**, to Curse's `DISKA/8X8D.TLB`
 *   id 202, which is stored uncompressed (method 0). The two games ship the
 *   same universal tile bank, one packed and one not.
 */
import type { GlibBlock } from './goldbox-glib.ts';

const LZW_MAX_CODE = 0x400;
const CHUNK = 0x2000;

/** Compression method id — the high byte of a container's `flags` word. */
export function glibCompressionMethod(data: Uint8Array, baseOffset = 0): number {
  return data[baseOffset + 10];
}

interface LzwState {
  /** slot state: 0 free, 1..0x7f referenced, 0x80..0xff in use */
  state: Uint8Array;
  suffix: Uint8Array;
  prefix: Uint16Array;
  next: number;
}

function newLzwState(): LzwState {
  const state = new Uint8Array(LZW_MAX_CODE + 2);
  state.fill(0xff, 0, 0x100);
  const suffix = new Uint8Array(LZW_MAX_CODE);
  for (let i = 0; i < 0x100; i++) suffix[i] = i;
  const prefix = new Uint16Array(LZW_MAX_CODE).fill(0xffff);
  return { state, suffix, prefix, next: 0x100 };
}

/** Expand one code into `out`; returns the first byte emitted (Curse CODE+0x3DA8C). */
function lzwEmit(out: number[], code: number, ws: LzwState): number {
  const stack: number[] = [];
  let c = code;
  while (c >= 0x100) {
    if (c >= LZW_MAX_CODE || stack.length > LZW_MAX_CODE) {
      throw new Error(`glib LZW: corrupt prefix chain at code ${c}`);
    }
    stack.push(ws.suffix[c]);
    c = ws.prefix[c];
  }
  out.push(c);
  for (let i = stack.length - 1; i >= 0; i--) out.push(stack[i]);
  return c;
}

/** Prune every leaf entry until >=0x55 slots are free; returns the lowest freed slot (Curse CODE+0x3D472). */
function lzwRecycle(keep: number, ws: LzwState, current: number): number {
  let freed = 0;
  let lowest = current;
  for (;;) {
    for (let c = 0x100; c < LZW_MAX_CODE; c++) {
      const v = ws.state[c];
      if (v >= 0x80) {
        // in use, unreferenced this round
        if (c !== keep) {
          ws.state[c] = 0;
          freed++;
          if (c < lowest) lowest = c;
        }
      } else if (v > 0) {
        ws.state[c] = 0xff; // referenced -> age it for the next round
      }
    }
    for (let c = 0x100; c < LZW_MAX_CODE; c++) {
      if (ws.state[c] !== 0) ws.state[ws.prefix[c] & (LZW_MAX_CODE - 1)] = 1;
    }
    if (freed >= 0x55) return lowest;
  }
}

/** One <=0x2000-byte output chunk of method 3 (Curse CODE+0x3D55E / +0x3DAE2). Returns the new source position. */
function lzwChunk(src: Uint8Array, startPos: number, outLength: number, ws: LzwState, out: number[]): number {
  let pos = startPos;
  const end = out.length + outLength;
  if (pos + 1 >= src.length) throw new Error('glib LZW: stream truncated at chunk header');
  // 16-bit shift register, primed with the first two stream bytes; the first
  // code is its top 10 bits, leaving 6 unconsumed low bits.
  let reg = ((src[pos] << 8) | src[pos + 1]) & 0xffff;
  pos += 2;
  let shift = 6;
  let prev = reg >>> 6;
  lzwEmit(out, prev, ws);
  let free = ws.next;

  while (out.length < end) {
    if (shift !== 0) {
      if (pos >= src.length) throw new Error('glib LZW: stream truncated');
      reg = ((reg << 8) | src[pos++]) & 0xffff;
      shift -= 2;
    } else {
      if (pos + 1 >= src.length) throw new Error('glib LZW: stream truncated');
      reg = ((src[pos] << 8) | src[pos + 1]) & 0xffff;
      pos += 2;
      shift = 6;
    }
    const code = (reg >>> shift) & 0x3ff;
    const first = lzwEmit(out, code, ws);
    if (free >= LZW_MAX_CODE) free = lzwRecycle(prev, ws, free);
    ws.state[prev & (LZW_MAX_CODE - 1)] = 1;
    ws.state[free] = 0xff;
    ws.suffix[free] = first;
    ws.prefix[free] = prev;
    let scan = free + 1;
    while (ws.state[scan] !== 0) scan++;
    free = scan;
    prev = code;
  }
  ws.next = free;
  return pos;
}

/** One chunk of method 5 — self-terminating (Secret CODE+0x454FC). Returns the new source position. */
function lz77Chunk(src: Uint8Array, startPos: number, out: number[]): number {
  let pos = startPos;
  for (;;) {
    if (pos >= src.length) throw new Error('glib LZ77: stream truncated');
    const b0 = src[pos++];
    if ((b0 & 0x80) === 0) {
      const b1 = src[pos++];
      for (let i = (b1 >> 3) & 3; i > 0; i--) out.push(src[pos++]);
      let ref = out.length - (((b1 << 2) & 0x380) | b0) - 1;
      if (ref < 0) throw new Error('glib LZ77: match before start of output');
      for (let i = (b1 & 7) + 3; i > 0; i--) out.push(out[ref++]);
    } else if ((b0 & 0x40) === 0) {
      const b1 = src[pos++];
      const b2 = src[pos++];
      for (let i = b2 & 3; i > 0; i--) out.push(src[pos++]);
      let ref = out.length - ((b0 & 0x3f) | ((b1 & 0xe0) << 1) | ((b2 << 7) & 0x7e00)) - 1;
      if (ref < 0) throw new Error('glib LZ77: match before start of output');
      for (let i = (b1 & 0x1f) + 3; i > 0; i--) out.push(out[ref++]);
    } else if ((b0 & 0x20) === 0) {
      const n = b0 & 0x10 ? b0 & 0x0f : ((b0 & 0x0f) + 1) * 4;
      for (let i = n; i > 0; i--) out.push(src[pos++]);
    } else {
      return pos;
    }
  }
}

/**
 * Decompress a nested GLIB sub-container into its full in-memory image:
 * its own unmodified 16-byte header followed by `totalSize - 16`
 * decompressed body bytes. The result can be handed straight to
 * `parseGlibContainer(image, 0)` / `readBlock` — a stored (method 0)
 * container is returned as a plain copy, so callers need no special case.
 */
export function decompressGlibBlock(data: Uint8Array, block: GlibBlock): Uint8Array {
  const base = block.start;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalSize = view.getUint32(base + 4, false);
  const method = data[base + 10];
  if (method === 0) return data.slice(base, base + totalSize);

  const payload = data.subarray(base + 16, block.end);
  const outLength = totalSize - 16;
  const out: number[] = [];
  let pos = 2; // skip the u16 in-place-expansion slack word
  const ws = method === 3 ? newLzwState() : undefined;
  while (out.length < outLength) {
    if (method === 3) {
      pos = lzwChunk(payload, pos, Math.min(outLength - out.length, CHUNK), ws!, out);
    } else if (method === 5) {
      pos = lz77Chunk(payload, pos, out);
    } else {
      throw new Error(`glib: unimplemented compression method ${method}`);
    }
  }
  if (out.length !== outLength) {
    throw new Error(`glib method ${method}: produced ${out.length} bytes, expected ${outLength}`);
  }
  const image = new Uint8Array(totalSize);
  image.set(data.subarray(base, base + 16), 0);
  image.set(Uint8Array.from(out), 16);
  return image;
}
