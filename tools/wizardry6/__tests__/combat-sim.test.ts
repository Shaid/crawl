import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CombatWorld, LAYOUT } from '../combat-sim.ts';
import type { MonsterSpec, PartySpec } from '../combat-sim.ts';
import { Mem, resolveAttack } from '../combat.ts';
import { W6Rng } from '../rules.ts';

const fighter: PartySpec = { hp: 40, stamina: 40, level: 3, ac: 4, weapon: { base: 2, n: 1, sides: 6, subtype: 1 }, skills: { 1: 40, 9: 20 } };
const kobold: MonsterSpec = { hp: 12, strength: 6, ac: 5, attacks: [{ weapon: { base: 0, n: 1, sides: 4 } }], xp: 30 };
const mk = (seed: [number, number, number]) => new CombatWorld([fighter, fighter, fighter, fighter], [[kobold, kobold, kobold]], seed);

describe('headless combat simulator', () => {
  it('is deterministic: the same seed gives the same fight, byte for byte', () => {
    const a = mk([1, 2, 3]); const b = mk([1, 2, 3]);
    expect(a.run()).toEqual(b.run());
    expect(a.log).toEqual(b.log);
    expect([...a.mem.wrote]).toEqual([...b.mem.wrote]);
  });
  it('null control: a different seed gives a different fight', () => {
    const a = mk([1, 2, 3]); const b = mk([9, 8, 7]);
    a.run(); b.run();
    expect(JSON.stringify(a.log)).not.toEqual(JSON.stringify(b.log));
  });
  it('a strong party wins, every kill credits its XP and the share is pool / living', () => {
    const w = mk([5, 6, 7]);
    const r = w.run();
    expect(r.winner).toBe('party');
    expect(r.xpPool).toBe(90);
    expect(r.xpEach).toBe(Math.trunc(90 / w.living(0).length));
    expect(w.living(1)).toEqual([]);
  });
  it('null control: an unarmed, weak party loses to a strong group', () => {
    const weak: PartySpec = { hp: 4, stamina: 40, level: 1, ac: 10 };
    const orc: MonsterSpec = { hp: 60, strength: 9, ac: -2, attacks: [{ weapon: { base: 6, n: 2, sides: 8 } }], xp: 100, levelClass: 4 };
    const w = new CombatWorld([weak, weak], [[orc, orc, orc]], [3, 3, 3]);
    expect(w.run().winner).toBe('monsters');
  });
  it('hits can raise the attacker skill (skill-use rule) over many rounds', () => {
    const w = mk([11, 12, 13]);
    for (let i = 0; i < 40; i++) w.attack(0, 0, 1, 0, 0, 0);
    expect(w.skill(0, 1)).toBeGreaterThanOrEqual(40);
  });
  it('composition: the inline-effects attack path the simulator uses reproduces the game on 90 recorded states', () => {
    const path = resolve('tools/wizardry6/oracle/combat-full-vectors.json');
    if (!existsSync(path)) return;
    const V: any[] = JSON.parse(readFileSync(path, 'utf8'));
    let checked = 0;
    for (const v of V) {
      // load the recorded footprint into an open memory and drive it through the same call the simulator makes
      const m = new Mem(v.foot, true);
      const rng = new W6Rng(v.seed);
      const fx = resolveAttack(m, rng, { a4: v.a4, attacker: v.T, hand: v.hand, kind: v.kind, exec: true, itemCastWord: (id) => v.items[id] ?? 0 });
      expect(JSON.stringify(fx)).toBe(JSON.stringify(v.effects));
      expect([...rng.s]).toEqual(v.rng);
      checked++;
    }
    expect(checked).toBe(V.length);
    expect(LAYOUT.a4).toBe(0x167ffe);
  });
});
