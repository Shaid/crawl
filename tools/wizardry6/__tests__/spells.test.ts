/**
 * Diffs tools/wizardry6/spells.ts (spell effect dispatcher LAB_0F06, group buff helper LAB_0EBA, strength
 * LAB_0E2A) against the game's own routine under Unicorn with the leaf engines stubbed and logged
 * (oracle/combat3.py spells). Committed subset: oracle/spell-vectors.json (W6_SPELL_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { buffCounter, castEffect, type Engines } from '../spells.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_SPELL_VECTORS', 'spell-vectors.json');
const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

function body(v: any, mem: any, rng: any, log: any[]) {
  const eng: Engines = {
    call(name, words) {
      log.push([name, words.map(hex16).join('')]);
      return v.ret[name] ?? 0;
    },
  };
  castEffect({ m: mem, rng, a4: v.a4 }, v.A, v.spell, v.power, eng);
  return log;
}
const check = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);
const run = (tweak?: (v: any, m: any, r: any) => void) => mismatches(V, (v, m, r) => body(v, m, r, []), tweak, check);

describe.skipIf(V.length === 0)('spell effect dispatcher LAB_0F06', () => {
  it('matches the game on every vector: bytes written, engine call log, RNG state', () => {
    expect(run()).toBe(0);
  }, 120_000);
  it('covers every ported spell id', () => {
    const ids = new Set(V.map((v) => v.spell));
    const want = Array.from({ length: 82 }, (_, i) => i);
    expect(want.filter((i) => !ids.has(i))).toEqual([]);
  });
  it('null control: another seed disagrees on the dice spells', () => {
    expect(run((_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30000 || 1; })).toBeGreaterThan(0);
  });
  it('null control: a different spell power disagrees', () => {
    const bad = mismatches(V, (v, m, r) => body({ ...v, power: (v.power % 6) + 1 }, m, r, []), undefined, check);
    expect(bad).toBeGreaterThan(V.length / 4);
  });
  it('buffCounter follows LAB_0EBA', () => {
    expect(buffCounter(15, 0, 0)).toBe(15);
    expect(buffCounter(15, 20, 0)).toBe(20);
    expect(buffCounter(5, -3, 0)).toBe(2);
    expect(buffCounter(5, 10, 1)).toBe(5);
    expect(buffCounter(5, 0, 1)).toBe(-5);
  });
});
