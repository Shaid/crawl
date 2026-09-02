import { describe, it, expect } from 'vitest';
import { parseDungeon, findDungeonDataOffsets } from '../dungeonmaster-dungeon.ts';

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

  const checksum = new Uint8Array([0xab, 0xcd]);

  const buf = new Uint8Array(header.length + def.length + squares.length + checksum.length);
  buf.set(header, 0);
  buf.set(def, 44);
  const squaresOffset = 44 + 16;
  buf.set(squares, squaresOffset);
  buf.set(checksum, squaresOffset + squares.length);
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
    const checksum = new Uint8Array([0, 0]);
    const buf = new Uint8Array(44 + 16 + 4 + 2);
    buf.set(header, 0);
    buf.set(def, 44);
    buf.set(squares, 60);
    buf.set(checksum, 64);

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

    // mapCount=1 isn't one of the real games' known counts, so pass it explicitly.
    const hits = findDungeonDataOffsets(outer, [1]);
    expect(hits).toEqual([junkBefore.length]);
  });

  it('finds nothing when no known map count / ornament seed combination is present', () => {
    const junk = new Uint8Array(200).fill(0x00);
    expect(findDungeonDataOffsets(junk)).toEqual([]);
  });
});
