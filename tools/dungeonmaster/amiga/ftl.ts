/**
 * FTL `.FTL` program modules (Dungeon Master / Chaos Strikes Back, Amiga):
 * container header, the nibble-dictionary code compression, and the
 * zero-run-packed initialised-data block. Written from the game's own loader:
 *
 *  - `BJELoad_R` (AmigaDOS hunk, CODE+0x34C, IRA listing): reads a 20-byte
 *    header (`0x6160` magic at +0, `0x0002` at +4, byte `0x01` at +6, byte `0`
 *    at +7, entry count at +18), then `count` 12-byte entries
 *    `{u16 tag, u16 1, u32 offset, u32 size}`; tags `0x10` / `0x11` / `0x12`
 *    are the module header, the data block and the code block. The `0x10`
 *    chunk starts with a 40-byte module header (7 longs + 6 words) followed
 *    by the export table (one long per entry; the loader turns each into a
 *    `JMP abs.l` thunk at `A5 + 0x22 + 8*k`, CODE+0x6C2).
 *  - Code block: copied raw, or (module-header word +30 set) decompressed by
 *    the library vector the loader calls at CODE+0x828 — implemented in
 *    `APPA.FTL`'s code at +0x22A: magic `0x5223`, u32 output word count at +4,
 *    a 0x780-word dictionary at +8, then a nibble stream at +0xF08 read as
 *    big-endian words. Nibble `v < 8`: one more nibble, output
 *    `dict[v*16+n]`; `8 <= v < 15`: two more nibbles, output
 *    `dict[v*256+nn-0x780]`; `v == 15`: four nibbles are a literal word.
 *    Verified by the module header's own byte-sum (word +36; the loader checks
 *    it at CODE+0x840): DM `KAOS.FTL` 0x4E23 = 0x4E23, CSB 0x413A = 0x413A.
 *  - Data block (CODE+0x75A): u32 stream length at +2, u32 relocation count at
 *    +6, then words from +10; every word is stored, and a zero word is
 *    followed by a count of extra zero bytes. The block is the module's
 *    initialised data, addressed by the game as negative offsets from `A5`
 *    (`A5` = end of the block = module-header long +4 bytes in).
 */
export interface FtlModule {
  /** 40-byte module header: longs [0..6], words [0..5]. */
  header: { longs: number[]; words: number[] };
  /** Export table: code offsets (`jsr 0x22+8k(a5)` reaches entry k). */
  exports: number[];
  /** Decompressed code block. */
  code: Uint8Array;
  /** Initialised data block; game address `-n(a5)` is `data[data.length - n]`. */
  data: Uint8Array;
  /** Byte-sum of the code (game check value = `header.words[4]`). */
  codeSum: number;
}

function u16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

/** The `0x5223` nibble-dictionary code decompressor (APPA.FTL code +0x22A). */
export function decompressFtlCode(src: Uint8Array): Uint8Array {
  if (u16(src, 0) !== 0x5223) throw new Error('FTL code block: missing 0x5223 magic');
  const words = u32(src, 4);
  const dictAt = 8;
  const streamAt = 0xf08;
  const out = new Uint8Array(words * 2);
  let pos = streamAt;
  let cur = 0;
  let left = 0;
  const nib = (): number => {
    if (left === 0) {
      if (pos + 1 >= src.length) throw new Error('FTL code block: nibble stream overrun');
      cur = u16(src, pos);
      pos += 2;
      left = 4;
    }
    left--;
    return (cur >> (left * 4)) & 0xf;
  };
  for (let i = 0; i < words; i++) {
    const v = nib();
    let w: number;
    if (v < 8) {
      const c = v * 16 + nib();
      w = u16(src, dictAt + 2 * c);
    } else if (v !== 15) {
      const c = v * 256 + nib() * 16 + nib() - 0x780;
      w = u16(src, dictAt + 2 * c);
    } else {
      w = (nib() << 12) | (nib() << 8) | (nib() << 4) | nib();
    }
    out[2 * i] = w >> 8;
    out[2 * i + 1] = w & 0xff;
  }
  return out;
}

export function parseFtl(file: Uint8Array): FtlModule {
  if (u16(file, 0) !== 0x6160 || u16(file, 4) !== 2 || file[6] !== 1 || file[7] !== 0) throw new Error('not an FTL module');
  const n = u16(file, 18);
  const chunks = new Map<number, { off: number; size: number }>();
  for (let i = 0; i < n; i++) {
    const e = 20 + 12 * i;
    chunks.set(u16(file, e), { off: u32(file, e + 4), size: u32(file, e + 8) });
  }
  const h = chunks.get(0x10);
  const dc = chunks.get(0x11);
  const cc = chunks.get(0x12);
  if (!h || !dc || !cc) throw new Error('FTL module: missing 0x10/0x11/0x12 chunk');
  const longs = Array.from({ length: 7 }, (_, i) => u32(file, h.off + 4 * i));
  const words = Array.from({ length: 6 }, (_, i) => u16(file, h.off + 28 + 2 * i));
  const exports: number[] = [];
  for (let o = h.off + 40; o + 4 <= h.off + h.size; o += 4) exports.push(u32(file, o));
  const rawCode = file.subarray(cc.off, cc.off + cc.size);
  const code = words[1] ? decompressFtlCode(rawCode) : Uint8Array.from(rawCode);
  let codeSum = 0;
  for (const b of code) codeSum = (codeSum + b) & 0xffff;
  // data block: module-header long[1] bytes, zero-run packed
  const data = new Uint8Array(longs[1]!);
  const d = file.subarray(dc.off, dc.off + dc.size);
  let left = u32(d, 2);
  let p = 10;
  let q = 0;
  while (left > 0) {
    const w = u16(d, p);
    p += 2;
    left -= 2;
    data[q] = w >> 8;
    data[q + 1] = w & 0xff;
    q += 2;
    if (w === 0) {
      const z = u16(d, p);
      p += 2;
      left -= 2;
      q += z; // zero bytes (already zero)
    }
  }
  return { header: { longs, words }, exports, code, data, codeSum };
}

/** Read a big-endian word at game address `-neg(a5)`. */
export function a5Word(m: FtlModule, neg: number): number {
  return u16(m.data, m.data.length - neg);
}
