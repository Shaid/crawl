import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readBinary } from '@seer-project/pipeline';
import { decodeCgaBanked, decodePackedPixelLinear } from '../../shared/packed-pixel.ts';
import { parseMazeData, verifyByteAccounting } from '../decode-dosega-maze.ts';

const DOS_DIR = 'data/wizardry6/dosega/wiz6';

describe('decodePackedPixelLinear', () => {
  it('unpacks 2bpp pixels MSB-first, 4 pixels/byte', () => {
    // byte 0b00_01_10_11 = 0x1b -> pixels [0,1,2,3]
    const data = new Uint8Array([0x1b]);
    const { indices } = decodePackedPixelLinear(data, 0, 4, 1, 2);
    expect([...indices]).toEqual([0, 1, 2, 3]);
  });

  it('unpacks 4bpp pixels MSB-first, 2 pixels/byte', () => {
    // byte 0xA5 -> high nibble 0xA, low nibble 0x5
    const data = new Uint8Array([0xa5]);
    const { indices } = decodePackedPixelLinear(data, 0, 2, 1, 4);
    expect([...indices]).toEqual([0xa, 0x5]);
  });

  it('decodes multiple rows using ceil(width/pixelsPerByte) row stride', () => {
    // width=5 at 2bpp -> ceil(5/4)=2 bytes/row
    // row0: 0b00_01_10_11 0b10_000000 -> [0,1,2,3,2]
    // row1: 0b11_10_01_00 0b01_000000 -> [3,2,1,0,1]
    const data = new Uint8Array([0x1b, 0x80, 0xe4, 0x40]);
    const { indices } = decodePackedPixelLinear(data, 0, 5, 2, 2);
    expect([...indices]).toEqual([0, 1, 2, 3, 2, 3, 2, 1, 0, 1]);
  });
});

describe('decodeCgaBanked', () => {
  it('interleaves even scanlines from bank 0 and odd from bank 1 (offset bankGap)', () => {
    // width=4 @ 2bpp -> 1 byte/row. 4 rows -> 2 rows/bank.
    // bank0 (even rows 0,2): 0x1b, 0xe4
    // bank1 (odd rows 1,3), at bankGap=8: 0x00, 0xff
    const data = new Uint8Array(16);
    data[0] = 0x1b; // row 0
    data[1] = 0xe4; // row 2
    data[8] = 0x00; // row 1
    data[9] = 0xff; // row 3
    const { indices } = decodeCgaBanked(data, 0, 4, 4, 2, 8);
    const row = (y: number) => [...indices.slice(y * 4, y * 4 + 4)];
    expect(row(0)).toEqual([0, 1, 2, 3]); // 0x1b
    expect(row(1)).toEqual([0, 0, 0, 0]); // 0x00
    expect(row(2)).toEqual([3, 2, 1, 0]); // 0xe4
    expect(row(3)).toEqual([3, 3, 3, 3]); // 0xff
  });
});

describe('mazedata.cga / mazedata.t16 directory (dosega corpus)', () => {
  const cgaPath = join(DOS_DIR, 'mazedata.cga');
  const t16Path = join(DOS_DIR, 'mazedata.t16');
  const haveData = existsSync(cgaPath) && existsSync(t16Path);

  it.runIf(haveData)('mazedata.cga: cumulative byte accounting reaches EOF exactly (bpp=2)', () => {
    const data = readBinary(cgaPath);
    expect(data.length).toBe(52451); // 2599 header/dir + (99704/2) payload, per data-structure.md sec 3.4 halved
    const maze = parseMazeData(data, 2);
    expect(maze.dirCount).toBe(153);
    expect(maze.subCount).toBe(366);
    expect(verifyByteAccounting(data, maze, 2)).toBeNull();
  });

  it.runIf(haveData)('mazedata.t16: cumulative byte accounting reaches EOF exactly (bpp=4)', () => {
    const data = readBinary(t16Path);
    expect(data.length).toBe(102303); // same as mazedata.ega -- 4bpp either way
    const maze = parseMazeData(data, 4);
    expect(verifyByteAccounting(data, maze, 4)).toBeNull();
  });

  it.runIf(haveData)('mazedata.cga/.t16 widthUnits/heightRows match mazedata.ega, byte for byte', () => {
    const egaData = readBinary(join(DOS_DIR, 'mazedata.ega'));
    const egaMaze = parseMazeData(egaData, 4);
    for (const [path, bpp] of [
      [cgaPath, 2],
      [t16Path, 4],
    ] as const) {
      const data = readBinary(path);
      const maze = parseMazeData(data, bpp);
      expect(maze.dirRecords.length).toBe(egaMaze.dirRecords.length);
      for (let i = 0; i < maze.dirRecords.length; i++) {
        expect(maze.dirRecords[i].widthUnits).toBe(egaMaze.dirRecords[i].widthUnits);
        expect(maze.dirRecords[i].heightRows).toBe(egaMaze.dirRecords[i].heightRows);
      }
    }
  });
});

describe('.CGA / .T16 full-screen file sizes (dosega corpus)', () => {
  const screens = ['dragonsc', 'graveyrd', 'titlepag'];
  for (const base of screens) {
    const egaPath = join(DOS_DIR, `${base}.ega`);
    const cgaPath = join(DOS_DIR, `${base}.cga`);
    const t16Path = join(DOS_DIR, `${base}.t16`);
    const have = existsSync(egaPath) && existsSync(cgaPath) && existsSync(t16Path);

    it.runIf(have)(`${base}: .cga is exactly half of .ega, .t16 equals .ega`, () => {
      const egaSize = statSync(egaPath).size;
      const cgaSize = statSync(cgaPath).size;
      const t16Size = statSync(t16Path).size;
      expect(egaSize).toBe(32768);
      expect(cgaSize).toBe(egaSize / 2);
      expect(t16Size).toBe(egaSize);
    });
  }
});
