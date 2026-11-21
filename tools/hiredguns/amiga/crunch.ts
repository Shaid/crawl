/**
 * Hired Guns (Amiga): decruncher for the `CharactersGfx/*.gfx` and
 * `MonstersGfx/*.gfx` packer — the stream that starts `0x7790…` after a
 * 10-byte header and that `ancient` does not recognise.
 *
 * Learned from the game's own routine (`cr_decrunch`/`decrunchc` in the DMA
 * CD32 dev archive `Sources/Miscroutines.s`, called by `load_new_mons1` in
 * `Sources/Controls&Movement.s`); this is an independent re-implementation,
 * not a translation. It is the ByteKiller-family backward LZ scheme:
 *
 *   header  +0 u8  bits left in the first (last) byte, minus 1
 *           +1 u8  checksum seed (XOR of every packed byte read must cancel it)
 *           +2 u32 unpacked length
 *           +6 u32 packed length, counted from the start of the header (= file size)
 *
 * The bit stream is read **backwards** from the end of the packed data, each
 * byte LSB first; output is written backwards from the end of the buffer.
 * Tokens (bits read MSB-first into the value):
 *   0,0,nnn            nnn+1 literal bytes (1..8)
 *   0,1,oooooooo       2-byte copy, 8-bit offset
 *   1,00,o(9)          3-byte copy, 9-bit offset
 *   1,01,o(10)         4-byte copy, 10-bit offset
 *   1,10,nnnnnnnn,o(12) n+1-byte copy, 12-bit offset
 *   1,11,nnnnnnnn      n+9 literal bytes (9..264)
 * A copy of offset o reads the byte o+1 positions *after* the one being written.
 */

export class CrunchError extends Error {}

export function crunchHeader(src: Uint8Array): { unpacked: number; packed: number } {
  if (src.length < 10) throw new CrunchError('crunch: header truncated');
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return { unpacked: dv.getUint32(2), packed: dv.getUint32(6) };
}

/** Unpack a crunched buffer. Throws `CrunchError` on a short stream or a checksum mismatch. */
export function decrunch(src: Uint8Array): Uint8Array {
  const { unpacked, packed } = crunchHeader(src);
  if (packed > src.length || packed < 11) throw new CrunchError(`crunch: packed length ${packed} vs buffer ${src.length}`);
  const out = new Uint8Array(unpacked);
  let inPos = packed; // next byte to fetch is src[inPos - 1]
  let bitsLeft = src[0]! + 1;
  let check = src[1]!;
  let cur = src[--inPos]!;
  check ^= cur;

  const fetch = (): void => {
    if (inPos <= 10) throw new CrunchError('crunch: ran past the header');
    cur = src[--inPos]!;
    check ^= cur;
  };
  const bits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (--bitsLeft === 0) { fetch(); bitsLeft = 8; }
      v = (v << 1) | (cur & 1);
      cur >>= 1;
    }
    return v;
  };

  let o = unpacked; // next byte written is out[o - 1]
  const put = (b: number): void => {
    if (o <= 0) throw new CrunchError('crunch: output overflow');
    out[--o] = b;
  };
  const copy = (len: number, offBits: number): void => {
    const off = bits(offBits);
    for (let i = 0; i < len; i++) {
      if (o <= 0) throw new CrunchError('crunch: output overflow');
      o--;
      const s = o + off + 1;
      if (s >= unpacked) throw new CrunchError('crunch: copy source past the end');
      out[o] = out[s]!;
    }
  };
  const literals = (len: number): void => { for (let i = 0; i < len; i++) put(bits(8)); };

  while (o > 0) {
    if (bits(1) === 1) {
      const k = bits(2);
      if (k < 2) copy(k + 3, k + 9);
      else if (k === 3) literals(bits(8) + 9);
      else { const n = bits(8); copy(n + 1, 12); }
    } else if (bits(1) === 1) copy(2, 8);
    else literals(bits(3) + 1);
  }
  if (check !== 0) throw new CrunchError(`crunch: checksum residue 0x${check.toString(16)}`);
  return out;
}
