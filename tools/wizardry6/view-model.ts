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
 * `0x0a892` and then selectively re-cleared at `0x0a944`-`0x0a958`), gates
 * every draw site on `lane[depth] == 1`, and clears lanes ahead whenever a
 * face blocks. `blockers` below is a direct port; see each function's own
 * doc comment for its file offset. This matters because every W6 wall piece
 * blits with `blend: 'or'` — an unoccluded far piece does not get painted
 * over by a nearer one, it bleeds *through* it.
 *
 * ## Ceiling and floor are per-lane, not a static backdrop (§4.7.7)
 *
 * All seven lanes also carry a **ceiling** and a **floor** compose run, and
 * that is what fills the view outside the corridor's own trapezoid — over an
 * open lateral side there is no wall, so only these pieces cover the gap.
 *
 * | lane | `A4` offset | draw site | ceiling | floor | alt floor |
 * |---|---|---|---|---|---|
 * | front  | `-11432` | `0x0ab92` -> `0x9b58` | 122 | 150 | 214 |
 * | side L | `-11392` | `0x0aca2` -> `LAB_0528` | 126 | 154 | 218 |
 * | lat L1 | `-11424` | `0x0ad52` -> `0x9b58` | 130 | 158 | 222 |
 * | lat L2 | `-11416` | `0x0ae10` -> `0x9b58` | 134 | 162 | 226 |
 * | lat R1 | `-11408` | `0x0aed0` -> `0x9b58` | 138 | 166 | 230 |
 * | lat R2 | `-11400` | `0x0af90` -> `0x9b58` | 142 | 170 | 234 |
 * | side R | `-11384` | `0x0afd6` -> `LAB_0528` | 146 | 174 | 238 |
 *
 * Three exact 7x4 tables (122-149, 150-177, 214-241) with no record left
 * over. `0x9b58` draws its ceiling *before* its own `CMPI.W #3,8(a5); BGE`
 * depth gate and its floor at `LAB_04F8`, which is that gate's jump target,
 * so both run for depths 0-3 while walls stop at depth 2 — hence the loop
 * below runs to `MAX_LOOP_DEPTH` (`-11440(A4)`, initialised to 4) rather
 * than to `MAX_WALL_DEPTH`. `LAB_0528` exists only to draw this pair for
 * the two receding-side lanes, which have no wall of their own here.
 *
 * The alt-floor column is selected instead of the floor when
 * `word[-11330(A4) + depth*6 + side*2] != 0`, and both draws are skipped
 * entirely when `byte[-11354(A4)]` / `byte[-11342(A4)]` at `depth*3 + side`
 * is set. Those three arrays are memset to 0 per render (`0x0a8f6`-`0x0a91e`)
 * and only written by `EvalCellFace`'s special-map-mode paths — the flagP/
 * flagQ overlay dispatch, §4.7.9 — which `evalOverlay` (`evaluate-cell.ts`)
 * now implements and this module wires into the per-lane ceiling/floor
 * emission and the blocking predicates below (previously assumed clear).
 */
import type { SlotTableFile } from '@seer-project/dungeon/schema';
import type { DrawItem, DrawItemKind } from '@seer-project/dungeon';
import { evalCellFace, evalOverlay, evalPerpFace, stepForward, type CellPlanes, type OverlayEffect } from './evaluate-cell.ts';
import { canStepStatic, type W6LevelLinks } from './movement.ts';

/** The three per-(depth,side) overlay effects that matter for one lane's ceiling/floor draw — `evalOverlay`'s `fog` is handled separately (it also forces the wall code and forces occlusion, see `buildViewItems`). */
interface SideGate {
  skipCeiling: boolean;
  skipFloor: boolean;
  altFloor: boolean;
}

/** One evaluator's overlay effects as a lane gate. Each gate slot has exactly one writer (§4.7.10): front = the straight-ahead `0x9202` call, left/right = the lateral-column calls; the perpendicular evaluators never write the gates. */
function toGate(a: OverlayEffect): SideGate {
  return { skipCeiling: a.skipCeiling, skipFloor: a.skipFloor, altFloor: a.altFloor };
}

/** Lanes are 8 bytes but only depths 0-3 are initialised (`CODE+0xa86a`, `CMP.W #4,D4`). */
const LANE_DEPTHS = 4;
/** `-11440(A4)`'s initial value (`0x0a984`, `MOVE.W #4,-11440(A4)`) — the depth loop's bound. */
const MAX_LOOP_DEPTH = 4;
/** `0x9b58`'s and `LAB_0506`'s shared entry gate — `CMPI.W #3,8(a5); BGE` — so no *wall* draws at depth >= 3. */
const MAX_WALL_DEPTH = 3;

/** All seven per-depth visibility lanes, by the draw site each gates. */
interface Lanes {
  /** `-11432(A4)` — gates the front wall, both receding side walls, and the front ceiling/floor. */
  front: boolean[];
  /** `-11424(A4)` — gates the outer left column face (compose baseIndex 3). */
  left1: boolean[];
  /** `-11416(A4)` — gates the inner left column face (compose baseIndex 6). */
  left2: boolean[];
  /** `-11408(A4)` — gates the inner right column face (compose baseIndex 9). */
  right1: boolean[];
  /** `-11400(A4)` — gates the outer right column face (compose baseIndex 0xc). */
  right2: boolean[];
  /** `-11392(A4)` — gates `LAB_0528`'s left ceiling/floor continuation (`0x0aca2`). */
  sideL: boolean[];
  /** `-11384(A4)` — gates `LAB_0528`'s right ceiling/floor continuation (`0x0afd6`). */
  sideR: boolean[];
}

/**
 * Lane state at the top of a render: `0x0a892`'s loop sets every lane to 1
 * for depths 0-3, then `0x0a944`-`0x0a958` immediately re-clears five
 * specific entries — `left1[0]`, `right2[0]`, `sideL[0]`, `sideL[1]`,
 * `sideR[0]`, `sideR[1]`.
 *
 * The two column clears are self-evidently right: `wall-lat:L1:0` and
 * `wall-lat:R2:0` resolve to compose records 3 and 12, both `widthBytes == 0`
 * (draw nothing). The four `LAB_0528` clears are the reason the near ceiling
 * margin comes from the *column* lanes (130+0 = 130, 138+0 = 138, both
 * x 72..104 / x 216..248 in band 0) rather than from 126/146 — those two
 * runs only ever contribute their depth-2 and depth-3 entries.
 */
function freshLanes(): Lanes {
  const lane = () => new Array<boolean>(LANE_DEPTHS).fill(true);
  const v: Lanes = {
    front: lane(),
    left1: lane(),
    left2: lane(),
    right1: lane(),
    right2: lane(),
    sideL: lane(),
    sideR: lane(),
  };
  v.left1[0] = false; // CLR.B -11424(A4)  0x0a944
  v.right2[0] = false; // CLR.B -11400(A4)  0x0a948
  v.sideL[0] = false; // CLR.B -11392(A4)  0x0a94c
  v.sideL[1] = false; // CLR.B -11391(A4)  0x0a950
  v.sideR[0] = false; // CLR.B -11384(A4)  0x0a954
  v.sideR[1] = false; // CLR.B -11383(A4)  0x0a958
  return v;
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
 * a per-depth stride-3 byte flag (`-11365`/`-11366`/`-11364(A4)`) that
 * forces occlusion even for a see-through code. §4.7.9 identifies its real
 * writer as the flagP "fog/view-blocker" handler (levels 0/4/5/12-outside-
 * regions-0-8) — `forceOcclude` below is `evalOverlay(...).fog` from the
 * same evaluator call, plumbed in by `buildViewItems`.
 */
const blocks = (code: number, forceOcclude: boolean): boolean => code === 2 || code >= 5 || forceOcclude;

/** `LAB_053B`/`LAB_053E`'s predicate (`TST.W 10(A5); BNE`) — *any* non-open perpendicular face occludes (+ the same fog occlusion-override, §4.7.9). */
const perpBlocks = (code: number, forceOcclude: boolean): boolean => code !== 0 || forceOcclude;

/**
 * `LAB_0506`'s dispatch (`data-structure.md` §4.7.6.1-§4.7.6.2) — which
 * side-wall slot keys a perpendicular face's code draws.
 *
 * Two stages, both ported here:
 * - the **preamble** (`16/18(A5)`, the plain receding side wall). Its gate
 *   is `(depth == 3 && code != 0) || code == 2 || code >= 7` — the depth-3
 *   arm (`0x0a178`-`0x0a184`) draws the far sliver for *any* non-open code,
 *   including the ones the jump table would otherwise handle;
 * - the **14-entry jump table** on code 0-13, adding a variant piece. Code
 *   14+ falls outside the table's `CMP.L #$e,D0; BCC` bound and adds
 *   nothing — a real asymmetry with `0x9b58`, which does handle 14. The
 *   table is skipped entirely at depth >= 3 (`LAB_050D`, `0x0a1ce`).
 *
 * Codes 8 and 9 push a `.PIC`-cel record to the deferred-draw queue
 * (`LAB_04B9` = `CODE+0x9a52`, `0x0a2ee`/`0x0a31e`) — see `sideCel`.
 */
function sideKeys(code: number, depth: number, alt: string): string[] {
  const keys: string[] = [];
  if ((depth === MAX_WALL_DEPTH && code !== 0) || code === 2 || code >= 7) keys.push(`wall-side${alt}`);
  if (depth >= MAX_WALL_DEPTH) return keys;
  if (code === 1 || code === 3 || code === 4) keys.push(`wall-side-partial${alt}`);
  if (code === 3) keys.push('wall-side-extra3'); // always direct (§4.7.6.2)
  if (code === 4) keys.push('wall-side-extra4');
  if (code === 5 || code === 6) keys.push(`wall-side-door${alt}`);
  if (code === 7) keys.push(`wall-side-feat7${alt}`);
  if (code >= 10 && code <= 13) keys.push(`wall-side-feat10${alt}`);
  return keys;
}

/**
 * `LAB_0506`'s own `.PIC`-cel pushes (depth 0-2 only): code 8 = wall torch,
 * kind 1, cel `depth*2 + base + torchFrame` (base `12(A5)`: 7 left, 13
 * right); code 9 = kind 2, cel `depth + base` (`14(A5)`: 4 left, 7 right).
 * Both at x = y = 0 plus the section-8 hotspot, full-view clip, tag = depth.
 */
function sideCel(code: number, depth: number, side: 'L' | 'R', torchFrame: number): string | null {
  if (depth >= MAX_WALL_DEPTH) return null;
  if (code === 8) return `cel:1:${depth * 2 + (side === 'L' ? 7 : 13) + torchFrame}:perp`;
  if (code === 9) return `cel:2:${depth + (side === 'L' ? 4 : 7)}:perp`;
  return null;
}

/**
 * `0x9b58`'s own per-code dispatch for the front wall and the four lateral
 * column faces (§4.7.8; the jump table `LAB_04F6` at `0x0a04c`). Returns
 * `{ now, deferred }` slot-key lists: `deferred` maps the game's
 * deferred-draw queue (`LAB_04B9` records, consumed *after* the whole depth
 * loop in descending-depth order) — the codes-1/3/4 "open doorway" art and
 * code 3's closed-door leaf.
 *
 * `alt` is the `-11436(A4)` per-depth checkerboard parity suffix
 * (`(partyX + partyY + facing + depth) & 1`, §4.7.8) picking the mirrored
 * pair branch.
 *
 * `cels` are the same queue's `.PIC`-cel records (kind 1/2). > **Correction
 * (2026-11-22):** these were previously called the monster/NPC combat
 * portrait overlay and left undrawn. They are static scenery: kind = the
 * resource slot, and slots 1/2 hold `MON01.PIC` (wall torches) and
 * `MON02.PIC` (fountain, portcullis, doorway shadow) for the whole session
 * (`LAB_032B`). Pushed only when `depth > 0` or at the front site; `tag` is
 * the record's depth tag (the doorway shadow is tagged `depth + 1`).
 * `torchFrame` is `-11736(A4)`, the idle-loop torch toggle (0/1).
 */
function frontKeys(
  site: 'front' | 'L1' | 'L2' | 'R1' | 'R2',
  code: number,
  depth: number,
  alt: string,
  torchFrame = 0,
): { now: string[]; deferred: string[]; cels: Array<{ key: string; tag: number }> } {
  const now: string[] = [];
  const deferred: string[] = [];
  const cels: Array<{ key: string; tag: number }> = [];
  const celOk = depth > 0 || site === 'front';
  const cel = (kind: number, index: number, tag: number) => {
    if (celOk) cels.push({ key: `cel:${kind}:${index}:${site}:${depth}`, tag });
  };
  const wallKey = site === 'front' ? `wall:front:${depth}` : `wall-lat:${site}:${depth}`;
  // preamble (`0x9bb8`): the solid wall body, codes 2 and >= 7 only.
  if (code === 2 || code >= 7) now.push(`${wallKey}${alt}`);
  switch (code) {
    case 1:
    case 4:
      if (code === 4) cel(2, depth + 10, depth); // portcullis (0x9cb6)
      deferred.push(`wall-open:${site}:${depth}${alt}`);
      cel(2, depth + 13, depth + 1); // doorway shadow (0x9d84)
      break;
    case 3:
      deferred.push(`door-leaf:${site}:${depth}`); // always direct (C == 0xFFFF in the push)
      deferred.push(`wall-open:${site}:${depth}${alt}`);
      cel(2, depth + 13, depth + 1);
      break;
    case 5:
      now.push(`door:${site}:${depth}${alt}`);
      break;
    case 6:
      now.push(`feat6:${site}:${depth}${alt}`);
      break;
    case 7:
      now.push(`feat7:${site}:${depth}${alt}`);
      break;
    case 8: // wall torch (0x9e74)
      cel(1, (alt && depth < 2 ? 18 : 0) + depth * 2 + torchFrame + 1, depth);
      break;
    case 9: // fountain (0x9ede)
      cel(2, depth + 1, depth);
      break;
    case 10:
      now.push(`feat10:${site}:${depth}${alt}`);
      break;
    case 11:
    case 12:
      // 0x9f2c draws the feat10 base (56/58) for every code 10-13, then the code's own piece
      now.push(`feat10:${site}:${depth}${alt}`);
      now.push(`feat${code}:${site}:${depth}${alt}`);
      break;
    case 13:
      now.push(`feat10:${site}:${depth}${alt}`);
      now.push(`feat13:${site}:${depth}`);
      break;
    case 14:
      if (site === 'front' && depth === 0) now.push(`feat14:front:0${alt}`);
      break;
    default:
      break;
  }
  // depth-0 lateral fall-in (`0x9d84`): codes 1/3/4 in the near lateral
  // column draw the big side-door art instead of a token.
  if (depth === 0 && site !== 'front' && (code === 1 || code === 3 || code === 4)) {
    now.push(`door:${site}:${depth}${alt}`);
  }
  return { now, deferred, cels };
}

/**
 * `LAB_0538` (file `0x0a4d0`), called at `0x0aba2` with the front dispatch
 * code. Returns the new depth-loop bound: the routine's tail
 * (`0x0a578`-`0x0a58c`) also lowers `-11440(A4)` to `d + 3` when it is
 * currently larger, which matters now that the loop runs to depth 3.
 */
function blockFront(v: Lanes, d: number, code: number, loopBound: number, forceOcclude: boolean): number {
  if (!blocks(code, forceOcclude)) return loopBound;
  hide(v.front, d + 1);
  hide(v.front, d + 2);
  hide(v.front, d + 3);
  hide(v.left2, d + 1);
  hide(v.right1, d + 1);
  hide(v.left1, d + 2);
  hide(v.left2, d + 2);
  hide(v.right1, d + 2);
  hide(v.right2, d + 2);
  return Math.min(loopBound, d + 3);
}

/** `LAB_053B` (file `0x0a594`), called at `0x0ac08` with the left perpendicular code. */
function blockPerpLeft(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!perpBlocks(code, forceOcclude)) return;
  hide(v.left2, d);
  hide(v.left1, d + 1);
  hide(v.sideL, d + 2);
}

/** `LAB_053E` (file `0x0a5dc`), called at `0x0ac6e` — `LAB_053B`'s exact mirror. */
function blockPerpRight(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!perpBlocks(code, forceOcclude)) return;
  hide(v.right1, d);
  hide(v.right2, d + 1);
  hide(v.sideR, d + 2);
}

/** `LAB_0541` (file `0x0a628`), called at `0x0ad62` after the outer-left draw. */
function blockLeft1(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!blocks(code, forceOcclude)) return;
  hide(v.sideL, d + 1);
}

/** `LAB_0544` (file `0x0a662`), called at `0x0ae20` after the inner-left draw. */
function blockLeft2(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!blocks(code, forceOcclude)) return;
  hide(v.left1, d + 1);
  hide(v.sideL, d + 2);
}

/** `LAB_0547` (file `0x0a6aa`), called at `0x0aee0` — `LAB_0544`'s mirror. */
function blockRight1(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!blocks(code, forceOcclude)) return;
  hide(v.right2, d + 1);
  hide(v.sideR, d + 2);
}

/** `LAB_054A` (file `0x0a6f2`), called at `0x0afa0` — `LAB_0541`'s mirror. */
function blockRight2(v: Lanes, d: number, code: number, forceOcclude: boolean): void {
  if (!blocks(code, forceOcclude)) return;
  hide(v.sideR, d + 1);
}

/**
 * Emit the `DrawItem`s for one pose, following `LAB_055A`'s own per-depth
 * order: the front lane, then the two receding side walls, then the left
 * `LAB_0528` lane, the four lateral column lanes, and the right `LAB_0528`
 * lane — each gated on its visibility lane, each of the seven carrying its
 * own ceiling/floor run (§4.7.7), with the lane-clearing blockers applied
 * *between* draws exactly where the game applies them (`blockPerpLeft` hides
 * the inner-left column at the **current** depth, so the ordering is
 * load-bearing, not cosmetic).
 */
export function buildViewItems(
  planes: CellPlanes,
  x: number,
  y: number,
  facing: number,
  slots: SlotTableFile,
  /** Global maze coordinate of the densified grid's (0,0) — the checkerboard parities use the game's absolute coordinates (`-18338/-18336(A4)`), so a level whose grid is cropped needs its origin to phase them correctly. Defaults to (0,0). */
  origin: { x: number; y: number } = { x: 0, y: 0 },
  /** `-11736(A4)`, the torch animation frame (0/1) the game toggles in its idle loop. */
  torchFrame = 0,
): DrawItem[] {
  const items: DrawItem[] = [];
  const v = freshLanes();

  // `-11434(A4)` (pose parity) and `-11436(A4)` (per-depth parity) — §4.7.8:
  // (partyX + partyY + facing) & 1, computed once per render / plus depth.
  const p0 = ((x + origin.x + y + origin.y + facing) & 1) === 1;
  const altPose = p0 ? ':alt' : '';
  const altDepth = (depth: number) => (((x + origin.x + y + origin.y + facing + depth) & 1) === 1 ? ':alt' : '');

  const emit = (
    key: string,
    kind: DrawItemKind,
    depth: number,
    lateral: number,
    side: 'L' | 'R' | undefined,
    cell: { x: number; y: number },
  ) => {
    // A missing `:alt` variant (e.g. a zero-width pair record) falls back to
    // the direct branch rather than dropping the draw.
    const slot = slots.slots[key] ?? (key.endsWith(':alt') ? slots.slots[key.slice(0, -4)] : undefined);
    if (!slot) return;
    for (const draw of slot.draws) {
      items.push({ ...draw, kind, depth, lateral, side, cellX: cell.x, cellY: cell.y });
    }
  };

  /** The deferred-draw queue (`LAB_04B9` -> consumer `0x0affa`, §4.7.8): codes 1/3/4's doorway/door-leaf records are appended during the walk and drawn only after the whole depth loop, deepest depth first. */
  const deferredItems: Array<{ key: string; kind: DrawItemKind; depth: number; lateral: number; side: 'L' | 'R' | undefined; cell: { x: number; y: number }; cel?: boolean }> = [];

  /**
   * One lane's ceiling + floor continuation (§4.7.7). `0x9b58` draws the
   * ceiling from `18(a5)` at its very top and the floor from `70(a5)` at
   * `LAB_04F8`, with the lane's wall in between; `LAB_0528` draws the same
   * pair with nothing in between. `body` fills that gap so this helper can
   * express both, in the game's own order.
   *
   * `gate` is §4.7.9's flagP/flagQ overlay result for this lane's side at
   * this depth: `skipCeiling`/`skipFloor` omit the draw entirely, and
   * `altFloor` (when the floor is not itself skipped) substitutes the
   * `floor-alt:*` compose family (214-241) for the normal one.
   */
  const emitLane = (
    lane: string,
    depth: number,
    lateral: number,
    side: 'L' | 'R' | undefined,
    cell: { x: number; y: number },
    gate: SideGate,
    body?: () => void,
  ) => {
    // ceiling/floor fork on the POSE parity `-11434(A4)` (§4.7.7/§4.7.8)
    if (!gate.skipCeiling) emit(`ceil:${lane}:${depth}${altPose}`, 'side', depth, lateral, side, cell);
    body?.();
    if (!gate.skipFloor) {
      const floorKey = gate.altFloor ? `floor-alt:${lane}:${depth}${altPose}` : `floor:${lane}:${depth}${altPose}`;
      emit(floorKey, 'side', depth, lateral, side, cell);
    }
  };

  // `-0x47a4(a4)`, the current maze level — `evalOverlay`'s per-level
  // flagP/flagQ dispatch key (§4.7.9). `-1` (no `CellPlanes.level`) matches
  // no branch, i.e. behaves as "no overlay effect" — see `evalOverlay`'s own
  // doc comment.
  const level = planes.level ?? -1;

  let loopBound = MAX_LOOP_DEPTH;
  for (let depth = 0; depth < loopBound && depth < LANE_DEPTHS; depth++) {
    const cell = stepForward(x, y, facing, depth);

    const altD = altDepth(depth);

    // Every evaluator call the real EvalCellFace family makes this depth,
    // computed up front (unconditionally, matching the game — visibility
    // lanes gate the *draw*, not the evaluation) so their §4.7.9 overlay
    // effects can be combined into the three per-side gates below before
    // any lane is drawn. `*Overlay.fog` overrides its own evaluator's wall
    // code to 0 (open) and forces occlusion, per `evalOverlay`'s doc comment.
    const rawFront = evalCellFace(planes, cell.x, cell.y, facing, 0);
    const frontOverlay = evalOverlay(planes, level, cell.x, cell.y, facing, 0);
    const front = frontOverlay.fog ? 0 : rawFront;

    // Perpendicular faces (`0x969a`/`0x9876`): their own flagP early-return
    // only, never a gate or lane write (§4.7.10).
    const perpL = evalPerpFace(planes, cell.x, cell.y, facing, -1);
    const perpR = evalPerpFace(planes, cell.x, cell.y, facing, 1);

    const rawLatL = evalCellFace(planes, cell.x, cell.y, facing, -1);
    const latLOverlay = evalOverlay(planes, level, cell.x, cell.y, facing, -1);
    const latL = latLOverlay.fog ? 0 : rawLatL;

    const rawLatR = evalCellFace(planes, cell.x, cell.y, facing, 1);
    const latROverlay = evalOverlay(planes, level, cell.x, cell.y, facing, 1);
    const latR = latROverlay.fog ? 0 : rawLatR;

    // Three per-side ceiling/floor gates (§4.7.9/§4.7.10): the `0x9202`
    // handlers write slot `lateral + 1`, so front = the straight-ahead call
    // and left/right = the lateral-column calls alone.
    const frontGate = toGate(frontOverlay);
    const leftGate = toGate(latLOverlay);
    const rightGate = toGate(latROverlay);

    // The fog handler's third effect — clear the lanes of ITS OWN side at
    // this depth (CODE+0x932c-0x9384: lateral -1 -> the three left lanes,
    // 0 -> front, +1 -> the three right lanes) — applies immediately, before
    // this depth's own visibility checks below (distinct from the
    // occlusion-override, which affects *future* depths).
    if (frontOverlay.fog) hide(v.front, depth);
    if (latLOverlay.fog) {
      hide(v.sideL, depth);
      hide(v.left1, depth);
      hide(v.left2, depth);
    }
    if (latROverlay.fog) {
      hide(v.sideR, depth);
      hide(v.right1, depth);
      hide(v.right2, depth);
    }

    // Front wall — `0x9202` straight ahead, lane `-11432` (`0x0ab92`).
    // `0x9b58`'s per-code dispatch (§4.7.8): the preamble solid wall for
    // codes 2/>=7, the door pair for 5, feature pieces for 6-14, and the
    // deferred doorway/door-leaf records for 1/3/4.
    if (v.front[depth]) {
      emitLane('front', depth, 0, undefined, cell, frontGate, () => {
        if (depth >= MAX_WALL_DEPTH) return;
        const { now, deferred, cels } = frontKeys('front', front, depth, altD, torchFrame);
        for (const k of now) emit(k, 'front', depth, 0, undefined, cell);
        for (const k of deferred) deferredItems.push({ key: k, kind: 'front', depth, lateral: 0, side: undefined, cell });
        for (const c of cels) deferredItems.push({ key: c.key, kind: 'front', depth: c.tag, lateral: 0, side: undefined, cell, cel: true });
      });
      // Feature 6's floor overlay (0x0a0d0): front site, depth 1, drawn
      // straight after the plain floor (not on the alt-floor/skip paths).
      if (depth === 1 && frontOverlay.floorOverlay && !frontGate.skipFloor && !frontGate.altFloor)
        emit(`floor-overlay:front:1${altPose}`, 'side', depth, 0, undefined, cell);
    }
    loopBound = blockFront(v, depth, front, loopBound, frontOverlay.fog);

    // Receding side walls — the perpendicular faces (`0x969a`/`0x9876`) run
    // through `LAB_0506`'s own dispatch, both gated on the same `-11432`
    // lane as the front wall. `LAB_0506` carries no ceiling/floor of its
    // own; its pair draws fork on the POSE parity `-11434` (not the
    // per-depth `-11436`), §4.7.6.2/§4.7.8.
    if (v.front[depth]) {
      for (const k of sideKeys(perpL, depth, altPose)) {
        const [base, suffix] = k.endsWith(':alt') ? [k.slice(0, -4), ':alt'] : [k, ''];
        emit(`${base}:L:${depth}${suffix}`, 'side', depth, -1, 'L', cell);
      }
      const c = sideCel(perpL, depth, 'L', torchFrame);
      if (c) deferredItems.push({ key: c, kind: 'side', depth, lateral: -1, side: 'L', cell, cel: true });
    }
    blockPerpLeft(v, depth, perpL, frontOverlay.fog); // LAB_053B reads override slot 1 (-11365), written by the front call

    if (v.front[depth]) {
      for (const k of sideKeys(perpR, depth, altPose)) {
        const [base, suffix] = k.endsWith(':alt') ? [k.slice(0, -4), ':alt'] : [k, ''];
        emit(`${base}:R:${depth}${suffix}`, 'side', depth, 1, 'R', cell);
      }
      const c = sideCel(perpR, depth, 'R', torchFrame);
      if (c) deferredItems.push({ key: c, kind: 'side', depth, lateral: 1, side: 'R', cell, cel: true });
    }
    blockPerpRight(v, depth, perpR, frontOverlay.fog); // LAB_053E, same slot

    // `LAB_0528` left (`0x0aca2`, lane `-11392`) — ceiling/floor only.
    if (v.sideL[depth]) emitLane('side:L', depth, -1, 'L', cell, leftGate);

    // Lateral column faces — one evaluation per side (`0x9202` at lateral
    // ∓1), two draw sites each, one lane per site, each carrying its own
    // ceiling/floor run.
    const emitLatBody = (site: 'L1' | 'L2' | 'R1' | 'R2', code: number, lateral: number, side: 'L' | 'R') => {
      if (depth >= MAX_WALL_DEPTH || code === 0) return;
      const { now, deferred, cels } = frontKeys(site, code, depth, altD, torchFrame);
      for (const k of now) emit(k, 'side', depth, lateral, side, cell);
      for (const k of deferred) deferredItems.push({ key: k, kind: 'side', depth, lateral, side, cell });
      for (const c of cels) deferredItems.push({ key: c.key, kind: 'side', depth: c.tag, lateral, side, cell, cel: true });
    };

    if (v.left1[depth]) {
      emitLane('lat:L1', depth, -1, 'L', cell, leftGate, () => emitLatBody('L1', latL, -1, 'L'));
    }
    blockLeft1(v, depth, latL, latLOverlay.fog);
    if (v.left2[depth]) {
      emitLane('lat:L2', depth, -1, 'L', cell, leftGate, () => emitLatBody('L2', latL, -1, 'L'));
    }
    blockLeft2(v, depth, latL, latLOverlay.fog);

    if (v.right1[depth]) {
      emitLane('lat:R1', depth, 1, 'R', cell, rightGate, () => emitLatBody('R1', latR, 1, 'R'));
    }
    blockRight1(v, depth, latR, latROverlay.fog);
    if (v.right2[depth]) {
      emitLane('lat:R2', depth, 1, 'R', cell, rightGate, () => emitLatBody('R2', latR, 1, 'R'));
    }
    blockRight2(v, depth, latR, latROverlay.fog);

    // `LAB_0528` right (`0x0afd6`, lane `-11384`) — ceiling/floor only.
    if (v.sideR[depth]) emitLane('side:R', depth, 1, 'R', cell, rightGate);
  }

  // The deferred-draw queue is consumed after the whole depth loop, in
  // DESCENDING depth order (`0x0afe6`-`0x0b1ca`, the `-11438(A4)` countdown)
  // — i.e. the doorway/door-leaf pieces paint far-to-near on top of the
  // already-drawn walls, floors and ceilings, with `replace` blends.
  // Per depth tag the consumer makes two passes, each walking the queue
  // from the LAST pushed record to the first (D4 = count-1 .. 0): first the
  // kind-0xFF maze-piece records, then the `.PIC`-cel records. Tags above
  // the final loop bound are never reached (the countdown starts at
  // `-11440(A4)`).
  deferredItems.reverse();
  deferredItems.sort((a, b) => b.depth - a.depth || Number(a.cel ?? false) - Number(b.cel ?? false));
  for (const d of deferredItems) if (d.depth <= loopBound) emit(d.key, d.kind, d.depth, d.lateral, d.side, d.cell);

  return inGameOrder(items);
}

/**
 * `items` is already in the game's own draw order: the depth loop near to
 * far, then the queue consumer. `@seer-project/dungeon`'s `compositeDrawList`
 * re-sorts by painter's order (depth descending, side before front), which
 * is Black Crypt's rule, not this game's. Most W6 pieces are OR-blended,
 * so the order rarely shows. It does show for the replace/mask pieces,
 * e.g. a `.PIC` cel that front-floor OR draws would otherwise land on.
 * > **Correction (2026-11-22, game oracle):** found by the oracle sweep.
 * So each item's `kind`/`depth` becomes a painter rank (`depth` =
 * items-remaining), which makes the package's stable sort the identity.
 * The resolved kind/depth is appended to `origin` for debugging.
 */
function inGameOrder(items: DrawItem[]): DrawItem[] {
  return items.map((it, i) => ({
    ...it,
    kind: 'side',
    depth: items.length - i,
    origin: `${it.origin ?? ''} {${it.kind} d${it.depth}}`,
  }));
}

/**
 * Whether the party can step one cell in compass direction `dir` from
 * `(x, y)` — the game's own move path (`TryMove` CODE+0x116ac -> raw walls
 * `LAB_0792` -> `LAB_07AB`'s off-map / flagP / flagQ step handlers), ported
 * in `movement.ts`. Static: no kind-7 door states (unlocked) and no
 * levitation; `facing` defaults to `dir` (a forward step, which is what lets
 * a closed door open). The live walker uses `movement.ts` directly so it can
 * also apply door locks, teleports and the level-1 warp.
 */
export function canStepDir(
  planes: CellPlanes,
  x: number,
  y: number,
  dir: number,
  levelWidth: number,
  levelHeight: number,
  facing: number = dir,
  links?: Pick<W6LevelLinks, 'regionOrigin'>,
): boolean {
  const dest = stepForward(x, y, dir, 1);
  if (dest.x < 0 || dest.y < 0 || dest.x >= levelWidth || dest.y >= levelHeight) {
    // still run the port: an off-grid step is off-map (bounce / death), never a move
    return false;
  }
  return canStepStatic(planes, links, x, y, dir, facing);
}
