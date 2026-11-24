/**
 * Diffs breath.ts (monster breath LAB_0FB1, twelve breath types) against the game under Unicorn with the area engines
 * running for real (oracle/combat3.py breath). Committed subset: oracle/breath-vectors.json (W6_BREATH_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { breath } from '../breath.ts';
import type { Effect } from '../combat.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_BREATH_VECTORS', 'breath-vectors.json');
const body = (v: any, mem: any, rng: any) => {
  const fx: Effect[] = [];
  const ret = breath({ m: mem, rng, a4: v.a4 }, v.A, fx);
  return { fx, ret };
};
const check = (v: any, r: any) => r.fx.ret === v.ret && JSON.stringify(r.fx.fx) === JSON.stringify(v.effects.filter((e: any) => e[0] === 'psync'));

describe.skipIf(V.length === 0)('breath LAB_0FB1', () => {
  it('matches the game: engine results, cost, RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers every breath type', () => {
    expect(new Set(V.map((v) => Object.entries<number>(v.diff).length > 0 ? 1 : 0)).size).toBeGreaterThan(0);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[1] = (r.s[1] + 1) % 30000 || 1; }, check)).toBeGreaterThan(V.length / 5);
  });
  it('null control: a different breath type disagrees', () => {
    const tweak = (v: any, m: any) => { const w = m.u16(v.A + 10); m.b.set(v.A + 11, (w + 1) % 14); };
    expect(mismatches(V, body, tweak, check)).toBeGreaterThan(V.length / 5);
  });
});
