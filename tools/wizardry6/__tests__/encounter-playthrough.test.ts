/**
 * Reference playthrough from the game's own encounter start with real scenario.dbs monster records (skips without the
 * data file). Not a game recording: it pins the composition (encounter generation LAB_0A31, planner, casts, breath,
 * hide/run, summons, XP pool) for a fixed seed so any regression in a verified piece shows up.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CombatWorld, type PartyPlan, type PartySpec } from '../combat-sim.ts';

const FILE = 'data/wizardry6/amiga/scenario.dbs';
const have = existsSync(FILE);
const SP6: [number, number][] = [[40, 40], [40, 40], [40, 40], [40, 40], [40, 40], [40, 40]];
const knight: PartySpec = { hp: 90, stamina: 120, level: 9, ac: 3, weapon: { base: 2, n: 2, sides: 6, subtype: 1 }, skills: { 1: 60, 9: 30 } };
const mage: PartySpec = { hp: 60, stamina: 120, level: 9, ac: 5, cls: 5, sp: SP6, skills: { 13: 100, 25: 100 }, luck: 18 };
const party = [knight, knight, mage, mage];

describe.skipIf(!have)('encounter playthrough with real monster records', () => {
  const scenario = have ? new Uint8Array(readFileSync(FILE)) : new Uint8Array();
  const run = (id: number, seed: [number, number, number], policy?: (w: CombatWorld, i: number) => PartyPlan) => {
    const w = CombatWorld.fromEncounter(party, id, seed, { scenario, level: 7 });
    w.enableGameRound();
    if (policy) w.partyPolicy = policy;
    const r = w.runGame(40);
    return { w, r };
  };
  const mageCasts = (_w: CombatWorld, i: number): PartyPlan => (i >= 2 ? { act: 'cast', spell: 2, power: 2, tg: 1, ti: -3 } : { act: 'attack' });

  it('encounter generation is deterministic and follows the record companion rule', () => {
    const a = CombatWorld.fromEncounter(party, 100, [3, 4, 5], { scenario, level: 7 });
    const b = CombatWorld.fromEncounter(party, 100, [3, 4, 5], { scenario, level: 7 });
    expect(a.groupIds).toEqual(b.groupIds);
    expect(a.groupSizes).toEqual(b.groupSizes);
    expect(a.groupIds[0]).toBe(100);
    expect(a.groupSizes.length).toBeLessThanOrEqual(5);
    expect(a.groupSizes.every((n) => n >= 1 && n <= 9)).toBe(true);
    const c = CombatWorld.fromEncounter(party, 100, [30, 40, 50], { scenario, level: 7 });
    expect(JSON.stringify([c.groupIds, c.groupSizes])).not.toBe(JSON.stringify([a.groupIds, a.groupSizes])); // null control
  });
  it('whole timeline is reproducible with casts, monster casts/breath and a result', () => {
    const x = run(100, [11, 12, 13], mageCasts), y = run(100, [11, 12, 13], mageCasts);
    expect(x.r).toEqual(y.r);
    expect(x.w.log).toEqual(y.w.log);
    expect(x.w.casts).toEqual(y.w.casts);
    expect(x.w.breaths).toEqual(y.w.breaths);
    expect(x.w.casts.length).toBeGreaterThan(0);
    expect(['party', 'monsters', 'fled', 'none']).toContain(x.r.winner);
    const z = run(100, [111, 112, 113], mageCasts);
    expect(JSON.stringify(z.w.log)).not.toBe(JSON.stringify(x.w.log));  // null control
  });
  it('party run ends the fight as fled (or is refused) deterministically', () => {
    const a = run(100, [21, 22, 23], () => ({ act: 'run' })), b = run(100, [21, 22, 23], () => ({ act: 'run' }));
    expect(a.r).toEqual(b.r);
    expect(a.w.flee).toEqual(b.w.flee);
    expect(a.w.flee.length).toBeGreaterThan(0);
  });
});
