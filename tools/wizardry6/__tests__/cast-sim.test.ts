/**
 * Casting inside the simulator: the party plan asks for a spell, the game's executor (round.ts) hands it to the
 * verified cast gate (LAB_0F72), dispatcher (LAB_0F06) and engines, and the stamina cost is charged from the gate's
 * return before the next action. Every behaviour has a null control (another seed, no cast, silence/anti-magic).
 */
import { describe, expect, it } from 'vitest';
import { CombatWorld, LAYOUT, type MonsterSpec, type PartyPlan, type PartySpec } from '../combat-sim.ts';

const SP6: [number, number][] = [[40, 40], [40, 40], [40, 40], [40, 40], [40, 40], [40, 40]];
const mage: PartySpec = { hp: 30, stamina: 60, level: 8, ac: 5, cls: 5, sp: SP6, skills: { 13: 100, 25: 100 }, luck: 18 };
const bruiser: MonsterSpec = { hp: 60, strength: 6, ac: 5, attacks: [{ weapon: { base: 0, n: 1, sides: 2 } }], xp: 10, resist: {} };
const mk = (seed: [number, number, number], party: PartySpec[] = [mage, mage], groups: MonsterSpec[][] = [[bruiser, bruiser, bruiser]]) => {
  const w = new CombatWorld(party, groups, seed); w.enableGameRound(); return w;
};
const cast = (spell: number, power: number, tg = 1, ti = 0): PartyPlan => ({ act: 'cast', spell, power, tg, ti });
const totalHp = (w: CombatWorld, g: number) => w.living(g).reduce((s, i) => s + w.hp(g, i), 0);

describe('casting in the game round', () => {
  it('a damage spell hurts the target group, costs spell points and stamina, and is deterministic', () => {
    const run = (seed: [number, number, number]) => {
      const w = mk(seed); w.partyPolicy = () => cast(2, 2, 1, -3);   // FIREBALL, power 2, area of 3
      const before = totalHp(w, 1); w.gameRound();
      return { w, dmg: before - totalHp(w, 1) };
    };
    const a = run([5, 6, 7]), b = run([5, 6, 7]);
    expect(a.dmg).toBeGreaterThan(0);
    expect(a.dmg).toBe(b.dmg);
    expect(a.w.casts).toEqual(b.w.casts);
    expect(a.w.casts.length).toBe(2);
    const c0 = a.w.casts[0];
    expect(c0.spell).toBe(2); expect(c0.power).toBe(2); expect(c0.fizzled).toBe(false);
    // FIREBALL: realm 0, 6 SP per power, power 2 -> 12 SP per cast
    expect(a.w.mem.u16(LAYOUT.a4 - 17882)).toBe(40 - 12);
    expect(a.w.mem.u16(LAYOUT.a4 - 17882 + 0x1b0)).toBe(40 - 12);
    // stamina charge = the gate's return (Random(power) + level + power), floored at 0, read back from the member
    const st = a.w.mem.u16(LAYOUT.memBase + 6);
    expect(st).toBe(60 - c0.cost);
    expect(run([50, 60, 70]).dmg).not.toBe(a.dmg);       // null control: another seed
  });
  it('null control: no cast, no damage from the party', () => {
    const w = mk([5, 6, 7]); w.partyPolicy = () => ({ act: 'attack', tg: 1, ti: 0 });
    // a party of unarmed mages swinging does not touch the spell points
    w.gameRound();
    expect(w.casts.length).toBe(0);
    expect(w.mem.u16(LAYOUT.a4 - 17882)).toBe(40);
  });
  it('a status spell lands on the target group (BLINDING FLASH) and a saving throw can stop it', () => {
    const count = (res: number) => {
      let hit = 0;
      for (let s = 1; s <= 30; s++) {
        const w = mk([s, s + 1, s + 2], [mage], [[{ ...bruiser, resist: { 2: res } }]]);
        w.partyPolicy = () => cast(1, 3, 1, 0);
        w.gameRound();
        const M = LAYOUT.memBase + 1 * LAYOUT.memStride;
        if ([0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15].some((k) => w.mem.u8(M + k) > 0) || w.state(1, 0) > 0) hit++;
      }
      return hit;
    };
    const weak = count(0), strong = count(255);
    expect(weak).toBeGreaterThan(strong);
    expect(strong).toBe(0);
  });
  it('a group buff (BLESS) lowers the armour byte of every party member by (power-1)/2+1 and a control does not', () => {
    const w = mk([9, 9, 9]); w.partyPolicy = (_w, i) => (i === 0 ? cast(49, 4, 0, 0) : { act: 'attack', tg: 1, ti: 0 });
    const ac = (x: CombatWorld, i: number) => x.mem.s8(LAYOUT.memBase + i * 44 + 38);
    const before = [ac(w, 0), ac(w, 1)];
    w.gameRound();
    expect(w.casts.find((c) => c.spell === 49)!.fizzled).toBe(false);
    for (const i of [0, 1]) expect(ac(w, i)).toBe(before[i] - 2);
    const c = mk([9, 9, 9]); c.gameRound();
    for (const i of [0, 1]) expect(ac(c, i)).toBe(before[i]);
  });
  it('heal spells restore HP up to the maximum (HEAL WOUNDS)', () => {
    const w = mk([3, 3, 3], [mage, { ...mage, hp: 30 }]);
    w.mem.w16(LAYOUT.memBase + 44 + 2, 5);                                   // member 1 wounded
    w.partyPolicy = (_w, i) => (i === 0 ? cast(64, 3, 0, 1) : { act: 'attack', tg: 1, ti: 0 });
    w.gameRound();
    expect(w.casts[0].fizzled).toBe(false);
    expect(w.hp(0, 1)).toBeGreaterThan(5);
    expect(w.hp(0, 1)).toBeLessThanOrEqual(30);
  });
  it('anti-magic on the caster\'s side makes casts fizzle; without it they land', () => {
    let fizzle = 0, ok = 0;
    for (let s = 1; s <= 40; s++) {
      const w = mk([s, s + 3, s + 5], [mage], [[bruiser]]);
      w.mem.w8(LAYOUT.memBase + 401, 250);                       // group 0 anti-magic byte
      w.partyPolicy = () => cast(0, 1, 1, 0);                    // ENERGY BLAST (can fizzle)
      w.gameRound();
      if (w.casts[0].fizzled) fizzle++;
      const w2 = mk([s, s + 3, s + 5], [mage], [[bruiser]]); w2.partyPolicy = () => cast(0, 1, 1, 0); w2.gameRound();
      if (!w2.casts[0].fizzled) ok++;
    }
    expect(fizzle).toBeGreaterThan(30);
    expect(ok).toBe(40);
  });
  it('a silenced caster casts nothing but still pays the spell points', () => {
    const w = mk([4, 4, 4], [{ ...mage, cls: 1 }], [[bruiser]]);
    w.mem.w8(LAYOUT.memBase + 14, 3);                            // member +14: silence counter
    w.partyPolicy = () => cast(0, 1, 1, 0);
    w.gameRound();
    expect(w.hp(1, 0)).toBe(60);
    expect(w.mem.u16(LAYOUT.a4 - 17882)).toBe(40 - 2);          // ENERGY BLAST: 2 SP per power
  });
  it('spell points run out: the policy cannot cast a spell it cannot afford (menu rule, hyp), the gate itself does not stop it', () => {
    const poor: PartySpec = { ...mage, sp: [[5, 40], ...SP6.slice(1)] };
    const w = mk([4, 4, 4], [poor], [[bruiser]]);
    const afford = (spell: number, power: number) => w.mem.u16(LAYOUT.a4 - 17882) >= [2, 3, 6][spell] * power;
    expect(afford(2, 1)).toBe(false);                            // FIREBALL needs 6
    expect(afford(0, 2)).toBe(true);
    w.partyPolicy = () => cast(2, 1, 1, 0);                      // casts anyway: the gate has no SP test
    w.gameRound();
    expect(w.mem.u16(LAYOUT.a4 - 17882)).toBe(0xffff);           // 5 - 6, as an unsigned word
  });
  it('a monster that casts: a priest group casts a spell at the party', () => {
    const priest: MonsterSpec = { ...bruiser, hp: 20, strength: 12, spells: [0], spellChance: 100 };
    const w = mk([8, 8, 8], [{ ...mage, hp: 200 }, { ...mage, hp: 200 }], [[priest]]);
    w.partyPolicy = () => ({ act: 'attack', tg: 1, ti: 0 });
    for (let r = 0; r < 3; r++) w.gameRound();
    const mc = w.casts.filter((c) => c.actor.startsWith('1.'));
    expect(mc.length).toBeGreaterThan(0);
    expect(mc.every((c) => c.spell === 0)).toBe(true);
  });
});
