/**
 * World rules (tools/mm1/world.ts) against vectors recorded from the retail `MM.EXE` under Unicorn: non-combat cast `qcast` CODE+0x8794.
 */
import { describe, expect, it, vi } from 'vitest';
import { mustMatch, nullBad } from './check.ts';
import { QCast, Surprise, Rest, Step, Pool, type WorldWrong } from '../world.ts';
import { UseItem } from '../spells.ts';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';

vi.setConfig({ testTimeout: 600000 });

describe('non-combat cast CODE+0x8794', () => {
  const run = (m: any, v: any) => { const r = new QCast(m, v.args).run(); return { stop: r.stop, calls: r.calls }; };
  it('menu, gates, costs, payment and the 45 handlers', () => mustMatch('qcast', run, 100));
  it('item use CODE+0x8619 (stat potions, item spells through 0x894F)', () => mustMatch('use', (m, v) => { const r = new QCast(m, v.args).runUse(); return { stop: r.stop, calls: r.calls }; }, 100));
  it('use null controls', () => {
    for (const w of ['useNoCharge', 'useStatNoAdd'] as WorldWrong[]) {
      const n = nullBad('use', (m, v) => { const r = new QCast(m, v.args, w).runUse(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
  it('combat item use CODE+0xC5FD (stat items, item spells through the shared cast tail 0xC95F)', () => mustMatch('useitem', (m, v) => { const r = new UseItem(m, v.args).runItem(); return { stop: r.stop, calls: r.calls }; }, 100));
  it('useitem null controls', () => {
    for (const w of ['itemNoCharge', 'itemKeepSpent'] as const) {
      const n = nullBad('useitem', (m, v) => { const r = new UseItem(m, v.args, w).runItem(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
  it('handlers exercised', () => {
    const hit = new Set<number>();
    for (const v of load('qcast')) { const c = new QCast(new StrictMem(v.init, v.wpre), v.args); c.run(); if (c.reachedHandler) hit.add(c.reachedHandler); }
    console.log('qcast handlers reached', hit.size);
    expect(hit.size).toBeGreaterThanOrEqual(30);
  });
  it('null controls', () => {
    const variants: WorldWrong[] = ['qcastNoBorrow', 'qcastHealNoCap', 'qcastResetNoRes', 'qcastAgeNoFloor'];
    for (const w of variants) {
      const n = nullBad('qcast', (m, v) => { const r = new QCast(m, v.args, w).run(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});

describe('encounter greeting CODE+0x3206 (surprise, attack / retreat / bribe / surrender)', () => {
  it('matches the game on every vector (strict reads, writes, UI calls, stop address)', () => mustMatch('surprise', (m, v) => { const r = new Surprise(m, v.args).run(); return { stop: r.stop, calls: r.calls }; }, 100));
  it('null controls', () => {
    for (const w of ['surprNoGoldWipe', 'surprRunNoParty', 'surprAlignNoClamp'] as const) {
      const n = nullBad('surprise', (m, v) => { const r = new Surprise(m, v.args, w).run(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});

describe('resting CODE+0x6EE5 / 0x6F98', () => {
  const run = (entry: 'rest' | 'okrest') => (m: any, v: any) => { const r = new Rest(m, v.args).run(entry); return { stop: r.stop, calls: r.calls }; };
  it('rest (prompt, ambush roll, healing, aging, food, spell points)', () => mustMatch('rest', run('rest'), 100));
  it('okrest', () => mustMatch('okrest', run('okrest'), 100));
  it('null controls', () => {
    for (const w of ['restNoHalve', 'restNoAge', 'restNoLevelCut', 'restKeepStatus'] as const) {
      const n = nullBad('okrest', (m, v) => { const r = new Rest(m, v.args, w).run('okrest'); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});

describe('moving CODE+0x4D7E (forward), 0x4E81 (back), 0x4F43 / 0x4F7A (turn)', () => {
  it('walls, doors, map edges, the encounter roll and turning match the game', () => mustMatch('step', (m, v) => { const r = new Step(m).run(v.args[0]); return { stop: r.stop, calls: r.calls }; }, 100));
  it('null controls', () => {
    for (const w of ['stepIgnoreDoorLayer', 'stepNoEncounterRoll'] as const) {
      const n = nullBad('step', (m, v) => { const r = new Step(m, w).run(v.args[0]); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});

describe('pooling the party CODE+0x74BC (gather) / 0x7763 (share)', () => {
  const run = (m: any, v: any) => { const ip = v.args[v.args.length - 1]; const r = new Pool(m, v.args.slice(0, -1)).run(ip === 0x74bc ? 'gather' : 'share'); return { stop: r.stop, calls: r.calls }; };
  it('gems, gold and food match the game on every vector', () => mustMatch('pool', run, 100));
  it('null controls', () => {
    for (const w of ['poolFoodNoCap', 'poolGoldNoSat', 'poolShareNoRemainder'] as const) {
      const n = nullBad('pool', (m, v) => { const ip = v.args[v.args.length - 1]; const r = new Pool(m, v.args.slice(0, -1), w).run(ip === 0x74bc ? 'gather' : 'share'); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});
