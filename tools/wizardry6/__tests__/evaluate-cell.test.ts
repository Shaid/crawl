import { describe, expect, it } from 'vitest';
import { evalCellFace, stepForward, FEATURE_DISPATCH, type CellPlanes } from '../evaluate-cell.ts';

// 3x3 grid, index = y*width+x. Matches export-dungeon-levels.ts's own
// densified coordinate space and @seer-project/dungeon's Direction.ts
// convention (facing 0=N/+Y, 1=E/+X, 2=S/-Y, 3=W/-X).
function makePlanes(overrides: Partial<CellPlanes> = {}): CellPlanes {
  return {
    width: 3,
    height: 3,
    wallA: new Array(9).fill(0),
    wallB: new Array(9).fill(0),
    feature: new Array(9).fill(0),
    orient: new Array(9).fill(0),
    ...overrides,
  };
}

describe('stepForward', () => {
  it('steps by facing delta * depth, matching Direction.ts (N=+Y, E=+X, S=-Y, W=-X)', () => {
    expect(stepForward(1, 1, 0, 2)).toEqual({ x: 1, y: 3 }); // N
    expect(stepForward(1, 1, 1, 2)).toEqual({ x: 3, y: 1 }); // E
    expect(stepForward(1, 1, 2, 2)).toEqual({ x: 1, y: -1 }); // S
    expect(stepForward(1, 1, 3, 2)).toEqual({ x: -1, y: 1 }); // W
  });

  it('is a no-op at depth 0', () => {
    expect(stepForward(1, 1, 0, 0)).toEqual({ x: 1, y: 1 });
  });
});

describe('evalCellFace: direct wall reads (facing 0/1)', () => {
  it('facing 0 reads the cell\'s own wallA', () => {
    const wallA = new Array(9).fill(0);
    wallA[1 * 3 + 1] = 2; // (1,1)
    const planes = makePlanes({ wallA });
    expect(evalCellFace(planes, 1, 1, 0, 0)).toBe(2);
  });

  it('facing 1 reads the cell\'s own wallB', () => {
    const wallB = new Array(9).fill(0);
    wallB[1 * 3 + 1] = 3;
    const planes = makePlanes({ wallB });
    expect(evalCellFace(planes, 1, 1, 1, 0)).toBe(3);
  });
});

describe('evalCellFace: shared-edge neighbour reads (facing 2/3)', () => {
  it('facing 2 reads the (x,y-1) neighbour\'s wallA', () => {
    const wallA = new Array(9).fill(0);
    wallA[0 * 3 + 1] = 2; // (1,0)
    const planes = makePlanes({ wallA });
    expect(evalCellFace(planes, 1, 1, 2, 0)).toBe(2);
  });

  it('facing 3 reads the (x-1,y) neighbour\'s wallB', () => {
    const wallB = new Array(9).fill(0);
    wallB[1 * 3 + 0] = 3; // (0,1)
    const planes = makePlanes({ wallB });
    expect(evalCellFace(planes, 1, 1, 3, 0)).toBe(3);
  });

  it('returns 2 (solid) when the facing-2/3 neighbour falls off the grid', () => {
    const planes = makePlanes();
    expect(evalCellFace(planes, 1, 0, 2, 0)).toBe(2); // (1,0)'s S neighbour is (1,-1), off-grid
    expect(evalCellFace(planes, 0, 1, 3, 0)).toBe(2); // (0,1)'s W neighbour is (-1,1), off-grid
  });

  it('returns 2 (solid), not undefined, when (x,y) itself is off-grid and lateral is 0', () => {
    // Regression test: a real sweep across all 14 exported levels found 772
    // evaluations (of 356,832) returning `undefined` before this was fixed --
    // depth-stepping can genuinely land just past a densified level's own
    // tight bounding box, which the real game's much larger world would
    // never encounter, but this exporter's cropped levels can. Every one of
    // these 4 facings must be covered, not just facing 2/3's own neighbour
    // check (which only guards the *stepped* position, not the original one).
    const planes = makePlanes();
    expect(evalCellFace(planes, -1, 1, 0, 0)).toBe(2);
    expect(evalCellFace(planes, 3, 1, 1, 0)).toBe(2);
    expect(evalCellFace(planes, 1, -1, 2, 0)).toBe(2);
    expect(evalCellFace(planes, 1, 3, 3, 0)).toBe(2);
  });
});

describe('evalCellFace: lateral offset', () => {
  it('steps by lateral cells to the right of facing before evaluating', () => {
    const wallA = new Array(9).fill(0);
    wallA[1 * 3 + 2] = 2; // (2,1) -- one step right (facing 0's right = E) of (1,1)
    const planes = makePlanes({ wallA });
    expect(evalCellFace(planes, 1, 1, 0, 1)).toBe(2);
    expect(evalCellFace(planes, 1, 1, 0, -1)).toBe(0); // (0,1) is untouched
  });

  it('returns 2 (solid) when the lateral step itself falls off the grid', () => {
    const planes = makePlanes();
    expect(evalCellFace(planes, 0, 1, 0, -1)).toBe(2); // one step left of x=0 is off-grid
  });
});

describe('evalCellFace: feature dispatch', () => {
  it('feature 0 is a pure pass-through to the raw wall value, regardless of orient', () => {
    const wallA = new Array(9).fill(0);
    wallA[1 * 3 + 1] = 2;
    const planes = makePlanes({ wallA }); // feature/orient default to 0 everywhere
    expect(evalCellFace(planes, 1, 1, 0, 0)).toBe(2);
  });

  it('a non-zero feature does not dispatch when facing!=orient -- returns the raw wall value instead', () => {
    const feature = new Array(9).fill(0);
    const orient = new Array(9).fill(0);
    feature[1 * 3 + 1] = 1; // "closed door"
    orient[1 * 3 + 1] = 2; // orientation != facing 0
    const planes = makePlanes({ feature, orient });
    expect(evalCellFace(planes, 1, 1, 0, 0)).toBe(0); // facing(0) != orient(2) -> raw wall value (0), not the feature-1 dispatch (5)
  });

  it('dispatches feature 1 ("door") to 5 when facing==orient', () => {
    const feature = new Array(9).fill(0);
    const orient = new Array(9).fill(0);
    feature[1 * 3 + 1] = 1;
    orient[1 * 3 + 1] = 0;
    const planes = makePlanes({ feature, orient });
    expect(evalCellFace(planes, 1, 1, 0, 0)).toBe(5);
  });

  it('feature 6 always dispatches regardless of orient (per the corrected guard)', () => {
    const feature = new Array(9).fill(0);
    feature[1 * 3 + 1] = 6;
    const planes = makePlanes({ feature }); // orient defaults to 0, facing will be 2 (mismatched)
    expect(evalCellFace(planes, 1, 1, 2, 0)).toBe(0); // feature 6 stub leaves the raw wall value (0) unchanged
  });

  it('feature >= 0xd always dispatches regardless of orient (the corrected guard: >=0xd, not <=0xc)', () => {
    const feature = new Array(9).fill(0);
    feature[1 * 3 + 1] = 13;
    const planes = makePlanes({ feature });
    expect(evalCellFace(planes, 1, 1, 2, 0)).toBe(0); // feature 13 stub also leaves the wall value unchanged
  });

  it('every FEATURE_DISPATCH numeric entry matches the disassembly-confirmed table', () => {
    expect(FEATURE_DISPATCH).toEqual({
      0: 'wall',
      1: 5,
      2: 6,
      3: 8,
      4: 9,
      5: 14,
      6: 'wall',
      7: 4,
      8: 7,
      9: 10,
      10: 11,
      11: 12,
      12: 13,
      13: 'wall',
      14: 'wall',
      15: 'wall',
    });
  });
});
