/**
 * Black Crypt (Amiga): the UNIFIED headless world (pass 7). ONE A4 image (`A4Mem`, the game's own layout) holds everything the rules touch: the cell map, the object table (monsters as
 * primary + secondary records, structures, items, corpses), the four character records, the real event queue, the party state and the globals. Every rule that has a 68k-diffed
 * port runs on that image:
 *   melee            weaponInfo / meleeAttack / swingCooldown / swingTail                     (rules.ts, rules-spell9.ts)
 *   monsters         activation scan + generators, behaviour VM, pursue / approach / wander / monsterAct, possession / flesh-to-stone   (rules-spell9.ts, rules-monster.ts, rules-move.ts, rules-spell.ts)
 *   death and loot   monsterDeath (carried chain dropped, records freed, events cancelled, XP, level-up), damageCharacter (pack and equipment dropped, corpse, leader fix-ups)   (rules-death.ts)
 *   events           the real queue; the due-event pop loop with the consumers 0x14 / 0x15 / 0x16 / 0x1E-0x25 / 0x28 / 0x29 (rules-pop.ts); monster act events (type 1) are dispatched here
 *   spells           the nine party-state spells + RAISE DEAD + TELEPORT through castSpell9; ray and simple spells through the JS-struct ports (state copied in and out of the image)
 *   world            doors (openDoor), the party square-enter test (enterParty), step cost, vitals, weight (pickup / drop), equip (slot words)
 * It supersedes the monster / spell half of `combat-sim.ts` (which stays as the verified legacy driver with its own 26 tests); the boss-item stage machine, DISMISS / BINDING / REFRESH are
 * not wired here (see game-rules.md section 14.7).
 * Evidence: every rule is the harnessed port named above (section 14 status table); the glue (command order, hand slots, flag choices) is code / hyp as marked.
 */
import { levelUp, meleeAttack, weaponInfo, type RuleTables, type WeaponBase } from './rules';
import {
  castRay, castSpell, castFacing, castRefresh, healTarget, memoriseClick, rechargeTick, pickSquareTargets, A4Mem, RAY_SPELLS,
  monsterPossessStone, type RayDeath, type RayWorld, type RayObj, type SpellBook, type SpChar, type SpFull,
} from './rules-spell';
import { awardXp, hpAtLeastMorale, runBehaviour, vitalsTick, VM_CALLS, type AiScripts, type VmMonster, type VmCall } from './rules-monster';
import { MoveWorld, activationScan as _unusedMoveScan, pursue, approach, wander, monsterAct as moveAct, pathfind, addToSquare, type ActEnv, type MoveCall } from './rules-move';
import {
  OBJ, CELL, QN, allocObj, freeObj, unlinkObj, insertObj, adjustWeight, scheduleEvent, activationScan, swingCooldown, swingTail, hitReadyDelay, pickTargetsMem, castSpell9,
  openDoor, stepCost, adjustVitals, lookupType, cancelEvent, forceHammer, dispel, raiseDead,
} from './rules-spell9';
import { popDue, type DueEvent } from './rules-pop';
import { monsterDeath, damageCharacter, enterParty, cancelEventsFor, triggerActions } from './rules-death';
import { executeAction, glyphEffect, pitEffect, doorClick, keyUse, type ExecHooks } from './rules-action';
import { useItem, type ItemCallee } from './rules-item';
import { ramBossItem } from './rules-boss';
import { ObjectWorld } from './object-world';

void _unusedMoveScan;
const CH = (k: number) => 0x1758 + 0xa8 * k;
const s16 = (v: number) => (v << 16) >> 16;
const s8 = (v: number) => (v << 24) >> 24;
const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;
export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** hand slots (pack row 0, words +0x16 + 2 k): hand 0 = k 3 (+0x1C, busy mask 2), hand 1 = k 2 (+0x1A, mask 1) (code, event 0x14 handler `+0x13DE` / `+0x1616`) */
export const HAND_WORD = [0x1c, 0x1a];

/** `MoveWorld` over the shared A4 image: the harnessed movement routines read and write the object table / cell map in place. */
export class MemMoveWorld extends MoveWorld {
  private m: A4Mem;
  constructor(m: A4Mem) {
    super();
    this.m = m;
    Object.defineProperty(this, 'party', { get: () => ({ x: m.w(0x1742), y: m.w(0x1740) }), set: (v: { x: number; y: number }) => { m.setW(0x1742, v.x); m.setW(0x1740, v.y); }, configurable: true });
    Object.defineProperty(this, 'lastDist', { get: () => m.b(0x1e91), set: (v: number) => m.setB(0x1e91, v), configurable: true });
  }
  override cell(x: number, y: number): number { return getL(this.m, CELL(x, y)); }
  override setCell(x: number, y: number, v: number) { this.m.setW(CELL(x, y), v >>> 16); this.m.setW(CELL(x, y) + 2, v & 0xffff); }
  override w(id: number, off: number): number { return this.m.w(OBJ(id) + off); }
  override b(id: number, off: number): number { return this.m.b(OBJ(id) + off); }
  override setW(id: number, off: number, v: number) { this.m.setW(OBJ(id) + off, v); }
  override setB(id: number, off: number, v: number) { this.m.setB(OBJ(id) + off, v); }
}

export interface MonsterSpec {
  x: number; y: number; gfx: number; monType: number; b2: number; b3: number; b5: number; b6: number; b7: number;
  hp: number; maxHp: number; xpBase: number; w0c: number; moveType: number; pos: number;
  /** carried item object ids (chain order) */
  loot?: number[];
  awake?: boolean;
}
export interface CharSpec {
  cls: number; level: number; xp: number; hp: number; maxHp: number; str: number; dex: number; con: number; int: number; wis: number;
  ac: number; resist: number; food: number; water: number; energy: number; b6c: number; slots?: number[]; regen?: number; prot86?: number; sustain?: number;
}
export type Cmd =
  | { kind: 'attack'; char: number; hand?: number }
  | { kind: 'move'; dir: 'forward' | 'back' }
  | { kind: 'turn'; by: 1 | -1 }
  | { kind: 'openDoor'; char?: number }
  | { kind: 'trigger'; x: number; y: number; type: number }
  | { kind: 'useKey'; char?: number }
  | { kind: 'cursor'; char: number; item: number }
  | { kind: 'use'; char: number; item: number; pick?: number }
  | { kind: 'cast'; char: number; slot: number; pick?: number; map?: number }
  | { kind: 'memorise'; char: number; row: number }
  | { kind: 'pickup'; char: number; item: number }
  | { kind: 'drop'; char: number; item: number }
  | { kind: 'equip'; char: number; item: number; hand: number }
  | { kind: 'rest'; on: boolean }
  | { kind: 'wait' };

export interface BcConfig {
  tables: RuleTables; weaponBase: WeaponBase; scripts: AiScripts; seed: string;
  levelRamps?: number[];   // S_2 +0x39E: the per-map accent ramp, applied by the stairs follow-up +0x16C62
  spells?: { pageHead: number[]; next: number[]; level: number[]; pageNext: number[]; timers?: number[]; owned?: number[] };
}

export class BcSim extends ObjectWorld {
  cfg: BcConfig;
  mw: MemMoveWorld;
  book: SpellBook | null = null;
  gameOver = false;
  /** P ids of every monster ever added, in order */
  monsterIds: number[] = [];
  light = 0;
  constructor(cfg: BcConfig, freeIds = 60) {
    super(cfg.tables, cfg.seed, freeIds);
    this.cfg = cfg;
    this.mw = new MemMoveWorld(this.a);
    this.a.setW(0x1a18, 1);   // the UI's "input ready" word the door click waits on
    if (cfg.spells) {
      const sp = cfg.spells;
      this.book = { pageHead: sp.pageHead, next: sp.next, level: sp.level, timers: [...(sp.timers ?? sp.next.map(() => 0))], owned: [...(sp.owned ?? sp.pageHead.map(() => 1))] };
    }
  }

  // ------------------------------------------------------------------ building
  /** walls around a rectangle (bit 12 + d = wall on side d: 0 +y, 1 +x, 2 -y, 3 -x) */
  room(x0: number, y0: number, x1: number, y1: number) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      let walls = 0;
      if (y === y1) walls |= 1; if (x === x1) walls |= 2; if (y === y0) walls |= 4; if (x === x0) walls |= 8;
      this.mw.setCell(x, y, (this.mw.cell(x, y) | (walls << 12)) >>> 0);
    }
  }
  /** remove the wall on side `d` of (x, y) and the opposite side of its neighbour (a doorway) */
  breakWall(x: number, y: number, d: number) {
    const [dx, dy] = DIRS[d];
    this.mw.setCell(x, y, (this.mw.cell(x, y) & ~(0x1000 << d)) >>> 0);
    this.mw.setCell(x + dx, y + dy, (this.mw.cell(x + dx, y + dy) & ~(0x1000 << ((d + 2) & 3))) >>> 0);
  }
  setChar(k: number, c: CharSpec) {
    const a = this.a, o = CH(k);
    a.setW(o, c.cls); a.setB(o + 0x5e, c.level); a.setW(o + 0xa0, c.xp >>> 16); a.setW(o + 0xa2, c.xp & 0xffff);
    a.setW(o + 0x4e, c.hp); a.setW(o + 0x50, c.maxHp); a.setB(o + 0x64, c.str); a.setB(o + 0x68, c.dex); a.setB(o + 0x67, c.con); a.setB(o + 0x66, c.int); a.setB(o + 0x65, c.wis);
    a.setB(o + 0x62, c.ac); a.setB(o + 0x69, c.resist); a.setW(o + 0x52, c.food); a.setW(o + 0x54, c.water); a.setW(o + 0x56, c.energy); a.setB(o + 0x6c, c.b6c);
    a.setB(o + 0x6d, c.regen ?? 0); a.setB(o + 0x86, c.prot86 ?? 0); a.setB(o + 0x90, c.sustain ?? 0);
    for (let s = 0; s < 5; s++) a.setB(o + 0x49 + s, c.slots?.[s] ?? 0xff);
    a.setB(o + 0x6e, c.str); a.setB(o + 0x6f, c.int); a.setB(o + 0x70, c.wis); a.setB(o + 0x71, c.con); a.setB(o + 0x72, c.dex);   // maximum stats (+0x6E is the carrying limit / 1000)
    a.setB(o + 0x44, 0xff);
  }
  /** a live view of character k for the level-up routine and the ports that take plain structs */
  charView(k: number) {
    const a = this.a, o = CH(k);
    return {
      get level() { return a.b(o + 0x5e); }, set level(v: number) { a.setB(o + 0x5e, v); },
      get xp() { return getL(a, o + 0xa0); }, set xp(v: number) { a.setW(o + 0xa0, v >>> 16); a.setW(o + 0xa2, v & 0xffff); },
      get con() { return a.b(o + 0x67); }, get hp() { return a.sw(o + 0x4e); }, set hp(v: number) { a.setW(o + 0x4e, v); },
      get maxHp() { return a.sw(o + 0x50); }, set maxHp(v: number) { a.setW(o + 0x50, v); },
    };
  }
  hpOf(k: number) { return this.a.sw(CH(k) + 0x4e); }
  /** an item object (weapon: gfx word 0 = gfxNumber, word +0xC = extra, weight word +8) */
  item(id: number, f: { gfx: number; extra?: number; weight?: number; b5?: number }) {
    return this.object(id, { w0: f.gfx, b5: f.b5 ?? 0x15, w8: f.weight ?? 0, wC: f.extra ?? 0, next: 0 });
  }
  /** put an item object in a character's pack slot (row r, column k) and charge its weight */
  give(ch: number, item: number, slotWord: number) {
    this.a.setW(CH(ch) + slotWord, item); adjustWeight(this.a, ch, item, 0);
  }
  addMonster(m: MonsterSpec): number {
    const a = this.a, P = this.fixedId(), S = this.fixedId();
    const o = OBJ(P), s = OBJ(S);
    a.setW(o, m.gfx); a.setB(o + 2, m.b2);   // the monster-type byte (+1) is the low byte of the gfx word
     a.setB(o + 3, m.b3); a.setB(o + 5, m.b5); a.setB(o + 6, m.b6); a.setB(o + 7, m.b7);
    a.setW(o + 8, m.hp); a.setW(o + 0xc, m.w0c); a.setW(o + 0xe, m.moveType); a.setW(o + 0x10, S); a.setW(o + 0x12, 0);
    const loot = m.loot ?? [];
    a.setW(o + 0xa, loot[0] ?? 0);
    loot.forEach((it, i) => a.setW(OBJ(it) + 0x12, loot[i + 1] ?? 0));
    a.setW(s + 6, m.xpBase); a.setW(s + 8, m.maxHp); a.setB(s + 0xb, m.pos); a.setB(s + 0xc, 0); a.setB(s + 0xd, 4); a.setW(s + 4, 1);
    addToSquare(this.mw, P, m.x, m.y);
    this.monsterIds.push(P);
    if (m.awake) { a.setB(s + 0x13, 1); this.scheduleMonster(P, 1); }
    return P;
  }
  /** a structure on a square: type byte +5, state word +0xA, words +0xC / +0xE / +0x10 */
  structure(x: number, y: number, f: { b5: number; wA?: number; wC?: number; wE?: number; w10?: number; b7?: number; w8?: number }): number {
    const id = this.fixedId();
    this.object(id, { w0: 1, b5: f.b5, b7: f.b7, w8: f.w8, wA: f.wA ?? 0, wC: f.wC, wE: f.wE, w10: f.w10, next: 0 });
    addToSquare(this.mw, id, x, y);
    return id;
  }
  monsterXY(P: number): [number, number] | null {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { let id = getL(this.a, CELL(x, y)) & 0xfff; while (id) { if (id === P) return [x, y]; id = this.a.w(OBJ(id) + 0x12); } }
    return null;
  }
  monsterAlive(P: number) { return this.monsterXY(P) !== null; }
  monsterHp(P: number) { return this.a.sw(OBJ(P) + 8); }

  // ------------------------------------------------------------------ events
  scheduleMonster(P: number, delay: number) { const xy = this.monsterXY(P) ?? [0, 0]; scheduleEvent(this.a, 1, (this.tick + delay) >>> 0, xy[0] & 0xff, xy[1] & 0xff, 0, 0, P); }

  private dispatchUnknown(ev: DueEvent) {
    if (ev.type === 1) { const P = ev.wd; if (this.monsterXY(P)) this.runMonster(P); }
  }

  // ------------------------------------------------------------------ damage, death, loot
  damage(ch: number, dmg: number, kind: number, flag: number) {
    if (this.hpOf(ch) <= 0) return;
    const r = damageCharacter(this.a, this.rng, this.t.statBonusT1, ch, dmg & 0xffff, kind, flag, this.tick);
    this.note('damage', { ch, dmg, kind, hp: this.hpOf(ch) });
    if (r.died) this.note('death', { ch });
    if (r.gameOver) { this.gameOver = true; this.note('game-over'); }
  }
  killMonster(P: number, skipXp = false, xpBefore?: number[]) {
    const xy = this.monsterXY(P); if (!xy) return;
    const before = xpBefore ?? [0, 1, 2, 3].map(k => getL(this.a, CH(k) + 0xa0));
    const r = monsterDeath(this.a, this.rng, P, xy[0], xy[1], k => {
      const v = this.charView(k), lv = v.level; levelUp(v, this.t, this.rng);
      if (v.level !== lv) this.note('levelup', { ch: k, level: v.level });
    }, skipXp);
    if (r.held) { this.note('monster-held', { P, why: r.held }); return; }
    if (r.dead) { this.note('monster-dead', { P, x: xy[0], y: xy[1], xp: [0, 1, 2, 3].map(k => getL(this.a, CH(k) + 0xa0) - before[k]) }); if (r.scan) activationScan(this.a, this.rng, this.tick); }
  }

  // ------------------------------------------------------------------ world effects (pass 8: action executor, glyph, pit, doors, keys; all harness-diffed ports)
  /** hooks for the pieces the rules do not own: the activation scan runs for real, map loads / UI are logged */
  private execHooks(): ExecHooks {
    return {
      scan: () => activationScan(this.a, this.rng, this.tick),
      stairs: map => { this.note('map-change', { map }); if (this.cfg.levelRamps?.[map - 1] !== undefined) this.a.setW(0x1e62, this.cfg.levelRamps[map - 1]); },
      equipRemove: (ch, row, slot) => this.note('unequip-effects', { ch, row, slot }),
      palette: ramp => this.note('ramp', { ramp }),
    };
  }
  /** run a world effect that may hurt the party through the raw DamageCharacter port, then log the visible consequences (damage, deaths, game over) */
  private effect(label: string | (() => string), fn: () => void, extra: Record<string, unknown> | (() => Record<string, unknown>) = {}) {
    const a = this.a, hp0 = [0, 1, 2, 3].map(k => this.hpOf(k));
    fn();
    const lost = [0, 1, 2, 3].map(k => hp0[k] - this.hpOf(k));
    this.note(typeof label === 'function' ? label() : label, { ...(typeof extra === 'function' ? extra() : extra), ...(lost.some(v => v > 0) ? { lost } : {}) });
    for (let k = 0; k < 4; k++) if (hp0[k] > 0 && this.hpOf(k) <= 0) this.note('death', { ch: k });
    if (a.w(0x1e88) === 2 && !this.gameOver) { this.gameOver = true; this.note('game-over'); }
  }
  runAction(id: number) {
    const a = this.a, r = 0x836 + 8 * id;
    this.effect('action', () => executeAction(a, this.rng, this.t.statBonusT1, id, this.execHooks()), { id, op: a.b(r), x: a.b(r + 2), y: a.b(r + 3), v: a.b(r + 6) });
  }
  /** TriggerActionsAt (+0xCF34) with its immediate records run in-line by the executor: plates, levers, buttons, trap squares */
  trigger(x: number, y: number, type: number) {
    const res = triggerActions(this.a, x, y, type, this.tick, id => this.runAction(id));
    if (res.ran) this.note('trigger', { x, y, type, executed: res.executed });
  }

  // ------------------------------------------------------------------ player melee
  private swing(k: number, hand = 0) {
    const a = this.a, c = CH(k);
    if (a.sw(c + 0x4e) <= 0) return;
    const mask = 2 - hand;
    if ((a.b(c + 0x5f) & mask) !== 0) return;                       // the hand is still busy (event 0x14 clears the bit)
    const [dx, dy] = DIRS[a.w(0x1744)];
    const fx = a.w(0x1742) + dx, fy = a.w(0x1740) + dy;
    if ((getL(a, CELL(a.w(0x1742), a.w(0x1740))) & (0x1000 << a.w(0x1744))) !== 0) return;   // a wall in front
    const P = pickTargetsMem(a, fx, fy)[0];
    if (!P) return;
    const item = a.w(c + 0x16 + HAND_WORD[hand] - 0x16);
    const gfx = item ? a.w(OBJ(item)) : 0, extra = item ? a.w(OBJ(item) + 0xc) : 0;
    const info = weaponInfo({ cls: a.w(c), level: a.b(c + 0x5e), gfx, extra, monType: a.b(OBJ(P) + 1), activeItem36Gfx: 0 }, this.cfg.weaponBase);
    if (!info) return;
    const r = meleeAttack({ level: a.b(c + 0x5e), str: a.b(c + 0x64), b6c: a.b(c + 0x6c), monHit: a.b(OBJ(P) + 2), monHp: a.sw(OBJ(P) + 8), info, item: item ? 1 : 0 }, this.t, this.rng);
    a.setW(OBJ(P) + 8, r.monHp);
    const cd = swingCooldown(a, this.t.speedT3, k, item);
    swingTail(a, this.t.statBonusT1, k, hand, cd, this.tick, true, (type, due, a1, a2, a3, a4) => scheduleEvent(a, type, due, a1, a2, a3, a4, 0));
    if (r.hit) { a.setW(c + 0x58 + 2 * hand, 1); scheduleEvent(a, 0x15, (this.tick + hitReadyDelay(a.w(0x1e2e) !== 0, cd)) >>> 0, k, 0, hand, 0, 0); }
    if (a.w(OBJ(P)) === 0x80c5 && a.sw(OBJ(P) + 8) < 50) { if (a.w(0x1a1e) === 0) a.setW(0x1a1e, 1); a.setW(OBJ(P) + 8, 49); }
    this.note('swing', { ch: k, hit: r.hit, dmg: r.damage, P, monHp: a.sw(OBJ(P) + 8) });
    if (a.sw(OBJ(P) + 8) < 1) this.killMonster(P);
  }

  // ------------------------------------------------------------------ monsters
  private actEnv(): ActEnv {
    const a = this.a;
    return {
      party: { x: a.w(0x1742), y: a.w(0x1740), facing: a.w(0x1744) }, form: [0, 1, 2, 3].map(i => a.w(0x1e74 + 2 * i)),
      chars: [0, 1, 2, 3].map(k => ({ hp: a.sw(CH(k) + 0x4e), ac: s8(a.b(CH(k) + 0x62)), res: s8(a.b(CH(k) + 0x69)), shield: a.b(CH(k) + 0x83), ice: a.b(CH(k) + 0x8d), fire: a.b(CH(k) + 0x8e) })),
      lastDist: this.mw.lastDist, stackJunk: 0,
    };
  }
  private applyCalls(P: number, calls: MoveCall[], pos: { x: number; y: number }) {
    const a = this.a;
    for (const c of calls) {
      if (c.fn === 'damage') { this.note('monster-hit', { P, ch: c.ch, dmg: c.dmg, kind: c.kind }); this.damage(c.ch, c.dmg, c.kind, c.flag); }
      else if (c.fn === 'hold') { a.setW(0x1756, a.w(0x1756) + c.n); this.note('hold', { P, ticks: c.n }); }
      else if (c.fn === 'openDoor') { openDoor(a, c.x, c.y); this.note('monster-opens-door', { P, x: c.x, y: c.y }); }
      else if (c.fn === 'special') this.special(P, c.bit, pos);
    }
  }
  /** bits 12 / 13 of the monster's spell set: possession and flesh-to-stone (rules-spell.ts monsterPossessStone, harness 1,600 / 1,600), applied to the image */
  private special(P: number, bit: number, pos: { x: number; y: number }) {
    if (bit !== 12 && bit !== 13) { this.note('special', { P, bit }); return; }   // bits 14 / 15 (disease, poison) arrive as damage calls from the act routine
    const a = this.a, S = a.w(OBJ(P) + 0x10);
    const dx = a.w(0x1742) - pos.x, dy = a.w(0x1740) - pos.y;
    let dir = 4;
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) dir = 1; else if (dx < 0 && Math.abs(dx) > Math.abs(dy)) dir = 3; else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) dir = 0; else if (dy < 0 && Math.abs(dy) > Math.abs(dx)) dir = 2;
    const chs = [0, 1, 2, 3];
    const out = monsterPossessStone({
      bit, gfx: a.w(OBJ(P)), dir, pos: a.b(OBJ(S) + 0xb), facing: a.w(0x1744), maxHp: s16(a.w(OBJ(S) + 8)), form: chs.map(i => a.w(0x1e74 + 2 * i)), hp: chs.map(k => a.sw(CH(k) + 0x4e)),
      resist: chs.map(k => a.b(CH(k) + 0x69)), shield: chs.map(k => a.b(CH(k) + 0x83)), prot12: chs.map(k => a.b(CH(k) + 0x8f)), prot13: chs.map(k => a.b(CH(k) + 0x87)), carried: a.w(OBJ(P) + 0xa),
    } as never, STONE_POS, this.rng);
    for (const [ch, dmg, kind, flag] of out.dmg) this.damage(ch, dmg, kind, flag);
    if (out.corpseFor !== null) this.note('possessed', { P, ch: out.corpseFor });
    if (out.statue) {
      const id = allocObj(a); const o = OBJ(id);
      a.setW(o, 1); a.setB(o + 5, 0x2f); a.setW(o + 0xc, out.statue.char); a.setW(o + 0x12, 0); a.setW(o + 0xa, 0);
      this.mw.setCell(out.statue.x, out.statue.y, this.mw.cell(out.statue.x, out.statue.y));
      addToSquare(this.mw, id, out.statue.x, out.statue.y); this.note('stoned', { P, ch: out.statue.char });
    }
    a.setW(OBJ(P), out.gfx); a.setW(OBJ(P) + 8, out.hp); a.setW(OBJ(S) + 8, out.maxHp);
  }
  /** one behaviour-VM activation (type-1 event) of monster P: the harnessed chain on the shared image */
  runMonster(P: number) {
    const a = this.a, w = this.mw, S = a.w(OBJ(P) + 0x10), o = OBJ(P), s = OBJ(S);
    const xy = this.monsterXY(P); if (!xy) return;
    const pos = { x: xy[0], y: xy[1] };
    if (a.w(o) === 0x80c5 && a.w(0x1a1e) >= 3) a.setW(0x1a1e, 2);
    const vm: VmMonster = { gfx: a.w(o), b3: a.b(o + 3), b5: a.b(o + 5), b7: a.b(o + 7), hp: a.sw(o + 8), w0c: a.w(o + 0xc), type: a.w(o + 0xe), pc: a.w(s + 4), maxHp: s16(a.w(s + 8)), s0e: a.b(s + 0xe), vars: [0, 1, 2, 3, 4].map(i => a.b(s + 0xf + i)) };
    const pathRes = vm.type === 10 ? pathfind(w, P, pos.x, pos.y, w.party.x, w.party.y).result : 0;
    const world = { px: a.w(0x1742), py: a.w(0x1740), x: pos.x, y: pos.y, hookRet: 0, tick: this.tick, a1e8e: pathRes };
    const mirror = (m: VmMonster) => { a.setB(s + 0xe, m.s0e); m.vars.slice(0, 5).forEach((v, i) => a.setB(s + 0xf + i, v)); a.setW(o + 8, m.hp); a.setB(o + 7, m.b7); a.setW(s + 4, m.pc); a.setW(s + 8, m.maxHp); a.setW(o, m.gfx); a.setW(o + 0xe, m.type); };
    const onCall = (c: VmCall, vmm: VmMonster) => {
      mirror(vmm);
      let res = 0; const env = this.actEnv();
      if (c.off === VM_CALLS.attack) res = moveAct(w, P, pos, c.w5 ?? 4, 1, env, this.rng).ret;
      else if (c.off === VM_CALLS.move) res = pursue(w, P, pos, c.w5 ?? 4, env, this.rng);
      else if (c.off === VM_CALLS.spell) res = approach(w, P, pos, c.w5 ?? 0xb, env, this.rng);
      else if (c.off === VM_CALLS.special) res = wander(w, P, pos, this.rng);
      this.applyCalls(P, w.log.splice(0), pos);
      return { res, x: pos.x, y: pos.y, s0e: a.b(s + 0xe), vars: [0, 1, 2, 3, 4].map(i => a.b(s + 0xf + i)), hp: a.sw(o + 8), b7: a.b(o + 7) };
    };
    const r = runBehaviour(vm, world, this.cfg.scripts, this.rng, hpAtLeastMorale, P, onCall);
    mirror(r.m);
    if (r.event) scheduleEvent(a, 1, r.event.due >>> 0, pos.x & 0xff, pos.y & 0xff, 0, 0, P);
    if (this.monsterXY(P)?.join() !== `${xy[0]},${xy[1]}`) { const n = this.monsterXY(P); if (n) this.note('step', { P, x: n[0], y: n[1] }); }
  }

  // ------------------------------------------------------------------ party movement
  private move(back: boolean) {
    const a = this.a;
    const f = back ? (a.w(0x1744) + 2) & 3 : a.w(0x1744);
    const x = a.w(0x1742), y = a.w(0x1740);
    if ((getL(a, CELL(x, y)) & (0x1000 << f)) !== 0) { this.note('blocked', { why: 'wall' }); return; }
    const [dx, dy] = DIRS[f]; const nx = x + dx, ny = y + dy;
    const r = enterParty(a, nx, ny, a.w(0x1744), true);
    if (r.code === 1 || r.code === 8) { this.note('blocked', { why: r.code === 8 ? 'monster' : 'structure', x: nx, y: ny }); return; }
    a.setW(0x1742, r.x); a.setW(0x1740, r.y);
    if (r.code >= 2 && r.code <= 4 || r.code === 9) a.setW(0x1744, r.facing);
    this.note('step-party', { x: r.x, y: r.y, verdict: r.code });
    // the move routine +0x16CC4 after the enter test: 2 = pit / stairs down (+0x1734A damage), 3 = teleporter / stairs (+0x16C62 when the teleporter's byte +7 names a map), 5 = glyph +0x4662,
    // 6 = trap square: TriggerActionsAt(x, y, 0x1E); 7 (a kind-2 field) does nothing here
    if (r.code === 2) this.effect('pit', () => pitEffect(a, this.rng, this.t.statBonusT1), { x: r.x, y: r.y });
    if (r.code === 3) { const s = lookupType(a, nx, ny, 0x12); const map = s ? a.b(OBJ(s) + 7) : 0; if (map) this.execHooks().stairs!(map); else this.note('teleport', { x: r.x, y: r.y }); }
    if (r.code === 5) this.effect('glyph', () => glyphEffect(a, this.rng, this.t.statBonusT1), { x: r.x, y: r.y, kind: r.code });
    if (r.code === 6) { this.note('trap', { x: r.x, y: r.y }); this.trigger(r.x, r.y, 0x1e); }
    const flipped = stepCost(a, this.t.statBonusT1); void flipped;
    activationScan(a, this.rng, this.tick);
  }

  // ------------------------------------------------------------------ spells
  private ray(): RayWorld {
    const a = this.a, cells = new Map<number, number>(), objs: Record<number, RayObj> = {};
    for (const o of [...a.m.keys()]) {
      const rel = o + 0x37ca;
      if (rel < 0 || rel >= 0x4000 || (rel & 3) !== 0) continue;   // the 64 x 64 cell array only (anything above is the action records and the globals)
      const x = (rel & 0xff) >> 2, y = rel >> 8;
      const v = getL(a, CELL(x, y)); if (v) cells.set(y * 256 + x, v);
    }
    for (const [, v] of cells) {
      let id = v & 0xfff;
      while (id) {
        const o = OBJ(id);
        if (a.w(o) & 0x8000) {
          const S = a.w(o + 0x10), so = OBJ(S);
          objs[id] = { kind: 'mon', gfx: a.w(o), b2: a.b(o + 2), hp: a.sw(o + 8), S, next: a.w(o + 0x12) };
          objs[S] = { kind: 'sec', maxHp: a.w(so + 8), w6: a.w(so + 6), pos: a.b(so + 0xb), alert: a.b(so + 0x12), b0A: a.b(so + 0xa) };
        } else objs[id] = { kind: 'str', b5: a.b(o + 5), wA: a.w(o + 0xa), wC: a.w(o + 0xc), w10: a.w(o + 0x10), b0F: a.b(o + 0xf), next: a.w(o + 0x12) };
        id = a.w(o + 0x12);
      }
    }
    return { cells, objs, px: a.w(0x1742), py: a.w(0x1740), facing: a.w(0x1744), item36: false, b1E5C: 0, chars: [0, 1, 2, 3].map(k => ({ hp: a.sw(CH(k) + 0x4e), xp: getL(a, CH(k) + 0xa0) })) };
  }
  private spChars(): SpChar[] {
    const a = this.a;
    return [0, 1, 2, 3].map(k => { const o = CH(k); return { cls: a.w(o), level: a.b(o + 0x5e), b6a: s8(a.b(o + 0x6a)), w65: a.b(o + 0x65), w66: a.b(o + 0x66), hp: a.sw(o + 0x4e), maxHp: a.sw(o + 0x50), ac: s8(a.b(o + 0x62)), str: a.b(o + 0x64), poison: a.b(o + 0x9a), disease: a.b(o + 0x97), food: a.sw(o + 0x52), water: a.sw(o + 0x54), acCnt: a.b(o + 0x82), strCnt: a.b(o + 0x78), wizCnt: a.b(o + 0x85), detCnt: a.b(o + 0x84), res: s8(a.b(o + 0x69)), slots: [0, 1, 2, 3, 4].map(i => a.b(o + 0x49 + i)), xp: getL(a, o + 0xa0) }; });
  }
  private spendSlot(k: number, slot: number) {
    const a = this.a, o = CH(k) + 0x49, s = [0, 1, 2, 3, 4].map(i => a.b(o + i));
    s.splice(slot, 1); s.push(0xff); s.forEach((v, i) => a.setB(o + i, v));
  }
  castAny(k: number, slot: number, ui: { pick?: number; map?: number } = {}) {
    const a = this.a, spell = a.b(CH(k) + 0x49 + slot);
    if (spell === 0xff || this.hpOf(k) <= 0) return;
    if (spell === 34 || spell === 43) { this.castFacingSpell(k, spell as 34 | 43); this.spendSlot(k, slot); this.note('cast', { ch: k, spell, spent: true }); return; }
    if (spell === 46 && this.book) { castRefresh(this.book, a.b(CH(k) + 0x46), this.cfg.spells!.pageNext); this.spendSlot(k, slot); this.note('cast', { ch: k, spell, spent: true }); return; }
    const NINE = new Set([10, 2, 51, 41, 26, 22, 24, 21, 4, 18, 44]);
    if (NINE.has(spell)) {
      a.setW(0x1a14, k);
      const r = castSpell9(a, this.rng, this.t, slot, this.tick, ui);
      for (const e of r.events) scheduleEvent(a, e.type, e.due, e.a1, e.a2, e.a3, 0, 0);
      const spent = r.ret > 0;
      if (spent) this.spendSlot(k, slot);
      this.note('cast', { ch: k, spell, spent, failed: r.ret < 0 });
      return;
    }
    // ray and simple spells: the JS-struct ports, with the image copied in and out
    const sp = this.spChars(), rw = this.ray();
    const w: SpFull = {
      chars: sp, active: k, formation: [0, 1, 2, 3].map(i => a.w(0x1e74 + 2 * i)), tick: this.tick, light: a.w(0x1754), hold: a.w(0x1756),
      compass: a.w(0x1e28), wizSight: a.w(0x1e2a), detect: a.w(0x1e2c), haste: a.w(0x1e2e), events: [], ray: rw,
      antimagic: (getL(a, CELL(a.w(0x1742), a.w(0x1740))) & 0x40000000) !== 0,
    };
    if (RAY_SPELLS[spell] === undefined && !SIMPLE.has(spell)) { this.note('cast-unsupported', { ch: k, spell }); return; }
    // the real ray runs the death routine at each hit (+0x702E), so the kill goes through the image at that point: loot first, then XP, then the level-up (pass 8: this fixes the draw order of ray kills)
    const death = this.rayDeath(sp, rw);
    const r = castSpell(w, spell, ui.pick ?? 0, this.t, this.rng, awardXp, death);
    sp.forEach((c, i) => {
      const o = CH(i);
      a.setW(o + 0x4e, c.hp); a.setB(o + 0x62, c.ac); a.setB(o + 0x64, c.str); a.setB(o + 0x9a, c.poison); a.setB(o + 0x97, c.disease); a.setW(o + 0x52, c.food); a.setW(o + 0x54, c.water);
      a.setB(o + 0x82, c.acCnt); a.setB(o + 0x78, c.strCnt); a.setB(o + 0x85, c.wizCnt); a.setB(o + 0x84, c.detCnt);
      const xp = c.xp ?? 0; a.setW(o + 0xa0, xp >>> 16); a.setW(o + 0xa2, xp & 0xffff);
    });
    a.setW(0x1754, w.light); a.setW(0x1e28, w.compass); a.setW(0x1e2a, w.wizSight); a.setW(0x1e2c, w.detect); a.setW(0x1e2e, w.haste);
    for (const e of w.events) scheduleEvent(a, e.type, e.due >>> 0, e.a1, e.a2, e.a3, 0, 0);
    if (r.ray) {
      for (const h of r.ray.hits) { const P = h.id; if (!h.killed) a.setW(OBJ(P) + 8, rw.objs[P].hp!); a.setB(OBJ(rw.objs[P].S!) + 0x12, rw.objs[rw.objs[P].S!].alert!); }
      this.note('ray', { ch: k, spell, total: r.ray.total, hits: r.ray.hits.map(h => ({ P: h.id, dmg: h.dmg, killed: h.killed })) });
    }
    if (r.spent) this.spendSlot(k, slot);
    this.note('cast', { ch: k, spell, spent: r.spent });
  }

  // ------------------------------------------------------------------ pass 8: facing spells, item use, boss items
  /** the ray's per-hit death callback: the verified monsterDeath on the image (loot first, then XP and level-up), then the JS copies of the characters are refreshed */
  private rayDeath(sp: SpChar[], rw: RayWorld): RayDeath {
    const a = this.a;
    return (id, hp) => {
      a.setW(OBJ(id) + 8, hp);
      this.killMonster(id);
      sp.forEach((c, i) => { c.hp = a.sw(CH(i) + 0x4e); c.xp = getL(a, CH(i) + 0xa0); });
      void rw;
      return { hp: a.sw(OBJ(id) + 8), killed: !this.monsterAlive(id) };
    };
  }
  /** a ray with fixed parameters (the item effects 0x82 / 0x83 / 0x85 / 0x87 / 0x88 / 0x89 / 0x8C call `+0x6D9A` with constants) */
  private doRay(args: { mag: number; dmg: number; base: number; pre: number; range: number }, label: string): number {
    const a = this.a, sp = this.spChars(), rw = this.ray();
    rw.chars = sp as unknown as RayWorld['chars']; for (const c of sp) c.xp ??= 0;
    const r = castRay(rw, args, this.rng, awardXp, this.rayDeath(sp, rw));
    for (const h of r.hits) { if (!h.killed) a.setW(OBJ(h.id) + 8, rw.objs[h.id].hp!); a.setB(OBJ(rw.objs[h.id].S!) + 0x12, rw.objs[rw.objs[h.id].S!].alert!); }
    this.note(label, { total: r.total, hits: r.hits.map(h => ({ P: h.id, dmg: h.dmg, killed: h.killed })) });
    return 1;
  }
  /** DISMISS (34) and BINDING (43), the facing-square spells: the verified castFacing; a DISMISS kill runs the real death routine (`+0x6AD6` calls `+0x7ED0`), a BINDING success cancels the monster's events and schedules its act at tick + 200 */
  private castFacingSpell(k: number, spell: 34 | 43) {
    const a = this.a, tick = this.tick;
    if ((getL(a, CELL(a.w(0x1742), a.w(0x1740))) & 0x40000000) !== 0) return;
    const rw = Object.assign(this.ray(), { level: a.b(CH(k) + 0x5e), tick });
    const sp = this.spChars(); rw.chars = sp as unknown as RayWorld['chars'];
    const [fx, fy] = [0, 0];
    void fx; void fy;
    const r = castFacing(rw, spell, this.rng, awardXp, id => { a.setW(OBJ(id) + 8, 0); this.killMonster(id); });
    for (const [id, o] of Object.entries(rw.objs)) if (o.kind === 'sec') a.setB(OBJ(+id) + 0x12, o.alert!);
    for (const id of r.cancelled) if (!r.killed.includes(id)) cancelEventsFor(a, id);
    for (const sc of r.sched) { const xy = this.monsterXY(sc.id) ?? [0, 0]; scheduleEvent(a, 1, (tick + 200) >>> 0, xy[0] & 0xff, xy[1] & 0xff, 0, 0, sc.id); }
    this.note(spell === 34 ? 'dismiss' : 'binding', { ch: k, killed: r.killed, bound: r.sched.map(s => s.id) });
  }
  /** PROTECTOR / SOULFREEZER / VORTEX (harness 900 / 900 in rules-boss.test.ts) applied to the image; FORCEHAMMER is the A4 port in rules-spell9.ts */
  private bossItem(fx: 'prot' | 'sf' | 'vx' | 'hammer'): number {
    const a = this.a;
    if (fx === 'hammer') {
      const cancelled: number[] = []; const stage0 = a.w(0x1a1e);
      forceHammer(a, cancelled); for (const id of cancelled) cancelEventsFor(a, id);
      this.note('forcehammer', { stage: a.w(0x1a1e), done: stage0 === 4 && a.w(0x1a1e) === 5 });
      return 1;
    }
    const px = a.w(0x1742), py = a.w(0x1740), f = a.w(0x1744), rw = this.ray();
    const wall = ((getL(a, CELL(px, py)) >>> (12 + f)) & 1) === 1;
    const r = ramBossItem(fx, { stage: a.w(0x1a1e), tick: this.tick, px, py, facing: f, wall, world: rw, chars: [0, 1, 2, 3].map(k => ({ hp: this.hpOf(k), res: a.b(CH(k) + 0x69) })) });
    a.setW(0x1a1e, r.stage);
    for (let k = 0; k < 4; k++) a.setB(CH(k) + 0x69, r.res[k]);
    for (const [S, al] of Object.entries(r.alert)) a.setB(OBJ(+S) + 0x12, al);
    for (const call of r.calls) {
      if (call.fn === 'cancelType') { for (let n = a.b(0x173f), guard = 0; n !== 0x96 && guard < 200; guard++) { const nx = a.b(QN(n) + 9); if (a.b(QN(n) + 4) === call.type) cancelEvent(a, n); n = nx; } }
      else if (call.fn === 'cancelEvents') cancelEventsFor(a, call.id!);
      else if (call.fn === 'sched') scheduleEvent(a, call.type!, call.due! >>> 0, call.type === 1 ? (call.x ?? 0) : 0, call.type === 1 ? (call.y ?? 0) : 0, 0, 0, call.type === 1 ? call.id! : 0);
    }
    for (const S of r.clearB0a) a.setB(OBJ(S) + 0xa, 0);
    this.note('boss-item', { fx, stage: r.stage });
    return 1;
  }
  /**
   * USE AN ITEM (`+0x12FEA`, harness for the shell, the effect map and the inline potions: rules-item.ts). The routines the effects 0x80..0x90 call are supplied here from the ports that are harnessed
   * elsewhere (rays: castRay with the constant parameters, DISPEL: dispel, HEALING: healTarget, RAISE DEAD: raiseDead, the boss items: ramBossItem / forceHammer); LIGHT (`+0x58C6`) is taken to add
   * 120 to the light counter like spell 1 (hyp: not diffed on its own).
   */
  useItem(k: number, item: number, ui: { pick?: number } = {}): number {
    const a = this.a;
    a.setW(0x1a24, k);
    const callee: ItemCallee = (off, args) => {
      switch (off) {
        case 0x6d9a: return this.doRay({ mag: args[0], dmg: args[1], base: args[2], pre: args[3], range: args[4] }, 'item-ray');
        case 0x4c46: return dispel(a, args[0], 2);
        case 0x5070: { const tgt = a.w(0x1e74 + 2 * (ui.pick ?? k)); const c = this.spChars()[tgt]; healTarget(c as unknown as SpChar, args[0], this.rng); a.setW(CH(tgt) + 0x4e, c.hp); return 1; }
        case 0x5cfa: return raiseDead(a, this.t.statBonusT1, ui.pick ?? 0xffff);
        case 0x58c6: a.setW(0x1754, (a.w(0x1754) + 120) & 0xffff); return 1;
        case 0x78da: return this.bossItem('prot');
        case 0x79c2: return this.bossItem('sf');
        case 0x7b2e: return this.bossItem('vx');
        case 0x7c40: return this.bossItem('hammer');
        default: return 0;
      }
    };
    const r = useItem(a, this.rng, this.t.statBonusT1, k, item, callee);
    this.note('use-item', { ch: k, item, result: r });
    return r;
  }

  // ------------------------------------------------------------------ commands and the tick
  command(c: Cmd) {
    const a = this.a;
    switch (c.kind) {
      case 'attack': this.swing(c.char, c.hand ?? 0); break;
      case 'move': this.move(c.dir === 'back'); break;
      case 'turn': a.setW(0x1744, (a.w(0x1744) + 4 + c.by) & 3); for (let k = 0; k < 4; k++) adjustVitals(a, this.t.statBonusT1, k, 0xffff, 0xffff, 0xffff); break;
      case 'openDoor': { a.setW(0x1a24, c.char ?? a.w(0x1a24)); const [dx, dy] = DIRS[a.w(0x1744)]; const e0 = this.doorState(a.w(0x1742) + dx, a.w(0x1740) + dy); const dx2 = a.w(0x1742) + dx, dy2 = a.w(0x1740) + dy; this.effect(() => { const e1 = this.doorState(dx2, dy2); return e0 === 0 && e1 === 1 ? 'door open' : e0 === 1 && e1 === 0 ? 'door close' : e0 === 2 ? 'door locked' : 'door-click'; }, () => doorClick(a, this.rng, this.t.statBonusT1, this.execHooks()), { was: e0 }); break; }
      case 'trigger': this.trigger(c.x, c.y, c.type); break;
      case 'use': this.useItem(c.char, c.item, { pick: c.pick }); break;
      case 'cursor': this.unstow(c.char, c.item); a.setW(0x1a22, c.item); this.note('cursor', { ch: c.char, item: c.item }); break;
      case 'useKey': { a.setW(0x1a24, c.char ?? a.w(0x1a24)); const held = a.w(0x1a22); this.effect('use-key', () => keyUse(a, this.rng, this.t.statBonusT1, this.execHooks()), () => ({ item: held, used: held !== 0 && a.w(0x1a22) === 0 })); break; }
      case 'cast': this.castAny(c.char, c.slot, { pick: c.pick, map: c.map }); break;
      case 'memorise': this.memorise(c.char, c.row); break;
      case 'pickup': { const xy = this.itemSquare(c.item); if (xy && this.pickup(c.char, c.item, xy[0], xy[1])) this.stow(c.char, c.item); break; }
      case 'drop': { this.unstow(c.char, c.item); this.drop(c.char, c.item); break; }
      case 'equip': { this.unstow(c.char, c.item); a.setW(CH(c.char) + 0x16 + HAND_WORD[c.hand] - 0x16, c.item); this.note('equip', { ch: c.char, item: c.item, hand: c.hand }); break; }
      case 'rest': a.setW(0x1746, c.on ? 1 : 0); for (let k = 0; k < 4; k++) a.setB(0x1a07 + k, c.on ? 1 : 0); break;
      case 'wait': break;
    }
  }
  /** first free pack word (rows 0..2, columns 0..5) that is not a hand slot */
  private stow(ch: number, item: number) {
    const a = this.a;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
      const o = CH(ch) + 0x16 + 12 * r + 2 * k;
      if (a.w(o) === 0 && !(r === 0 && (k === 2 || k === 3))) { a.setW(o, item); return; }
    }
  }
  private unstow(ch: number, item: number) {
    const a = this.a;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const o = CH(ch) + 0x16 + 12 * r + 2 * k; if (a.w(o) === item) a.setW(o, 0); }
    for (let k = 0; k < 5; k++) { const o = CH(ch) + 0x3a + 2 * k; if (a.w(o) === item) a.setW(o, 0); }
  }
  /** the state word +0xE of the door in front of the party at (x, y), -1 when there is none */
  private doorState(x: number, y: number): number { const d = lookupType(this.a, x, y, 0x11); return d ? this.a.w(OBJ(d) + 0xe) : -1; }
  itemSquare(item: number): [number, number] | null { return this.monsterXY(item); }
  private memorise(k: number, row: number) {
    const a = this.a;
    if (!this.book || this.hpOf(k) <= 0) return;
    const o = CH(k), slots = [0, 1, 2, 3, 4].map(i => a.b(o + 0x49 + i));
    const r = memoriseClick(this.book, { cls: a.w(o), level: a.b(o + 0x5e), b6b: s8(a.b(o + 0x6b)), w65: a.b(o + 0x65), w66: a.b(o + 0x66), cur: a.b(o + 0x47), slots }, row, this.t.defenseT2);
    slots.forEach((v, i) => a.setB(o + 0x49 + i, v));
    if (r.memorised !== null) this.note('memorise', { ch: k, spell: r.memorised });
  }

  /** one tick (S_1 +0x08B2, code order): commands, the counter, vitals / hazards, spell recharge, the due-event pop loop */
  step1(cmds: Cmd[] = []) {
    if (this.gameOver) return;
    const a = this.a;
    if (a.w(0x1756) === 0) for (const c of cmds) this.command(c);
    const t = (this.tick + 1) >>> 0; a.setW(0x1750, t >>> 16); a.setW(0x1752, t & 0xffff);
    const resting = a.w(0x1746) !== 0;
    const hazard = (getL(a, CELL(a.w(0x1742), a.w(0x1740))) & 0x80000000) !== 0;
    const v = vitalsTick({
      t, resting, hazard, light: a.w(0x1754), hold: a.w(0x1756),
      chars: [0, 1, 2, 3].map(k => { const o = CH(k); return { hp: a.sw(o + 0x4e), maxHp: a.sw(o + 0x50), level: a.b(o + 0x5e), food: a.sw(o + 0x52), water: a.sw(o + 0x54), poison: a.b(o + 0x9a), disease: a.b(o + 0x97), regen: a.b(o + 0x6d), prot86: a.b(o + 0x86), state: a.b(0x1a07 + k) }; }),
    }, this.rng);
    a.setW(0x1754, v.light); a.setW(0x1756, v.hold);
    for (let k = 0; k < 4; k++) if (a.sw(CH(k) + 0x4e) > 0) a.setW(CH(k) + 0x4e, v.hp[k]);
    for (const call of v.calls) {
      if (call.kind === 'adjust') adjustVitals(a, this.t.statBonusT1, call.char, call.energy & 0xffff, call.food & 0xffff, call.water & 0xffff);
      else if (call.kind === 'damage') this.damage(call.char, call.dmg, call.type, 1);
      else if (call.kind === 'scan') activationScan(a, this.rng, t);
    }
    if (this.book) rechargeTick(this.book, { resting, showActive: false, openPage: 0xff, mem: this.rechargeMem() });
    popDue(a, { slot: (_ev, idx) => { if (!this.gameOver) this.runAction(idx); }, unknown: ev => { if (!this.gameOver) this.dispatchUnknown(ev); }, applied: ev => { if (ev.type >= 0x1e && ev.type <= 0x25 && ev.type !== 0x22) this.note('expire', { type: ev.type, ch: ev.a1 }); } });
  }
  private rechargeMem(): number[] {
    const mem = new Array(0x1a0b - 0x19f8).fill(0);
    for (let p = 0; p < 15; p++) { mem[2 * p] = 0; mem[2 * p + 1] = p % 4; }
    for (let k = 0; k < 4; k++) mem[0x1a07 - 0x19f8 + k] = this.a.b(0x1a07 + k);
    return mem;
  }
  play(ticks: number, plan: (s: BcSim) => Cmd[] = () => []) { for (let i = 0; i < ticks && !this.gameOver; i++) this.step1(plan(this)); return this; }
}
/** the statue square of each character (S_2 +0x24C, read through the flesh-to-stone harness vectors) */
export const STONE_POS: [number, number][] = [[2, 10], [2, 13], [3, 14], [9, 14]];
const SIMPLE = new Set([1, 32, 3, 53, 9, 7, 5, 54, 6, 42, 40, 15, 27, 20, 45, 56, 12, 13, 19, 48]);
void QN; void insertObj; void lookupType; void unlinkObj; void freeObj; void cancelEventsFor; void pickSquareTargets; void castRay;
