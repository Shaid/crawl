/**
 * Diffs castSpell (LAB_0F72, CODE+0x27132: anti-magic gate, success chance, fizzle / backfire, silence,
 * spell-point cost, stamina cost) against the game's routine under Unicorn with the effect dispatcher logged
 * (oracle/combat3.py cast). Committed subset: oracle/cast-vectors.json (W6_CAST_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { castSpell } from '../spells.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_CAST_VECTORS', 'cast-vectors.json');
const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

const body = (v: any, mem: any, rng: any) => {
  const fx: any[] = [];
  const ret = castSpell({ m: mem, rng, a4: v.a4 }, v.A, (A, spell, power) => fx.push(['spell_effect', hex32(A) + hex16(spell) + hex16(power)]));
  return { fx, ret };
};
const check = (v: any, r: any) => JSON.stringify(r.fx.fx) === JSON.stringify(v.effects) && r.fx.ret === v.ret;

describe.skipIf(V.length === 0)('cast gate LAB_0F72', () => {
  it('matches the game: bytes written (SP, flags), effect call, stamina cost, RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers party and monster casters, fizzles, backfires and silence', () => {
    const effects = V.filter((v) => v.effects.length > 0).length;
    expect(effects).toBeGreaterThan(V.length / 5);
    expect(V.some((v) => v.effects.length === 0)).toBe(true);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30000 || 1; }, check)).toBeGreaterThan(V.length / 4);
  });
  it('null control: a stronger caster skill changes some outcome', () => {
    const tweak = (v: any, m: any) => {
      const ai = m.u16(v.a4 - 15136);
      const P = v.a4 - 17922 + ai * 0x1b0;
      for (const k of [321, 333]) if (m.b.has(P + k)) m.b.set(P + k, 0);
    };
    expect(mismatches(V, body, tweak, check)).toBeGreaterThan(0);
  });
});
