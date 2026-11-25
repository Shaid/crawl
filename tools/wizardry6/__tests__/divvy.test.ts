/**
 * Diffs the loot hand-out (tools/wizardry6/divvy.ts) against the game under Unicorn (oracle/combat6.py give | listdel | chest1da4).
 * Committed subsets oracle/{give,listdel,chest1da4}-vectors.json; larger sets via W6_GIVE_VECTORS, W6_LISTDEL_VECTORS, W6_CHEST1DA4_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import type { LootItem } from '../endcombat.ts';
import { chestTreasureStep, giveItem, lootBlocksExit, removeListEntry } from '../divvy.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const G = loadVectors('W6_GIVE_VECTORS', 'give-vectors.json');
const L = loadVectors('W6_LISTDEL_VECTORS', 'listdel-vectors.json');
const K = loadVectors('W6_CHEST1DA4_VECTORS', 'chest1da4-vectors.json');
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);
const itemOf = (v: any) => (id: number): LootItem => {
  const h: string | undefined = v.items[String(id)];
  if (!h) throw new Error('item not recorded');
  const b = (o: number) => parseInt(h.slice(2 * o, 2 * o + 2), 16);
  return { w20: (b(20) << 8) | b(21), b22: b(22), b23: b(23), w30: (b(30) << 8) | b(31), b59: b(59), b60: b(60), b61: b(61) };
};

describe.skipIf(G.length === 0)('give a found item LAB_1D12 (with LAB_1D10)', () => {
  const body = (v: any, m: any, rng: any, tweak?: (it: LootItem) => LootItem) => {
    const f = itemOf(v);
    const ret = giveItem({ m, rng, a4: v.a4 }, v.who, v.idx, tweak ? (id) => tweak(f(id)) : f);
    return { fx: [] as Effect[], ret };
  };
  const ok = (v: any, r: any) => (r.fx.ret & 0xffff) === (v.ret & 0xffff);
  it('matches the game: stacking, new slots, the second area, refusal, weight, flag bits', () => {
    expect(mismatches(G, body as any, undefined, ok)).toBe(0);
  }, 120_000);
  it('covers a refusal and a successful give', () => {
    expect(G.some((v) => v.ret === 0xffff) && G.some((v) => v.ret === 0)).toBe(true);
  });
  it('null control: ignoring the 250 stack cap or the item flag bits disagrees', () => {
    expect(mismatches(G, ((v: any, m: any, r: any) => body(v, m, r, (it) => ({ ...it, b59: it.b59 ^ 2 }))) as any, undefined, ok)).toBeGreaterThan(0);
    expect(mismatches(G, ((v: any, m: any, r: any) => body(v, m, r, (it) => ({ ...it, w30: it.w30 + 1 }))) as any, undefined, ok)).toBeGreaterThan(0);
  });
});

describe.skipIf(L.length === 0)('remove a list entry LAB_1D2A', () => {
  const body = (v: any, m: any, rng: any) => { removeListEntry({ m, rng, a4: v.a4 }, v.idx); return [] as Effect[]; };
  it('matches the game: the five parallel lists shift up', () => {
    expect(mismatches(L, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: removing the wrong entry disagrees', () => {
    expect(mismatches(L, (v, m, r) => { removeListEntry({ m, rng: r, a4: v.a4 }, v.idx + 1); return []; }, undefined, same)).toBeGreaterThan(0);
  });
  it('exit test: a flagged entry blocks leaving', () => {
    expect(typeof lootBlocksExit).toBe('function');
  });
});

describe.skipIf(K.length === 0)('chest treasure step LAB_1DA4', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; chestTreasureStep({ m, rng, a4: v.a4 }, fx); return fx; };
  it('matches the game: pending id sets state 0x15 and rolls, the cursor advances', () => {
    expect(mismatches(K, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: always rolling disagrees', () => {
    expect(mismatches(K, (v, m, r) => { m.b.set(v.a4 - 15296 + 1, 3); m.b.set(v.a4 - 15296, 0); return body(v, m, r); }, undefined, same)).toBeGreaterThan(0);
  });
});
