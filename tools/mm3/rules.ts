/**
 * Might & Magic III (Amiga) rules ports, written from the 68000 disassembly of `Might&MagicIII`
 * (see docs/mm3/amiga/game-rules.md). Each function runs against a strict sparse memory
 * (rules-mem.ts) seeded only with the bytes the real routine read under Unicorn
 * (tools/mm3/rules_oracle). Addresses: A4 = DATA + 0x7FFE; `g(disp)` = A4-relative.
 * Offsets quoted are into the root CODE hunk (`R+`) or overlay segment N (`OVn+`).
 */
import { type Mem, g } from './rules-mem.ts';

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const u16 = (v: number) => v & 0xffff;

// ---- globals (A4 displacements) ----
export const SEED = -0x2104;       // u32, the C runtime LCG state
export const YEAR = -0x1326;       // u16, current game year
export const CHAR0 = -0xc78;       // first character record, stride 0x130
export const CHAR_SIZE = 0x130;

// ---- RNG: R+0x12EA8 rand15, R+0x12EA0 srand, R+0x64D4 rand(lo,hi) ----
export function rand15(m: Mem): number {
  const s = (Math.imul(m.r32(g(SEED)), 0x41c64e6d) + 0x3039) >>> 0;
  m.w32(g(SEED), s);
  return (s >>> 16) & 0x7fff;
}
export function srand(m: Mem, seed: number): void { m.w32(g(SEED), seed >>> 0); }
/** rand(lo,hi): lo is the FIRST pushed argument. hi <= lo returns lo without drawing; k = 0x7FFF/(hi-lo+1) truncates, so hi+1 is reachable. */
export function randRange(m: Mem, lo: number, hi: number, opts: { off1?: boolean } = {}): number {
  const l = s16(lo), h = s16(hi);
  if (!(h > l)) return u16(l);
  const r = rand15(m);
  const n = h - l + 1 + (opts.off1 ? 1 : 0);
  const k = Math.trunc(0x7fff / n);
  return u16(l + Math.trunc(r / k));
}

// ---- stat engine ----
/** R+0xCE5C: bracket bonus of a value: first i with thr[i] > v (u16 table A4-0x42F0), result s8 table A4-0x567B[i]. */
export function bracket(m: Mem, v: number): number {
  let i = 0;
  while (!(m.r16(g(-0x42f0) + 2 * i) > u16(v))) i++;
  return s8(m.r8(g(-0x567b) + i));
}
/** R+0xD03E character level = +0x23 + +0x24 (both u8). */
export function charLevel(m: Mem, c: number): number { return u16(m.r8(c + 0x23) + m.r8(c + 0x24)); }
/** R+0xCE8E age: (year - birth(+0x12A)) capped at 0xFE (signed), plus +0x26 unless flag. */
export function charAge(m: Mem, c: number, flag: number): number {
  let d = s16(m.r16(g(YEAR)) - m.r16(c + 0x12a));
  if (d > 0xfe) d = 0xfe;
  return flag ? d : d + m.r8(c + 0x26);
}
/** R+0xC7AC / R+0xC7D2: first i with v <= table[i] (u8 tables A4-0x53DC / A4-0x53EC). */
function firstLe(m: Mem, tab: number, v: number): number {
  let i = 0;
  while (v > m.r8(g(tab) + i)) i++;
  return i;
}
export const c7ac = (m: Mem, v: number) => firstLe(m, -0x53dc, v);
export const c7d2 = (m: Mem, v: number) => firstLe(m, -0x53ec, v);

/** R+0xCEF0 equipment bonus of kind `k` summed over the 18 item slots. */
export function equipBonus(m: Mem, c: number, k: number): number {
  let d5 = 0;
  for (let i = 0; i < 18; i++) {
    const qty = m.r8(c + 0x7d + i);
    if (!qty) continue;
    if (m.r8(c + 0x90 + i) & 0xc0) continue;
    if (k < 0xb && k !== 3) {
      const a = m.r8(c + 0xc9 + i);
      if (a) {
        let d6 = c7d2(m, a);
        if (d6 > 2) d6++;
        if (d6 === k) d5 += s8(m.r8(g(-0x2984) + a));
      }
    }
    if (k > 0xa) {
      const a = m.r8(c + 0xa3 + i);
      if (a) {
        if (c7ac(m, a) + 0xb === k) d5 += m.r8(g(-0x2a2a) + a);
      }
    }
    if (k === 9) {
      d5 += m.r8(g(-0x27c9) + m.r8(c + 0xdc + i));
      const e = m.r8(c + 0xb6 + i);
      if (e) {
        let add = true;
        if (m.r8(c + 0xdc + i) !== 0x2a) add = !(qty === 1 || qty === 4 || qty === 13);
        if (add) d5 += s8(m.r8(g(-0x29b2) + e));
      }
    }
  }
  return u16(d5);
}

/** R+0x94FA temporary stat modifier from the condition counters +0x113..+0x11A. idx 0..5 -> 6 outputs (see below). */
export function condMod(m: Mem, c: number, idx: number): number {
  let d4 = 0, d5 = 0, d6 = 0, a2 = 0, d7 = 0, a4 = 0, a6 = 0; // a2=-2(a5) a4=-4(a5) a6=-6(a5)
  if (m.r8(c + 0x120) || m.r8(c + 0x121) || m.r8(c + 0x122)) return 0;
  const n113 = m.r8(c + 0x113);
  if (n113) a6 -= n113;
  const n118 = m.r8(c + 0x118);
  if (n118) { d6 -= n118; d5 -= n118; a4 -= n118; d4 += n118; d7 += n118; }
  const n116 = m.r8(c + 0x116);
  if (n116) { d4 -= n116; d7 -= n116; a4 -= n116; }
  const n117 = m.r8(c + 0x117);
  if (n117) { a2 -= n117; d6 -= n117; d5 -= n117; }
  const n114 = m.r8(c + 0x114);
  if (n114) { d4 -= n114; d5 -= n114; d6 -= n114; a2 -= n114; d7 -= n114; a4 -= n114; a6 -= n114; }
  const n119 = m.r8(c + 0x119);
  if (n119) { d4 += n119; d5 += n119; d6 += n119; a2 += n119; d7 += n119; a4 += n119; a6 += n119; }
  const n115 = m.r8(c + 0x115);
  if (n115) { d4 -= n115; d5 -= n115; d6 -= n115; a2 -= n115; d7 -= n115; a4 -= n115; a6 -= n115; }
  const n11a = m.r8(c + 0x11a);
  if (n11a) { d4 -= n11a; d5 -= n11a; d6 += n11a; a2 -= n11a; d7 -= n11a; a4 -= n11a; a6 += n11a; }
  const out = [d4, d5, d6, a2, d7, a4, a6];
  return s16(idx < 6 ? out[idx] : a6); // idx >= 6 branches to the case-6 block (-6(a5))
}

/** R+0xD064 effective attribute idx 0..6 (+0x14/+0x15 pairs); flag != 0 skips the condition modifier. */
export function getStat(m: Mem, c: number, idx: number, flag: number): number {
  const PAIRS: [number, number, number][] = [[0x14, 0x15, 0], [0x16, 0x17, 1], [0x18, 0x19, 1], [0x1a, 0x1b, 0], [0x1c, 0x1d, 0], [0x1e, 0x1f, 0], [0x20, 0x21, 2]];
  const [a, b, cls] = PAIRS[idx];
  let d4 = m.r8(c + a), d6 = m.r8(c + b);
  if (cls < 2) {
    const age = s16(charAge(m, c, 0));
    let i = 0;
    while (!(age < m.r16(g(-0x540a) + 2 * i))) i++;
    d4 = s16(d4 + m.r16(g(-0x5432) + cls * 0x14 + 2 * i));
  }
  d4 = s16(d4 + equipBonus(m, c, idx));
  if (!flag) { d4 = s16(d4 + condMod(m, c, idx)); d4 = s16(d4 + d6); } // flag != 0 skips both the condition modifier and the temp byte (+b)
  return d4 >= 1 ? d4 : 0;
}

/** R+0xAD56 maximum hit points. */
export function maxHp(m: Mem, c: number): number {
  let d4 = m.r8(g(-0x25ee) + m.r8(c + 0x13));
  d4 += bracket(m, getStat(m, c, 3, 0));
  d4 += s8(m.r8(g(-0x53a1) + m.r8(c + 0x11)));
  if (m.r8(c + 0x2a)) d4 += 1;
  if (d4 < 1) d4 = 1;
  d4 = Math.imul(charLevel(m, c), d4) | 0;
  d4 = (d4 + equipBonus(m, c, 7)) | 0;
  if (d4 < 0) d4 = 0;
  return d4 >>> 0;
}
/** R+0xADE6 armour class (flag != 0 omits the +0x102 and +0x22 terms). */
export function armourClass(m: Mem, c: number, flag: number): number {
  let d4 = bracket(m, getStat(m, c, 4, 0));
  d4 = s16(d4 + equipBonus(m, c, 9));
  if (!flag) { d4 = s16(d4 + m.r8(c + 0x102)); d4 = s16(d4 + m.r8(c + 0x22)); }
  return d4 >= 1 ? d4 : 0;
}

/** OV4+0x82B0: rand(1, x+0x32) <= x. */
export function simpleCheck(m: Mem, x: number): number {
  const r = randRange(m, 1, s16(x + 0x32));
  return s16(r) > s16(x) ? 0 : 1;
}
const SAVE_KIND: Record<number, [number, number, number]> = { 1: [0x10, 0x111, 0x112], 2: [0xb, 0x107, 0x108], 3: [0xc, 0x10b, 0x10c], 4: [0xd, 0x109, 0x10a], 5: [0xe, 0x10d, 0x10e], 6: [0xf, 0x10f, 0x110] };
/** OV4+0x82DC saving throw. type 0 = luck save; 1..6 = element/category saves. Returns 1 on success. */
export function savingThrow(m: Mem, c: number, type: number, opts: { off?: number } = {}): number {
  let d4: number, bias: number;
  if (type === 0) {
    const lvl = charLevel(m, c);
    const luck = getStat(m, c, 6, 0);
    d4 = s16(lvl + bracket(m, (luck << 1) & 0xffff));
    bias = 0x14;
  } else {
    const [k, o1, o2] = SAVE_KIND[type];
    d4 = s16(equipBonus(m, c, k) + m.r8(c + o1) + m.r8(c + o2));
    bias = 0x28;
  }
  const roll = s16(randRange(m, 1, s16(d4 + bias + (opts.off ?? 0))));
  return roll > d4 ? 0 : 1;
}

/** R+0xECE8 apply damage to a character: +0x126 is the signed HP word. */
export function damageChar(m: Mem, c: number, dmg: number): void {
  m.w16(c + 0x126, m.r16(c + 0x126) - dmg);
  let d5 = s16(m.r16(c + 0x126)) > -10 ? 0 : 1;
  if (s16(m.r16(c + 0x126)) < 1) {
    const d4 = s16(maxHpLow(m, c) + s16(m.r16(c + 0x126)));
    if (d4 < 1) { m.w8(c + 0x120, 1); d5 = 1; m.w16(c + 0x126, 0); } else m.w8(c + 0x11f, 1);
    if (d5) {
      for (let i = 0; i < 18; i++) {
        const id = m.r8(c + 0xdc + i);
        if (id > 0x21 && id < 0x2a && m.r8(c + 0x7d + i)) { m.w8(c + 0x90 + i, m.r8(c + 0x90 + i) | 0x80); break; }
      }
    }
  }
}
/** the low word of R+0xAD56 (what ECE8 sums into a signed word) */
const maxHpLow = (m: Mem, c: number) => s16(maxHp(m, c));

// ---- monster attacks a character: R+0x9E02 ----
export const MON = { DmgN: -0x5fb8, DmgS: -0x5f5e, DmgT: -0x5d42, Spec: -0x5c8e } as const;
export type Call = [string, number[]];
const sat = (m: Mem, a: number) => { const v = (m.r8(a) + 1) & 0xff; m.w8(a, v === 0 ? 0xff : v); };
/** R+0x9DCC: every item with id < 0x48 gets flag 0x80 (+0x90 array). */
export function flagAllItems(m: Mem, c: number): void {
  for (let i = 0; i < 18; i++) if (m.r8(c + 0xdc + i) < 0x48) m.w8(c + 0x90 + i, m.r8(c + 0x90 + i) | 0x80);
}
/** monster `mon` (word, signed index) strikes character `c`; `slot` is the party position used only for the hit animation. Returns the logged UI/apply calls. */
export function monsterAttack(m: Mem, c: number, slot: number, mon: number, opts: { noHalve?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  const mi = s16(mon);
  m.w8(c + 0x11b, 0);
  let d5 = 0, d6 = 0, d7 = 4;
  const n = m.r8(g(MON.DmgN) + mi);
  for (let d4 = 0; d4 < n; d4++) d5 = s16(d5 + randRange(m, 1, m.r8(g(MON.DmgS) + mi)));
  const type = m.r8(g(MON.DmgT) + mi);
  if (type !== 0) {
    if (savingThrow(m, c, 0) && !opts.noHalve) d5 = d5 >> 1;
    switch (type) {
      case 1: d6 = 6; break;
      case 2: d5 = s16(d5 - m.r16(g(-0x1322))); d6 = 1; d7 = 0xd; break;
      case 3: d5 = s16(d5 - m.r16(g(-0x1320))); d6 = 2; d7 = 0xe; break;
      case 4: d5 = s16(d5 - m.r16(g(-0x131e))); d6 = 3; d7 = 0xf; break;
      case 5: d5 = s16(d5 - m.r16(g(-0x131c))); d6 = 4; d7 = 0x11; break;
      case 6: d6 = 5; break;
    }
    for (;;) {
      if (!savingThrow(m, c, type)) break;
      d5 = d5 >> 1;
      if (d5 === 0) break;
    }
  }
  calls.push(['ui971c', [d7]]);
  if (s16(slot) >= 0 && s16(slot) < 8) {
    m.r32(g(0xcaa));
    calls.push(['draw945e', [d6, u16(s16(slot) * 0x26 + 0xb), 0x95, 0]]);
  }
  d5 = s16(d5 - m.r8(c + 0x103));
  if (d5 < 1) d5 = 0;
  if (d5 !== 0 && m.r8(g(MON.Spec) + mi) !== 0 && !savingThrow(m, c, 0)) {
    const sp = m.r8(g(MON.Spec) + mi);
    switch (sp) {
      case 1: sat(m, c + 0x116); calls.push(['ui971c', [0x11]]); break;
      case 2: sat(m, c + 0x11b); calls.push(['ui971c', [0x35]]); break;
      case 3: sat(m, c + 0x118); calls.push(['ui971c', [0x35]]); break;
      case 4: sat(m, c + 0x117); calls.push(['ui971c', [0x11]]); break;
      case 5: sat(m, c + 0x11d); calls.push(['ui971c', [0x35]]); break;
      case 6: sat(m, c + 0x113); calls.push(['ui971c', [0x35]]); break;
      case 7:
        for (let i = 0; i < 18; i++) {
          const id = m.r8(c + 0xdc + i);
          if (id < 0x22 || id > 0x29) continue;
          if (!m.r8(c + 0x7d + i)) continue;
          m.w8(c + 0x90 + i, m.r8(c + 0x90 + i) | 0x80); break;
        }
        calls.push(['ui971c', [0x35]]); break;
      case 8: sat(m, c + 0x115); calls.push(['ui971c', [0x35]]); break;
      case 9: m.w16(c + 0x128, 0); calls.push(['ui971c', [0x35]]); break;
      case 10: sat(m, c + 0x11e); calls.push(['ui971c', [0x35]]); break;
      case 11: m.w8(c + 0x26, (m.r8(c + 0x26) + 5) & 0xff); calls.push(['ui971c', [0x35]]); break;
      case 12: sat(m, c + 0x11f); calls.push(['ui971c', [0x35]]); m.w16(c + 0x126, 0); break;
      case 13: sat(m, c + 0x122); flagAllItems(m, c); calls.push(['ui971c', [0x35]]); m.w16(c + 0x126, 0); break;
      case 14: sat(m, c + 0x121); m.w16(c + 0x126, 0); calls.push(['ui971c', [0x35]]); break;
      case 15: sat(m, c + 0x120); m.w16(c + 0x126, 0); calls.push(['ui971c', [0x35]]); break;
      case 16:
        for (let i = 0; i < 18; i++) if (m.r8(c + 0xdc + i) < 0x46) m.w8(c + 0x90 + i, m.r8(c + 0x90 + i) | 0x40);
        calls.push(['ui971c', [0x35]]); break;
    }
  }
  calls.push(['applyECE8', [c, u16(d5)]]);
  return calls;
}

// ---- party member attacks a monster ----
const W = { dice: 0x330a, nDice: 0x330b, dmg: 0x330c, hit: 0x330e, el2: 0x330f, el: 0x3310 } as const;
/** R+0x11DA6 weapon select + damage roll: the LAST qualifying item slot wins (but every qualifying slot rolls its dice). mode 0: slot code 1 or 13; mode != 0: slot code 4. Results in A4+0x330A..0x3310. */
export function weaponDamage(m: Mem, c: number, mode: number): void {
  m.w8(g(W.dice), 0); m.w8(g(W.nDice), 0); m.w16(g(W.dmg), 0); m.w8(g(W.hit), 0); m.w8(g(W.el2), 0); m.w8(g(W.el), 0);
  for (let i = 0; i < 18; i++) {
    const q = m.r8(c + 0x7d + i);
    const ok = mode ? q === 4 : q === 1 || q === 13;
    if (!ok) continue;
    m.w8(g(W.el), m.r8(c + 0xa3 + i));
    m.w8(g(W.el2), m.r8(c + 0xef + i));
    const b6 = m.r8(c + 0xb6 + i);
    m.w8(g(W.hit), s8(m.r8(g(-0x29e0) + b6)) + m.r8(c + 0x105));
    m.w16(g(W.dmg), s8(m.r8(g(-0x29c9) + b6)) + m.r8(c + 0x104));
    const id = m.r8(c + 0xdc + i);
    m.w8(g(W.nDice), m.r8(g(-0x2780) + id));
    m.w8(g(W.dice), m.r8(g(-0x2737) + id));
    for (let d = 0; d < s8(m.r8(g(W.nDice))); d++) m.w16(g(W.dmg), m.r16(g(W.dmg)) + randRange(m, 1, s8(m.r8(g(W.dice)))));
  }
  if (s16(m.r16(g(W.dmg))) < 1) m.w16(g(W.dmg), 0);
}
const CLASS_DIV = [1, 2, 2, 3, 4, 2, 2, 1, 3, 2];
export const TARGET = -0x3f2b;       // u8: index of the monster being attacked
const MON_STATUS = 0x188e, MON_TYPE = 0x173a, MON_AC = -0x606c;
/** OV4+0x12C38 party member attacks the monster in target slot: weapon damage first, then the to-hit roll. Returns 1 on a hit. */
export function partyHit(m: Mem, c: number, mode: number, opts: { noReroll?: boolean } = {}): number {
  weaponDamage(m, c, mode);
  let d4 = s16(bracket(m, getStat(m, c, 5, 0)));
  d4 = s16(d4 + s8(m.r8(g(W.hit))));
  const div = CLASS_DIV[m.r8(c + 0x13)];
  d4 = s16(d4 + Math.trunc(charLevel(m, c) / div));
  for (;;) {                                   // a natural 20 adds and rolls again (OV4+0x12CD8 beq 12CC2)
    const roll = randRange(m, 1, 20);
    d4 = s16(d4 + roll);
    if (roll !== 20 || opts.noReroll) break;
  }
  d4 = s16(d4 - m.r8(c + 0x113));
  const t = m.r8(g(TARGET));
  if (m.r16(g(MON_STATUS) + 2 * t) !== 0) d4 = s16(d4 + 20);
  const d6 = 10 + m.r8(g(MON_AC) + m.r16(g(MON_TYPE) + 2 * t));
  return d4 >= d6 ? 1 : 0;
}
const RES = [-0x58b0, -0x5856, -0x57fc, -0x57a2, -0x5748];   // fire, elec, cold, acid, energy (u8 per monster type)
/** OV4+0x12D56 (kind 0 or 3): damage of the weapon's element after the monster's resistance: base = u8 A4-0x2A05[el]; the resist table is chosen by el (<9 fire, <0x10 elec, <0x15 cold, <0x1a acid, <0x22 energy, else magic A4-0x590A). */
export function elementDamage(m: Mem, kind: number): number {
  if (kind !== 0 && kind !== 3) {
    // spell kinds: base stays 0, so the result is always 0; the game still reads A4+0x332E and the matching resistance byte (OV4+0x12E76, jump table 0x12F66)
    const k = m.r16(g(0x332e));
    if (k < 7) m.r8(g([-0x56ee, -0x590a, -0x58b0, -0x5856, -0x57fc, -0x57a2, -0x5748][k]) + m.r16(g(MON_TYPE) + 2 * m.r8(g(TARGET))));
    return 0;
  }
  const el = s8(m.r8(g(W.el)));
  const base = m.r8(g(-0x2a05) + el);
  let d5 = base, d4: number;
  if (m.r8(g(W.el)) === 0) d4 = 0;
  else {
    const t = m.r16(g(MON_TYPE) + 2 * m.r8(g(TARGET)));
    const bounds = [9, 0x10, 0x15, 0x1a, 0x22];
    let k = bounds.findIndex(b => el < b);
    const tab = k < 0 ? -0x590a : RES[k];
    d4 = m.r8(g(tab) + t);
  }
  if (d4 !== 0) {
    if (d4 === 100) d5 = 0;
    else d5 = s16(Math.trunc((s16(d5) * (100 - d4)) / 100));
  }
  return u16(d5);
}

// ---- melee round, damage per hit, experience split ----
/** OV4+0x13048 damage of one successful hit: Might bracket bonus + the weapon damage left in A4+0x330C by weaponDamage; floor 0 */
export function damagePerHit(m: Mem, c: number): number {
  const d4 = s16(bracket(m, getStat(m, c, 0, 0)) + m.r16(g(W.dmg)));
  return d4 >= 1 ? d4 : 0;
}
const SWING_DIV = [5, 6, 6, 7, 8, 6, 5, 4, 7, 6];
/** OV4+0x13282 (mode 0): one character's melee turn. swings = level / div[class] + 1 (div = 5,6,6,7,8,6,5,4,7,6 for classes 0..9); each swing is partyHit() and each hit adds damagePerHit(); the total goes to the monster-damage routine OV4+0x136E2(char, total, 0) (logged, not modelled here), then OV4+0x1307C. */
export function meleeRound(m: Mem, c: number, opts: { swings?: number } = {}): Call[] {
  const swings = opts.swings ?? (Math.trunc(charLevel(m, c) / SWING_DIV[m.r8(c + 0x13)]) + 1);
  let d5 = 0;
  for (let i = 0; i < swings; i++) if (partyHit(m, c, 0)) d5 = s16(d5 + damagePerHit(m, c));
  return [['apply136E2', [c, u16(d5), 0]], ['call1307C', []]];
}
/** R+0xCEC6 highest non-zero condition counter (+0x113..+0x122, scanned 15 -> 0), 0x10 when none */
export function worstCondition(m: Mem, c: number): number {
  for (let i = 15; i >= 0; i--) if (m.r8(c + 0x113 + i)) return i;
  return 0x10;
}
export const PARTY_MODE = -0x104a, PARTY_N = -0x1672, LIST_N = 0x1f74, LIST = -0xc81;
/** OV4+0x12FB0 experience award: every member (dead or not - the condition switch is vacuous) gets amount / memberCount added to the u32 at +0x12C. */
export function xpSplit(m: Mem, amount: number, opts: { skipDead?: boolean } = {}): void {
  const list = m.r8(g(PARTY_MODE)) === 2;
  const n = list ? m.r8(g(LIST_N)) : m.r8(g(PARTY_N));
  let cnt = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let d = 0; d < n; d++) {
      const idx = list ? m.r8(g(LIST) + d) : d;
      const c = g(CHAR0) + idx * CHAR_SIZE;
      const cond = worstCondition(m, c);
      if (opts.skipDead && cond >= 13 && cond <= 15) continue;
      if (pass === 0) cnt++;
      else m.w32(c + 0x12c, (m.r32(c + 0x12c) + Math.trunc((amount | 0) / cnt)) >>> 0);
    }
  }
}

// ---- spell points and experience thresholds ----
/** R+0xAC46 maximum spell points (0 when +0x7A is zero). Classes 4 (Sorcerer) and 2 (Archer) use Intellect (stat 1) and bit +0x34; others Personality (2) and +0x33; classes 8/9 (Druid/Ranger) average two passes (stat 2 then 1) with +0x29. */
export function maxSp(m: Mem, c: number): number {
  if (!m.r8(c + 0x7a)) return 0;
  const cls = m.r8(c + 0x13);
  let d5: number, d6: number;
  if (cls === 4 || cls === 2) { d5 = 1; d6 = 0xd; } else { d5 = 2; d6 = 0xc; }
  if (cls === 8 || cls === 9) d6 = 2;
  let d7 = 0, saved = 0, d4 = 0;
  for (;;) {
    d4 = bracket(m, getStat(m, c, d5, 0)) + 3;
    d4 += s8(m.r8(g(-0x53ab) - 1 + 2 * m.r8(c + 0x11) + d5));
    if (m.r8(c + 0x27 + d6)) d4 += 2;
    if (d4 < 1) d4 = 1;
    d4 = Math.imul(charLevel(m, c), d4) >>> 0;
    if (!(cls === 4 || cls === 3 || cls === 8)) d4 = (d4 | 0) >> 1;
    if (d7 === 0 && (cls === 8 || cls === 9)) { d5 = 1; d7 = 1; saved = d4; continue; }
    break;
  }
  if (d7) d4 = ((d4 + saved) | 0) >> 1;
  d4 = (d4 + equipBonus(m, c, 8)) | 0;
  if (d4 < 0) d4 = 0;
  return d4 >>> 0;
}
/** R+0x88FC experience a character holds when it reaches its next level: XP + need, need = classTab[class] << (L-2) for L = level in 2..12 (u16 table A4-0x3FCA), (L-12) * 0xFA000 + (classTab << 10) beyond; level 1 returns XP unchanged. */
export function xpNextLevel(m: Mem, c: number): number {
  const d4 = m.r8(c + 0x23) - 1;
  if (d4 < 12) {
    if (d4 === 0) return m.r32(c + 0x12c);
  }
  let d6: number, d5: number;
  if (d4 < 12) { d6 = 0; d5 = d4 - 1; } else { d6 = d4 - 11; d5 = 10; }
  const tab = m.r16(g(-0x3fca) + 2 * m.r8(c + 0x13));
  const sh = d5 & 63;                         // 68k ASL.L: count is taken mod 64, >= 32 shifts everything out
  const need = (Math.imul(d6, 0xfa000) + (sh >= 32 ? 0 : s16(tab) << sh)) >>> 0;
  return (need + m.r32(c + 0x12c)) >>> 0;
}
