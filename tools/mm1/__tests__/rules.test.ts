/**
 * Diffs tools/mm1/rules.ts against vectors recorded from the retail DOS `MM.EXE` under Unicorn
 * (tools/mm1/rules_oracle/rules.py). Small subsets are committed (rules_oracle/vectors/); full sets regenerate into the
 * gitignored generated/ and are used when present. Strict memory: the port may only read bytes the game read; writes must
 * equal the game's write set; stubbed UI callee calls must match. Every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { mustMatch, nullBad } from './check.ts';
import * as R from '../rules.ts';

vi.setConfig({ testTimeout: 180000 });

describe('RNG CODE+0x451B random', () => {
  it('matches the game (AL result, 32-bit state, mask, retry byte)', () => mustMatch('random', (m, v) => ({ ax: R.random(m, v.args[0]) }), 50));
  it('null control: rejected draw re-shifts by the bit count instead of the scratch byte', () => {
    expect(nullBad('random', (m, v) => ({ ax: R.random(m, v.args[0], { retryIsBitCount: true }) }))).toBeGreaterThan(0);
  });
});

describe('character creation', () => {
  it('rollstat CODE+0x5A42', () => mustMatch('rollstat', (m) => { R.rollStat(m); }));
  it('race adjustment CODE+0x549B', () => mustMatch('raceadj', (m) => { R.raceAdjust(m); }));
  it('class eligibility CODE+0x5AE4 (pclass)', () => mustMatch('pclass', (m) => R.classEligibility(m)));
  it('setspell CODE+0x5A00', () => mustMatch('setspell', (m, v) => { R.setSpell(m, v.args[0]); }));
  it('starting HP / AC CODE+0x5982', () => mustMatch('hpbonus', (m, v) => { R.startHp(m, v.args[0]); }));
  it('character commit CODE+0x57B7..0x597C', () => mustMatch('createcommit', (m) => { R.createCommit(m); }));
  it('resetac CODE+0x732A', () => mustMatch('resetac', (m) => { R.resetAc(m); }));
  it('null controls', () => {
    expect(nullBad('raceadj', (m, v) => { const o = v.args[0] === 3 ? 2 : v.args[0]; m.w8(0x23aa, 0 + o); R.raceAdjust(m); })).toBeGreaterThan(0);
    expect(nullBad('setspell', (m, v) => { R.setSpell(m, v.args[0] + 1); })).toBeGreaterThan(0);
    expect(nullBad('hpbonus', (m, v) => { R.startHp(m, v.args[0] + 1); })).toBeGreaterThan(0);
    expect(nullBad('resetac', (m) => { R.resetAc(m); m.w8(m.r16(0x3bd6) + 0x3d, 0); })).toBeGreaterThan(0);
  });
});

describe('training and level-up', () => {
  it('XP threshold + gold cost CODE+0x2A92', () => mustMatch('xpthr', (m) => { R.xpThreshold(m); }));
  it('XP compare CODE+0x2BA3 (can train when XP exceeds the threshold)', () => mustMatch('xpcmp', (m) => R.xpCompare(m)));
  it('training gold CODE+0x2C2E', () => mustMatch('traingold', (m) => { R.trainGold(m); }));
  it('training commit CODE+0x1B68..0x1D54 (HP roll, END bonus, spell level, age, gold)', () => mustMatch('levelup', (m) => R.levelUp(m)));
  it('null controls', () => {
    expect(nullBad('xpcmp', (m) => { const r = R.xpCompare(m); return { stop: r.stop === 0x2bd4 ? 0x2c5f : 0x2bd4 }; })).toBeGreaterThan(0);
    expect(nullBad('xpthr', (m) => { R.xpThreshold(m); m.w8(0x15d3, 0); })).toBeGreaterThan(0);
    expect(nullBad('traingold', (m) => { R.trainGold(m); m.w8(0x15e5, 0); })).toBeGreaterThan(0);
    expect(nullBad('levelup', (m) => { const r = R.levelUp(m); if (r.stop === 0x1d54) m.w8(m.r16(0x3bd6) + 0x37, 0); return r; })).toBeGreaterThan(0);
  });
});

describe('combat', () => {
  it('rolldmg core CODE+0xC008 (d20 to-hit, nat 20/1, damage dice + bonus, saturating total)', () => mustMatch('rolldmg', (m) => { R.rollDamage(m); }));
  it('party attack setup CODE+0xA399', () => mustMatch('attackp', (m, v) => R.partyAttackSetup(m, v.args[0])));
  it('monster attack setup CODE+0x9CAE', () => mustMatch('monhit', (m) => { R.monsterAttackSetup(m); }));
  it('damage to a character CODE+0x9DAB', () => mustMatch('apdmch', (m) => R.applyDamageChar(m)));
  it('damage to a monster CODE+0xC15E (+ list compaction CODE+0xC2B0)', () => mustMatch('apdmmon', (m) => R.applyDamageMonster(m)));
  it('initiative CODE+0xB8E3', () => mustMatch('setinit', (m) => R.setInitiative(m)));
  it('null controls', () => {
    expect(nullBad('rolldmg', (m) => { R.rollDamage(m); m.w8(0x3845, 0); })).toBeGreaterThan(0);
    expect(nullBad('apdmch', (m) => { const c = m.r16(0x3bd6); const r = R.applyDamageChar(m); m.w8(c + 0x33, 0); return r; })).toBeGreaterThan(0);
    expect(nullBad('setinit', (m) => { R.setInitiative(m); m.w8(0x3bf2, 0x27); })).toBeGreaterThan(0);
    expect(nullBad('attackp', (m, v) => R.partyAttackSetup(m, (v.args[0] + 1) % 15))).toBeGreaterThan(0);
  });
});

describe('status, saving throws, monster touch effects', () => {
  it('character saving throw CODE+0xA655', () => mustMatch('savechar', (m) => { R.saveChar(m); }));
  it('monster saving throw CODE+0xA6A3', () => mustMatch('savemons', (m) => { R.saveMonster(m); }));
  it('add condition CODE+0xA6D3', () => mustMatch('setcondi', (m, v) => { R.setCondition(m, v.args[0]); }));
  it('resistance rolls CODE+0xA706..0xA79B (carry = affected)', () => mustMatch('resist', (m, v) => ({ cf: R.resistRoll(m, v.args[0]) })));
  it('monster magic resistance CODE+0xA7C1', () => mustMatch('monresma', (m) => ({ cf: R.monsterResist(m) })));
  it('monster touch effect CODE+0xA60F (25 handlers, gate 1-in-n, resist, UI calls)', () => mustMatch('monbon', (m) => R.monsterTouch(m)));
  it('null controls', () => {
    expect(nullBad('savechar', (m) => { R.saveChar(m); m.w8(0x31b1, 1 - m.r8(0x31b1)); })).toBeGreaterThan(0);
    expect(nullBad('resist', (m, v) => ({ cf: R.resistRoll(m, (v.args[0] + 1) % 8) }))).toBeGreaterThan(0);
    expect(nullBad('monbon', (m) => { const r = R.monsterTouch(m); return { calls: [...r.calls, ['x', []]] }; })).toBeGreaterThan(0);
  });
});
