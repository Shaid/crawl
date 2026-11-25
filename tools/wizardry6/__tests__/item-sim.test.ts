/**
 * Item use, party swaps and the end-of-fight check inside the simulator (the pieces are harness-verified in
 * itemuse.test.ts; this pins their composition through the game's round executor, with a null control each).
 */
import { describe, expect, it } from 'vitest';
import { CombatWorld, LAYOUT, type MonsterSpec, type PartySpec } from '../combat-sim.ts';

const mage: PartySpec = { hp: 30, stamina: 60, level: 8, ac: 5, cls: 5, skills: { 13: 100, 22: 100, 25: 100 }, luck: 18 };
const knight: PartySpec = { hp: 90, stamina: 120, level: 9, ac: 3, weapon: { base: 2, n: 2, sides: 6, subtype: 1 }, skills: { 1: 60 } };
const bruiser: MonsterSpec = { hp: 60, strength: 6, ac: 5, attacks: [{ weapon: { base: 0, n: 1, sides: 2 } }], xp: 10, resist: {} };
const mk = (seed: [number, number, number], party: PartySpec[] = [mage, knight]) => {
  const w = new CombatWorld(party, [[bruiser, bruiser, bruiser]], seed); w.enableGameRound(); return w;
};
const P = (i: number) => LAYOUT.a4 - 17922 + i * 0x1b0;
/** member 0 carries item id 5 in slot 0 (quantity 1); the item's effect word is FIREBALL power 2 */
const giveWand = (w: CombatWorld) => {
  const m = w.mem; m.w16(P(0) + 64, 5); m.w8(P(0) + 70, 1); m.w8(P(0) + 428, 1);
  w.itemRec = (id) => (id === 5 ? { w28: (2 << 8) | 2, b60: 14, b69: 0 } : { w28: 0, b60: 0, b69: 0 });
};
const totalHp = (w: CombatWorld) => w.living(1).reduce((s, i) => s + w.hp(1, i), 0);

describe('use item in the game round', () => {
  it('casts the item spell, uses the item up, and is deterministic', () => {
    const run = (seed: [number, number, number]) => {
      const w = mk(seed); giveWand(w);
      w.partyPolicy = (_w, i) => (i === 0 ? { act: 'useitem', slot: 0, tg: 1, ti: -3 } : { act: 'attack', tg: 1, ti: 0 });
      const before = totalHp(w); w.gameRound();
      return { w, dmg: before - totalHp(w) };
    };
    // the success roll can fizzle or backfire: find a seed where the item spell is cast
    const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k): [number, number, number] => [k, k + 1, k + 2])
      .find((sd) => run(sd).w.actions.some((x) => x.fx.some((f) => f[0] === 'spell_effect')))!;
    const a = run(seed);
    expect(seed).toBeDefined();
    expect(a.w.mem.u8(P(0) + 428)).toBe(0);              // the only item was used up
    expect(a.dmg).toBe(run(seed).dmg);
    expect(a.dmg).toBeGreaterThan(0);
  });
  it('null control: an inert item changes nothing', () => {
    const w = mk([5, 6, 7]); giveWand(w); w.itemRec = () => ({ w28: 0, b60: 0, b69: 0 });
    w.partyPolicy = (_w, i) => (i === 0 ? { act: 'useitem', slot: 0, tg: 1, ti: 0 } : { act: 'attack', tg: 1, ti: 0 });
    w.gameRound();
    expect(w.mem.u8(P(0) + 428)).toBe(1);
    expect(w.actions.every((x) => !x.fx.some((f) => f[0] === 'spell_effect'))).toBe(true);
  });
});

describe('party swap and end-of-fight check in the game round', () => {
  it('swapping member 0 to position 1 exchanges the records', () => {
    const w = mk([5, 6, 7]);
    w.mem.w16(P(0) + 32, 111); w.mem.w16(P(1) + 32, 222);
    const hp0 = 111, hp1 = 222;
    w.partyPolicy = (_w, i) => (i === 0 ? { act: 'swap', to: 1 } : { act: 'attack', tg: 1, ti: 0 });
    w.gameRound();
    expect(w.actions.some((x) => x.act === 'swap')).toBe(true);
    expect(hp0).not.toBe(hp1);
    // a swap by parity moves in steps of two plus a neighbour exchange: records 0 and 1 trade places
    expect(w.mem.u16(P(1) + 32)).toBe(hp0);
    expect(w.mem.u16(P(0) + 32)).toBe(hp1);
  });
  it('null control: without a swap the records stay put', () => {
    const w = mk([5, 6, 7]);
    w.mem.w16(P(0) + 32, 111);
    const hp0 = 111;
    w.partyPolicy = () => ({ act: 'attack', tg: 1, ti: 0 });
    w.gameRound();
    expect(w.mem.u16(P(0) + 32)).toBe(hp0);
  });
});
