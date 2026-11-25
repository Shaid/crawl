/**
 * Diffs the pass-5 actions against the game's routines under Unicorn (oracle/combat4.py): use item LAB_0F8A,
 * party swap LAB_0FDB, post-combat sort and outcome LAB_0A03. Committed subsets: oracle/{useitem,swap,postcombat}-vectors.json
 * (larger sets: W6_USEITEM_VECTORS, W6_SWAP_VECTORS, W6_POSTCOMBAT_VECTORS).
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { postCombat, swapParty, useItem } from '../itemuse.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const U = loadVectors('W6_USEITEM_VECTORS', 'useitem-vectors.json');
const S = loadVectors('W6_SWAP_VECTORS', 'swap-vectors.json');
const Q = loadVectors('W6_POSTCOMBAT_VECTORS', 'postcombat-vectors.json');
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
