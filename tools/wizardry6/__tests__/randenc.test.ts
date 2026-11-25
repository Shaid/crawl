/** Diffs the random-encounter pick (LAB_0732 / LAB_072E) against the game under Unicorn (oracle/combat4.py encpick). */
import { describe, expect, it } from 'vitest';
import { encounterGroup, encounterMonster } from '../randenc.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_ENCPICK_VECTORS', 'encpick-vectors.json');
const body = (v: any, mem: any, rng: any) => {
  const c = { m: mem, rng, a4: v.a4 };
  return v.which === 'group' ? encounterGroup(c, v.arg) : encounterMonster(c, v.arg);
};
const ret = (v: any, r: any) => r.fx === v.ret;

describe.skipIf(V.length === 0)('random-encounter pick LAB_0732 / LAB_072E', () => {
  it('matches the game: return value, RNG state, nothing read outside the footprint', () => {
    expect(mismatches(V, body, undefined, ret)).toBe(0);
  }, 60_000);
  it('covers both routines and all three tiers', () => {
    expect(V.some((v) => v.which === 'group')).toBe(true);
    expect(V.some((v) => v.which === 'mon')).toBe(true);
  });
  it('null control: another seed, another level and another tier threshold all disagree', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[1] = (r.s[1] + 7) % 30307; }, ret)).toBeGreaterThan(V.length / 4);
    expect(mismatches(V, (v, m, r) => body({ ...v, arg: (v.arg + 1) % 12 }, m, r), undefined, ret)).toBeGreaterThan(V.length / 8);
  });
});
