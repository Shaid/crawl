/**
 * Diffs tools/mm3/rules.ts against vectors recorded from the retail Amiga `Might&MagicIII`
 * executable under Unicorn (tools/mm3/rules_oracle/rules.py). Small subsets are committed
 * (tools/mm3/rules_oracle/vectors/); full sets regenerate into the gitignored generated/ and are used when present.
 * Strict memory: the port may only read bytes the game read; writes must equal the game's write set; RNG order and
 * logged callee calls must match. Every unit has a null control (a deliberately wrong variant must disagree).
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';
import * as R from '../rules.ts';

vi.setConfig({ testTimeout: 120000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);

/** run `fn` on every vector; compare return (masked) + write set; returns count of vectors whose result differs */
function check(name: string, fn: (m: StrictMem, v: any) => number | void, bits = 16) {
  const V = load(name);
  let bad = 0;
  for (const v of V) {
    const m = mem(v);
    let r: number | void;
    try { r = fn(m, v); } catch { bad++; continue; }
    const mask = bits === 32 ? 0xffffffff : 0xffff;
    const okRet = r === undefined || (((r >>> 0) & mask) >>> 0) === v.ret;
    const okCh = JSON.stringify(m.changes()) === JSON.stringify(v.fin);
    if (!(okRet && okCh)) bad++;
  }
  return { V, bad };
}
function mustMatch(name: string, fn: (m: StrictMem, v: any) => number | void, bits = 16, min = 20) {
  const V = load(name);
  expect(V.length).toBeGreaterThanOrEqual(min);
  for (const v of V) {
    const m = mem(v);
    const r = fn(m, v);
    if (r !== undefined && ((((r >>> 0) & (bits === 32 ? 0xffffffff : 0xffff)) >>> 0) !== v.ret)) expect(r >>> 0, `${name} ret ${JSON.stringify(v.args)}`).toBe(v.ret);
    const ch = m.changes();
    if (JSON.stringify(ch) !== JSON.stringify(v.fin)) expect(ch, `${name} writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
  }
}
function nullDiffers(name: string, bad: (m: StrictMem, v: any) => number | void, bits = 16) {
  const { bad: n } = check(name, bad, bits);
  expect(n).toBeGreaterThan(0);
}

describe('RNG (R+0x12EA8 rand15, R+0x12EA0 srand, R+0x64D4 rand(lo,hi))', () => {
  const run = (m: StrictMem, v: any, off1 = false) =>
    v.kind === 'r15' ? R.rand15(m) : v.kind === 'srand' ? (R.srand(m, v.args[0]), v.ret) : R.randRange(m, v.args[0], v.args[1], { off1 });
  it('matches the game', () => mustMatch('rng', (m, v) => run(m, v), 16, 30));
  it('rand(lo,hi) can return hi+1 (k truncation)', () => {
    const over = load('rng').filter((v: any) => v.kind === 'range' && v.args[1] > v.args[0] && ((v.ret << 16) >> 16) > v.args[1]);
    expect(over.length).toBeGreaterThan(0);
  });
  it('null control: off-by-one range', () => nullDiffers('rng', (m, v) => run(m, v, true)));
});

describe('stat engine', () => {
  it('bracket R+0xCE5C', () => mustMatch('bracket', (m, v) => R.bracket(m, v.args[0]) & 0xffff, 16, 40));
  it('level R+0xD03E', () => mustMatch('level', (m, v) => R.charLevel(m, v.char)));
  it('age R+0xCE8E', () => mustMatch('age', (m, v) => R.charAge(m, v.char, v.args[0])));
  it('condition modifier R+0x94FA', () => mustMatch('condmod', (m, v) => R.condMod(m, v.char, v.args[0])));
  it('equipment bonus R+0xCEF0', () => mustMatch('equip', (m, v) => R.equipBonus(m, v.char, v.args[0])));
  it('effective attribute R+0xD064', () => mustMatch('getstat', (m, v) => R.getStat(m, v.char, v.args[0], v.args[1])));
  it('max HP R+0xAD56', () => mustMatch('maxhp', (m, v) => R.maxHp(m, v.char), 32));
  it('armour class R+0xADE6', () => mustMatch('ac', (m, v) => R.armourClass(m, v.char, v.args[0])));
  it('null controls', () => {
    nullDiffers('level', (m, v) => (R.charLevel(m, v.char) + 1) & 0xffff);
    nullDiffers('getstat', (m, v) => R.getStat(m, v.char, v.args[0], 1 - v.args[1]));
    nullDiffers('ac', (m, v) => R.armourClass(m, v.char, 1 - v.args[0]));
  });
});

describe('saving throw OV4+0x82DC and damage OV4+0xECE8', () => {
  it('save matches the game (RNG order, result)', () => mustMatch('save', (m, v) => R.savingThrow(m, v.char, v.args[0])));
  it('simple check OV4+0x82B0', () => mustMatch('check', (m, v) => R.simpleCheck(m, v.args[0])));
  it('damage a character', () => mustMatch('dmgchar', (m, v) => { R.damageChar(m, v.char, v.args[0]); }));
  it('null control: off-by-one save bias', () => nullDiffers('save', (m, v) => R.savingThrow(m, v.char, v.args[0], { off: 12 })));
});

describe('monster attacks a character R+0x9E02', () => {
  const run = (m: StrictMem, v: any, o = {}) => R.monsterAttack(m, v.char, v.args[0], v.args[1], o);
  it('matches the game (damage, resist saves, special effects, logged UI/apply calls)', () => {
    const V = load('monattack');
    expect(V.length).toBeGreaterThanOrEqual(20);
    for (const v of V) {
      const m = mem(v);
      const calls = run(m, v);
      if (JSON.stringify(calls) !== JSON.stringify(v.calls)) expect(calls, JSON.stringify(v.args)).toEqual(v.calls);
      if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) expect(m.changes(), JSON.stringify(v.args)).toEqual(v.fin);
    }
  });
  it('null control: no halving on a successful luck save', () => {
    let bad = 0;
    for (const v of load('monattack')) {
      const m = mem(v);
      try { const c = run(m, v, { noHalve: true }); if (JSON.stringify(c) !== JSON.stringify(v.calls)) bad++; } catch { bad++; }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('party member attacks a monster (OV4+0x12C38, R+0x11DA6, OV4+0x12D56)', () => {
  it('weapon select + damage roll R+0x11DA6', () => mustMatch('weapon', (m, v) => { R.weaponDamage(m, v.char, v.args[0]); }));
  it('to-hit roll OV4+0x12C38 (weapon dice, d20, class level divisor, status +20, AC+10)', () => mustMatch('partyhit', (m, v) => R.partyHit(m, v.char, v.args[0])));
  it('weapon element after monster resistance OV4+0x12D56', () => mustMatch('element', (m, v) => R.elementDamage(m, v.args[0])));
  it('null control: a natural 20 that does not roll again', () => nullDiffers('partyhit', (m, v) => R.partyHit(m, v.char, v.args[0], { noReroll: true })));
});

describe('melee round, damage per hit, experience split', () => {
  it('damage per hit OV4+0x13048', () => mustMatch('dmghit', (m, v) => R.damagePerHit(m, v.char)));
  it('melee round OV4+0x13282 (swings, to-hit, damage; damage application logged)', () => {
    const V = load('meleeround');
    expect(V.length).toBeGreaterThanOrEqual(20);
    for (const v of V) {
      const m = mem(v);
      const calls = R.meleeRound(m, v.char);
      if (JSON.stringify(calls) !== JSON.stringify(v.calls)) expect(calls).toEqual(v.calls);
      if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) expect(m.changes()).toEqual(v.fin);
    }
  });
  it('xp split OV4+0x12FB0 (every member, dead or not)', () => mustMatch('xpsplit', (m, v) => { R.xpSplit(m, v.args[0]); }));
  it('null controls', () => {
    let bad = 0;
    for (const v of load('meleeround')) { const m = mem(v); try { if (JSON.stringify(R.meleeRound(m, v.char, { swings: 1 })) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
    nullDiffers('xpsplit', (m, v) => { R.xpSplit(m, v.args[0], { skipDead: true }); });
  });
});

describe('max spell points and level thresholds', () => {
  it('max SP R+0xAC46', () => mustMatch('maxsp', (m, v) => R.maxSp(m, v.char), 32));
  it('XP at next level R+0x88FC', () => mustMatch('xpnext', (m, v) => R.xpNextLevel(m, v.char), 32));
  it('null control: dropping the Druid/Ranger second pass', () => nullDiffers('maxsp', (m, v) => { const c = v.char; return R.maxSp(m, c) + (m.r8(c + 0x13) >= 8 ? 1 : 0); }, 32));
});
