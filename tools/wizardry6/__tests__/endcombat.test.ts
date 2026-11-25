/**
 * Diffs the end-of-combat rules (tools/wizardry6/endcombat.ts) against the game under Unicorn (oracle/combat5.py):
 * member upkeep LAB_09BA, group compaction LAB_09C8, buff decay LAB_0AA2, record write-back LAB_0A02, the full post-combat
 * routine LAB_0A03, the victory XP split LAB_1D9A and the treasure roll LAB_1D76. Committed subsets:
 * oracle/{upkeep,compact,decay,writeback,xpsplit,loot,postfull}-vectors.json; larger sets via W6_UPKEEP_VECTORS, W6_COMPACT_VECTORS,
 * W6_DECAY_VECTORS, W6_WRITEBACK_VECTORS, W6_XPSPLIT_VECTORS, W6_LOOT_VECTORS, W6_POSTFULL_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { compactGroup, decayBuffs, lootRoll, memberUpkeep, postCombatFull, writeBack, xpSplit, type LootItem } from '../endcombat.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const UP = loadVectors('W6_UPKEEP_VECTORS', 'upkeep-vectors.json');
const CP = loadVectors('W6_COMPACT_VECTORS', 'compact-vectors.json');
const DC = loadVectors('W6_DECAY_VECTORS', 'decay-vectors.json');
const WB = loadVectors('W6_WRITEBACK_VECTORS', 'writeback-vectors.json');
const XP = loadVectors('W6_XPSPLIT_VECTORS', 'xpsplit-vectors.json');
const LT = loadVectors('W6_LOOT_VECTORS', 'loot-vectors.json');
const PF = loadVectors('W6_POSTFULL_VECTORS', 'postfull-vectors.json');
const ctx = (v: any, mem: any, rng: any) => ({ m: mem, rng, a4: v.a4 });
const sameFx = (v: any, r: any) => JSON.stringify(r.fx.fx) === JSON.stringify(v.effects);

describe.skipIf(UP.length === 0)('member upkeep LAB_09BA', () => {
  const body = (v: any, mem: any, rng: any) => ({ fx: [] as Effect[], died: memberUpkeep(ctx(v, mem, rng), v.g, v.i, v.a, v.b) });
  const ok = (v: any, r: any) => r.fx.died === v.ret;
  it('matches the game: HP, stamina, death, formation cell, slain bit, counters, return value', () => {
    expect(mismatches(UP, body, undefined, ok)).toBe(0);
  }, 60_000);
  it('covers deaths of party members and of monsters', () => {
    expect(UP.some((v) => v.ret === 1 && v.g === 0)).toBe(true);
    expect(UP.some((v) => v.ret === 1 && v.g !== 0)).toBe(true);
    expect(UP.some((v) => v.ret === 0)).toBe(true);
  });
  it('null control: ignoring poison, or another seed, disagrees', () => {
    expect(mismatches(UP, (v, m, r) => ({ fx: [], died: memberUpkeep(ctx(v, m, r), v.g, v.i, v.a + 3, v.b) }), undefined, ok)).toBeGreaterThan(0);
    expect(mismatches(UP, body, (_v, _m, r) => { r.s[2] = (r.s[2] + 5) % 30323; }, ok)).toBeGreaterThan(0);
  });
});

describe.skipIf(CP.length === 0)('group compaction LAB_09C8', () => {
  const body = (v: any, mem: any, rng: any) => { compactGroup(ctx(v, mem, rng), v.g); return { fx: [] as Effect[] }; };
  it('matches the game: upkeep of survivors, dead dropped, count rewritten', () => {
    expect(mismatches(CP, body)).toBe(0);
  }, 120_000);
  it('null control: keeping the dead disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const c = ctx(v, m, r); compactGroup(c, v.g); m.w8(m.u32(v.a4 - 15266 + 4 * v.g) + 413, 9); return { fx: [] as Effect[] }; };
    expect(mismatches(CP, wrong)).toBeGreaterThan(0);
  });
});

describe.skipIf(DC.length === 0)('buff and cloud decay LAB_0AA2', () => {
  const body = (v: any, mem: any, rng: any) => { decayBuffs(ctx(v, mem, rng)); return {}; };
  it('matches the game', () => { expect(mismatches(DC, body)).toBe(0); }, 60_000);
  it('null control: a flat decrement disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { decayBuffs(ctx(v, m, r)); m.w8(m.u32(v.a4 - 15266) + 396, 1); return {}; };
    expect(mismatches(DC, wrong)).toBeGreaterThan(0);
  });
});

describe.skipIf(WB.length === 0)('record write-back LAB_0A02', () => {
  const body = (v: any, mem: any, rng: any) => { writeBack(ctx(v, mem, rng), v.i); return {}; };
  it('matches the game', () => { expect(mismatches(WB, body)).toBe(0); }, 60_000);
  it('null control: another member disagrees', () => {
    expect(mismatches(WB, (v, m, r) => body({ ...v, i: (v.i + 1) % 6 }, m, r))).toBeGreaterThan(0);
  });
});

describe.skipIf(XP.length === 0)('victory XP split LAB_1D9A', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; xpSplit(ctx(v, mem, rng), fx); return { fx }; };
  it('matches the game', () => { expect(mismatches(XP, body, undefined, sameFx)).toBe(0); }, 60_000);
  it('null control: dividing by the party size disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const fx: Effect[] = []; m.b.set(v.a4 - 15300 + 3, (m.u8(v.a4 - 15300 + 3) + 1) & 255); xpSplit(ctx(v, m, r), fx); return { fx }; };
    expect(mismatches(XP, wrong, undefined, sameFx)).toBeGreaterThan(0);
  });
});

describe.skipIf(LT.length === 0)('treasure roll LAB_1D76', () => {
  const hexB = (h: string, o: number) => parseInt(h.slice(2 * o, 2 * o + 2), 16);
  const itemOf = (v: any) => (id: number): LootItem => {
    const h: string | undefined = v.items[String(id)];
    if (!h) throw new Error('item not recorded');
    return { w20: (hexB(h, 20) << 8) | hexB(h, 21), b22: hexB(h, 22), b23: hexB(h, 23), w30: (hexB(h, 30) << 8) | hexB(h, 31), b59: hexB(h, 59), b60: hexB(h, 60), b61: hexB(h, 61) };
  };
  const recOf = (v: any) => Uint8Array.from(Buffer.from(v.rec, 'hex'));
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; lootRoll(ctx(v, mem, rng), recOf(v), itemOf(v), fx); return { fx }; };
  it('matches the game: rolls, gold and bonus-XP shares, the item list and its per-item arrays', () => {
    expect(mismatches(LT, body, undefined, sameFx)).toBe(0);
  }, 120_000);
  it('covers gold, bonus XP, items and the nobody-living case', () => {
    const types = (v: any) => { const r = recOf(v); return [0, 1, 2, 3, 4, 5].map((e) => r[6 * e + 4]); };
    expect(LT.some((v) => types(v).includes(1))).toBe(true);
    expect(LT.some((v) => types(v).includes(4))).toBe(true);
    expect(LT.some((v) => Object.keys(v.items).length > 0)).toBe(true);
  });
  it('null control: an inverted percentage test, or another seed, disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const fx: Effect[] = []; const rec = recOf(v); for (let e = 0; e < 6; e++) rec[6 * e + 5] = 100 - rec[6 * e + 5]; lootRoll(ctx(v, m, r), rec, itemOf(v), fx); return { fx }; };
    expect(mismatches(LT, wrong, undefined, sameFx)).toBeGreaterThan(0);
    expect(mismatches(LT, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 9) % 30269; }, sameFx)).toBeGreaterThan(0);
  });
});

describe.skipIf(PF.length === 0)('post-combat LAB_0A03 with the real upkeep and write-back', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; postCombatFull(ctx(v, mem, rng), fx); return { fx }; };
  it('matches the game: upkeep and deaths, write-back, sort, wiped / fled outcome', () => {
    expect(mismatches(PF, body, undefined, sameFx)).toBe(0);
  }, 120_000);
  it('covers a death by upkeep', () => { expect(PF.some((v) => v.effects.some((e: any) => e[0] === 'LAB_0A1E'))).toBe(true); });
  it('null control: skipping the upkeep disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const fx: Effect[] = []; const c = ctx(v, m, r); for (let i = 0; i < 6; i++) { try { writeBack(c, i); } catch { /* outside footprint */ } } return { fx }; };
    expect(mismatches(PF, wrong, undefined, sameFx)).toBeGreaterThan(0);
  });
});
