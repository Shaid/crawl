import { describe, it, expect } from 'vitest';
import { BcEngine, describeEvent, type BcState, type BcCmd, type BcEvent } from './engine';
import { MapBuilder, monster, item, door, fireTrap, stairs, world } from './synth';
import { OBJ } from '../rules-spell9';
import { BcRng } from '../rules';
import { BcSim, type Cmd } from '../bc-sim';
import { startingParty } from '../combat-sim';
import { cfg, mon, V } from '../bc-sim-fixtures';
import { allocObj } from '../rules-spell9';

const CH = (k: number) => 0x1758 + 0xa8 * k;
const SEED = 1234;
/** a corridor room (10..24, 10..12), party at (11, 11) facing +x */
function corridor(f: (b: MapBuilder) => void): BcState {
  const b = new MapBuilder().room(10, 10, 24, 12); f(b);
  const st = BcEngine.newGame(world([b.build()]), SEED, { pose: { x: 11, y: 11, facing: 1 } });
  for (let k = 0; k < 4; k++) { st.sim.a.setW(CH(k) + 0x4e, 60); st.sim.a.setW(CH(k) + 0x50, 60); }
  return st;
}
const run = (st: BcState, n: number, plan: (st: BcState, t: number) => BcCmd[] = () => []) => { const ev: BcEvent[] = []; for (let t = 0; t < n; t++) ev.push(...BcEngine.step(st, plan(st, t))); return ev; };
const at = (ev: BcEvent[], what: string) => ev.filter(e => e.what === what);

describe('BcEngine scenarios (synthetic maps, no retail data)', () => {
  it('walks, turns and is stopped by a wall', () => {
    const st = corridor(() => {});
    const ev = run(st, 20, () => [{ kind: 'move', dir: 'forward' }]);
    const v = BcEngine.view(st);
    expect(v.pose).toMatchObject({ x: 24, y: 11, facing: 1 });
    expect(at(ev, 'step-party')).toHaveLength(13);
    expect(at(ev, 'blocked').length).toBeGreaterThan(0);
    run(st, 1, () => [{ kind: 'turn', by: 1 }]);
    expect(BcEngine.view(st).pose.facing).toBe(2);
  });
  it('fights a monster to death: XP is awarded, the log says so', () => {
    const st = corridor(b => b.put(12, 11, monster({ hp: 4, xp: 60 })));
    const xp0 = BcEngine.view(st).party[0].xp;
    const ev = run(st, 400, s => (BcEngine.view(s).ahead.monsters.length ? [{ kind: 'attack', char: 0 }] : []));
    expect(at(ev, 'swing').length).toBeGreaterThan(0);
    expect(at(ev, 'monster-dead')).toHaveLength(1);
    expect(BcEngine.view(st).party[0].xp).toBeGreaterThan(xp0);
    expect(BcEngine.view(st).ahead.monsters).toHaveLength(0);
    expect(describeEvent(at(ev, 'monster-dead')[0])).toMatch(/dies/);
  });
  it('null control: a party that never attacks does not kill the monster', () => {
    const st = corridor(b => b.put(12, 11, monster({ hp: 4, xp: 60 })));
    const ev = run(st, 120);
    expect(at(ev, 'monster-dead')).toHaveLength(0);
  });
  it('casts a ray spell that kills a monster down the corridor', () => {
    const st = corridor(b => b.put(13, 11, monster({ hp: 10, xp: 80, b3: 0x04 })));
    st.sim.a.setB(CH(2) + 0x49, 0);
    const ev = run(st, 3, (_s, t) => (t === 0 ? [{ kind: 'cast', char: 2, slot: 0 }] : []));
    const ray = at(ev, 'ray')[0] as unknown as { hits: { killed: boolean }[] };
    expect(ray.hits[0].killed).toBe(true);
    expect(at(ev, 'monster-dead')).toHaveLength(1);
    expect(BcEngine.view(st).party[2].spells).toEqual([]);   // the charge is spent
  });
  it('a closed door blocks until it is opened', () => {
    const st = corridor(b => b.put(13, 11, door(0)));
    const ev = run(st, 8, (_s, t) => (t === 5 ? [{ kind: 'openDoor' }] : [{ kind: 'move', dir: 'forward' }]));
    expect(at(ev, 'blocked').some(e => e.why === 'structure')).toBe(true);
    expect(at(ev, 'door open')).toHaveLength(1);
    expect(BcEngine.view(st).pose.x).toBeGreaterThanOrEqual(13);
    const closed = corridor(b => b.put(13, 11, door(0)));
    run(closed, 12, () => [{ kind: 'move', dir: 'forward' }]);
    expect(BcEngine.view(closed).pose.x).toBe(12);
  });
  it('a trap square burns the party', () => {
    const st = corridor(b => b.put(12, 11, fireTrap(12, 11)));
    const ev = run(st, 3, (_s, t) => (t === 0 ? [{ kind: 'move', dir: 'forward' }] : []));
    expect(at(ev, 'trap')).toHaveLength(1);
    expect(at(ev, 'action')[0]).toMatchObject({ op: 0x1c });
    expect(BcEngine.view(st).party.every(p => p.hp < 60)).toBe(true);
  });
  it('picks up a potion, drinks it, and the hurt character heals', () => {
    const st = corridor(b => b.put(11, 11, item(0x30, { weight: 1, wE: 0x96, b7: 2 })));
    const id = st.sim.chain(11, 11)[0];
    st.sim.damage(3, 30, 4, 1);
    const hurt = BcEngine.view(st).party[3].hp;
    const ev = run(st, 4, (_s, t) => (t === 0 ? [{ kind: 'pickup', char: 3, item: id }] : t === 2 ? [{ kind: 'use', char: 3, item: id }] : []));
    expect(at(ev, 'pickup')).toHaveLength(1);
    expect(at(ev, 'use-item')[0]).toMatchObject({ result: 1 });
    expect(BcEngine.view(st).party[3].hp).toBeGreaterThan(hurt);
    expect(BcEngine.view(st).party[3].pack).toContain(id);
    expect(st.sim.a.b(OBJ(id) + 7)).toBe(1);                       // one charge spent
  });
  it('a map is loaded verbatim: monster loot hangs off the monster and drops on death', () => {
    const st = corridor(b => b.put(12, 11, monster({ hp: 1, loot: [item(0x20, { weight: 2 }), item(0x21, { weight: 1 })] })));
    const ev = run(st, 400, s => (BcEngine.view(s).ahead.monsters.length ? [{ kind: 'attack', char: 0 }] : []));
    expect(at(ev, 'monster-dead')).toHaveLength(1);
    expect(st.sim.chain(12, 11).length).toBe(2);
  });
});

describe('map change (stairs)', () => {
  it('takes the party to the destination map and keeps characters, carried items and the clock', () => {
    const m1 = new MapBuilder().room(10, 10, 24, 12).put(13, 11, stairs(2, 20, 11)).put(11, 11, item(0x30, { weight: 1, wE: 0x96, b7: 2 }));
    const m2 = new MapBuilder().room(15, 10, 30, 12).put(25, 11, monster({ hp: 5 })); m2.cells[0] = 0;
    const st = BcEngine.newGame(world([m1.build(1), m2.build(2)]), 9, { pose: { x: 11, y: 11, facing: 1 } });
    const potion = st.sim.chain(11, 11)[0];
    st.sim.damage(1, 7, 4, 1);
    const ev = run(st, 8, (s, t) => (t === 0 ? [{ kind: 'pickup', char: 3, item: potion }] : s.map === 1 ? [{ kind: 'move', dir: 'forward' }] : []));
    const v = BcEngine.view(st);
    expect(at(ev, 'map-loaded')).toHaveLength(1);
    expect(v.map).toBe(2);
    expect(v.pose).toMatchObject({ x: 20, y: 11 });
    expect(v.party[1].hp).toBeLessThan(v.party[1].maxHp);            // the damage persisted
    expect(v.party[3].pack).toContain(potion);
    expect(st.sim.a.w(OBJ(potion))).toBe(0x30);                  // the carried record came along
    expect(v.tick).toBeGreaterThan(0);
    expect(st.sim.chain(25, 11).length).toBe(1);                 // map 2's monster is loaded, not map 1's potion square
    expect(st.sim.chain(11, 11)).toEqual([]);
  });
});

describe('save / restore', () => {
  const plan = (_s: BcState, t: number): BcCmd[] => (t % 3 === 0 ? [{ kind: 'attack', char: 0 }] : t % 7 === 0 ? [{ kind: 'wait' }] : []);
  const mk = () => corridor(b => b.put(12, 11, monster({ hp: 30, xp: 60 })));
  it('round trips: restore + continue equals the uninterrupted run, bit for bit', () => {
    const a = mk(); run(a, 40, plan);
    const snap = BcEngine.save(a);
    const b = BcEngine.restore(a.world, snap);
    expect(Buffer.from(BcEngine.save(b)).equals(Buffer.from(snap))).toBe(true);
    const ea = run(a, 60, plan), eb = run(b, 60, plan);
    expect(eb).toEqual(ea);
    expect(Buffer.from(BcEngine.save(b)).equals(Buffer.from(BcEngine.save(a)))).toBe(true);
    expect(ea.length).toBeGreaterThan(5);
  });
  it('null control: a different command stream after the snapshot diverges', () => {
    const a = mk(); run(a, 40, plan);
    const b = BcEngine.restore(a.world, BcEngine.save(a));
    run(a, 60, plan); run(b, 60, () => []);
    expect(Buffer.from(BcEngine.save(b)).equals(Buffer.from(BcEngine.save(a)))).toBe(false);
  });
  it('is deterministic per seed and the timeline changes with the seed', () => {
    const go = (seed: number) => { const b = new MapBuilder().room(10, 10, 24, 12).put(12, 11, monster({ hp: 30 })); const st = BcEngine.newGame(world([b.build()]), seed, { pose: { x: 11, y: 11, facing: 1 } }); return JSON.stringify(run(st, 80, () => [{ kind: 'attack', char: 0 }])); };
    expect(go(1)).toBe(go(1));
    expect(go(2)).not.toBe(go(1));
  });
});

describe('parity with BcSim', () => {
  it('the engine adds nothing: stepping through BcEngine equals driving the restored BcSim directly', () => {
    const mk = () => corridor(b => b.put(13, 11, monster({ hp: 20 })).put(15, 11, monster({ hp: 20 })));
    const a = mk(); const snap = BcEngine.save(a);
    const b = BcEngine.restore(a.world, snap);
    const plan = (_st: BcState, t: number): BcCmd[] => (t < 2 ? [{ kind: 'move', dir: 'forward' }] : [{ kind: 'attack', char: 0 }]);
    const evA = run(a, 200, plan);
    const evB: BcEvent[] = [];
    for (let t = 0; t < 200; t++) { b.sim.step1(plan(b, t)); evB.push(...(b.sim.log.splice(0) as BcEvent[])); }
    expect(evB).toEqual(evA);
    expect(at(evA, 'swing').length).toBeGreaterThan(3);
    for (const k of [...a.sim.a.m.keys()]) expect(b.sim.a.b(k)).toBe(a.sim.a.b(k));
  });
  it('null control: a one-byte difference in the image shows up', () => {
    const mk = () => corridor(b => b.put(13, 11, monster({ hp: 20 })));
    const a = mk(), b = BcEngine.restore(a.world, BcEngine.save(a));
    b.sim.a.setW(CH(0) + 0x4e, 59);
    run(a, 30, () => [{ kind: 'attack', char: 0 }]); run(b, 30, () => [{ kind: 'attack', char: 0 }]);
    expect(b.sim.a.w(CH(0) + 0x4e)).not.toBe(a.sim.a.w(CH(0) + 0x4e));
  });
  it('the bc-playthrough scenario built by hand on BcSim and loaded as a map gives the same ordered log (ids aside)', () => {
    const SEEDH = 'a27740bfd561';
    // hand-built (the sim's own builder API), as in bc-playthrough.test.ts
    const h = new BcSim(cfg({ seed: SEEDH }));
    h.room(10, 10, 14, 12); h.room(16, 10, 20, 12); h.breakWall(14, 11, 1); h.breakWall(15, 11, 1); h.party(11, 11, 1);
    startingParty(V.tables).forEach((c, k) => h.setChar(k, { ...c, hp: 60, maxHp: 60 }));
    h.give(0, h.item(30, { gfx: 3, weight: 20 }), 0x1c); h.a.setB(CH(1) + 0x49, 41); h.a.setB(CH(2) + 0x49, 0);
    h.structure(15, 11, { b5: 0x11, wE: 0 }); h.structure(16, 11, { b5: 0x1e, wA: 0, wE: 1 });
    const hk = h.item(31, { gfx: 0x20, weight: 2 }), hg = h.item(32, { gfx: 0x21, weight: 1 });
    const hA = h.addMonster(mon({ x: 18, y: 11, hp: 14, maxHp: 14, xpBase: 80, loot: [hk, hg], moveType: 0 })), hB = h.addMonster(mon({ x: 19, y: 12, hp: 9, maxHp: 9, xpBase: 40, moveType: 0 }));
    // the same world as a map
    const b = new MapBuilder().room(10, 10, 14, 12).room(16, 10, 20, 12).breakWall(14, 11, 1).breakWall(15, 11, 1);
    const trap = item(0, {}); trap.rec[1] = 1; trap.rec[5] = 0x1e; trap.rec[0xe] = 0; trap.rec[0xf] = 1;
    b.put(15, 11, door(0)).put(16, 11, trap);
    b.put(18, 11, monster({ hp: 14, xp: 80, b2: 10, b3: 0x04, b5: 5, b6: 2, gfx: 0x80b3, loot: [item(0x20, { weight: 2 }), item(0x21, { weight: 1 })] })).put(19, 12, monster({ hp: 9, xp: 40 }));
    const st = BcEngine.newGame(world([b.build()]), 1, { pose: { x: 11, y: 11, facing: 1 } });
    st.sim.rng = new BcRng(SEEDH);
    startingParty(V.tables).forEach((c, k) => st.sim.setChar(k, { ...c, hp: 60, maxHp: 60 }));
    const sw = allocObj(st.sim.a); st.sim.item(sw, { gfx: 3, weight: 20 }); st.sim.give(0, sw, 0x1c);
    st.sim.a.setB(CH(1) + 0x49, 41); st.sim.a.setB(CH(2) + 0x49, 0);
    const pk = (s: BcSim, A: number, B: number, loot: () => number[]) => {
      let stage = 0;
      return (): Cmd[] => {
        const a = s.a, px = a.w(0x1742), py = a.w(0x1740), f = a.w(0x1744);
        void py;
        switch (stage) {
          case 0: if (px < 14) return [{ kind: 'move', dir: 'forward' }]; stage = 1; return [{ kind: 'move', dir: 'forward' }];
          case 1: stage = 2; return [{ kind: 'openDoor' }];
          case 2: if (px < 15) return [{ kind: 'move', dir: 'forward' }]; stage = 3; return [{ kind: 'cast', char: 1, slot: 0 }];
          case 3: if (px < 16) return [{ kind: 'move', dir: 'forward' }]; stage = 4; return [{ kind: 'cast', char: 2, slot: 0 }];
        }
        if (stage === 4) {
          for (const P of [A, B]) {
            const xy = s.monsterXY(P); if (!xy) continue;
            const dx = xy[0] - px, dy = xy[1] - a.w(0x1740);
            if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
            const want = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 0 : 2;
            if (want === f) return [{ kind: 'attack', char: 0 }];
            return [{ kind: 'turn', by: ((want - f + 4) & 3) === 1 ? 1 : -1 }];
          }
          if (s.monsterAlive(A) || s.monsterAlive(B)) return [{ kind: 'wait' }];
          stage = 5;
        }
        if (stage === 5) { if (f !== 1) return [{ kind: 'turn', by: ((1 - f + 4) & 3) === 1 ? 1 : -1 }]; stage = 6; return [{ kind: 'move', dir: 'forward' }]; }
        if (stage === 6) { stage = 7; return [{ kind: 'pickup', char: 0, item: loot()[0] }]; }
        if (stage === 7) { stage = 8; return [{ kind: 'pickup', char: 0, item: loot()[1] }]; }
        return [{ kind: 'wait' }];
      };
    };
    const [eA, eB] = [18, 19].map((x, i) => st.sim.chain(x, i === 0 ? 11 : 12)[0]);
    const lootIds = [st.sim.a.w(OBJ(eA) + 0xa)]; lootIds.push(st.sim.a.w(OBJ(lootIds[0]) + 0x12));
    const planH = pk(h, hA, hB, () => [hk, hg]), planE = pk(st.sim, eA, eB, () => lootIds);
    const evE: BcEvent[] = [];
    for (let t = 0; t < 400; t++) { h.step1(planH()); evE.push(...BcEngine.step(st, planE())); }
    const norm = (l: { tick: number; what: string; ch?: unknown; hit?: unknown; dmg?: unknown }[]) => l.map(e => `${e.tick}:${e.what}${e.ch !== undefined ? '/' + e.ch : ''}${e.hit !== undefined ? (e.hit ? '+' : '-') : ''}${e.dmg ? '=' + e.dmg : ''}`);
    expect(norm(h.log).length).toBeGreaterThan(20);
    expect(norm(h.log)).toEqual(norm(evE));
  });
});
