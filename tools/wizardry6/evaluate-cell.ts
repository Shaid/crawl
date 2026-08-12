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

export interface CellPlanes {
  width: number;
  height: number;
  wallA: number[];
  wallB: number[];
  feature: number[];
  orient: number[];
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

function inBounds(planes: CellPlanes, x: number, y: number): boolean {
  return x >= 0 && x < planes.width && y >= 0 && y < planes.height;
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
 * Two things this port deliberately does NOT implement, both confirmed
 * but out of scope for now (data-structure.md §4.7.2/§4.7.1):
 * - The two `TestBit`-gated 14-way dispatches on `-0x47a4(a4)` at the
 *   very top of the real function (`CODE+0x9434`/`0x949e`) -- these read
 *   bits from the `flagP`/`flagQ` scripted-overlay planes
 *   `export-dungeon-levels.ts` already exports, but their 14-way targets
 *   were never traced. Assumed false (both bits clear) for every cell,
 *   same conservative assumption Black Crypt's own walker-mirror-flag
 *   work made for an analogous "deferred, needs a live oracle" gap.
 * - Feature codes 6/13/14/15's side-effect array writes (per-cell
 *   "triggered/discovered" flags, structurally identified but not
 *   semantically decoded) -- this port treats them as pure wall-value
 *   pass-throughs, matching their `D7`-unchanged behaviour exactly; only
 *   the side effect (irrelevant to a static render) is omitted.
 */
export function evalCellFace(planes: CellPlanes, x: number, y: number, facing: number, lateral: number): number {
  // The real EvalCellFace only checks bounds after a lateral step -- (x,y)
  // itself is always valid there, since the game's own world is much
  // larger than this exporter's per-level tight bounding box. A densified,
  // cropped level (export-dungeon-levels.ts) can genuinely be asked about
  // a position just past its own edge (e.g. depth-stepping near the crop
  // boundary), which the real game would never encounter -- so this bound
  // check is real, necessary defensive behaviour for this port specifically,
  // not present in the original pseudocode. Same "off-map -> solid/wall"
  // convention as the lateral-step check below and as export-dungeon-
  // levels.ts's own offMapValue fill.
  if (!inBounds(planes, x, y)) return 2;

  let cx = x;
  let cy = y;
  if (lateral !== 0) {
    const right = FACING_DELTAS[(facing + 1) % 4]!;
    cx += right.dx * lateral;
    cy += right.dy * lateral;
    if (!inBounds(planes, cx, cy)) return 2; // off-map -> solid/wall, per EvalCellFace's own explicit early return
  }

  const cellIdx = index(planes, cx, cy);
  let wall: number;
  switch (facing) {
    case 0:
      wall = planes.wallA[cellIdx]!;
      break;
    case 1:
      wall = planes.wallB[cellIdx]!;
      break;
    case 2: {
      const ny = cy - 1;
      wall = inBounds(planes, cx, ny) ? planes.wallA[index(planes, cx, ny)]! : 2;
      break;
    }
    case 3: {
      const nx = cx - 1;
      wall = inBounds(planes, nx, cy) ? planes.wallB[index(planes, nx, cy)]! : 2;
      break;
    }
    default:
      throw new Error(`evalCellFace: bad facing ${facing}`);
  }

  const feature = planes.feature[cellIdx]!;
  const orient = planes.orient[cellIdx]!;
  // Correction (data-structure.md §4.7.2 addendum): feature==6 || feature>=0xd, not feature<=0xc.
  const dispatchFires = facing === orient || feature === 6 || feature >= 0xd;
  if (!dispatchFires) return wall;

  const result = FEATURE_DISPATCH[feature];
  return result === 'wall' || result === undefined ? wall : result;
}
