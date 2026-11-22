/**
 * Route planning on the CONT grids for oracle walks (`captureLegWalk`):
 * breadth-first over (region, row, col, facing) with the title's own
 * `stepFrom` and step test (`enterCell`, which also applies passages), plus
 * `extraBlocked` (cells the game refused during the walk) and `occupied`
 * (monsters standing on cells). Returns the
 * actions and the state each one should leave.
 */
import { isharContOf, type IsharOccupancy, type IsharPartyState, type IsharTitleSpec } from '../../shared/ishar-scene.ts';
import type { WalkAction } from './alis-oracle.ts';
import { enterCell } from './compare.ts';

export type CellKey = string;
export const cellKey = (region: number, row: number, col: number): CellKey => `${region}:${row}:${col}`;

export function planRoute(
  spec: IsharTitleSpec,
  layers: (region: number) => readonly Uint8Array[] | undefined,
  from: IsharPartyState,
  goal: (s: IsharPartyState) => boolean,
  extraBlocked: ReadonlySet<CellKey> = new Set(),
  maxNodes = 400_000,
  /** Monsters known to stand on cells (GERDEP's monster check; e.g. `stepOccupancy` of the last step). */
  occupied?: IsharOccupancy,
  /** Cells the route must not enter although the game allows it (e.g. inside a monster's attack range, `ishar1Danger`). */
  avoid?: IsharOccupancy,
): { actions: WalkAction[]; states: IsharPartyState[] } | null {
  const forward = (s: IsharPartyState): IsharPartyState | null => {
    const t = spec.stepFrom(s, s.facing);
    if (!t || extraBlocked.has(cellKey(t.region, t.row, t.col)) || !layers(isharContOf(spec, t.region)) || avoid?.(t.region, t.row, t.col)) return null;
    return enterCell(spec, layers, s, t, occupied);
  };
  const key = (s: IsharPartyState) => `${s.region}:${s.row}:${s.col}:${s.facing}`;
  const prev = new Map<string, { k: string; a: WalkAction; s: IsharPartyState } | null>([[key(from), null]]);
  const queue: IsharPartyState[] = [from];
  for (let qi = 0; qi < queue.length && prev.size < maxNodes; qi++) {
    const s = queue[qi]!;
    if (goal(s)) {
      const actions: WalkAction[] = [];
      const states: IsharPartyState[] = [];
      for (let k = key(s); prev.get(k); k = prev.get(k)!.k) {
        actions.push(prev.get(k)!.a);
        states.push(prev.get(k)!.s);
      }
      return { actions: actions.reverse(), states: states.reverse() };
    }
    const next: Array<[WalkAction, IsharPartyState | null]> = [
      ['F', forward(s)],
      ['L', { ...s, facing: ((s.facing + 3) & 3) as 0 | 1 | 2 | 3 }],
      ['R', { ...s, facing: ((s.facing + 1) & 3) as 0 | 1 | 2 | 3 }],
    ];
    for (const [a, n] of next) {
      if (!n) continue;
      const k = key(n);
      if (prev.has(k)) continue;
      prev.set(k, { k: key(s), a, s: n });
      queue.push(n);
    }
  }
  return null;
}
