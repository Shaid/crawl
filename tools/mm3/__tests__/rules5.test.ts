/**
 * Pass 5 ports (tools/mm3/rules5.ts) vs vectors recorded from the retail executable under Unicorn
 * (tools/mm3/rules_oracle/rules5.py): character creation. Strict memory, RNG order, write sets and logged callee calls must
 * match; every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem, A4V } from '../rules-mem.ts';
import * as R from '../rules5.ts';
import * as R2 from '../rules2.ts';

vi.setConfig({ testTimeout: 240000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);
type Run = (m: StrictMem, v: any) => { calls: any[]; ret?: number };
function exact(name: string, run: Run, opts: { min?: number } = {}) {
  const V = load(name);
  expect(V.length).toBeGreaterThanOrEqual(opts.min ?? 100);
  for (const v of V) {
    const m = mem(v);
    const r = run(m, v);
    if (JSON.stringify(r.calls) !== JSON.stringify(v.calls)) expect(r.calls, `${name} calls ${JSON.stringify(v.args)}`).toEqual(v.calls);
    if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) expect(m.changes(), `${name} writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
    if (r.ret !== undefined) expect(r.ret, `${name} ret ${JSON.stringify(v.args)}`).toBe(v.ret);
  }
  return V.length;
}
function differs(name: string, run: Run) {
  let bad = 0;
  for (const v of load(name)) {
    const m = mem(v);
    try {
      const r = run(m, v);
      if (JSON.stringify(r.calls) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin) || (r.ret !== undefined && r.ret !== v.ret)) bad++;
    } catch { bad++; }
  }
  expect(bad).toBeGreaterThan(0);
}

describe('class requirements OV6+0x48C', () => {
  const run = (o = {}): Run => (m, v) => { R.classRequirements(m, v.args[0], v.args[1], o); return { calls: [] }; };
  it('matches the game for all ten classes, signed compares', () => {
    expect(exact('classreq', run(), { min: 10 })).toBeGreaterThan(10);
  });
  it('covers every class both eligible and not; null control (unsigned compare) differs', () => {
    const V = load('classreq');
    for (let k = 0; k < 10; k++) {
      expect(V.some((v: any) => v.fin[String(v.args[1] + k)] === 1 || (v.wpre[String(v.args[1] + k)] === 1 && v.fin[String(v.args[1] + k)] === undefined && !v.init[String(v.args[1] + k)]))).toBe(true);
    }
    differs('classreq', run({ unsigned: true }));
  });
});
describe('roll OV6+0x5FE', () => {
  const run = (o = {}): Run => (m, v) => { R.rollStats(m, v.args[0], v.args[1], o); return { calls: [] }; };
  it('matches the game: three passes of rand(10,0x4F)/10 per attribute, seed order, class flags', () => {
    expect(exact('rollstats', run(), { min: 10 })).toBeGreaterThan(10);
  });
  it('null controls differ: two passes, divisor 9', () => {
    differs('rollstats', run({ passes: 2 }));
    differs('rollstats', run({ divisor: 9 }));
  });
});
describe('build the character OV6+0x1A0', () => {
  const run = (o: R.BuildOpts = {}): Run => (m, v) => R.buildCharacter(m, { name: v.name }, v.args[0], v.args[1], v.args[2], v.args[3], v.args[4], v.args[5], o);
  it('matches the game: refusals, empty name, record fields, spell flags, skills, max HP/SP', () => {
    expect(exact('cbuild', run(), { min: 10 })).toBeGreaterThan(10);
  });
  it('covers refusal, empty name and success for every class; null controls differ', () => {
    const V = load('cbuild');
    expect(V.some((v: any) => v.args[0] === 0xff && v.ret === 0)).toBe(true);
    expect(V.some((v: any) => v.args[0] !== 0xff && v.args[2] !== 0xff && v.name.length === 0 && v.ret === 0)).toBe(true);
    for (let k = 0; k < 10; k++) expect(V.some((v: any) => v.args[0] === k && v.ret === 1)).toBe(true);
    differs('cbuild', run({ noClassSkill: true }));
    differs('cbuild', run({ noMaxes: true }));
    differs('cbuild', run({ noRaceRes: true }));
  });
});

describe('map event executor OV4+0xE16E', () => {
  const run = (o: R.EventOpts = {}): Run => (m, v) => {
    const a = v.args;
    return R.eventActions(m, { picks: [...v.picks], cb: [...v.cb] }, [[a[0], a[1]], [a[2], a[3]], [a[4], a[5]]], a[6], o);
  };
  it('matches the game: lock gate, trap, pick roll, XP, mode, the reward actions and the script executor', () => {
    expect(exact('event', run(), { min: 10 })).toBeGreaterThan(10);
  });
  it('covers each path; null controls differ', () => {
    const V = load('event');
    const has = (f: (v: any) => boolean) => V.some(f);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'trap'))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'cue'))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'msg'))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'itemgen'))).toBe(true);
    expect(has((v) => v.calls.some((c: any) => c[0] === 'script'))).toBe(true);
    differs('event', run({ noTrap: true }));
    differs('event', run({ noXp: true }));
  });
});

describe('OV7 item command: shop flows', () => {
  const run = (o: R.ShopOpts = {}): Run => (m, v) => R.shopFlow(m, { yn: [...v.yn] }, v.args[0], A4V - 0xc78 + 0x130 * v.args[1], v.args[3], v.args[4], v.a5, o);
  it('matches the game for sell, repair, identify, buy, recharge, discard: messages, payment, item moves, RNG', () => {
    const V = load('shopop');
    expect(V.length).toBeGreaterThan(50);
    for (const v of V) {
      const m = mem(v);
      const r = run()(m, v);
      expect(r.calls, `calls ${JSON.stringify(v.args)}`).toEqual(v.calls);
      expect(m.changes(), `writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
      expect(r.ret === 2, `stop ${JSON.stringify(v.args)}`).toBe(v.stop === 0x3e3ffc);
      if (r.ret === 2) expect(v.ret & 0xffff).toBe(2);
    }
  });
  it('covers each operation and outcome; null controls differ', () => {
    const V = load('shopop');
    for (const op of ['sell', 'repair', 'identify', 'buy', 'recharge', 'discard', 'duplicate']) expect(V.some((v: any) => v.args[0] === op)).toBe(true);
    const has = (op: string, f: (v: any) => boolean) => V.some((v: any) => v.args[0] === op && f(v));
    expect(has('sell', (v) => v.calls.some((c: any) => c[0] === 'remove'))).toBe(true);
    expect(has('buy', (v) => v.calls.some((c: any) => c[0] === 'short'))).toBe(true);
    expect(has('buy', (v) => v.calls.some((c: any) => c[0] === 'remove'))).toBe(true);
    expect(has('recharge', (v) => v.calls.some((c: any) => c[0] === 'msg'))).toBe(true);
    expect(has('repair', (v) => v.calls.some((c: any) => c[0] === 'msg'))).toBe(true);
    differs('shopop', run({ noSellFlag: true }));
    differs('shopop', run({ noCap: true }));
    differs('shopop', run({ noBrokenBit: true }));
  });
});

describe('damage to a monster OV4+0x136E2 composed with the real item generator R+0xB83A', () => {
  // pass 2 stubbed the generator with a fixed pattern; here the game's own generator runs (RNG draws, item bytes) and the port calls generateItem
  const run = (o: { skipGen?: boolean } = {}): Run => (m, v) => {
    const c = R2.monsterDamage(m, v.char ?? A4V - 0xc78, v.args[0], v.args[1], (ty, b) => { if (!o.skipGen) R2.generateItem(m, ty, b, 0); });
    return { calls: c.filter((x: any) => x[0] !== 'loot') };
  };
  it('matches the game: loot roll, generator RNG order, the six item bytes, reward list', () => {
    expect(exact('mondmgfull', run(), { min: 20 })).toBeGreaterThan(20);
  });
  it('covers generated items; null control (generator skipped) differs', () => {
    const V = load('mondmgfull');
    expect(V.filter((v: any) => v.fin[String(A4V - 0x2f8 + 0xdc)] !== undefined || v.wpre[String(A4V - 0x2f8 + 0xdc)] !== undefined).length).toBeGreaterThan(5);
    differs('mondmgfull', run({ skipGen: true }));
  });
});

describe('OV7 Enchant Item entry 0x4A7E', () => {
  const run = (o: R.EnchantOpts = {}): Run => (m, v) => ({ calls: R.enchantItem(m, A4V - 0xc78 + 0x130 * v.args[0], v.args[2], v.a5, o) });
  it('matches the game: eligibility, grade roll, the real item generator, id restored', () => {
    expect(exact('enchant', run(), { min: 20 })).toBeGreaterThan(20);
  });
  it('covers success and refusal; null control (no cap) differs', () => {
    const V = load('enchant');
    expect(V.some((v: any) => v.calls.length === 1 && v.calls[0][0] === 'cue')).toBe(true);
    expect(V.some((v: any) => v.calls.length === 3)).toBe(true);
    differs('enchant', run({ noCap: true }));
  });
});

describe('weapon breaking R+0x122DE', () => {
  it('matches the game: ids below 0x1E that are equipped get the broken bit', () => {
    expect(exact('breakweapons', (m) => { R.breakWeapons(m, A4V - 0xc78); return { calls: [] }; }, { min: 20 })).toBeGreaterThan(20);
    differs('breakweapons', (m) => { R.breakWeapons(m, A4V - 0xc78, { allIds: true }); return { calls: [] }; });
  });
});
describe('encounter-start volley R+0xC5FA', () => {
  const run = (o: R.VolleyOpts = {}): Run => (m, v) => ({ calls: R.encounterVolley(m, { resource: [...v.res] }, o) });
  it('matches the game: picture class and cache, cue, party order reset, one turn per listed monster, wipe test, mode 5 -> 1', () => {
    expect(exact('volley', run(), { min: 20 })).toBeGreaterThan(20);
  });
  it('covers the picture, cache and mode switch; null controls differ', () => {
    const V = load('volley');
    expect(V.some((v: any) => v.calls.some((c: any) => c[0] === 'free'))).toBe(true);
    expect(V.some((v: any) => v.calls.some((c: any) => c[0] === 'resource'))).toBe(true);
    expect(V.some((v: any) => v.fin[String(A4V - 0x104a)] === 1)).toBe(true);
    differs('volley', run({ noWipeTest: true }));
    differs('volley', run({ noModeRestore: true }));
    differs('volley', run({ alwaysIdentity: true }));
  });
});
