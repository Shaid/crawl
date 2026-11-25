/**
 * Pass 2: encounter setup, initiative / turn order, round loop (tools/mm2/rules2.ts) against vectors
 * recorded from the retail MM2 executable under Unicorn. Same strict-memory method and null controls as rules.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 });
import { StrictMem } from '../rules-mem.ts';
import { encounter, encounterBudget, encounterGenerate, battleOver, characterFlee, encounterAddGroup, encounterGroups, initMonsters, roundLoop } from '../rules2.ts';
import { load } from './vectors.ts';
import { xpNeeded, trainingCost, lootItem, treasure, equipItem, unequipItem, recalcAc, spellCombatGate, spellLocationGate, monsterSpecial, setCondition, monsterTurn, pickTargetMelee, pickTargetRanged, resolvePartyHit, damageMonster, monsterDies, questKill } from '../rules3.ts';

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
  it('null control: capping the count at 10 instead of 11 disagrees', () => {
    expect(disagree(V, (v) => changes(v, (m) => initMonsters(m, { cap10: true })))).toBeGreaterThan(0);
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
  it('null control: no party compaction disagrees', () => {
    expect(disagree(V, (v) => changes(v, (m) => characterFlee(m, { noCompact: true })))).toBeGreaterThan(0);
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

describe('damage to monsters, death and removal (CODE+0x10EAC, 0x10E5E, 0x10C66, 0x10CCE)', () => {
  it('quest-kill flag matches the game', () => {
    const V = load('questkill');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => questKill(m))).toEqual(v.fin);
    expect(V.some((v: any) => Object.keys(v.fin).length > 0)).toBe(true);
    expect(disagree(V, (v) => changes(v, (m) => questKill(m, { ignoreFlag: true })))).toBeGreaterThan(0);
  });
  it('monster death (reward, removal, queue XP) matches the game', () => {
    const V = load('mondeath');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => monsterDies(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => monsterDies(m, { noQueueXp: true })))).toBeGreaterThan(0);
  });
  it('damage to a monster matches the game; null controls: hp >= damage survives / status kept disagree', () => {
    const V = load('mondamage');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => damageMonster(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => damageMonster(m, { gtKills: true })))).toBeGreaterThan(0);
    expect(disagree(V, (v) => changes(v, (m) => damageMonster(m, { keepStatus: true })))).toBeGreaterThan(0);
  });
});

describe('applying a party attack to a monster (CODE+0x11040)', () => {
  const V = load('resolve');
  it('matches the game: immunity, damage, death', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => resolvePartyHit(m))).toEqual(v.fin);
  });
  it('null control: ignoring the sex immunity disagrees', () => {
    expect(disagree(V, (v) => changes(v, (m) => resolvePartyHit(m, { noSexImmunity: true })))).toBeGreaterThan(0);
  });
});

describe('monster targeting and the monster turn (CODE+0x10332, 0x103BA, 0x1064C)', () => {
  it('ranged target pick matches the game, including the stale-pointer wrap quirk', () => {
    const V = load('tgtranged');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => pickTargetRanged(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => pickTargetRanged(m, { fresh: true })))).toBeGreaterThan(0);
  });
  it('melee target pick matches the game', () => {
    const V = load('tgtmelee');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => pickTargetMelee(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => pickTargetMelee(m, { ignoreFront: true })))).toBeGreaterThan(0);
  });
  const V = load('monturn');
  it('monster turn decisions match the game: gate, flee, melee/ranged/advance/spell', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const m = mem(v);
      const calls = monsterTurn(m);
      expect(calls).toEqual(v.calls);
      expect(m.changes()).toEqual(v.fin);
    }
    const names = new Set(V.flatMap((x: any) => x.calls.map((c: any) => c[0])));
    for (const n of ['pickMelee', 'pickRanged', 'advance', 'spell', 'partyEffect']) expect(names.has(n)).toBe(true);
  }, 60000);
  it('null control: a monster that never flees disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const m = mem(v);
        const c = monsterTurn(m, { noFlee: true });
        if (JSON.stringify(c) !== JSON.stringify(v.calls) || JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('condition and drain effects (CODE+0x1F27E set_condition and its 30 handlers)', () => {
  const V = load('setcond');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = setCondition(m, v.char, o);
    return { ret: r, ch: m.changes() };
  };
  it('matches the game for every effect id: result, condition bits, drains, rand() draws', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.ch).toEqual(v.fin);
      expect(o.ret).toBe(v.ret);
    }
  });
  it('every effect id 1..30 takes at least once and is covered', () => {
    const took = new Set(V.filter((v: any) => v.ret || [10, 11, 12].includes(v.effect)).map((v: any) => v.effect));
    for (let e = 1; e <= 30; e++) expect(took.has(e), `effect ${e}`).toBe(true);
  });
  it('null control: skipping the saves (effects behave as always-hit) disagrees', () => {
    let bad = 0;
    for (const v of V) {
      try {
        const o = run(v, { noSave: true });
        if (JSON.stringify(o.ch) !== JSON.stringify(v.fin)) bad++;
      } catch {
        bad++;
      }
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('monster special attack (CODE+0x0FD8C)', () => {
  const V = load('monspecial2');
  it('matches the game: chance roll, luck save, effect id, front-rank widening', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => void monsterSpecial(m))).toEqual(v.fin);
    expect(V.some((v: any) => v.effect > 0 && Object.keys(v.fin).length > 8)).toBe(true);
  });
  it('null controls: no chance roll, and no luck save, both disagree', () => {
    for (const o of [{ noChance: true }, { noLuck: true }]) expect(disagree(V, (v) => changes(v, (m) => void monsterSpecial(m, o)))).toBeGreaterThan(0);
  });
});

describe('spell gates (CODE+0x78A8 combat class, 0x790E location)', () => {
  const V = load('spellgate');
  const run = (v: any, o = {}) => {
    const m = mem(v);
    const r = v.kind === 'cc' ? spellCombatGate(m, v.rec, o) : spellLocationGate(m, v.rec, o);
    return { ok: r.ok, calls: r.calls, ch: m.changes() };
  };
  it('matches the game: return value and the message shown', () => {
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) {
      const o = run(v);
      expect(o.ok).toBe(v.ret);
      expect(o.calls).toEqual(v.calls);
    }
    expect(V.filter((v: any) => v.ret === 0).length).toBeGreaterThan(5);
  });
  it('null controls: swapped combat classes, and ignoring the map bit, both disagree', () => {
    for (const o of [{ swap: true }, { ignoreMap: true }]) {
      let bad = 0;
      for (const v of V) {
        try {
          const r = run(v, o);
          if (r.ok !== v.ret || JSON.stringify(r.calls) !== JSON.stringify(v.calls)) bad++;
        } catch {
          bad++;
        }
      }
      expect(bad).toBeGreaterThan(0);
    }
  });
});

describe('equipment: weapon bytes, armour accumulator, AC (CODE+0xF36C, 0xF270, 0x67E6)', () => {
  it('AC recalculation matches the game', () => {
    const V = load('ac');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => recalcAc(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => recalcAc(m, { noClamp: true })))).toBeGreaterThan(0);
  });
  it('equip matches the game (weapon die/enchant, armour accumulator, stat bonus, AC); null control: no armour', () => {
    const V = load('equip');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => equipItem(m, v.char, v.slot))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => equipItem(m, v.char, v.slot, { noArmour: true })))).toBeGreaterThan(0);
  });
  it('unequip matches the game', () => {
    const V = load('unequip');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => unequipItem(m, v.char, v.slot))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => unequipItem(m, v.char, v.slot, { keepBase: true })))).toBeGreaterThan(0);
  });
});

describe('treasure (CODE+0x12206 loot item, 0x123B0 treasure roll)', () => {
  it('one loot item matches the game: item id, charges, use power, every draw', () => {
    const V = load('lootitem');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => lootItem(m, v.idx))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => lootItem(m, v.idx, { noCap: true })))).toBeGreaterThan(0);
  });
  it('the treasure roll matches the game: count, tier cost', () => {
    const V = load('treasure');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(changes(v, (m) => treasure(m))).toEqual(v.fin);
    expect(disagree(V, (v) => changes(v, (m) => treasure(m, { noTierCost: true })))).toBeGreaterThan(0);
  });
});

describe('Hall of Training: XP needed and cost (CODE+0x20796, 0x2073A)', () => {
  it('xp needed for the next level matches the game for levels 1..255 and every class', () => {
    const V = load('xpneed');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(xpNeeded(mem(v), v.char)).toBe(v.ret >>> 0);
    expect(V.some((x: any) => x.ret > 0x10000000)).toBe(true);
    expect(V.some((v: any) => xpNeeded(mem(v), v.char, { noL15: true }) !== (v.ret >>> 0))).toBe(true);
  });
  it('training cost matches the game; null control: not adding the +1 level disagrees', () => {
    const V = load('traincost');
    expect(V.length).toBeGreaterThan(30);
    for (const v of V) expect(trainingCost(mem(v), v.char, v.slot)).toBe(v.ret);
    expect(V.some((x: any) => trainingCost(mem(x), x.char, x.slot, { noPlusOne: true }) !== x.ret)).toBe(true);
  });
});
