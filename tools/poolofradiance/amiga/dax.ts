/**
 * Pool of Radiance (Amiga) `.dax` container + codec.
 *
 * Container ("directory") format — CONFIRMED, code-derived, verified
 * byte-exact across the whole corpus (843/843 entries, every game data file
 * in `data/poolofradiance/amiga/*.dax`):
 *
 *   offset 0            u16 BE  headerSize — byte length of the entry table
 *                                that follows (NOT including these 2 bytes).
 *                                `headerSize / 10` = entry count.
 *   offset 2            entry[0]  (10 bytes)
 *   offset 2+10         entry[1]
 *   ...
 *   offset 2+headerSize  <compressed data, back to back, one run per entry>
 *
 * Each 10-byte big-endian entry:
 *   u16  indexID              — the file's own "block id" for this record.
 *                                Sparse/non-sequential (e.g. walldef.dax has
 *                                0-9,17-21,23,24) — a real per-content id,
 *                                not a plain sequential index.
 *   u32  dataOffset           — byte offset of this entry's compressed data,
 *                                relative to `2 + headerSize` (i.e. right
 *                                after the whole header block). Chains
 *                                exactly: dataOffset[n+1] == dataOffset[n] +
 *                                compressedLength[n], zero deviation across
 *                                every entry in every file in the corpus.
 *   u16  compressedLength     — byte length of this entry's compressed run.
 *   u16  decompressedLength   — byte length after decompression.
 *
 * This layout, and the decompression algorithm below, were NOT derived from
 * scratch — they come directly from `pooldata.py`, a script attached to
 * http://amiga-dev.wikidot.com/project:pool-of-radiance (fetched from
 * `/local--files/project:pool-of-radiance/pooldata.py`). That page's prose
 * labels the compression "ByteKiller 2.0"; **that label does not survive
 * contact with the actual bytes.** Real ByteKiller (per the `ancient`
 * decompression library's `ByteKillerDecompressor`) needs a 12-byte header
 * (packedSize, rawSize, XOR checksum) at the start of the compressed stream
 * and a Huffman-coded token stream read *forward*. Checked exhaustively
 * against every entry in this corpus (843 candidates): 0/843 pass ByteKiller's
 * own header/checksum validation. `pooldata.py`'s own algorithm, on the other
 * hand — a hand/disassembly-derived, register-level (`DR[]`/`FLAGS[]`)
 * transliteration of the game's real 68000 routine, reading the compressed
 * stream as 32-bit words **backwards** from the end and emitting output
 * **reversed then un-reversed** — decompresses all 843 entries with a
 * passing internal XOR checksum AND an exact declared-length match. This
 * TypeScript below is a direct, uninterpreted port of that script (only
 * language-level fixes: BigInt-free 32-bit arithmetic, no Python2 `array`
 * quirks). Whatever the real compressor is called, this is confirmed correct
 * by that checksum, not assumed.
 */

export interface DaxEntry {
  indexID: number;
  dataOffset: number;
  compressedLength: number;
  decompressedLength: number;
}

/** Parse the directory (header word + N 10-byte entries) of a `.dax` file. */
export function readDaxDirectory(data: Uint8Array): { headerSize: number; entries: DaxEntry[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint16(0, false);
  const entries: DaxEntry[] = [];
  let off = 2;
  let read = 0;
  while (read < headerSize) {
    const indexID = view.getUint16(off, false);
    const dataOffset = view.getUint32(off + 2, false);
    const compressedLength = view.getUint16(off + 6, false);
    const decompressedLength = view.getUint16(off + 8, false);
    entries.push({ indexID, dataOffset, compressedLength, decompressedLength });
    off += 10;
    read += 10;
  }
  return { headerSize, entries };
}

/**
 * Decompress one directory entry's compressed run.
 * Throws if the entry's internal XOR checksum fails or the output length
 * doesn't match the declared `decompressedLength` — this IS the
 * verification oracle (see module doc), not an incidental safety check.
 */
export function decompressDaxEntry(fileData: Uint8Array, entry: DaxEntry): Uint8Array {
  const dirView = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  const headerSize = dirView.getUint16(0, false);
  const base = 2 + headerSize + entry.dataOffset;
  const raw = fileData.subarray(base, base + entry.compressedLength);

  const nLongs = Math.floor(raw.length / 4);
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  // cData holds the compressed stream as BE longwords, consumed by popping
  // from the end (the compressor writes/reads this stream backwards).
  const cData: number[] = [];
  for (let i = 0; i < nLongs; i++) cData.push(rv.getUint32(i * 4, false) >>> 0);

  let cPos = cData.length;
  const pop = (): number => cData[--cPos] >>> 0;

  const declaredDecompressedLength = pop();
  if (declaredDecompressedLength !== entry.decompressedLength) {
    throw new Error(
      `dax entry ${entry.indexID}: mismatched decompressed length (${declaredDecompressedLength} != ${entry.decompressedLength})`,
    );
  }

  const flags = { x: 0, c: 0 }; // 68000 X (extend) / C (carry) bits
  let D0 = 0;
  let D2 = 0;
  let D3 = 0;
  let D5 = pop();
  D0 = pop();
  D5 = (D5 ^ D0) >>> 0;

  const out: number[] = []; // built in reverse order, un-reversed at the end

  function lsr1(val: number): number {
    const c = val & 1;
    flags.x = c;
    flags.c = c;
    return val >>> 1;
  }

  function getNextLong(): void {
    D0 = pop();
    D5 = (D5 ^ D0) >>> 0;
    // ROXR.L #1: rotate right through extend
    const newX = D0 & 1;
    D0 = ((D0 >>> 1) | (flags.x << 31)) >>> 0;
    flags.x = newX;
    flags.c = newX;
  }

  function roxl1(val: number): number {
    const hibit = (val >>> 31) & 1;
    val = ((val << 1) >>> 0) | flags.x;
    flags.x = hibit;
    flags.c = hibit;
    return val >>> 0;
  }

  function copyNBitNumber(nbits: number): number {
    D2 = 0;
    for (let n = nbits; n > 0; n--) {
      D0 = lsr1(D0);
      if (D0 === 0) getNextLong();
      D2 = roxl1(D2);
    }
    return D2;
  }

  function unpackBytes(nbitsCount: number, extra: number): void {
    const countField = copyNBitNumber(nbitsCount);
    D3 = countField + extra;
    while (D3 >= 0) {
      let val = 0;
      for (let i = 0; i < 8; i++) {
        D0 = lsr1(D0);
        if (D0 === 0) getNextLong();
        val = roxl1(val);
      }
      out.push(val & 0xff);
      D3 -= 1;
    }
  }

  function copyBytes(nbitsDist: number, lenExtra: number): void {
    const dist = copyNBitNumber(nbitsDist);
    D3 = lenExtra;
    while (D3 >= 0) {
      out.push(out[out.length - dist]);
      D3 -= 1;
    }
  }

  function decompressChunk(): void {
    D0 = lsr1(D0);
    if (D0 === 0) getNextLong();

    if (flags.c) {
      const d2b = copyNBitNumber(2) & 0xff;
      if (d2b >= 2) {
        if (d2b === 3) {
          unpackBytes(8, 8);
          return;
        }
        // d2b === 2
        copyNBitNumber(8);
        D3 = D2;
        copyBytes(12, D3);
        return;
      }
      // d2b is 0 or 1
      const nbitsDist = d2b + 9;
      D2 = d2b + 2;
      D3 = D2;
      copyBytes(nbitsDist, D3);
      return;
    }

    D3 = 1;
    D0 = lsr1(D0);
    if (D0 === 0) getNextLong();

    if (flags.c) {
      copyBytes(8, D3);
    } else {
      unpackBytes(3, 0);
    }
  }

  while (out.length !== entry.decompressedLength) {
    decompressChunk();
  }

  if (D5 !== 0) {
    throw new Error(`dax entry ${entry.indexID}: bad decompression checksum 0x${D5.toString(16)}`);
  }

  out.reverse();
  return Uint8Array.from(out);
}

/** Decode every directory entry in a `.dax` file's raw bytes. */
export function decodeDaxFile(fileData: Uint8Array): Array<{ entry: DaxEntry; data: Uint8Array }> {
  const { entries } = readDaxDirectory(fileData);
  return entries.map((entry) => ({ entry, data: decompressDaxEntry(fileData, entry) }));
}
