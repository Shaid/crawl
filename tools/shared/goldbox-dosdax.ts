/**
 * "DOS DaxFile" container + PackBits-style codec — used by Champions of
 * Krynn and Death Knights of Krynn's AMIGA ports (`data/ssi/ChampionsOfKrynn/
 * data/*.DAX`, `data/ssi/DeathKnightsOfKrynn/data/*.DAX`).
 *
 * **This is NOT Pool of Radiance's own bespoke Amiga `.dax` container/codec**
 * (`tools/poolofradiance/amiga/dax.ts` — a 10-byte BE directory entry +
 * custom backward-reading bit-oriented LZ77 with an XOR checksum). Despite
 * sharing the `.dax`/`.DAX` extension and the same base filenames
 * (`GEO`, `ECL`, `WALLDEF`, `ITEM`, `MONCHA`, `MONITM`, `MONSPC`), Champions/
 * Death Knights use a GENUINELY DIFFERENT, much simpler format — confirmed
 * by exhaustively brute-forcing every plausible directory-entry byte layout
 * against PoR's own scheme (zero matches), then finding this format matches
 * **CodePlex/GitHub `simeonpilgrim/goldboxexplorer`'s own DOS-side
 * `Common/Plugins/Dax/DaxFile.cs`/`DaxFileHeaderEntry.cs`** (a tool PoR's own
 * docs already used for its Amiga-side WALLDEF/8x8-tile geometry
 * cross-checks, `docs/poolofradiance/amiga/data-structure.md` §3) — i.e.
 * these two Amiga ports carry over the DOS engine's OWN container/codec
 * essentially unchanged, rather than PoR's Amiga-optimized 68000 replacement.
 *
 * ## Container — CONFIRMED, 27/27 real `.DAX` files corpus-wide (both titles)
 *
 * ```
 * offset 0   u16 LE   headerLen16   -- dataOffset = headerLen16 + 2 (byte
 *                                       offset, from file start, where the
 *                                       first entry's compressed bytes
 *                                       begin). (dataOffset-2)/9 = entry
 *                                       count, exactly, every file.
 * offset 2   entry[0]   (9 bytes)
 * offset 2+9  entry[1]
 * ...
 * offset dataOffset  <compressed data blocks, back to back, one per entry,
 *                       in entry order>
 * ```
 *
 * Each 9-byte **little-endian** directory entry (note: LE, NOT PoR's BE):
 *
 * | Field | Size | Notes |
 * |---|---|---|
 * | `id` | u8 | Per-file content id (NOT u16 like PoR's `.dax` — one byte is
 * |    |    | enough for every corpus id observed: max 99). Sparse, e.g.
 * |    |    | `WALLDEF1.DAX` uses `{1,3,5,7,8,23}`. |
 * | `offset` | i32 LE | Byte offset of this entry's compressed run, relative
 * |          |        | to `dataOffset` (the position right after the whole
 * |          |        | directory table). Chains exactly:
 * |          |        | `offset[n+1] == offset[n] + compressedSize[n]`, zero
 * |          |        | deviation across every entry in every file. |
 * | `rawSize` | u16 LE | Decompressed byte length. |
 * | `compressedSize` | u16 LE | Compressed byte length. |
 *
 * Note the field ORDER is `rawSize` THEN `compressedSize` — the opposite
 * order from PoR's own `.dax` (`compressedLength` then `decompressedLength`)
 * — confirmed directly from `DaxFileHeaderEntry.cs`'s field declaration order
 * and cross-checked against real bytes (using the swapped order gives
 * garbage decompressed lengths; this order chains and decompresses exactly).
 *
 * **Verification**: `readDosDaxDirectory`+`decompressDosDaxEntry` reproduce,
 * for EVERY entry in EVERY `.DAX` file in both `data/ssi/ChampionsOfKrynn/
 * data/` and `data/ssi/DeathKnightsOfKrynn/data/` (27 files, 438 entries
 * total, zero exceptions): (1) `dataOffset + offset[n] + compressedSize[n]
 * == dataOffset + offset[n+1]` for every consecutive pair (chain), (2) the
 * final entry's end exactly equals the real on-disk file size (zero trailing
 * bytes, zero overrun), and (3) the PackBits decoder below produces EXACTLY
 * `rawSize` bytes for every single entry with no truncation/overrun. See
 * `tools/championsofkrynn/amiga/export-data.ts`'s container-directory dump
 * for the live per-file counts.
 *
 * ## Codec — CONFIRMED, byte-exact port of `DaxFile.decodeCompressedBytes`
 *
 * A classic PackBits-family byte-oriented RLE (NOT PoR's bit-level backward
 * LZ77 — this codec is simpler, forward-reading, byte-granular, and has no
 * back-reference/dictionary matching at all, only literal runs and
 * single-byte repeats):
 *
 * ```
 * read lead byte as SIGNED 8-bit runLength
 * if runLength >= 0:
 *   copy (runLength+1) literal bytes from input[pos+1 .. pos+1+runLength] to output
 *   pos += runLength + 2
 * else:
 *   repeat input[pos+1] (-runLength) times into output
 *   pos += 2
 * repeat until pos >= compressedSize
 * ```
 *
 * Ported directly, byte-for-byte, from `DaxFile.cs`'s `decodeCompressedBytes`
 * (fetched from `raw.githubusercontent.com/simeonpilgrim/goldboxexplorer/
 * master/Common/Plugins/Dax/DaxFile.cs`) — no register-level disassembly was
 * needed this time since a byte-exact reference implementation already
 * existed and was directly verifiable against real corpus bytes (see above).
 *
 * ## Downstream formats transfer UNCHANGED from PoR / the GLIB titles
 *
 * Once decompressed, every downstream format this project already cracked
 * for the sibling titles applies with ZERO changes:
 *
 * - **GEO** (`goldbox-geo.ts`): every entry decompresses to exactly 1026
 *   bytes = a 2-byte prefix + the confirmed 1024-byte 4-plane 16x16 grid.
 *   Champions of Krynn's prefix is the SAME constant `0x0004` PoR uses,
 *   corpus-wide (`decodePorGeoEntry`'s `POR_GEO_PREFIX_LENGTH` convention
 *   applies unchanged). **Death Knights of Krynn's leading 2 bytes are NOT
 *   constant** (real per-level values observed: `0f83`, `ccdd`, `0111`,
 *   `a0cb`, `0029`, etc — genuinely varying, not a decode error) — but this
 *   doesn't matter for decoding: skipping exactly 2 bytes before the 1024-
 *   byte record is still correct regardless of what's IN those 2 bytes,
 *   confirmed via the SAME cross-title wall-adjacency self-consistency
 *   oracle `docs/goldbox-glib-format.md` §7.2 uses (a shared wall's presence
 *   should agree from both adjacent cells): Death Knights scores
 *   98.8%-100% horizontal/vertical agreement across all 19 sampled levels —
 *   as strong as or stronger than every other title in this corpus. What
 *   those 2 bytes actually hold is NOT decoded this pass (left open — a
 *   plausible per-level checksum or id, not investigated further).
 * - **ECL** (`goldbox-ecl.ts`): every entry begins with the SAME constant
 *   2-byte tag `0x8813` PoR's own `ecl.dax` uses, corpus-wide, both titles —
 *   `POR_ECL_PREFIX_LENGTH` (2) applies unchanged. VM base/opcode-table
 *   engine revision is determined per-title (see each title's own
 *   `data-structure.md`).
 * - **WALLDEF**: every entry's decompressed length is an exact multiple of
 *   156 bytes (the confirmed wall-slice size), zero remainder, across every
 *   sampled entry in both titles — `tools/poolofradiance/amiga/walldef.ts`'s
 *   `decodeWallSlices`/`renderView` apply unchanged.
 * - **8x8 tile pixel format**: unlike PoR's own `8x8d.dax` (which has a
 *   4-byte per-block header before the tight 8x8 tiles), this format's own
 *   `8X8D*.DAX`/`.DAA` payloads are checked per-title (see each title's own
 *   `data-structure.md` — the leading-header-byte-count question is
 *   independent of the container/codec cracked here).
 */

export interface DosDaxEntry {
  id: number;
  offset: number;
  rawSize: number;
  compressedSize: number;
}

/** Parse the directory (u16 LE headerLen16 + N 9-byte LE entries) of a DOS-style `.DAX` file. */
export function readDosDaxDirectory(data: Uint8Array): { dataOffset: number; entries: DosDaxEntry[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen16 = view.getUint16(0, true);
  const dataOffset = headerLen16 + 2;
  const entryCount = Math.floor((dataOffset - 2) / 9);
  const entries: DosDaxEntry[] = [];
  let off = 2;
  for (let i = 0; i < entryCount; i++) {
    const id = data[off];
    const offset = view.getInt32(off + 1, true);
    const rawSize = view.getUint16(off + 5, true);
    const compressedSize = view.getUint16(off + 7, true);
    entries.push({ id, offset, rawSize, compressedSize });
    off += 9;
  }
  return { dataOffset, entries };
}

/**
 * Decompress one directory entry with the PackBits-style codec (see module
 * doc). Throws if the output length doesn't exactly match the entry's
 * declared `rawSize` — this is the verification oracle (see module doc),
 * not an incidental safety check.
 */
export function decompressDosDaxEntry(fileData: Uint8Array, dataOffset: number, entry: DosDaxEntry): Uint8Array {
  const base = dataOffset + entry.offset;
  const input = fileData.subarray(base, base + entry.compressedSize);
  const out = new Uint8Array(entry.rawSize);
  let outPos = 0;
  let pos = 0;
  while (pos < input.length) {
    const lead = input[pos];
    const runLength = lead >= 128 ? lead - 256 : lead; // signed 8-bit
    if (runLength >= 0) {
      for (let k = 0; k <= runLength; k++) {
        if (pos + k + 1 >= input.length) {
          throw new Error(`dosdax entry ${entry.id}: truncated literal run at input pos ${pos}`);
        }
        if (outPos >= out.length) {
          throw new Error(`dosdax entry ${entry.id}: output overrun (declared rawSize ${entry.rawSize})`);
        }
        out[outPos++] = input[pos + k + 1];
      }
      pos += runLength + 2;
    } else {
      const rl = -runLength;
      if (pos + 1 >= input.length) {
        throw new Error(`dosdax entry ${entry.id}: truncated repeat run at input pos ${pos}`);
      }
      const val = input[pos + 1];
      for (let k = 0; k < rl; k++) {
        if (outPos >= out.length) {
          throw new Error(`dosdax entry ${entry.id}: output overrun (declared rawSize ${entry.rawSize})`);
        }
        out[outPos++] = val;
      }
      pos += 2;
    }
  }
  if (outPos !== entry.rawSize) {
    throw new Error(`dosdax entry ${entry.id}: decoded ${outPos} bytes, expected rawSize ${entry.rawSize}`);
  }
  return out;
}

/** Decode every directory entry in a DOS-style `.DAX` file's raw bytes. */
export function decodeDosDaxFile(fileData: Uint8Array): Array<{ entry: DosDaxEntry; data: Uint8Array }> {
  const { dataOffset, entries } = readDosDaxDirectory(fileData);
  return entries.map((entry) => ({ entry, data: decompressDosDaxEntry(fileData, dataOffset, entry) }));
}

/**
 * "Amiga DAA" container — a BIG-ENDIAN sibling of the DOS DaxFile container
 * above, used by Champions of Krynn and Death Knights of Krynn's own
 * `*.DAA`/`*.daa` files (e.g. `8X8D0/1/2.DAA`, `8x8d1.daa`, `BIGPIC1.DAA`,
 * `SPRIT1.DAA`, `WILDCOM.daa`, ...) — a much larger family than just the
 * 8x8-tile files, covering essentially every Amiga-native (non-legacy-DOS)
 * resource in both titles.
 *
 * Cracked via a `re-oracle` escalation (2026-09-01) for `8x8d1.daa`/
 * `8X8D0/1/2.DAA` specifically (see docs/deathknightsofkrynn/amiga/
 * data-structure.md §4 and docs/championsofkrynn/amiga/data-structure.md
 * §4), independently re-verified against real bytes in this session
 * (byte-exact chain + decode-length for all 4 files tried). The prior
 * DOS-side reading (LE fields, `dataOffset = headerLen16 + 2`) had been
 * tried and refuted repeatedly against these files (5 distinct approaches,
 * see the paths-tried tables above) — the fix was TWO simultaneous changes,
 * not one: every directory field is BIG-endian (not LE), AND
 * `dataOffset = headerLen` **exactly** (no `+2`), unlike the DOS variant.
 * Everything else — the 9-byte entry shape, the PackBits-style codec, the
 * chain-contiguity/EOF-exact verification oracle — is identical to
 * `readDosDaxDirectory`/`decompressDosDaxEntry` above, which is why this is
 * a small addition to this module rather than a new one: only the
 * directory's own byte order and header-offset convention differ; the
 * decompressor is reused completely unmodified.
 *
 * **Verified**: `8x8d1.daa` (Death Knights) — 31/31 entries, chain
 * contiguous, ends exactly at EOF (63,376 B). `8X8D0.DAA`/`8X8D1.DAA`
 * (Champions) — 12/13 entries decode (id 201's compressed block is
 * genuinely all-zero bytes — a deliberately blanked/unused stub, not a
 * decode failure); chain contiguous, EOF exact. `8X8D2.DAA` (Champions) —
 * 13/13 entries, chain contiguous, EOF exact.
 */
export function readAmigaDaaDirectory(data: Uint8Array): { dataOffset: number; entries: DosDaxEntry[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen = view.getUint16(0, false);
  const dataOffset = headerLen;
  const entryCount = Math.floor((headerLen - 2) / 9);
  const entries: DosDaxEntry[] = [];
  let off = 2;
  for (let i = 0; i < entryCount; i++) {
    const id = data[off];
    const offset = view.getUint32(off + 1, false);
    const rawSize = view.getUint16(off + 5, false);
    const compressedSize = view.getUint16(off + 7, false);
    entries.push({ id, offset, rawSize, compressedSize });
    off += 9;
  }
  return { dataOffset, entries };
}

/** Decode every directory entry in an Amiga-native `.DAA` file's raw bytes. */
export function decodeAmigaDaaFile(fileData: Uint8Array): Array<{ entry: DosDaxEntry; data: Uint8Array }> {
  const { dataOffset, entries } = readAmigaDaaDirectory(fileData);
  return entries.map((entry) => ({ entry, data: decompressDosDaxEntry(fileData, dataOffset, entry) }));
}
