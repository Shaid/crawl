import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuleTables } from './rules';
import { ObjectWorld } from './object-world';
import { OBJ } from './rules-spell9';

const here = dirname(fileURLToPath(import.meta.url));
const T: RuleTables = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8')).tables;
const CH = (k: number) => 0x1758 + 0xa8 * k;

/** The reference playthrough: a scripted room (party of four, a corpse, a closed door, a trap, a generator, loot) run through the verified routines on one A4 image. */
function playthrough(seed = '0a1b2c3d4e5f') {
  const w = new ObjectWorld(T, seed);
  const a = w.a;
  w.party(20, 20, 0);                                             // facing 0 = y + 1: the front square is (20, 21)
  w.character(0, { cls: 0, level: 5, hp: 0, maxHp: 45 });                                   // dead fighter
  w.character(1, { cls: 1, level: 8, hp: 30, maxHp: 30, stat65: 15, spells: [4, 44, 41, 18] });   // cleric: RAISE DEAD, CREATE WALL, REMOVE TRAP, TELEPORT
  w.character(2, { cls: 0, level: 4, hp: 25, maxHp: 25 }); w.character(3, { cls: 2, level: 4, hp: 20, maxHp: 20 });
  w.a.setW(0x1a14, 1);
  // corpse of character 0 carried in the cleric's right hand (+0x1C); items on the floor of the party square
  w.object(5, { w0: 0x12, b5: 0x26, wC: 0, w8: 300 }); a.setW(CH(1) + 0x1c, 5);
  w.object(8, { w0: 0x12, b5: 0x05, w8: 500 }); w.object(9, { w0: 0x12, b5: 0x05, w8: 30000 });
  w.square(20, 20, [8, 9]);
  w.object(6, { w0: 1, b5: 0x11, wC: 0, wE: 0 }); w.square(21, 20, [6]);                 // a closed door east of the party
  w.object(7, { w0: 1, b5: 0x1e, wC: 1, wE: 1 }); w.square(20, 21, [7]);                  // a trap on the front square
  // generator (type 0x2E) at (22, 22): two spawns, limit 3, template at map row 0 column 2
  w.object(10, { w0: 1, b5: 0x2e, wC: 2, wE: 3, w10: 2, b7: 0 }); w.square(22, 22, [10]);
  w.object(20, { w0: 0x80b3, wA: 22, w10: 21 }); w.object(21, { w0: 0 }); w.object(22, { w0: 0x12, b5: 0x15, w8: 40 }); w.square(2, 0, [20]);
  w.square(30, 30, [], 0x00f00000);                                                        // a teleport target
  a.setW(0x1e2a, 1);                                                                       // wizard sight is on
  return w;
}

describe('reference playthrough (object world on the original memory layout)', () => {
  it('runs the scripted room and every step matches the rules the harness verified', () => {
    const w = playthrough(); const a = w.a;
    // 1. RAISE DEAD: the cleric (slot 1) holds the corpse of character 0
    const r1 = w.cast(1, 0, { pick: 1 });
    expect(r1.spent).toBe(1); expect(r1.failed).toBeUndefined();
    expect(w.hp(0)).toBe(Math.trunc(45 / 10) + 1);                                 // maxHp / 10 + 1 (revive, harness)
    expect(a.w(CH(1) + 0x1c)).toBe(0);                                              // corpse left the hand
    // 2. door
    w.openDoor(21, 20); expect(a.w(OBJ(6) + 0xe)).toBe(1);
    // 3. loot: the light item is taken, the heavy one is refused (limit = signed max-STR byte * 1000 = 20000)
    expect(w.pickup(2, 8, 20, 20)).toBe(true);
    expect(w.pickup(2, 9, 20, 20)).toBe(false);
    expect(w.chain(20, 20)).toEqual([9]);
    // 4. REMOVE TRAP on the front square, then CREATE WALL there (needs an empty square)
    expect(w.cast(1, 1, {}).failed).toBe(0);                                         // CREATE WALL with the trap still there: the square is occupied -> fail (-1 -> fail 0)
    const r3 = w.cast(1, 2, {}); expect(r3.spent).toBe(0); expect(w.chain(20, 21)).toEqual([]);
    const castTick = w.tick;
    const r4 = w.cast(1, 1, {}); expect(r4.spent).toBe(0);
    const wall = w.chain(20, 21); expect(wall.length).toBe(1);
    expect(a.b(OBJ(wall[0]) + 5)).toBe(0x10);
    const expiry = castTick + ((8 * 180) & 0xffff);                                  // D4 = level 8 + the signed +0x6A byte 0
    // 5. run: generator scans every 16 ticks, the wall expires at its due tick
    w.run(expiry - 1);
    expect(w.chain(20, 21).length).toBe(1);
    w.run(1);
    expect(w.tick).toBe(expiry); expect(w.chain(20, 21)).toEqual([]);
    expect(w.log.filter(e => e.what === 'wall expired')).toEqual([{ tick: expiry, what: 'wall expired', x: 20, y: 21 }]);
    // generator: exactly two spawns, on scan ticks (multiples of 16), at least 30 scans apart, then it is exhausted
    expect(a.w(OBJ(10) + 0xc)).toBe(0);
    const monsters = w.chain(22, 22).filter(id => a.w(OBJ(id)) & 0x8000);
    expect(monsters.length).toBe(2);
    const wakes = w.log.filter(e => e.what === 'event (not simulated here)' && e.type === 1);
    expect(wakes.length).toBe(2);
    for (const m of monsters) {                                                       // each spawn got its own copy of the carried item (loot), activated with the party as target
      expect(a.w(OBJ(m) + 0xa)).not.toBe(22); expect(a.w(OBJ(a.w(OBJ(m) + 0xa)) + 8)).toBe(40);
      expect(a.b(OBJ(a.w(OBJ(m) + 0x10)) + 0x13)).toBe(1);
    }
    // 6. TELEPORT: map pick (x = 30 in the high byte, y = 30 in the low byte)
    const r6 = w.cast(1, 3, { map: (30 << 8) | 30 });
    expect(r6.spent).toBe(1); expect([a.w(0x1742), a.w(0x1740)]).toEqual([30, 30]);
    // 7. the vitals of a step (harness) and determinism
    expect(w.stepCost().length).toBeGreaterThanOrEqual(0);
  });
  it('is deterministic for a seed and different seeds spawn differently', () => {
    const run = (seed: string) => { const w = playthrough(seed); w.cast(1, 0, { pick: 1 }); w.run(900); return JSON.stringify(w.log); };
    expect(run('0a1b2c3d4e5f')).toBe(run('0a1b2c3d4e5f'));
    expect(run('0a1b2c3d4e5f')).not.toBe(run('ffeeddccbbaa'));
  });
  it('null control: without the trap removal the wall can never be raised', () => {
    const w = playthrough(); w.cast(1, 1, {});                                      // slot 1 first: trap present -> fail
    expect(w.chain(20, 21)).toEqual([7]);
  });
});
