/**
 * Pass 2 ports (tools/mm3/rules2.ts) vs vectors recorded from the retail executable under Unicorn
 * (tools/mm3/rules_oracle/rules2.py). Strict memory, RNG order, write sets and logged callee calls must all match;
 * every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';
import * as R from '../rules2.ts';

vi.setConfig({ testTimeout: 180000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);
type Fn = (m: StrictMem, v: any) => any;
/** every vector: logged calls (when the unit logs them) + write set + return (when `ret`) must equal the game's */
function exact(name: string, fn: Fn, opts: { ret?: boolean; bits?: number; min?: number } = {}) {
  const V = load(name);
  expect(V.length).toBeGreaterThanOrEqual(opts.min ?? 20);
  for (const v of V) {
    const m = mem(v);
    const r = fn(m, v);
    const calls = Array.isArray(r) ? r : v.calls;
    if (JSON.stringify(calls) !== JSON.stringify(v.calls)) expect(calls, `${name} calls ${JSON.stringify(v.args)}`).toEqual(v.calls);
    if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) expect(m.changes(), `${name} writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
    if (opts.ret) {
      const mask = (opts.bits ?? 16) === 32 ? 0xffffffff : 0xffff;
      expect((((r as number) >>> 0) & mask) >>> 0).toBe(v.ret);
    }
  }
}
function differs(name: string, fn: Fn, opts: { ret?: boolean; bits?: number } = {}) {
  let bad = 0;
  for (const v of load(name)) {
    const m = mem(v);
    try {
      const r = fn(m, v);
      const calls = Array.isArray(r) ? r : v.calls;
      if (JSON.stringify(calls) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      else if (opts.ret && ((((r as number) >>> 0) & ((opts.bits ?? 16) === 32 ? 0xffffffff : 0xffff)) !== v.ret)) bad++;
    } catch { bad++; }
  }
  expect(bad).toBeGreaterThan(0);
}

describe('monster turn R+0xA1DC (target choice, hit chance, all-member attacks)', () => {
  it('matches the game (RNG order, logged hit/miss calls, wipe flags)', () => exact('monturn', (m, v) => R.monsterTurn(m, v.args[0])));
  it('null control: damage-type monsters roll to hit like the others', () => differs('monturn', (m, v) => R.monsterTurn(m, v.args[0], { noAutoHit: true })));
  it('null control: ignoring armour class', () => differs('monturn', (m, v) => R.monsterTurn(m, v.args[0], { flatAc: true })));
});

describe('turn order OV4+0x1307C (party Speed, monster Spd, current actor kept)', () => {
  it('matches the game', () => exact('initiative', (m) => { R.initiative(m); }));
  it('null control: slowest first', () => differs('initiative', (m) => { R.initiative(m, { ascending: true }); }));
});

describe('damage to a monster OV4+0x136E2 (resistance, element, kill rewards, loot roll, slot clearing)', () => {
  // the item generator R+0xB83A is stubbed in the harness; its stand-in writes a fixed pattern per treasure id
  const lootStub = (t: number, buf: number, m: StrictMem) => { [0x90, 0xa3, 0xb6, 0xc9, 0xdc, 0xef].forEach((off, k) => m.w8(buf + off, (t * 7 + k * 13 + 1) & 0xff)); };
  const run = (m: StrictMem, v: any, o = {}) => R.monsterDamage(m, v.char ?? 0x207ffe - 0xc78, v.args[0], v.args[1], (t, b) => lootStub(t, b, m), o);
  it('matches the game', () => exact('mondmg', (m, v) => run(m, v), { min: 20 }));
  it('null control: no physical resistance scaling', () => differs('mondmg', (m, v) => run(m, v, { noPhysResist: true })));
});

describe('item generator R+0xB83A (id by d100 x d100, 1-3 enchantment kinds, grade tables)', () => {
  const BUF = 0x207ffe - 0x2f8;
  it('matches the game (RNG order and every written byte)', () => exact('item', (m, v) => { R.generateItem(m, v.args[0], BUF, v.args[1]); }));
  it('null control: grade 6 treated as an ordinary grade', () => differs('item', (m, v) => { R.generateItem(m, v.args[0], BUF, v.args[1], { noSpecial: true }); }));
});

describe('spell cast gate (OV8+0x534 pay, OV8+0x5AA refund, OV4+0xB840 blocked, OV4+0xF10C price)', () => {
  it('pay: SP and party gems', () => exact('castpay', (m, v) => R.castPay(m, v.char, v.args[0]) as any, { ret: true }));
  it('refund', () => exact('castrefund', (m, v) => { R.castRefund(m, v.char, v.args[0]); }));
  it('blocked (conditions Asleep, Paralyzed .. Eradicated)', () => exact('castblock', (m, v) => { const r = R.castBlocked(m, v.char); return r.calls; }));
  it('blocked return value', () => { for (const v of load('castblock')) { const m = mem(v); expect(R.castBlocked(m, v.char).blocked).toBe(v.ret); } });
  it('SP cost OV4+0xF10C', () => exact('spellsp', (m, v) => R.spellSp(m, v.args[0], v.args[1]) as any, { ret: true, bits: 32 }));
  it('price OV4+0xF13E', () => exact('spellprice', (m, v) => R.spellPrice(m, v.args[0], v.args[1]) as any, { ret: true, bits: 32 }));
  it('null control: ignoring the gem cost', () => differs('castpay', (m, v) => R.castPay(m, v.char, v.args[0], { noGems: true }) as any, { ret: true }));
});
