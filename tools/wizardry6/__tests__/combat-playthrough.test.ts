/**
 * Scripted multi-round reference fight through the game's own round (verified planner LAB_0C96, order of play
 * LAB_102D, executor LAB_0FF9, resolver LAB_0CD0). Not a game recording: it pins the composition's behaviour
 * (determinism, invariants per round, XP credit) so a regression in any verified piece shows up here.
 */
import { describe, expect, it } from 'vitest';
import { CombatWorld, type MonsterSpec, type PartySpec } from '../combat-sim.ts';

const fighter: PartySpec = { hp: 40, stamina: 60, level: 3, ac: 4, weapon: { base: 2, n: 1, sides: 6, subtype: 1 }, skills: { 1: 40, 9: 20 } };
const kobold: MonsterSpec = { hp: 12, strength: 6, ac: 5, attacks: [{ weapon: { base: 0, n: 1, sides: 4 } }], xp: 30 };
const mk = (seed: [number, number, number]) => {
  const w = new CombatWorld([fighter, fighter, fighter, fighter], [[kobold, kobold, kobold], [kobold, kobold]], seed);
  w.enableGameRound();
  return w;
};

describe('reference playthrough via the game round', () => {
  it('is deterministic and the party clears two groups', () => {
    const a = mk([4, 5, 6]), b = mk([4, 5, 6]);
    const ra = a.runGame(), rb = b.runGame();
    expect(ra).toEqual(rb);
    expect(a.log).toEqual(b.log);
    expect(ra.winner).toBe('party');
    expect(ra.xpPool).toBe(150);
    expect(ra.xpEach).toBe(Math.trunc(150 / a.living(0).length));
  });
  it('per round: hp never rises, a kill is final, every entry names a living actor at the time', () => {
    const w = mk([8, 9, 10]);
    const seen = new Set<string>();
    for (let r = 0; r < 20 && w.living(0).length > 0 && [1, 2].some((g) => w.living(g).length > 0); r++) {
      const n = w.log.length;
      w.gameRound();
      for (const e of w.log.slice(n)) {
        expect(e.hpAfter).toBeLessThanOrEqual(e.hpBefore);
        if (e.killed) seen.add(e.target);
        expect(seen.has(e.actor)).toBe(false);
      }
    }
    expect(w.log.length).toBeGreaterThan(5);
  });
  it('both sides act: monsters strike the party too', () => {
    const w = mk([2, 3, 4]);
    w.runGame();
    expect(w.log.some((e) => e.actor.startsWith('0.'))).toBe(true);
    expect(w.log.some((e) => !e.actor.startsWith('0.'))).toBe(true);
  });
  it('null control: a different seed gives a different fight', () => {
    const a = mk([4, 5, 6]), b = mk([40, 50, 60]);
    a.runGame(); b.runGame();
    expect(JSON.stringify(a.log)).not.toEqual(JSON.stringify(b.log));
  });
  it('null control: a weak party loses the same fight', () => {
    const weak: PartySpec = { hp: 4, stamina: 60, level: 1, ac: 10 };
    const orc: MonsterSpec = { hp: 60, strength: 9, ac: -2, attacks: [{ weapon: { base: 6, n: 2, sides: 8 } }], xp: 100, levelClass: 4 };
    const w = new CombatWorld([weak, weak], [[orc, orc, orc]], [3, 3, 3]);
    w.enableGameRound();
    expect(w.runGame().winner).toBe('monsters');
  });
});
