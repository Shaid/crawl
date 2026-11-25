/**
 * Diffs tools/mm2/rules.ts against vectors recorded from the retail MM2 executable
 * running under Unicorn (tools/mm2/rules_oracle/rules.py). Small subsets are committed
 * (tools/mm2/rules_oracle/vectors/); the full sets are regenerated into the gitignored
 * tools/mm2/rules_oracle/generated/ and used when present. Null controls: each check is
 * repeated with a deliberately wrong rule and must fail.
 */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 });
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';
import { damageChar, spellGemGate, spellSpCost, spellSpGate, rest, train, xpAward, learnSpellLevel, killReward, monsterSpellDamage, monsterUsesAbility, partyAttack, partyPower, syncStats, luckSave, monsterMelee, statBonus, rand15, randRange, srand, unpackMonster } from '../rules.ts';

const mem = (v: any) => new StrictMem(v.init, v.wpre);

describe('RNG (CODE+0x24048 rand15, 0x2407C srand, 0x22BC6 rand(lo,hi))', () => {
  const V = load('rng');
  const run = (v: any, bad = false) => {
    const m = mem(v);
    let ret: number;
    if (v.kind === 'r16') ret = rand15(m);
    else if (v.kind === 'srand') { srand(m, v.args[0]); ret = v.ret; }
    else ret = randRange(m, v.args[0], bad ? v.args[1] + 1 : v.args[1]);
    return { ret, ch: m.changes() };
  };
  it('matches the game on every vector (return value and seed bytes)', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.ret & 0xffff).toBe(v.ret);
      expect(o.ch).toEqual(v.fin);
    }
  });
  it('covers the range quirk: rand(lo,hi) can return hi+1', () => {
    const over = V.filter((v: any) => v.kind === 'range' && v.args[1] > v.args[0] && ((v.ret << 16) >> 16) > v.args[1]);
    expect(over.length).toBeGreaterThan(0);
  });
  it('null control: an off-by-one range disagrees', () => {
    const ranges = V.filter((v: any) => v.kind === 'range' && v.args[1] > v.args[0]);
    expect(ranges.some((v: any) => run(v, true).ret !== v.ret)).toBe(true);
  });
});

describe('monster record unpack (CODE+0x4C8E)', () => {
  const V = load('monunpack');
  it('matches the game for every record tested, all 56 working bytes', () => {
    expect(V.length).toBeGreaterThan(20);
    for (const v of V) {
      const m = mem(v);
      unpackMonster(m, v.slot);
      expect(m.changes(), `monster ${v.id}`).toEqual(v.fin);
    }
  });
  it('null control: a port without the 250 cap (or without x10) on damage/initiative disagrees', () => {
    for (const opts of [{ capX10: false }, { noX10: true }]) {
      let bad = 0;
      for (const v of V) {
        const m = mem(v);
        unpackMonster(m, v.slot, opts);
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('monster melee roll (CODE+0x10478)', () => {
  const V = load('melee');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = monsterMelee(m, o);
    return { ch: m.changes(), calls: r.calls };
  };
  it('matches the game: RNG draws, hit count, damage, status halvings', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.calls).toEqual(v.calls);
      expect(o.ch).toEqual(v.fin);
    }
  });
  it('null controls: no status-3 halving, or a flat threshold of 5, both disagree', () => {
    for (const o of [{ noHalve: true }, { ac5: true }]) {
      let bad = 0;
      for (const v of V) {
        try {
          const r = run(v, o);
          if (JSON.stringify(r.ch) !== JSON.stringify(v.fin)) bad++;
        } catch { bad++; }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('stat bonus (CODE+0x4442), luck save (0x48BA), damage_char (0x4952)', () => {
  it('stat bonus matches for every stat value 0..255', () => {
    const V = load('bonus');
    expect(V.length).toBe(256);
    for (const v of V) {
      const m = mem(v);
      expect(statBonus(m, v.arg)).toBe(v.ret & 0xff);
    }
  });
  it('luck save matches (RNG draws included)', () => {
    const V = load('luck');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      expect(luckSave(m, v.char)).toBe(v.ret);
      expect(m.changes()).toEqual(v.fin);
    }
    let bad = 0;
    for (const v of V) {
      const m = mem(v);
      try { if (luckSave(m, v.char, { noAuto: true }) !== v.ret || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++; } catch { bad++; }
    }
    expect(bad).toBeGreaterThan(0); // null control: no 5%/95% auto results
  });
  it('damage_char matches: saves, halving/quartering, unconscious/dead transitions', () => {
    const V = load('dmgchar');
    expect(V.length).toBeGreaterThan(30);
    const run = (v: any, o = {}) => {
      const m = mem(v);
      damageChar(m, v.char, v.dmg, v.pB, v.pA, v.pC, o);
      return m.changes();
    };
    for (const v of V) expect(run(v)).toEqual(v.fin);
    let bad = 0;
    for (const v of V) {
      try { if (JSON.stringify(run(v, { noQuarter: true })) !== JSON.stringify(v.fin)) bad++; } catch { bad++; }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('party attack roll (CODE+0x111DA)', () => {
  const V = load('pmelee');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = partyAttack(m, v.tgt, o);
    return { calls: r.calls, ch: m.changes() };
  };
  it('matches the game: hit/miss ladder, damage, class crits, RNG draws, every byte written', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.calls).toEqual(v.calls);
      expect(o.ch).toEqual(v.fin);
    }
  });
  it('null controls: no class crits, or ignoring monster AC, both disagree', () => {
    for (const o of [{ noCrit: true }, { flatAc: true }]) {
      let bad = 0;
      for (const v of V) {
        try { if (JSON.stringify(run(v, o).ch) !== JSON.stringify(v.fin)) bad++; } catch { bad++; }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
describe('small combat/character rules', () => {
  it('monster ability use gate (CODE+0x105B6)', () => {
    const V = load('monspecial');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); expect(monsterUsesAbility(m)).toBe(v.ret); expect(m.changes()).toEqual(v.fin); }
    let bad = 0;
    for (const v of V) { const m = mem(v); try { monsterUsesAbility(m, { alwaysSpend: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
  it('kill reward (CODE+0x10B70)', () => {
    const V = load('killreward');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); killReward(m); expect(m.changes()).toEqual(v.fin); }
    let bad = 0;
    for (const v of V) { const m = mem(v); try { killReward(m, { noShift: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
  it('party power for encounters (CODE+0x11E58)', () => {
    const V = load('partystrength');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); partyPower(m); expect(m.changes()).toEqual(v.fin); }
    let bad = 0;
    for (const v of V) { const m = mem(v); try { partyPower(m, { noDifficulty: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
  it('monster spell damage (CODE+0x1F6DC)', () => {
    const V = load('mspelldmg');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); monsterSpellDamage(m, v.arg); expect(m.changes()).toEqual(v.fin); }
    let bad = 0;
    for (const v of V) { const m = mem(v); try { monsterSpellDamage(m, v.arg, { plain: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
  it('stat sync to working copies (CODE+0x4476)', () => {
    const V = load('sync');
    expect(V.length).toBeGreaterThan(10);
    for (const v of V) { const m = mem(v); syncStats(m, v.char); expect(m.changes()).toEqual(v.fin); }
  });
});

describe('spell level and spell points (CODE+0x20064)', () => {
  const V = load('spelllevel');
  it('matches the game: spell-level gate, class caps, spell-book bits, SP formula', () => {
    expect(V.length).toBeGreaterThan(30);
    expect(V.some((v: any) => v.ret === 1)).toBe(true);
    for (const v of V) { const m = mem(v); expect(learnSpellLevel(m, 0)).toBe(v.ret); expect(m.changes()).toEqual(v.fin); }
  });
  it('null control: SP without the +3 disagrees', () => {
    let bad = 0;
    for (const v of V) { const m = mem(v); try { learnSpellLevel(m, 0, { halfOnly: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('end-of-battle XP award (CODE+0x12430)', () => {
  const V = load('xpaward');
  it('matches the game: pool / living members added to each living member', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      const r = xpAward(m);
      expect(m.changes()).toEqual(v.fin);
      expect(v.calls.some((c: any) => c[0] === 'treasure')).toBe(r.treasure);
    }
  });
  it('null control: dividing by the whole party instead of the living disagrees', () => {
    let bad = 0;
    for (const v of V) { const m = mem(v); try { xpAward(m, { allMembers: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('training hall level gain (CODE+0x20232)', () => {
  const V = load('train');
  it('matches the game: gold, level, HP gain tables, endurance bonus, spell level hook', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); train(m, 0, v.cost); expect(m.changes()).toEqual(v.fin); }
  });
  it('null control: no round-up of the HP remainder disagrees', () => {
    let bad = 0;
    for (const v of V) { const m = mem(v); try { train(m, 0, v.cost, { noRoundUp: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('party rest (CODE+0x19B28)', () => {
  const V = load('rest');
  const game = (v: any) => v.calls.filter((c: any) => !String(c[0]).startsWith('ui'));
  it('matches the game: healing, SP, old-age death, food, interrupted rest', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) { const m = mem(v); const r = rest(m); expect(m.changes()).toEqual(v.fin); expect(r.calls).toEqual(game(v)); }
    expect(V.some((v: any) => game(v).length > 0)).toBe(true);
  });
  it('null control: resting without the food requirement disagrees', () => {
    let bad = 0;
    for (const v of V) { const m = mem(v); try { rest(m, { noFoodGate: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; } }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('spell cost gates (CODE+0x4BBC SP cost, 0x795C gems, 0x79A0 SP)', () => {
  const V = load('spellcost');
  it('matches the game for cost, gem gate and SP gate', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const kind of ['cost', 'gems', 'sp']) expect(V.some((v: any) => v.kind === kind)).toBe(true);
    for (const v of V) {
      const m = mem(v);
      if (v.kind === 'cost') { spellSpCost(m, v.char, v.rec); expect(m.changes()).toEqual(v.fin); }
      else if (v.kind === 'gems') { const r = spellGemGate(m, v.char, v.rec); expect(r.ok).toBe(v.ret); expect(r.calls).toEqual(v.calls); expect(m.changes()).toEqual(v.fin); }
      else { const r = spellSpGate(m, v.char); expect(r.ok).toBe(v.ret); expect(r.calls).toEqual(v.calls); }
    }
  });
  it('null control: capping the monster count for the two special records too disagrees', () => {
    let bad = 0;
    for (const v of V.filter((x: any) => x.kind === 'cost')) {
      const m = mem(v);
      try { spellSpCost(m, v.char, v.rec, { capAll: true }); if (!same(m.changes(), v.fin)) bad++; } catch { bad++; }
    }
    expect(bad).toBeGreaterThan(0);
  });
});
