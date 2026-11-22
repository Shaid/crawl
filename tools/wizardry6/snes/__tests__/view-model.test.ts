/**
 * SNES W6 view-model unit tests (v5, `data-structure.md` §3.14.13). These
 * pin the pure helpers on synthetic windows; parity with the game itself is
 * `oracle-parity.test.ts` (ROM-driven, skips without the ROM).
 *
 * The v2-v4 "golden" fixture that used to live here came from a Python
 * re-implementation of the same reading of the disassembly, so it could
 * only show the walker agreeing with itself -- it is gone (§3.14.13
 * correction 2).
 */
import { describe, it, expect } from 'vitest';
import {
  wallForFacing,
  featureOf,
  windowCell,
  inCentreRegion,
  canStepWindow,
  extractPoolIndices,
  compositeSnesView,
  type MazeWindow,
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
    expect(featureOf(0x4e).feature).toBe(0);
  });
  it('passes through a real feature code and splits orientation', () => {
    expect(featureOf((2 << 4) | 6)).toEqual({ feature: 6, orient: 2 });
  });
});

function emptyWindow(): MazeWindow {
  return {
    level: 0,
    region: 0,
    be: 0,
    originX: 100,
    originY: 200,
    wall: new Uint8Array(576),
    feature: new Uint8Array(576).fill(0x0d),
    variant: new Uint8Array(576),
    dbc0: new Uint8Array(576),
  };
}

describe('window geometry ($80:C6DA, $80:D039)', () => {
  const w = emptyWindow();
  it('puts the centre-region origin at row 15, col 8 and +Y one row up', () => {
    expect(windowCell(w, 100, 200)).toBe(15 * 24 + 8);
    expect(windowCell(w, 100, 201)).toBe(14 * 24 + 8);
    expect(windowCell(w, 101, 200)).toBe(15 * 24 + 9);
  });
  it('keeps the window only inside its 8x8 centre region on its own level', () => {
    expect(inCentreRegion(w, 0, 107, 207)).toBe(true);
    expect(inCentreRegion(w, 0, 108, 207)).toBe(false);
    expect(inCentreRegion(w, 0, 100, 199)).toBe(false);
    expect(inCentreRegion(w, 1, 100, 200)).toBe(false);
  });
});

describe('canStepWindow ($80:C40B)', () => {
  // only the tables the decision reads
  const c685 = [0x80, 0x80, 0x01, 0x02, 0x81, 0x81, 0x01, 0x01, 0x01, 0x80, 0x04, 0x01, 0x01, 0x01, 0x01, 0x01];
  const f = {
    tables: { d700: [-1, -24, 1, 24, -1, -24], c685, de1b: new Array(16).fill(0), de2c: new Array(16).fill(0) },
    doorWord: 0x2e8,
  } as unknown as ViewPiecesFile;
  it('passes wall values 0 (open) and 1 (doorway) and blocks 2/3', () => {
    const w = emptyWindow();
    const c = windowCell(w, 100, 200);
    w.wall[c] = 0b11_10_01_00; // N open, E doorway, S wall, W door
    expect(canStepWindow(f, w, 100, 200, 0, 0)).toBe(true);
    expect(canStepWindow(f, w, 100, 200, 0, 1)).toBe(true);
    expect(canStepWindow(f, w, 100, 200, 0, 2)).toBe(false);
    expect(canStepWindow(f, w, 100, 200, 0, 3)).toBe(false);
  });
  it('refuses a (feature & 0xC0) == 0x40 stairs/pit cell but not 0x4E', () => {
    const w = emptyWindow();
    w.feature[windowCell(w, 100, 201)] = 0x41;
    expect(canStepWindow(f, w, 100, 200, 0, 0)).toBe(false);
    w.feature[windowCell(w, 100, 201)] = 0x4e;
    expect(canStepWindow(f, w, 100, 200, 0, 0)).toBe(true);
  });
  it('uses the promoted feature code for the edge the feature faces', () => {
    const w = emptyWindow();
    const c = windowCell(w, 100, 200);
    w.feature[c] = (0 << 4) | 7; // feature 7 facing N -> code 10 -> C685 0x04: blocked
    expect(canStepWindow(f, w, 100, 200, 0, 0)).toBe(false);
    expect(canStepWindow(f, w, 100, 200, 0, 1)).toBe(true); // E edge unaffected
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
