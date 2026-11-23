/**
 * Wizardry 6 (Amiga) attack resolver: the melee / thrown / shot / monster-attack routine
 * LAB_0CD0 (`Bane` CODE+0x1f33e) and the small helpers it calls, ported from the game's own
 * 68k code and diffed against it (tools/wizardry6/oracle/combat.py -> oracle/combat-vectors.json,
 * test __tests__/combat.test.ts). Original TypeScript derived from the disassembly only.
 *
 * Memory model: the port runs against a byte map that has the game's own layout
 * (A4-relative globals, 432-byte party records, 44-byte member structs, 222-byte monster
 * records). The test seeds that map with the exact bytes the real routine read ("footprint"); a read
 * outside it throws, so the port provably consults nothing the game did not.
 *
 * Calls the game makes into presentation or into other systems are not executed here; they are
 * recorded as {@link Effect}s with the exact stack arguments the game pushed:
 *   set_status   CODE+0x2300c  (kill / status set on the defender; ten words, see {@link setStatusArgs})
 *   weapon_proc  CODE+0x1ede0  (on-hit status effects of the weapon block; separate port below)
 *   spell_effect CODE+0x24ea0  (spell effect dispatcher, when the weapon / monster attack casts)
 *   use_ammo     CODE+0x22278  (consume one thrown / shot item)
 *
 * Roles: the first parameter is the ATTACKER's 44-byte member struct (its +0x1f/+0x20 name the
 * TARGET group and member). The attacker's own group and index are the globals -15138(A4) and
 * -15136(A4). This corrects docs/wizardry6/amiga/game-rules.md 2.5, which read them the other way.
 */
import { W6Rng } from './rules.ts';

export const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;
const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const tdiv = (a: number, b: number): number => Math.trunc(a / b);

export type Effect = [name: string, argsHex: string];

/** Sparse byte memory. Reads of a never-seeded byte throw. */
export class Mem {
  readonly b = new Map<number, number>();
  readonly wrote = new Map<number, number>();
  constructor(seed: Record<string, number>) {
    for (const [a, v] of Object.entries(seed)) this.b.set(Number(a), v);
  }
  u8(a: number): number {
    const v = this.b.get(a);
    if (v === undefined) throw new Error(`read outside footprint: ${a.toString(16)}`);
    return v;
  }
  s8(a: number): number { return s8(this.u8(a)); }
  u16(a: number): number { return (this.u8(a) << 8) | this.u8(a + 1); }
  s16(a: number): number { return s16(this.u16(a)); }
  u32(a: number): number { return ((this.u16(a) << 16) | this.u16(a + 2)) >>> 0; }
  w8(a: number, v: number): void { this.b.set(a, v & 0xff); this.wrote.set(a, v & 0xff); }
  w16(a: number, v: number): void { this.w8(a, v >> 8); this.w8(a + 1, v); }
  w32(a: number, v: number): void { this.w16(a, v >>> 16); this.w16(a + 2, v); }
}

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** Attack kinds (message 3350+kind): the `kind` parameter of LAB_0CD0. */
export const ATTACK_KINDS = ['SWINGS', 'THRUSTS', 'BASHES', 'MELEES', 'THROWS', 'PUNCHES', 'KICKS', 'LASHES', 'SHOOTS'] as const;

/**
 * LAB_0CA3 (CODE+0x1eba2): fatigue term from stamina cur/max. `flag` 0 is the to-hit penalty the
 * attacker suffers, `flag` 1 the armour-class penalty the defender suffers.
 * pct = cur*100/max (signed 32-bit divide); fatigue = 100 - pct; thresholds 50/66/75/90.
 */
export function fatigue(flag: number, cur: number, max: number): number {
  const f = 100 - tdiv(s16(cur) * 100, s16(max));
  if (f <= 50) return 0;
  if (f <= 66) return flag === 0 ? 5 : 0;
  if (f <= 75) return flag === 0 ? 10 : 1;
  if (f <= 90) return flag === 0 ? 20 : 2;
  return flag === 0 ? 40 : 4;
}

/**
 * LAB_0CB1 (CODE+0x1ec26): encumbrance record of party member `pidx`, from carried weight / capacity
 * (record +32 / +34). Returns seven words and also stores them at -30370(A4). Words 0/1/2 are the
 * armour penalty and the hand-0 / hand-1 to-hit penalty.
 */
export function encumbrance(m: Mem, a4: number, pidx: number): number[] {
  const r = pidx * 0x1b0;
  let w = [0, 0, 0, m.u8(a4 - 17497 + r), m.u8(a4 - 17496 + r), 0, 9];
  const pct = tdiv(s16(m.u16(a4 - 17890 + r)) * 100, s16(m.u16(a4 - 17888 + r)));
  if (pct > 50) {
    if (pct <= 66) {
      w[1] = 5; w[2] = 10; w[3] = Math.min(w[3], 3); w[4] = Math.min(w[4], 3);
    } else if (pct <= 75) {
      w[0] = 1; w[1] = 10; w[2] = 20; w[3] = Math.min(w[3], 2); w[4] = Math.min(w[4], 2);
      w[5] = tdiv(s16(m.u16(a4 - 17892 + r)), 100); w[6] = -7;
    } else if (pct <= 90) {
      w = [2, 20, 40, 1, 1, tdiv(s16(m.u16(a4 - 17892 + r)), 50), -5];
    } else {
      w = [4, 40, 80, 1, 1, tdiv(s16(m.u16(a4 - 17892 + r)), 25), -4];
    }
  }
  for (let i = 0; i < 7; i++) m.w16(a4 - 30370 + 2 * i, w[i]);
  return w;
}

/**
 * LAB_0E28 (CODE+0x22b90): skill-use improvement. If skill `skill` of party member `pidx` is
 * below 100 and Random(skill) - level*mult <= 0, the skill rises by 1.
 */
export function skillUse(m: Mem, rng: W6Rng, a4: number, pidx: number, skill: number, mult: number): void {
  const a = a4 - 17614 + pidx * 0x1b0 + skill;
  if (m.u8(a) < 100) {
    const r = rng.random(m.u8(a));
    const lvl = m.s16(a4 - 17886 + pidx * 0x1b0);
    if (s16(r - s16(lvl * mult)) <= 0) m.w8(a, m.u8(a) + 1);
  }
}

/** LAB_0D66 (CODE+0x20b9e): damage dice: word `base`, then `n` x (Random(sides)+1). */
export function dice(rng: W6Rng, base: number, n: number, sides: number): number {
  let t = s16(base);
  for (; n > 0; n--) t = s16(t + rng.random(sides) + 1);
  return t;
}

/** LAB_0D69 (CODE+0x20bd0) packs (n, sides, base) into -30356(A4) before LAB_0D66 rolls them. */
export function dice69(m: Mem, rng: W6Rng, a4: number, a: number, b: number, c: number): number {
  m.w16(a4 - 30356, c);
  m.w8(a4 - 30354, a);
  m.w8(a4 - 30353, b);
  return dice(rng, c, a & 0xff, b & 0xff);
}

/** LAB_0DDB (CODE+0x21fc4): body-part roll: Random(100) walked down eight weights, default part 4. */
export function bodyPart(m: Mem, rng: W6Rng, tbl: number): number {
  let r = rng.random(100);
  for (let i = 0; i < 8; i++) {
    const w = m.u8(tbl + i);
    if (r < w) return i;
    r -= w;
  }
  return 4;
}

/**
 * Skill used by a weapon of item subtype `st` (item record byte +5): index 0..9 into the skill array
 * (0 WAND&DAGGER .. 8 SHIELD, 9 HANDS&FEET), from the switch at CODE+0x1f8a4..0x1f9ca.
 */
export function weaponSkill(st: number): number {
  switch (st) {
    case 0: case 0x12: case 0x59: return 0;
    case 1: case 0x0e: case 0x0f: case 0x10: case 0x33: case 0x35: case 0x37: case 0x3a: case 0x3b: return 1;
    case 2: case 3: case 0x14: return 2;
    case 4: case 5: case 6: case 0x34: case 0x36: case 0x38: case 0x62: return 3;
    case 7: case 8: case 9: case 10: case 0x11: case 0x13: case 0x39: case 0x5a: return 4;
    case 0x0b: case 0x0c: return 7;
    case 0x0d: return 6;
    case 0x18: case 0x26: return 8;
    default: return 0;
  }
}

export interface AttackIn {
  a4: number;
  attacker: number; // address of the attacker's member struct (param 1)
  hand: number;
  kind: number;
  /** item id -> word at +28 of its scenario record (A5-46 in the routine) (the cast word of a thrown item) */
  itemCastWord: (id: number) => number;
}

/** LAB_0CD0 (CODE+0x1f33e). Returns the effect log; state changes are made through `m` and `rng`. */
export function resolveAttack(m: Mem, rng: W6Rng, x: AttackIn): Effect[] {
  const { a4, attacker: A, hand: h, kind: k } = x;
  const fx: Effect[] = [];
  const ag = m.u16(a4 - 15138);
  const ai = m.s16(a4 - 15136);
  const tg = m.u8(A + 0x1f);
  const ti = m.u8(A + 0x20);
  const MR = (g: number) => m.u32(a4 - 15294 + 4 * g);
  const MB = (g: number) => m.u32(a4 - 15266 + 4 * g);
  const D = ti * 0x2c + MB(tg); // defender member struct
  const pr = ai * 0x1b0;
  let spell = -1; // sStack_9c: a cast word that replaces the physical hit
  let s84: number; // damage bonus
  let s5c: number; // to-hit base (higher = more misses)
  let s60: number; // defender AC (lower = better)
  let s62: number; // AC + attack-kind modifier
  let blk: number; // weapon block address
  let dmgWord: number; // weapon block first long

  m.w16(a4 - 10488, 4);

  // ---- preamble: messages, the cast word of a thrown item / monster spell attack ----
  if (ag === 0) {
    let slot = m.u8(a4 - 17650 + h + pr);
    if (k === 8) slot = m.u8(a4 - 17649 + pr);
    if (m.u8(A + 0x2b) !== 0 && k !== 4 && k !== 8) rng.random(2); // BACKSTAB / SURPRISE text
    if (slot !== 0xff) {
      if (k === 4) {
        const w = x.itemCastWord(m.u16(a4 - 17858 + slot * 8 + pr));
        if (w !== 0) spell = s16(w);
      }
    }
  } else if (m.u8(MR(ag) + 0x80 + h) < 4) {
    if (m.u8(A + 0x2b) !== 0 && k !== 4 && k !== 8) rng.random(2);
    if (k === 4 || k === 8) {
      const kindByte = m.u8(MR(ag) + 0x83 + h);
      if (kindByte === 0x20) spell = s16(m.u16(MR(ag) + h * 16 + 0x44 + 2));
    }
  }

  // ---- common base terms ----
  const sum = (g: number) => m.u8(MR(g) + 0x87) + m.u8(MR(g) + 0x88) + m.u8(MR(g) + 0x89);
  const s5a = tdiv(s16(sum(tg) - sum(ag)), 2);
  s84 = m.s8(A + 0x28);
  const fa0 = fatigue(0, m.u16(A + 6), m.u16(A + 8));

  if (ag !== 0) {
    s5c = s16(s5a + m.s8(MR(ag) + h * 16 + 0x52) + m.s8(A + 0x27) * 5 + fa0);
    blk = MR(ag) + h * 16 + 0x44;
    dmgWord = m.u32(blk);
    if (k === 4 || k === 8) s84 = 0;
    let s98 = 0;
    if (tg === 0) s98 = encumbrance(m, a4, ti)[0];
    let s5e = fatigue(1, m.u16(D + 6), m.u16(D + 8));
    s5e = s16(m.s8(D + 0x26) + s5e);
    if (tg === 0 && m.s16(a4 - 18134) > 0) s5e = s16(s5e - m.s16(a4 - 18132));
    s60 = s16(s98 + s5e + m.s8(MR(tg) + 0xbe));
    s62 = s16(s98 + s5e);
    if (tg !== 0) s62 = s16(m.s8(MR(tg) + 0xc6 + k) + s62);
  } else {
    let s82: number;
    if (k === 4) s82 = 5;
    else if (m.u8(a4 - 17650 + h + pr) === 0xff) s82 = 9;
    else s82 = weaponSkill(m.u8(a4 - 17853 + m.u8(a4 - 17650 + h + pr) * 8 + pr));
    if (s82 !== 9 || m.u8(a4 - 17605 + pr) !== 0 || m.u8(a4 - 17507 + pr) === 12 || m.u8(a4 - 17507 + pr) === 13) skillUse(m, rng, a4, ai, s82, 2);
    const enc = encumbrance(m, a4, ai);
    const penalty = h === 0 ? enc[1] : enc[2];
    const fa = fatigue(0, m.u16(A + 6), m.u16(A + 8));
    s5c = s16(
      penalty + s5a + m.s8(a4 - 17668 + h * 16 + pr) + m.s8(a4 - 17492 + pr) + m.s8(A + 0x27) * 5 + fa -
        tdiv(m.u8(a4 - 17614 + s82 + pr), 3),
    );
    blk = a4 - 17682 + h * 16 + pr;
    dmgWord = m.u32(blk);
    const slot = m.u8(a4 - 17650 + h + pr);
    if (k === 8) {
      const s7a = m.u8(a4 - 17649 + pr);
      if (s7a !== 0xff && m.u8(a4 - 17854 + s7a * 8 + pr) === 4) {
        blk = a4 - 17666 + pr;
        dmgWord = m.u32(blk);
        s5c = s16(m.s8(a4 - 17652 + pr) + s5c);
        s84 = 0;
        fx.push(['use_ammo', hex16(s7a)]);
      }
    } else if (k === 4) {
      const t = m.u8(a4 - 17854 + slot * 8 + pr);
      if (t === 0x0e || (t < 0x0c && t !== 2)) m.w8(a4 - 17852 + slot * 8 + pr, 1);
      s84 = 0;
      fx.push(['use_ammo', hex16(slot)]);
    }
    let s5e = fatigue(1, m.u16(D + 6), m.u16(D + 8));
    s5e = s16(m.s8(D + 0x26) + s5e);
    if (m.s16(a4 - 18126) > 0) s5e = s16(m.s16(a4 - 18124) + s5e);
    s60 = s16(s5e + m.s8(MR(tg) + 0xbe));
    s62 = s16(s5e + m.s8(MR(tg) + 0xc6 + k));
  }

  // ---- modifiers shared by both sides ----
  let mult = 1;
  if (m.u8(A + 0x2b) !== 0) {
    if (s60 < 0x0b) s60 = 10;
    mult = 2;
  }
  if (m.u8(A + 0x12) !== 0) {
    if (s5c < 0x5a) s5c = 0x5a;
    if (s60 > 0) s60 = 0;
  }
  if (m.u8(A + 0x16) !== 0 || m.u8(A + 0x0f) !== 0 || m.u8(A + 0x17) !== 0) s5c = s16(s5c + 0x19);
  if (m.u8(D + 0x12) !== 0 || m.u8(D + 0x10) !== 0 || m.u8(D + 0x11) !== 0 || m.u8(D + 0x22) === 2) {
    s60 = 0x0f;
    mult = 2;
  }
  if (m.u8(D + 0x16) !== 0 || m.u8(D + 0x0f) !== 0) s60 = s16(s60 + 4);
  const rec86 = m.u8(MR(ag) + 0x86);
  let s86 = rec86 > 0x0f ? 1 : 0;
  if (rec86 > 0x11) s86++;
  s84 = s16(s86 + s84);
  let strikes = rng.random(s16(m.u8(MR(ag) + 212) - tdiv(m.s8(D + 41), 10))) + 1;
  if (strikes < 1) strikes = 1;
  if (strikes > 4) strikes = 4;
  switch (k) {
    case 1: s60 -= 2; s62 += 1; s84 += 1; break;
    case 2: s62 -= 2; s84 = s16(s86 + 2 + s84); break;
    case 3: s60 -= 4; s62 -= 4; mult = 2; break;
    case 4: strikes = 1; mult = 1; s60 -= 1; s62 += 1; break;
    case 5: s60 += 1; s62 -= 1; break;
    case 6: s60 -= 2; s84 = s16(s86 + 2 + s84); break;
    case 7: s60 += 2; s62 -= 2; mult = 1; break;
    case 8: strikes = 1; mult = 1; s62 += 2; break;
    default: break;
  }
  if (m.u8(D + 0x1e) === 7) {
    if (s60 < 0x0b) s60 = 10;
    mult = 2;
  }
  if (m.u8(D + 0x12) === 0 && m.u8(D + 0x10) === 0 && m.u8(D + 0x11) === 0 && m.u8(D + 0x22) === 0) {
    if (m.u8(D + 0x1e) === 1) {
      switch (m.u16(D + 10)) {
        case 0:
          if (tg === 0) {
            s60 = s16(s60 - (tdiv(m.u8(a4 - 17606 + ti * 0x1b0), 10) + 1));
            skillUse(m, rng, a4, ti, 8, 2);
          } else {
            s60 = s16(s60 - (tdiv(m.u16(D), 4) + 1));
          }
          mult = 1;
          break;
        case 1:
          s60 -= 2;
          mult = 1;
          break;
        case 2:
          if (k !== 4 && k !== 8) {
            m.w8(D + 0x1e, 0);
            m.w8(D + 0x21, 0);
            m.w8(D + 0x18, m.u16(a4 - 15134) - 1);
            m.w8(D + 0x1f, m.u8(a4 - 15137));
            m.w8(D + 0x20, m.u8(a4 - 15135));
            m.w16(D + 0x0c, 0xffff);
            m.w16(D + 0x0a, 0xff);
            for (let j = 7; j >= 0; j--) {
              const base = tg === 0 ? a4 - 17667 + ti * 0x1b0 : MR(tg) + 83;
              if (((m.u8(base + (j >> 3)) >> (j & 7)) & 1) === 1) m.w16(D + 0x0a, j); // TestBit: LSB-first
            }
            if (m.u16(D + 0x0a) === 0xff) m.w16(D + 0x0a, 8);
            m.w8(D + 0x1c, 0);
          }
          break;
        case 3:
          s60 = 0x0f;
          break;
        default: break;
      }
    } else if (tg === 0 && m.u8(a4 - 17649 + ti * 0x1b0) !== 0xff && m.u8(a4 - 17854 + m.u8(a4 - 17649 + ti * 0x1b0) * 8 + ti * 0x1b0) === 0x0b) {
      skillUse(m, rng, a4, ti, 8, 0);
    }
  }

  // ---- strikes ----
  for (let n = 0; n < strikes && m.u8(D + 0x22) < 3; n++) {
    let s66 = m.u16(a4 - 18606) === 0 ? rng.random(100) : 0;
    const part = tg === 0 ? bodyPart(m, rng, MR(ag) + 0xb6) : bodyPart(m, rng, MR(tg) + 0xae);
    let s64 = s16(s62 + m.s8(MR(tg) + 0xbe + part));
    if (m.u8(D + 0x22) === 2 && s64 > 0) s64 = 0;
    if (m.u8(MR(tg) + 0xd0) === 0x16 && spell === -1) {
      if (ag === 0) {
        const slot = m.u8(a4 - 17650 + h + pr);
        if (slot === 0xff) s66 = 0;
        else if (m.u16(a4 - 17858 + slot * 8 + pr) === 0x1ca && m.u16(a4 - 15126) !== 0) mult = 1;
        else s66 = 0;
      } else s66 = 0;
    }
    if ((k === 4 || k === 8) && rng.random(100) < m.u8(MB(tg) + 0x18e)) {
      // missile dodged
    } else if (s66 < 5 || (s66 < 0x5f && s66 <= s16(s5c + s60 * -5) && spell === -1)) {
      // miss
    } else if (spell === -1) {
      if (m.u8(A + 0x2b) === 1) m.w8(A + 0x2b, 0xff);
      const base = s16(dmgWord >>> 16);
      const dmg = s16(s16(s84 + dice(rng, base, (dmgWord >>> 8) & 0xff, dmgWord & 0xff)) * mult);
      if (dmg < 1 || (s66 < 0x5f && s66 <= s16(s5c + s64 * -5))) {
        // glancing blow: no damage
      } else {
        m.w16(D + 2, m.u16(D + 2) - dmg);
        m.w8(D + 0x10, 0);
        let c = m.u8(D + 0x11) - (rng.random(3) + 2);
        if (c < 0) c = 0;
        if (c > 0xff) c = 0xff;
        m.w8(D + 0x11, c);
        if (m.s16(D + 2) < 1) {
          fx.push(['set_status', setStatusArgs(tg, ti, 0x0d9e, 0, 3, 0)]);
          if (m.u8(A + 0x2b) === 0xff) m.w8(A + 0x2b, 1);
        } else if (m.u8(MR(tg) + 0xd0) !== 0x16) {
          fx.push(['weapon_proc', hex32(A) + hex32(blk) + hex16(tg) + hex16(ti)]);
        }
      }
    } else {
      m.w16(a4 - 10484, 1);
      fx.push(['spell_effect', hex32(A) + hex16(spell % 256) + hex16(tdiv(spell, 256))]);
    }
  }
  if (m.u8(A + 0x2b) === 0xff) m.w8(A + 0x2b, 0);
  return fx;
}


/** The ten words pushed for LAB_0E3D (CODE+0x2300c SetStatus): grp, idx, msg, resist slot (0 = no save), new state, resist modifier, then constants. */
export function setStatusArgs(tg: number, ti: number, msg: number, res: number, state: number, mod: number, w7 = 6): string {
  return [tg, ti, msg, res, state, mod, w7, 6, 0x0d50, 0].map(hex16).join('');
}

/**
 * LAB_0E3A (CODE+0x22f9e) resist scale: v = clamp(mag * (resist - mod) / 100, 0, mag) with resist =
 * record byte +0x94+res; the magnitude that survives is mag - Random(v + 1).
 */
export function resistScale(m: Mem, rng: W6Rng, a4: number, grp: number, mag: number, res: number, mod: number): number {
  const rec = m.u32(a4 - 15294 + 4 * grp);
  let v = tdiv(s16(mag) * s16(m.u8(rec + 0x94 + res) - mod), 100);
  if (v < 0) v = 0;
  if (v > s16(mag)) v = s16(mag);
  return s16(mag - rng.random(v + 1));
}

/**
 * LAB_0E45 (CODE+0x23154) ApplyStatus: add a duration to one of the defender's status counters
 * (member bytes +0xe+slot, capped at 250; 0xff = permanent) if the magnitude survives the resistance
 * scale and Random(100) beats resist-mod. Slot 5 also records the low byte of `c` at +0x23.
 */
export function applyStatus(
  m: Mem, rng: W6Rng, a4: number, tg: number, ti: number, res: number, slot: number, mod: number,
  a: number, b: number, c: number,
): void {
  const D = ti * 0x2c + m.u32(a4 - 15266 + 4 * tg);
  if (m.u8(D + 0x22) >= 2 || m.u8(D + 0x2b) !== 0) return;
  const mr = (g: number) => m.u32(a4 - 15294 + 4 * g);
  if (tg === 0) for (let i = 0; i < 14; i++) m.w8(mr(0) + 0x94 + i, m.u8(a4 - 17584 + ti * 0x1b0 + i));
  let mag = dice69(m, rng, a4, a, b, c);
  mag = resistScale(m, rng, a4, tg, mag, res, mod);
  if (mag <= 0) return;
  if (rng.random(100) > s16(m.u8(mr(tg) + 0x94 + res) - mod)) {
    if ((c & 0xffff) === 0xff) m.w8(D + 0x0e + slot, 0xff);
    else if (m.u8(D + 0x0e + slot) + mag > 0xfa) m.w8(D + 0x0e + slot, 0xfa);
    else m.w8(D + 0x0e + slot, m.u8(D + 0x0e + slot) + mag);
    if (slot === 5) m.w8(D + 0x23, c);
  }
}

/**
 * LAB_0CBB (CODE+0x1ede0): the on-hit effects of a weapon block. For each of eight effects, if
 * Random(100) < block byte +4+k the effect fires with power = attacker word0 / 3 + 1 and a resist
 * modifier of (attacker word0 - defender word0) * 3:
 *   0 status slot 2 (res 9)   1 slot 3 (res 4)   2 slot 5 (res 6, c = block byte +12)   3 set state 2 (res 11)
 *   4 none   5 monster-only stamina drain (record byte +217 = 3) or life drain (= 11, record +161)
 *   6 save vs res 11 (party) / 13 (monster) or die   7 status slot 2 (res 9, different dice)
 */
export function weaponProc(m: Mem, rng: W6Rng, a4: number, A: number, blk: number, tg: number, ti: number): Effect[] {
  const fx: Effect[] = [];
  m.w16(a4 - 10488, 4);
  const D = ti * 0x2c + m.u32(a4 - 15266 + 4 * tg);
  const mr = (g: number) => m.u32(a4 - 15294 + 4 * g);
  const mod = s16((s16(m.u16(A)) - s16(m.u16(D))) * 3);
  for (let k = 0; k < 8; k++) {
    if (!(rng.random(100) < m.u8(blk + 4 + k))) continue;
    const pow = s16(tdiv(m.s16(A), 3) + 1);
    switch (k) {
      case 0: applyStatus(m, rng, a4, tg, ti, 9, 2, mod, pow, 2, pow); break;
      case 1: applyStatus(m, rng, a4, tg, ti, 4, 3, mod, s16(pow * pow * 2), 5, pow); break;
      case 2: applyStatus(m, rng, a4, tg, ti, 6, 5, mod, s16(pow * 10), 2, m.u8(blk + 12)); break;
      case 3: fx.push(['set_status', setStatusArgs(tg, ti, 0x0d9d, 11, 2, mod, 0x0e)]); break;
      case 5: {
        if (m.u16(a4 - 15138) === 0) break;
        const ag = m.u16(a4 - 15138);
        let dmg = 0;
        const t = m.u8(mr(ag) + 217);
        if (t === 3) {
          dmg = dice69(m, rng, a4, pow * 2, 5, pow * 3);
          let v = s16(m.s16(D + 6) - dmg);
          if (v < 0) v = 0;
          m.w16(D + 6, v);
        } else if (t === 11) {
          if (rng.random(100) > m.u8(mr(ag) + 161)) {
            dmg = dice69(m, rng, a4, 1, 4, 0);
            m.w16(D + 4, m.u16(D + 4) - dmg);
            m.w16(D + 2, m.u16(D + 2) - dmg);
            if (m.s16(D + 4) < 1) m.w16(D + 4, 1);
            if (tg === 0) {
              m.w16(a4 - 17898 + ti * 0x1b0, m.u16(D + 2));
              m.w16(a4 - 17896 + ti * 0x1b0, m.u16(D + 4));
            }
          }
        }
        if (dmg > 0 && m.s16(D + 2) <= 0) fx.push(['set_status', setStatusArgs(tg, ti, 0x0d9e, 0, 3, mod)]);
        break;
      }
      case 6: {
        const res = tg === 0 ? 11 : 13;
        if (rng.random(100) > s16(m.u8(mr(tg) + 0x94 + res) - mod)) fx.push(['set_status', setStatusArgs(tg, ti, 0x0d9e, 0, 3, mod)]);
        break;
      }
      case 7: applyStatus(m, rng, a4, tg, ti, 9, 2, mod, s16(pow * 2), 3, pow); break;
      default: break;
    }
  }
  return fx;
}


/**
 * LAB_0E27/LAB_0E2B... kill cleanup (CODE+0x22c36): the defender (grp, idx) is dead. For a monster:
 * credit the attacker's kill counter (record -17906+i*432, a long), set the "unique monster slain" bit
 * when record +0xdc bit 0 is set (bit index = record +0xda, bit set at -30150(A4)), clear its cell in the
 * five-by-five formation grids, and add the record's XP (+0x40) to the pool at -15300(A4). Always:
 * state 3, HP and stamina 0, and the four action slots cleared.
 */
export function killCleanup(m: Mem, a4: number, tg: number, ti: number): void {
  const D = ti * 0x2c + m.u32(a4 - 15266 + 4 * tg);
  const mr = m.u32(a4 - 15294 + 4 * tg);
  if (tg !== 0) {
    const ai = m.s16(a4 - 15136);
    if (m.u16(a4 - 15138) === 0 && ai >= 0 && ai < m.s16(a4 - 15306)) {
      const ka = a4 - 17906 + ai * 0x1b0;
      m.w32(ka, m.u32(ka) + 1);
    }
    if ((m.u8(mr + 0xdc) & 1) !== 0) {
      const bit = m.u8(mr + 0xda);
      const ba = a4 - 30150 + (bit >> 3);
      m.w8(ba, m.u8(ba) | (1 << (bit & 7)));
    }
    if (m.u8(D + 0x2a) !== 0xff) {
      const c = m.s8(D + 0x2a);
      const r = tdiv(c, 10);
      const col = c % 10;
      m.w16(a4 - 11734, 0);
      m.w16(a4 - 10478 + col * 2 + r * 10, 0);
      m.w16(a4 - 15160 + col * 2 + r * 10, 0);
      m.w8(a4 - 15124 + col + r * 5, 0);
      m.w8(a4 - 15114 + col + r * 5, 0);
    }
  }
  m.w8(D + 0x2a, 0xff);
  m.w8(D + 0x22, 3);
  m.w16(D + 2, 0);
  m.w16(D + 6, 0);
  m.w8(D + 0x24, 0);
  m.w8(D + 0x25, 0);
  for (let i = 0; i < 4; i++) m.w8(D + 0x18 + i, 0);
  if (tg > 0 && tg < 6) m.w32(a4 - 15300, m.u32(a4 - 15300) + m.u32(mr + 0x40));
}

/**
 * LAB_0E3D (CODE+0x2300c) SetStatus(grp, idx, msg, resist, state, mod, ., ., ., flag): raise the
 * defender's state byte (+0x22: 0 ok, 1 asleep?, 2 paralysed?, 3 dead; names open) to `state` unless it
 * is already at least that, or the member is flagged (+0x2b). With a resist index the save is
 * Random(100) > record byte +0x94+res - mod (a failed save leaves it unchanged). State 3 or more runs
 * {@link killCleanup}.
 */
export function setStatus(m: Mem, rng: W6Rng, a4: number, args: number[]): void {
  const [tg, ti, , res, state, mod] = args;
  const D = ti * 0x2c + m.u32(a4 - 15266 + 4 * tg);
  if (m.u8(D + 0x22) >= (state & 0xffff)) return;
  if (m.u8(D + 0x2b) !== 0) return;
  const mr = (g: number) => m.u32(a4 - 15294 + 4 * g);
  if (tg === 0) for (let i = 0; i < 14; i++) m.w8(mr(0) + 0x94 + i, m.u8(a4 - 17584 + ti * 0x1b0 + i));
  if (res !== 0 && !(rng.random(100) > s16(m.u8(mr(tg) + 0x94 + res) - mod))) return;
  m.w8(D + 0x22, state);
  if (s16(state) >= 3) {
    killCleanup(m, a4, tg, ti);
  }
}


/**
 * LAB_0E4F (CODE+0x23366): the per-target spell damage engine used by the damage spells. Rolls
 * `count2 x count1` dice of `sides`, then a save: if Random(100) <= resist[res] - mod the target takes 0,
 * else the damage is scaled by {@link resistScale}. HP falls by the result; HP <= 0 calls SetStatus
 * (state 3). Dead targets (state >= 3) and flagged members (+0x2b) are untouched. Returns the damage.
 */
export function spellDamage(
  m: Mem, rng: W6Rng, a4: number, tg: number, ti: number, count1: number, sides: number, count2: number,
  res: number, mod: number,
): { dmg: number; fx: Effect[] } {
  const fx: Effect[] = [];
  m.w16(a4 - 10488, 4);
  const D = ti * 0x2c + m.u32(a4 - 15266 + 4 * tg);
  if (m.u8(D + 0x22) >= 3 || m.u8(D + 0x2b) !== 0) return { dmg: 0, fx };
  let tot = 0;
  for (let o = count2; o > 0; o--) for (let i = count1; i > 0; i--) tot = s16(tot + rng.random(sides) + 1);
  const mr = (g: number) => m.u32(a4 - 15294 + 4 * g);
  if (tg === 0) for (let i = 0; i < 14; i++) m.w8(mr(0) + 0x94 + i, m.u8(a4 - 17584 + ti * 0x1b0 + i));
  if (rng.random(100) <= s16(m.u8(mr(tg) + 0x94 + res) - mod)) tot = 0;
  else tot = resistScale(m, rng, a4, tg, tot, res, mod);
  if (tot > 0) {
    m.w16(D + 2, m.u16(D + 2) - tot);
    if (m.s16(D + 2) <= 0) fx.push(['set_status', setStatusArgs(tg, ti, 0x0d9e, 0, 3, 0)]);
  }
  return { dmg: tot, fx };
}
