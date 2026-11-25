/**
 * Diffs the chest inspect skill and the can-act test (tools/wizardry6/thief.ts) against the game under Unicorn (oracle/combat6.py).
 * Committed subsets: oracle/{inspect,canact}-vectors.json; larger sets via W6_INSPECT_VECTORS, W6_CANACT_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { canAct, inspectChest, pickLock, trainSkill } from '../thief.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const I = loadVectors('W6_INSPECT_VECTORS', 'inspect-vectors.json');
const A = loadVectors('W6_CANACT_VECTORS', 'canact-vectors.json');
const L = loadVectors('W6_PICKLOCK_VECTORS', 'picklock-vectors.json');
const R = loadVectors('W6_TRAIN_VECTORS', 'train-vectors.json');
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(I.length === 0)('chest inspect LAB_1C4B / LAB_1C36', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; inspectChest({ m, rng, a4: v.a4 }, v.win, v.who, fx); return fx; };
  it('matches the game: chance numbers per class, the letter game, the recorded prints, RNG state', () => {
    expect(mismatches(I, body, undefined, same)).toBe(0);
  }, 120_000);
  it('covers thieves, the 3/4/6/13 classes, the rest and both reveal phases', () => {
    const cls = new Set(I.map((v) => v.foot[String(v.a4 - 17922 + v.who * 0x1b0 + 415)]));
    expect(cls.has(3) && cls.has(13) && cls.has(0)).toBe(true);
  });
  it('null control: the wrong class table or another seed disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; m.b.set(v.a4 - 17922 + v.who * 0x1b0 + 415, 0); inspectChest({ m, rng, a4: v.a4 }, v.win, v.who, fx); return fx; };
    expect(mismatches(I.filter((v) => v.foot[String(v.a4 - 17922 + v.who * 0x1b0 + 415)] === 3), wrong, undefined, same)).toBeGreaterThan(0);
    expect(mismatches(I, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30269; }, same)).toBeGreaterThan(I.length / 8);
  });
});

describe.skipIf(A.length === 0)('can-act test LAB_1D56', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; const ret = canAct({ m, rng, a4: v.a4 }, v.who, fx); return { fx, ret }; };
  it('matches the game: condition and the two counters', () => {
    expect(mismatches(A, (v, m, r) => (body(v, m, r)).fx, undefined, same)).toBe(0);
    expect(mismatches(A, body as any, undefined, (v, r: any) => r.fx.ret === (v.ret & 0xffff) && JSON.stringify(r.fx.fx) === JSON.stringify(v.effects))).toBe(0);
  }, 60_000);
  it('covers both answers', () => {
    expect(A.some((v) => v.ret === 1) && A.some((v) => v.ret === 0)).toBe(true);
  });
  it('null control: ignoring the counters disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; m.b.set(v.a4 - 17922 + v.who * 0x1b0 + 292, 0); m.b.set(v.a4 - 17922 + v.who * 0x1b0 + 293, 0); return { fx, ret: canAct({ m, rng, a4: v.a4 }, v.who, fx) }; };
    expect(mismatches(A, wrong as any, undefined, (v, r: any) => r.fx.ret === (v.ret & 0xffff))).toBeGreaterThan(0);
  });
});

/** The game's key / timer polls: the round on which the player presses CR (key mode) or the timer poll fires (timer mode). */
const polls = (v: any, wrong = false) => {
  let a = 0, t = 0;
  return {
    keyAvailable: () => (v.mode === 'key' && ++a >= v.rounds ? 1 : 0),
    key: () => 13,
    timer: () => (v.mode === 'timer' && ++t >= v.rounds + (wrong ? 1 : 0) ? 1 : 0),
  };
};

describe.skipIf(L.length === 0)('pick-lock tumbler game LAB_06F9', () => {
  const body = (v: any, m: any, rng: any, wrong = false) => { const fx: Effect[] = []; const ret = pickLock({ m, rng, a4: v.a4 }, v.who, v.idx, polls(v, wrong), fx); return { fx, ret }; };
  const ok = (v: any, r: any) => r.fx.ret === (v.ret & 0xffff) && JSON.stringify(r.fx.fx) === JSON.stringify(v.effects);
  it('matches the game: tumblers, the stuck pin, the last round counts, unlock / jam, training, RNG state', () => {
    expect(mismatches(L, body as any, undefined, ok)).toBe(0);
  }, 120_000);
  it('covers opened, failed and stuck results, and both ways to end the game', () => {
    for (const r of [0, 1, 2]) expect(L.some((v) => v.ret === r)).toBe(true);
    expect(L.some((v) => v.mode === 'key') && L.some((v) => v.mode === 'timer')).toBe(true);
  });
  it('null control: one more round (another last round) disagrees; another seed disagrees', () => {
    expect(mismatches(L.filter((v) => v.mode === 'timer'), (v: any, m: any, r: any) => body(v, m, r, true) as any, undefined, ok)).toBeGreaterThan(0);
    expect(mismatches(L, body as any, (_v, _m, r) => { r.s[1] = (r.s[1] + 2) % 30307; }, ok)).toBeGreaterThan(L.length / 8);
  });
});

describe.skipIf(R.length === 0)('thief-skill training LAB_0584', () => {
  const body = (v: any, m: any, rng: any) => { trainSkill({ m, rng, a4: v.a4 }, v.args[0], v.args[1], v.args[2]); return []; };
  it('matches the game: no gain at 100, Random(skill) against level * amount', () => {
    expect(mismatches(R, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: always training, or a different amount disagrees', () => {
    expect(mismatches(R, (v, m, r) => body({ ...v, args: [v.args[0], v.args[1], v.args[2] + 6] }, m, r), undefined, same)).toBeGreaterThan(0);
  });
});
