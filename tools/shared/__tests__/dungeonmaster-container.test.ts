import { describe, it, expect } from 'vitest';
import { parseDataFileHeader, readItem } from '../dungeonmaster-container.ts';

function w16be(v: number): [number, number] {
  return [(v >> 8) & 0xff, v & 0xff];
}
function w32be(v: number): [number, number, number, number] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

describe('parseDataFileHeader', () => {
  it('parses DMCSB1 (no signature word)', () => {
    // itemCount=2, compressed sizes [3,2] (unused by DMCSB1 items, must equal decompressed on Amiga),
    // decompressed sizes [3,2], then item payloads back-to-back.
    const bytes = [
      ...w16be(2), // itemCount
      ...w16be(3), ...w16be(2), // "compressed" sizes
      ...w16be(3), ...w16be(2), // decompressed sizes
      0xaa, 0xbb, 0xcc, // item 0 payload (3 bytes)
      0xdd, 0xee, // item 1 payload (2 bytes)
    ];
    const data = new Uint8Array(bytes);
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMCSB1');
    expect(df.itemCount).toBe(2);
    expect(df.items).toHaveLength(2);
    expect(df.items[0]).toMatchObject({ index: 0, size: 3, compressedSize: 3 });
    expect(df.items[1]).toMatchObject({ index: 1, size: 2, compressedSize: 2 });
    expect(readItem(data, df.items[0]!)).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    expect(readItem(data, df.items[1]!)).toEqual(new Uint8Array([0xdd, 0xee]));
  });

  it('parses DMCSB2 (0x8001 signature, with attribute words)', () => {
    const bytes = [
      ...w16be(0x8001), // signature
      ...w16be(1), // itemCount
      ...w16be(4), // compressed size[0]
      ...w16be(4), // decompressed size[0]
      ...w16be(0x1111), ...w16be(0x2222), // attributes[0]
      0x01, 0x02, 0x03, 0x04, // item 0 payload
    ];
    const data = new Uint8Array(bytes);
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMCSB2');
    expect(df.itemCount).toBe(1);
    expect(df.items[0]).toMatchObject({ index: 0, size: 4, compressedSize: 4, attributes: [0x1111, 0x2222] });
    expect(readItem(data, df.items[0]!)).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });

  it('parses DMII (0x8005 signature, u32 size for item 0, u16 for the rest)', () => {
    const bytes = [
      ...w16be(0x8005), // signature
      ...w16be(2), // itemCount
      ...w32be(5), // size of item 0 (u32)
      ...w16be(3), // size of item 1 (u16)
      0, 1, 2, 3, 4, // item 0 (5 bytes)
      9, 8, 7, // item 1 (3 bytes)
    ];
    const data = new Uint8Array(bytes);
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMII');
    expect(df.itemCount).toBe(2);
    expect(df.items[0]).toMatchObject({ index: 0, size: 5 });
    expect(df.items[1]).toMatchObject({ index: 1, size: 3 });
    expect(readItem(data, df.items[0]!)).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
    expect(readItem(data, df.items[1]!)).toEqual(new Uint8Array([9, 8, 7]));
  });
});
