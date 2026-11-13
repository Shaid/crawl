/**
 * A faithful TypeScript port of Wizardry 6's (Amiga) per-cell face
 * evaluator, `EvalCellFace` (`CODE+0x9202` and its two siblings
 * `0x969a`/`0x9876`) -- see `docs/wizardry6/amiga/data-structure.md`
 * §4.7.2 for the disassembly-confirmed pseudocode and derivation, and
 * §4.7.1's addendum for how the result feeds `CODE+0x9b58`'s render
 * dispatch.
 *
 * Works directly against the flat `wallA`/`wallB`/`feature`/`orient`
 * planes `export-dungeon-levels.ts` already produces -- `x`/`y` here are
 * that exporter's own densified coordinate space, not the raw
 * region/local coordinates the original disassembly uses (the region
 * indirection is exporter-internal; a densified flat grid is exactly
 * what `EvalCellFace`'s own `cellIndex = region*64 + locY*8 + locX`
 * ultimately resolves to a single linear index for, just computed a
 * different way).
 *
 * Facing/stepping convention matches `@seer-project/dungeon`'s own
 * `Direction.ts` exactly (0=N/+Y, 1=E/+X, 2=S/-Y, 3=W/-X) -- not a
 * coincidence: this game's own confirmed neighbour-step behaviour
 * (`CODE+0x908c`/`0x90f6`) independently matches that convention, which
 * is why `export-dungeon-levels.ts` declares `yAxisDown: false`.
 */

import { isOffMap, offMapIsOpen, rawWall } from './movement.ts';

export interface CellPlanes {
  width: number;
  height: number;
  wallA: number[];
  wallB: number[];
  feature: number[];
  orient: number[];
  /**
   * The `flagP`/`flagQ` scripted-overlay bit planes (`levelBuf+0x43A`/
   * `+0x49A`, 1 bit/cell — `decode-scenario-maze.ts` already extracts
   * them) and the source region index (0-11) of each densified cell,
   * needed only by `evalOverlay`'s level-12 special case
   * (`export-dungeon-levels.ts` doesn't emit `region` by default; see its
   * module doc). All optional and back-compatible: omitting them (or
   * `level` below) makes `evalOverlay` a no-op, matching every caller/test
   * that predates §4.7.9's overlay wiring.
   */
  flagP?: number[];
  flagQ?: number[];
  region?: number[];
  /** Current maze level (`-0x47a4(a4)`) -- selects `evalOverlay`'s per-level flagP/flagQ handler (§4.7.9). */
  level?: number;
}

/** `CODE+0x964e`'s full 16-entry feature dispatch table (data-structure.md §4.7.2's addendum). `'wall'` means the stub leaves the raw wall value unchanged (either a pure pass-through, or a side-effect-only stub this port doesn't implement -- see the module doc comment). */
export const FEATURE_DISPATCH: Record<number, number | 'wall'> = {
  0: 'wall',
  1: 5,
  2: 6,
  3: 8,
  4: 9,
  5: 14,
  6: 'wall', // side effect only (array write), not implemented here
  7: 4,
  8: 7,
  9: 10,
  10: 11,
  11: 12,
  12: 13,
  13: 'wall', // side effect only
  14: 'wall', // side effect only
  15: 'wall', // side effect only
};

/** `Direction.ts`'s own `FACING_DELTAS`, duplicated here to keep this module dependency-free of the framework -- values are identical by construction, see the module doc comment. */
const FACING_DELTAS = [
  { dx: 0, dy: 1 }, // 0 = N
  { dx: 1, dy: 0 }, // 1 = E
  { dx: 0, dy: -1 }, // 2 = S
  { dx: -1, dy: 0 }, // 3 = W
] as const;

/**
 * `EvalCellFace` takes no depth argument -- the outer renderer's own
 * depth loop (`CODE+0xaa4a`-`0xaaf4`, data-structure.md §4.7.1) steps the
 * evaluated position `depth` cells forward along `facing` *before* each
 * evaluator call, once per depth per frame. This is that step.
 */
export function stepForward(x: number, y: number, facing: number, depth: number): { x: number; y: number } {
  const d = FACING_DELTAS[facing]!;
  return { x: x + d.dx * depth, y: y + d.dy * depth };
}

function index(planes: CellPlanes, x: number, y: number): number {
  return y * planes.width + x;
}

/**
 * `EvalCellFace(x, y, facing, lateral)` -- the per-cell dispatch value
 * `CODE+0x9b58` compares/dispatches on (`0xA(a5)`/`10(a5)` in the
 * disassembly). `lateral` is the party's-right-relative offset used by
 * the two side-wall evaluator siblings (`-1`/`+1`); `0` is the
 * straight-ahead case the front-wall call site uses exclusively.
 *
 * One thing this port deliberately does NOT implement, confirmed but out
 * of scope for now (data-structure.md §4.7.2/§4.7.1):
 * - Feature codes 6/13/14/15's side-effect array writes (per-cell
 *   "triggered/discovered" flags, structurally identified but not
 *   semantically decoded) -- this port treats them as pure wall-value
 *   pass-throughs, matching their `D7`-unchanged behaviour exactly; only
 *   the side effect (irrelevant to a static render) is omitted.
 *
 * The two `TestBit`-gated 14-way dispatches on `-0x47a4(a4)` at the very
 * top of the real function (`CODE+0x9434`/`0x949e`) -- previously assumed
 * clear -- are now implemented separately by `evalOverlay` below (§4.7.9),
 * since their effects (skip-ceiling, skip-floor, alt-floor, fog/occlusion)
 * apply to the ceiling/floor/blocking machinery in `view-model.ts`, not to
 * this function's own return value in every case (see `evalOverlay`'s own
 * doc comment for the one case where it does: the fog handler).
 */
export function evalCellFace(planes: CellPlanes, x: number, y: number, facing: number, lateral: number): number {
  // Off-map handling (data-structure.md §4.7.10): a cell no real region
  // covers -- outside the densified grid OR a gap cell (`region < 0`) -- is
  // what the game's resolver (`LAB_045D`) fails on. The depth loop
  // (CODE+0xa9e8) then sets the front/perpendicular codes directly, and
  // the lateral evaluator (CODE+0x9248) returns directly: 0 on levels 10/12
  // (open sky/ground -- with skip-ceiling + alt-floor, see `evalOverlay`),
  // 2 (solid) everywhere else. The lateral step is taken from the
  // (possibly off-map) depth cell itself, as the game's abs-coordinate
  // `LAB_0471` does.
  const level = planes.level ?? -1;
  let cx = x;
  let cy = y;
  if (lateral !== 0) {
    const right = FACING_DELTAS[(facing + 1) % 4]!;
    cx += right.dx * lateral;
    cy += right.dy * lateral;
  }
  if (isOffMap(planes, cx, cy)) return offMapIsOpen(level) ? 0 : 2;

  const cellIdx = index(planes, cx, cy);
  const wall = rawWall(planes, cx, cy, facing);

  const feature = planes.feature[cellIdx]!;
  const orient = planes.orient[cellIdx]!;
  // Correction (data-structure.md §4.7.2 addendum): feature==6 || feature>=0xd, not feature<=0xc.
  const dispatchFires = facing === orient || feature === 6 || feature >= 0xd;
  if (!dispatchFires) return wall;

  const result = FEATURE_DISPATCH[feature];
  return result === 'wall' || result === undefined ? wall : result;
}

/**
 * `0x969a`/`0x9876`'s 13-entry feature table (features 0-12; >= 13 leave
 * the wall value unchanged). Identical to `FEATURE_DISPATCH` except feature
 * 5, which the perpendicular evaluators leave unchanged (`0x9202` maps it to
 * 14). Read from the jump tables at CODE+0x9844 / CODE+0x9a20.
 */
const PERP_FEATURE_DISPATCH: Record<number, number> = { 1: 5, 2: 6, 3: 8, 4: 9, 7: 4, 8: 7, 9: 10, 10: 11, 11: 12, 12: 13 };

/**
 * The perpendicular side-wall evaluators: `0x969a` (`side = -1`, the face
 * on the party's left, compass `facing-1`) and `0x9876` (`side = +1`,
 * `facing+1`), always called with lateral 0 at the depth cell (§4.7.6).
 * Differences from `evalCellFace` (data-structure.md §4.7.10):
 * - flagP only (never flagQ), and only as an early return: on the fog
 *   levels 0/4/5 -- and level 12 outside regions 0-8 -- a flagP cell returns
 *   0 **with no gate/occlusion writes**; on every other level flagP is
 *   ignored. So perpendicular faces never contribute to the ceiling/floor
 *   gates or lane clearing.
 * - the feature gate is the orientation test alone (`orient == facing∓1`;
 *   no `feature == 6 || >= 13` override, which only matters for side
 *   effects), and feature 5 leaves the wall unchanged.
 */
export function evalPerpFace(planes: CellPlanes, x: number, y: number, facing: number, side: -1 | 1): number {
  const level = planes.level ?? -1;
  if (isOffMap(planes, x, y)) return offMapIsOpen(level) ? 0 : 2; // depth loop's direct set, CODE+0xa9f4-0xaa42
  const i = index(planes, x, y);
  if ((planes.flagP?.[i] ?? 0) !== 0) {
    if (level === 0 || level === 4 || level === 5) return 0;
    if (level === 12 && (planes.region?.[i] ?? -1) > 8) return 0;
  }
  const dir = (facing + (side === -1 ? 3 : 1)) % 4;
  const wall = rawWall(planes, x, y, dir);
  if (planes.orient[i] !== dir) return wall;
  return PERP_FEATURE_DISPATCH[planes.feature[i]!] ?? wall;
}

/**
 * The four documented effects of `EvalCellFace`'s flagP/flagQ overlay
 * dispatch (`CODE+0x9434`/`0x949e`, data-structure.md §4.7.9). All default
 * false/off -- a cell with no flagP/flagQ bit set (or a `CellPlanes` that
 * doesn't carry those planes at all) always resolves to this.
 */
export interface OverlayEffect {
  /**
   * The flagP "fog/view-blocker" handler fired (levels 0/4/5, and level 12
   * outside source regions 0-8): the real game (a) evaluates this face as
   * wall code 0 (open) regardless of the raw wall/feature value, (b) sets
   * the §4.7.6 occlusion-override array so this face still blocks farther
   * depths despite the see-through code, and (c) directly clears this
   * side's visibility lane(s) *at this depth*. All three are the caller's
   * responsibility (`view-model.ts`) -- this flag alone signals all three.
   */
  fog: boolean;
  /** Skip the ceiling draw for this (depth, side)'s lane(s) (flagQ, most levels; flagP level 1 also sets this). */
  skipCeiling: boolean;
  /** Skip the floor draw for this (depth, side)'s lane(s) (flagP levels 1/2/3/6/11/13). */
  skipFloor: boolean;
  /** Draw the alt-floor compose family (214-241) instead of the normal floor (flagP levels 8/10/12-inside-regions-0-8). */
  altFloor: boolean;
}

const NO_OVERLAY: OverlayEffect = { fog: false, skipCeiling: false, skipFloor: false, altFloor: false };

/**
 * `EvalCellFace`'s two `TestBit`-gated 14-way overlay dispatches
 * (`CODE+0x9434`/`0x949e`, data-structure.md §4.7.9 -- read that section
 * for the full per-level table and its evidence). Call this with the
 * *same* `(x, y, facing, lateral)` used for the corresponding
 * `evalCellFace` call -- it resolves the identical cell (bounds check +
 * lateral step) before testing the flagP/flagQ bit there.
 *
 * `level` is the current maze level (`-0x47a4(a4)`, the same global
 * `evalCellFace`'s siblings read internally but that this pure port
 * doesn't otherwise need). Pass `planes.level ?? -1` from a caller that
 * stores it on `CellPlanes`; a level matching no branch below behaves as
 * "no known handler, and does not fall through to the flagQ test" -- the
 * same behaviour real levels 0/1/2/3/4/5/6/8/10/11/12/13 have (only 7 and
 * 9's flagP handler is a no-op that *does* fall through, per the
 * pseudocode's two independent top-level `if`s, data-structure.md §4.7.2
 * line "if TestBit(P): ...; if TestBit(Q): ...").
 *
 * **Side slots (resolved 2026-11-13, §4.7.10):** each `0x9202` call writes
 * the gate arrays at slot `lateral + 1` (0 = left, 1 = front, 2 = right) --
 * the lateral-column calls own the left/right slots. The perpendicular
 * evaluators `0x969a`/`0x9876` never write them (see `evalPerpFace`), so a
 * side gate is this function's lateral result alone, not an OR with the
 * perpendicular face.
 */
export function evalOverlay(
  planes: CellPlanes,
  level: number,
  x: number,
  y: number,
  facing: number,
  lateral: number,
): OverlayEffect {
  if (!planes.flagP && !planes.flagQ && !offMapIsOpen(level)) return NO_OVERLAY;

  // Mirror evalCellFace's own cell resolution (bounds + lateral step) --
  // an off-map cell (either before or after the lateral step) has no
  // overlay bit to test, same "off-map" convention evalCellFace uses.
  let cx = x;
  let cy = y;
  if (lateral !== 0) {
    const right = FACING_DELTAS[(facing + 1) % 4]!;
    cx += right.dx * lateral;
    cy += right.dy * lateral;
  }
  // Off-map (§4.7.10): levels 10/12 write skip-ceiling (-11354) + alt-floor
  // (-11330) for this evaluator's side slot (lateral+1) and return 0
  // (CODE+0x9258 lateral, CODE+0xaa04 depth); other levels write nothing.
  if (isOffMap(planes, cx, cy)) {
    return offMapIsOpen(level) ? { fog: false, skipCeiling: true, skipFloor: false, altFloor: true } : NO_OVERLAY;
  }
  const cellIdx = index(planes, cx, cy);

  let effect: OverlayEffect = NO_OVERLAY;
  let fellThroughToQ = true;

  const flagPSet = (planes.flagP?.[cellIdx] ?? 0) !== 0;
  if (flagPSet) {
    fellThroughToQ = level === 7 || level === 9;
    if (level === 0 || level === 4 || level === 5) {
      effect = { ...effect, fog: true };
    } else if (level === 12) {
      const region = planes.region?.[cellIdx] ?? -1;
      effect = region >= 0 && region <= 8 ? { ...effect, altFloor: true } : { ...effect, fog: true };
    } else if (level === 8 || level === 10) {
      effect = { ...effect, altFloor: true };
    } else if (level === 1) {
      effect = { ...effect, skipFloor: true, skipCeiling: true };
    } else if (level === 2 || level === 3 || level === 6 || level === 11 || level === 13) {
      effect = { ...effect, skipFloor: true };
    }
    // levels 7, 9: no-op handler, falls through to the flagQ test below.
  }

  if (fellThroughToQ) {
    const flagQSet = (planes.flagQ?.[cellIdx] ?? 0) !== 0;
    if (flagQSet) {
      // Levels 2, 5, 7, 9 route to a further facing-indexed handler that
      // wasn't traced to closure (§4.7.9) -- left unimplemented rather
      // than guessed, so those 4 levels get no flagQ effect here.
      if (!(level === 2 || level === 5 || level === 7 || level === 9)) {
        effect = { ...effect, skipCeiling: true };
      }
    }
  }

  return effect;
}
