/**
 * Pass 3: spell dispatch, the 'anywhere' set, dice damage, group size, the cast command and the partyEffect engine
 * (tools/mm2/rules4.ts) against vectors recorded from the retail MM2 executable under Unicorn (rules_oracle/rules4.py).
 * Same strict-memory method and null controls as rules.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { StrictMem } from '../rules-mem.ts';
import { load } from './vectors.ts';
import { anywhereSpell, canEquip, equipCommand, useItem, monsterSpellVerb, castCombat, castNonCombat, CB_SPELLS, NC_SPELLS, castSpell, diceDamage, dispatchSpell, maxTargets, partyEffect, SPELL_HANDLER_CB, SPELL_HANDLER_NC } from '../rules4.ts';

vi.setConfig({ testTimeout: 120000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);
const hn = (t: number | null) => (t === null ? [] : [['h' + t.toString(16).padStart(5, '0'), []]]);

describe('spell dispatchers (CODE+0xCD90, 0xCFD0)', () => {
  const V = load('castdisp');
  it('every spell number reaches the handler the port names, both dispatchers, out-of-range included', () => {
    expect(V.length).toBeGreaterThan(190);
    for (const v of V) expect(v.calls).toEqual(hn(dispatchSpell(v.which, v.spell)));
  });
  it('each spell is handled by exactly one dispatcher (96 = 43 + 53)', () => {
    let both = 0;
    for (let i = 0; i < 96; i++) if (SPELL_HANDLER_NC[i] !== null && SPELL_HANDLER_CB[i] !== null) both++;
    expect(both).toBe(0);
    expect(SPELL_HANDLER_NC.filter((x) => x !== null).length).toBe(43);
    expect(SPELL_HANDLER_CB.filter((x) => x !== null).length).toBe(53);
  });
  it('null control: swapping the tables disagrees', () => {
    expect(V.filter((v: any) => JSON.stringify(v.calls) !== JSON.stringify(hn(dispatchSpell(v.which === 'nc' ? 'cb' : 'nc', v.spell)))).length).toBeGreaterThan(50);
  });
});

describe("'anywhere' spell set (CODE+0x13708)", () => {
  const V = load('anywhere');
  it('matches the game', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(anywhereSpell(mem(v), v.spell)).toBe(v.ret);
    expect(V.some((v: any) => v.ret === 1) && V.some((v: any) => v.ret === 0)).toBe(true);
  });
});

describe('dice damage (CODE+0x1338E) and group size (CODE+0x1333A)', () => {
  const D = load('dicedmg');
  const T = load('maxtargets');
  it('dice: level x (rand(1,sides) + bonus), RNG draws included', () => {
    expect(D.length).toBeGreaterThan(30);
    for (const v of D) {
      const m = mem(v);
      diceDamage(m, v.args[0], v.args[1]);
      expect(m.changes()).toEqual(v.fin);
    }
  });
  it('group size: level+4 below 7, else 10 (+1 when level >= monster count)', () => {
    expect(T.length).toBeGreaterThan(30);
    for (const v of T) expect(maxTargets(mem(v))).toBe(v.ret);
  });
  it('null control: no bonus disagrees', () => {
    let bad = 0;
    for (const v of D) {
      try {
        const m = mem(v);
        diceDamage(m, v.args[0], 0);
        if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('cast command (CODE+0x13AE2)', () => {
  const V = load('castroute');
  it('matches the game: gates, dispatcher choice, handler flags', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      const calls = castSpell(m, v.ch, v.spell);
      expect(calls).toEqual(v.calls);
      expect(m.changes()).toEqual(v.fin);
    }
    const names = new Set(V.flatMap((x: any) => x.calls.map((c: any) => c[0])));
    for (const n of ['dispNC', 'dispCB', 'msg']) expect(names.has(n)).toBe(true);
  });
  it('null controls: ignoring the gates or swapping the dispatchers disagrees', () => {
    for (const o of [{ noGates: true }, { swap: true }]) {
      let bad = 0;
      for (const v of V) {
        try {
          const m = mem(v);
          const c = castSpell(m, v.ch, v.spell, o);
          if (JSON.stringify(c) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
        } catch {
          bad++;
        }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('partyEffect engine (CODE+0x10894)', () => {
  const V = load('partyeffect');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const calls = partyEffect(m, v.args, [...v.kills], o);
    return { calls, ch: m.changes() };
  };
  it('matches the game: resist/immunity/save, damage, conditions, kills, RNG order', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const r = run(v);
      expect(r.calls).toEqual(v.calls);
      expect(r.ch).toEqual(v.fin);
    }
    const names = new Set(V.flatMap((x: any) => x.calls.map((c: any) => c[0])));
    expect(names.has('dmgMon') && names.has('killMon')).toBe(true);
  });
  it('null controls: no magic resistance / no save halving disagree', () => {
    for (const o of [{ noMres: true }, { noHalve: true }]) {
      let bad = 0;
      for (const v of V) {
        try {
          const r = run(v, o);
          if (JSON.stringify(r.calls) !== JSON.stringify(v.calls) || JSON.stringify(r.ch) !== JSON.stringify(v.fin)) bad++;
        } catch {
          bad++;
        }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('combat spell handlers (CODE+0xB644..0xC72A, via the combat dispatcher)', () => {
  const V = load('cbspell');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const calls = castCombat(m, v.spell, { keys: [...v.keys], picks: [...v.picks], kills: [...v.kills] }, o);
    return { calls, ch: m.changes() };
  };
  it('matches the game for every implemented spell: picks, ranges, dice, conditions, party edits', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) {
      const r = run(v);
      expect({ spell: v.spell, calls: r.calls }).toEqual({ spell: v.spell, calls: v.calls });
      expect({ spell: v.spell, ch: r.ch }).toEqual({ spell: v.spell, ch: v.fin });
    }
    expect(new Set(V.map((v: any) => v.spell)).size).toBe(CB_SPELLS.length);
  });
  it('null control: skipping the melee-group range check disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const r = run(v, { noRangeCheck: true });
        if (JSON.stringify(r) !== JSON.stringify({ calls: v.calls, ch: v.fin })) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('non-combat spell handlers (CODE+0xA812..0xC9B6, via the non-combat dispatcher)', () => {
  const V = load('ncspell');
  const run = (v: any) => {
    const m = mem(v);
    const calls = castNonCombat(m, v.spell, { keys: [], picks: [...v.picks], kills: [] });
    return { calls, ch: m.changes() };
  };
  it('matches the game for the party-state spells: buffs, awaken, heals, cures', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) {
      const r = run(v);
      expect({ spell: v.spell, calls: r.calls }).toEqual({ spell: v.spell, calls: v.calls });
      expect({ spell: v.spell, ch: r.ch }).toEqual({ spell: v.spell, ch: v.fin });
    }
    expect(new Set(V.map((v: any) => v.spell)).size).toBe(NC_SPELLS.length);
  });
  it('null control: ignoring the antimagic square disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        const c = castNonCombat(m, v.spell, { keys: [], picks: [...v.picks], kills: [] }, { noAntimagic: true });
        if (JSON.stringify(c) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('monster spell dispatcher (CODE+0x1FB4E)', () => {
  const V = load('monspell');
  it('matches the game: breath damage, verb table, dice, counters', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) {
      const m = mem(v);
      const calls = monsterSpellVerb(m, v.spell);
      expect({ spell: v.spell, calls }).toEqual({ spell: v.spell, calls: v.calls });
      expect({ spell: v.spell, ch: m.changes() }).toEqual({ spell: v.spell, ch: v.fin });
    }
  });
  it('null control: no breath halving disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        const c = monsterSpellVerb(m, v.spell, { noHalve: true });
        if (JSON.stringify(c) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('item use (CODE+0x137E0 / 0x13896, stat boost CODE+0x13B80)', () => {
  const V = load('itemuse');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const calls = useItem(m, v.kind, v.ch, v.rec, v.slot, o);
    return { calls, ch: m.changes() };
  };
  it('matches the game: charges, removal at zero, free cast or stat boost', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) expect(run(v)).toEqual({ calls: v.calls, ch: v.fin });
    const names = new Set(V.flatMap((x: any) => x.calls.map((c: any) => c[0])));
    expect(names.has('cast') && names.has('msg')).toBe(true);
    expect(V.some((v: any) => v.kind === 'equip') && V.some((v: any) => v.kind === 'pack')).toBe(true);
  });
  it('null control: not spending a charge disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        if (JSON.stringify(run(v, { noCharge: true })) !== JSON.stringify({ calls: v.calls, ch: v.fin })) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('equip compatibility (CODE+0xEC02)', () => {
  const V = load('canequip');
  it('matches the game: one weapon, two-handed vs class-C armour, one item per class', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) {
      const m = mem(v);
      const r = canEquip(m, v.ch, v.slot);
      expect({ ok: r.ok, calls: r.calls }).toEqual({ ok: v.ret, calls: v.calls });
      expect(m.changes()).toEqual(v.fin);
    }
    const msgs = new Set(V.flatMap((x: any) => x.calls.map((c: any) => c[1][0])));
    for (const n of [6, 7, 8, 9, 10, 12, 13]) expect(msgs.has(n)).toBe(true);
  });
  it('null control: dropping the two-handed rule disagrees', () => {
    let bad = 0;
    for (const v of V) {
      const r = canEquip(mem(v), v.ch, v.slot, { noTwoHanded: true });
      if (r.ok !== v.ret) bad++;
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('equip command (CODE+0xED9C)', () => {
  const V = load('equipcmd');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const calls = equipCommand(m, v.ch, { keys: [], picks: [...v.picks], kills: [] }, o);
    return { calls, ch: m.changes() };
  };
  it('matches the game: slot search, curse, class, alignment, 0xF0, compatibility, move', () => {
    expect(V.length).toBeGreaterThan(100);
    for (const v of V) expect(run(v)).toEqual({ calls: v.calls, ch: v.fin });
    const msgs = new Set(V.flatMap((x: any) => x.calls.filter((c: any) => c[0] === 'msg').map((c: any) => c[1][0])));
    for (const n of [3, 4, 5, 14]) expect(msgs.has(n)).toBe(true);
    expect(V.some((v: any) => Object.keys(v.fin).length > 8)).toBe(true);
  });
  it('null control: ignoring the class mask disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        if (JSON.stringify(run(v, { noClassMask: true })) !== JSON.stringify({ calls: v.calls, ch: v.fin })) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});
