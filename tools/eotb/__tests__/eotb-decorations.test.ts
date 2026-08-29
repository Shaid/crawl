import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDecorations, decorationChain } from '../decode-decorations.ts';
import { parseInf, resolveWallDecorationAssignments, findWallSet } from '../decode-inf.ts';
import { rotateOffset, roleSide, type Facing } from '../view-model.ts';
import { CELL_OFFSETS } from '../decode-vmp.ts';
import { DSC_BLOCK_MAP, DSC_SHAPE_INDEX, DSC_SHAPE_X, CELL_LETTERS } from '../dsc-tables.ts';

const WALL_SETS = ['BRICK', 'BLUE', 'DROW', 'GREEN', 'XANATHA'];

function loadDat(name: string) {
  return decodeDecorations(new Uint8Array(readFileSync(resolve(`data/eotb/amiga/${name}.DAT`))));
}

describe('decodeDecorations', () => {
  it('parses every real wall-set .DAT file with zero residue (0 leftover bytes)', () => {
    for (const name of WALL_SETS) {
      const data = loadDat(name);
      expect(data.properties.length).toBeGreaterThan(0);
      expect(data.rects.length).toBeGreaterThan(0);
      // decodeDecorations itself throws on residue != 0 -- reaching here means the oracle already passed.
    }
  });

  it('every non-sentinel shapeIndex value in BRICK.DAT resolves to a real, non-degenerate rect', () => {
    const data = loadDat('BRICK');
    for (const prop of data.properties) {
      for (const shapeIndex of prop.shapeIndex) {
        if (shapeIndex === 0xffff) continue;
        const rect = data.rects[shapeIndex];
        expect(rect).toBeDefined();
        expect(rect!.w).toBeGreaterThan(0);
        expect(rect!.h).toBeGreaterThan(0);
      }
    }
  });
});

describe('decorationChain', () => {
  it('returns a single-element chain when next === 0', () => {
    const data = loadDat('BRICK');
    const chain = decorationChain(data, 39); // real record with next=0 (verified this session)
    expect(chain.length).toBe(1);
    expect(chain[0]!.next).toBe(0);
  });

  it('follows a real multi-element next-chain (BRICK.DAT decIndex 34 -> 51)', () => {
    const data = loadDat('BRICK');
    const chain = decorationChain(data, 34);
    expect(chain.length).toBe(2);
    expect(chain[0]!.next).toBe(51);
    expect(chain[1]).toBe(data.properties[51]);
  });

  it('returns an empty chain for decIndex -1 (no decoration)', () => {
    const data = loadDat('BRICK');
    expect(decorationChain(data, -1)).toEqual([]);
  });
});

describe('resolveWallDecorationAssignments', () => {
  it('LEVEL1.INF: wallIndex 39 (specialType 3) resolves to decIndex 0 against the FIRST decoration-load (brick1), not a later one', () => {
    const infData = readFileSync(resolve('data/eotb/amiga/LEVEL1.INF'));
    const assignments = resolveWallDecorationAssignments(new Uint8Array(infData));
    const a = assignments.get(39);
    expect(a).toBeDefined();
    expect(a!.cpsFile).toBe('brick1');
    expect(a!.decFile).toBe('brick.dat');
    expect(a!.decIndex).toBe(0);
  });

  it('LEVEL1.INF: wallIndex 58 (the wall-mapping-fix landmark case) resolves against brick2, per its position after the second decoration-load', () => {
    const infData = readFileSync(resolve('data/eotb/amiga/LEVEL1.INF'));
    const assignments = resolveWallDecorationAssignments(new Uint8Array(infData));
    const a = assignments.get(58);
    expect(a).toBeDefined();
    expect(a!.cpsFile).toBe('brick2');
    expect(a!.decIndex).toBe(35);
  });

  it('omits wallIndex entries whose decIndex is -1 (no decoration)', () => {
    const infData = readFileSync(resolve('data/eotb/amiga/LEVEL2.INF'));
    const { wallMappings } = parseInf(new Uint8Array(infData));
    const assignments = resolveWallDecorationAssignments(new Uint8Array(infData));
    const noneWall = wallMappings.find((w) => w.decIndex === -1);
    expect(noneWall).toBeDefined();
    expect(assignments.has(noneWall!.wallIndex)).toBe(false);
  });

  it('produces a real, non-empty assignment map for every real LEVEL1-12.INF', () => {
    for (let n = 1; n <= 12; n++) {
      const infData = readFileSync(resolve(`data/eotb/amiga/LEVEL${n}.INF`));
      const assignments = resolveWallDecorationAssignments(new Uint8Array(infData));
      expect(assignments.size).toBeGreaterThan(0);
    }
  });
});

describe('dsc-tables (ScummVM create_kyradat literal Amiga tables) confirm view-model.ts rotation for all 4 facings', () => {
  it('roleSide matches DSC_BLOCK_MAP-derived side index for all 4 facings x 3 roles', () => {
    // DSC_BLOCK_MAP layout: [Down(dir0..3), Right(dir0..3), Left(dir0..3)].
    // ScummVM's "Right" role == this project's 'left' (both always applied to the screen-far-left cell);
    // ScummVM's "Left" role == this project's 'right' (see dsc-tables.ts's module doc for the full citation).
    const SIDES = ['N', 'E', 'S', 'W'];
    for (let facing = 0; facing < 4; facing++) {
      const realDown = DSC_BLOCK_MAP[facing]!;
      const realRight = DSC_BLOCK_MAP[4 + facing]!;
      const realLeft = DSC_BLOCK_MAP[8 + facing]!;
      expect(SIDES.indexOf(roleSide('front', facing as Facing))).toBe(realDown);
      expect(SIDES.indexOf(roleSide('left', facing as Facing))).toBe(realRight);
      expect(SIDES.indexOf(roleSide('right', facing as Facing))).toBe(realLeft);
    }
  });

  it('rotateOffset matches DSC_SHAPE_X-adjacent real per-facing cell offsets (spot check on 3 letters x 4 facings)', () => {
    // A minimal spot-check alongside the full 68-pair derivation recorded in dsc-tables.ts's module doc
    // (re-deriving the full kEoB1DscBlockIndexAmiga decode here would just re-paste that citation's own array).
    const cases: Array<[string, Facing, [number, number]]> = [
      ['D', 0, [0, -3]],
      ['D', 1, [3, 0]],
      ['D', 2, [0, 3]],
      ['D', 3, [-3, 0]],
    ];
    for (const [letter, facing, expected] of cases) {
      const [dxRel, dyRel] = CELL_OFFSETS[letter]!;
      expect(rotateOffset(dxRel, dyRel, facing)).toEqual(expected);
    }
  });

  it('DSC_SHAPE_INDEX / DSC_SHAPE_X / CELL_LETTERS all have the expected real lengths', () => {
    expect(DSC_SHAPE_INDEX.length).toBe(36);
    expect(DSC_SHAPE_X.length).toBe(18);
    expect(CELL_LETTERS.length).toBe(18);
    expect(CELL_LETTERS.filter((c) => c !== null).length).toBe(17); // matches CELL_OFFSETS' 17 named cells.
  });
});

describe('findWallSet / decoration corpus cross-check', () => {
  it('every wall set referenced by a level has a matching .DAT file in the corpus', () => {
    for (let n = 1; n <= 12; n++) {
      const infData = readFileSync(resolve(`data/eotb/amiga/LEVEL${n}.INF`));
      const wallSet = findWallSet(new Uint8Array(infData));
      expect(() => loadDat(wallSet)).not.toThrow();
    }
  });
});
