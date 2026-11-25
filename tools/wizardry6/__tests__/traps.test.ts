/**
 * Diffs the chest trap code (tools/wizardry6/traps.ts) against the game under Unicorn (oracle/combat6.py): the 15 trap
 * effects LAB_1C0D, damage LAB_1BFC, status counters LAB_1C02, instant conditions LAB_1BF8 and the trap picker LAB_1C31.
 * Committed subsets: oracle/{trap,dmg,status,cond,pick}-vectors.json; larger sets via W6_TRAP_VECTORS, W6_DMG_VECTORS,
 * W6_STATUS_VECTORS, W6_COND_VECTORS, W6_PICK_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { applyStatus, chestTrap, damageMember, instantCond, pickTrap } from '../traps.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const T = loadVectors('W6_TRAP_VECTORS', 'trap-vectors.json');
const D = loadVectors('W6_DMG_VECTORS', 'dmg-vectors.json');
const S = loadVectors('W6_STATUS_VECTORS', 'status-vectors.json');
const C = loadVectors('W6_COND_VECTORS', 'cond-vectors.json');
const K = loadVectors('W6_PICK_VECTORS', 'pick-vectors.json');
const ctx = (v: any, m: any, rng: any) => ({ m, rng, a4: v.a4 });
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(T.length === 0)('chest trap effects LAB_1C0D', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; chestTrap(ctx(v, m, rng), v.args[0], v.args[1], fx); return fx; };
  it('matches the game: every byte written, the presentation calls in order, RNG state, nothing read outside the footprint', () => {
    expect(mismatches(T, body, undefined, same)).toBe(0);
  }, 120_000);
  it('covers all 15 trap ids, the no-trap id and ids past the table', () => {
    const ids = new Set(T.map((v) => v.args[0]));
    for (let i = 0; i < 16; i++) expect(ids.has(i)).toBe(true);
    expect([...ids].some((i) => i >= 16)).toBe(true);
    expect(T.some((v) => v.effects.some((e: any) => e[0] === 'jt-32634' && e[1] !== '0002' && e[1] !== '0000'))).toBe(true);
  });
  it('null control: swapping the dice of traps 1 and 14, or another seed, disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; chestTrap(ctx(v, m, rng), v.args[0] === 1 ? 14 : v.args[0], v.args[1], fx); return fx; };
    expect(mismatches(T.filter((v) => v.args[0] === 1), wrong, undefined, same)).toBeGreaterThan(0);
    expect(mismatches(T, body, (_v, _m, r) => { r.s[2] = (r.s[2] + 5) % 30323; }, same)).toBeGreaterThan(T.length / 8);
  });
});

describe.skipIf(D.length === 0)('member damage LAB_1BFC', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; damageMember(ctx(v, m, rng), v.args[0], v.args[1], v.args[2], fx); return fx; };
  it('matches the game: dice, HP cap, death through the condition helper', () => {
    expect(mismatches(D, body, undefined, same)).toBe(0);
  }, 60_000);
  it('covers deaths and survivors', () => {
    expect(D.some((v) => v.effects.some((e: any) => e[0] === 'jt-32634' && e[1] !== '0002'))).toBe(true);
    expect(D.some((v) => v.effects.some((e: any) => e[0] === 'jt-32634' && e[1] === '0002'))).toBe(true);
  });
  it('null control: sides and count swapped disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; damageMember(ctx(v, m, rng), v.args[0], v.args[2], v.args[1], fx); return fx; };
    expect(mismatches(D, wrong, undefined, same)).toBeGreaterThan(D.length / 8);
  });
});

describe.skipIf(S.length === 0)('status counter LAB_1C02', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; const a = v.args; applyStatus(ctx(v, m, rng), a[0], a[1], a[2], a[3], a[4], a[5], a[6], fx); return fx; };
  it('matches the game: resist roll, permanent (0xff), the 250 cap, the poison level byte', () => {
    expect(mismatches(S, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: no cap at 250 disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; const a = v.args; applyStatus(ctx(v, m, rng), a[0], a[1], a[2], a[3], a[4], a[5], a[6], fx); return fx; };
    expect(mismatches(S, wrong, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30269; }, same)).toBeGreaterThan(S.length / 8);
  });
});

describe.skipIf(C.length === 0)('instant condition LAB_1BF8', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; const a = v.args; instantCond(ctx(v, m, rng), a[0], a[1], a[2], a[3], fx); return fx; };
  it('matches the game: resist roll, no downgrade, death zeroes HP and stamina', () => {
    expect(mismatches(C, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: always applying (no downgrade check) disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; const a = v.args; m.w8(v.a4 - 17922 + a[0] * 0x1b0 + 417, 0); instantCond(ctx(v, m, rng), a[0], a[1], a[2], a[3], fx); return fx; };
    expect(mismatches(C, wrong, undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(K.length === 0)('trap picker LAB_1C31', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; pickTrap(ctx(v, m, rng), v.chest, fx); return fx; };
  it('matches the game: the (Random(100)+1)-th set bit of the chest mask, cycling', () => {
    expect(mismatches(K, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: a one-based id disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; pickTrap(ctx(v, m, rng), v.chest, fx); m.w16(v.a4 - 3236, m.u16(v.a4 - 3236) + 1); return fx; };
    expect(mismatches(K, wrong, undefined, same)).toBeGreaterThan(0);
  });
});
