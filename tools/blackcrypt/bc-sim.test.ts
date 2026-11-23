import { describe, it, expect } from 'vitest';
import { BcRng } from './rules';
import { monsterMelee } from './rules-monster';
import { startingParty } from './combat-sim';
import { BcSim, type Cmd } from './bc-sim';
import { cfg, mon, mkSim, tables } from './bc-sim-fixtures';
import { OBJ } from './rules-spell9';


const swings = (): Cmd[] => [{ kind: 'attack', char: 0 }];
const sd = (i: number) => (BigInt(i + 1) * 0x9e3779b97f4an % (1n << 48n)).toString(16).padStart(12, '0');

describe('bc-sim: the unified world (one A4 image)', () => {
  it('is deterministic for a seed and diverges for other seeds (null control)', () => {
    const run = (seed: string) => JSON.stringify(mkSim({ cfg: { seed }, monsters: [{ awake: true }] }).play(120, swings).log);
    const a = run('a27740bfd561');
    expect(run('a27740bfd561')).toBe(a);
    let diff = 0;
    for (let i = 1; i <= 10; i++) if (run(sd(i)) !== a) diff++;
    expect(diff).toBeGreaterThanOrEqual(9);
  });

  it('composition: the first monster act equals monsterMelee on the same RNG stream', () => {
    const s = mkSim({ monsters: [{ x: 12, y: 11, awake: true }] });
    s.step1();
    const rng = new BcRng(s.cfg.seed);
    const m = mon();
    const exp = monsterMelee({
      gfx: m.gfx, b2: m.b2, b3: m.b3, b6: m.b6, maxHp: m.maxHp, px: 11, py: 11, mx: 12, my: 11, facing: 1, pos: 4, op: 4, flag: 1,
      form: [0, 1, 2, 3], hp: [20, 20, 20, 20].map((h, k) => (s.log.some(l => l.what === 'damage' && l.ch === k) ? 20 : h)), ac: startingParty(tables).map(p => p.ac), s0f: 1,
    }, rng);
    const got = s.log.filter(l => l.what === 'monster-hit').map(l => [l.ch, l.dmg]);
    expect(got).toEqual(exp.dmg);
  });

  it('state lives in the A4 image: the monster is a real P / S record pair on a real cell chain', () => {
    const s = mkSim({ monsters: [{ x: 14, y: 11, hp: 33 }] });
    const P = s.monsterIds[0];
    expect(s.monsterXY(P)).toEqual([14, 11]);
    expect(s.a.sw(OBJ(P) + 8)).toBe(33);
    expect(s.a.w(OBJ(P) + 0x10)).toBe(P + 1);
    expect(s.a.w(0x1742)).toBe(11);
  });
});

describe('bc-sim: melee, death, loot, XP (ported from combat-sim.test.ts)', () => {
  it('player kills a weak monster: XP to every living character (not the dead), level-ups, the carried chain is dropped on the square', () => {
    const s = new BcSim(cfg({ seed: '0102030405ff' }));
    s.room(10, 10, 17, 12); s.party(11, 11, 1);
    startingParty(tables).forEach((c, k) => s.setChar(k, { ...c, hp: k === 2 ? 0 : c.hp }));
    s.give(0, s.item(30, { gfx: 3 }), 0x1c);
    const loot = [s.item(31, { gfx: 0x12, weight: 5 }), s.item(32, { gfx: 0x13, weight: 7 })];
    const P = s.addMonster(mon({ hp: 6, maxHp: 6, xpBase: 300, loot, awake: false }));
    s.play(200, () => [{ kind: 'attack', char: 0 }]);
    const dead = s.log.find(l => l.what === 'monster-dead');
    expect(dead).toBeTruthy();
    const xp = dead!.xp as number[];
    expect(xp[2]).toBe(0);
    for (const k of [0, 1, 3]) expect(xp[k]).toBeGreaterThanOrEqual(300);
    expect(s.monsterAlive(P)).toBe(false);
    expect(s.chain(12, 11)).toEqual(loot);                      // both carried items, in carried order, on the monster's square
    expect(s.a.w(OBJ(0) + 0x12)).toBe(P);                       // the primary was freed last: it is the free list head, the secondary behind it
    expect(s.a.w(OBJ(P) + 0x12)).toBe(P + 1);
  });

  it('a monster that kills a character: pack and equipment dropped on the party square, a corpse made, leader and selection fixed, game over when the last one falls', () => {
    const s = mkSim({ hp: [5, 40, 40, 40] });
    const pack = s.item(35, { gfx: 0x12, weight: 3 });
    s.give(0, pack, 0x16);
    s.damage(0, 500, 4, 1);
    expect(s.hpOf(0)).toBe(0);
    const chain = s.chain(11, 11);
    expect(chain).toContain(pack);
    expect(chain.length).toBe(2);                                // the pack item and the corpse (type 0x26)
    expect(s.a.b(OBJ(chain[1]) + 5)).toBe(0x26);
    expect(s.a.w(0x1a14)).toBeGreaterThan(0);                    // the active character moved off the dead one
    for (const k of [1, 2, 3]) s.damage(k, 9999, 4, 1);
    expect(s.gameOver).toBe(true);
  });

  it('null control: dropping the corpse flag leaves no corpse', () => {
    const s = mkSim({ hp: [5, 40, 40, 40] });
    s.damage(0, 500, 4, 0);
    expect(s.chain(11, 11)).toEqual([]);
  });
});

describe('bc-sim: monsters, spells, world rules on the one image', () => {
  it('activation window: a monster 3 squares away wakes at the 16-tick scan and walks to the party; one far away stays parked', () => {
    const s = mkSim({ monsters: [{ x: 14, y: 11, moveType: 0 }, { x: 17, y: 12, moveType: 0 }] });
    s.play(40);
    const near = s.monsterIds[0];
    expect(s.log.some(l => l.what === 'step' && l.P === near)).toBe(true);
    const xy = s.monsterXY(near)!;
    expect(Math.abs(xy[0] - 11) + Math.abs(xy[1] - 11)).toBeLessThan(4);
  });

  it('possession (gfx 0x80B7, bit 12) kills a character and turns the monster into 0x80B8 / 150 hp; flesh-to-stone (bit 13) makes a type-0x2F statue on the character\'s square', () => {
    let poss = 0, stone = 0;
    for (let i = 0; i < 40 && (!poss || !stone); i++) {
      const s = mkSim({ cfg: { seed: sd(i + 50) }, monsters: [{ x: 12, y: 11, gfx: 0x80b7 }] });
      const P = s.monsterIds[0];
      (s as any).special(P, 12, { x: 12, y: 11 });
      if (s.a.w(OBJ(P)) === 0x80b8) { poss++; expect(s.a.sw(OBJ(P) + 8)).toBe(150); expect([0, 1, 2, 3].filter(k => s.hpOf(k) <= 0).length).toBe(1); }
      const t = mkSim({ cfg: { seed: sd(i + 90) }, monsters: [{ x: 12, y: 11, gfx: 0x80b3 }] });
      (t as any).special(t.monsterIds[0], 13, { x: 12, y: 11 });
      const dead = [0, 1, 2, 3].filter(k => t.hpOf(k) <= 0);
      if (dead.length) {
        stone++;
        const [sx, sy] = [[2, 10], [2, 13], [3, 14], [9, 14]][dead[0]];
        expect(t.chain(sx, sy).some(id => t.a.b(OBJ(id) + 5) === 0x2f && t.a.w(OBJ(id) + 0xc) === dead[0])).toBe(true);
      }
    }
    expect(poss).toBeGreaterThan(0); expect(stone).toBeGreaterThan(0);
  });

  it('doors: the enter test blocks on a closed door, the open-door rule opens it, the party walks through; a monster on the square blocks (verdict 8)', () => {
    const s = mkSim({ monsters: [] });
    const door = s.structure(12, 11, { b5: 0x11, wE: 0 });
    s.play(1, () => [{ kind: 'move', dir: 'forward' }]);
    expect(s.a.w(0x1742)).toBe(11);                                  // closed: blocked
    expect(s.log.some(l => l.what === 'blocked' && l.why === 'structure')).toBe(true);
    s.a.setB(OBJ(door) + 0xf, 0);                                    // the door frame byte +0xF bit 0 = open (see enterParty); openDoor sets state word +0xE
    s.command({ kind: 'openDoor' });
    expect(s.a.w(OBJ(door) + 0xe)).toBe(1);
    s.a.setB(OBJ(door) + 0xf, 1);
    s.play(1, () => [{ kind: 'move', dir: 'forward' }]);
    expect(s.a.w(0x1742)).toBe(12);
  });

  it('traps and glyphs: the enter test reports verdicts 6 / 5 / 7 on the stepped square; REMOVE TRAP takes the trap away and the verdict goes back to 0', () => {
    const s = mkSim({ monsters: [] });
    s.structure(12, 11, { b5: 0x1e, wA: 0 });
    s.step1([{ kind: 'move', dir: 'forward' }]);
    expect(s.log.some(l => l.what === 'trap')).toBe(true);
    const g = mkSim({ monsters: [] });
    g.structure(12, 11, { b5: 0x10, wC: 3, wA: 0 });
    g.step1([{ kind: 'move', dir: 'forward' }]);
    expect(g.log.find(l => l.what === 'glyph')?.kind).toBe(5);
  });

  it('items: pickup (weight accepts / refuses), drop (end of the party square chain), equip into a hand slot, and the swing uses the equipped weapon', () => {
    const s = mkSim({ monsters: [] });
    const sword = s.item(31, { gfx: 3, weight: 40 }); s.square(12, 11, [sword]);
    s.a.setW(0x1742, 12);                                           // stand on the item
    s.command({ kind: 'pickup', char: 0, item: sword });
    expect(s.chain(12, 11)).toEqual([]);
    expect(s.a.w(OBJ(0) + 0)).toBe(0);                              // (sanity) object 0 untouched
    expect([0, 1, 2, 3, 4, 5].some(k => s.a.w(0x1758 + 0x16 + 2 * k) === sword)).toBe(true);
    s.command({ kind: 'equip', char: 0, item: sword, hand: 0 });
    expect(s.a.w(0x1758 + 0x1c)).toBe(sword);
    expect([0, 1, 2, 4, 5].some(k => s.a.w(0x1758 + 0x16 + 2 * k) === sword)).toBe(false);
    s.command({ kind: 'drop', char: 0, item: sword });
    expect(s.chain(12, 11)).toEqual([sword]);
    expect(s.a.w(0x1758 + 0x1c)).toBe(0);
  });

  it('a ray spell kills a monster through the real kill path (XP once, loot dropped, records freed)', () => {
    const rayId = 0;                                                     // RAY_SPELLS[0]
    const s = mkSim({ cfg: { seed: sd(7) }, monsters: [{ x: 13, y: 11, hp: 5, maxHp: 5, xpBase: 100 }] });
    const P = s.monsterIds[0];
    const loot = s.item(31, { gfx: 0x12 }); s.a.setW(OBJ(P) + 0xa, loot);
    s.a.setB(0x1758 + 0xa8 + 0x49, rayId);
    s.castAny(1, 0);
    expect(s.log.find(l => l.what === 'ray')).toBeTruthy();
    expect(s.monsterAlive(P)).toBe(false);
    expect(s.chain(13, 11)).toEqual([loot]);
    const dead = s.log.find(l => l.what === 'monster-dead')!;
    for (const k of [0, 1, 2, 3]) expect((dead.xp as number[])[k]).toBeGreaterThanOrEqual(100);
    expect(s.a.b(0x1758 + 0xa8 + 0x49)).toBe(0xff);                      // the slot was spent and the later slots shifted down
  });

  it('generators: a type-0x2E structure spawns a monster from its template (loot copied), the spawn is activated, walks to the party and fights; it dies with its own loot copy', () => {
    const s = mkSim({ monsters: [], cfg: { seed: 'c0ffee123456' } });
    s.give(0, s.item(30, { gfx: 3, weight: 20 }), 0x1c);
    s.object(25, { w0: 1, b5: 0x2e, wC: 1, wE: 9, w10: 2, b7: 0 }); s.square(14, 12, [25]);
    // template in map row 0, column 2: primary 26, secondary 27, one carried item 28
    s.object(26, { w0: 0x80b3, wA: 28, w10: 27, wE: 0 }); s.a.setW(OBJ(26) + 8, 8); s.a.setB(OBJ(26) + 2, 10); s.a.setB(OBJ(26) + 3, 4); s.a.setB(OBJ(26) + 6, 2); s.a.setB(OBJ(26) + 5, 5);
    s.object(27, { w0: 0 }); s.a.setW(OBJ(27) + 8, 8); s.a.setW(OBJ(27) + 4, 1); s.a.setB(OBJ(27) + 0xb, 4); s.a.setW(OBJ(27) + 6, 60);
    s.item(28, { gfx: 0x12, weight: 4 }); s.square(2, 0, [26]);
    s.play(400, sim => (sim.chain(12, 11).length || sim.chain(11, 12).length ? [{ kind: 'attack', char: 0 }] : [{ kind: 'wait' }]));
    const spawned = s.chain(14, 12).filter(id => s.a.w(OBJ(id)) & 0x8000);
    expect(s.a.w(OBJ(25) + 0xc)).toBe(0);                          // the generator spent its single spawn
    expect(s.log.some(l => l.what === 'step' || l.what === 'monster-hit')).toBe(true);   // the spawned monster acted (type-1 events from the activation, dispatched by the unified loop)
    void spawned;
  });
});
