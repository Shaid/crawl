import { describe, it, expect } from 'vitest';
import {
  densifyMazeLevel,
  wallForFacing,
  featureOf,
  canStepSnes,
  resolveViewOps,
  extractPoolIndices,
  compositeSnesView,
  type MazeLevelRaw,
  type ViewPiecesFile,
} from '../view-model';

describe('wallForFacing', () => {
  it('extracts the 2-bit sub-field per absolute compass direction', () => {
    // bits0-1=N(+Y), 2-3=E(+X), 4-5=S(-Y), 6-7=W(-X)
    const byte = 0b11_10_01_00; // N=0, E=1, S=2, W=3
    expect(wallForFacing(byte, 0)).toBe(0);
    expect(wallForFacing(byte, 1)).toBe(1);
    expect(wallForFacing(byte, 2)).toBe(2);
    expect(wallForFacing(byte, 3)).toBe(3);
  });
  it('is 0 for an all-open byte', () => {
    expect(wallForFacing(0, 0)).toBe(0);
    expect(wallForFacing(0, 3)).toBe(0);
  });
});

describe('featureOf', () => {
  it('normalises the 0x0D/0x0E "no feature" sentinels to 0', () => {
    expect(featureOf(0x0d).feature).toBe(0);
    expect(featureOf(0x0e).feature).toBe(0);
    expect(featureOf(0x4e).feature).toBe(0); // top bits set, masked off
  });
  it('passes through a real feature code and splits orientation', () => {
    const byte = (2 << 4) | 6; // orient=2, feature=6 (door)
    expect(featureOf(byte)).toEqual({ feature: 6, orient: 2 });
  });
});

describe('densifyMazeLevel', () => {
  const level: MazeLevelRaw = {
    level: 0,
    origins: [{ x: 10, y: 10 }],
    cells: [
      { region: 0, major: 7, minor: 0, wall: 0x11, feature: 0x0d }, // -> global (10,10) after +(7-7)=0
      { region: 0, major: 0, minor: 7, wall: 0x22, feature: 6 }, // -> global (17,17) after +(7-0)=7
    ],
  };

  it('places cells at the confirmed major-axis-reversed global position', () => {
    const grid = densifyMazeLevel(level);
    expect(grid.width).toBe(8); // minor 0..7
    expect(grid.height).toBe(8); // (7-major) 0..7
    // (10,10) is the min corner -> local (0,0)
    expect(grid.wall[0 * grid.width + 0]).toBe(0x11);
    // (17,17) -> local (7,7)
    expect(grid.wall[7 * grid.width + 7]).toBe(0x22);
    expect(grid.feature[7 * grid.width + 7]).toBe(6);
  });

  it('fills unvisited cells with the solid off-map sentinel', () => {
    const grid = densifyMazeLevel(level);
    // local (1,1) was never written by a cell record
    expect(grid.wall[1 * grid.width + 1]).toBe(0xff);
    expect(featureOf(grid.feature[1 * grid.width + 1]!).feature).toBe(0); // 0x0d normalises to 0
  });
});

describe('canStepSnes', () => {
  const grid = densifyMazeLevel({
    level: 0,
    origins: [{ x: 0, y: 0 }],
    cells: [{ region: 0, major: 7, minor: 0, wall: 0, feature: 0x0d }],
  });

  it('allows stepping through an open sub-field', () => {
    expect(canStepSnes(grid, 0, 0, 0)).toBe(true); // N wall bits = 0
  });
  it('blocks off-map steps', () => {
    expect(canStepSnes(grid, 0, 0, 2)).toBe(false); // S would leave the 1x1 grid
  });
});

describe('resolveViewOps', () => {
  it('always includes the backdrop, and nothing else in a fully open pose', () => {
    const grid = densifyMazeLevel({
      level: 0,
      origins: [{ x: 0, y: 0 }],
      cells: Array.from({ length: 64 }, (_, i) => ({
        region: 0,
        major: Math.floor(i / 8),
        minor: i % 8,
        wall: 0,
        feature: 0x0d,
      })),
    });
    const ops = resolveViewOps(grid, 3, 3, 0);
    expect(ops).toEqual([{ kind: 'backdrop' }]);
  });

  it('emits a front wall op when the wall sub-field is nonzero', () => {
    const cells = Array.from({ length: 64 }, (_, i) => ({
      region: 0,
      major: Math.floor(i / 8),
      minor: i % 8,
      wall: 0,
      feature: 0x0d,
    }));
    // Cell one step north of (3,3) is (3,4) -> local index major=(7-4)=3,minor=3 -> array index 3*8+3=27
    cells[27]!.wall = 0b01; // N wall present
    const grid2 = densifyMazeLevel({ level: 0, origins: [{ x: 0, y: 0 }], cells });
    const ops = resolveViewOps(grid2, 3, 3, 0);
    expect(ops).toContainEqual({ kind: 'front', depth: 1 });
  });

  it('overrides with the confirmed door op at depth 1 front when feature==6', () => {
    const cells = Array.from({ length: 64 }, (_, i) => ({
      region: 0,
      major: Math.floor(i / 8),
      minor: i % 8,
      wall: 0,
      feature: 0x0d,
    }));
    cells[27]!.feature = 6; // same cell as above, one step ahead at depth 1
    const grid = densifyMazeLevel({ level: 0, origins: [{ x: 0, y: 0 }], cells });
    const ops = resolveViewOps(grid, 3, 3, 0);
    expect(ops).toContainEqual({ kind: 'door' });
    expect(ops).not.toContainEqual({ kind: 'front', depth: 1 });
  });
});

describe('extractPoolIndices + compositeSnesView', () => {
  it('recovers the R-channel index and composites a piece into the viewport', () => {
    // A tiny 8x8 "pool" with 1 tile whose every pixel is index 5.
    const poolW = 8;
    const poolH = 8;
    const rgba = new Uint8Array(poolW * poolH * 4);
    for (let i = 0; i < poolW * poolH; i++) {
      rgba[i * 4] = 5;
      rgba[i * 4 + 3] = 255;
    }
    const pool = extractPoolIndices(rgba, poolW, poolH);
    expect(pool.every((v) => v === 5)).toBe(true);

    const viewPieces: ViewPiecesFile = {
      viewport: { w: 2, h: 2 },
      tileSize: 8,
      poolAtlas: 'x.png',
      poolCols: 1,
      backdrop: { x: 0, y: 0, w: 2, h: 2, cells: [0, 0, 0, 0] },
      door: { x: 0, y: 0, w: 1, h: 1, cells: [0] },
      wall: { front: [], left: [], right: [] },
    };
    const palette = Array.from({ length: 16 }, (_, i) => ({ r: i, g: i, b: i }));
    const { rgba: out, width, height } = compositeSnesView(viewPieces, pool, poolW, palette, [{ kind: 'backdrop' }]);
    expect(width).toBe(16);
    expect(height).toBe(16);
    // Every pixel should be palette[5] = {5,5,5}, fully opaque.
    for (let i = 0; i < width * height; i++) {
      expect(out[i * 4]).toBe(5);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });
});
