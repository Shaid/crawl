/**
 * Diffs the pass-5 actions against the game's routines under Unicorn (oracle/combat4.py): use item LAB_0F8A,
 * party swap LAB_0FDB, post-combat sort and outcome LAB_0A03. Committed subsets: oracle/{useitem,swap,postcombat}-vectors.json
 * (larger sets: W6_USEITEM_VECTORS, W6_SWAP_VECTORS, W6_POSTCOMBAT_VECTORS).
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { postCombat, restParty, stepTick, swapParty, tickMember, useItem } from '../itemuse.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const U = loadVectors('W6_USEITEM_VECTORS', 'useitem-vectors.json');
const S = loadVectors('W6_SWAP_VECTORS', 'swap-vectors.json');
const Q = loadVectors('W6_POSTCOMBAT_VECTORS', 'postcombat-vectors.json');
const T = loadVectors('W6_TICK_VECTORS', 'tick-vectors.json');
const R = loadVectors('W6_REST_VECTORS', 'rest-vectors.json');
const K = loadVectors('W6_STEPTICK_VECTORS', 'steptick-vectors.json');
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

const recOf = (v: any) => (id: number) => {
  const h: string | undefined = v.items[String(id)];
  if (!h) throw new Error('item not recorded');
  const b = (o: number) => parseInt(h.slice(2 * o, 2 * o + 2), 16);
  return { w28: (b(28) << 8) | b(29), b60: b(60), b69: b(69) };
};
const useBody = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; useItem({ m: mem, rng, a4: v.a4 }, v.A, recOf(v), fx); return fx; };

describe.skipIf(U.length === 0)('use item LAB_0F8A', () => {
  it('matches the game: bytes written, recorded callees (item removal, spell dispatch), RNG state', () => {
    expect(mismatches(U, useBody, undefined, same)).toBe(0);
  }, 60_000);
  it('covers consumption, casts, fizzles and backfires', () => {
    const fx = (v: any) => v.effects.map((e: any) => e[0]);
    expect(U.some((v) => fx(v).includes('spell_effect'))).toBe(true);
    expect(U.some((v) => fx(v).length === 1 && fx(v)[0] === 'use_ammo')).toBe(true);
    expect(U.some((v) => fx(v).length === 0)).toBe(true);
  });
  it('null control: a different RNG seed disagrees', () => {
    expect(mismatches(U, useBody, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30269; }, same)).toBeGreaterThan(0);
  });
  it('null control: ignoring the item record kind disagrees', () => {
    const wrong = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; useItem({ m: mem, rng, a4: v.a4 }, v.A, (id) => ({ ...recOf(v)(id), b60: 12 }), fx); return fx; };
    expect(mismatches(U, wrong, undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(S.length === 0)('party swap LAB_0FDB', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; swapParty({ m: mem, rng, a4: v.a4 }, v.a, v.b, fx); return fx; };
  it('matches the game: record, member struct and word-table exchanges', () => {
    expect(mismatches(S, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: swapping to the wrong position disagrees', () => {
    expect(mismatches(S, (v, m, r) => body({ ...v, b: (v.b + 1) % 4 }, m, r), undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(Q.length === 0)('post-combat sort and outcome LAB_0A03', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; postCombat({ m: mem, rng, a4: v.a4 }, fx); return fx; };
  it('matches the game: the sort, the wiped (8) and fled (0x17) outcomes', () => {
    expect(mismatches(Q, body, undefined, same)).toBe(0);
  }, 60_000);
  it('covers both outcomes', () => {
    const outcome = (v: any) => Object.entries(v.diff).filter(([a]) => Number(a) - v.a4 === -18607).map(([, b]) => b);
    expect(Q.some((v) => outcome(v).includes(8))).toBe(true);
    expect(Q.some((v) => outcome(v).includes(0x17))).toBe(true);
  });
  it('null control: without the sort the writes disagree', () => {
    const noSort = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; postCombat({ m: mem, rng, a4: v.a4 }, fx); return fx; };
    // flip the ordering byte of the first record after the port reads it: an unsorted port cannot match
    expect(mismatches(Q, noSort, (v, m) => { m.b.set(v.a4 - 17922 + 417, (m.b.get(v.a4 - 17922 + 417) ?? 0) ^ 1); }, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(T.length === 0)('member time tick LAB_07FA', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const [i, a, b, d, f] = v.args; tickMember({ m: mem, rng, a4: v.a4 }, i, a, b, d, f, fx); return fx; };
  it('matches the game: regen, poison, disease, death, exhaustion, timers, spell points', () => {
    expect(mismatches(T, body, undefined, same)).toBe(0);
  }, 60_000);
  it('covers a death, a skipped dead member and spell-point regeneration', () => {
    const a4 = (v: any) => v.a4;
    expect(T.some((v) => v.effects.length === 0)).toBe(true);
    expect(T.some((v) => Object.entries(v.diff).some(([a, b]) => (Number(a) - a4(v) + 17505) % 0x1b0 === 0 && b === 3))).toBe(true);
    expect(T.some((v) => v.args[4] === 1 && v.effects.length === 1)).toBe(true);
  });
  it('null control: a different elapsed time disagrees', () => {
    expect(mismatches(T, (v, m, r) => body({ ...v, args: [v.args[0], v.args[1], v.args[2], v.args[3] + 1, v.args[4]] }, m, r), undefined, same)).toBeGreaterThan(T.length / 5);
  });
});

describe.skipIf(R.length === 0)('camp LAB_0808', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const r = restParty({ m: mem, rng, a4: v.a4 }, fx); fx.push(['ret', String(r)]); return fx; };
  const same2 = (v: any, r: any) => JSON.stringify(r.fx.filter((e: any) => e[0] !== 'ret')) === JSON.stringify(v.effects) && r.fx[r.fx.length - 1][1] === String(v.ret);
  it('matches the game: clock, minute timers, per-member ticks, interruption chance', () => {
    expect(mismatches(R, body, undefined, same2)).toBe(0);
  }, 120_000);
  it('covers an interrupted and an uninterrupted rest', () => {
    expect(R.some((v) => v.ret === 1)).toBe(true);
    expect(R.some((v) => v.ret === 0)).toBe(true);
  });
  it('null control: a different seed disagrees', () => {
    expect(mismatches(R, body, (_v, _m, r) => { r.s[2] = (r.s[2] + 3) % 30323; }, same2)).toBeGreaterThan(R.length / 4);
  });
});

describe.skipIf(K.length === 0)('per-step world tick LAB_08AE', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const r = stepTick({ m: mem, rng, a4: v.a4 }, fx); fx.push(['fell', String(r)]); return fx; };
  const same2 = (v: any, r: any) => JSON.stringify(r.fx.filter((e: any) => e[0] !== 'fell')) === JSON.stringify(v.effects) && r.fx[r.fx.length - 1][1] === String(v.fell);
  it('matches the game: clock, hunger, ticks, wipe, forced camp, wandering encounter id', () => {
    expect(mismatches(K, body, undefined, same2)).toBe(0);
  }, 120_000);
  it('covers a quiet step, a wipe and a wandering encounter', () => {
    const state = (v: any) => Object.entries(v.diff).find(([a]) => Number(a) - v.a4 === -18609)?.[1];
    expect(K.some((v) => v.fell)).toBe(true);
    expect(K.some((v) => state(v) === 8)).toBe(true);
    expect(K.some((v) => state(v) === 10)).toBe(true);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(K, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 5) % 30269; }, same2)).toBeGreaterThan(K.length / 5);
  });
});
