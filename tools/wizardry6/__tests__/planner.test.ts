/**
 * Diffs tools/wizardry6/planner.ts (the monster round planner LAB_0C63 / LAB_0C96) against vectors from
 * the game's own routines run under Unicorn (oracle/combat3.py planner|monsters). Committed subsets:
 * oracle/planner-vectors.json, oracle/planner-monsters-vectors.json; W6_PLANNER_VECTORS /
 * W6_PLANMON_VECTORS point at larger generated sets.
 */
import { describe, expect, it } from 'vitest';
import { groupCount, member, planGroup, planMonsters } from '../planner.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const P = loadVectors('W6_PLANNER_VECTORS', 'planner-vectors.json');
const M = loadVectors('W6_PLANMON_VECTORS', 'planner-monsters-vectors.json');

describe.skipIf(P.length === 0)('round planner LAB_0C63', () => {
  const body = (v: any, mem: any, rng: any) => planGroup({ m: mem, rng, a4: v.a4 }, v.g, v.tg);
  it('matches the game: bytes written and RNG state', () => {
    expect(mismatches(P, body)).toBe(0);
  });
  it('covers melee, spell and breath plans, healing spells and ally planning', () => {
    const acts = new Set<number>();
    let heal = 0;
    mismatches(P, (v, mem, rng) => {
      const c = { m: mem, rng, a4: v.a4 };
      planGroup(c, v.g, v.tg);
      for (let i = 0; i < groupCount(c, v.g); i++) {
        const A = member(c, v.g, i);
        acts.add(mem.u8(A + 30));
        if (mem.u8(A + 30) === 3 && mem.u8(v.a4 - 31694 + 6 * (mem.u8(A + 10 + 1))) === 1) heal++;
      }
    });
    for (const k of [0, 3, 8]) expect(acts.has(k)).toBe(true);
    expect(P.some((v) => v.g === 6)).toBe(true);
    expect(heal).toBeGreaterThan(0);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(P, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30000 || 1; })).toBeGreaterThan(P.length / 4);
  });
  it('null control: a changed spell chance disagrees', () => {
    const tweak = (v: any, m: any) => {
      const rec = m.u32(v.a4 - 15294 + 4 * v.g);
      m.b.set(rec + 168, (m.u8(rec + 168) + 40) & 0xff);
    };
    expect(mismatches(P, body, tweak)).toBeGreaterThan(0);
  });
});

describe.skipIf(M.length === 0)('monster round entry LAB_0C96', () => {
  const body = (v: any, mem: any, rng: any) => planMonsters({ m: mem, rng, a4: v.a4 });
  it('matches the game: bytes written and RNG state', () => {
    expect(mismatches(M, body)).toBe(0);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(M, body, (_v, _m, r) => { r.s[1] = (r.s[1] + 1) % 30000 || 1; })).toBeGreaterThan(M.length / 4);
  });
});
