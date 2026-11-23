/**
 * Diffs tools/wizardry6/round.ts (round driver LAB_102D, action executor LAB_0FF9, retarget helpers) against
 * the game's own routines under Unicorn (oracle/combat3.py round), with the action callees (attack, cast,
 * breath, item, hide, run, swap, party sync, group clouds) stubbed and logged. Committed subset:
 * oracle/round-vectors.json; W6_ROUND_VECTORS points at a larger set.
 */
import { describe, expect, it } from 'vitest';
import { runRound } from '../round.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_ROUND_VECTORS', 'round-vectors.json');

const body = (v: any, mem: any, rng: any) => runRound({ m: mem, rng, a4: v.a4 }, v.ret);
const check = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(V.length === 0)('combat round driver LAB_102D + LAB_0FF9', () => {
  it('matches the game: bytes written, effect log (order of play), RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers every action kind, the group clouds, blinking and retargeting', () => {
    const names = new Set(V.flatMap((v) => v.effects.map((e: any) => e[0])));
    for (const n of ['attack', 'cast', 'breath', 'useitem', 'hide', 'run', 'swap', 'psync', 'area_dmg', 'area_status']) {
      expect(names.has(n)).toBe(true);
    }
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[2] = (r.s[2] + 1) % 30000 || 1; }, check)).toBeGreaterThan(V.length / 4);
  });
  it('null control: a changed initiative slot changes the log', () => {
    const tweak = (_v: any, m: any) => {
      const base = 0x400000 + 0x400 * 1;
      m.b.set(base + 24, (m.u8(base + 24) + 7) & 0xff);
    };
    expect(mismatches(V, body, tweak, check)).toBeGreaterThan(0);
  });
});
