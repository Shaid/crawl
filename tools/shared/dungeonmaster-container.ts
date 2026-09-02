/**
 * Dungeon Master / Chaos Strikes Back / Dungeon Master II shared "data
 * file" container reader (`GRAPHICS.DAT`, `ANIM.DAT`, `HCSB.DAT`, and
 * friends across all three games).
 *
 * Format confirmed against the Dungeon Master Encyclopaedia's community
 * documentation ("Data Files", http://dmweb.free.fr/community/documentation/
 * file-formats/data-files/, fetched 2026-09-02) and byte-exact-verified
 * against this repo's actual corpus files (see
 * `docs/dungeonmaster-format.md` for the verification evidence — item
 * counts, header sizes, and cumulative payload sizes all match real
 * `.DAT` files with 0 residue).
 *
 * Three header shapes, auto-detected from the first big-endian word:
 *
 * - **DMCSB1** (no signature word — Amiga DM v2.0/2.1/2.2, no `8001`
 *   magic): `u16 itemCount`, then `itemCount` u16 compressed sizes, then
 *   `itemCount` u16 decompressed sizes.
 * - **DMCSB2** (`0x8001` signature — Amiga DM v3.6, CSB v3.x): same as
 *   DMCSB1 plus 2 extra u16 "attribute" words per item.
 * - **DMII** (`0x8005` signature, `0x8004` on DM2 FM-Towns — Amiga DM2):
 *   `u16 itemCount`, `u32` size of item 0, then `itemCount-1` u16 sizes.
 *
 * None of this repo's Amiga corpus files carry the optional secondary LZW
 * wrapper the community docs describe for some Atari ST files ("Contains
 * LZW compressed items" is "-" for every Amiga row in the docs' endian/
 * format table) — confirmed here too: `compressedSize === decompressedSize`
 * for every DMCSB1/DMCSB2 item in the real files (see the extractor's
 * self-check). Each item's own bytes may still be internally RLE-encoded
 * (that's the `IMGx` pixel codec in `dungeonmaster-codec.ts`, a separate
 * layer) — "compressed/decompressed" in this container's header is purely
 * about the (unused, on this platform) outer LZW wrapper.
 */
import { r16, r32 } from '@seer-project/core';

export type DataFileFormat = 'DMCSB1' | 'DMCSB2' | 'DMII';

export interface DataFileItem {
  index: number;
  offset: number;
  size: number;
  /** DMCSB1/DMCSB2 only — equal to `size` on every Amiga file seen so far. */
  compressedSize?: number;
  /** DMCSB2 only — 2 raw attribute words, meaning is item-type-specific. */
  attributes?: [number, number];
}

export interface DataFile {
  format: DataFileFormat;
  itemCount: number;
  items: DataFileItem[];
  /** Byte offset where the header ends and item payloads begin. */
  dataStart: number;
}

/**
 * Parse a Dungeon Master family data-file header. `endian` defaults to
 * `'be'` (every Amiga file in this corpus); DOS/FM-Towns/PC-98 releases
 * use `'le'` (not needed by this repo's Amiga-only corpus, but the reader
 * takes the parameter for completeness/future ports).
 */
export function parseDataFileHeader(data: Uint8Array, endian: 'be' | 'le' = 'be'): DataFile {
  const word0 = r16(data, 0, endian);

  if (word0 === 0x8001 || word0 === 0x8005 || word0 === 0x8004) {
    const format: DataFileFormat = word0 === 0x8001 ? 'DMCSB2' : 'DMII';
    const itemCount = r16(data, 2, endian);
    if (format === 'DMII') {
      const items: DataFileItem[] = [];
      let offset = 4 + 4 + (itemCount - 1) * 2; // sig(2)+count(2)+dword+word*(N-1)
      const size0 = r32(data, 4, endian);
      items.push({ index: 0, offset, size: size0 });
      offset += size0;
      for (let i = 1; i < itemCount; i++) {
        const size = r16(data, 4 + 4 + (i - 1) * 2, endian);
        items.push({ index: i, offset, size });
        offset += size;
      }
      return { format, itemCount, items, dataStart: 4 + 4 + (itemCount - 1) * 2 };
    }
    // DMCSB2
    const headerBase = 4;
    const compAt = (i: number) => r16(data, headerBase + i * 2, endian);
    const decAt = (i: number) => r16(data, headerBase + itemCount * 2 + i * 2, endian);
    const attrBase = headerBase + itemCount * 4;
    const dataStart = attrBase + itemCount * 4;
    const items: DataFileItem[] = [];
    let offset = dataStart;
    for (let i = 0; i < itemCount; i++) {
      const size = decAt(i);
      items.push({
        index: i,
        offset,
        size,
        compressedSize: compAt(i),
        attributes: [r16(data, attrBase + i * 4, endian), r16(data, attrBase + i * 4 + 2, endian)],
      });
      offset += size;
    }
    return { format, itemCount, items, dataStart };
  }

  // DMCSB1: no signature, starts directly with item count.
  const itemCount = word0;
  const headerBase = 2;
  const compAt = (i: number) => r16(data, headerBase + i * 2, endian);
  const decAt = (i: number) => r16(data, headerBase + itemCount * 2 + i * 2, endian);
  const dataStart = headerBase + itemCount * 4;
  const items: DataFileItem[] = [];
  let offset = dataStart;
  for (let i = 0; i < itemCount; i++) {
    const size = decAt(i);
    items.push({ index: i, offset, size, compressedSize: compAt(i) });
    offset += size;
  }
  return { format: 'DMCSB1', itemCount, items, dataStart };
}

/** Slice out one item's raw payload bytes. */
export function readItem(data: Uint8Array, item: DataFileItem): Uint8Array {
  return data.subarray(item.offset, item.offset + item.size);
}
