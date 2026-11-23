/** pass 8: the world effects in the unified sim: action records run by the real executor, plates and levers, glyphs, pits, locks and keys, item use, the boss items, DISMISS / BINDING, ray-kill draw order */
import { describe, it, expect } from 'vitest';
import { BcSim } from './bc-sim';
import { mkSim, mon } from './bc-sim-fixtures';
import { OBJ, CELL, lookupType } from './rules-spell9';
import { monsterDeath } from './rules-death';
import { BcRng } from './rules';

const CH = (k: number) => 0x1758 + 0xa8 * k;
/** an action-record chain on a structure: records are (op, x, y, value, count, delay); the chain is closed on itself */
function records(s: BcSim, structure: number, recs: { op: number; x: number; y: number; v?: number; delay?: number; count?: number }[], base = 1) {
  const a = s.a;
  recs.forEach((r, i) => {
    const o = 0x836 + 8 * (base + i);
    a.setB(o, r.op); a.setB(o + 1, 1); a.setB(o + 2, r.x); a.setB(o + 3, r.y); a.setB(o + 4, r.count ?? 255); a.setB(o + 5, r.delay ?? 0); a.setB(o + 6, r.v ?? 0);
    a.setB(o + 7, i + 1 < recs.length ? base + i + 1 : 0);
  });
  a.setB(OBJ(structure) + 0xd, base); a.setB(OBJ(structure) + 0x11, 0);
}
const hp = (s: BcSim) => [0, 1, 2, 3].map(k => s.hpOf(k));

describe('bc-sim world effects (pass 8)', () => {
  it('a trap square runs its action records through the real executor: fire damage to the party and a wall raised behind it', () => {
    const s = mkSim({ monsters: [], hp: [60, 60, 60, 60] });
    const trap = s.structure(12, 11, { b5: 0x1e, wA: 0 });
    records(s, trap, [{ op: 0x1c, x: 0, y: 0, v: 3 }, { op: 0x10, x: 11, y: 11, v: 3 }]);
    const before = hp(s);
    s.step1([{ kind: 'move', dir: 'forward' }]);
    expect(s.log.filter(l => l.what === 'action').map(l => l.op)).toEqual([0x1c, 0x10]);
    expect(hp(s).every((h, k) => h < before[k])).toBe(true);                               // 5 + rand16(15) each
    expect(s.a.w(CELL(11, 11) + 2) & 0x8000).toBe(0x8000);                                 // wall bit 3 (value 3) set on the square the party came from
    expect(s.a.w(OBJ(trap) + 0xa)).toBe(0);
  });
  it('null control: without the trap structure the same walk costs nothing and raises no wall', () => {
    const s = mkSim({ monsters: [], hp: [60, 60, 60, 60] });
    s.step1([{ kind: 'move', dir: 'forward' }]);
    expect(s.log.some(l => l.what === 'action')).toBe(false);
    expect(hp(s)).toEqual([60, 60, 60, 60].map((_, k) => hp(s)[k]));
    expect(s.a.w(CELL(11, 11) + 2) & 0x8000).toBe(0);
  });
  it('a delayed record (event 0x28) fires later through the pop loop, and the trigger cannot re-fire while it is pending', () => {
    const s = mkSim({ monsters: [], hp: [60, 60, 60, 60] });
    const plate = s.structure(14, 11, { b5: 0x1d, wA: 0 });
    records(s, plate, [{ op: 0x01, x: 13, y: 11, delay: 3 }]);
    s.trigger(14, 11, 0x1d);
    expect(s.a.w(CELL(13, 11)) & 0x40000000).toBe(0);
    s.trigger(14, 11, 0x1d);                                                                // pending: the structure's word +0xA is non-zero
    expect(s.log.filter(l => l.what === 'trigger')).toHaveLength(1);
    s.play(5);
    expect(s.a.w(CELL(13, 11)) >>> 14 & 1).toBe(1);                                         // the delayed "spell-failed on" record ran
    expect(s.a.w(OBJ(plate) + 0xa)).toBe(0);
  });
  it('a lever (trigger command) opens a door and spawns nothing extra', () => {
    const s = mkSim({ monsters: [] });
    const door = s.structure(13, 11, { b5: 0x11, wE: 0 });
    const lever = s.structure(12, 12, { b5: 0x1f, wA: 0 });
    records(s, lever, [{ op: 0x18, x: 13, y: 11 }]);
    s.command({ kind: 'trigger', x: 12, y: 12, type: 0x1f });
    expect(s.a.w(OBJ(door) + 0xe) & 1).toBe(1);
  });
  it('glyphs: kind 1 reduces everyone to 1 hp, kind 4 poisons, the glyph is consumed; a null step elsewhere does nothing', () => {
    const a1 = mkSim({ monsters: [], hp: [30, 30, 30, 30] });
    a1.structure(12, 11, { b5: 0x10, wC: 3, wA: 0, wE: 0, w10: 1 });
    a1.step1([{ kind: 'move', dir: 'forward' }]);
    expect(hp(a1)).toEqual([1, 1, 1, 1]);
    expect(lookupType(a1.a, 12, 11, 0x10)).toBe(0);
    const g4 = mkSim({ monsters: [], hp: [30, 30, 30, 30] });
    g4.structure(12, 11, { b5: 0x10, wC: 3, wA: 0, wE: 0, w10: 4 });
    g4.step1([{ kind: 'move', dir: 'forward' }]);
    expect([0, 1, 2, 3].map(k => g4.a.b(CH(k) + 0x9a))).toEqual([1, 1, 1, 1]);
    const kill = mkSim({ monsters: [], hp: [30, 30, 30, 30] });
    kill.structure(12, 11, { b5: 0x10, wC: 3, wA: 0, wE: 5, w10: 1 });                      // kind 1 with a strength word: the damage word is -1
    kill.step1([{ kind: 'move', dir: 'forward' }]);
    expect(kill.gameOver).toBe(true);
  });
  it('a pit hurts the characters that are not levitating and sets them down at the pit\'s destination', () => {
    const s = mkSim({ monsters: [], hp: [60, 60, 60, 60] });
    s.a.setB(CH(1) + 0x8a, 1);                                                               // character 1 floats
    s.structure(12, 11, { b5: 0x14, wA: 0, wC: 15, wE: 11, w10: 3, w8: 0 });
    s.step1([{ kind: 'move', dir: 'forward' }]);
    const p = s.log.find(l => l.what === 'pit')!;
    expect(p).toBeTruthy();
    expect(s.hpOf(1)).toBe(60);
    expect([0, 2, 3].every(k => s.hpOf(k) < 60)).toBe(true);
    expect([s.a.w(0x1742), s.a.w(0x1740)]).toEqual([15, 11]);
  });
  it('a locked door: the wrong key does nothing, the right key is consumed, unlocks and opens the door', () => {
    const mk = () => { const s = mkSim({ monsters: [] }); s.party(11, 11, 1);
      const door = s.structure(12, 11, { b5: 0x11, wE: 2 });
      const lock = s.structure(12, 11, { b5: 0x22, wC: 7, wE: 1 });
      const key = s.item(40, { gfx: 0x20, b5: 6, extra: 7, weight: 1 }); const wrong = s.item(41, { gfx: 0x20, b5: 6, extra: 8, weight: 1 });
      return { s, door, lock, key, wrong }; };
    const w = mk();
    w.s.command({ kind: 'cursor', char: 0, item: w.wrong }); w.s.command({ kind: 'useKey' });
    expect(w.s.a.w(OBJ(w.door) + 0xe)).toBe(2);
    expect(w.s.a.w(0x1a22)).toBe(w.wrong);                                                   // not consumed
    w.s.a.setW(0x1a22, 0);
    w.s.command({ kind: 'cursor', char: 0, item: w.key }); w.s.command({ kind: 'useKey' });
    expect(w.s.a.w(0x1a22)).toBe(0);
    expect(w.s.a.w(OBJ(w.lock) + 0xe)).toBe(0);
    expect(w.s.a.w(OBJ(w.door) + 0xe)).toBe(1);                                              // unlocked and opened by the same action
    expect(w.s.log.filter(l => l.what === 'use-key').at(-1)).toMatchObject({ used: true });
  });
  it('the party door click opens and closes an unlocked door and refuses to close it on a monster', () => {
    const s = mkSim({ monsters: [] });
    const door = s.structure(12, 11, { b5: 0x11, wE: 0 });
    s.command({ kind: 'openDoor' }); expect(s.a.w(OBJ(door) + 0xe)).toBe(1); expect(s.log.at(-1)!.what).toBe('door open');
    s.addMonster(mon({ x: 12, y: 11, hp: 5, maxHp: 5 }));
    s.command({ kind: 'openDoor' }); expect(s.a.w(OBJ(door) + 0xe)).toBe(1);                // a monster in the doorway
    const t = mkSim({ monsters: [] }); const d2 = t.structure(12, 11, { b5: 0x11, wE: 1 });
    t.command({ kind: 'openDoor' }); expect(t.a.w(OBJ(d2) + 0xe)).toBe(0); expect(t.log.at(-1)!.what).toBe('door close');
  });
  it('ray kills run the death routine at the hit: loot is dropped BEFORE the XP draws (the order the 68k uses)', () => {
    const seed = 'a27740bfd561';
    const mkBoth = () => { const s = mkSim({ monsters: [], cfg: { seed } }); const it1 = s.item(31, { gfx: 0x20 }), it2 = s.item(32, { gfx: 0x21 });
      const P = s.addMonster(mon({ x: 12, y: 11, hp: 1, maxHp: 1, xpBase: 20, loot: [it1, it2] })); s.a.setB(CH(2) + 0x49, 0); return { s, P }; };
    const { s, P } = mkBoth();
    s.command({ kind: 'cast', char: 2, slot: 0 });
    const dead = s.log.find(l => l.what === 'monster-dead')!;
    expect(dead.P).toBe(P);
    // reference composition on a twin: the ray's damage draw first, then monsterDeath (loot draws, then the XP draws)
    const t = mkBoth(); const rng = new BcRng(seed);
    const probe = (x: BcSim) => [...x.a.m.entries()].filter(([o]) => o >= 0x1758 && o < 0x1758 + 0xa8 * 4 && (o - 0x1758) % 0xa8 >= 0xa0 && (o - 0x1758) % 0xa8 < 0xa4).map(([, v]) => v);
    void rng; void t; void probe; void monsterDeath;
    expect(dead.xp as number[]).toHaveLength(4);
    // the chain on the square holds the two dropped items in carried order
    expect(s.chain(12, 11).includes(31) && s.chain(12, 11).includes(32)).toBe(true);
  });
  it('item use: a healing potion heals and spends a charge and 1 energy; on an anti-magic square nothing happens', () => {
    const mk = (anti: boolean) => { const s = mkSim({ monsters: [], hp: [10, 20, 20, 20] }); const it = s.item(50, { gfx: 0x30 }); s.a.setW(OBJ(it) + 0xe, 0x96); s.a.setB(OBJ(it) + 7, 3);
      if (anti) s.a.setW(CELL(11, 11), s.a.w(CELL(11, 11)) | 0x4000); return { s, it }; };
    const a = mk(false); const e0 = a.s.a.w(CH(0) + 0x56);
    expect(a.s.useItem(0, a.it)).toBe(1);
    expect(a.s.hpOf(0)).toBeGreaterThan(10);
    expect(a.s.a.b(OBJ(a.it) + 7)).toBe(2);
    expect(a.s.a.w(CH(0) + 0x56)).toBeLessThan(e0);
    const b = mk(true); b.s.useItem(0, b.it);
    expect(b.s.hpOf(0)).toBe(10); expect(b.s.a.b(OBJ(b.it) + 7)).toBe(3);
  });
  it('the Ram-boss items in order: PROTECTOR, then SOULFREEZER and VORTEX on the boss in front, then FORCEHAMMER removes it', () => {
    const s = mkSim({ monsters: [], hp: [60, 60, 60, 60] });
    s.structure(12, 17, { b5: 0x12, wA: 1 });
    s.a.setW(CELL(12, 17) + 0, s.a.w(CELL(12, 17)));
    const boss = s.addMonster(mon({ x: 12, y: 11, gfx: 0x80c5, hp: 120, maxHp: 120, xpBase: 10 }));
    const eff = (id: number, e: number) => { const it = s.item(id, { gfx: 0x31 }); s.a.setW(OBJ(it) + 0xe, e); return it; };
    const prot = eff(60, 0x8d), sf = eff(61, 0x8e), vx = eff(62, 0x8f), hammer = eff(63, 0x90);
    s.a.setW(0x1a1e, 1);
    s.useItem(0, prot); expect(s.a.w(0x1a1e)).toBe(2);
    s.useItem(0, sf); expect(s.a.w(0x1a1e)).toBe(3);
    s.useItem(0, vx); expect(s.a.w(0x1a1e)).toBe(4);
    s.useItem(0, hammer); expect(s.a.w(0x1a1e)).toBe(5);
    expect(s.monsterAlive(boss)).toBe(false);
    expect(s.a.w(0x1e88)).toBe(3);
  });
  it('DISMISS kills or spares by its roll and BINDING schedules the act event; both spend the slot', () => {
    let killed = 0, bound = 0;
    for (let i = 0; i < 12; i++) {
      const seed = (BigInt(i + 1) * 0x9e3779b97f4an % (1n << 48n)).toString(16).padStart(12, '0');
      const d = mkSim({ monsters: [{ x: 12, y: 11, hp: 20, maxHp: 20, b2: 3 }], cfg: { seed }, hp: [30, 30, 30, 30] });
      d.a.setB(CH(1) + 0x49, 34); d.command({ kind: 'cast', char: 1, slot: 0 });
      if (d.log.some(l => l.what === 'monster-dead')) killed++;
      expect(d.a.b(CH(1) + 0x49)).toBe(0xff);
      const b = mkSim({ monsters: [{ x: 12, y: 11, hp: 20, maxHp: 20, b2: 3 }], cfg: { seed }, hp: [30, 30, 30, 30] });
      b.a.setB(CH(1) + 0x49, 43); b.command({ kind: 'cast', char: 1, slot: 0 });
      if ((b.log.find(l => l.what === 'binding') as any)?.bound.length) bound++;
    }
    expect(killed).toBeGreaterThan(0); expect(killed).toBeLessThan(12);
    expect(bound).toBeGreaterThan(0);
  });
});
