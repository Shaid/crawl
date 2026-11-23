import { describe, it, expect } from 'vitest';
import { interpret, norm } from './rules-move.interp';
import { loadVectors, scaled } from './rules-vectors';

// full set when rules_oracle/gen_vectors.sh has been run, else the small committed subset
const { data: V, full: FULL } = loadVectors<{ cases: { k: string; in: string; out: string }[] }>('move');
const cases = (k: string) => V.cases.filter((c) => c.k === k);
const ws = (x: string) => x.replace(/\s+/g, ' ').trim();

describe(`movement rules vs the real 68k routines (${FULL ? 'full generated set' : 'small committed subset'})`, () => {
  for (const [k, label] of [
    ['enter', 'square-enter test + position mask'], ['path', 'pathfinder'], ['adj', 'adjacent candidates'], ['pick', 'direction pick'],
    ['mover', 'mover + stacking'], ['ray', 'ray scan'], ['act', 'monster act (melee, bolts, hold, special, turn-toward)'],
    ['scan', 'activation scan + type-10 switch'], ['pursue', 'pursue step (+0xA664)'], ['approach', 'caster approach step (+0x940C)'], ['wander', 'wander step (+0x9626)'],
  ] as const) {
    it(`${label} (${cases(k).length} cases) exact`, () => {
      let bad = 0; let first = '';
      for (const c of cases(k)) {
        const got = ws(interpret(c.in));
        const want = norm(c.out, k === 'scan');
        if (got !== want) { bad++; if (bad <= 3) first += `${got}\n!= ${want}\n`; }
      }
      if (first) console.log(first);
      expect(bad).toBe(0);
    });
  }
  const FULL_N: Record<string, number> = { path: 1500, act: 7500, scan: 1500, mover: 2100, pursue: 1500, approach: 1500, wander: 1500 };
  for (const [k, min] of [['path', 100], ['act', 100], ['scan', 100], ['mover', 5], ['pursue', 100], ['approach', 100], ['wander', 100]] as const) {
    it(`null control (${k}): moving the party one square disagrees on many cases`, () => {
      let diff = 0;
      for (const c of cases(k)) if (ws(interpret(c.in, true)) !== norm(c.out, k === 'scan')) diff++;
      expect(diff).toBeGreaterThan(scaled(min, cases(k).length, FULL_N[k]));
    });
  }
});
