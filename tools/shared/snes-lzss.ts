/**
 * Wizardry 6 (SNES)'s general-purpose LZSS decompressor.
 *
 * Confirmed via a `re-codebreaker` escalation (see
 * docs/wizardry6/snes/data-structure.md section 3.8/6.4) and independently
 * re-derived and verified in this session: implementing this exact algorithm
 * from the escalation's cited disassembly and running it against the ROM
 * reproduces byte-exact declared stream lengths for every resource tried,
 * and renders two resources as unambiguous, legible content (the "ASCII"
 * corporate logo and a full alphanumeric+kana font bank) -- not just a
 * plausible byte-count match.
 *
 * ROM routine: `$83:8000` (file offset 0x18000). 22 confirmed `JSL $838000`
 * call sites across the ROM; this is the general codec for SNES-side
 * graphics resources in this release (portraits and the UI icon bank are
 * *not* compressed -- see snes-ppu.ts -- but the opening-sequence screens,
 * the dialogue font's screen-load path, and the spell/combat animation bank
 * all route through this routine).
 *
 * Stream format:
 * - 2-byte LE header: `streamLength - 2` (i.e. `total = header + 2` is the
 *   exact byte count of the whole compressed stream, header included).
 * - Body: repeating groups of 1 control byte + up to 8 tokens, LSB-first:
 *   - control bit 0 -> literal: 1 raw byte, copied to output.
 *   - control bit 1 -> match: 2 bytes `b0, b1`.
 *     `offset = b0 | ((b1 & 0x07) << 8)` (11-bit window offset)
 *     `length = (b1 >> 3) + 3` (3-34 bytes)
 *     `base = max(0, outputLengthSoFar - 0x800)` (2 KB sliding window)
 *     copy `length` bytes from `output[base + offset ..]`, one byte at a
 *     time (self-referential/overlapping copies are valid and expected,
 *     same as standard LZSS).
 * - Decoding stops once `streamLength` input bytes have been consumed
 *   (there is no explicit end-of-stream token).
 */

export interface LzssResult {
  /** Decompressed bytes. */
  data: Uint8Array;
  /** Total compressed stream length in bytes, header included. */
  streamLength: number;
}

/** Decompress one Wizardry 6 SNES LZSS stream starting at `offset` in `rom`. */
export function decodeLzss(rom: Uint8Array, offset: number): LzssResult {
  const streamLength = (rom[offset] | (rom[offset + 1] << 8)) + 2;
  const end = offset + streamLength;
  let y = offset + 2;
  const out: number[] = [];

  while (y < end) {
    const ctrl = rom[y];
    y += 1;
    for (let bit = 0; bit < 8 && y < end; bit++) {
      if (((ctrl >> bit) & 1) === 0) {
        out.push(rom[y]);
        y += 1;
      } else {
        const b0 = rom[y];
        const b1 = rom[y + 1];
        y += 2;
        const winOffset = b0 | ((b1 & 0x07) << 8);
        const length = (b1 >> 3) + 3;
        const base = Math.max(0, out.length - 0x800);
        const srcPos = base + winOffset;
        for (let i = 0; i < length; i++) {
          out.push(out[srcPos + i]);
        }
      }
    }
  }

  return { data: Uint8Array.from(out), streamLength };
}
