/**
 * Browser-safe Wizardry 6 view model — maps a pose plus the per-cell
 * wall-type dispatch (`EvalCellFace`) onto `@seer-project/dungeon`
 * `DrawItem`s via the W6 `slots.json` slot-key scheme. Pure (no Node/DOM
 * imports) so both the Node renderers (`render-through-dungeon.ts`) and the
 * browser walker harness (`tools/walker/games.ts`) can share it.
 *
 * ## The five wall call sites and their two different evaluators
 *
 * The outer renderer's depth loop (`CODE+0xa97e`/file `0x0a9a6`, `LAB_055A`)
 * calls *five* face evaluators per depth and routes their results to
 * different draw sites (`data-structure.md` §4.7.1):
 *
 * | evaluator | argument | result | drives |
 * |---|---|---|---|
 * | `0x9202` `EvalCellFace` | lateral 0 | `-11376(A4)` | the **front** wall |
 * | `0x969a` | perpendicular | `-11374(A4)` | the **left** receding side wall |
 * | `0x9876` | perpendicular | `-11372(A4)` | the **right** receding side wall |
 * | `0x9202` | lateral -1 | `-11370(A4)` | the two **left column** faces |
 * | `0x9202` | lateral +1 | `-11368(A4)` | the two **right column** faces |
 *
 * So the corridor's receding side walls and the lateral columns' front-facing
 * walls are gated by *different* reads of the maze. The side walls are the
 * perpendicular edge beside the party — `evalCellFace(cell, facing±1, 0)`;
 * the columns are the lateral neighbour's own forward face —
 * `evalCellFace(cell, facing, ∓1)`. An earlier pass gated both on the latter,
 * which disagreed with the perpendicular read on 29.9% of all side-wall draw
 * decisions across the 14 levels.
 *
 * One open detail in the perpendicular reads: `EvalCellFace` gates its
 * feature dispatch on `facing == orient`, and this module passes the
 * *perpendicular* direction as `facing` so a door's own orientation gates
 * the edge it sits on. Whether `0x969a`/`0x9876` rotate the comparison the
 * same way or keep comparing against the party facing global `-0x4798(A4)`
 * is not yet traced (`data-structure.md` §4.7.2 describes those two siblings
 * only as "the same shape for the two perpendicular faces"). It only changes
 * feature-bearing cells, never plain walls.
 *
 * The slot keys follow that split:
 *
 *   `wall-side:{L,R}:<depth>`          receding side wall (static calls 4-9)
 *   `wall-lat:{L1,L2,R1,R2}:<depth>`   lateral column faces (compose 3/6/9/0xc)
 *   `wall:front:<depth>` / `door:front:<depth>`   front wall (compose 0 / 0xb2)
 *
 * ## Visibility lanes (occlusion)
 *
 * The game does not paint every depth unconditionally: it keeps **seven
 * parallel per-depth visibility lanes** (`-11432/-11424/-11416/-11408/
 * -11400/-11392/-11384(A4)`, 8 bytes each, all set to 1 for depths 0-3 at
 * `0x0a892`), gates every draw site on `lane[depth] == 1`, and clears
 * lanes ahead whenever a face blocks. `blockers` below is a direct port; see
 * each function's own doc comment for its file offset. This matters because
 * every W6 wall piece blits with `blend: 'or'` — an unoccluded far piece does
 * not get painted over by a nearer one, it bleeds *through* it.
 *
 * The two lanes this module does not model (`-11392`/`-11384`) gate the
 * `LAB_0528` draw sites, which the walker doesn't implement yet; the clears
 * targeting them are noted but skipped.
 */
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { DrawItem, DrawItemKind } from '@seer-project/dungeon';
import { evalCellFace, stepForward, type CellPlanes } from './evaluate-cell.ts';

/** Lanes are 8 bytes but only depths 0-3 are initialised (`CODE+0xa86a`, `CMP.W #4,D4`). */
const LANE_DEPTHS = 4;
/** `0x9b58`'s own entry gate — `CMPI.W #3,8(a5); BGE` — so nothing draws at depth >= 3. */
const MAX_DRAW_DEPTH = 3;

/** The five per-depth visibility lanes this module models, by the draw site each gates. */
interface Lanes {
  /** `-11432(A4)` — gates the front wall *and* both receding side walls. */
  front: boolean[];
  /** `-11424(A4)` — gates the outer left column face (compose baseIndex 3). */
  left1: boolean[];
  /** `-11416(A4)` — gates the inner left column face (compose baseIndex 6). */
  left2: boolean[];
  /** `-11408(A4)` — gates the inner right column face (compose baseIndex 9). */
  right1: boolean[];
  /** `-11400(A4)` — gates the outer right column face (compose baseIndex 0xc). */
  right2: boolean[];
}

function freshLanes(): Lanes {
  const lane = () => new Array<boolean>(LANE_DEPTHS).fill(true);
  return { front: lane(), left1: lane(), left2: lane(), right1: lane(), right2: lane() };
}

function hide(lane: boolean[], depth: number): void {
  if (depth < lane.length) lane[depth] = false;
}

/**
 * `LAB_0538`'s blocking predicate (file `0x0a4d4`-`0x0a4e2`), shared with
 * `LAB_0541`/`0544`/`0547`/`054A`: a face occludes when its dispatch code is
 * `2` (plain wall) or `>= 5` (any feature-derived code). Codes `1`, `3` and
 * `4` are drawn but see-through.
 *
 * Both this and `perpBlocks` have a second, `OR`-ed condition in the game —
 * a per-depth stride-3 byte flag (`-11365`/`-11366`/`-11364(A4)`, written at
 * `0x0aa10` only when `-18340(A4)` is 10 or 12) that forces occlusion even
 * for a see-through code. Those flags are assumed clear here, the same
 * conservative assumption `evaluate-cell.ts` makes for `EvalCellFace`'s two
 * `TestBit`-gated overlay dispatches.
 */
const blocks = (code: number): boolean => code === 2 || code >= 5;

/** `LAB_053B`/`LAB_053E`'s predicate (`TST.W 10(A5); BNE`) — *any* non-open perpendicular face occludes. */
const perpBlocks = (code: number): boolean => code !== 0;

/**
 * `LAB_0506`'s dispatch (`data-structure.md` §4.7.6.1-§4.7.6.2) — which
 * side-wall slot keys a perpendicular face's code draws, at depth 0-2.
 *
 * Two stages, both ported here:
 * - the **preamble** (`16/18(A5)`, the plain receding side wall), which
 *   fires for `code == 2 || code >= 7`;
 * - the **14-entry jump table** on code 0-13, adding a variant piece. Code
 *   14+ falls outside the table's `CMP.L #$e,D0; BCC` bound and adds
 *   nothing — a real asymmetry with `0x9b58`, which does handle 14.
 *
 * Codes 8 and 9 push to the deferred-draw queue (`LAB_04B9` =
 * `CODE+0x9a52`) instead of drawing, and that queue's consumer is still
 * untraced — so they contribute only their preamble here.
 */
function sideKeys(code: number): string[] {
  const keys: string[] = [];
  if (code === 2 || code >= 7) keys.push('wall-side');
  if (code === 1 || code === 3 || code === 4) keys.push('wall-side-partial');
  if (code === 3) keys.push('wall-side-extra3');
  if (code === 4) keys.push('wall-side-extra4');
  if (code === 5 || code === 6) keys.push('wall-side-door');
  if (code === 7) keys.push('wall-side-feat7');
  if (code >= 10 && code <= 13) keys.push('wall-side-feat10');
  return keys;
}

/** `LAB_0538` (file `0x0a4d0`), called at `0x0aba2` with the front dispatch code. */
function blockFront(v: Lanes, d: number, code: number): void {
  if (!blocks(code)) return;
  hide(v.front, d + 1);
  hide(v.front, d + 2);
  hide(v.front, d + 3);
  hide(v.left2, d + 1);
  hide(v.right1, d + 1);
  hide(v.left1, d + 2);
  hide(v.left2, d + 2);
  hide(v.right1, d + 2);
  hide(v.right2, d + 2);
  // Also caps the loop bound `-11440(A4)` to d+3 (`0x0a57e`-`0x0a58c`) — a
  // no-op at this module's 3-depth budget, so not modelled.
}

/** `LAB_053B` (file `0x0a594`), called at `0x0ac08` with the left perpendicular code. */
function blockPerpLeft(v: Lanes, d: number, code: number): void {
  if (!perpBlocks(code)) return;
  hide(v.left2, d);
  hide(v.left1, d + 1);
  // + `-11392(A4)`[d+2], an unmodelled lane.
}

/** `LAB_053E` (file `0x0a5dc`), called at `0x0ac6e` — `LAB_053B`'s exact mirror. */
function blockPerpRight(v: Lanes, d: number, code: number): void {
  if (!perpBlocks(code)) return;
  hide(v.right1, d);
  hide(v.right2, d + 1);
  // + `-11384(A4)`[d+2], an unmodelled lane.
}

/** `LAB_0544` (file `0x0a662`), called at `0x0ae20` after the inner-left draw. */
function blockLeft2(v: Lanes, d: number, code: number): void {
  if (!blocks(code)) return;
  hide(v.left1, d + 1);
  // + `-11392(A4)`[d+2].
}

/** `LAB_0547` (file `0x0a6aa`), called at `0x0aee0` — `LAB_0544`'s mirror. */
function blockRight1(v: Lanes, d: number, code: number): void {
  if (!blocks(code)) return;
  hide(v.right2, d + 1);
  // + `-11384(A4)`[d+2].
}

// `LAB_0541` (`0x0a628`, after the outer-left draw) and `LAB_054A`
// (`0x0a6f2`, after the outer-right draw) only clear `-11392`/`-11384`, the
// two lanes this module doesn't model — so they are deliberately no-ops here.

/**
 * Emit the `DrawItem`s for one pose, following the game's own per-depth
 * order: front wall, then the two receding side walls, then the four lateral
 * column faces — each gated on its visibility lane, with the lane-clearing
 * blockers applied *between* draws exactly where the game applies them
 * (`blockPerpLeft` hides the inner-left column at the **current** depth, so
 * the ordering is load-bearing, not cosmetic).
 */
export function buildViewItems(
  planes: CellPlanes,
  x: number,
  y: number,
  facing: number,
  slots: SlotTableFile,
): DrawItem[] {
  const items: DrawItem[] = [];
  const v = freshLanes();

  const emit = (
    key: string,
    kind: DrawItemKind,
    depth: number,
    lateral: number,
    side: 'L' | 'R' | undefined,
    cell: { x: number; y: number },
  ) => {
    const slot = slots.slots[key];
    if (!slot) return;
    for (const draw of slot.draws) {
      items.push({ ...draw, kind, depth, lateral, side, cellX: cell.x, cellY: cell.y });
    }
  };

  for (let depth = 0; depth < MAX_DRAW_DEPTH; depth++) {
    const cell = stepForward(x, y, facing, depth);

    // Front wall — `0x9202` straight ahead, lane `-11432`.
    const front = evalCellFace(planes, cell.x, cell.y, facing, 0);
    if (v.front[depth]) {
      if (front === 5) emit(`door:front:${depth}`, 'front', depth, 0, undefined, cell);
      else if (front !== 0) emit(`wall:front:${depth}`, 'front', depth, 0, undefined, cell);
    }
    blockFront(v, depth, front);

    // Receding side walls — the perpendicular faces (`0x969a`/`0x9876`) run
    // through `LAB_0506`'s own dispatch, both gated on the same `-11432`
    // lane as the front wall.
    const perpL = evalCellFace(planes, cell.x, cell.y, (facing + 3) % 4, 0);
    if (v.front[depth]) for (const k of sideKeys(perpL)) emit(`${k}:L:${depth}`, 'side', depth, -1, 'L', cell);
    blockPerpLeft(v, depth, perpL);

    const perpR = evalCellFace(planes, cell.x, cell.y, (facing + 1) % 4, 0);
    if (v.front[depth]) for (const k of sideKeys(perpR)) emit(`${k}:R:${depth}`, 'side', depth, 1, 'R', cell);
    blockPerpRight(v, depth, perpR);

    // Lateral column faces — one evaluation per side (`0x9202` at lateral
    // ∓1), two draw sites each, one lane per site.
    const latL = evalCellFace(planes, cell.x, cell.y, facing, -1);
    if (v.left1[depth] && latL !== 0) emit(`wall-lat:L1:${depth}`, 'side', depth, -1, 'L', cell);
    // `LAB_0541` here — clears an unmodelled lane only.
    if (v.left2[depth] && latL !== 0) emit(`wall-lat:L2:${depth}`, 'side', depth, -1, 'L', cell);
    blockLeft2(v, depth, latL);

    const latR = evalCellFace(planes, cell.x, cell.y, facing, 1);
    if (v.right1[depth] && latR !== 0) emit(`wall-lat:R1:${depth}`, 'side', depth, 1, 'R', cell);
    blockRight1(v, depth, latR);
    if (v.right2[depth] && latR !== 0) emit(`wall-lat:R2:${depth}`, 'side', depth, 1, 'R', cell);
    // `LAB_054A` here — clears an unmodelled lane only.
  }

  return items;
}

/** Whether the party can step one cell in compass direction `dir` from `(x, y)` (the W6 movement rule: the approach cell must be open, and the destination in-bounds). */
export function canStepDir(
  planes: CellPlanes,
  x: number,
  y: number,
  dir: number,
  levelWidth: number,
  levelHeight: number,
): boolean {
  const dest = stepForward(x, y, dir, 1);
  if (dest.x < 0 || dest.y < 0 || dest.x >= levelWidth || dest.y >= levelHeight) return false;
  return evalCellFace(planes, x, y, dir, 0) === 0;
}
