/**
 * "GLIB" container — the SSI Gold Box engine's Amiga data-file format used by
 * Curse of the Azure Bonds (1989), Secret of the Silver Blades (1990), and
 * Pools of Darkness (1991) — the three sibling titles staged in this repo
 * alongside Pool of Radiance (1988, `.dax`/`tools/poolofradiance/amiga/dax.ts`).
 *
 * **Confirmed a genuinely different container AND codec from Pool of
 * Radiance's `.dax`** (see `docs/curseoftheazurebonds/amiga/data-structure.md`
 * §0 for the full byte-level comparison and rationale — PoR's own `.dax` used
 * a 2-byte header-size field, 10-byte BE directory entries with separate
 * compressed/decompressed length fields, and a custom backward-reading LZ77
 * codec with an embedded XOR checksum). GLIB uses NEITHER of those: no
 * compression at all (every payload is raw, uncompressed bytes — confirmed by
 * exact-multiple-of-N byte-length checks against known record strides, not
 * assumed), and a simpler cumulative-offset directory instead of per-entry
 * length fields.
 *
 * Container layout (all multi-byte fields big-endian, confirmed corpus-wide —
 * see the data-structure.md docs for the exact file-by-file verification
 * counts):
 *
 * ```
 * offset 0   magic        "GLIB" (4 bytes)
 * offset 4   u32 BE       totalSize   — equals the file's own real byte
 *                                       length for every healthy file in the
 *                                       corpus (see `isTruncated` below for
 *                                       the real-world exception).
 * offset 8   u16 BE       blockCount  — number of blocks in the offsets
 *                                       table that follows, INCLUDING the
 *                                       directory/index block itself
 *                                       (block 0).
 * offset 10  u16 BE       flags       — bit 0 set means block 0 is an
 *                                       (id, blockIndex) remap table (see
 *                                       `decodeGlibIndex`); the remaining
 *                                       bits vary across the corpus and are
 *                                       NOT confirmed to mean anything (an
 *                                       earlier hypothesis that a specific
 *                                       high-bit pattern signals a truncated/
 *                                       corrupted file was tested and
 *                                       REFUTED — see the data-structure.md
 *                                       "corruption" section).
 * offset 12  tag          4-byte ASCII content-type tag: "DATA" (raw
 *                                       records), "TILE" (8x8 tile bitmap
 *                                       data), "TEXT" (string pool), "DIG8"
 *                                       (raw 8-bit PCM), or "GLIB"/"HLIB"
 *                                       (nested — each block is itself
 *                                       another GLIB container, one level
 *                                       deep in every sample checked).
 * offset 16  u32 BE[blockCount+1]     cumulative ABSOLUTE file offsets.
 *                                       offsets[0] == 16 + 4*(blockCount+1)
 *                                       (the byte right after this table);
 *                                       offsets[blockCount] == totalSize.
 *                                       Block i spans
 *                                       [offsets[i], offsets[i+1]).
 * ```
 *
 * Block 0 (when `flags & 1`) is a small `u16 BE numEntries` followed by
 * `numEntries` × `(u16 BE id, u16 BE blockIndex)` pairs — `blockIndex` is a
 * 1-based index into the SAME `blocks` array this module returns (so
 * `blocks[blockIndex]` is the id's real data). `id` is sparse and is NOT
 * required to be sorted (confirmed: Secret of the Silver Blades' `WALLDEF.GLB`
 * index lists ids in file order `7,10,21,19,1,6,9,15,3,13`, not ascending).
 *
 * Verified corpus-wide: `offsets[0]` and `offsets[blockCount]` match their
 * predicted values with **zero deviation** across the vast majority of
 * `.GLB`/`.TLB` files across all sibling titles (see each title's
 * `data-structure.md` §1 for the exact per-file count).
 *
 * **Correction (2026-09-01):** a `totalSize` far exceeding the real on-disk
 * file size (`ALWAYS.TLB`, `COMSPR.TLB`, `TITLE.TLB`, `CBODY.TLB`,
 * `CHEAD.TLB`, `GEN.TLB` in specific disk images across the Curse/Secret/
 * Pools corpus, plus 6 similarly-named files in Dark Queen of Krynn) was
 * previously diagnosed here as real dump truncation/corruption (`isTruncated`
 * below). It was NOT: every one of these files is TOP-LEVEL compressed
 * (`glibCompressionMethod(data, 0) !== 0`, same byte-LZ77 method 5 nested
 * sub-containers already use), and `loadGlibFile` (`goldbox-glib-codecs.ts`)
 * decompresses them into a perfectly well-formed GLIB body with zero
 * deviation — see that function's doc for the full re-verification. Always
 * load a freshly-`readFileSync`'d top-level file through `loadGlibFile`
 * rather than `parseGlibContainer` directly; `isTruncated`/a raw
 * `totalSize !== data.length` check is only meaningful AFTER that
 * decompression step (a genuinely truncated/corrupted floppy dump still
 * fails it post-decompression, or `loadGlibFile` itself throws).
 */

export interface GlibBlock {
  start: number;
  end: number;
}

export interface GlibContainer {
  totalSize: number;
  blockCount: number;
  flags: number;
  tag: string;
  /** blocks[0] is the index/directory block when `hasIndex`; real data blocks follow. */
  blocks: GlibBlock[];
  hasIndex: boolean;
}

export interface GlibIndexEntry {
  id: number;
  blockIndex: number;
}

/** Parse a GLIB container's header + cumulative offset table. `baseOffset` lets this be called on a nested sub-container that starts partway through a larger buffer. */
export function parseGlibContainer(data: Uint8Array, baseOffset = 0): GlibContainer {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(
    data[baseOffset],
    data[baseOffset + 1],
    data[baseOffset + 2],
    data[baseOffset + 3],
  );
  if (magic !== 'GLIB') {
    throw new Error(`not a GLIB container at offset ${baseOffset} (magic "${magic}")`);
  }
  const totalSize = view.getUint32(baseOffset + 4, false);
  const blockCount = view.getUint16(baseOffset + 8, false);
  const flags = view.getUint16(baseOffset + 10, false);
  const tag = String.fromCharCode(
    data[baseOffset + 12],
    data[baseOffset + 13],
    data[baseOffset + 14],
    data[baseOffset + 15],
  );

  const blocks: GlibBlock[] = [];
  let off = baseOffset + 16;
  const offsets: number[] = [];
  for (let i = 0; i <= blockCount; i++) {
    offsets.push(view.getUint32(off, false));
    off += 4;
  }
  for (let i = 0; i < blockCount; i++) {
    blocks.push({ start: baseOffset + offsets[i], end: baseOffset + offsets[i + 1] });
  }

  return { totalSize, blockCount, flags, tag, blocks, hasIndex: (flags & 1) === 1 };
}

/**
 * True when the container's own declared `totalSize` disagrees with the
 * buffer it's backed by — the signature of a truncated/corrupted floppy
 * dump in this corpus (see module doc). `fileLength` should be the full
 * length of the top-level file (not a nested sub-container's own span).
 */
export function isTruncated(container: GlibContainer, fileLength: number): boolean {
  return container.totalSize !== fileLength;
}

/** Decode block 0 of a container as an (id, blockIndex) remap table. Throws if `!container.hasIndex`. */
export function decodeGlibIndex(data: Uint8Array, container: GlibContainer): GlibIndexEntry[] {
  if (!container.hasIndex) {
    throw new Error('container has no index block (flags bit 0 not set)');
  }
  const { start } = container.blocks[0];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numEntries = view.getUint16(start, false);
  const entries: GlibIndexEntry[] = [];
  let off = start + 2;
  for (let i = 0; i < numEntries; i++) {
    const id = view.getUint16(off, false);
    const blockIndex = view.getUint16(off + 2, false);
    entries.push({ id, blockIndex });
    off += 4;
  }
  return entries;
}

/** Look up a block by its GLIB index id (requires `decodeGlibIndex` to have succeeded). */
export function findBlockById(
  container: GlibContainer,
  index: GlibIndexEntry[],
  id: number,
): GlibBlock | undefined {
  const entry = index.find((e) => e.id === id);
  if (!entry) return undefined;
  return container.blocks[entry.blockIndex];
}

/** Slice out one block's raw bytes. */
export function readBlock(data: Uint8Array, block: GlibBlock): Uint8Array {
  return data.subarray(block.start, block.end);
}
