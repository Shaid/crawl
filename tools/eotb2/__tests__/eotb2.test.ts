import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeMaze, wallTypeAt, type MazeData } from '../decode-maze.ts';
import { rotateOffset, resolveWallTypes, canStepForward } from '../view-model.ts';
import { decodeInf } from '../decode-inf.ts';
import { decodeVcn } from '../decode-vcn.ts';
import { decodeVmp, WALL_RENDER_SLOTS } from '../decode-vmp.ts';
import { decodePal } from '../palette.ts';
import { renderView, VIEWPORT_W, VIEWPORT_H } from '../renderer.ts';

const DATA_DIR = 'data/eotb2/dosvga';

function loadMaze(level: number): MazeData {
  const infRaw = new Uint8Array(readFileSync(resolve(DATA_DIR, `LEVEL${level}.INF`)));
  const { mazStem } = decodeInf(infRaw);
  const data = readFileSync(resolve(DATA_DIR, mazStem.toUpperCase()));
  return decodeMaze(new Uint8Array(data));
}

describe('decodeInf', () => {
  it('resolves every real LEVEL*.INF (1-16) to a known wall-set stem and a .maz mazStem', () => {
    const KNOWN_WALL_SETS = new Set(['dung', 'forest', 'mezz', 'silver', 'crimson', 'azure']);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`));
      const { mazStem, wallSetStem } = decodeInf(new Uint8Array(data));
      expect(KNOWN_WALL_SETS.has(wallSetStem.toLowerCase())).toBe(true);
      expect(mazStem.toLowerCase()).toMatch(/\.maz$/);
    }
  });

  it("LEVEL16.INF reuses LEVEL15's maze (documented maze-reuse case)", () => {
    const data = readFileSync(resolve(DATA_DIR, 'LEVEL16.INF'));
    const { mazStem } = decodeInf(new Uint8Array(data));
    expect(mazStem.toLowerCase()).toBe('level15.maz');
  });

  it('throws on a truncated/corrupt buffer rather than silently misreading', () => {
    expect(() => decodeInf(new Uint8Array(5))).toThrow();
  });

  it('decodes the optional second wall-set stem ("azure") on exactly LEVEL10-14, and only those', () => {
    const expectSecond = new Set([10, 11, 12, 13, 14]);
    for (let n = 1; n <= 16; n++) {
      const data = readFileSync(resolve(DATA_DIR, `LEVEL${n}.INF`));
      const { secondWallSetStem } = decodeInf(new Uint8Array(data));
      if (expectSecond.has(n)) {
        expect(secondWallSetStem?.toLowerCase()).toBe('azure');
      } else {
        expect(secondWallSetStem).toBeUndefined();
      }
    }
  });
});

describe('decodePal', () => {
  it('rejects a size that fails the 768-byte oracle check', () => {
    expect(() => decodePal(new Uint8Array(100))).toThrow(/oracle check failed/);
  });

  it('expands 6-bit VGA values with the low-2-bit-preserving formula, not naive *4', () => {
    // v=63 (max 6-bit) -> 255, not 63*4=252.
    const data = new Uint8Array(768);
    data[0] = 63;
    data[1] = 63;
    data[2] = 63;
    const palette = decodePal(data);
    expect(palette[0]).toEqual([255, 255, 255]);
  });

  it('decodes a real CRIMSON.PAL to 256 colours', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.PAL'));
    const palette = decodePal(new Uint8Array(data));
    expect(palette).toHaveLength(256);
  });
});

describe('decodeVcn', () => {
  it('decodes real CRIMSON.VCN to the doc-confirmed tile count', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VCN'));
    const vcn = decodeVcn(new Uint8Array(data));
    expect(vcn.numTiles).toBe(1132);
    expect(vcn.tiles).toHaveLength(1132);
    expect(vcn.tiles[0]).toHaveLength(64); // 8x8
  });
});

describe('decodeVmp', () => {
  it('decodes real FOREST.VMP as a 2-wall-type set (1192 = 330 backdrop + 2*431), not a rejected non-standard layout', () => {
    const data = readFileSync(resolve(DATA_DIR, 'FOREST.VMP'));
    const vmp = decodeVmp(new Uint8Array(data), 906);
    expect(vmp.backdrop).toHaveLength(22);
    expect(vmp.backdrop[0]).toHaveLength(15);
    expect(vmp.wallTiles).toHaveLength(2);
    expect(vmp.wallTiles[0]).toHaveLength(431);
  });

  it('rejects a genuinely non-standard entry count that does not divide evenly by 431', () => {
    const bogus = new Uint8Array(2 + 331 * 2); // 331 != 330 + N*431 for any integer N
    bogus[0] = 331 & 0xff;
    bogus[1] = (331 >> 8) & 0xff;
    expect(() => decodeVmp(bogus, 10000)).toThrow(/non-standard entry count/);
  });

  it('rejects a resolved tile index >= numTiles (endianness/layout guard)', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    expect(() => decodeVmp(new Uint8Array(data), 1)).toThrow(/oracle check failed/);
  });

  it('decodes real CRIMSON.VMP to the doc-confirmed shape and max index', () => {
    const data = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    const vmp = decodeVmp(new Uint8Array(data), 1132);
    expect(vmp.backdrop).toHaveLength(22);
    expect(vmp.backdrop[0]).toHaveLength(15);
    expect(vmp.wallTiles).toHaveLength(6);
    expect(vmp.wallTiles[0]).toHaveLength(431);
    let maxIndex = 0;
    for (const col of vmp.backdrop) for (const ref of col) maxIndex = Math.max(maxIndex, ref.tileIndex);
    for (const run of vmp.wallTiles) for (const ref of run) maxIndex = Math.max(maxIndex, ref.tileIndex);
    expect(maxIndex).toBe(1131); // numTiles - 1, per docs/eotb2/dosvga/data-structure.md's table
  });
});

describe('decodeMaze (reused from tools/eotb)', () => {
  it('decodes a real EOB2 LEVEL1.MAZ header (byte-identical format to EOB1)', () => {
    const maze = loadMaze(1);
    expect(maze.width).toBe(32);
    expect(maze.height).toBe(32);
    expect(wallTypeAt(maze, 0, 0, 'N')).toBeGreaterThanOrEqual(0);
  });
});

describe('rotateOffset / resolveWallTypes / canStepForward (reused from tools/eotb, same geometry table)', () => {
  it('rotateOffset is the identity for facing North', () => {
    expect(rotateOffset(2, -3, 0)).toEqual([2, -3]);
  });

  it('resolveWallTypes resolves all 25 WALL_RENDER_SLOTS to a wallType in 0-6 for a real EOB2 level', () => {
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

  it('canStepForward agrees with wallTypeAt on the facing side', () => {
    const maze = loadMaze(1);
    for (let x = 0; x < 5; x++) {
      expect(canStepForward(maze, x, x, 0)).toBe(wallTypeAt(maze, x, x, 'N') === 0);
    }
  });
});

describe('renderView (end-to-end, real EOB2 corpus data)', () => {
  it('renders a real level-1 pose to a non-degenerate (not all-background) surface', () => {
    const maze = loadMaze(1);
    const vcnData = readFileSync(resolve(DATA_DIR, 'CRIMSON.VCN'));
    const vmpData = readFileSync(resolve(DATA_DIR, 'CRIMSON.VMP'));
    const vcn = decodeVcn(new Uint8Array(vcnData));
    const vmp = decodeVmp(new Uint8Array(vmpData), vcn.numTiles);

    const surface = renderView(maze, 16, 16, 0, vcn, vmp);
    expect(surface.width).toBe(VIEWPORT_W);
    expect(surface.height).toBe(VIEWPORT_H);
    // The backdrop alone (ceiling/floor, drawn unconditionally) guarantees
    // at least some nonzero pixels regardless of pose.
    let nonZero = 0;
    for (const v of surface.data) if (v !== 0) nonZero++;
    expect(nonZero).toBeGreaterThan(0);
  });
});
