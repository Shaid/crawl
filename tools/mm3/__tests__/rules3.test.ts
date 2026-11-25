/**
 * Pass 3 ports (tools/mm3/rules3.ts) vs vectors recorded from the retail executable under Unicorn
 * (tools/mm3/rules_oracle/rules3.py): the cast command with the per-spell handlers (OV8), the combat spell engine
 * (OV4+0xE6EA) and the spell resolver against a monster (OV4+0x13282, mode != 0). Strict memory, RNG order, write sets
 * and logged callee calls must match; every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';
import * as R from '../rules3.ts';

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

/** spells whose handler is only a UI display (Identify Monster, Detect Monster): not ported, not asserted */
const UNPORTED = new Set([24, 37]);
const castRun = (o: R.CastOpts = {}): Run => (m, v) => R.castCommand(m, { keys: [...v.keys], nums: [...v.nums], walk: [...v.walk] }, o);
const skipUnported = (v: any) => UNPORTED.has(v.args[0]);

describe('cast command OV8+0x252E and the per-spell handlers (every spell 0..76 but the two UI displays)', () => {
  it('matches the game: gate, payment, refund on cancel, handler effects, logged callees, write sets', () => {
    const n = exact('cast', castRun(), { skip: skipUnported, min: 150 });
    expect(n).toBeGreaterThan(150);
  });
  it('every ported spell was exercised, including a successful cast', () => {
    const V = load('cast');
    for (let s = 0; s < 77; s++) {
      if (UNPORTED.has(s)) continue;
      const vs = V.filter((v: any) => v.args[0] === s);
      expect(vs.length, `spell ${s}`).toBeGreaterThanOrEqual(1);
      expect(vs.some((v: any) => v.ret === 1), `spell ${s} cast`).toBe(true);
    }
  });
  it('the handler table covers exactly the 75 ported spells', () => {
    for (let s = 0; s < 77; s++) expect(!!R.HANDLERS[s], `spell ${s}`).toBe(!UNPORTED.has(s));
  });
  it('null control: healing spells without the heal', () => differs('cast', castRun({ noHeal: true }), { skip: skipUnported }));
  it('null control: cancelling a picker without the refund', () => differs('cast', castRun({ noRefund: true }), { skip: skipUnported }));
  it('null control: combat area off by one', () => differs('cast', castRun({ areaPlusOne: true }), { skip: skipUnported }));
  it('null control: the world spells are castable in battle', () => differs('cast', castRun({ noCombatRefusal: true }), { skip: skipUnported }));
});

describe('combat spell engine OV4+0xE6EA (groups, ranks, single / group / all, arrow form)', () => {
  const run = (o: any = {}): Run => (m, v) => ({ calls: R.combatEngine(m, v.args[0], [...v.walk], o) });
  it('matches the game', () => { exact('engine', run(), { min: 50 }); });
  it('null control: no ranks behind the front one', () => differs('engine', run({ noRanks: true })));
  it('null control: stop after the first group', () => differs('engine', run({ stopAfterGroup: true })));
});

describe('spell against a monster OV4+0x13282 (magic resistance, kind lists, status, kill, half HP, arrow form)', () => {
  const run = (o: any = {}): Run => (m, v) => ({ calls: R.spellHit(m, v.caster, v.args[0], o) });
  it('matches the game', () => { exact('spellhit', run(), { min: 50 }); });
  it('null control: no magic resistance roll', () => differs('spellhit', run({ noMagi: true })));
  it('null control: monsters never save against status spells', () => differs('spellhit', run({ noSave: true })));
});

describe('battle round loop (R+0xC7F8 wipe test, R+0x12150 round over, R+0x12276 all down, R+0x12206 compaction, R+0x11FA0 loop)', () => {
  it('wipe test matches the game', () => { exact('wipecheck', (m) => { R.wipeCheck(m); return { calls: [] }; }, { min: 30 }); });
  it('round-over matches the game', () => { exact('roundover', (m) => ({ calls: [], ret: R.roundOver(m) }), { min: 30 }); });
  it('all-down matches the game', () => { exact('alldown', (m) => ({ calls: [], ret: R.allDown(m) }), { min: 30 }); });
  it('party order compaction matches the game', () => { exact('compact', (m) => { R.compactParty(m); return { calls: [] }; }, { min: 30 }); });
  const loop = (o: any = {}): Run => (m, v) => ({ calls: R.roundLoop(m, { wipe: [...v.wipe] }, o) });
  it('round loop matches the game (monster turns, command requests, round rollover, battle end)', () => { exact('roundloop', loop(), { min: 40 }); });
  it('null control: a wiped party does not end the battle', () => differs('roundloop', loop({ noWipeStop: true })));
  it('null control: downed members are not skipped', () => differs('roundloop', loop({ noSkipDown: true })));
  it('null control: wipe test with every condition counted as alive differs', () => differs('wipecheck', (m) => { R.wipeCheck(m); m.w8(0x207ffe - 0x3307, 0); return { calls: [] }; }));
  it('null control: round-over always true differs', () => differs("roundover", (_m) => ({ calls: [], ret: 1 })));
  it('null control: all-down always true differs', () => differs("alldown", (_m) => ({ calls: [], ret: 1 })));
  it('null control: no compaction differs', () => differs('compact', () => ({ calls: [] })));
});

describe('world clock OV4+0xFE5C, bank interest OV4+0xC9D4 and time passing OV4+0x10386', () => {
  it('clock matches the game (day rollover, 100-day year, flag clears, day/night redraw)', () => { exact('clock', (m, v) => ({ calls: R.advanceClock(m, v.args[0]) }), { min: 40 }); });
  it('interest matches the game (1% per bank balance)', () => { exact('interest', (m) => { R.bankInterest(m); return { calls: [] }; }, { min: 20 }); });
  it('time passing matches the game (ageing tick, counters, saves, countdowns, night change)', () => { exact('timepasses', (m, v) => ({ calls: R.timePasses(m, v.args[0], { save: [...v.resist], night: v.r10346 }) }), { min: 40 }); });
  it('null control: no 100-day year', () => differs('clock', (m, v) => ({ calls: R.advanceClock(m, v.args[0], { yearDays: 1000 }) })));
  it('null control: no interest', () => differs('clock', (m, v) => ({ calls: R.advanceClock(m, v.args[0], { noInterest: true }) })));
  it('null control: gold interest only', () => differs('interest', (m) => { R.bankInterest(m, { noGems: true }); return { calls: [] }; }));
  it('null control: no ageing tick', () => differs('timepasses', (m, v) => ({ calls: R.timePasses(m, v.args[0], { save: [...v.resist], night: v.r10346 }, { noAgeTick: true }) })));
  it('null control: no countdowns', () => differs('timepasses', (m, v) => ({ calls: R.timePasses(m, v.args[0], { save: [...v.resist], night: v.r10346 }, { noCountdown: true }) })));
});
