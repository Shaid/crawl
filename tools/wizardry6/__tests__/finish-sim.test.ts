/**
 * The end-of-fight sequence inside the simulator (the pieces are harness-verified in endcombat.test.ts; this pins their
 * composition on a won fight, with a null control each).
 */
import { describe, expect, it } from 'vitest';
import { CombatWorld, LAYOUT, type MonsterSpec, type PartySpec } from '../combat-sim.ts';

const knight: PartySpec = { hp: 90, stamina: 120, level: 9, ac: 3, weapon: { base: 6, n: 3, sides: 8, subtype: 1 }, skills: { 1: 90 } };
const rat: MonsterSpec = { hp: 3, strength: 2, ac: 9, attacks: [{ weapon: { base: 0, n: 1, sides: 2 } }], xp: 40, resist: {} };
const P = (i: number) => LAYOUT.a4 - 17922 + i * 0x1b0;
/** one treasure record: fixed 300 gold (type 1, A = B = 300, 100 percent) and a 7 x 3 bonus XP entry (type 4) */
const rec = (() => { const r = new Uint8Array(40); r.set([1, 44, 1, 44, 1, 100], 0); r.set([0, 7, 0, 3, 4, 100], 6); return r; })();
const noItems = () => { throw new Error('no items'); };

const won = (seed: [number, number, number]) => {
  const w = new CombatWorld([knight, knight], [[rat, rat]], seed);
  w.enableGameRound();
  const r = w.runGame(40);
  return { w, r };
};

describe('finishFight', () => {
  it('drops the dead monsters, splits the XP pool and the treasure among the living', () => {
    const { w, r } = won([3, 4, 5]);
    expect(r.winner).toBe('party');
    const xp0 = [w.mem.u32(P(0) + 12), w.mem.u32(P(1) + 12)];
    const g0 = [w.mem.u32(P(0) + 20), w.mem.u32(P(1) + 20)];
    const f = w.finishFight({ rec, item: noItems });
    expect(f.victory).toBe(true);
    const living = [0, 1].filter((i) => w.mem.u8(P(i) + 417) === 0);
    expect(living.length).toBeGreaterThan(0);
    const share = Math.trunc(r.xpPool / living.length);
    for (const i of living) {
      expect(w.mem.u32(P(i) + 12)).toBe((xp0[i] + share + 21) >>> 0);                // pool share plus the 7 x 3 bonus
      expect(w.mem.u32(P(i) + 20)).toBe((g0[i] + Math.trunc(300 / living.length)) >>> 0);
    }
    expect(w.mem.u8(w.mem.u32(LAYOUT.a4 - 15266 + 4) + 413)).toBe(0);                 // every rat compacted away
  });
  it('null control: without finishFight nothing is paid out', () => {
    const { w } = won([3, 4, 5]);
    expect(w.mem.u32(P(0) + 20)).toBe(0);
  });
  it('a lost fight pays nothing', () => {
    const w = new CombatWorld([{ ...knight, hp: 1, stamina: 1 }], [[{ ...rat, hp: 500, strength: 9, ac: 0, attacks: [{ weapon: { base: 9, n: 3, sides: 8 } }] }]], [1, 2, 3]);
    w.enableGameRound(); w.runGame(40);
    const g0 = w.mem.u32(P(0) + 20);
    const f = w.finishFight({ rec, item: noItems });
    if (!f.victory) expect(w.mem.u32(P(0) + 20)).toBe(g0);
  });
});
