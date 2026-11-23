import { describe, it, expect } from 'vitest';
import { startingParty } from './combat-sim';
import { BcSim, type Cmd } from './bc-sim';
import { OBJ, CELL, lookupType } from './rules-spell9';
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

// ====================================================================================================================================================================================
// Reference playthrough 2 (pass 8): the world effects. One corridor, in walking order:
//   (12,11) a TRAP square whose action records burn the party (fire, executor op 0x1C) and raise a wall behind it (op 0x10)      -> walk-in verdict 6, TriggerActionsAt, executor
//   (13,11) a PRESSURE PLATE (trigger command) whose delayed record (event 0x28, 2 ticks) toggles the door ahead                  -> event queue, effect slot, executor op 0x18
//   (14,11) a poison GLYPH (kind 4)                                                                                                -> glyph effect, the glyph is consumed
//   (16,11) a LOCKED DOOR (state 2) with a one-key lock; the key opens, unlocks and consumes                                       -> bump, key-on-lock, door click
//   (18,11) a PIT whose destination is (22,11)                                                                                     -> pit damage, relocation
//   (22,11) a healing potion (use), then the RAM BOSS at (23,11): PROTECTOR, SOULFREEZER, VORTEX, FORCEHAMMER                      -> item dispatcher, boss stage machine, FORCEHAMMER
// ====================================================================================================================================================================================
const SEED2 = 'a27740bfd561';
function records(s: BcSim, structure: number, recs: { op: number; x: number; y: number; v?: number; delay?: number }[], base: number) {
  const a = s.a;
  recs.forEach((r, i) => {
    const o = 0x836 + 8 * (base + i);
    a.setB(o, r.op); a.setB(o + 1, 1); a.setB(o + 2, r.x); a.setB(o + 3, r.y); a.setB(o + 4, 255); a.setB(o + 5, r.delay ?? 0); a.setB(o + 6, r.v ?? 0); a.setB(o + 7, i + 1 < recs.length ? base + i + 1 : 0);
  });
  a.setB(OBJ(structure) + 0xd, base); a.setB(OBJ(structure) + 0x11, 0);
}
export function playthrough2(seed: string) {
  const s = new BcSim(cfg({ seed }));
  s.room(10, 10, 24, 12);
  s.party(11, 11, 1);
  startingParty(V.tables).forEach((c, k) => s.setChar(k, { ...c, hp: 120, maxHp: 120 }));
  const trap = s.structure(12, 11, { b5: 0x1e, wA: 0, wE: 1 });
  records(s, trap, [{ op: 0x1c, x: 12, y: 11, v: 2 }, { op: 0x10, x: 11, y: 11, v: 3 }], 1);           // fire (5 + rand16(10) each), wall bit 3 on the square behind
  const plate = s.structure(13, 11, { b5: 0x1d, wA: 0 });
  const door = s.structure(16, 11, { b5: 0x11, wE: 2 });
  const lock = s.structure(16, 11, { b5: 0x22, wC: 7, wE: 1 });
  records(s, plate, [{ op: 0x0b, x: 12, y: 12, delay: 2 }], 3);                                           // delayed: teleporter off at an unused square (visible only as the event firing)
  const glyph = s.structure(14, 11, { b5: 0x10, wC: 3, wA: 0, wE: 0, w10: 4 });
  const pit = s.structure(18, 11, { b5: 0x14, wA: 0, wC: 22, wE: 11, w10: 3, w8: 0 });
  const key = s.item(40, { gfx: 0x20, b5: 6, extra: 7, weight: 1 });
  s.give(1, key, 0x16 + 12 + 2);
  const potion = s.item(41, { gfx: 0x30, weight: 1 }); s.a.setW(OBJ(potion) + 0xe, 0x96); s.a.setB(OBJ(potion) + 7, 2);
  s.give(3, potion, 0x16 + 12);
  s.structure(12, 17, { b5: 0x12, wA: 1 });
  const boss = s.addMonster(mon({ x: 23, y: 11, gfx: 0x80c5, hp: 120, maxHp: 120, xpBase: 10, moveType: 0 }));
  const items = [0x8d, 0x8e, 0x8f, 0x90].map((e, i) => { const it = s.item(50 + i, { gfx: 0x31 }); s.a.setW(OBJ(it) + 0xe, e); s.give(2, it, 0x16 + 12 * (i >> 1) + 2 * (i & 1) + 0); return it; });
  s.a.setW(0x1a1e, 1);                                                                                    // the boss has been hurt once: stage 1
  return { s, trap, plate, door, lock, glyph, pit, key, potion, boss, items };
}
export function plan2(w: ReturnType<typeof playthrough2>) {
  let stage = 0, wait = 0;
  return (sim: BcSim): Cmd[] => {
    const px = sim.a.w(0x1742);
    if (wait > 0) { wait--; return [{ kind: 'wait' }]; }
    switch (stage) {
      case 0: if (px < 12) return [{ kind: 'move', dir: 'forward' }]; stage = 1; return [{ kind: 'move', dir: 'forward' }];       // the trap square
      case 1: stage = 2; return [{ kind: 'move', dir: 'forward' }];                                                            // the plate square (13, 11)
      case 2: stage = 3; return [{ kind: 'trigger', x: 13, y: 11, type: 0x1d }];
      case 3: stage = 4; wait = 3; return [{ kind: 'move', dir: 'forward' }];                                                  // the glyph (14, 11)
      case 4: stage = 5; return [{ kind: 'move', dir: 'forward' }];                                                            // (15, 11)
      case 5: stage = 6; return [{ kind: 'move', dir: 'forward' }];                                                            // bumps the locked door
      case 6: stage = 7; return [{ kind: 'cursor', char: 1, item: w.key }];
      case 7: stage = 8; return [{ kind: 'useKey', char: 1 }];
      case 8: if (px < 17) return [{ kind: 'move', dir: 'forward' }]; stage = 9; return [{ kind: 'move', dir: 'forward' }];       // through the door, onto (17, 11)
      case 9: stage = 10; return [{ kind: 'move', dir: 'forward' }];                                                           // the pit (18, 11)
      case 10: stage = 11; return [{ kind: 'use', char: 3, item: w.potion }];                                                  // at (22, 11)
      case 11: stage = 12; return [{ kind: 'use', char: 2, item: w.items[0] }];                                                // PROTECTOR
      case 12: stage = 13; return [{ kind: 'use', char: 2, item: w.items[1] }];                                                // SOULFREEZER
      case 13: stage = 14; return [{ kind: 'use', char: 2, item: w.items[2] }];                                                // VORTEX
      case 14: stage = 15; return [{ kind: 'use', char: 2, item: w.items[3] }];                                                // FORCEHAMMER
    }
    return [{ kind: 'wait' }];
  };
}
const compact2 = (s: BcSim) => s.log.map(l => `${l.tick}:${l.what}${l.id !== undefined ? '#' + l.id : ''}${l.op !== undefined ? '@' + (l.op as number).toString(16) : ''}${l.ch !== undefined ? '/' + l.ch : ''}${l.verdict !== undefined ? 'v' + l.verdict : ''}`);
describe('reference playthrough 2 (pass 8): trap, plate, glyph, locked door and key, pit, item, boss stages', () => {
  it('runs the whole sequence and asserts its facts', () => {
    const w = playthrough2(SEED2), s = w.s; s.play(60, plan2(w));
    const at = (what: string) => s.log.filter(l => l.what === what);
    // the trap: fire damage to every character (the executor's op 0x1C) and the wall behind the party (op 0x10)
    expect(at('trap')).toHaveLength(1);
    expect(at('action').map(l => l.op)).toEqual([0x1c, 0x10, 0x0b]);                                   // 0x0b is the plate's delayed record, run through the effect slot
    expect(at('action')[0]).toMatchObject({ x: 12, y: 11, v: 2 });
    expect((at('action')[0] as any).lost.every((v: number) => v >= 5 && v <= 14)).toBe(true);
    expect(s.a.w(CELL(11, 11) + 2) & 0x8000).toBe(0x8000);
    // the plate fires once, its delayed record two ticks later, and the structure unlocks again afterwards
    const trig = at('trigger'); expect(trig.map(l => l.type)).toEqual([0x1e, 0x1d]);
    expect(at('action')[2].tick - trig[1].tick).toBe(2);
    expect(s.a.w(OBJ(w.plate) + 0xa)).toBe(0);
    // the glyph poisons everyone and is consumed
    expect([0, 1, 2, 3].map(k => s.a.b(CH(k) + 0x9a))).toEqual([1, 1, 1, 1].map((_, k) => s.a.b(CH(k) + 0x9a)));
    expect(at('glyph')).toHaveLength(1);
    expect(lookupType(s.a, 14, 11, 0x10)).toBe(0);
    // the locked door bumps the party, the key opens it and is consumed
    expect(at('blocked').some(l => l.x === 16)).toBe(true);
    expect(at('use-key')[0]).toMatchObject({ used: true });
    expect(s.a.w(OBJ(w.door) + 0xe)).toBe(1);
    expect(s.a.w(OBJ(w.lock) + 0xe)).toBe(0);
    // the pit hurts and relocates; the potion heals; the boss items run in stage order and FORCEHAMMER removes the boss
    expect(at('pit')).toHaveLength(1);
    expect(at('step-party').some(l => l.x === 22 && l.verdict === 2)).toBe(true);
    expect(at('use-item').map(l => l.result)).toEqual([1, 1, 1, 1, 1]);
    expect(s.a.w(0x1a1e)).toBe(5);
    expect(s.monsterAlive(w.boss)).toBe(false);
    expect(s.a.b(OBJ(w.potion) + 7)).toBe(1);                                                           // one charge spent
    expect(s.gameOver).toBe(false);
  });
  it('is deterministic per seed and the timeline changes with the seed', () => {
    const run = (seed: string) => { const w = playthrough2(seed); w.s.play(60, plan2(w)); return JSON.stringify(compact2(w.s)); };
    expect(run(SEED2)).toBe(run(SEED2));
    expect(run('0123456789ab')).not.toBe(run(SEED2));
  });
  it('null controls: without the key the door stays locked; the wrong stage order leaves the boss alive', () => {
    const w = playthrough2(SEED2); const p = plan2(w);
    w.s.play(60, sim => p(sim).filter(c => c.kind !== 'useKey'));
    expect(w.s.a.w(OBJ(w.door) + 0xe)).toBe(2);
    expect(w.s.a.w(0x1a22)).toBe(w.key);
    const v = playthrough2(SEED2); const q = plan2(v);
    v.s.a.setW(0x1a1e, 0);                                                                              // the boss never went below 50 hp: stage 0, PROTECTOR refuses and the chain stalls
    v.s.play(60, q);
    expect(v.s.monsterAlive(v.boss)).toBe(true);
    expect(v.s.a.w(0x1a1e)).toBe(0);
  });
  it('golden timeline (a regression guard of this implementation; every rule inside is oracle-diffed)', () => {
    const w = playthrough2(SEED2); w.s.play(60, plan2(w));
    expect(compact2(w.s)).toEqual(GOLDEN2);
  });
});
const GOLDEN2: string[] = [
  '0:step-partyv6', '0:trap', '0:action#1@1c', '0:action#2@10', '0:trigger', '1:step-partyv0', '2:step-partyv5', '2:glyph', '3:trigger', '4:step-partyv0',
  '5:action#0@b', '8:blocked', '9:blocked', '10:cursor/1', '11:use-key', '12:step-partyv0', '13:step-partyv0', '14:step-partyv2', '14:pit', '15:monster-hit/0',
  '15:damage/0', '15:blocked', '16:use-item/3', '17:boss-item', '17:use-item/2', '18:boss-item', '18:use-item/2', '19:boss-item', '19:use-item/2', '20:forcehammer',
  '20:use-item/2',
];
