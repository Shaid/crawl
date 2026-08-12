/**
 * M6 (`dungeon-walker-m6-wiring`): the package-driven W6 render is a
 * faithful implementation of the game's documented compose-list formulas.
 *
 * Two levels of test:
 *
 * 1. **Pure dispatch mapping and visibility** (no real data):
 *    `buildViewItems` maps a cell's wall-type dispatch (from `EvalCellFace`)
 *    to `slots.json` keys — dispatch 0 = open -> nothing, 2 = wall, 5 = door
 *    at the front, plain-wall fallback for every other value — routing the
 *    perpendicular faces to `wall-side` and the lateral neighbours' forward
 *    faces to `wall-lat`, and applies the game's per-depth visibility lanes
 *    so occluded geometry is never emitted.
 *
 *    This is the only layer that can catch a *gating* bug. Level 2 below
 *    calls `buildViewItems` itself to build its "reference", so it verifies
 *    the raster path but is blind to which cells get walls.
 *
 * 2. **Real-data oracle** (skips when the game data / generated assets are
 *    absent): renders a pose through `@seer-project/dungeon` (indexed atlas
 *    + `compositeDrawList` + `slots.json`) and asserts it is pixel-for-pixel
 *    identical to a reference composite that blits the same pieces straight
 *    from `mazedata.ega`'s decoded indices using `data-structure.md` §4.4's
 *    formula (`source = offset + srcClip`, `dest = (destXByte + srcClip)*8`,
 *    mirror via `IndexedSurface.blit`'s `mirrorX`, `blend: 'or'`). The
 *    reference is the documented ground truth, so a match proves the whole
 *    package path — `fromIndexedRGBA`'s index recovery, the `or` blend, the
 *    atlas-absolute `srcX`/`srcW` crops (which honour `srcClip`), mirroring,
 *    and placement — reproduces the game.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexedSurface } from '@seer-project/dungeon';
import { readBinary } from '@seer-project/pipeline';
import { decodeDirRecord, parseMazeData, type MazeData } from '../decode-maze.ts';
import { buildViewItems } from '../view-model.ts';
import { loadIndexedBank, loadSlots, renderThroughDungeon } from '../render-through-dungeon.ts';
import type { CellPlanes } from '../evaluate-cell.ts';
import type { SlotTableFile } from '@seer-project/dungeon/schema';

function makePlanes(overrides: Partial<CellPlanes> = {}): CellPlanes {
  return {
    width: 9,
    height: 9,
    wallA: new Array(81).fill(0),
    wallB: new Array(81).fill(0),
    feature: new Array(81).fill(0),
    orient: new Array(81).fill(0),
    ...overrides,
  };
}

/** Minimal slot table with just enough wall/door keys for the dispatch-mapping test. Every key gets a distinct frame name so a test can identify which slot produced an item. */
function minimalSlots(): SlotTableFile {
  const slot = (frame: string, destX: number, destY: number) => ({
    draws: [{ bank: 'mazedata', frame, destX, destY, blend: 'or' as const }],
  });
  const slots: Record<string, unknown> = {};
  for (let d = 0; d < 3; d++) {
    slots[`wall:front:${d}`] = slot(`front${d}`, 104, 40);
    slots[`door:front:${d}`] = slot(`door${d}`, 104, 40);
    slots[`wall-side:L:${d}`] = slot(`sideL${d}`, 72, 40);
    slots[`wall-side:R:${d}`] = slot(`sideR${d}`, 216, 40);
    for (const v of ['partial', 'door', 'feat7', 'feat10', 'extra3', 'extra4']) {
      slots[`wall-side-${v}:L:${d}`] = slot(`side_${v}_L${d}`, 72, 40);
      slots[`wall-side-${v}:R:${d}`] = slot(`side_${v}_R${d}`, 216, 40);
    }
    slots[`wall-lat:L1:${d}`] = slot(`latL1_${d}`, 72, 40);
    slots[`wall-lat:L2:${d}`] = slot(`latL2_${d}`, 104, 40);
    slots[`wall-lat:R1:${d}`] = slot(`latR1_${d}`, 192, 40);
    slots[`wall-lat:R2:${d}`] = slot(`latR2_${d}`, 216, 40);
  }
  return {
    schemaVersion: 1,
    surface: { width: 320, height: 200 },
    viewport: { x: 72, y: 32, width: 176, height: 112 },
    depthCount: 3,
    lateralOffsets: [-1, 0, 1],
    frontWallMaxDepth: 3,
    banks: [],
    slots: slots as SlotTableFile['slots'],
    ordering: 'painter-back-to-front',
  };
}

describe('buildViewItems: wall-type dispatch -> slots.json keys', () => {
  const slots = minimalSlots();
  /** Every emitted item's frame name, which identifies the slot it came from. */
  const frames = (planes: CellPlanes, x = 4, y = 4, facing = 0) =>
    buildViewItems(planes, x, y, facing, slots).map((i) => i.frame as string);
  const at = (x: number, y: number) => x + y * 9;

  it('emits no wall items for a fully open corridor', () => {
    expect(frames(makePlanes())).toEqual([]);
  });

  it('emits the front wall at the blocked depth for dispatch 2, and nothing beyond', () => {
    // Wall straight ahead two squares: (4, 6) has wallA=2 on facing 0 (+Y).
    const wallA = new Array(81).fill(0);
    wallA[at(4, 6)] = 2;
    expect(frames(makePlanes({ wallA }))).toEqual(['front2']);
  });

  it('maps dispatch 5 (door) to the door slot at the front only', () => {
    // Door straight ahead at depth 1: feature 1 + facing==orient -> dispatch 5.
    const feature = new Array(81).fill(0);
    feature[at(4, 5)] = 1; // closed-door feature code
    const orient = new Array(81).fill(0);
    orient[at(4, 5)] = 0; // facing 0 == orient, so the feature dispatch runs
    expect(frames(makePlanes({ feature, orient }))).toEqual(['door1']);
  });

  // ── the two evaluators feed different slots ──────────────────────────
  // The receding side wall is the *perpendicular* edge beside the party
  // (`0x969a`/`0x9876`); the lateral column faces are the neighbour cell's
  // own *forward* face (`0x9202` at lateral ±1). Conflating them was the
  // original bug, so each must be provable in isolation.

  it('routes a perpendicular right-hand wall to wall-side, not wall-lat', () => {
    // facing 0, so the party's right-hand edge at (4,4) is its own wallB.
    const wallB = new Array(81).fill(0);
    wallB[at(4, 4)] = 2;
    expect(frames(makePlanes({ wallB }))).toEqual(['sideR0']);
  });

  // ── LAB_0506's per-code side-wall dispatch (`data-structure.md` §4.7.6.2) ──

  it('routes perpendicular code 3 to wall-side-partial + wall-side-extra3, but not the wall-side preamble', () => {
    // Raw wall value 3 (not a feature dispatch): 3 < 7 so the preamble
    // condition (code==2 || code>=7) does not fire. facing 0's right
    // perpendicular direction is its own wallB.
    const wallB = new Array(81).fill(0);
    wallB[at(4, 4)] = 3;
    expect(frames(makePlanes({ wallB }))).toEqual(['side_partial_R0', 'side_extra3_R0']);
  });

  it('routes perpendicular code 5 (door, feature 1) to wall-side-door only', () => {
    // facing 0's left perpendicular direction is west (3); feature dispatch
    // fires when that direction equals the cell's own orient.
    const feature = new Array(81).fill(0);
    feature[at(4, 4)] = 1;
    const orient = new Array(81).fill(0);
    orient[at(4, 4)] = 3;
    expect(frames(makePlanes({ feature, orient }))).toEqual(['side_door_L0']);
  });

  it('routes perpendicular code 7 (feature 8) to both wall-side and wall-side-feat7', () => {
    // code>=7 fires the preamble AND the jump table's code-7 entry.
    const feature = new Array(81).fill(0);
    feature[at(4, 4)] = 8;
    const orient = new Array(81).fill(0);
    orient[at(4, 4)] = 3;
    expect(frames(makePlanes({ feature, orient }))).toEqual(['sideL0', 'side_feat7_L0']);
  });

  it('routes a right-hand neighbour\'s forward face to wall-lat, not wall-side', () => {
    // The cell to the party's right, (5,4), has a wall on its own +Y side.
    const wallA = new Array(81).fill(0);
    wallA[at(5, 4)] = 2;
    expect(frames(makePlanes({ wallA }))).toEqual(['latR1_0', 'latR2_0']);
  });

  it('routes a perpendicular left-hand wall to wall-side (the x-1 neighbour\'s wallB)', () => {
    const wallB = new Array(81).fill(0);
    wallB[at(3, 4)] = 2;
    expect(frames(makePlanes({ wallB }))).toEqual(['sideL0']);
  });

  // ── visibility lanes ─────────────────────────────────────────────────

  it('does not emit anything behind a solid front wall', () => {
    // Walls straight ahead at all three depths. Without the `-11432(A4)`
    // lane the depth-1 and depth-2 fronts would still be emitted — and,
    // because every W6 piece blits with `blend: 'or'`, they would bleed
    // through the depth-0 wall rather than being painted over.
    const wallA = new Array(81).fill(0);
    wallA[at(4, 4)] = 2;
    wallA[at(4, 5)] = 2;
    wallA[at(4, 6)] = 2;
    expect(frames(makePlanes({ wallA }))).toEqual(['front0']);
  });

  it('keeps the outer column visible one depth past a front wall, but not the inner one', () => {
    // `LAB_0538` clears the inner-left lane (`-11416`) at depth+1 but the
    // outer-left lane (`-11424`) only at depth+2 — the depth-0 front wall
    // (compose[0], x 104..216) does not span the full 72..248 viewport, so
    // the outer column is still visible beside it.
    const wallA = new Array(81).fill(0);
    wallA[at(4, 4)] = 2; // front wall at depth 0
    wallA[at(3, 5)] = 2; // left neighbour's forward face at depth 1
    expect(frames(makePlanes({ wallA }))).toEqual(['front0', 'latL1_1']);
  });

  it('a perpendicular side wall hides the inner column at its own depth', () => {
    // `LAB_053B` clears `-11416`[depth] — same depth, and it runs *between*
    // the side-wall draw and the column draws, so ordering is load-bearing.
    const wallB = new Array(81).fill(0);
    wallB[at(3, 4)] = 2; // perpendicular wall on the party's left at depth 0
    const wallA = new Array(81).fill(0);
    wallA[at(3, 4)] = 2; // that same neighbour's forward face
    const emitted = frames(makePlanes({ wallA, wallB }));
    expect(emitted).toContain('sideL0');
    expect(emitted).toContain('latL1_0'); // outer lane still open at depth 0
    expect(emitted).not.toContain('latL2_0'); // inner lane cleared by LAB_053B
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Real-data oracle: package path vs the documented compose-list formula.
// ─────────────────────────────────────────────────────────────────────────

const DATA_DIR = resolve('data/wizardry6/amiga');
const hasRealData = () =>
  existsSync(resolve(DATA_DIR, 'mazedata.ega')) &&
  existsSync(resolve('public/assets/wizardry6/amiga/maps/mazedata-indexed.png')) &&
  existsSync(resolve('public/assets/wizardry6/amiga/dungeon/slots.json'));

function loadMazeAndFrames(): { mazeData: Uint8Array; maze: MazeData; frames: Record<string, { x: number; y: number }> } {
  const mazeData = readBinary(resolve(DATA_DIR, 'mazedata.ega'));
  const maze = parseMazeData(mazeData);
  const atlas = JSON.parse(
    readFileSync(resolve('public/assets/wizardry6/amiga/maps/mazedata-indexed.json'), 'utf8'),
  ) as { frames: Array<{ name: string; x: number; y: number }> };
  const frames: Record<string, { x: number; y: number }> = {};
  for (const f of atlas.frames) frames[f.name] = f;
  return { mazeData, maze, frames };
}

function referenceComposite(
  mazeData: Uint8Array,
  maze: MazeData,
  frames: Record<string, { x: number; y: number }>,
  planes: CellPlanes,
  x: number,
  y: number,
  facing: number,
  slots: SlotTableFile,
): IndexedSurface {
  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  surface.clear(0);
  const blitDraw = (d: { frame: unknown; srcX?: number; srcY?: number; srcW?: number; srcH?: number; destX: number; destY: number; mirrorX?: boolean; blend: 'or' | 'replace' | 'mask' }) => {
    const frameName = d.frame as string;
    const dirIndex = Number(frameName.slice('mazedata_dir'.length));
    const rec = maze.dirRecords[dirIndex]!;
    const indices = decodeDirRecord(mazeData, rec);
    const frame = frames[frameName]!;
    // §4.4: source = offset + srcClip; dest = (destXByte + srcClip)*8. The
    // slot's srcX/srcY are atlas-absolute; subtract the frame origin to get
    // the frame-relative crop the reference decodes.
    surface.blit(
      { data: indices, width: rec.widthPx, height: rec.heightPx },
      (d.srcX ?? frame.x) - frame.x,
      (d.srcY ?? 0) - frame.y,
      d.srcW ?? rec.widthPx,
      d.srcH ?? rec.heightPx,
      d.destX,
      d.destY,
      d.mirrorX ?? false,
      d.blend,
    );
  };
  for (const staticSlot of slots.staticSlots ?? []) for (const draw of staticSlot.draws) blitDraw(draw);
  for (const item of buildViewItems(planes, x, y, facing, slots)) blitDraw(item);
  return surface;
}

function loadRealPlanes(levelFile: string): CellPlanes {
  const level = JSON.parse(readFileSync(resolve('public/assets/wizardry6/amiga/dungeon', levelFile), 'utf8'));
  const unit = level.units[0];
  return {
    width: level.cellSpace.width,
    height: level.cellSpace.height,
    wallA: unit.planes.wallA,
    wallB: unit.planes.wallB,
    feature: unit.planes.feature,
    orient: unit.planes.orient,
  };
}

const POSES = [
  { level: 'level00.json', x: 1, y: 1, facing: 0 },
  { level: 'level05.json', x: 8, y: 1, facing: 1 },
  { level: 'level10.json', x: 8, y: 1, facing: 0 },
];

describe('render-through-dungeon vs the documented compose-list formula (real data)', () => {
  const available = hasRealData();
  const itOrSkip = available ? it : it.skip;

  for (const { level, x, y, facing } of POSES) {
    itOrSkip(`pose (${x},${y}) f${facing} on ${level} is pixel-identical to a §4.4 reference composite`, () => {
      const { mazeData, maze, frames } = loadMazeAndFrames();
      const planes = loadRealPlanes(level);
      const slots = loadSlots();
      const bank = loadIndexedBank();

      const throughPackage = renderThroughDungeon(planes, x, y, facing, slots, bank);
      const reference = referenceComposite(mazeData, maze, frames, planes, x, y, facing, slots);

      expect(throughPackage.width).toBe(reference.width);
      expect(throughPackage.height).toBe(reference.height);
      expect(Array.from(throughPackage.data)).toEqual(Array.from(reference.data));
    });
  }

  itOrSkip('every surface index is a real 4bpp palette index (0-15) and something was drawn', () => {
    const slots = loadSlots();
    const bank = loadIndexedBank();
    const planes = loadRealPlanes('level00.json');
    const surface = renderThroughDungeon(planes, 1, 1, 0, slots, bank);
    const drawn = Array.from(surface.data).filter((v) => v !== 0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(Math.max(...drawn)).toBeLessThanOrEqual(15);
  });
});
