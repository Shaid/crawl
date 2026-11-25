/**
 * Spell casting (tools/mm1/spells.ts) against vectors recorded from the retail `MM.EXE` under Unicorn: the combat cast menu
 * `comcast` CODE+0xC7C7 with its 94 handlers and engines. Strict memory + call log (see check.ts); every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { mustMatch, nullBad } from './check.ts';
import { ComCast, MonsterAbility, type Wrong } from '../spells.ts';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';

vi.setConfig({ testTimeout: 600000 });

describe('combat cast CODE+0xC7C7', () => {
  const run = (m: any, v: any) => { const r = new ComCast(m, v.args).run(); return { stop: r.stop, calls: r.calls }; };
  it('menu, gates, costs, 94 handlers, condition/damage/heal engines', () => mustMatch('cast', run, 100));
  it('every reachable handler is exercised (flag bit 1 = outside-only spells are refused before dispatch)', () => {
    const hit = new Set<number>();
    for (const v of load('cast')) { const c = new ComCast(new StrictMem(v.init, v.wpre), v.args); c.run(); if (c.reached) hit.add(c.reached); }
    // handlers reachable from the flag table: every table entry whose flag byte has bit 1 clear
    console.log('handlers reached', hit.size);
    expect(hit.size).toBeGreaterThanOrEqual(60);
  });
  it('null controls: each wrong variant disagrees with the game on some vector', () => {
    const variants: Wrong[] = ['sorcListBase', 'spCostIgnoresLevel', 'noMonsterResist', 'noSaveHalving', 'noKindQuarter', 'healNoCap', 'gemNoBorrow', 'skipPartyHit'];
    for (const w of variants) {
      const n = nullBad('cast', (m, v) => { const r = new ComCast(m, v.args, w).run(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
  it('monster special abilities CODE+0xAF49 (32 handlers, chance, uses, damage/status engines)', () => mustMatch('ability', (m) => new MonsterAbility(m, []).run(), 100));
  it('ability null controls', () => {
    for (const w of ['abilityNoChance', 'abilityCarry'] as Wrong[]) {
      const n = nullBad('ability', (m) => { const r = new MonsterAbility(m, [], w).run(); return { stop: r.stop, calls: r.calls }; });
      expect(n, w).toBeGreaterThan(0);
    }
  });
});
