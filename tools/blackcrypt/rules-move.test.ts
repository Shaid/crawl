import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret, norm } from './rules-move.interp';

const here = dirname(fileURLToPath(import.meta.url));
const V: { cases: { k: string; in: string; out: string }[] } = JSON.parse(
  gunzipSync(readFileSync(resolve(here, 'rules_oracle/vectors_move.json.gz'))).toString('utf8'));
const cases = (k: string) => V.cases.filter((c) => c.k === k);
const ws = (x: string) => x.replace(/\s+/g, ' ').trim();

describe('movement rules vs the real 68k routines', () => {
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
  for (const [k, min] of [['path', 100], ['act', 100], ['scan', 100], ['mover', 5], ['pursue', 100], ['approach', 100], ['wander', 100]] as const) {
    it(`null control (${k}): moving the party one square disagrees on many cases`, () => {
      let diff = 0;
      for (const c of cases(k)) if (ws(interpret(c.in, true)) !== norm(c.out, k === 'scan')) diff++;
      expect(diff).toBeGreaterThan(min);
    });
  }
});
