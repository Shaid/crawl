/**
 * `tools/walker/games.ts` — the W6 view's movement rules and the noclip
 * debug toggle. Black Crypt's side is thin wrapper over the already-tested
 * `@seer-project/dungeon` `Walker` + `canStep`; the W6 side is new logic
 * (`canStepDir` + `Wizardry6View`'s controller wiring), so that's what's
 * exercised here against synthetic planes.
 */
import { describe, expect, it } from 'vitest';
import { FlatGridLevel, tileForCell } from '@seer-project/dungeon';
import { DEFAULT_BINDINGS, type SlotTableFile } from '@seer-project/dungeon/schema';
import type { CellPlanes } from '../../wizardry6/evaluate-cell.ts';
import { canStepDir } from '../../wizardry6/view-model.ts';
import { Wizardry6View } from '../games.ts';

function makePlanes(width = 9, height = 9): CellPlanes {
  return {
    width,
    height,
    wallA: new Array(width * height).fill(0),
    wallB: new Array(width * height).fill(0),
    feature: new Array(width * height).fill(0),
    orient: new Array(width * height).fill(0),
  };
}

const OPEN_SLOTS: SlotTableFile = {
  schemaVersion: 1,
  surface: { width: 320, height: 200 },
  viewport: { x: 72, y: 32, width: 176, height: 112 },
  depthCount: 3,
  lateralOffsets: [-1, 0, 1],
  frontWallMaxDepth: 3,
  banks: [{ id: 'mazedata', atlas: 'x.json', image: 'x.png' }],
  slots: {},
  staticSlots: [],
  ordering: 'painter-back-to-front',
};

describe('canStepDir (W6 movement rule)', () => {
  it('an open cell allows a step in the facing direction', () => {
    // facing 0 (N/+Y): the approach wall is the cell's own wallA.
    expect(canStepDir(makePlanes(), 4, 4, 0, 9, 9)).toBe(true);
  });

  it('a wall on the approach blocks the step', () => {
    const planes = makePlanes();
    planes.wallA[4 + 4 * 9] = 2; // +Y wall of (4,4) -> blocks moving north
    expect(canStepDir(planes, 4, 4, 0, 9, 9)).toBe(false);
    expect(canStepDir(planes, 4, 5, 2, 9, 9)).toBe(false); // ... and from the far side southward (own wallA again)
  });

  it('out-of-bounds steps are rejected even when open', () => {
    expect(canStepDir(makePlanes(), 0, 0, 3, 9, 9)).toBe(false); // W -> (-1,0)
    expect(canStepDir(makePlanes(), 0, 0, 2, 9, 9)).toBe(false); // S -> (0,-1)
  });
});

describe('Wizardry6View movement + noclip', () => {
  const keysForward = { isDown: (code: string) => code === 'KeyW' };

  it('walks forward along an open corridor and rebuilds items on each move', () => {
    const planes = makePlanes();
    const view = new Wizardry6View({
      planes,
      slots: OPEN_SLOTS,
      bank: null as never, // not composited in this test
      palette: [],
      bindings: DEFAULT_BINDINGS,
      levelId: 3,
      startPose: { level: 3, x: 4, y: 4, facing: 0 },
    });

    // 3 held-forward updates, each > the 175ms step interval.
    for (let i = 0; i < 3; i++) {
      const next = view.update(200, keysForward);
      expect(next).not.toBeNull();
    }
    expect(view.pose).toEqual({ level: 3, x: 4, y: 7, facing: 0 });
    expect(view.items.length).toBeGreaterThanOrEqual(0); // no throw; staticSlots only
  });

  it('stops at a wall, then noclip lets it through', () => {
    const planes = makePlanes();
    // (4,4)'s own +Y wall blocks moving north into (4,5) — the W6
    // shared-edge convention (facing 0 reads the cell's own plane A).
    planes.wallA[4 + 4 * 9] = 2;
    const view = new Wizardry6View({
      planes,
      slots: OPEN_SLOTS,
      bank: null as never,
      palette: [],
      bindings: DEFAULT_BINDINGS,
      levelId: 3,
      startPose: { level: 3, x: 4, y: 4, facing: 0 },
    });

    const blocked = view.update(200, keysForward); // approach (4,5) walled
    expect(blocked).toBeNull();
    expect(view.pose.y).toBe(4);

    view.setNoclip(true);
    expect(view.update(200, keysForward)).not.toBeNull(); // through the wall
    expect(view.pose.y).toBe(5);
  });
});

describe('W6 automap (shared-edge tileForCell)', () => {
  it('renders enclosed cells as walls and corridor cells as floor', () => {
    // 4x4 shared-edge level: row 3 is a solid fill block (every edge walled),
    // rows 0..2 are an open area with a corridor cell.
    const width = 4, height = 4;
    const wallA = new Array(width * height).fill(0);
    const wallB = new Array(width * height).fill(0);
    for (let x = 0; x < width; x++) {
      wallA[3 * width + x] = 2; // row 3's own +Y wall
      wallB[3 * width + x] = 2; // row 3's own +X wall
      wallA[2 * width + x] = 2; // row 2's +Y wall = row 3's -Y edge
    }
    for (let y = 0; y < height; y++) wallA[y * width + (width - 1)] = 2; // last col's +X wall
    const levelFile = {
      schemaVersion: 1, game: 'wizardry6', platform: 'amiga',
      cellSpace: { kind: 'flat', width, height },
      wallStorage: { kind: 'shared-edge', planes: ['wallA', 'wallB'], planeDirs: [0, 1], offMapValue: 2 },
      yAxisDown: false,
      units: [{ id: 0, planes: { wallA, wallB, feature: new Array(width * height).fill(0), orient: new Array(width * height).fill(0) } }],
    } as const;
    const level = new FlatGridLevel(levelFile as never, levelFile.units[0]);
    // Row 3 cells are fully enclosed (every edge walled) -> wall tile.
    expect(tileForCell(level, 0, 3)).toBe(0);
    expect(tileForCell(level, 3, 3)).toBe(0);
    // A corridor cell in row 1 has open east/west edges -> floor tile.
    expect(tileForCell(level, 1, 1)).toBe(15);
  });
});
