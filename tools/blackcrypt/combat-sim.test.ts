import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng } from './rules';
import { monsterMelee, type AiScripts } from './rules-monster';
import { CombatSim, startingParty, type SimConfig, type SimMonster, type LogEntry } from './combat-sim';

/** well-spread 12-hex-digit seeds (the stream's first bytes barely differ for seeds that differ only in the last digits) */
const sd = (i: number) => (BigInt(i + 1) * 0x9e3779b97f4an % (1n << 48n)).toString(16).padStart(12, '0');
const book = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'rules_oracle/spellbook.json'), 'utf8'));

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
    const c = cfg({ initiallyActive: true });
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
        const sim = new CombatSim(cfg({ party: p, seed: `00000000${i.toString(16).padStart(4, '0')}`, monsters: [monster({ x: 4, y: 1, b5: 2 })] })).run(100);
        n += sim.log.filter(l => l.ev === 'monster-hit').length;
        expect(sim.monsters[0].x).toBe(2); // it walked up to the square in front of the party
      }
      return n;
    };
    expect(hits(-6)).toBeGreaterThan(hits(30) * 3);
  });

  it('a wall between monster and party: no path, the activation scan parks the monster in movement type 10 and it never crosses', () => {
    const blocked = [0, 1, 2, 3, 4].map(y => `3,${y}`);
    const sim = new CombatSim(cfg({ blocked, height: 5, py: 2, monsters: [monster({ x: 4, y: 2 })] })).run(300);
    expect(sim.monsters[0].x).toBeGreaterThanOrEqual(4);
    expect(sim.log.some(l => l.ev === 'activate' && l.kind === 'park')).toBe(true);
    expect(sim.log.some(l => l.ev === 'monster-hit')).toBe(false);
  });
  it('null control for the wall: without it the same monster walks to the party and hits', () => {
    const sim = new CombatSim(cfg({ height: 5, py: 2, monsters: [monster({ x: 4, y: 2 })] })).run(300);
    expect(sim.log.some(l => l.ev === 'monster-hit')).toBe(true);
  });
  it('activation: only monsters inside the 7x7 scan window wake (distance 4 stays asleep), the scan runs every 16 ticks', () => {
    const near = new CombatSim(cfg({ monsters: [monster({ x: 4, y: 1 })] })).run(40);
    const act = near.log.find(l => l.ev === 'activate');
    expect(act && act.t).toBe(16);
    const far = new CombatSim(cfg({ monsters: [monster({ x: 5, y: 1 })] })).run(200);
    expect(far.log.some(l => l.ev === 'activate' || l.ev === 'step')).toBe(false);
    expect(far.monsters[0].x).toBe(5);
  });
  it('ranged monster: fire-bolt caster hurts the party from a distance; null control without spells does nothing at range', () => {
    const caster = (w0c: number) => monster({ x: 4, y: 1, b6: 4, w0c, b7: 3, b3: 0x04 });
    const hitsAtRange = (w0c: number) => {
      let n = 0, total = 0;
      for (let i = 0; i < 40; i++) {
        const p = startingParty(tables); p.forEach(c => { c.hp = c.maxHp = 5000; });
        const sim = new CombatSim(cfg({ party: p, width: 10, seed: sd(i), initiallyActive: true, monsters: [caster(w0c)] }));
        for (let t = 0; t < 200; t++) {
          const before = sim.log.length;
          sim.step1();
          for (const l of sim.log.slice(before)) if (l.ev === 'monster-hit') { total++; if (Math.abs(sim.monsters[0].x - sim.px) >= 2) n++; }
        }
      }
      return { n, total };
    };
    const bolts = hitsAtRange(1 << 4);
    expect(bolts.n).toBeGreaterThan(5);
    const none = hitsAtRange(0);
    expect(none.total).toBe(0);
  });
  it('hold bolt: the party is held (commands ignored) for the counter the effect adds, then free again', () => {
    const p = startingParty(tables); p.forEach(c => { c.hp = c.maxHp = 5000; });
    p[0].weapon = { gfx: 3, extra: 0 };
    let held = 0;
    for (let i = 0; i < 12 && !held; i++) {
      const sim = new CombatSim(cfg({ party: p, width: 10, seed: sd(i + 40), initiallyActive: true, monsters: [monster({ x: 4, y: 1, b6: 4, w0c: 1 << 11, b7: 1, hp: 9999, maxHp: 9999 })] }));
      for (let t = 0; t < 200 && !held; t++) { sim.step1(); if (sim.log.some(l => l.ev === 'hold')) held = sim.hold; }
      if (held) {
        const hp = sim.monsters[0].hp, front = sim.monsters[0].x === sim.px + 1;
        expect(sim.hold).toBeGreaterThan(0);
        if (front) { sim.step1([{ kind: 'attack', char: 0 }]); expect(sim.log.filter(l => l.ev === 'swing').length).toBe(0); expect(sim.monsters[0].hp).toBe(hp); }
        for (let t = 0; t < 40; t++) sim.step1();
        expect(sim.hold).toBe(0);
      }
    }
    expect(held).toBeGreaterThan(0);
  });
  it('stacking: same-gfx monsters share a square in corners; a swing takes the near-corner monster first', () => {
    const a = monster({ x: 2, y: 1, pos: 0, hp: 999, maxHp: 999 }), b = monster({ x: 2, y: 1, pos: 3, hp: 999, maxHp: 999 });
    const p = startingParty(tables); p[0].weapon = { gfx: 3, extra: 0 };
    const sim = new CombatSim(cfg({ party: p, monsters: [a, b] }));
    expect(sim.monstersAt(2, 1).length).toBe(2);
    sim.step1([{ kind: 'attack', char: 0 }]);
    const sw = sim.log.find(l => l.ev === 'swing');
    expect(sw && sw.ev === 'swing' && sw.monster).toBe(0); // facing east: near corners are 0 and 3, 0 first
  });

  it('ray spell: damages the first monster in line, a wall in between blocks it (spell 0 = pre 1 ray, range 3)', () => {
    const run = (blocked: string[]) => {
      const sim = new CombatSim(cfg({ blocked, monsters: [monster({ x: 3, y: 1, hp: 500, maxHp: 500 })] }));
      sim.step1([{ kind: 'ray', char: 1, spell: 0 }]);
      return sim;
    };
    const open = run([]);
    const ray = open.log.find(l => l.ev === 'ray');
    expect(ray && ray.ev === 'ray' && ray.hits.length).toBe(1);
    expect(open.monsters[0].hp).toBeLessThan(500);
    const walled = run(['2,1']);
    expect(walled.monsters[0].hp).toBe(500);
  });
  it('ray kill awards XP and removes the monster', () => {
    const sim = new CombatSim(cfg({ monsters: [monster({ x: 2, y: 1, hp: 1, maxHp: 1, xpBase: 400 })] }));
    sim.step1([{ kind: 'ray', char: 1, spell: 0 }]);
    expect(sim.monsters[0].alive).toBe(false);
    expect(sim.chars.every(c => c.xp >= 400)).toBe(true);
  });

  describe('party spells through the harnessed dispatcher, memorise and recharge', () => {
    const wounded = () => { const p = startingParty(tables); p[1].hp = 3; p[1].level = 2; p[3].level = 2; return p; };
    const sp = (o: Partial<SimConfig> = {}) => cfg({ spells: book, monsters: [], ...o });
    it('memorise sets a recharge timer; the same spell cannot be memorised again until it runs down; resting runs it faster', () => {
      const run = (resting: boolean) => {
        const sim = new CombatSim(sp({ party: wounded() }));
        sim.step1([{ kind: 'memorise', char: 1, row: 3 }]); // page 0, row 3 = spell 3 (level 1)
        expect(sim.chars[1].slots![0]).toBe(3);
        const t0 = sim.book!.timers[3];
        expect(t0).toBeGreaterThan(1000);
        if (resting) sim.step1([{ kind: 'rest', on: true }]);
        sim.step1([{ kind: 'memorise', char: 1, row: 3 }]);
        expect(sim.chars[1].slots![1]).toBe(0xff); // refused while the timer runs
        return { sim, t0 };
      };
      const a = run(false), b = run(true);
      const d = (r: { sim: CombatSim; t0: number }) => r.t0 - r.sim.book!.timers[3];
      expect(d(b)).toBeGreaterThan(d(a));
      const sim = a.sim;
      sim.run(sim.book!.timers[3] + 2);
      expect(sim.book!.timers[3]).toBe(0);
      sim.step1([{ kind: 'memorise', char: 1, row: 3 }]);
      expect(sim.chars[1].slots![1]).toBe(3);
    });
    it('HEAL (3): heals the picked character, spends the charge and shifts the slots; empty slot is the null control', () => {
      const p = wounded(); p[1].slots = [3, 1, 0xff, 0xff, 0xff];
      const sim = new CombatSim(sp({ party: p }));
      sim.step1([{ kind: 'cast', char: 1, slot: 0, pick: 1 }]);
      expect(sim.chars[1].hp).toBeGreaterThan(3);
      expect(sim.chars[1].slots).toEqual([1, 0xff, 0xff, 0xff, 0xff]);
      const ctl = new CombatSim(sp({ party: wounded() }));
      ctl.step1([{ kind: 'cast', char: 1, slot: 0, pick: 1 }]);
      expect(ctl.chars[1].hp).toBe(3);
    });
    it('anti-magic square: the spell fizzles and the charge is still spent', () => {
      const p = wounded(); p[1].slots = [3, 0xff, 0xff, 0xff, 0xff];
      const sim = new CombatSim(sp({ party: p, antimagic: ['1,1'] }));
      sim.step1([{ kind: 'cast', char: 1, slot: 0, pick: 1 }]);
      expect(sim.chars[1].hp).toBe(3);
      expect(sim.chars[1].slots![0]).toBe(0xff);
    });
    it('SHIELD (15): AC rises, the expiry event fires 1800 ticks later [expiry handler: hypothesis]', () => {
      const p = wounded(); p[1].slots = [15, 0xff, 0xff, 0xff, 0xff];
      const sim = new CombatSim(sp({ party: p }));
      const ac0 = sim.chars[1].ac;
      sim.step1([{ kind: 'cast', char: 1, slot: 0, pick: 1 }]);
      expect(sim.chars[1].ac).toBeGreaterThan(ac0);
      sim.run(1805);
      expect(sim.chars[1].ac).toBe(ac0);
      expect(sim.log.some(l => l.ev === 'expire' && l.type === 0x1e)).toBe(true);
    });
    it('ray spell from a memorised slot damages a monster in line; same cast with an empty slot does nothing', () => {
      const mk = (slots: number[]) => { const p = wounded(); p[1].slots = slots; return new CombatSim(sp({ party: p, monsters: [monster({ x: 3, y: 1, hp: 500, maxHp: 500 })] })); };
      const a = mk([0, 0xff, 0xff, 0xff, 0xff]); a.step1([{ kind: 'cast', char: 1, slot: 0 }]);
      expect(a.monsters[0].hp).toBeLessThan(500);
      const b = mk([0xff, 0xff, 0xff, 0xff, 0xff]); b.step1([{ kind: 'cast', char: 1, slot: 0 }]);
      expect(b.monsters[0].hp).toBe(500);
    });
    it('whole-run determinism with monsters, spells and recharge; other seeds diverge', () => {
      const run = (seed: string) => {
        const p = wounded(); p[1].slots = [0, 3, 15, 0xff, 0xff];
        const sim = new CombatSim(sp({ seed, party: p, monsters: [monster({ x: 4, y: 1, hp: 80, maxHp: 80 }), monster({ x: 4, y: 0, hp: 80, maxHp: 80 })] }));
        return JSON.stringify(sim.run(300, s => (s.tick % 40 === 20 ? [{ kind: 'cast' as const, char: 1, slot: 0, pick: 1 }] : [])).log);
      };
      const a = run('a27740bfd561');
      expect(run('a27740bfd561')).toBe(a);
      expect(run('0127740bfd56')).not.toBe(a);
    });
  });
});
