/**
 * Pass 2: encounter setup, initiative / turn order, round loop (tools/mm2/rules2.ts) against vectors
 * recorded from the retail MM2 executable under Unicorn. Same strict-memory method and null controls as rules.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { StrictMem } from '../rules-mem.ts';
import { encounter, encounterBudget, encounterGenerate, battleOver, characterFlee, encounterAddGroup, encounterGroups, initMonsters, roundLoop } from '../rules2.ts';
import { load } from './vectors.ts';

const mem = (v: any) => new StrictMem(v.init, v.wpre);
/** number of vectors on which a (possibly wrong) port disagrees with the game; a throw (read outside the footprint) counts */
function disagree(V: any[], run: (v: any) => unknown): number {
  let bad = 0;
  for (const v of V) {
    try {
      if (JSON.stringify(run(v)) !== JSON.stringify(v.fin)) bad++;
    } catch {
      bad++;
    }
  }
  return bad;
}
const changes = (v: any, f: (m: StrictMem) => void) => {
  const m = mem(v);
  f(m);
  return m.changes();
};

describe('encounter group sizes (CODE+0x11D0C)', () => {
  const V = load('encgroup');
  it('matches the game: A4-1316, A4-24141 and the rand() draws', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => encounterGroups(m))).toEqual(v.fin);
  });
  it('covers all three surprise states and both indoor/outdoor branches', () => {
    expect(V.some((v: any) => v.init[String(0x167ffe - 31083)] === 2)).toBe(true);
    expect(V.some((v: any) => v.init[String(0x167ffe - 31083)] === 3)).toBe(true);
    expect(V.some((v: any) => v.init[String(0x167ffe - 31202)] === 1)).toBe(true);
  });
  it('null control: ignoring the surprise state disagrees', () => {
    expect(disagree(V, (v) => changes(v, (m) => encounterGroups(m, { noSurprise: true })))).toBeGreaterThan(0);
  });
});

describe('monster slot init (CODE+0x11C82 / 0x11C2C)', () => {
  const V = load('moninit');
  it('matches the game: per-slot hp, initiative, ability uses, status', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => initMonsters(m))).toEqual(v.fin);
  });
});

describe('battle over (CODE+0x13282)', () => {
  const V = load('battleover');
  it('matches the game on every vector', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(battleOver(mem(v))).toBe(v.ret);
    expect(V.some((v: any) => v.ret === 1) && V.some((v: any) => v.ret === 0)).toBe(true);
  });
  it('null control: the inverted test disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        if (battleOver(mem(v), { anyUnable: true }) !== v.ret) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('reinforcement pick (CODE+0x11F0A)', () => {
  const V = load('encpick');
  it('matches the game: record index, group size, monster count', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => encounterAddGroup(m))).toEqual(v.fin);
  });
  it('null control: dropping the map tier clamp disagrees', () => {
    expect(disagree(V, (v) => changes(v, (m) => encounterAddGroup(m, { noClamp: true })))).toBeGreaterThan(0);
  });
});

describe('encounter budget and generation (CODE+0x12072, 0x1213E)', () => {
  const B = load('encbudget');
  const G = load('encgen');
  it('budget flag matches the game', () => {
    expect(B.length).toBeGreaterThan(30);
    for (const v of B) expect(changes(v, (m) => encounterBudget(m))).toEqual(v.fin);
    expect(B.some((v: any) => v.fin[String(0x167ffe - 28609)] === 1)).toBe(true);
  });
  it('generation loop matches the game: slot table, monster count, every rand() draw', () => {
    expect(G.length).toBeGreaterThan(30);
    for (const v of G) expect(changes(v, (m) => encounterGenerate(m))).toEqual(v.fin);
    expect(G.filter((v: any) => Object.keys(v.fin).length > 20).length).toBeGreaterThan(10);
  });
  it('null control: ignoring the map monster limit disagrees', () => {
    expect(disagree(B, (v) => changes(v, (m) => encounterBudget(m, { noMapLimit: true })))).toBeGreaterThan(0);
  });
});

describe('character flees (CODE+0x116B0)', () => {
  const V = load('charflee');
  it('matches the game, including the party compaction on success', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      const calls = characterFlee(m);
      expect(m.changes()).toEqual(v.fin);
      expect(calls).toEqual(v.calls);
    }
    expect(V.some((v: any) => Object.keys(v.fin).length > 2)).toBe(true);
  });
});

describe('round loop / turn order (CODE+0x12A22)', () => {
  const V = load('round');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = roundLoop(m, v.script, o);
    return { ch: m.changes(), calls: r.calls, used: r.used };
  };
  it('matches the game: actor sequence, acted flags, status decay, end of battle', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.calls).toEqual(v.calls);
      expect(o.used).toBe(v.used);
      expect(o.ch).toEqual(v.fin);
    }
  });
  it('exercises monster and party turns, ties and several rounds', () => {
    const acts = V.map((v: any) => v.calls.filter((c: any) => c[0] === 'pact' || c[0] === 'mact').map((c: any) => c[0]));
    expect(acts.some((a: string[]) => a.includes('pact'))).toBe(true);
    expect(acts.some((a: string[]) => a.includes('mact'))).toBe(true);
    expect(V.some((v: any) => v.calls.filter((c: any) => c[0] === 'ui129cc').length > 1)).toBe(true);
  });
  it('null controls: monster-wins-ties and no status decay both disagree', () => {
    for (const o of [{ monsterFirst: true }, { noDecay: true }]) {
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

describe('encounter prompt: surprise, hide, run, bribe (CODE+0x12C6E)', () => {
  const V = load('driver');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = encounter(m, { keys: v.keys, nums: v.nums, pays: v.pays }, o);
    return { ch: m.changes(), calls: r.calls };
  };
  it('matches the game: surprise state, outcome, every payment call, RNG draws and written bytes', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.calls).toEqual(v.calls);
      expect(o.ch).toEqual(v.fin);
    }
  });
  it('covers surprise 2 and 3, hide, run, retreat, and all three bribes', () => {
    const names = new Set(V.flatMap((v: any) => v.calls.map((c: any) => c[0])));
    for (const n of ['key', 'num', 'battle', 'retreat', 'payFood', 'payGold', 'payGems']) expect(names.has(n)).toBe(true);
    const sup = (x: number) => V.some((v: any) => v.fin[String(0x167ffe - 31083)] === x);
    expect(sup(2) && sup(3)).toBe(true);
  });
  it('null controls: no surprise roll, and an always-successful Hide, both disagree', () => {
    for (const o of [{ noSurprise: true }, { hideAlways: true }]) {
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
