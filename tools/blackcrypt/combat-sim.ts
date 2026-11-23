/**
 * Black Crypt (Amiga): headless combat tick loop. An executable form of
 * docs/blackcrypt/amiga/game-rules.md sections 9 and 10. It composes the pieces that are verified against the game's own
 * 68k code (rules.ts, rules-monster.ts, rules-move.ts, rules-spell.ts) and marks everything that is not.
 *
 * Evidence labels used in comments:
 *   [H] the piece is a harness-verified port (player melee, monster melee / bolts / hold calls, behaviour VM, activation scan, type-10 switch,
 *       pathfinder, pursue / approach / wander, mover + stacking, XP, level-up, vitals tick, heals / cures / buffs and their expiry events 0x1E-0x25, rays, memorise, recharge, DISMISS / BINDING / REFRESH)
 *   [C] read from code, not executed in the harness (DamageCharacter, AdjustVitals, event ordering, swing cooldown, per-step costs, the hold counter, slot shift on a spent cast)
 *   [h] hypothesis / simplification (possession / stone not applied, doors and items absent)
 *
 * Original code. The model: a rectangular map (at most 48 x 48) with blocked squares (modelled as pillars), four party members
 * (slot = class), any number of monsters (up to four same-gfx monsters share a square, in corners: real stacking), real-time ticks, scripted party commands.
 * Monsters run through the real chain: every 16 ticks the activation scan (+0xB614) wakes or parks them, an act event runs the behaviour VM
 * (+0xAAFC) whose pursue / approach / wander / attack calls are the harnessed +0xA664 / +0x940C / +0x9626 / +0x9D28.
 */
import { BcRng, levelUp, meleeAttack, weaponInfo, type RuleTables, type WeaponBase } from './rules';
import {
  castRay, castSpell, castFacing, castRefresh, memoriseClick, rechargeTick, pickSquareTargets, casterValues, RAY_SPELLS,
  A4Mem, applyExpiry, type RayWorld, type RayObj, type SpellBook, type SpChar, type SpFull, type SpEvent,
} from './rules-spell';
import {
  awardXp, hpAtLeastMorale, runBehaviour, vitalsTick, VM_CALLS,
  type AiScripts, type VmMonster, type VmCall,
} from './rules-monster';
import { ramBossItem } from './rules-boss';
import {
  MoveWorld, addToSquare, removeFromSquare, activationScan, pursue, approach, wander, monsterAct as moveAct, pathfind,
  type ActEnv, type MoveCall,
} from './rules-move';

/** 1 tick = 8 vblanks at 50 Hz (160 ms) or 10 vblanks at 60 Hz (166.7 ms): game-rules.md section 10.1 (harness on the arithmetic, code on the wiring). */
export const TICK_MS = { pal: 160, ntsc: 1000 / 6 } as const;

export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // dir 0..3 as used by the monster act code (S_1 +0x9D28)

/** The movement world works in game coordinates; the sim map is shifted by this so that its border stays inside the scan window (activation skips x or y <= 0 or >= 63). */
const OFF = 8;
const s16 = (v: number) => (v << 16) >> 16;

export interface SimChar {
  name: string;
  cls: number; level: number; xp: number;
  hp: number; maxHp: number;
  str: number; dex: number; con: number;
  /** INT (+0x66) and WIS (+0x65): spell stat; class 1 / 3 use WIS, others INT */
  int: number; wis: number;
  /** record +0x62 armour class (higher is better) */
  ac: number;
  /** record +0x69 percent resistance (spells / specials only) */
  resist: number;
  food: number; water: number; energy: number;
  poison: number; disease: number;
  /** +0x6D regen flag, +0x86 hazard protection, +0x90 sustenance counter */
  regen: number; prot86: number; sustain: number;
  /** weapon in the hand slot: gfx 0 = bare hand; `extra` is item word +0xC (to-hit / damage bonus), b6c the char to-hit byte +0x6C */
  weapon: { gfx: number; extra: number };
  b6c: number;
  /** resting state (A4+0x1A07[slot] == 1) */
  resting: boolean;
  /** tick before which this char cannot swing again [C: event 0x14 / 0x15 length] */
  readyAt: number;
  tired: boolean;
  /** five memorised spell slots (record +0x49), 0xFF = empty; default all empty */
  slots?: number[];
  /** book page the character has open (+0x47) and first page of the book (+0x46) */
  page?: number; firstPage?: number;
  /** record +0x83 magic shield, +0x8D ice / +0x8E fire immunity (monster bolt tests) */
  shield83?: number; ice8d?: number; fire8e?: number;
  /** buff counters (AC / strength / wizard sight / detect trap) */
  acCnt?: number; strCnt?: number; wizCnt?: number; detCnt?: number;
}

export interface SimMonster {
  id: number;
  x: number; y: number;
  gfx: number; monType: number;
  b2: number; b3: number; b5: number; b6: number; b7: number;
  hp: number; maxHp: number; xpBase: number;
  w0c: number; moveType: number;
  pc: number; s0e: number; vars: number[];
  /** position on the square: 0..3 corner, 4 centre */
  pos: number;
  alive: boolean;
  loot: number[];
  /** secondary record: facing S.b0C (default 0), desired facing S.b0D (default 4 = none), last seen party square S.w0 / S.w2 */
  face?: number; want?: number; lastX?: number; lastY?: number;
  /** secondary record byte +0x0A (cleared by SOULFREEZER when non-zero) */
  sb0a?: number;
}

export interface SimEvent { due: number; seq: number; type: number; monster: number; ev?: SpEvent }

/** The spell data the book needs (S_2 spell records and page table; exported as rules-tables.json `spellBook`). */
export interface SimSpells {
  pageHead: number[]; next: number[]; level: number[]; pageNext: number[];
  /** recharge timers by spell id (default all 0) and owned flags by page (default all owned) */
  timers?: number[]; owned?: number[];
}

export interface SimConfig {
  tables: RuleTables; weaponBase: WeaponBase; scripts: AiScripts;
  seed: string;
  width: number; height: number;
  /** blocked squares as "x,y" (modelled as pillars, type 0x17) */
  blocked: string[];
  party: SimChar[];
  /** formation: slot -> char index (A4+0x1E74) */
  formation?: number[];
  px: number; py: number; facing: number;
  monsters: SimMonster[];
  /** hazard square under the party (square flag bit 31) */
  hazard?: boolean;
  /** monsters start awake (S.b13 = 1, act event at tick 1) instead of waiting for the 16-tick activation scan */
  initiallyActive?: boolean;
  spells?: SimSpells;
  /** anti-magic squares as "x,y" (cell bit 30): any spell cast while the party stands there fizzles */
  antimagic?: string[];
}

export type SimCmd =
  | { kind: 'attack'; char: number }
  | { kind: 'move'; dir: 'forward' | 'back' }
  | { kind: 'turn'; by: 1 | -1 }
  /** free ray: casts the spell with no memorised slot, no recharge [legacy / test helper] */
  | { kind: 'ray'; char: number; spell: number }
  /** memorise the spell on `row` of the open book page of `char` (+0xF548) */
  | { kind: 'memorise'; char: number; row: number }
  /** cast the memorised spell in `slot` of `char`; `pick` = clicked party slot for the single-target spells */
  | { kind: 'cast'; char: number; slot: number; pick?: number }
  /** use a plot item effect: 'prot' PROTECTOR (0x8D), 'sf' SOULFREEZER (0x8E), 'vx' VORTEX (0x8F); the Ram-boss stage machine (rules-boss.ts) */
  | { kind: 'plotItem'; fx: 'prot' | 'sf' | 'vx' }
  | { kind: 'rest'; on: boolean }
  | { kind: 'wait' };

export type LogEntry =
  | { t: number; ev: 'swing'; char: number; hit: boolean; dmg: number; monster: number; monHp: number }
  | { t: number; ev: 'monster-hit'; monster: number; char: number; dmg: number; kind: number }
  | { t: number; ev: 'damage'; char: number; dmg: number; kind: number; hp: number }
  | { t: number; ev: 'death'; char: number }
  | { t: number; ev: 'monster-dead'; monster: number; xp: number[] }
  | { t: number; ev: 'levelup'; char: number; level: number }
  | { t: number; ev: 'ray'; char: number; spell: number; total: number; hits: { monster: number; dmg: number; killed: boolean }[] }
  | { t: number; ev: 'step'; monster: number; x: number; y: number }
  | { t: number; ev: 'activate'; monster: number; kind: 'wake' | 'park' }
  | { t: number; ev: 'hold'; monster: number; ticks: number }
  | { t: number; ev: 'special'; monster: number; bit: number }
  | { t: number; ev: 'memorise'; char: number; spell: number }
  | { t: number; ev: 'cast'; char: number; spell: number; spent: boolean }
  | { t: number; ev: 'expire'; type: number; char: number }
  | { t: number; ev: 'game-over' };

const SIMPLE_SPELLS = new Set([1, 32, 3, 53, 9, 7, 5, 54, 6, 42, 40, 15, 27, 20, 45, 56, 12, 13, 19, 48]);

export class CombatSim {
  tick = 0;
  rng: BcRng;
  chars: SimChar[];
  monsters: SimMonster[];
  px: number; py: number; facing: number;
  formation: number[];
  light = 0; hold = 0;
  compass = 0; wizSight = 0; detect = 0; haste = 0;
  /** A4+0x1A1E: set to 1 by the event 0x25 handler (PROTECTOR's expiry); the Ram-boss stage variable (game-rules.md 11) */
  a1a1e = 0;
  resting = false;
  hazard: boolean;
  gameOver = false;
  log: LogEntry[] = [];
  events: SimEvent[] = [];
  book: SpellBook | null = null;
  /** the movement world (cells, object chains, P / S records) the harnessed routines run on; sim state is the truth, this mirrors it */
  mw = new MoveWorld();
  private seq = 0;
  private blocked: Set<string>;
  cfg: SimConfig;
  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = new BcRng(cfg.seed);
    this.chars = cfg.party.map(c => ({ ...c, weapon: { ...c.weapon }, slots: [...(c.slots ?? [0xff, 0xff, 0xff, 0xff, 0xff])] }));
    this.monsters = cfg.monsters.map((m, i) => ({
      ...m, id: i, vars: [...m.vars], loot: [...m.loot],
      face: m.face ?? 0, want: m.want ?? 4, lastX: m.lastX ?? 0, lastY: m.lastY ?? 0,
    })); // id == index
    this.px = cfg.px; this.py = cfg.py; this.facing = cfg.facing;
    this.formation = cfg.formation ?? [0, 1, 2, 3];
    this.hazard = !!cfg.hazard;
    this.blocked = new Set(cfg.blocked);
    if (cfg.spells) {
      const sp = cfg.spells;
      this.book = { pageHead: sp.pageHead, next: sp.next, level: sp.level, timers: [...(sp.timers ?? sp.next.map(() => 0))], owned: [...(sp.owned ?? sp.pageHead.map(() => 1))] };
    }
    this.buildWorld();
    for (const m of this.monsters) if (m.alive && cfg.initiallyActive) { m.vars[4] = 1; this.schedule(m.id, 1); }
  }

  // ---------------------------------------------------------------- the movement world

  /** cells: border wall bits, blocked squares as pillars (type 0x17, state 0), anti-magic bit 30; monsters are chained by addToSquare (head insertion). */
  private buildWorld() {
    const { width, height } = this.cfg, w = this.mw;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let walls = 0;
        if (y === height - 1) walls |= 1; if (x === width - 1) walls |= 2; if (y === 0) walls |= 4; if (x === 0) walls |= 8;
        w.setCell(x + OFF, y + OFF, walls << 12);
      }
    }
    let sid = 500;
    for (const b of this.blocked) {
      const [x, y] = b.split(',').map(Number);
      w.setW(sid, 0, 1); w.setB(sid, 5, 0x17); w.setW(sid, 0xa, 0);
      addToSquare(w, sid++, x + OFF, y + OFF);
    }
    for (const a of this.cfg.antimagic ?? []) {
      const [x, y] = a.split(',').map(Number);
      w.setCell(x + OFF, y + OFF, (w.cell(x + OFF, y + OFF) | 0x40000000) >>> 0);
    }
    for (const m of this.monsters) if (m.alive) { this.load(m); addToSquare(w, 1 + 2 * m.id, m.x + OFF, m.y + OFF); }
    w.party = { x: this.px + OFF, y: this.py + OFF };
  }

  /** write the sim monster into its P (id 1 + 2i) and S (2 + 2i) object records */
  private load(m: SimMonster) {
    const w = this.mw, P = 1 + 2 * m.id, S = P + 1;
    w.setW(P, 0, m.gfx); w.setB(P, 2, m.b2); w.setB(P, 3, m.b3); w.setB(P, 5, m.b5); w.setB(P, 6, m.b6); w.setB(P, 7, m.b7);
    w.setW(P, 8, m.hp); w.setW(P, 0xc, m.w0c); w.setW(P, 0xe, m.moveType); w.setW(P, 0x10, S);
    w.setW(S, 0, m.lastX!); w.setW(S, 2, m.lastY!); w.setW(S, 4, m.pc); w.setW(S, 6, m.xpBase); w.setW(S, 8, m.maxHp);
    w.setB(S, 0xb, m.pos); w.setB(S, 0xc, m.face!); w.setB(S, 0xd, m.want!); w.setB(S, 0xe, m.s0e);
    for (let i = 0; i < 5; i++) w.setB(S, 0xf + i, m.vars[i] ?? 0);
  }
  private loadAll() { for (const m of this.monsters) if (m.alive) this.load(m); this.mw.party = { x: this.px + OFF, y: this.py + OFF }; }
  /** read the mutable fields back after a harnessed routine ran */
  private store(m: SimMonster) {
    const w = this.mw, P = 1 + 2 * m.id, S = P + 1;
    m.hp = s16(w.w(P, 8)); m.gfx = w.w(P, 0); m.moveType = w.w(P, 0xe); m.b7 = w.b(P, 7);
    m.lastX = w.w(S, 0); m.lastY = w.w(S, 2); m.pc = w.w(S, 4); m.maxHp = s16(w.w(S, 8));
    m.pos = w.b(S, 0xb); m.face = w.b(S, 0xc); m.want = w.b(S, 0xd); m.s0e = w.b(S, 0xe);
    for (let i = 0; i < 5; i++) m.vars[i] = w.b(S, 0xf + i);
  }
  private storeAll() { for (const m of this.monsters) if (m.alive) this.store(m); }

  private schedule(monster: number, delay: number) { this.events.push({ due: this.tick + delay, seq: this.seq++, type: 1, monster }); }
  private free(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.cfg.width || y >= this.cfg.height) return false;
    if (this.blocked.has(`${x},${y}`)) return false;
    return !this.monsters.some(m => m.alive && m.x === x && m.y === y);
  }
  alive(k: number) { return this.chars[k].hp > 0; }

  /** monsters on a square, in chain order */
  monstersAt(x: number, y: number): SimMonster[] { return this.monsters.filter(m => m.alive && m.x === x && m.y === y); }

  /** AdjustVitals (S_1 +0x17EEA) [C]: skip the dead, sustenance halves food loss, clamp, tired penalty on crossing energy 1000. */
  adjustVitals(k: number, dE: number, dF: number, dW: number) {
    const c = this.chars[k];
    if (c.hp <= 0) return;
    if (c.sustain !== 0) dF = (dF >> 1) + 1;
    c.energy = Math.max(0, Math.min(10000, c.energy + dE));
    c.food = Math.max(0, Math.min(5000, c.food + dF));
    c.water = Math.max(0, Math.min(5000, c.water + dW));
    if (!c.tired && c.energy < 1000) { c.tired = true; c.str -= 1; c.dex -= 1; }
    else if (c.tired && c.energy >= 1000) { c.tired = false; c.str += 1; c.dex += 1; }
  }

  /** DamageCharacter (S_1 +0x17686) [C]: no armour or resistance inside; dmg < hp survives, otherwise the character dies. */
  damage(k: number, dmg: number, kind: number) {
    const c = this.chars[k];
    if (c.hp <= 0) return;
    if (dmg < c.hp) {
      c.hp -= dmg;
      this.log.push({ t: this.tick, ev: 'damage', char: k, dmg, kind, hp: c.hp });
      this.adjustVitals(k, -3, -2, -3);
    } else {
      c.hp = 0;
      this.log.push({ t: this.tick, ev: 'damage', char: k, dmg, kind, hp: 0 });
      this.log.push({ t: this.tick, ev: 'death', char: k });
      if (!this.chars.some(ch => ch.hp > 0)) { this.gameOver = true; this.log.push({ t: this.tick, ev: 'game-over' }); }
    }
  }

  private frontSquare(): [number, number] { const [dx, dy] = DIRS[this.facing]; return [this.px + dx, this.py + dy]; }

  /** Ray world for the harnessed ray / target-pick routines, built from the movement world (ids are the same). */
  private rayWorld(): RayWorld {
    this.loadAll();
    const w = this.mw, cells = new Map<number, number>(), objs: Record<number, RayObj> = {};
    for (const [k, v] of w.cells) cells.set(k, v);
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const P = 1 + 2 * m.id, S = P + 1;
      objs[P] = { kind: 'mon', gfx: m.gfx, b2: m.b2, hp: m.hp, S, next: w.w(P, 0x12) };
      objs[S] = { kind: 'sec', maxHp: m.maxHp, w6: m.xpBase, pos: m.pos, alert: w.b(S, 0x12), b0A: m.sb0a ?? 0 };
    }
    for (const [id] of w.objs) if (id >= 500) objs[id] = { kind: 'str', b5: w.b(id, 5), wA: w.w(id, 0xa), wC: w.w(id, 0xc), w10: w.w(id, 0x10), b0F: w.b(id, 0xf), next: w.w(id, 0x12) };
    return { cells, objs, px: this.px + OFF, py: this.py + OFF, facing: this.facing, item36: false, b1E5C: 0, chars: this.chars.map(ch => ({ hp: ch.hp, xp: ch.xp })) };
  }

  /** Player swing [H meleeAttack + weaponInfo + pickSquareTargets; C costs and cooldown]. Attacks the first monster the target pick finds on the square in front. */
  private swing(k: number) {
    const c = this.chars[k];
    if (c.hp <= 0 || this.tick < c.readyAt) return;
    const [fx, fy] = this.frontSquare();
    const rw = this.rayWorld();
    const id = pickSquareTargets(rw, fx + OFF, fy + OFF)[0];
    const m = id ? this.monsters[(id - 1) >> 1] : undefined;
    if (!m) return;
    const info = weaponInfo({ cls: c.cls, level: c.level, gfx: c.weapon.gfx, extra: c.weapon.extra, monType: m.monType, activeItem36Gfx: 0 }, this.cfg.weaponBase);
    if (!info) return;
    const r = meleeAttack({ level: c.level, str: c.str, b6c: c.b6c, monHit: m.b2, monHp: m.hp, info, item: c.weapon.gfx === 0 ? 0 : 1 }, this.cfg.tables, this.rng);
    m.hp = r.monHp;
    this.adjustVitals(k, -4, -2, -1);
    // cooldown event 0x14 / 0x15 length: max(5, T3[DEX] + weight/23) ticks [C]; the weight term is not modelled (no inventory)
    c.readyAt = this.tick + Math.max(5, this.cfg.tables.speedT3[Math.max(0, Math.min(30, c.dex))]);
    this.bossHold(m);
    this.log.push({ t: this.tick, ev: 'swing', char: k, hit: r.hit, dmg: r.damage, monster: m.id, monHp: m.hp });
    if (m.hp < 1) this.monsterDies(m);
  }

  /** Player ray spell without a memorised slot [H castRay / marchRay / RAY_SPELLS]. */
  private ray(k: number, spell: number) {
    const c = this.chars[k], fn = RAY_SPELLS[spell];
    if (!fn || c.hp <= 0) return;
    const p = fn(casterValues({ cls: c.cls, level: c.level, b6a: 0, w65: c.wis, w66: c.int } as never, this.cfg.tables));
    const w = this.rayWorld();
    const r = castRay(w, { mag: p.mag, dmg: p.dmg, base: 0, pre: p.pre, range: p.range }, this.rng, awardXp);
    this.applyRay(k, spell, w, r);
  }

  private applyRay(k: number, spell: number, w: RayWorld, r: { total: number; hits: { id: number; dmg: number; killed: boolean }[] }) {
    this.chars.forEach((ch, i) => { ch.xp = w.chars[i].xp; });
    const hits = r.hits.map(h => ({ monster: (h.id - 1) >> 1, dmg: h.dmg, killed: h.killed }));
    for (const h of hits) { const m = this.monsters[h.monster]; m.hp = w.objs[1 + 2 * h.monster].hp!; this.bossHold(m); this.mw.setB(2 + 2 * h.monster, 0x12, w.objs[2 + 2 * h.monster].alert!); }
    this.log.push({ t: this.tick, ev: 'ray', char: k, spell, total: r.total, hits });
    for (const h of hits) if (h.killed) this.finishKill(this.monsters[h.monster]);
  }

  /** after a spell kill: XP was already awarded by the harnessed routine; this removes the monster and runs the level-up checks [H] */
  private finishKill(m: SimMonster) {
    this.removeMonster(m);
    this.chars.forEach((c, k) => { if (c.hp > 0) { const lv = c.level; levelUp(c, this.cfg.tables, this.rng); if (c.level !== lv) this.log.push({ t: this.tick, ev: 'levelup', char: k, level: c.level }); } });
    this.log.push({ t: this.tick, ev: 'monster-dead', monster: m.id, xp: [] });
  }

  private removeMonster(m: SimMonster) {
    if (m.alive) removeFromSquare(this.mw, 1 + 2 * m.id, m.x + OFF, m.y + OFF);
    m.alive = false;
    this.events = this.events.filter(e => e.type !== 1 || e.monster !== m.id);
  }

  /** +0x7F2E in the monster-death routine [H through castRay's bossStage, C for the melee path]: the boss (gfx 0x80C5) never drops below 49 hp and starts stage 1 */
  private bossHold(m: SimMonster) {
    if (m.gfx === 0x80c5 && m.hp < 50) { if (this.a1a1e === 0) this.a1a1e = 1; m.hp = 49; }
  }

  /** Monster death (S_1 +0x7ED0) [H awardXp + levelUp]; carried chain drops on the square [C]. */
  private monsterDies(m: SimMonster) {
    this.removeMonster(m);
    const before = this.chars.map(c => c.xp);
    const xps = awardXp(this.chars.map(c => ({ hp: c.hp, xp: c.xp })), { b2: m.b2, w6: m.xpBase, maxHp: m.maxHp }, this.rng);
    this.chars.forEach((c, k) => {
      c.xp = xps[k];
      if (c.hp > 0) {
        const lv = c.level;
        levelUp(c, this.cfg.tables, this.rng);
        if (c.level !== lv) this.log.push({ t: this.tick, ev: 'levelup', char: k, level: c.level });
      }
    });
    this.log.push({ t: this.tick, ev: 'monster-dead', monster: m.id, xp: xps.map((x, k) => x - before[k]) });
  }

  // ---------------------------------------------------------------- monsters

  private actEnv(): ActEnv {
    return {
      party: { x: this.px + OFF, y: this.py + OFF, facing: this.facing }, form: this.formation,
      chars: this.chars.map(c => ({ hp: c.hp, ac: (c.ac << 24) >> 24, res: c.resist, shield: c.shield83 ?? 0, ice: c.ice8d ?? 0, fire: c.fire8e ?? 0 })),
      lastDist: this.mw.lastDist, stackJunk: 0,
    };
  }

  /** apply the calls a harnessed monster routine made (damage = DamageCharacter, hold = +0x58FA [C: A4+0x1756 += n]) */
  private applyCalls(m: SimMonster, calls: MoveCall[]) {
    for (const c of calls) {
      if (c.fn === 'damage') { this.log.push({ t: this.tick, ev: 'monster-hit', monster: m.id, char: c.ch, dmg: c.dmg, kind: c.kind }); this.damage(c.ch, c.dmg, c.kind); }
      else if (c.fn === 'hold') { this.hold += c.n; this.log.push({ t: this.tick, ev: 'hold', monster: m.id, ticks: c.n }); }
      else if (c.fn === 'special') this.log.push({ t: this.tick, ev: 'special', monster: m.id, bit: c.bit }); // [h] possession / stone: harnessed in rules-spell.ts (monsterPossessStone) but not applied here
      // 'openDoor' (+0x9056): the sim has no doors; 'sched' / 'ev': the act cooldown is the VM's own reschedule
    }
  }

  /** Activation scan (+0xB614, monster half) [H]: wakes monsters with a path shorter than 5 squares, parks the others in movement type 10. */
  private scan() {
    this.loadAll();
    const before = this.monsters.map(m => m.moveType);
    const evs = activationScan(this.mw, this.tick, this.rng);
    this.mw.log.length = 0;
    this.storeAll();
    for (const e of evs) {
      const m = this.monsters[(e.id - 1) >> 1];
      this.events.push({ due: e.due, seq: this.seq++, type: 1, monster: m.id });
      this.log.push({ t: this.tick, ev: 'activate', monster: m.id, kind: m.moveType === 10 && before[m.id] !== 10 ? 'park' : 'wake' });
    }
  }

  private runMonster(m: SimMonster) {
    if (m.gfx === 0x80c5 && this.a1a1e >= 3) this.a1a1e = 2; // +0xAB5E: the boss's behaviour VM resets stages 3 / 4 to 2 [H via the 68k, boss state C]
    this.loadAll();
    const w = this.mw, P = 1 + 2 * m.id;
    const pos = { x: m.x + OFF, y: m.y + OFF };
    const drain = () => this.applyCalls(m, w.log.splice(0));
    const vm: VmMonster = { gfx: m.gfx, b3: m.b3, b5: m.b5, b7: m.b7, hp: m.hp, w0c: m.w0c, type: m.moveType, pc: m.pc, maxHp: m.maxHp, s0e: m.s0e, vars: m.vars };
    // the flee step of the type-10 script asks the pathfinder (+0x866C) whether a path exists; the result is read from A4+0x1E8F
    const a1e8e = m.moveType === 10 ? pathfind(w, P, pos.x, pos.y, w.party.x, w.party.y).result : 0;
    const world = { px: this.px + OFF, py: this.py + OFF, x: pos.x, y: pos.y, hookRet: 0, tick: this.tick, a1e8e };
    const onCall = (c: VmCall, vmm: VmMonster) => {
      // mirror the VM's live state into the records the routine reads, run it, then hand back what it wrote [the original VM works on the records directly]
      m.s0e = vmm.s0e; m.vars = vmm.vars; m.hp = vmm.hp; m.b7 = vmm.b7; m.pc = vmm.pc; m.maxHp = vmm.maxHp; m.gfx = vmm.gfx; m.moveType = vmm.type;
      this.load(m);
      let res = 0;
      if (c.off === VM_CALLS.attack) res = moveAct(w, P, pos, c.w5 ?? 4, 1, this.actEnv(), this.rng).ret;
      else if (c.off === VM_CALLS.move) res = pursue(w, P, pos, c.w5 ?? 4, this.actEnv(), this.rng);
      else if (c.off === VM_CALLS.spell) res = approach(w, P, pos, c.w5 ?? 0xb, this.actEnv(), this.rng);
      else if (c.off === VM_CALLS.special) res = wander(w, P, pos, this.rng);
      const nx = pos.x - OFF, ny = pos.y - OFF;
      if (nx !== m.x || ny !== m.y) { m.x = nx; m.y = ny; this.log.push({ t: this.tick, ev: 'step', monster: m.id, x: nx, y: ny }); }
      drain();
      this.store(m);
      return { res, x: pos.x, y: pos.y, s0e: m.s0e, vars: m.vars.slice(0, 5), hp: m.hp, b7: m.b7 };
    };
    const r = runBehaviour(vm, world, this.cfg.scripts, this.rng, hpAtLeastMorale, m.id, onCall);
    m.pc = r.m.pc; m.s0e = r.m.s0e; m.vars = r.m.vars; m.moveType = r.m.type; m.gfx = r.m.gfx; m.b7 = r.m.b7; m.hp = r.m.hp; m.maxHp = r.m.maxHp;
    m.x = pos.x - OFF; m.y = pos.y - OFF;
    if (r.event) this.events.push({ due: r.event.due, seq: this.seq++, type: 1, monster: m.id });
  }

  // ---------------------------------------------------------------- party spells

  private spChars(): SpChar[] {
    return this.chars.map(c => ({
      cls: c.cls, level: c.level, b6a: 0, w65: c.wis, w66: c.int, hp: c.hp, maxHp: c.maxHp, ac: c.ac, str: c.str, poison: c.poison, disease: c.disease,
      food: c.food, water: c.water, acCnt: c.acCnt ?? 0, strCnt: c.strCnt ?? 0, wizCnt: c.wizCnt ?? 0, detCnt: c.detCnt ?? 0, res: c.resist, slots: c.slots!, xp: c.xp,
    }));
  }

  private memorise(k: number, row: number) {
    const c = this.chars[k];
    if (!this.book || c.hp <= 0) return;
    const ch = { cls: c.cls, level: c.level, b6b: 0, w65: c.wis, w66: c.int, cur: c.page ?? 0, slots: c.slots! };
    const before = [...c.slots!];
    const r = memoriseClick(this.book, ch, row, this.cfg.tables.defenseT2);
    if (r.memorised !== null && before.join() !== c.slots!.join()) this.log.push({ t: this.tick, ev: 'memorise', char: k, spell: r.memorised });
  }

  private antimagic(): boolean { return ((this.mw.cell(this.px + OFF, this.py + OFF) >>> 30) & 1) === 1; }

  /** Cast the memorised spell in `slot` [H castSpell for rays and the 20 simple spells; castFacing for DISMISS / BINDING; castRefresh for REFRESH]. */
  private cast(k: number, slot: number, pick: number) {
    const c = this.chars[k];
    if (c.hp <= 0 || slot < 0 || slot > 4) return;
    const spell = c.slots![slot];
    if (spell === 0xff) return;
    const supported = RAY_SPELLS[spell] !== undefined || SIMPLE_SPELLS.has(spell) || spell === 34 || spell === 43 || (spell === 46 && !!this.book);
    if (!supported) return; // [open] RAISE DEAD, TELEPORT, CREATE FOOD, REVEAL TRUTH, REMOVE GLYPH, DISPEL MAGIC, REMOVE TRAP, CREATE WALL, READ RUNE
    let spent = true;
    if (spell === 34 || spell === 43) {
      const rw = Object.assign(this.rayWorld(), { level: c.level, tick: this.tick });
      if (!this.antimagic()) {
        const r = castFacing(rw, spell, this.rng, awardXp);
        this.chars.forEach((ch, i) => { ch.xp = rw.chars[i].xp; });
        for (const id of r.cancelled) this.events = this.events.filter(e => !(e.type === 1 && e.monster === ((id - 1) >> 1)));
        for (const s of r.sched) this.events.push({ due: this.tick + 200, seq: this.seq++, type: 1, monster: (s.id - 1) >> 1 });
        for (const id of r.killed) { const m = this.monsters[(id - 1) >> 1]; m.hp = 0; this.finishKill(m); }
        for (const [id, o] of Object.entries(rw.objs)) if (o.kind === 'sec') this.mw.setB(+id, 0x12, o.alert!);
      }
    } else if (spell === 46) {
      castRefresh(this.book!, c.firstPage ?? 0, this.cfg.spells!.pageNext);
    } else {
      const rw = this.rayWorld();
      const sp = this.spChars();
      const w: SpFull = {
        chars: sp, active: k, formation: this.formation, tick: this.tick, light: this.light, hold: this.hold,
        compass: this.compass, wizSight: this.wizSight, detect: this.detect, haste: this.haste, events: [],
        ray: rw, antimagic: this.antimagic(),
      };
      const r = castSpell(w, spell, pick, this.cfg.tables, this.rng, awardXp);
      spent = r.spent;
      this.chars.forEach((ch, i) => {
        const s = sp[i];
        ch.hp = s.hp; ch.ac = s.ac; ch.str = s.str; ch.poison = s.poison; ch.disease = s.disease; ch.food = s.food; ch.water = s.water;
        ch.acCnt = s.acCnt; ch.strCnt = s.strCnt; ch.wizCnt = s.wizCnt; ch.detCnt = s.detCnt; ch.xp = s.xp ?? ch.xp;
      });
      this.light = w.light; this.compass = w.compass; this.wizSight = w.wizSight; this.detect = w.detect; this.haste = w.haste;
      for (const e of w.events) this.events.push({ due: e.due, seq: this.seq++, type: e.type, monster: -1, ev: e });
      if (r.ray) this.applyRay(k, spell, rw, { total: r.ray.total, hits: r.ray.hits });
    }
    if (spent) { c.slots!.splice(slot, 1); c.slots!.push(0xff); } // +0x4876: the later slots shift down [C]
    this.log.push({ t: this.tick, ev: 'cast', char: k, spell, spent });
  }

  /** PROTECTOR / SOULFREEZER / VORTEX [H rules-boss.ts ramBossItem, 900 / 900 against the 68k]: applies the stage change, alert bump, resistance and event calls. */
  private plotItem(fx: 'prot' | 'sf' | 'vx') {
    const rw = this.rayWorld();
    const wall = ((this.mw.cell(this.px + OFF, this.py + OFF) >>> (12 + this.facing)) & 1) === 1;
    const r = ramBossItem(fx, { stage: this.a1a1e, tick: this.tick, px: this.px + OFF, py: this.py + OFF, facing: this.facing, wall, world: rw, chars: this.chars.map(c => ({ hp: c.hp, res: c.resist & 0xff })) });
    this.a1a1e = r.stage;
    this.chars.forEach((c, k) => { c.resist = (r.res[k] << 24) >> 24; });
    for (const [S, al] of Object.entries(r.alert)) this.mw.setB(+S, 0x12, al);
    for (const call of r.calls) {
      if (call.fn === 'cancelType') this.events = this.events.filter(e => e.type !== call.type);
      else if (call.fn === 'cancelEvents') this.events = this.events.filter(e => !(e.type === 1 && e.monster === ((call.id! - 1) >> 1)));
      else if (call.fn === 'sched') {
        if (call.type === 0x25) this.events.push({ due: call.due!, seq: this.seq++, type: 0x25, monster: -1, ev: { type: 0x25, due: call.due!, a1: 0, a2: 0, a3: 0 } });
        else this.events.push({ due: call.due!, seq: this.seq++, type: 1, monster: (call.id! - 1) >> 1 });
      }
    }
    for (const S of r.clearB0a) this.monsters[(S - 2) >> 1].sb0a = 0;
  }

  /**
   * Buff-expiry handlers, event types 0x1E-0x25 [H applyExpiry, the real handlers of the tick handler's due-event dispatch, 600 / 600 against the 68k]:
   * the sim state is mirrored into the A4 bytes the handler reads, the handler runs, and the changed fields are read back.
   */
  private expire(e: SpEvent) {
    const a = new A4Mem(), CH = (k: number) => 0x1758 + 0xa8 * k;
    a.setW(0x174a, 1);
    this.chars.forEach((c, k) => {
      a.setW(CH(k) + 0x4e, c.hp); a.setB(CH(k) + 0x62, c.ac); a.setB(CH(k) + 0x64, c.str); a.setB(CH(k) + 0x69, c.resist);
      a.setB(CH(k) + 0x82, c.acCnt ?? 0); a.setB(CH(k) + 0x78, c.strCnt ?? 0); a.setB(CH(k) + 0x85, c.wizCnt ?? 0); a.setB(CH(k) + 0x84, c.detCnt ?? 0);
    });
    a.setW(0x1e28, this.compass); a.setW(0x1e2a, this.wizSight); a.setW(0x1e2c, this.detect); a.setW(0x1e2e, this.haste); a.setW(0x1a1e, this.a1a1e);
    applyExpiry(a, e);
    this.chars.forEach((c, k) => {
      c.ac = a.sb(CH(k) + 0x62); c.str = a.b(CH(k) + 0x64); c.resist = a.sb(CH(k) + 0x69);
      c.acCnt = a.b(CH(k) + 0x82); c.strCnt = a.b(CH(k) + 0x78); c.wizCnt = a.b(CH(k) + 0x85); c.detCnt = a.b(CH(k) + 0x84);
    });
    this.compass = a.w(0x1e28); this.wizSight = a.w(0x1e2a); this.detect = a.w(0x1e2c); this.haste = a.w(0x1e2e); this.a1a1e = a.w(0x1a1e);
    this.log.push({ t: this.tick, ev: 'expire', type: e.type, char: e.a1 });
  }

  /**
   * One game tick (S_1 +0x08B2) [C ordering]: counter, light / hold, periodic vitals block [H], spell recharge [H], due events [C: ordered by due time;
   * ties are insertion order, read from ScheduleEvent +0x5EA which inserts after every node whose due time is <= the new one].
   * The party commands of this tick run first (input is processed by the main loop before the idle event). While the party is held
   * (A4+0x1756 > 0) commands are ignored [C, input dispatcher +0xD6D8; the click whitelist is not modelled].
   */
  step1(cmds: SimCmd[] = []) {
    if (this.gameOver) return;
    if (this.hold === 0) for (const cmd of cmds) this.command(cmd);
    this.tick++;
    const v = vitalsTick({
      t: this.tick, resting: this.resting, hazard: this.hazard, light: this.light, hold: this.hold,
      chars: this.chars.map(c => ({ hp: c.hp, maxHp: c.maxHp, level: c.level, food: c.food, water: c.water, poison: c.poison, disease: c.disease, regen: c.regen, prot86: c.prot86, state: c.resting ? 1 : 0 })),
    }, this.rng);
    this.light = v.light; this.hold = v.hold;
    this.chars.forEach((c, k) => { if (c.hp > 0) c.hp = v.hp[k]; });
    for (const call of v.calls) {
      if (call.kind === 'adjust') this.adjustVitals(call.char, call.energy, call.food, call.water);
      else if (call.kind === 'damage') this.damage(call.char, call.dmg, call.type);
      else if (call.kind === 'scan') this.scan();
    }
    if (this.book) rechargeTick(this.book, { resting: this.resting, showActive: false, openPage: 0xff, mem: this.rechargeMem() });
    for (;;) {
      this.events.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const e = this.events[0];
      if (!e || e.due > this.tick) break;
      this.events.shift();
      if (this.gameOver) break;
      if (e.type === 1) { const m = this.monsters[e.monster]; if (m && m.alive) this.runMonster(m); }
      else if (e.ev) this.expire(e.ev);
    }
  }

  /** A4+0x19F8..: page owner words (page n owned by character n % 4 here) and the per-character resting state bytes the recharge section reads */
  private rechargeMem(): number[] {
    const mem = new Array(0x1a0b - 0x19f8).fill(0);
    for (let p = 0; p < 15; p++) { mem[2 * p] = 0; mem[2 * p + 1] = p % 4; }
    this.chars.forEach((c, k) => { mem[0x1a07 - 0x19f8 + k] = c.resting ? 1 : 0; });
    return mem;
  }

  private command(cmd: SimCmd) {
    switch (cmd.kind) {
      case 'attack': this.swing(cmd.char); break;
      case 'turn': this.facing = (this.facing + 4 + cmd.by) & 3; this.chars.forEach((_, k) => this.adjustVitals(k, -1, -1, -1)); break; // [C] +0x1702A
      case 'move': {
        const [dx, dy] = DIRS[cmd.dir === 'forward' ? this.facing : (this.facing + 2) & 3];
        if (this.free(this.px + dx, this.py + dy)) {
          this.px += dx; this.py += dy;
          this.chars.forEach((_, k) => this.adjustVitals(k, -1, -1, -1)); // [C] +0x16CC4 (weight term not modelled)
        }
        break;
      }
      case 'ray': this.ray(cmd.char, cmd.spell); break;
      case 'memorise': this.memorise(cmd.char, cmd.row); break;
      case 'cast': this.cast(cmd.char, cmd.slot, cmd.pick ?? 0); break;
      case 'plotItem': this.plotItem(cmd.fx); break;
      case 'rest': this.resting = cmd.on; this.chars.forEach(c => { c.resting = cmd.on; }); break;
      case 'wait': break;
    }
  }

  run(ticks: number, plan: (sim: CombatSim) => SimCmd[] = () => []) {
    for (let i = 0; i < ticks && !this.gameOver; i++) this.step1(plan(this));
    return this;
  }
}

/** Reasonable default party: the four fixed classes at level 1 with the stats of docs section 1.3 (start values, no spare points). */
export function startingParty(t: RuleTables): SimChar[] {
  const stats = [[14, 8, 6, 12, 10], [12, 8, 14, 6, 10], [8, 14, 6, 12, 10], [6, 8, 12, 10, 14]]; // STR INT WIS DEX CON
  return ['FIGHTER', 'CLERIC', 'MAGIC USER', 'DRUID'].map((name, cls) => {
    const [str, int, wis, dex, con] = stats[cls];
    return {
      name, cls, level: 1, xp: 0, hp: 20, maxHp: 20, str, dex, con, int, wis,
      ac: t.statBonusT1[dex] + 6 + 2, resist: 0,
      food: 5000, water: 5000, energy: 10000, poison: 0, disease: 0,
      regen: 0, prot86: 0, sustain: 0, weapon: { gfx: 0, extra: 0 }, b6c: 0, resting: false, readyAt: 0, tired: false,
    };
  });
}
