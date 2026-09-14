import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readBinary } from '@seer-project/pipeline';
import { parseMazeData, verifyByteAccounting } from '../decode-dosega-maze.ts';

// Unit tests for the underlying decodePackedPixelLinear/decodeCgaBanked
// chunky-pixel decoders now live in @seer-project/gfx
// (packages/gfx/src/__tests__/packed-pixel.test.ts) -- they moved there
// along with the implementation. What remains here is corpus-gated
// coverage of this project's own mazedata directory/byte-accounting logic.

const DOS_DIR = 'data/wizardry6/dosega/wiz6';

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
