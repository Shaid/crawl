import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng } from './rules';
import { monsterMelee, type AiScripts } from './rules-monster';
import { CombatSim, startingParty, type SimConfig, type SimMonster, type LogEntry } from './combat-sim';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8'));
const tables = V.tables, scripts: AiScripts = V.aiScripts;

const monster = (o: Partial<SimMonster> = {}): SimMonster => ({
  id: 0, x: 2, y: 1, gfx: 0x80b3, monType: 0, b2: 10, b3: 0x04, b5: 5, b6: 2, b7: 0, hp: 40, maxHp: 40, xpBase: 50,
  w0c: 0, moveType: 0, pc: 1, s0e: 0, vars: [0, 0, 0, 0, 0, 0, 0, 0], pos: 4, alive: true, loot: [], ...o,
});
const cfg = (o: Partial<SimConfig> = {}): SimConfig => ({
  tables, weaponBase: V.weaponBase, scripts, seed: 'a27740bfd561', width: 8, height: 3, blocked: [],
  party: startingParty(tables), px: 1, py: 1, facing: 1, monsters: [monster()], ...o,
});
const fighterSwings = () => [{ kind: 'attack' as const, char: 0 }];

describe('combat-sim: executable form of game-rules.md section 9', () => {
  it('is deterministic for a seed and diverges for other seeds (null control)', () => {
    const run = (seed: string) => JSON.stringify(new CombatSim(cfg({ seed })).run(120, fighterSwings).log);
    const a = run('a27740bfd561');
    expect(run('a27740bfd561')).toBe(a);
    let diff = 0;
    for (let i = 1; i <= 10; i++) if (run(`0${i}27740bfd56${i}`) !== a) diff++;
    expect(diff).toBeGreaterThanOrEqual(9);
  });

  it('composition: the first monster act equals monsterMelee on the same RNG stream', () => {
    const c = cfg();
    const sim = new CombatSim(c);
    sim.step1(); // tick 1: no periodic block, the monster act event is due
    const rng = new BcRng(c.seed);
    const m = c.monsters[0];
    const exp = monsterMelee({
      gfx: m.gfx, b2: m.b2, b3: m.b3, b6: m.b6, maxHp: m.maxHp, px: 1, py: 1, mx: m.x, my: m.y, facing: 1, pos: 4, op: 4, flag: 1,
      form: [0, 1, 2, 3], hp: sim.chars.map(() => 20).map((h, k) => (sim.log.some(l => l.ev === 'damage' && l.char === k) ? 20 : h)), ac: c.party.map(p => p.ac), s0f: 1,
    }, rng);
    const got = sim.log.filter((l): l is Extract<LogEntry, { ev: 'monster-hit' }> => l.ev === 'monster-hit').map(l => [l.char, l.dmg]);
    expect(got).toEqual(exp.dmg);
  });

  it('player kills a weak monster: XP goes to every living character, level-ups follow section 1.4', () => {
    const party = startingParty(tables);
    party[0].weapon = { gfx: 3, extra: 0 };
    party[2].hp = 0; // the Magic User is already dead: no XP for the dead
    const sim = new CombatSim(cfg({ party, monsters: [monster({ hp: 6, maxHp: 6, xpBase: 300 })], seed: '0102030405ff' })).run(200, fighterSwings);
    const dead = sim.log.find(l => l.ev === 'monster-dead');
    expect(dead).toBeTruthy();
    if (dead && dead.ev === 'monster-dead') {
      expect(dead.xp[2]).toBe(0);
      for (const k of [0, 1, 3]) expect(dead.xp[k]).toBeGreaterThanOrEqual(300);
    }
    // 300+ xp > 2^(1+7) = 256: those characters gain level 2 (and possibly more)
    for (const k of [0, 1, 3]) expect(sim.chars[k].level).toBeGreaterThanOrEqual(2);
    expect(sim.chars[2].level).toBe(1);
    expect(sim.monsters[0].alive).toBe(false);
    expect(sim.events.length).toBe(0); // the dead monster's act event is cancelled
  });

  it('vitals cadence: food/water -1 per 16 ticks, poison every 256, hunger every 128', () => {
    const party = startingParty(tables);
    const sim0 = new CombatSim(cfg({ party, monsters: [] })).run(160);
    for (const c of sim0.chars) { expect(c.food).toBe(4990); expect(c.water).toBe(4990); expect(c.energy).toBe(10000); }
    const p2 = startingParty(tables);
    p2[1].poison = 1; p2[3].food = 1990;
    const sim = new CombatSim(cfg({ party: p2, monsters: [] })).run(400);
    const hits = (k: number) => sim.log.filter(l => l.ev === 'damage' && l.char === k).map(l => (l as any).t);
    expect(hits(1)).toEqual([128, 384]);            // poison, t & 0xFF == 0x80
    expect(hits(3).slice(0, 2)).toEqual([64, 192]); // hunger, t & 0x7F == 0x40 (food < 2000)
    expect(hits(0)).toEqual([]);
  });

  it('game over when the last character dies, and the loop stops', () => {
    const p = startingParty(tables); p.forEach(c => { c.hp = 2; c.food = 100; });
    const sim = new CombatSim(cfg({ party: p, monsters: [] })).run(500);
    expect(sim.gameOver).toBe(true);
    expect(sim.log.filter(l => l.ev === 'game-over').length).toBe(1);
    expect(sim.tick).toBe(64);
  });

  it('monsters pursue along the script and hit; AC is the null control (high AC = fewer hits)', () => {
    const hits = (ac: number) => {
      let n = 0;
      for (let i = 0; i < 20; i++) {
        const p = startingParty(tables); p.forEach(c => { c.ac = ac; c.hp = c.maxHp = 5000; });
        const sim = new CombatSim(cfg({ party: p, seed: `00000000${i.toString(16).padStart(4, '0')}`, monsters: [monster({ x: 5, y: 1, b5: 2 })] })).run(100);
        n += sim.log.filter(l => l.ev === 'monster-hit').length;
        expect(sim.monsters[0].x).toBe(2); // it walked up to the square in front of the party
      }
      return n;
    };
    expect(hits(-6)).toBeGreaterThan(hits(30) * 3);
  });

  it('blocked squares stop the greedy step [h: real pathfinder +0x866C not modelled]', () => {
    const sim = new CombatSim(cfg({ blocked: ['4,1', '4,0', '4,2'], monsters: [monster({ x: 6, y: 1 })] })).run(60);
    expect(sim.monsters[0].x).toBe(5);
  });
});
