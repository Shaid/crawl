/**
 * Diffs tools/wizardry6/engines.ts (area damage LAB_0E6C, area status LAB_0E7C / LAB_0E90, whole-side wrappers
 * LAB_0EA8 / LAB_0EB5 with LAB_0EAD, shields LAB_0E62 / LAB_0E66) against the game's routines under Unicorn,
 * SetStatus and the kill cleanup running for real (oracle/combat3.py engines). Committed subset:
 * oracle/engine-vectors.json (W6_ENGINE_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { areaDamage, areaStatus, areaStatus2, groupAll, groupDrain, groupPrismic, groupWeak } from '../engines.ts';
import type { Effect } from '../combat.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_ENGINE_VECTORS', 'engine-vectors.json');

const ENG: Record<string, (c: any, w: number[], fx: Effect[]) => void> = {
  area_dmg: areaDamage, area_stat: areaStatus, area_stat2: areaStatus2, grp_drain: groupDrain, grp_all: groupAll, grp_weak: groupWeak, grp_pm: groupPrismic,
};
const body = (v: any, mem: any, rng: any) => {
  const fx: Effect[] = [];
  ENG[v.eng]({ m: mem, rng, a4: v.a4 }, v.w.map((x: number) => (x < 0 ? x & 0xffff : x)), fx);
  return fx;
};
const check = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(V.length === 0)('spell engines (area damage / status / group wrappers)', () => {
  it('matches the game: bytes written, party-sync log, RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers every engine', () => {
    expect(new Set(V.map((v) => v.eng)).size).toBe(7);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[1] = (r.s[1] + 1) % 30000 || 1; }, check)).toBeGreaterThan(V.length / 4);
  });
  it('null control: a stronger resist modifier disagrees', () => {
    const tweak = (v: any, m: any) => {
      const rec = m.u32(v.a4 - 15294 + 4 * v.w[0]);
      for (let i = 0; i < 14; i++) if (m.b.has(rec + 0x94 + i)) m.b.set(rec + 0x94 + i, (m.u8(rec + 0x94 + i) + 30) & 0xff);
    };
    expect(mismatches(V, body, tweak, check)).toBeGreaterThan(0);
  });
});
