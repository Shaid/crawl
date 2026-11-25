/**
 * Pass 4 ports (tools/mm3/rules4.ts) vs vectors recorded from the retail executable under Unicorn
 * (tools/mm3/rules_oracle/rules4.py): world rules. Strict memory, RNG order, write sets and logged callee calls must
 * match; every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem, A4V } from '../rules-mem.ts';
import * as R from '../rules4.ts';

vi.setConfig({ testTimeout: 240000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);
type Run = (m: StrictMem, v: any) => { calls: any[]; ret?: number };
function exact(name: string, run: Run, opts: { min?: number; skip?: (v: any) => boolean } = {}) {
  const V = load(name);
  expect(V.length).toBeGreaterThanOrEqual(opts.min ?? 100);
  let n = 0;
  for (const v of V) {
    if (opts.skip?.(v)) continue;
    const m = mem(v);
    const r = run(m, v);
    if (JSON.stringify(r.calls) !== JSON.stringify(v.calls)) expect(r.calls, `${name} calls ${JSON.stringify(v.args)}`).toEqual(v.calls);
    if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) expect(m.changes(), `${name} writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
    if (r.ret !== undefined) expect(r.ret, `${name} ret ${JSON.stringify(v.args)}`).toBe(v.ret);
    n++;
  }
  return n;
}
function differs(name: string, run: Run, opts: { skip?: (v: any) => boolean } = {}) {
  let bad = 0;
  for (const v of load(name)) {
    if (opts.skip?.(v)) continue;
    const m = mem(v);
    try {
      const r = run(m, v);
      if (JSON.stringify(r.calls) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin) || (r.ret !== undefined && r.ret !== v.ret)) bad++;
    } catch { bad++; }
  }
  expect(bad).toBeGreaterThan(0);
}

const restRun = (o: R.RestOpts = {}): Run => (m, v) => ({ calls: R.rest(m, { walk: [...v.walk], yn: [...v.yn], ticks: [...v.ticks] }, o) });
describe('rest R+0xFEA6', () => {
  it('matches the game: refusal, attribute prompt, ticks and interruption, time, food, restore, messages', () => {
    expect(exact('rest', restRun(), { min: 10 })).toBeGreaterThan(10);
  });
  it('covers each path', () => {
    const V = load('rest');
    const has = (f: (v: any) => boolean) => V.some(f);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'msg' && c[1][0] === 0x100a4))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'yesno') && !v.calls.some((c: any) => c[0] === 'tick'))).toBe(true);
    expect(has((v) => v.calls.filter((c: any) => c[0] === 'tick').length > 0 && !v.calls.some((c: any) => c[0] === 'timepass'))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'sprintf' && c[1][2] === 0x1011c))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'sprintf' && c[1][2] === 0x10138))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'timepass' && c[1][0] === 0x1e0))).toBe(true);
  });
  it('null controls differ: no food gate, no interruption, no sleep', () => {
    differs('rest', restRun({ noFoodGate: true }));
    differs('rest', restRun({ noInterrupt: true }));
    differs('rest', restRun({ noSleep: true }));
  });
});

const priceRun = (o: R.PriceOpts = {}): Run => (m, v) => ({ calls: [], ret: R.itemPrice(m, g0(v.args[0]), v.args[1], v.args[2], v.args[3], o) });
const g0 = (i: number) => A4V - 0xc78 + 0x130 * i;
describe('item price OV7+0x3CC', () => {
  it('matches the game: kind scaling, enchantment terms, sell flag, divisor, charges', () => {
    expect(exact('itemprice', priceRun(), { min: 10 })).toBeGreaterThan(10);
  });
  it('covers priced and unpriced items and every mode 0..6', () => {
    const V = load('itemprice');
    for (let mo = 0; mo <= 6; mo++) expect(V.some((v: any) => v.args[2] === mo && v.ret > 0)).toBe(mo > 0);
    expect(V.some((v: any) => v.args[2] === 2 && v.args[3] > 0x80 && v.ret > 0)).toBe(true);
  });
  it('null controls differ', () => {
    differs('itemprice', priceRun({ noBrokenZero: true }));
    differs('itemprice', priceRun({ ignoreDivisor: true }));
    differs('itemprice', priceRun({ noKindScale: true }));
  });
});
describe('item price text OV7+0x7E0', () => {
  it('matches the game: price or 1 above id 0x49, logged formatter calls', () => {
    const n = exact('itemprice2', (m, v) => R.itemPriceText(m, g0(v.args[0]), v.args[1], v.args[2], v.args[3], v.args[4]), { min: 10 });
    expect(n).toBeGreaterThan(10);
  });
});

describe('training hall OV5', () => {
  it('eligibility OV5+0x1C70 matches the game', () => {
    expect(exact('trainelig', (m) => R.trainEligibility(m, A4V - 0xc78), { min: 10 })).toBeGreaterThan(10);
  });
  it('eligibility covers shortfall, cap and offer; null controls differ', () => {
    const V = load('trainelig');
    for (const f of [0x1d20, 0x1d46, 0x1d67]) expect(V.some((v: any) => v.calls[0][1][1] === 0x2500000 + f)).toBe(true);
    differs('trainelig', (m) => R.trainEligibility(m, A4V - 0xc78, { noCap: true }));
    differs('trainelig', (m) => R.trainEligibility(m, A4V - 0xc78, { flatCost: true }));
  });
  it('level-up block OV5+0x1EEE matches the game: refusals, payment, XP rewrite, clock, HP/SP', () => {
    const V = load('levelup');
    let n = 0, ok = 0;
    for (const v of V) {
      const m = mem(v);
      const r = R.levelUp(m, g0(v.args[0]), v.args[0], v.d6, v.a5);
      expect(r.stop === 'ok', `stop ${JSON.stringify(v.args)}`).toBe(v.stop === 0x3a1e70);
      expect(r.calls).toEqual(v.calls);
      expect(m.changes()).toEqual(v.fin);
      n++; if (r.stop === 'ok') ok++;
    }
    expect(n).toBeGreaterThan(10); expect(ok).toBeGreaterThan(2);
  });
  it('level-up null controls differ: no payment, plain XP, no HP/SP restore', () => {
    for (const o of [{ noPay: true }, { plainXp: true }, { noMaxRestore: true }] as R.LevelUpOpts[]) {
      let bad = 0;
      for (const v of load('levelup')) {
        const m = mem(v);
        try { const r = R.levelUp(m, g0(v.args[0]), v.args[0], v.d6, v.a5, o); if (JSON.stringify(r.calls) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++; } catch { bad++; }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('traps, thievery, per-step tick', () => {
  const cc = A4V - 0xc78;
  it('thievery skill OV4+0xE65C matches the game; null controls differ', () => {
    expect(exact('thievery', (m) => ({ calls: [], ret: R.thievery(m, cc) }), { min: 10 })).toBeGreaterThan(10);
    differs('thievery', (m) => ({ calls: [], ret: R.thievery(m, cc, { noSkillGate: true }) }));
    differs('thievery', (m) => ({ calls: [], ret: R.thievery(m, cc, { noRace: true }) }));
  });
  const trap = (o: R.TrapOpts = {}): Run => (m, v) => ({ calls: R.trapDamage(m, v.args[0], v.args[1], v.args[2], o) });
  it('trap damage OV4+0xED8E matches the game: kinds, saves, element timers, power shield, target modes', () => {
    expect(exact('trapdmg', trap(), { min: 10 })).toBeGreaterThan(10);
    const V = load('trapdmg');
    for (let k = 0; k <= 7; k++) expect(V.some((v: any) => v.args[1] === k)).toBe(true);
  });
  it('trap damage null controls differ', () => {
    for (const o of [{ noPowerShield: true }, { noHalving: true }, { noElementTimer: true }] as R.TrapOpts[]) differs('trapdmg', trap(o));
  });
  it('per-step tick OV4+0x108EC matches the game', () => {
    expect(exact('steptick', (m) => ({ calls: R.stepTick(m) }), { min: 10 })).toBeGreaterThan(10);
  });
});
