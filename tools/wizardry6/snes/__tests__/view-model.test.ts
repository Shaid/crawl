/**
 * SNES W6 view-model tests (v2 faithful walk, `data-structure.md`
 * §3.14.12).
 *
 * Two levels:
 *
 * 1. **Pure unit tests** (no assets): wall-field extraction, feature
 *    decode, densify seeding, movement.
 *
 * 2. **Real-data golden test** (skips when the exported assets are
 *    absent): `resolveViewWords` must reproduce, word-for-word, the
 *    compose lists produced by an INDEPENDENT Python re-implementation of
 *    the same disassembly (`truewalk.py`, the session's verification
 *    oracle -- the fixtures below are copied from its actual output, per
 *    `hand-computed-test-fixture-vs-real-run.md`: fixtures come from a
 *    real run of a second implementation, never hand-computed). The two
 *    implementations were written against the same disassembly but share
 *    no code, so agreement pins the whole dispatch chain: evaluator
 *    codes, DE4E/variant word selection, DE1B second draws, DE2C
 *    visibility propagation, DE3D/$78 deferral + $c85e flush order, the
 *    floor/ceiling pass, and the final 0x834A backdrop.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  densifyMazeLevel,
  wallForFacing,
  featureOf,
  canStepSnes,
  resolveViewWords,
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
      { region: 0, major: 7, minor: 0, wall: 0x11, feature: 0x0d }, // -> global (10,10)
      { region: 0, major: 0, minor: 7, wall: 0x22, feature: 6 }, // -> global (17,17)
    ],
  };

  it('places cells at the confirmed major-axis-reversed global position and records the origin', () => {
    const grid = densifyMazeLevel(level, 0x0e, [], [], 0);
    expect(grid.width).toBe(8);
    expect(grid.height).toBe(8);
    expect(grid.originX).toBe(10);
    expect(grid.originY).toBe(10);
    expect(grid.wall[0 * grid.width + 0]).toBe(0x11);
    expect(grid.wall[7 * grid.width + 7]).toBe(0x22);
    expect(grid.feature[7 * grid.width + 7]).toBe(6);
  });

  it("fills unvisited cells with the game's own level-load seeds (wall 0, DB8D feature byte)", () => {
    const grid = densifyMazeLevel(level, 0x0e, [], [], 0);
    // local (1,1) was never written by a cell record
    expect(grid.wall[1 * grid.width + 1]).toBe(0);
    expect(grid.feature[1 * grid.width + 1]).toBe(0x0e);
  });
});

describe('canStepSnes', () => {
  const grid = densifyMazeLevel(
    {
      level: 0,
      origins: [{ x: 0, y: 0 }],
      cells: [{ region: 0, major: 7, minor: 0, wall: 0, feature: 0x0d }],
    },
    0x0d,
    [],
    [],
    0,
  );

  it('allows stepping through an open sub-field', () => {
    expect(canStepSnes(grid, 0, 0, 0)).toBe(true); // N wall bits = 0
  });
  it('blocks off-map steps', () => {
    expect(canStepSnes(grid, 0, 0, 2)).toBe(false); // S would leave the 1x1 grid
  });
});

// ── Real-data golden test ────────────────────────────────────────────────

const assetBase = resolve('public/assets/wizardry6/snes');
const viewPiecesPath = resolve(assetBase, 'dungeon/view-pieces.json');
const mazePath = resolve(assetBase, 'data/maze.json');
const haveAssets = existsSync(viewPiecesPath) && existsSync(mazePath);

/**
 * Golden compose-word lists from the independent Python oracle
 * (`truewalk.py`), pose coordinates in GLOBAL maze space. Each verified
 * against the ROM's own art by decisive renders (closed wooden door /
 * open doorway / plain corridor / forest, session log in
 * `docs/wizardry6/plan.md`).
 */
const GOLDEN: Array<{ level: number; gx: number; gy: number; facing: number; words: number[] }> = [
  {
    // level 2 castle, closed door (wall value 3) dead ahead
    level: 2,
    gx: 123,
    gy: 122,
    facing: 0,
    words: [
      0x102, 0x104, 0x52, 0x4a, 0x106, 0x10a, 0x1c8, 0x10e, 0x362, 0x1c0, 0xb6, 0x846, 0x90c, 0x8004, 0x8006, 0x800c,
      0x800e, 0x8014, 0x8016, 0x801c, 0x801e, 0x8024, 0x8026, 0x802c, 0x802e, 0x8034, 0x8036, 0x803c, 0x803e, 0x8044,
      0x8046, 0x804c, 0x804e, 0x8054, 0x8056, 0x805c, 0x805e, 0x8064, 0x8066, 0x806c, 0x806e, 0x8074, 0x8076, 0x807c,
      0x807e, 0x8084, 0x8086, 0x808c, 0x808e, 0x8094, 0x8096, 0x809c, 0x809e, 0x80a4, 0x80a6, 0x80ac, 0x80ae, 0x80b4,
      0x80b6, 0x80bc, 0x568, 0x80c4, 0x80c6, 0x80cc, 0x80ce, 0x834a,
    ],
  },
];

describe.skipIf(!haveAssets)('resolveViewWords (real data, golden fixtures from the independent Python oracle)', () => {
  const maze: MazeLevelRaw[] = haveAssets ? JSON.parse(readFileSync(mazePath, 'utf8')) : [];
  const viewPieces: ViewPiecesFile = haveAssets ? JSON.parse(readFileSync(viewPiecesPath, 'utf8')) : (null as never);

  for (const g of GOLDEN) {
    it(`level ${g.level} pose (${g.gx},${g.gy}) facing ${g.facing} matches word-for-word`, () => {
      const lvl = maze.find((l) => l.level === g.level)!;
      const seedVariant = viewPieces.variants[g.level] ?? 0;
      const grid = densifyMazeLevel(lvl, viewPieces.tables.db8d[g.level] ?? 0x0d, viewPieces.da2e, viewPieces.db9b, seedVariant);
      const words = resolveViewWords(viewPieces, grid, g.level, g.gx - grid.originX, g.gy - grid.originY, g.facing);
      expect(words.map((w) => `0x${w.toString(16)}`)).toEqual(g.words.map((w) => `0x${w.toString(16)}`));
    });
  }

  it('door pose includes the EB1A closed-door word pair (0x52 appended + deferred doorway 0x4a)', () => {
    const g = GOLDEN[0]!;
    expect(g.words).toContain(0x52); // EB1A word 3 = wall value 3, the door-leaf art
    expect(g.words).toContain(0x4a); // EB1A word 1 = the doorway frame (DE1B second draw, deferred via $78)
  });
});

describe('compositeSnesView', () => {
  it('composites near-to-far: the FIRST piece to claim a cell wins', () => {
    const poolW = 8;
    const rgba = new Uint8Array(poolW * 16 * 4);
    // tile 0: all index 5; tile 1: all index 9 (pool is 1 col x 2 rows)
    for (let i = 0; i < 64; i++) {
      rgba[i * 4] = 5;
      rgba[i * 4 + 3] = 255;
    }
    for (let i = 64; i < 128; i++) {
      rgba[i * 4] = 9;
      rgba[i * 4 + 3] = 255;
    }
    const pool = extractPoolIndices(rgba, poolW, 16);
    const f = {
      viewport: { w: 1, h: 1 },
      tileSize: 8,
      poolAtlas: 'x.png',
      poolCols: 1,
      pieces: {
        '0x0002': { x: 0, y: 0, w: 1, h: 1, cells: [0], alpha: [0] },
        '0x0004': { x: 0, y: 0, w: 1, h: 1, cells: [1], alpha: [0] },
      },
    } as unknown as ViewPiecesFile;
    const palette = Array.from({ length: 16 }, (_, i) => ({ r: i, g: i, b: i }));
    const { rgba: out } = compositeSnesView(f, pool, poolW, palette, [0x0002, 0x0004]);
    // First word (tile 0, index 5) claimed the cell opaquely; the second must not overwrite.
    expect(out[0]).toBe(5);
  });
});
