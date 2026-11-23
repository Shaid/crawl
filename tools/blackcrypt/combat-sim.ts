/**
 * Black Crypt (Amiga): headless combat tick loop. An executable form of
 * docs/blackcrypt/amiga/game-rules.md section 9. It composes the pieces that are verified against the game's own
 * 68k code (rules.ts, rules-monster.ts) and marks everything that is not.
 *
 * Evidence labels used in comments:
 *   [H] the piece is a harness-verified port (player melee, monster melee, behaviour VM, XP, level-up, vitals tick, special attacks)
 *   [C] read from code, not executed in the harness (DamageCharacter, AdjustVitals, event ordering, swing cooldown, per-step costs)
 *   [h] hypothesis / simplification (greedy monster step instead of the real pathfinder +0x866C, no ranged spells, no spells on the party side)
 *
 * Original code. The model is deliberately small: a rectangular map with blocked squares, four party members
 * (slot = class), any number of monsters (one per square), real-time ticks, scripted party commands.
 */
import { BcRng, levelUp, meleeAttack, weaponInfo, type RuleTables, type WeaponBase } from './rules';
import {
  awardXp, hpAtLeastMorale, monsterMelee, runBehaviour, vitalsTick, VM_CALLS,
  type AiScripts, type VmMonster, type VmCall,
} from './rules-monster';

/** 1 tick = 8 vblanks at 50 Hz (160 ms) or 10 vblanks at 60 Hz (166.7 ms): game-rules.md section 8.7 (harness on the arithmetic, code on the wiring). */
export const TICK_MS = { pal: 160, ntsc: 1000 / 6 } as const;

export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // dir 0..3 as used by the monster act code (S_1 +0x9D28)

export interface SimChar {
  name: string;
  cls: number; level: number; xp: number;
  hp: number; maxHp: number;
  str: number; dex: number; con: number;
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
}

export interface SimEvent { due: number; seq: number; type: 1; monster: number }

export interface SimConfig {
  tables: RuleTables; weaponBase: WeaponBase; scripts: AiScripts;
  seed: string;
  width: number; height: number;
  /** blocked squares as "x,y" */
  blocked: string[];
  party: SimChar[];
  /** formation: slot -> char index (A4+0x1E74) */
  formation?: number[];
  px: number; py: number; facing: number;
  monsters: SimMonster[];
  /** hazard square under the party (square flag bit 31) */
  hazard?: boolean;
}

export type SimCmd =
  | { kind: 'attack'; char: number }
  | { kind: 'move'; dir: 'forward' | 'back' }
  | { kind: 'turn'; by: 1 | -1 }
  | { kind: 'rest'; on: boolean }
  | { kind: 'wait' };

export type LogEntry =
  | { t: number; ev: 'swing'; char: number; hit: boolean; dmg: number; monster: number; monHp: number }
  | { t: number; ev: 'monster-hit'; monster: number; char: number; dmg: number }
  | { t: number; ev: 'damage'; char: number; dmg: number; kind: number; hp: number }
  | { t: number; ev: 'death'; char: number }
  | { t: number; ev: 'monster-dead'; monster: number; xp: number[] }
  | { t: number; ev: 'levelup'; char: number; level: number }
  | { t: number; ev: 'step'; monster: number; x: number; y: number }
  | { t: number; ev: 'game-over' };

export class CombatSim {
  tick = 0;
  rng: BcRng;
  chars: SimChar[];
  monsters: SimMonster[];
  px: number; py: number; facing: number;
  formation: number[];
  light = 0; hold = 0;
  resting = false;
  hazard: boolean;
  gameOver = false;
  log: LogEntry[] = [];
  events: SimEvent[] = [];
  private seq = 0;
  private blocked: Set<string>;
  cfg: SimConfig;
  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = new BcRng(cfg.seed);
    this.chars = cfg.party.map(c => ({ ...c, weapon: { ...c.weapon } }));
    this.monsters = cfg.monsters.map((m, i) => ({ ...m, id: i, vars: [...m.vars], loot: [...m.loot] })); // id == index
    this.px = cfg.px; this.py = cfg.py; this.facing = cfg.facing;
    this.formation = cfg.formation ?? [0, 1, 2, 3];
    this.hazard = !!cfg.hazard;
    this.blocked = new Set(cfg.blocked);
    for (const m of this.monsters) if (m.alive) this.schedule(m.id, 1);
  }

  private schedule(monster: number, delay: number) { this.events.push({ due: this.tick + delay, seq: this.seq++, type: 1, monster }); }
  private free(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.cfg.width || y >= this.cfg.height) return false;
    if (this.blocked.has(`${x},${y}`)) return false;
    if (x === this.px && y === this.py) return false;
    return !this.monsters.some(m => m.alive && m.x === x && m.y === y); // [h] one monster per square here; the real game stacks up to 5 by position (open)
  }
  alive(k: number) { return this.chars[k].hp > 0; }

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

  /** Player swing [H meleeAttack + weaponInfo; C costs and cooldown]. Attacks the monster on the square in front. */
  private swing(k: number) {
    const c = this.chars[k];
    if (c.hp <= 0 || this.tick < c.readyAt) return;
    const [fx, fy] = this.frontSquare();
    const m = this.monsters.find(mm => mm.alive && mm.x === fx && mm.y === fy);
    if (!m) return;
    const info = weaponInfo({ cls: c.cls, level: c.level, gfx: c.weapon.gfx, extra: c.weapon.extra, monType: m.monType, activeItem36Gfx: 0 }, this.cfg.weaponBase);
    if (!info) return;
    const r = meleeAttack({ level: c.level, str: c.str, b6c: c.b6c, monHit: m.b2, monHp: m.hp, info, item: c.weapon.gfx === 0 ? 0 : 1 }, this.cfg.tables, this.rng);
    m.hp = r.monHp;
    this.adjustVitals(k, -4, -2, -1);
    // cooldown event 0x14 / 0x15: max(5, T3[DEX] + weight/23) ticks [C]; weight is not modelled (0)
    c.readyAt = this.tick + Math.max(5, this.cfg.tables.speedT3[Math.max(0, Math.min(30, c.dex))]);
    this.log.push({ t: this.tick, ev: 'swing', char: k, hit: r.hit, dmg: r.damage, monster: m.id, monHp: m.hp });
    if (m.hp < 1) this.monsterDies(m);
  }

  /** Monster death (S_1 +0x7ED0) [H awardXp + levelUp]; carried chain drops on the square [C]. */
  private monsterDies(m: SimMonster) {
    m.alive = false;
    this.events = this.events.filter(e => e.monster !== m.id);
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

  /** Greedy pursuit step [h]: the real pathfinder (+0x866C) searches 3*(speedIdx+1) squares; this takes the dominant axis, then the other. */
  private step(m: SimMonster): boolean {
    const dx = this.px - m.x, dy = this.py - m.y;
    const cand: number[] = [];
    const ax = dx > 0 ? 1 : dx < 0 ? 3 : -1, ay = dy > 0 ? 0 : dy < 0 ? 2 : -1;
    if (Math.abs(dx) >= Math.abs(dy)) cand.push(ax, ay); else cand.push(ay, ax);
    for (const d of cand) {
      if (d < 0) continue;
      const [sx, sy] = DIRS[d];
      if (this.free(m.x + sx, m.y + sy)) { m.x += sx; m.y += sy; this.log.push({ t: this.tick, ev: 'step', monster: m.id, x: m.x, y: m.y }); return true; }
    }
    return false;
  }

  private monsterAct(m: SimMonster, op: number): number {
    // ranged / spell monsters [h]: not modelled (the ranged branch of +0x9D28 is code-read only), they do nothing
    if ((m.b6 & 4) !== 0) return 0;
    const mi = {
      gfx: m.gfx, b2: m.b2, b3: m.b3, b6: m.b6, maxHp: m.maxHp, px: this.px, py: this.py, mx: m.x, my: m.y,
      facing: this.facing, pos: m.pos, op, flag: 1, form: this.formation,
      hp: this.chars.map(c => c.hp), ac: this.chars.map(c => c.ac), s0f: 1,
    };
    const r = monsterMelee(mi, this.rng);
    for (const [k, dmg] of r.dmg) { this.log.push({ t: this.tick, ev: 'monster-hit', monster: m.id, char: k, dmg }); this.damage(k, dmg, 4); }
    return r.ret;
  }

  private runMonster(m: SimMonster) {
    const vm: VmMonster = { gfx: m.gfx, b3: m.b3, b5: m.b5, b7: m.b7, hp: m.hp, w0c: m.w0c, type: m.moveType, pc: m.pc, maxHp: m.maxHp, s0e: m.s0e, vars: m.vars };
    const world = { px: this.px, py: this.py, x: m.x, y: m.y, hookRet: 0, tick: this.tick, a1e8e: 0 };
    const onCall = (c: VmCall) => {
      if (c.off === VM_CALLS.attack) return this.monsterAct(m, c.w5 ?? 4);
      if (c.off === VM_CALLS.move) { // pursuit +0xA664: attack when adjacent, else step [h]
        const dist = Math.abs(this.px - m.x) + Math.abs(this.py - m.y);
        if (dist === 1) return { res: this.monsterAct(m, c.w5 ?? 4), x: m.x, y: m.y };
        this.step(m);
        return { res: 0, x: m.x, y: m.y };
      }
      return 0;
    };
    const r = runBehaviour(vm, world, this.cfg.scripts, this.rng, hpAtLeastMorale, m.id, onCall);
    m.pc = r.m.pc; m.s0e = r.m.s0e; m.vars = r.m.vars; m.moveType = r.m.type; m.gfx = r.m.gfx; m.b7 = r.m.b7; m.hp = r.m.hp; m.maxHp = r.m.maxHp;
    if (r.event) this.events.push({ due: r.event.due, seq: this.seq++, type: 1, monster: m.id });
  }

  /**
   * One game tick (S_1 +0x08B2) [C ordering]: counter, light / hold, periodic vitals block [H], due events (monster acts, [C] ordered by due then insertion).
   * The party commands of this tick run first (input is processed by the main loop before the idle event).
   */
  step1(cmds: SimCmd[] = []) {
    if (this.gameOver) return;
    for (const cmd of cmds) this.command(cmd);
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
      // 'scan' = monster generator scan (+0xB614): not modelled here [h]
    }
    // due events in order
    for (;;) {
      this.events.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const e = this.events[0];
      if (!e || e.due > this.tick) break;
      this.events.shift();
      const m = this.monsters[e.monster];
      if (m && m.alive && !this.gameOver) this.runMonster(m);
    }
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
    const [str, , , dex, con] = stats[cls];
    return {
      name, cls, level: 1, xp: 0, hp: 20, maxHp: 20, str, dex, con,
      ac: t.statBonusT1[dex] + 6 + 2, resist: 0,
      food: 5000, water: 5000, energy: 10000, poison: 0, disease: 0,
      regen: 0, prot86: 0, sustain: 0, weapon: { gfx: 0, extra: 0 }, b6c: 0, resting: false, readyAt: 0, tired: false,
    };
  });
}
