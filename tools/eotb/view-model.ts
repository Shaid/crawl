/**
 * Eye of the Beholder (Amiga) pose -> screen-position dispatch. The EOB
 * analog of `tools/wizardry6/view-model.ts`'s `buildViewItems`, but
 * feeding a bespoke compositor (`render-through-dungeon.ts`) instead of
 * `@seer-project/dungeon`'s `SlotTableFile`/`compositeDrawList` -- see
 * that file's module doc for why the fit stops at the raster primitives
 * (`IndexedSurface`/`PieceBank`) and doesn't reach the slot-key schema.
 *
 * Rotation: `docs/eotb/amiga/eotb-vmp-spec.md`'s `wallRenderData` table
 * and its 25 slot labels (`decode-vmp.ts`'s `WALL_RENDER_SLOTS`) are
 * diagrammed for a party facing compass-North only, where a label's
 * suffix (`-east`/`-west`/`-south`) is treated here as an arbitrary axis
 * label for facing North specifically (east=left, west=right,
 * south=front) -- **not** claimed to match real-world compass semantics,
 * since the `.MAZ` format's own N/E/S/W byte order has no independently
 * confirmed dx/dy convention behind it (no disassembly, no real
 * screenshot to check against this session).
 *
 * For any other facing, both (a) the cell offset diagram
 * (`rotateOffset`) and (b) which side-byte each role reads
 * (`roleSide`) are rotated by the SAME number of steps, in the same
 * rotational sense (`DIRS[(baseIndex(role) + facing) % 4]`) -- internally
 * self-consistent (facing 0-3 forms a clean 4-cycle, `canStepForward`
 * derives from the identical `roleSide('front', ...)` so the "can I walk
 * forward" check and "what wall is rendered ahead" can never disagree),
 * but **the absolute correctness of facings 1-3 is unverified** -- there
 * is no oracle in this corpus to check it against. If a future session
 * finds real disassembly or a screenshot showing e.g. a level's west-
 * facing view, that's the thing to check this rotation against.
 */
import { decodeMaze, wallTypeAt, type MazeData, type Side } from './decode-maze.ts';
import { CELL_OFFSETS, WALL_RENDER_SLOTS, type WallRenderSlot } from './decode-vmp.ts';

export { decodeMaze };
export type Facing = 0 | 1 | 2 | 3; // 0=N, 1=E, 2=S, 3=W
const DIRS: Side[] = ['N', 'E', 'S', 'W'];

/** Rotate a facing-North-relative (dxRel, dyRel) offset (dyRel negative = forward) into an absolute grid delta for `facing`. Normalises -0 to 0 so callers/tests get plain integers. */
export function rotateOffset(dxRel: number, dyRel: number, facing: Facing): [number, number] {
  const norm = (n: number) => (n === 0 ? 0 : n);
  switch (facing) {
    case 0: return [norm(dxRel), norm(dyRel)];
    case 1: return [norm(-dyRel), norm(dxRel)];
    case 2: return [norm(-dxRel), norm(-dyRel)];
    case 3: return [norm(dyRel), norm(-dxRel)];
  }
}

const SIDE_ROLE: Record<string, 'left' | 'right' | 'front'> = { east: 'left', west: 'right', south: 'front' };
const ROLE_BASE_INDEX: Record<'left' | 'right' | 'front', number> = { left: 1 /* E */, right: 3 /* W */, front: 2 /* S */ };

/** Which absolute `.MAZ` side-byte a screen role (left/right/front) reads at a given facing -- see module doc for the rotation-consistency rationale and its unverified-for-facing!=0 caveat. */
export function roleSide(role: 'left' | 'right' | 'front', facing: Facing): Side {
  return DIRS[(ROLE_BASE_INDEX[role] + facing) % 4]!;
}

export interface ResolvedSlot {
  slot: WallRenderSlot;
  wallType: number; // 0-6, 0 = no wall (skip)
}

/**
 * Map a raw `.MAZ` per-side byte to a VMP wallType (0-6).
 *
 * **Not the real mechanism -- a documented, bounded approximation.**
 * Empirically (this session, real `LEVEL1.MAZ` data), the raw byte is
 * NOT always a direct 0-6 wallType: most of the corpus is clean 0/1/2
 * (open/solid-type-1/solid-type-2), but some cells carry much larger
 * values (58, 62, ... seen in `data/eotb/amiga/LEVEL1.MAZ` at (16,16)).
 *
 * **The real mechanism is now identified (2026-08-16 follow-up, ScummVM
 * source), just not implemented yet.** `engines/kyra/engine/scene_eob.cpp`
 * (`EoBCoreEngine::initLevelData`/`resetWallData`/`assignWallsAndDecorations`,
 * shared by EOB1 and EOB2) confirms `docs/eotb/amiga/eotb-inf-spec.md`'s
 * `WallMapping`/`0xFB` hypothesis: `resetWallData()` seeds a default
 * wallType->vmpRunIndex table (`{1:1, 2:2, 3..22:3, 23:4, 24:5}`, else 0),
 * and each level's `.INF` decoration-command stream can override entries
 * via a 5-byte record `[wallIndex][vmpIndex][decIndex][specialType][flags]`.
 * **Why this clamp is still here rather than a real lookup**: reaching
 * that record stream requires sequentially replicating everything
 * `initLevelData` reads before it (door-shape params, script timers,
 * monster-shape loads, `loadActiveMonsterData`), and a first attempt at
 * walking this by hand against real `LEVEL1.INF` bytes drifted out of
 * alignment with known string anchors ("kobold\0"/"leech\0", the
 * monster-shape filenames) partway through -- most likely the Amiga
 * port's on-disk layout diverges from ScummVM's DOS-oriented reads the
 * same way `mazStem`/`wallSetStem` already do (see `decode-inf.ts`'s own
 * module doc). Shipping a guessed offset table risked silently mis-mapped
 * wall art, so this is left as real follow-on work (full details and the
 * exact struct/function citations: `docs/eotb/TODO.md`
 * `eotb1-amiga-walker-wallmapping`) -- either trace the Amiga executable's
 * own disassembly (a more reliable oracle for Amiga-specific layout than
 * DOS-oriented ScummVM source) or carefully re-verify each intervening
 * field against real file bytes one at a time. Until then: pass 0-6
 * through unchanged (the common case, verified clean over most of the
 * corpus), clamp anything else to 1 (generic solid wall) so doors/
 * stairs/decorated cells still render as *a* wall (correct topology,
 * approximate art) instead of a decode error or nonsense tile index.
 */
function clampWallType(raw: number): number {
  return raw <= 6 ? raw : 1;
}

/** Resolve all 25 wall-render slots' wallType for a pose. */
export function resolveWallTypes(maze: MazeData, x: number, y: number, facing: Facing): ResolvedSlot[] {
  return WALL_RENDER_SLOTS.map((slot) => {
    const [cellLetter, sideSuffix] = slot.label.split('-') as [string, string];
    const [dxRel, dyRel] = CELL_OFFSETS[cellLetter]!;
    const [dx, dy] = rotateOffset(dxRel, dyRel, facing);
    const role = SIDE_ROLE[sideSuffix]!;
    const side = roleSide(role, facing);
    const wallType = clampWallType(wallTypeAt(maze, x + dx, y + dy, side));
    return { slot, wallType };
  });
}

/**
 * Whether the party can step forward (cell ahead has no wall on the
 * *current* cell's front-facing side). Deliberately derived from the same
 * `roleSide('front', facing)` the renderer uses for the front wall
 * slots -- an earlier version queried `DIRS[facing]` directly, a second,
 * independent (and disagreeing) guess at which side is "front"; the two
 * could never have agreed except by coincidence, since nothing here is
 * independently confirmed for facing != 0 (see the module doc).
 */
export function canStepForward(maze: MazeData, x: number, y: number, facing: Facing): boolean {
  return wallTypeAt(maze, x, y, roleSide('front', facing)) === 0;
}
