import { describe, it, expect } from 'vitest';
import { parseDungeon, findDungeonDataOffsets, dungeonChecksum } from '../dungeonmaster-dungeon.ts';

/**
 * Build a minimal synthetic uncompressed dungeon buffer: 44-byte header,
 * one 4x4-square map definition (16 bytes), then the 16-byte square grid,
 * then a 2-byte trailing checksum (real save-embedded dungeons always
 * carry one — see `docs/dungeonmaster-format.md`). All list-section counts
 * are 0, so there's nothing between the map definition and the square grid.
 */
function buildSyntheticDungeon(): { buf: Uint8Array; squaresOffset: number } {
  const header = new Uint8Array(44);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 99); // ornamentSeed (a real observed value)
  hv.setUint16(2, 16); // mapDataSize = 4*4 squares
  header[4] = 1; // mapCount
  header[5] = 0; // padding
  // textDataSizeWords, startPosition, objectListSizeWords, and all 13
  // section counts default to 0 (already zero-initialized).

  const def = new Uint8Array(16);
  const dv = new DataView(def.buffer);
  // sizeWord: height=[11:16)+1, width=[6:11)+1, level=[0:6)
  const height = 4, width = 4, level = 5;
  const sizeWord = ((height - 1) << 11) | ((width - 1) << 6) | level;
  dv.setUint16(8, sizeWord);
  // graphicsWord/miscWord/doorWord all 0 -> no creature/deco trailer arrays.

  // 16 squares, all "floor" (type=1, no object, attr=0) = byte 0x20.
  const squares = new Uint8Array(16).fill(0x20);

  // Per-column cumulative thing counts: 2 bytes per column (width=4 -> 8 bytes).
  const colCounts = width * 2;
  const buf = new Uint8Array(header.length + def.length + colCounts + squares.length + 2);
  buf.set(header, 0);
  buf.set(def, 44);
  const squaresOffset = 44 + 16 + colCounts;
  buf.set(squares, squaresOffset);
  // Real trailer: 16-bit sum of every preceding byte, big-endian.
  const sum = dungeonChecksum(buf, squaresOffset + squares.length);
  buf[squaresOffset + squares.length] = sum >> 8;
  buf[squaresOffset + squares.length + 1] = sum & 0xff;
  return { buf, squaresOffset };
}

describe('parseDungeon', () => {
  it('parses the header, one map definition, and the square grid', () => {
    const { buf } = buildSyntheticDungeon();
    const parsed = parseDungeon(buf);
    expect(parsed.header.ornamentSeed).toBe(99);
    expect(parsed.header.mapDataSize).toBe(16);
    expect(parsed.header.mapCount).toBe(1);
    expect(parsed.maps).toHaveLength(1);

    const map = parsed.maps[0]!;
    expect(map.def).toMatchObject({ width: 4, height: 4, level: 5 });
    expect(map.squares).toHaveLength(4); // 4 rows
    for (const row of map.squares) {
      expect(row).toHaveLength(4); // 4 columns
      for (const sq of row) expect(sq).toEqual({ type: 'floor', hasObject: false, attr: 0 });
    }
  });

  it('decodes squares in the documented column-major storage order', () => {
    const header = new Uint8Array(44);
    new DataView(header.buffer).setUint16(2, 4); // mapDataSize = 2*2
    header[4] = 1;
    const def = new Uint8Array(16);
    const dv = new DataView(def.buffer);
    const sizeWord = ((2 - 1) << 11) | ((2 - 1) << 6) | 0; // height=2,width=2,level=0
    dv.setUint16(8, sizeWord);
    // Column-major: [ (x0,y0), (x0,y1), (x1,y0), (x1,y1) ]
    // wall(type0)=0x00, floor(type1)=0x20, door(type4)=0x80, stairs(type3)=0x60
    const squares = new Uint8Array([0x00, 0x20, 0x80, 0x60]);
    const colCounts = 2 * 2; // 2 columns x 2 bytes
    const buf = new Uint8Array(44 + 16 + colCounts + 4 + 2);
    buf.set(header, 0);
    buf.set(def, 44);
    buf.set(squares, 60 + colCounts);

    const parsed = parseDungeon(buf);
    const sq = parsed.maps[0]!.squares;
    expect(sq[0]![0]!.type).toBe('wall'); // (x0,y0)
    expect(sq[1]![0]!.type).toBe('floor'); // (x0,y1)
    expect(sq[0]![1]!.type).toBe('door'); // (x1,y0)
    expect(sq[1]![1]!.type).toBe('stairs'); // (x1,y1)
  });
});

describe('findDungeonDataOffsets', () => {
  it('locates a Dungeon Data header embedded inside a larger buffer, and only that one offset', () => {
    const { buf: dungeon } = buildSyntheticDungeon();
    const junkBefore = new Uint8Array(37).fill(0x41); // arbitrary, non-matching filler
    const junkAfter = new Uint8Array(23).fill(0x99);
    const outer = new Uint8Array(junkBefore.length + dungeon.length + junkAfter.length);
    outer.set(junkBefore, 0);
    outer.set(dungeon, junkBefore.length);
    outer.set(junkAfter, junkBefore.length + dungeon.length);

    const hits = findDungeonDataOffsets(outer);
    expect(hits).toEqual([junkBefore.length]);
  });

  it('null control: one corrupted byte in the dungeon breaks the checksum and the hit disappears', () => {
    const { buf: dungeon } = buildSyntheticDungeon();
    const outer = new Uint8Array(37 + dungeon.length + 23);
    outer.set(dungeon, 37);
    outer[37 + 50] ^= 0x01; // flip a byte inside the map-data region
    expect(findDungeonDataOffsets(outer)).toEqual([]);
  });

  it('finds nothing in blank filler', () => {
    const junk = new Uint8Array(200).fill(0x00);
    expect(findDungeonDataOffsets(junk)).toEqual([]);
  });
});

describe('parseDungeon: forward tiling and checksum', () => {
  it('forward walk lands exactly on the declared Map Data start and the trailer verifies', () => {
    const { buf, squaresOffset } = buildSyntheticDungeon();
    const parsed = parseDungeon(buf);
    expect(parsed.forwardTilingExact).toBe(true);
    expect(parsed.mapDataOffset).toBe(squaresOffset);
    expect(parsed.checksum).toMatchObject({ valid: true });
    expect(parsed.mapOffsetsMatchCursor).toBe(true);
  });

  it('projectile (8 B) and explosion (4 B) records are counted in the forward walk', () => {
    const { buf } = buildSyntheticDungeon();
    // Insert 2 projectiles + 3 explosions (2*8 + 3*4 = 28 bytes) before Map Data.
    const extra = 28;
    const out = new Uint8Array(buf.length + extra);
    const mdo = 60 + 8; // Map Data start (after def + 8 bytes of column counts)
    out.set(buf.subarray(0, mdo), 0);
    out.set(buf.subarray(mdo), mdo + extra);
    const dv = new DataView(out.buffer);
    dv.setUint16(40, 2);
    dv.setUint16(42, 3);
    const end = out.length - 2;
    const sum = dungeonChecksum(out, end);
    out[end] = sum >> 8;
    out[end + 1] = sum & 0xff;
    const parsed = parseDungeon(out);
    expect(parsed.forwardTilingExact).toBe(true);
    expect(parsed.mapDataOffset).toBe(mdo + extra);
    expect(parsed.checksum?.valid).toBe(true);
    // Null control: with the old "unknown size" assumption (0 bytes each) the walk would miss by 28.
    expect(parsed.mapDataOffset).not.toBe(mdo);
  });

  it('a wrong trailer is reported invalid, not silently accepted', () => {
    const { buf } = buildSyntheticDungeon();
    buf[buf.length - 1] ^= 0xff;
    expect(parseDungeon(buf).checksum?.valid).toBe(false);
  });
});
