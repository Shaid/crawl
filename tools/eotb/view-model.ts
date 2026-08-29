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
 * Map a raw `.MAZ` per-side byte to a VMP wallType (0-6) via a level's
 * real `wallTypeMap` (`decode-inf.ts`'s `buildWallTypeMap`, a 256-entry
 * `rawWallIndex -> vmpIndex` table: `EoBCoreEngine::resetWallData`'s
 * default plus that level's `.INF` wall-mapping overrides).
 *
 * **This replaces a former clamp-based approximation** (raw > 6 ->
 * generic solid wall 1). That approximation's premise turned out to be
 * built on a bug, not a real DOS-vs-Amiga struct divergence: a previous
 * session's attempt to hand-derive the real mapping drifted out of
 * alignment because it never LCW-decompressed `.INF` in the first place
 * (see `decode-inf.ts`'s module doc for the full root-cause writeup and
 * citations) -- once real decompression is applied, the Amiga on-disk
 * layout matches ScummVM's own `gameID == GI_EOB1` / `platform ==
 * kPlatformAmiga` source branches exactly, byte for byte, over the whole
 * `LEVEL{1..11}.INF` corpus.
 */
function mapWallType(raw: number, wallTypeMap: Uint8Array): number {
  return wallTypeMap[raw & 0xff]!;
}

/**
 * Fallback table for callers that don't (yet) pass a real per-level
 * `wallTypeMap` -- reproduces the old clamp exactly (raw 0-6 pass
 * through, anything else -> generic solid wall 1). **EOB2**
 * (`tools/eotb2/view-model.ts`) re-exports `resolveWallTypes` from this
 * module and still relies on this default: EOB2's own `.INF`/wall-
 * mapping format is a separate, not-yet-verified decode (out of scope
 * for the EOB1 fix this default preserves compatibility for -- see
 * `docs/eotb/TODO.md`'s `eotb1-amiga-walker-wallmapping` row).
 */
const CLAMP_FALLBACK_WALL_TYPE_MAP: Uint8Array = (() => {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = i <= 6 ? i : 1;
  return map;
})();

/** Resolve all 25 wall-render slots' wallType for a pose, using `wallTypeMap` (`decode-inf.ts`'s `buildWallTypeMap`) to map each cell's raw `.MAZ` byte to a real VMP wallType. Omit `wallTypeMap` to fall back to the old raw-passthrough/clamp-to-1 behaviour (see `CLAMP_FALLBACK_WALL_TYPE_MAP`). */
export function resolveWallTypes(
  maze: MazeData,
  x: number,
  y: number,
  facing: Facing,
  wallTypeMap: Uint8Array = CLAMP_FALLBACK_WALL_TYPE_MAP,
): ResolvedSlot[] {
  return WALL_RENDER_SLOTS.map((slot) => {
    const [cellLetter, sideSuffix] = slot.label.split('-') as [string, string];
    const [dxRel, dyRel] = CELL_OFFSETS[cellLetter]!;
    const [dx, dy] = rotateOffset(dxRel, dyRel, facing);
    const role = SIDE_ROLE[sideSuffix]!;
    const side = roleSide(role, facing);
    const wallType = mapWallType(wallTypeAt(maze, x + dx, y + dy, side), wallTypeMap);
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
