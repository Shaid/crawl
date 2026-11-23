/**
 * Black Crypt (Amiga) monster-side rules: the behaviour bytecode VM (S_1 +0xAAFC),
 * monster-vs-party melee (S_1 +0x9D28, melee path), monster-death XP (S_1 +0x7ED0).
 * Original TypeScript; each function is diffed against the game's own 68k code run in
 * musashi (tools/blackcrypt/rules_oracle, vectors.json). See docs/blackcrypt/amiga/game-rules.md.
 */
import { BcRng } from './rules';

// ---------------------------------------------------------------- scripts

/** One 6-byte VM cell: op, a, w1, w2 (S_2 +0xE92 .. +0x1149, 116 cells). */
export type Cell = [op: number, a: number, w1: number, w2: number];

export interface AiScripts {
  /** all cells, in S_2 order */
  cells: Cell[];
  /** movement type (monster record word +0xE, 0..11) -> index of the script's header cell in `cells` */
  starts: number[];
}

const OP_NAMES: Record<number, string> = {
  0x02: 'ACT_MELEE', 0x03: 'ACT_RANGED', 0x04: 'ACT_ANY', 0x05: 'WAIT', 0x06: 'WAIT_SPEED', 0x09: 'STEP_RANDOM',
  0x0a: 'TELEPORT', 0x0b: 'ACT_SPELL', 0x0d: 'HEAL', 0x0e: 'GOTO', 0x10: 'VAR_SET', 0x12: 'VAR_ADD', 0x13: 'VAR_SUB',
  0x14: 'HEADER_A', 0x15: 'HEADER_B', 0x16: 'IF_HP_OK', 0x19: 'IF_NOT_ADJACENT', 0x1c: 'IF_DIST', 0x1d: 'IF_VAR',
  0x1e: 'ACT_SPECIAL', 0x21: 'STEAL', 0x22: 'TRANSFORM', 0x24: 'SET_HP', 0x27: 'MESSAGE', 0x28: 'MARK_A', 0x29: 'MARK_B',
  0x2b: 'WAIT_DOUBLE', 0xff: 'FLEE_TICK',
};
export const aiOpName = (op: number) => OP_NAMES[op] ?? `OP_${op.toString(16)}`;

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/**
 * Read the behaviour scripts out of the decompressed S_2 image. The 12 script pointers at
 * S_2 +0x114A are 0x80 bytes LOW in the image (relocation base of the extraction emulator
 * is 0x80 off); with +0x80 every pointer lands on a header cell and the cell block ends
 * exactly at the pointer table.
 */
export function extractAiScripts(s2: Uint8Array): AiScripts {
  const FIRST = 0xe92, TABLE = 0x114a, S2_BASE = 0xa8bf0, FIX = 0x80;
  const cells: Cell[] = [];
  for (let o = FIRST; o < TABLE; o += 6) cells.push([s2[o], s2[o + 1], u16(s2, o + 2), u16(s2, o + 4)]);
  const starts: number[] = [];
  for (let i = 0; i < 12; i++) starts.push((u32(s2, TABLE + 4 * i) - S2_BASE + FIX - FIRST) / 6);
  return { cells, starts };
}

/** Human-readable listing, one script per distinct start. */
export function listScripts(sc: AiScripts): { type: number[]; start: number; cells: { pc: number; op: string; a: number; w1: number; w2: number }[] }[] {
  const uniq = [...new Set(sc.starts)].sort((a, b) => a - b);
  return uniq.map((s, i) => {
    const end = uniq[i + 1] ?? sc.cells.length;
    return {
      type: sc.starts.map((v, t) => (v === s ? t : -1)).filter(t => t >= 0),
      start: s,
      cells: sc.cells.slice(s, end).map((c, pc) => ({ pc, op: aiOpName(c[0]), a: c[1], w1: c[2], w2: c[3] })),
    };
  });
}

// ---------------------------------------------------------------- VM

export interface VmMonster {
  /** primary record */
  gfx: number; b3: number; b5: number; b7: number; hp: number; w0c: number; type: number;
  /** secondary record */
  pc: number; maxHp: number; s0e: number; vars: number[]; /* S+0xF+i; vars[2]/vars[3] double as saved movement type / flee counter (S+0x11/0x12), vars[4] (S+0x13) is the 'event pending' flag */
}
export interface VmWorld { px: number; py: number; x: number; y: number; hookRet: number; tick: number; a1e8e: number; }
export interface VmEvent { type: number; due: number; a1: number; a2: number }
export interface VmResult { ops: Set<number>; m: VmMonster; calls: { off: number; w0?: number; w5?: number }[]; event: VmEvent | null; clearedActive: boolean }

/** Hook offsets (S_1) the VM reaches; the oracle logs these. */
export const VM_CALLS = { move: 0xa664, attack: 0x9d28, spell: 0x940c, special: 0x9626, step: 0x8d7e, flee: 0x866c, steal: 0xa906, message: 0x1f3a8, sched: 0x5ea } as const;

const s8 = (v: number) => v & 0xff;
const bool = (v: boolean) => (v ? 1 : 0);

/** Condition word test (S_1 +0xA8BA): bit15 value>thr, bit13 value<thr, bit14 value==thr. */
export function aiCompare(value: number, thr: number, w: number): boolean {
  let n = 0;
  if (w & 0x8000 && value > thr) n++;
  if (w & 0x2000 && value < thr) n++;
  if (w & 0x4000 && value === thr) n++;
  return n !== 0;
}

/** Run the behaviour VM for one monster activation (S_1 +0xAAFC). `scripts` is not mutated. */
export function runBehaviour(m0: VmMonster, w: VmWorld, sc: AiScripts, rng: BcRng, hpOk: (m: VmMonster) => boolean, id = 1): VmResult {
  const m: VmMonster = { ...m0, vars: [...m0.vars] };
  const cells = sc.cells.map(c => [...c] as Cell);
  const base = sc.starts[m.type];
  let x = w.x, y = w.y;
  let d5 = 0, res = 0, pc = m.pc;
  const calls: VmResult['calls'] = [];
  const ops = new Set<number>();
  let guard = 0;
  while (d5 === 0) {
    if (++guard > 5000) throw new Error('runaway');
    const [op, a, w1, w2] = cells[base + pc];
    ops.add(op);
    switch (op) {
      case 2: case 3: case 4:
        calls.push({ off: w1 === 1 ? VM_CALLS.move : VM_CALLS.attack, w0: id, w5: op });
        res = w.hookRet; pc++; break;
      case 5: d5 = w1; pc++; break;
      case 6: d5 = m.b5 & 0x7f; pc++; break;
      case 9:
        calls.push({ off: VM_CALLS.step, w0: id });
        if (w.a1e8e === 0) { d5 = m.b5 & 0x7f; } else throw new Error('op 9 with free directions not modelled');
        break;
      case 0x0a: {
        x = a; y = w1;
        m.s0e = s8(Math.abs(w.px - y) + Math.abs(w.py - y)); // sic: the code subtracts y from both coordinates
        pc++; break;
      }
      case 0x0b: calls.push({ off: VM_CALLS.spell, w0: id, w5: 0x0b }); res = w.hookRet; pc++; break;
      case 0x0d:
        if (m.b7 !== 0 && (m.w0c & 3) !== 0 && m.maxHp - 5 > m.hp) {
          const n = m.w0c & 2 ? 20 : 10;
          m.hp = ((m.hp + rng.rand16(n) + (n >> 1)) << 16) >> 16;
          if (m.hp > m.maxHp) m.hp = m.maxHp;
          m.b7 = s8(m.b7 - 1);
        }
        pc++; break;
      case 0x0e: pc = w2; break;
      case 0x10: m.vars[a] = s8(w1); pc++; break;
      case 0x12: m.vars[a] = s8(m.vars[a] + w1); pc++; break;
      case 0x13: m.vars[a] = s8(m.vars[a] - w1); pc++; break;
      case 0x16: pc = hpOk(m) ? w2 : pc + 1; break;
      case 0x19: pc = Math.abs(Math.abs(w.px - x) + Math.abs(w.py - y)) === 1 ? pc + 1 : w2; break;
      case 0x1c: pc = aiCompare(m.s0e, w1 & 0x1fff, w1) ? w2 : pc + 1; break;
      case 0x1d: pc = aiCompare(m.vars[a], w1 & 0x1fff, w1) ? w2 : pc + 1; break;
      case 0x1e: calls.push({ off: VM_CALLS.special, w0: id, w5: a << 8 }); res = w.hookRet; pc++; break;
      case 0x21: calls.push({ off: VM_CALLS.steal, w0: id }); pc++; break;
      case 0x22: m.gfx = w1; m.b7 = 0x14; pc++; break;
      case 0x24: m.maxHp = w1; m.hp = w1; pc++; break;
      case 0x27: if (w1 !== 0) calls.push({ off: VM_CALLS.message, w0: w1 }); pc++; break;
      case 0x28: cells[base][0] = 0x14; pc++; break;
      case 0x29: cells[base][0] = 0x15; cells[base][3] = w2; pc++; break;
      case 0x2b: d5 = 2 * (m.b5 & 0x7f); pc++; break;
      case 0xff:
        m.vars[3] = s8(m.vars[3] - 1);
        if (m.vars[3] !== 0) {
          calls.push({ off: VM_CALLS.flee, w0: id });
          if (w.a1e8e === 3) pc++; // (1E8F, not 1E8E, in the code; the harness keeps both 0)
          else { pc = 1; m.type = m.vars[2]; m.vars[2] = 0; m.vars[3] = 0; d5 = 1; }
        } else { m.vars[2] = 0; res = 2; pc++; }
        break;
      default: throw new Error(`unknown op ${op.toString(16)}`);
    }
  }
  m.pc = pc;
  if (res === 1) d5 = (d5 >> 1) + 1;
  if (res === 2 && (m.gfx === 0x80b7 || m.gfx === 0x80b8)) { res = 0; m.s0e = 10; }
  const event = res !== 2 ? { type: 1, due: w.tick + d5, a1: x & 0xff, a2: y & 0xff } : null;
  if (res === 2) m.vars[4] = 0; // S+0x13 = 'active/scheduled' flag, cleared instead of rescheduling
  return { ops, m, calls, event, clearedActive: res === 2 };
}

/**
 * S_1 +0xA82C: returns 1 when monster hp% (current hp*100 / secondary max hp, signed truncating divide)
 * is AT LEAST (b3 & 3) * 10 (`cmp.l d4,d5 ; blt -> 0`), i.e. the monster is still healthy enough.
 */
export function hpAtLeastMorale(m: { hp: number; maxHp: number; b3: number }): boolean {
  const pct = Math.trunc((m.hp * 100) / m.maxHp);
  return pct >= (m.b3 & 3) * 10;
}

// ---------------------------------------------------------------- monster melee

export interface MeleeIn {
  gfx: number; b2: number; b3: number; b6: number; maxHp: number;
  px: number; py: number; mx: number; my: number; facing: number; pos: number; op: number; flag: number;
  form: number[]; hp: number[]; ac: number[]; s0f: number;
}
export interface MeleeOut { ret: number; outflag: number; s0f: number; s0a: number; dmg: [number, number][]; sched: number }

/** S_1 +0x96E8: the two target slots on the attacker's side (4 = none). */
export function pickTargets(dir: number, facing: number, form: number[], hp: number[]): [number, number] {
  let t1 = 4, t2 = 4;
  let s = (dir + 4 - facing + 3) & 3;
  if (hp[form[s]] > 0) t1 = form[s];
  else { s = (s + 1) & 3; if (hp[form[s]] > 0) t1 = form[s]; }
  s = (dir + 4 - facing + 2) & 3;
  if (hp[form[s]] > 0) t2 = form[s];
  else { s = (s + 3) & 3; if (hp[form[s]] > 0) t2 = form[s]; }
  return [t1, t2];
}

/** S_1 +0x97F0: single target for a monster standing at `pos` (0..3 corner, 4 centre) attacking along `dir`. */
export function pickTarget(dir: number, pos: number, facing: number, form: number[], hp: number[], rng: BcRng): number {
  const [t1, t2] = pickTargets(dir, facing, form, hp);
  if (pos !== 4) { if (dir === pos) return t1; if (((pos + 3) & 3) === dir) return t2; return 4; }
  if (t1 === 4) return t2;
  if (t2 === 4) return t1;
  return [t1, t2][rng.rand16(2)];
}

/**
 * Monster-vs-party act (S_1 +0x9D28), melee-only monsters (record byte +6 bit 1 set, bit 2 clear), with the
 * facing already matching (flag 1, record byte +3 bit 5 clear). Spell/ranged branch not modelled.
 */
export function monsterMelee(i: MeleeIn, rng: BcRng): MeleeOut {
  const out: MeleeOut = { ret: 0, outflag: 0, s0f: i.s0f, s0a: 0, dmg: [], sched: 0 };
  const dx = i.px - i.mx, dy = i.py - i.my;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const dist = adx + ady;
  const aligned = dx === 0 || dy === 0, adj = dist === 1;
  let d2 = 4;
  if (dx > 0 && adx > ady) d2 = 1;
  else if (dx < 0 && adx > ady) d2 = 3;
  else if (dy > 0 && ady > adx) d2 = 0;
  else if (dy < 0 && ady > adx) d2 = 2;
  if (d2 === 4) return out;
  if (dx >= 4 || dy >= 4) { out.ret = 2; return out; }
  void aligned;
  const melee = bool((i.b6 & 2) !== 0 && adj && (i.op === 2 || i.op === 4));
  const magic = bool((i.b6 & 4) !== 0 && aligned && (i.op === 3 || i.op === 4 || i.op === 0xc));
  if (magic) throw new Error('spell branch not modelled');
  if (i.gfx === 0x80b9 && i.s0f === 0) { out.s0f = 1; }
  else {
    let thr = Math.floor(255 / (((i.b3 & 0xc) >> 2) + 1));
    if (i.gfx === 0x80b8 || i.gfx === 0x80b7) thr -= 30;
    if (rng.byte() < thr) return out;
    const cnt = melee + magic;
    if (cnt === 0) return out;
    thr = Math.floor(255 / (cnt + 1));
    if (i.gfx === 0x80b8) thr -= 30;
    if (rng.byte() < thr) return out;
  }
  const m = Math.max(1, Math.trunc(i.maxHp / 10));
  const sp = (i.b3 & 0xc) >> 2;
  const tgt = pickTarget(d2, i.pos, i.facing, i.form, i.hp, rng);
  if (tgt === 4) return out;
  out.s0a = 1; out.sched = 1;
  let thr = ((i.ac[tgt] << 24) >> 24) + 8 - ((m - 1) >> 1) - sp;
  thr = Math.max(2, Math.min(20, thr));
  if (rng.rand8(20) + 1 >= thr) out.dmg.push([tgt, rng.rand16(4 * m) + m]);
  out.outflag = 1;
  return out;
}

// ---------------------------------------------------------------- XP

/**
 * Monster-death XP (S_1 +0x7ED0 loop at +0x819C): every living character (HP > 0) gets an independent roll
 * `rand16(secondMaxHp) + rand16(primaryByte2) + secondWord6`, added to its XP long; the draws happen per character, in slot order.
 */
export function awardXp(
  chars: { hp: number; xp: number }[], mon: { b2: number; w6: number; maxHp: number }, rng: BcRng,
): number[] {
  return chars.map(c => {
    if (c.hp <= 0) return c.xp;
    const a = rng.rand16(mon.maxHp), b = rng.rand16(mon.b2);
    return (c.xp + a + b + mon.w6) >>> 0;
  });
}

// ---------------------------------------------------------------- party vitals tick

export interface VChar { hp: number; maxHp: number; level: number; food: number; water: number; poison: number; disease: number; regen: number; prot86: number; state: number }
export interface TickIn { t: number; resting: boolean; hazard: boolean; light: number; hold: number; chars: VChar[] }
export type TickCall =
  | { kind: 'scan' }
  | { kind: 'adjust'; char: number; energy: number; food: number; water: number }
  | { kind: 'damage'; char: number; dmg: number; type: number };

/**
 * The vitals/periodic part of the tick handler (S_1 +0x08B2) after the tick counter `t` has been incremented.
 * Not modelled: the due-event list, item charge decay (t & 63 == 32), spell recharge (+0x10D2), light blanking redraw.
 * DamageCharacter itself is not applied here: callers subtract the damage (see the death rules in the spec).
 */
export function vitalsTick(i: TickIn, rng: BcRng): { hp: number[]; light: number; hold: number; calls: TickCall[] } {
  const { t, resting } = i;
  const hp = i.chars.map(c => c.hp);
  const calls: TickCall[] = [];
  const alive = (k: number) => hp[k] > 0;
  const rested = (k: number) => !resting || i.chars[k].state === 1;
  const light = i.light > 0 ? i.light - 1 : 0;
  const hold = i.hold > 0 ? i.hold - 1 : 0;
  if ((t & 15) === 0) calls.push({ kind: 'scan' });
  // everything below runs only when (t & 15) == 0, or (resting and t & 7 == 0): the section tests for resting-only
  // cadences (food/water at t & 7 == 5) sit inside this gate and are unreachable.
  if ((t & 15) === 0 || (resting && (t & 7) === 0)) {
    if (resting) {
      for (let k = 0; k < 4; k++) {
        if (!alive(k) || i.chars[k].state !== 1) continue;
        let h = i.chars[k].level * 2;
        if (i.hazard && i.chars[k].prot86 === 0) h >>= 1;
        hp[k] += h;
        if (hp[k] > i.chars[k].maxHp) hp[k] = i.chars[k].maxHp;
      }
    }
    for (let k = 0; k < 4; k++) {
      if (!alive(k)) continue;
      const c = i.chars[k];
      calls.push({ kind: 'adjust', char: k, energy: resting && c.state === 1 ? 125 : 0, food: -1, water: -1 });
      if (c.regen !== 0 && (t & 0x200) === 0 && hp[k] < c.maxHp) hp[k]++;
      if (i.hazard && c.prot86 === 0) calls.push({ kind: 'damage', char: k, dmg: rng.rand16(5) + 1, type: 4 });
    }
  if ((t & 0x1ff) === 0x100 || (resting && (t & 0x1f) === 0x10)) {
    for (let k = 0; k < 4; k++) if (alive(k) && i.chars[k].disease !== 0 && rested(k)) calls.push({ kind: 'damage', char: k, dmg: i.chars[k].disease, type: 6 });
  }
  if ((t & 0xff) === 0x80 || (resting && (t & 0xf) === 8)) {
    for (let k = 0; k < 4; k++) if (alive(k) && i.chars[k].poison !== 0 && rested(k)) calls.push({ kind: 'damage', char: k, dmg: rng.rand16(i.chars[k].poison * 10) + 1, type: 5 });
  }
  if ((t & 0x7f) === 0x40) {
    for (let k = 0; k < 4; k++) {
      if (!alive(k) || !rested(k)) continue;
      const c = i.chars[k];
      if (c.food < 2000) calls.push({ kind: 'damage', char: k, dmg: 2 - Math.trunc(c.food / 2000), type: 4 });
      if (c.water < 2000) calls.push({ kind: 'damage', char: k, dmg: 2 - Math.trunc(c.water / 2000), type: 4 });
    }
  }
  }
  return { hp, light, hold, calls };
}

// ---------------------------------------------------------------- monster special attacks

export interface SpecIn { bit: number; dir: number; pos: number; facing: number; maxHp: number; form: number[]; hp: number[]; resist: number[]; shield: number[]; prot: number[]; con: number[] }
/**
 * S_1 +0x98A8 for the disease (bit 14) and poison (bit 15) spell-flag bits. (Possession bit 12 and flesh-to-stone bit 13 are
 * documented in game-rules.md but not modelled here.) `t1` is the stat bonus table T1.
 */
export function monsterSpecial(i: SpecIn, t1: number[], rng: BcRng) {
  const out = { dmg: [] as [number, number, number][], poison: [0, 0, 0, 0], disease: [0, 0, 0, 0], sched: 0 };
  const tgt = pickTarget(i.dir, i.pos, i.facing, i.form, i.hp, rng);
  if (tgt === 4) return out;
  out.sched = 1;
  if (rng.rand8(100) < (((i.resist[tgt] << 24) >> 24) & 0xffff)) return out;
  if (i.shield[tgt] && rng.rand8(100) > 50) return out;
  if (i.bit === 14) {
    if (i.prot[tgt] === 0 && ((rng.rand16(20) + 20 - t1[i.con[tgt]]) & 0xffff) > 30) {
      out.disease[tgt]++;
      out.dmg.push([tgt, rng.rand16(10) + 1, 6]);
    }
  } else if (i.bit === 15) {
    if (i.prot[tgt] === 0) { out.poison[tgt]++; out.dmg.push([tgt, rng.rand16(10) + 1, 5]); }
  }
  return out;
}
