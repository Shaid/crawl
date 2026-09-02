/**
 * Dungeon Master / Chaos Strikes Back / Dungeon Master II shared codecs:
 *
 * - `decodeImg1`: the `IMGx` family nibble-based RLE pixel codec used for
 *   every wall/floor/door/creature/UI bitmap in `GRAPHICS.DAT` on this
 *   corpus's Amiga releases (big-endian header => "IMG1" in the community
 *   docs' naming; `IMG2` is the identical codec with a little-endian
 *   header, used on DOS/PC-98/FM-Towns — not needed by this Amiga-only
 *   pass but the decoder itself is endian-agnostic past the header).
 * - `decompressDungeon`: the fixed 3/6/10-bit Huffman-style scheme used to
 *   compress `DUNGEON.DAT`/`DUNGEONF.DAT`/`DUNGEONG.DAT` (signature
 *   `0x8104`).
 *
 * Both ported from the Dungeon Master Encyclopaedia's published algorithm
 * descriptions ("Dungeon Files", http://dmweb.free.fr/community/
 * documentation/file-formats/dungeon-files/, and "Data Files",
 * .../data-files/ — fetched 2026-09-02) and verified against real corpus
 * bytes (see `docs/dungeonmaster-format.md`): `decompressDungeon` produces
 * exactly the declared uncompressed byte count with 0 deviation on every
 * dungeon file in the corpus, and `decodeImg1` decodes every `GRAPHICS.DAT`
 * item to exactly `width*height` pixels with 0 residue/overrun on the full
 * corpus (see the extractor's self-check).
 */
import { r16 } from '@seer-project/core';

export interface DecodedImage {
  width: number;
  height: number;
  /** One entry per pixel: a 4-bit palette index (0-15), or -1 for transparent. */
  pixels: Int16Array;
}

/** Reads 4-bit nibbles MSB-first out of a byte stream (high nibble of each byte first). */
class NibbleReader {
  private pos = 0; // nibble position
  private data: Uint8Array;
  private byteOffset: number;
  constructor(data: Uint8Array, byteOffset: number) {
    this.data = data;
    this.byteOffset = byteOffset;
  }

  nibble(): number {
    const byteIdx = this.byteOffset + (this.pos >> 1);
    const b = this.data[byteIdx] ?? 0;
    const n = this.pos & 1 ? b & 0xf : (b >> 4) & 0xf;
    this.pos++;
    return n;
  }
  byte(): number {
    return (this.nibble() << 4) | this.nibble();
  }
  word(): number {
    return (this.byte() << 8) | this.byte();
  }
}

/**
 * Decode one `IMG1`/`IMG2` item's pixel payload. `data`/`payloadOffset`
 * point at the RLE stream immediately following the 4-byte width/height
 * header (the header itself is read by the caller, since IMG1 is
 * big-endian and IMG2 little-endian but the RLE stream is identical).
 */
export function decodeImg1Stream(data: Uint8Array, payloadOffset: number, width: number, height: number): Int16Array {
  const total = width * height;
  const out = new Int16Array(total).fill(-1);
  let pos = 0;
  const nr = new NibbleReader(data, payloadOffset);

  const putSolid = (count: number, color: number) => {
    for (let i = 0; i < count && pos < total; i++) out[pos++] = color;
  };
  const putCopyPrevLine = (count: number) => {
    for (let i = 0; i < count && pos < total; i++) {
      const src = pos - width;
      out[pos++] = src >= 0 ? out[src] : -1;
    }
  };
  const putTransparent = (count: number) => {
    pos = Math.min(total, pos + count);
  };

  while (pos < total) {
    const n1 = nr.nibble();
    const n2 = nr.nibble();
    if (n1 <= 7) {
      putSolid(n1 + 1, n2);
    } else if (n1 === 0x8) {
      putSolid(nr.byte() + 1, n2);
    } else if (n1 === 0xc) {
      putSolid(nr.word() + 1, n2);
    } else if (n1 === 0xb) {
      const b = nr.byte();
      putCopyPrevLine(b + 1);
      putSolid(1, n2);
    } else if (n1 === 0xf) {
      const w = nr.word();
      putCopyPrevLine(w + 1);
      putSolid(1, n2);
    } else if (n1 === 0x9) {
      const b = nr.byte();
      if (b % 2 === 0) {
        putSolid(1, n2);
        for (let i = 0; i < b && pos < total; i++) out[pos++] = nr.nibble();
      } else {
        for (let i = 0; i <= b && pos < total; i++) out[pos++] = nr.nibble();
      }
    } else if (n1 === 0xd) {
      const w = nr.word();
      if (w % 2 === 0) {
        putSolid(1, n2);
        for (let i = 0; i < w && pos < total; i++) out[pos++] = nr.nibble();
      } else {
        for (let i = 0; i <= w && pos < total; i++) out[pos++] = nr.nibble();
      }
    } else if (n1 === 0xa) {
      putTransparent(n2 + 1);
    } else if (n1 === 0xe) {
      if (n2 <= 0xc) {
        putTransparent(n2 + 17);
      } else if (n2 === 0xd) {
        putTransparent(nr.byte() + 1);
      } else if (n2 === 0xe) {
        putTransparent(nr.byte() + 257);
      } else {
        putTransparent(nr.word() + 1);
      }
    } else {
      // Should not happen — all 16 values of n1 are handled above.
      break;
    }
  }
  return out;
}

/** Decode a full `IMG1` item (big-endian width/height header + RLE payload). */
export function decodeImg1(item: Uint8Array): DecodedImage {
  const width = r16(item, 0, 'be');
  const height = r16(item, 2, 'be');
  const pixels = decodeImg1Stream(item, 4, width, height);
  return { width, height, pixels };
}

// --- IMG3/IMG4 (local-6-colour-palette RLE, used by Dungeon Master II's
// "full"/base images — confirmed for the Amiga release: see
// docs/dungeonmaster2/amiga/data-structure.md, sourced from a fan analysis
// of DM2 Amiga's GRAPHICS.DAT, "Dungeon Master II Data Files Notes" on
// dmweb.free.fr) ---------------------------------------------------------

/**
 * Decode an `IMG3`/`IMG4` item's pixel payload. `data`/`payloadOffset`
 * point at the RLE stream immediately following the 4-byte width/height +
 * 3-byte (6-nibble) local-palette header. `localPalette` is that 6-entry
 * palette (raw absolute colour indices 0-15, in most-used-first order).
 *
 * Only the "full"/base-image case is implemented — DM2's "differential"
 * overlay variant (`IMG7`/`IMG8`, 5-nibble palette, composited over a
 * separately-stored base image) is not decoded here; see the doc's open
 * items.
 */
export function decodeImg3Stream(
  data: Uint8Array,
  payloadOffset: number,
  width: number,
  height: number,
  localPalette: number[],
): Int16Array {
  const total = width * height;
  const out = new Int16Array(total).fill(-1);
  let pos = 0;
  const nr = new NibbleReader(data, payloadOffset);

  const readCount = (): number => {
    const n1 = nr.nibble();
    if (n1 < 0xf) return n1 + 2;
    const n2 = nr.nibble();
    const n3 = nr.nibble();
    const v = n2 * 16 + n3;
    if (v < 0xff) return v + 17;
    const n4 = nr.nibble();
    const n5 = nr.nibble();
    const n6 = nr.nibble();
    const n7 = nr.nibble();
    return n4 * 4096 + n5 * 256 + n6 * 16 + n7;
  };

  while (pos < total) {
    const control = nr.nibble();
    const multi = (control & 0x8) !== 0;
    const colorSel = control & 0x7;
    let color = -2; // -2 sentinel = "copy from previous line"
    if (colorSel <= 5) color = localPalette[colorSel];
    else if (colorSel === 7) color = nr.nibble();
    // colorSel === 6: copy-from-previous-line, color stays -2

    const count = multi ? readCount() : 1;
    for (let i = 0; i < count && pos < total; i++) {
      if (color === -2) {
        const src = pos - width;
        out[pos++] = src >= 0 ? out[src] : -1;
      } else {
        out[pos++] = color;
      }
    }
  }
  return out;
}

/** Decode a full `IMG4` item (big-endian header, 6-nibble local palette). */
export function decodeImg4(item: Uint8Array): DecodedImage {
  const width = r16(item, 0, 'be');
  const height = r16(item, 2, 'be');
  const paletteBytes = item.subarray(4, 7);
  const localPalette = [
    (paletteBytes[0] >> 4) & 0xf,
    paletteBytes[0] & 0xf,
    (paletteBytes[1] >> 4) & 0xf,
    paletteBytes[1] & 0xf,
    (paletteBytes[2] >> 4) & 0xf,
    paletteBytes[2] & 0xf,
  ];
  const pixels = decodeImg3Stream(item, 7, width, height, localPalette);
  return { width, height, pixels };
}

// --- Dungeon compression -------------------------------------------------

export const DUNGEON_COMPRESSED_SIGNATURE = 0x8104;

class BitReader {
  private bytePos = 0;
  private bitPos = 0; // 0 = MSB
  private data: Uint8Array;
  private offset: number;
  constructor(data: Uint8Array, offset: number) {
    this.data = data;
    this.offset = offset;
  }
  bit(): number {
    const b = this.data[this.offset + this.bytePos] ?? 0;
    const v = (b >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return v;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
}

export interface CompressedDungeonHeader {
  signature: number;
  uncompressedSize: number;
  dungeonId: number;
  mostCommon: number[]; // 4 byte values
  lessCommon: number[]; // 16 byte values
  /** Byte offset in the file where the compressed bitstream starts (always 28). */
  bitstreamOffset: number;
}

export function parseCompressedDungeonHeader(data: Uint8Array): CompressedDungeonHeader {
  const signature = r16(data, 0, 'be');
  const uncompressedSize = ((data[2] << 24) | (data[3] << 16) | (data[4] << 8) | data[5]) >>> 0;
  const dungeonId = r16(data, 6, 'be');
  const mostCommon = [data[8], data[9], data[10], data[11]];
  const lessCommon = Array.from(data.subarray(12, 28));
  return { signature, uncompressedSize, dungeonId, mostCommon, lessCommon, bitstreamOffset: 28 };
}

/**
 * Decompress a `0x8104`-signed dungeon file. Returns the decompressed
 * bytes (exactly `uncompressedSize` long) — the same byte layout as an
 * uncompressed `DUNGEON.DAT`.
 */
export function decompressDungeon(data: Uint8Array): Uint8Array {
  const hdr = parseCompressedDungeonHeader(data);
  const out = new Uint8Array(hdr.uncompressedSize);
  const br = new BitReader(data, hdr.bitstreamOffset);
  for (let i = 0; i < hdr.uncompressedSize; i++) {
    const firstBit = br.bit();
    if (firstBit === 0) {
      out[i] = hdr.mostCommon[br.bits(2)];
    } else {
      const secondBit = br.bit();
      out[i] = secondBit === 0 ? hdr.lessCommon[br.bits(4)] : br.bits(8);
    }
  }
  return out;
}

/** True if `data` starts with the compressed-dungeon signature word. */
export function isDungeonCompressed(data: Uint8Array): boolean {
  return r16(data, 0, 'be') === DUNGEON_COMPRESSED_SIGNATURE;
}

/** Decompress if needed, otherwise return the input unchanged. */
export function ensureDungeonDecompressed(data: Uint8Array): Uint8Array {
  return isDungeonCompressed(data) ? decompressDungeon(data) : data;
}
