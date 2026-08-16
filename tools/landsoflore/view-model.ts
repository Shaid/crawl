/**
 * Lands of Lore pose -> screen-position dispatch. The `.CMZ` grid format
 * and the 25-slot render geometry (`WALL_RENDER_SLOTS`/`CELL_OFFSETS`) are
 * both confirmed engine-shared with EOB (`decode-maze.ts`/`decode-vmp.ts`'s
 * module docs), so this reuses `tools/eotb/view-model.ts`'s rotation
 * dispatch directly -- including its documented facing 1-3 caveat.
 *
 * The one real LOL-specific piece: `resolveRawWallType` uses the level's
 * own `.WLL` sparse lookup (`decode-wll.ts`'s `buildWllLookup`) to
 * translate a raw `.CMZ` byte to the wall set's real `vmpMapValue`,
 * instead of EOB's cruder "pass 0-6 through, clamp anything else"
 * approximation -- LOL's WLL table turned out to be exactly the oracle
 * EOB1's own still-open `wallMappingIndex` question needed (see
 * `decode-wll.ts`'s module doc). The clamp is kept only as a fallback for
 * a raw byte absent from a level's own WLL table (not observed in this
 * corpus, but a level whose WLL wasn't decoded/passed falls back to it
 * entirely).
 */
import { rotateOffset, roleSide, type Facing } from '../eotb/view-model.ts';
import { wallTypeAt, type MazeData } from './decode-maze.ts';
import { CELL_OFFSETS, WALL_RENDER_SLOTS, type WallRenderSlot } from './decode-vmp.ts';

export { rotateOffset, roleSide, type Facing };

const SIDE_ROLE: Record<string, 'left' | 'right' | 'front'> = { east: 'left', west: 'right', south: 'front' };

export interface ResolvedSlot {
  slot: WallRenderSlot;
  wallType: number; // 0 = no wall (skip), 1..maxWallType = wall
}

/** See module doc: real WLL lookup first, clamp fallback second. */
function resolveRawWallType(raw: number, maxWallType: number, wllLookup: Map<number, number> | undefined): number {
  if (raw === 0) return 0;
  const mapped = wllLookup?.get(raw);
  if (mapped !== undefined) return Math.max(0, Math.min(mapped, maxWallType));
  return raw <= maxWallType ? raw : 1;
}

/** Resolve all 25 wall-render slots' wallType for a pose. `wllLookup` (from `buildWllLookup`) is optional -- omitting it falls back to EOB's plain clamp for every raw byte. */
export function resolveWallTypes(
  maze: MazeData,
  x: number,
  y: number,
  facing: Facing,
  maxWallType: number,
  wllLookup?: Map<number, number>,
): ResolvedSlot[] {
  return WALL_RENDER_SLOTS.map((slot) => {
    const [cellLetter, sideSuffix] = slot.label.split('-') as [string, string];
    const [dxRel, dyRel] = CELL_OFFSETS[cellLetter]!;
    const [dx, dy] = rotateOffset(dxRel, dyRel, facing);
    const role = SIDE_ROLE[sideSuffix]!;
    const side = roleSide(role, facing);
    const wallType = resolveRawWallType(wallTypeAt(maze, x + dx, y + dy, side), maxWallType, wllLookup);
    return { slot, wallType };
  });
}

/** Whether the party can step forward -- see `tools/eotb/view-model.ts`'s `canStepForward` doc for the derivation. */
export function canStepForward(maze: MazeData, x: number, y: number, facing: Facing): boolean {
  return wallTypeAt(maze, x, y, roleSide('front', facing)) === 0;
}
