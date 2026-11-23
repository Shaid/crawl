import { describe, it, expect } from 'vitest';
import { startingParty } from './combat-sim';
import { BcSim, type Cmd } from './bc-sim';
import { OBJ } from './rules-spell9';
import { cfg, mon, V } from './bc-sim-fixtures';
const CH = (k: number) => 0x1758 + 0xa8 * k;

/** the scripted multi-room fight: two rooms joined by a closed door, a trap behind it, two melee monsters (one carries loot), a fighter with a sword, a cleric with REMOVE TRAP,
 *  a magic user with a ray spell. The plan is a pure function of the world state, so the whole timeline is a function of the seed. */
export function playthrough(seed: string) {
  const s = new BcSim(cfg({ seed }));
  s.room(10, 10, 14, 12); s.room(16, 10, 20, 12);
  s.breakWall(14, 11, 1); s.breakWall(15, 11, 1);                       // the doorway: (14,11) -> door square (15,11) -> (16,11)
  s.party(11, 11, 1);
  startingParty(V.tables).forEach((c, k) => s.setChar(k, { ...c, hp: 60, maxHp: 60 }));
  s.give(0, s.item(30, { gfx: 3, weight: 20 }), 0x1c);                 // the fighter's sword
  s.a.setB(CH(1) + 0x49, 41);                                           // cleric: REMOVE TRAP in slot 0
  s.a.setB(CH(2) + 0x49, 0);                                            // magic user: ray spell 0 in slot 0
  const door = s.structure(15, 11, { b5: 0x11, wE: 0 });
  const trap = s.structure(16, 11, { b5: 0x1e, wA: 0, wE: 1 });
  const key = s.item(31, { gfx: 0x20, weight: 2 }), gem = s.item(32, { gfx: 0x21, weight: 1 });
  const A = s.addMonster(mon({ x: 18, y: 11, hp: 14, maxHp: 14, xpBase: 80, loot: [key, gem], moveType: 0 }));
  const B = s.addMonster(mon({ x: 19, y: 12, hp: 9, maxHp: 9, xpBase: 40, moveType: 0 }));
  return { s, door, trap, A, B, key, gem };
}
export function plan(w: ReturnType<typeof playthrough>) {
  const { A, B, key, gem } = w;
  let stage = 0;
  return (sim: BcSim): Cmd[] => {
    const a = sim.a, px = a.w(0x1742), py = a.w(0x1740), f = a.w(0x1744), t = sim.tick;
    void t;
    switch (stage) {
      case 0: if (px < 14) return [{ kind: 'move', dir: 'forward' }]; stage = 1; return [{ kind: 'move', dir: 'forward' }];   // the last step bumps the closed door (verdict 1)
      case 1: stage = 2; return [{ kind: 'openDoor' }];
      case 2: if (px < 15) return [{ kind: 'move', dir: 'forward' }]; stage = 3; return [{ kind: 'cast', char: 1, slot: 0 }];   // on the door square: REMOVE TRAP on the square ahead
      case 3: if (px < 16) return [{ kind: 'move', dir: 'forward' }]; stage = 4; return [{ kind: 'cast', char: 2, slot: 0 }];   // on the trap square (now plain floor): the magic user fires a ray
    }
    if (stage === 4) {
      const cmds: Cmd[] = [];
      for (const P of [A, B]) {
        const xy = sim.monsterXY(P); if (!xy) continue;
        const dx = xy[0] - px, dy = xy[1] - py;
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const want = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 0 : 2;
        if (want === f) return [{ kind: 'attack', char: 0 }];
        return [{ kind: 'turn', by: ((want - f + 4) & 3) === 1 ? 1 : -1 }];
      }
      if (sim.monsterAlive(A) || sim.monsterAlive(B)) return cmds.concat([{ kind: 'wait' }]);
      stage = 5;
    }
    if (stage === 5) { if (f !== 1) return [{ kind: 'turn', by: ((1 - f + 4) & 3) === 1 ? 1 : -1 }]; stage = 6; return [{ kind: 'move', dir: 'forward' }]; }
    if (stage === 6) { stage = 7; return [{ kind: 'pickup', char: 0, item: key }]; }
    if (stage === 7) { stage = 8; return [{ kind: 'pickup', char: 0, item: gem }]; }
    if (stage === 8) { stage = 9; return [{ kind: 'equip', char: 0, item: key, hand: 1 }]; }
    return [{ kind: 'wait' }];
  };
}
const compact = (s: BcSim) => s.log.map(l => `${l.tick}:${l.what}${l.P ? '#' + l.P : ''}${l.ch !== undefined ? '/' + l.ch : ''}${l.hit !== undefined ? (l.hit ? '+' : '-') : ''}${l.dmg ? '=' + l.dmg : ''}`);
const SEED = 'a27740bfd561';
const GOLDEN: string[] = [
  '0:step-party', '1:step-party', '2:step-party', '3:blocked', '4:door open', '5:step-party', '6:cast/1', '7:step#3', '7:step-party', '8:monster-dead#3', '8:ray/2',
  '8:cast/2', '11:step#5', '16:step#5', '21:step#5', '22:swing#5/0-', '26:monster-hit#5/1=3', '26:damage/1=3', '27:swing#5/0-',
  '32:swing#5/0-', '37:swing#5/0+=3', '42:swing#5/0-', '47:swing#5/0-', '52:swing#5/0-', '57:swing#5/0-', '62:swing#5/0-', '67:swing#5/0-',
  '72:swing#5/0-', '77:swing#5/0-', '82:swing#5/0-', '87:swing#5/0-', '92:swing#5/0-', '97:swing#5/0-', '102:swing#5/0-', '107:swing#5/0-',
  '112:swing#5/0-', '117:swing#5/0-', '122:swing#5/0-', '127:swing#5/0-', '132:swing#5/0-', '137:swing#5/0-', '141:monster-hit#5/0=3',
  '141:damage/0=3', '142:swing#5/0-', '147:swing#5/0-', '152:swing#5/0-', '157:swing#5/0-', '162:swing#5/0-', '167:swing#5/0-', '172:swing#5/0-',
  '177:swing#5/0+=8', '177:monster-dead#5', '179:step-party', '180:pickup/0', '181:pickup/0', '182:equip/0',
];
describe('reference playthrough (unified world): two rooms, a door, a trap, a ray, melee, loot', () => {
  it('asserts the whole timeline (a regression guard of this implementation: every rule inside is oracle-diffed)', () => {
    const w = playthrough(SEED); w.s.play(400, plan(w));
    expect(compact(w.s)).toEqual(GOLDEN);
  });
  it('the facts of the fight, independent of the golden list', () => {
    const w = playthrough(SEED), s = w.s; s.play(400, plan(w));
    const at = (what: string) => s.log.filter(l => l.what === what);
    expect(at('blocked')[0]).toMatchObject({ tick: 3, why: 'structure', x: 15, y: 11 });          // the closed door stops the party at (14, 11)
    expect(at('door open')).toHaveLength(1);
    expect(at('trap')).toHaveLength(0);                                                              // REMOVE TRAP took the trap away before the party stepped on it
    expect(s.a.b(OBJ(w.trap) + 5)).toBe(0x1e);                                                       // (the record is on the free list, not erased)
    expect(s.chain(16, 11).includes(w.trap)).toBe(false);
    const ray = at('ray')[0] as any;
    expect(ray.hits[0].killed).toBe(true);                                                           // the ray kills monster A (14 hp) through the real kill path
    const deadA = at('monster-dead')[0] as any;
    expect(deadA.P).toBe(w.A);
    for (const k of [0, 1, 2, 3]) expect(deadA.xp[k]).toBeGreaterThanOrEqual(80);
    expect(s.chain(17, 11)).toEqual([]);                                                             // the loot was picked up again
    expect(at('pickup')).toHaveLength(2);
    expect([0, 1, 2, 3, 4, 5].map(k => s.a.w(CH(0) + 0x16 + 2 * k))).toContain(w.gem);
    expect(s.a.w(CH(0) + 0x1a)).toBe(w.key);                                                         // equipped in hand 1
    expect(s.monsterAlive(w.A) || s.monsterAlive(w.B)).toBe(false);
    expect(at('monster-hit').length).toBeGreaterThan(0);                                             // B hurt the party before it fell
    expect([0, 1, 2, 3].every(k => s.hpOf(k) > 0)).toBe(true);
  });
  it('is deterministic per seed and the timeline changes with the seed', () => {
    const run = (seed: string) => { const w = playthrough(seed); w.s.play(400, plan(w)); return JSON.stringify(compact(w.s)); };
    expect(run(SEED)).toBe(run(SEED));
    expect(run('0123456789ab')).not.toBe(run(SEED));
  });
  it('null control: without the cleric\'s REMOVE TRAP the party springs the trap', () => {
    const w = playthrough(SEED); const p = plan(w);
    w.s.play(60, sim => p(sim).filter(c => !(c.kind === 'cast' && c.char === 1)));
    expect(w.s.log.some(l => l.what === 'trap')).toBe(true);
  });
});
