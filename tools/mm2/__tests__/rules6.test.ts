/**
 * Pass 5 rules tests: vectors recorded from the retail MM2 executable under Unicorn (rules_oracle/rules6.py). Same strict-memory method and
 * null controls as rules.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { StrictMem } from '../rules-mem.ts';
import { load } from './vectors.ts';
import { castUndead, payPool, shareGold, shareGems, shareFood, sellItem, inspectItem, monsterAdvance, monsterSpray, monsterHitOne, monsterCondAll, monsterCondOne } from '../rules6.ts';

const mem = (v: any) => new StrictMem(v.init, v.wpre);
function disagree(V: any[], run: (m: StrictMem, v: any) => void): number {
  let bad = 0;
  for (const v of V) {
    try {
      const m = mem(v);
      run(m, v);
      if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
    } catch {
      bad++;
    }
  }
  return bad;
}

describe('undead spells: Turn Undead (CODE+0xBFEE), Holy Word (0xC72A), engine CODE+0xC028 with the real monster_dies', () => {
  const V = load('undead');
  it('match the game: gate, once-per-fight flag, per-slot roll vs the record index, kills and compaction', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      castUndead(m, v.spell);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(new Set(V.map((v: any) => v.spell)).size).toBe(2);
    expect(V.some((v: any) => Object.keys(v.fin).length > 40)).toBe(true); // kills happened
  });
  it('null control: no roll (Turn Undead as Holy Word) disagrees', () => {
    expect(disagree(V.filter((v: any) => v.spell === 54), (m) => castUndead(m, 54, { flat: true }))).toBeGreaterThan(0);
  });
  it('null control: not revisiting the slot after a kill (the table compacts) disagrees', () => {
    expect(disagree(V, (m, v) => castUndead(m, v.spell, { noRevisit: true }))).toBeGreaterThan(0);
  });
  it('null control: not capping the slot count at 10 for Turn Undead disagrees', () => {
    expect(disagree(V.filter((v: any) => v.spell === 54), (m) => castUndead(m, 54, { noCap: true }))).toBeGreaterThan(0);
  });
});

describe('party pool: paying and sharing gold, gems and food (CODE+0x6ACE/0x6B9A/0x6C66, 0x7BBE/0x7CB0/0x7D3E)', () => {
  const shares = { sharegold: shareGold, sharegems: shareGems, sharefood: shareFood } as const;
  for (const [name, fn] of Object.entries(shares)) {
    it(`${name} matches the game: equal shares, remainder to the picked member`, () => {
      const V = load(name);
      expect(V.length).toBeGreaterThan(30);
      for (const v of V) {
        const m = mem(v);
        expect((fn as any)(m, v.who)).toBe(v.ret);
        expect(m.changes()).toEqual(v.fin);
      }
      expect(V.some((v: any) => Object.keys(v.fin).length > 2)).toBe(true);
    });
  }
  it('null control: sharing gold without the remainder disagrees', () => {
    expect(disagree(load('sharegold'), (m, v) => shareGold(m, v.who, { noRemainder: true }))).toBeGreaterThan(0);
  });
  for (const kind of ['gold', 'gems', 'food'] as const) {
    it(`pay ${kind} matches the game: pooled sum, remainder on the first real member, then shared`, () => {
      const V = load('pay' + kind);
      expect(V.length).toBeGreaterThan(30);
      for (const v of V) {
        const m = mem(v);
        expect(payPool(m, kind, v.arg)).toBe(v.ret);
        expect(m.changes()).toEqual(v.fin);
      }
      expect(V.some((v: any) => v.ret === 1) && V.some((v: any) => v.ret === 0)).toBe(true);
    });
    it(`null control: pay ${kind} without the final share disagrees`, () => {
      expect(disagree(load('pay' + kind), (m, v) => payPool(m, kind, v.arg, { noFirst: true }))).toBeGreaterThan(0);
    });
  }
});

describe('shop: sell (CODE+0x1BC26) and the paid examine screen (CODE+0x1B6E0)', () => {
  const run = (V: any[], f: (m: StrictMem, v: any) => number[]) => {
    for (const v of V) {
      const m = mem(v);
      const msgs = f(m, v);
      expect(msgs).toEqual(v.calls.map((c: any) => c[1][0]));
      expect(m.changes()).toEqual(v.fin);
    }
  };
  it('sell matches the game: refusals, the shown price paid out, the pack closes the gap', () => {
    const V = load('sell');
    expect(V.length).toBeGreaterThan(30);
    run(V, (m, v) => sellItem(m, v.slot));
    expect(V.some((v: any) => Object.keys(v.fin).length > 4)).toBe(true);
  });
  it('null control: not closing the pack gap disagrees', () => {
    expect(disagree(load('sell'), (m, v) => sellItem(m, v.slot, { noRemove: true }))).toBeGreaterThan(0);
  });
  it('examine matches the game: gates, the fee, nothing else written', () => {
    const V = load('inspect');
    expect(V.length).toBeGreaterThan(30);
    run(V, (m, v) => inspectItem(m, v.slot));
    expect(V.some((v: any) => Object.keys(v.fin).length > 0)).toBe(true);
  });
  it('null control: a free examine disagrees', () => {
    expect(disagree(load('inspect'), (m, v) => inspectItem(m, v.slot, { free: true }))).toBeGreaterThan(0);
  });
});

describe('monster advance (CODE+0x10118)', () => {
  const V = load('advance');
  it('matches the game: swap with the first non-flagged slot, the actor follows, else call for help', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      expect(monsterAdvance(m)).toEqual(v.calls);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(V.some((v: any) => v.calls[0][0] === 'show') && V.some((v: any) => v.calls[0][0] === 'help')).toBe(true);
  });
  it('null control: not giving the actor the other slot data disagrees', () => {
    expect(disagree(V, (m) => monsterAdvance(m, { noSwapBack: true }))).toBeGreaterThan(0);
  });
});

describe('monster spell leaves: spray1 (CODE+0x1F414), hit1 (0x1F632), cond (0x1F72E), cond2 (0x1F896) with the real damage, save and special routines', () => {
  const V = load('monleaf');
  const run = (m: StrictMem, v: any, o: { noSave?: boolean; noHalve?: boolean } = {}) => {
    if (v.which === 'spray1') monsterSpray(m);
    else if (v.which === 'hit1') monsterHitOne(m, o);
    else if (v.which === 'cond') monsterCondAll(m, v.arg, o);
    else monsterCondOne(m, v.arg, o);
  };
  it('match the game: target walk, halvings, saves, condition bits, flags re-armed', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      run(m, v);
      expect(m.changes()).toEqual(v.fin);
    }
    expect(new Set(V.map((v: any) => v.which)).size).toBe(4);
  });
  it('null control: no damage halving on a single hit disagrees', () => {
    expect(disagree(V.filter((v: any) => v.which === 'hit1'), (m, v) => run(m, v, { noHalve: true }))).toBeGreaterThan(0);
  });
  it('null control: conditions that skip the saves disagree', () => {
    expect(disagree(V.filter((v: any) => v.which === 'cond' || v.which === 'cond2'), (m, v) => run(m, v, { noSave: true }))).toBeGreaterThan(0);
  });
});
