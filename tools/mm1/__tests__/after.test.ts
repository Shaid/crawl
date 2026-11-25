/**
 * After-combat rules (tools/mm1/after.ts) against vectors recorded from the retail `MM.EXE` under Unicorn.
 */
import { describe, expect, it, vi } from 'vitest';
import { mustMatch, nullBad } from './check.ts';
import * as A from '../after.ts';

vi.setConfig({ testTimeout: 600000 });

describe('after combat', () => {
  it('treasure CODE+0xC3AD', () => mustMatch('treas', (m) => { A.treas(m); }));
  it('item drops CODE+0xC422 / 0xC532', () => mustMatch('treitem', (m) => { A.treItem(m); }));
  it('32-bit divide CODE+0x8386', () => mustMatch('divide', (m) => { A.divide(m); }));
  it('post-battle reset CODE+0xA1EA (resetsts, resetres, status mask, resallac)', () => mustMatch('resout', (m) => { A.resOut(m); }));
  it('battle won CODE+0x9FC1..0xA1BE (XP pool, treasure, split, resout)', () => mustMatch('victory', (m) => A.victory(m), 50));
  it('encounter group building CODE+0x2F87..0x3206 (budget, levels, types, group sizes, monster records)', () => mustMatch('encgen', (m) => A.encGen(m)));
  it('monster upkeep CODE+0xAD44 regenmon', () => mustMatch('regenmon', (m) => A.regenMon(m)));
  it('monster advance CODE+0xAC41 monadv', () => mustMatch('monadv', (m) => A.monAdvance(m)));
  it('run away CODE+0x9A17 (stops 0xA242 escaped / 0x9799 failed)', () => mustMatch('flee', (m) => A.flee(m)));
  it('end of round CODE+0x9F1A (initiative, AC, advance, upkeep)', () => mustMatch('roundend', (m) => A.roundEnd(m)));
  it('next monster + nerve check CODE+0x9A76..0x9B9D', () => mustMatch('monpick', (m) => A.monPick(m)));
  it('null controls', () => {
    const w = (n: string, f: (m: any, w: A.Wrong) => any, wr: A.Wrong) => expect(nullBad(n, (m) => f(m, wr)), n + ' ' + wr).toBeGreaterThan(0);
    w('treas', (m, x) => A.treas(m, x), 'gemOnBit1');
    w('treas', (m, x) => A.treas(m, x), 'goldHighByte');
    w('treitem', (m, x) => A.treItem(m, x), 'noLevelStep');
    w('divide', (m, x) => A.divide(m, x), 'divideNoBorrow');
    w('resout', (m, x) => A.resOut(m, x), 'maskLow');
    w('victory', (m, x) => A.victory(m, x), 'overflowAllBytes');
    w('victory', (m, x) => A.victory(m, x), 'countAll');
    w('victory', (m, x) => A.victory(m, x), 'xpPoolOnlyLow');
    w('encgen', (m, x) => A.encGen(m, x), 'budgetNoCap');
    w('encgen', (m, x) => A.encGen(m, x), 'noMinLevel');
    w('regenmon', (m, x) => A.regenMon(m, x), 'regenFour');
    w('regenmon', (m, x) => A.regenMon(m, x), 'clearAll');
    w('monadv', (m, x) => A.monAdvance(m, x), 'advanceAny');
    w('flee', (m, x) => A.flee(m, x), 'noRaise');
    w('roundend', (m, x) => A.roundEnd(m, x), 'levelCurrent');
    w('monpick', (m, x) => A.monPick(m, x), 'noFlee');
  });
});
