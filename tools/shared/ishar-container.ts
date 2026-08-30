/**
 * Silmarils Ishar-engine resource file header — shared across Ishar 1
 * (`.DO`), Ishar 2 (`.DO`), Ishar 3 (`.DO`), and their prequel Crystals of
 * Arborea (`.CO`). See `docs/ishar/amigaaga/data-structure.md` §2 for the
 * full derivation and evidence.
 *
 * CONFIRMED structurally (byte-statistics across ~500 files corpus-wide;
 * see that doc for the disassembly cross-check against `T.X`/`START`):
 *
 * ```
 * offset 0:  u8  classByte   — 0x01 = stored/raw, 0x81 or 0xA1 = compressed
 *                              (two distinct compressed sub-formats; 0xA1
 *                              is Ishar-only, 0x81 appears in both Ishar's
 *                              MAIN.DO and every Crystals .CO file)
 * offset 1:  u8  sizeHigh    — high byte of a 24-bit decompressed size
 * offset 2:  u16 BE sizeLow  — low 16 bits of the same 24-bit size
 * offset 4:  10 bytes        — codec parameter table; CONSTANT within one
 *                              (title, classByte) pairing (Ishar's
 *                              compressed .DO files all share
 *                              `00 01 0B 09 0A 0B 07 05 06 07`; Crystals'
 *                              0x81 .CO files instead share a 10-byte
 *                              window containing one per-file varying byte
 *                              at relative offset 4 — see the doc)
 * offset 14: u8  marker      — 0xF0 for every sampled Ishar file; varies
 *                              in Crystals
 * offset 15: u8  method      — small (0-7) per-file selector, meaning open
 * ```
 *
 * `decompressedSize = (sizeHigh << 16) | sizeLow` reproduces a plausible,
 * always->1.0 compression ratio against the real on-disk (compressed) size
 * across the whole corpus (both Ishar and Crystals) — see the doc's ratio
 * table. For `classByte === 0x01` (stored) files, `decompressedSize` is
 * observed to equal the real file size exactly (ratio 1.000), confirming
 * "stored" == "no compression, the header's size field is just the file's
 * own length".
 *
 * The actual compression algorithm for the 0x81/0xA1 classes is NOT yet
 * implemented here — see the doc's "Compression" section for status.
 */

export interface IsharHeader {
  /** Format class: 0x01 = stored/raw, 0x81/0xA1 = compressed (two variants). */
  classByte: number;
  /** High byte of the 24-bit decompressed-size field. */
  sizeHigh: number;
  /** Low 16 bits (big-endian) of the decompressed-size field. */
  sizeLow: number;
  /** `(sizeHigh << 16) | sizeLow` — the file's claimed decompressed size. */
  decompressedSize: number;
  /** The 10 bytes at offset 4-13 — codec parameter table, meaning open. */
  table: Buffer;
  /** Byte at offset 14 — constant 0xF0 in every sampled Ishar file. */
  marker: number;
  /** Byte at offset 15 — a small (0-7) per-file selector, meaning open. */
  method: number;
  /** `classByte === 0x01` — no compression, `decompressedSize` == file size. */
  stored: boolean;
}

export const HEADER_SIZE = 16;

export function parseIsharHeader(buf: Buffer): IsharHeader {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`buffer too short for Ishar container header: ${buf.length} bytes`);
  }
  const classByte = buf[0];
  const sizeHigh = buf[1];
  const sizeLow = buf.readUInt16BE(2);
  return {
    classByte,
    sizeHigh,
    sizeLow,
    decompressedSize: (sizeHigh << 16) | sizeLow,
    table: buf.subarray(4, 14),
    marker: buf[14],
    method: buf[15],
    stored: classByte === 0x01,
  };
}

/** Compression ratio (decompressedSize / on-disk fileSize) — should be >= ~1.0. */
export function compressionRatio(header: IsharHeader, fileSize: number): number {
  return header.decompressedSize / fileSize;
}
