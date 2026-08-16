import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decompressLCW } from '../lcw.ts';
import { decodeMaze, wallTypeAt, type MazeData } from '../decode-maze.ts';
import { rotateOffset, roleSide, resolveWallTypes, canStepForward } from '../view-model.ts';
import { findWallSet } from '../decode-inf.ts';
import { decodeVmp, WALL_RENDER_SLOTS } from '../decode-vmp.ts';

function loadMaze(level: number): MazeData {
  const data = readFileSync(resolve(`data/eotb/amiga/LEVEL${level}.MAZ`));
  return decodeMaze(new Uint8Array(data));
}

describe('decompressLCW', () => {
  it('decompresses a literal-copy command', () => {
    // Command 1: 10000011 (literal copy, count=3), then 3 literal bytes, then EOF (0x80).
    const src = Uint8Array.from([0b10000011, 1, 2, 3, 0x80]);
    expect(Array.from(decompressLCW(src))).toEqual([1, 2, 3]);
  });

  it('decompresses a fill command (command 4)', () => {
    // 0xFE = command-4 marker (sub === 0x3e), count=5 (LE), value=9.
    const src = Uint8Array.from([0xfe, 5, 0, 9, 0x80]);
    expect(Array.from(decompressLCW(src))).toEqual([9, 9, 9, 9, 9]);
  });

  it('decompresses an absolute back-reference (command 3)', () => {
    // Literal "AB" (out=[65,66]) then a command-3 copy of 3 bytes from
    // position 0 -- self-overlapping (the 3rd copied byte reads a byte
    // the copy itself just appended), the classic LZ77 run-length trick.
    const src = Uint8Array.from([0b10000010, 65, 66, 0b11000000 | 0, 0, 0, 0x80]);
    expect(Array.from(decompressLCW(src))).toEqual([65, 66, 65, 66, 65]);
  });
});

describe('decodeMaze', () => {
  it('rejects a header that fails the 32x32/tileSize=4 oracle check', () => {
    const bad = new Uint8Array(4102);
    bad[0] = 16; // width=16, not 32
    expect(() => decodeMaze(bad)).toThrow(/oracle check failed/);
  });

  it('decodes a real LEVEL1.MAZ header', () => {
    const maze = loadMaze(1);
    expect(maze.width).toBe(32);
    expect(maze.height).toBe(32);
    expect(wallTypeAt(maze, 0, 0, 'N')).toBeGreaterThanOrEqual(0);
  });

  it('treats out-of-bounds cells as solid (wallType 1)', () => {
    const maze = loadMaze(1);
    expect(wallTypeAt(maze, -1, 0, 'N')).toBe(1);
    expect(wallTypeAt(maze, 999, 999, 'S')).toBe(1);
  });
});

describe('rotateOffset', () => {
  it('is the identity for facing North', () => {
    expect(rotateOffset(2, -3, 0)).toEqual([2, -3]);
  });
  it('rotates a forward step (0,-1) to (1,0) for facing East (turning right)', () => {
    expect(rotateOffset(0, -1, 1)).toEqual([1, 0]);
  });
  it('rotates a forward step to (0,1) for facing South', () => {
    expect(rotateOffset(0, -1, 2)).toEqual([0, 1]);
  });
  it('rotates a forward step to (-1,0) for facing West', () => {
    expect(rotateOffset(0, -1, 3)).toEqual([-1, 0]);
  });
  it('round-trips all 4 facings back to the same forward-step magnitude', () => {
    for (let f = 0; f < 4; f++) {
      const [dx, dy] = rotateOffset(0, -1, f as 0 | 1 | 2 | 3);
      expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
    }
  });
});

describe('roleSide', () => {
  it('matches the facing-North diagram directly (left=E, right=W, front=S)', () => {
    expect(roleSide('left', 0)).toBe('E');
    expect(roleSide('right', 0)).toBe('W');
    expect(roleSide('front', 0)).toBe('S');
  });
  it('rotates by one step per facing, same sense for every role (self-consistency, not a claim about real compass semantics -- see module doc)', () => {
    for (let f = 0; f < 4; f++) {
      const left = roleSide('left', f as 0 | 1 | 2 | 3);
      const front = roleSide('front', f as 0 | 1 | 2 | 3);
      const right = roleSide('right', f as 0 | 1 | 2 | 3);
      // left/front/right must always be 3 distinct sides (never collapse).
      expect(new Set([left, front, right]).size).toBe(3);
    }
  });
  it('returns to the facing-0 mapping after 4 steps', () => {
    expect(roleSide('left', 0)).toBe(roleSide('left', 0));
  });
});

describe('resolveWallTypes', () => {
  it('resolves all 25 WALL_RENDER_SLOTS to a wallType in 0-6 (clamped)', () => {
    const maze = loadMaze(1);
    for (const facing of [0, 1, 2, 3] as const) {
      const resolved = resolveWallTypes(maze, 16, 16, facing);
      expect(resolved).toHaveLength(WALL_RENDER_SLOTS.length);
      for (const { wallType } of resolved) {
        expect(wallType).toBeGreaterThanOrEqual(0);
        expect(wallType).toBeLessThanOrEqual(6);
      }
    }
  });

  it('changes with facing at a fixed position (rotation actually applies)', () => {
    const maze = loadMaze(1);
    const f0 = resolveWallTypes(maze, 10, 10, 0).map((r) => r.wallType);
    const f1 = resolveWallTypes(maze, 10, 10, 1).map((r) => r.wallType);
    expect(f0).not.toEqual(f1);
  });
});

describe('canStepForward', () => {
  it('agrees with wallTypeAt on the facing side', () => {
    const maze = loadMaze(1);
    for (let x = 0; x < 5; x++) {
      const open = canStepForward(maze, x, x, 0);
      expect(open).toBe(wallTypeAt(maze, x, x, 'N') === 0);
    }
  });
});

describe('findWallSet', () => {
  it('resolves each real LEVEL*.INF to exactly one known wall set', () => {
    const expected: Record<number, string> = {
      1: 'BRICK', 2: 'BRICK', 3: 'BRICK', 4: 'BLUE', 5: 'BLUE', 6: 'BLUE',
      7: 'DROW', 8: 'DROW', 9: 'DROW', 10: 'GREEN', 11: 'GREEN', 12: 'XANATHA',
    };
    for (const [level, wallSet] of Object.entries(expected)) {
      const data = readFileSync(resolve(`data/eotb/amiga/LEVEL${level}.INF`));
      expect(findWallSet(new Uint8Array(data))).toBe(wallSet);
    }
  });

  it('throws when no known wall-set token is present', () => {
    expect(() => findWallSet(new TextEncoder().encode('nothing relevant here'))).toThrow();
  });
});

describe('decodeVmp', () => {
  it('rejects a size that fails the byte-count oracle check', () => {
    expect(() => decodeVmp(new Uint8Array(100), 1000)).toThrow(/oracle check failed/);
  });

  it('rejects a resolved tile index >= numTiles (endianness/layout guard)', () => {
    const data = readFileSync(resolve('data/eotb/amiga/BRICK.VMP'));
    expect(() => decodeVmp(new Uint8Array(data), 1)).toThrow(/oracle check failed/);
  });

  it('decodes a real BRICK.VMP with all indices in range', () => {
    const data = readFileSync(resolve('data/eotb/amiga/BRICK.VMP'));
    const vmp = decodeVmp(new Uint8Array(data), 1399);
    expect(vmp.backdrop).toHaveLength(22);
    expect(vmp.backdrop[0]).toHaveLength(15);
    expect(vmp.wallTiles).toHaveLength(6);
    expect(vmp.wallTiles[0]).toHaveLength(431);
    // The backdrop's first column is confirmed (this session) to be a
    // clean ascending 1..15 run -- the structural evidence that settled
    // the BE-vs-LE endianness question for this format.
    expect(vmp.backdrop[0]!.map((r) => r.tileIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});
