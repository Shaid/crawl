/**
 * Might & Magic III (Amiga) rules ports, pass 4: world rules (rest, ...). docs/mm3/amiga/game-rules.md section 18.
 * Method as rules.ts: strict sparse memory seeded only with the bytes the real routine read under Unicorn
 * (tools/mm3/rules_oracle/rules4.py); UI/message leaves are logged stubs in the harness. `R+` = root, `OVn+` = overlay n.
 */
import { type Mem, g } from './rules-mem.ts';
import { type Call, CHAR0, CHAR_SIZE, charLevel, damageChar, equipBonus, getStat, maxHp, maxSp, randRange, savingThrow, worstCondition, xpNextLevel } from './rules.ts';
import { castBlocked, levelThreshold, pay, xpShortfall } from './rules2.ts';
import { wipeCheck } from './rules3.ts';

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const u16 = (v: number) => v & 0xffff;
const chr = (i: number) => g(CHAR0) + i * CHAR_SIZE;
/** pointer arguments are logged as code offset (strings in the root hunk) or 0x1000000 + A4 displacement (DATA buffers) */
const BUF_1280 = 0x1000000 - 0x1280;

export const REST = { count: -0x1672, mode: -0x104a, x: -0x1667, y: -0x1666, map: 0xdb9, food: -0x1318, outdoors: -0x3305, redraw: -0x32e1 } as const;
/** scripted inputs of the harness: walk-test result (OV4+0x57C), yes/no answers (R+0x8A40), per-tick "interrupted" flags (OV4+0x108EC) */
export interface RestIo { walk: number[]; yn: number[]; ticks: number[] }
export interface RestOpts { noFoodGate?: boolean; noInterrupt?: boolean; noSleep?: boolean }

/**
 * R+0xFEA6 rest. Refused ("Too dangerous to rest here!") when the walk test OV4+0x57C(x, y, 4) is non-zero or the map's rest-permission
 * byte (A4-0xDE + map*0x340 + 0x30E) is 0. A member with an attribute (D064, flag 0) below 1 prompts "Some Chars may die. Rest anyway?";
 * "no" ends the command. Everybody falls asleep (+0x11B = 1), the mode becomes 5 and ten ticks of OV4+0x108EC run (an interruption leaves
 * the mode at 1: the mode is restored and the rest ends there, sleepers stay asleep); mode 12 skips the ticks. Time passes 0x17C minutes
 * (A4-0x3305 != 0) or 0x1D6, 0x1E0 from mode 12. Each member wakes; with food left and worst condition outside 0xD..0xF it eats one food, loses the
 * four buffs (+0x102..0x105) and +0x11F, and gets HP/SP back to the maxima; a member met with no food flags starvation.
 */
export function rest(m: Mem, io: RestIo, opts: RestOpts = {}): Call[] {
  const calls: Call[] = [];
  const x = m.r8(g(REST.x)), y = m.r8(g(REST.y));
  calls.push(['walk', [x, y, 4]]);
  const walk = io.walk.length ? io.walk.shift()! : 0;
  if (u16(walk) !== 0 || m.r8(g(-0xde) + s8(m.r8(g(REST.map))) * 0x340 + 0x30e) === 0) { calls.push(['msg', [0x100a4]]); return calls; }
  const n = m.r8(g(REST.count));
  outer: for (let i = 0; i < n; i++) {
    for (let k = 0; k <= 6; k++) {
      if (u16(getStat(m, chr(i), k, 0)) < 1) {
        calls.push(['yesno', [0x100c0, 0]]);
        if (!(io.yn.length ? io.yn.shift()! : 0)) return calls;
        break outer;
      }
    }
  }
  if (!opts.noSleep) for (let i = 0; i < n; i++) m.w8(chr(i) + 0x11b, 1);
  const saved = m.r8(g(REST.mode));
  m.w8(g(REST.mode), 5);
  if (saved !== 12) {
    for (let t = 0; t < 10; t++) {
      calls.push(['tick', []]);
      if (io.ticks.length && io.ticks.shift()!) m.w8(g(REST.mode), 1);
      calls.push(['redraw', []]);
      if (m.r8(g(REST.mode)) === 1 && !opts.noInterrupt) { m.w8(g(REST.mode), saved); return calls; }
    }
    calls.push(['timepass', [m.r8(g(REST.outdoors)) ? 0x17c : 0x1d6]]);
  } else calls.push(['timepass', [0x1e0]]);
  calls.push(['b64a', [0]]);
  let starving = 0, fed = 0;
  for (let i = 0; i < n; i++) {
    const c = chr(i);
    m.w8(c + 0x11b, 0);
    if (m.r16(g(REST.food)) !== 0 || opts.noFoodGate) {
      const cond = worstCondition(m, c) & 0xff;
      if (cond < 0xd || cond > 0xf) {
        m.w16(g(REST.food), m.r16(g(REST.food)) - 1);
        fed++;
        for (const off of [0x105, 0x104, 0x103, 0x102, 0x11f]) m.w8(c + off, 0);
        m.w16(c + 0x126, maxHp(m, c));
        m.w16(c + 0x128, maxSp(m, c));
      }
    } else starving = 1;
  }
  m.w8(g(REST.mode), saved);
  m.w8(g(REST.redraw), 1);
  calls.push(['redraw', []]);
  calls.push(['sprintf', [BUF_1280, 0x100e1, starving ? 0x1011c : 0x10138, fed]]);
  calls.push(['msg', [BUF_1280]]);
  wipeCheck(m);
  return calls;
}

// ---------------------------------------------------------------- shop / inventory prices (overlay 7)
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
export const PRICE = { base: -0x293a, ench1Mul: -0x299b, ench3: -0x2a05, ench2: -0x2984, ench4: -0x26a4, divisor: -0x3c95 } as const;
export interface PriceOpts { noBrokenZero?: boolean; ignoreDivisor?: boolean; noKindScale?: boolean }
/**
 * OV7+0x3CC item price `(char, slot, mode, flags)`. Items with id 0..0x49, 0x4B or 0x52 have a price (0 otherwise).
 * Base value `u16 A4-0x293A[id]` (0x4B: 2000, 0x52: 1000), scaled by the item's `+0xB6` kind: 1 -> /10, 2 -> /4, 3 -> /2, 4 -> x3/4,
 * 0 and >= 5 -> `* s8 A4-0x299B[kind]`. Enchantment values (x100 each): `u8 A4-0x2A05[+0xA3]`, `s8 A4-0x2984[+0xC9]`, `u16 A4-0x26A4[+0xEF]`.
 * mode 1 and 2 return `(base + three enchantment terms) / u8 A4-0x3C95[flags & 0x7F]`; when the item is broken or cursed (`+0x90 & 0xC0`)
 * and the sell flag is on (flags & 0x80, or flags > 0x80 with mode 2) the enchantment terms and the base are dropped (price 0).
 * mode 3..6 return the charges `+0x90 & 0x3F` (the recharge/other services); mode 0 returns 0; mode >= 7 returns an uninitialised local (not modelled).
 */
export function itemPrice(m: Mem, c: number, slot: number, mode: number, flags: number, opts: PriceOpts = {}): number {
  const id = m.r8(c + 0xdc + slot);
  if (!(id <= 0x49 || id === 0x4b || id === 0x52)) return 0;
  const f = s16(flags) > 0x80 && u16(mode) === 2 ? 1 : flags & 0x80;
  const d6 = flags & 0x7f;
  let d5 = id === 0x4b ? 2000 : id === 0x52 ? 1000 : m.r16(g(PRICE.base) + 2 * id);
  const kind = m.r8(c + 0xb6 + slot);
  if (!opts.noKindScale) {
    switch (kind) {
      case 1: d5 = Math.floor(d5 / 10); break;
      case 2: d5 >>>= 2; break;
      case 3: d5 >>>= 1; break;
      case 4: d5 = (d5 - (d5 >>> 2)) >>> 0; break;
      default: d5 = Math.imul(d5, s8(m.r8(g(PRICE.ench1Mul) + (kind < 5 ? 0 : kind)))) >>> 0; break;
    }
  }
  let d7 = Math.imul(m.r8(g(PRICE.ench3) + m.r8(c + 0xa3 + slot)), 100);
  let l4 = Math.imul(s8(m.r8(g(PRICE.ench2) + m.r8(c + 0xc9 + slot))), 100);
  let l8 = m.r16(g(PRICE.ench4) + 2 * m.r8(c + 0xef + slot));
  const mo = u16(mode);
  let res = 0;
  if (mo === 0) return 0;
  if (mo === 1 || mo === 2) {
    if ((m.r8(c + 0x90 + slot) & 0xc0) !== 0 && f !== 0 && !opts.noBrokenZero) { l8 = 0; l4 = 0; d7 = 0; d5 = 0; }
    const sum = (d5 + d7 + l4 + l8) >>> 0;
    res = opts.ignoreDivisor ? sum : Math.floor(sum / m.r8(g(PRICE.divisor) + d6));
  } else if (mo <= 6) res = m.r8(c + 0x90 + slot) & 0x3f;
  else throw new Error('mode >= 7 reads an uninitialised local');
  return res >>> 0;
}
/** OV7+0x7E0 price for the identify/repair text: `itemPrice` (1 for ids above 0x49), logged name formatter OV7+0x5CC and sprintf. */
export function itemPriceText(m: Mem, c: number, slot: number, mode: number, sel: number, flags: number): { ret: number; calls: Call[] } {
  const calls: Call[] = [];
  let d4 = itemPrice(m, c, slot, mode, flags);
  if (m.r8(c + 0xdc + slot) > 0x49) d4 = 1;
  calls.push(['name', [slot, 0x1000000 - 0x1154, 1]]);
  calls.push(['sprintf', [0x1000000 - 0x1a86, 0x2000000 + 7 * 0x100000 + 0x858, 0x2000000 + 7 * 0x100000 + (sel ? 0x86c : 0x875), 0x1000000 - 0x1154, d4]]);
  return { ret: d4 >>> 0, calls };
}

// ---------------------------------------------------------------- training hall (overlay 5)
const OV5 = 0x2000000 + 5 * 0x100000;
const cptr = (c: number) => 0x1000000 + (c - 0x207ffe);
export interface TrainOpts { noCap?: boolean; flatCost?: boolean }
/**
 * OV5+0x1C70 training eligibility (also builds the hall's message). Returns the XP shortfall (R+0x88CA) while the character is below the hall's
 * level cap `u8 A4-0x3AFB + currentMap(A4-0x1665)` (level < cap), 1 when the level has reached the cap (no training here whatever the XP), else 0 = may train.
 * Messages: shortfall (fmt 0x1D20: char, shortfall, level+1), cap (0x1D46: char), offer (0x1D67: char, level+1, 10*level^2 gold).
 */
export function trainEligibility(m: Mem, c: number, opts: TrainOpts = {}): { ret: number; calls: Call[] } {
  const calls: Call[] = [];
  const d4 = xpShortfall(m, c);
  const lv = m.r8(c + 0x23);
  const cap = m.r8(g(-0x3afa - 1) + m.r8(g(-0x1665)));
  const capped = opts.noCap ? false : lv >= cap;
  const buf = 0x1000000 - 0x1280;
  if (d4 !== 0 && !capped) { calls.push(['sprintf', [buf, OV5 + 0x1d20, cptr(c), d4, lv + 1]]); return { ret: d4, calls }; }
  if (capped) { calls.push(['sprintf', [buf, OV5 + 0x1d46, cptr(c)]]); return { ret: 1, calls }; }
  calls.push(['sprintf', [buf, OV5 + 0x1d67, cptr(c), lv + 1, opts.flatCost ? 10 * lv : Math.imul(lv, lv) * 10]]);
  return { ret: d4, calls };
}
export interface LevelUpOpts { noPay?: boolean; plainXp?: boolean; noMaxRestore?: boolean }
/**
 * OV5+0x1EEE the level-up command (entered with d6 = OV5+0x1C70(char) result, d5 = party index, a5 = frame). Refused while d6 != 0, when the
 * cast-gate blocks the character (OV4+0xB840), or when the gold payment `R+0x8964(0, 10*L^2, 0)` fails. Otherwise XP' = XP - (B7EC(L) - (R+0x88FC - XP))
 * (the total-XP equivalent is conserved), level + 1, the first level-up of each member in the visit advances the clock one day (0x5A0 min) and sets the member's flag at
 * a5-0x30+index, then HP and SP are set to the maxima. Returns 'ok' (stop at 0x1E70) or 'refused' (0x1FF2).
 */
export function levelUp(m: Mem, c: number, idx: number, d6: number, a5: number, opts: LevelUpOpts = {}): { stop: string; calls: Call[] } {
  const calls: Call[] = [];
  if (d6 !== 0) return { stop: 'refused', calls };
  const b = castBlocked(m, c); calls.push(...b.calls);
  if (b.blocked) return { stop: 'refused', calls };
  const L = m.r8(c + 0x23);
  if (!opts.noPay) {
    const p = pay(m, 0, Math.imul(L, L) * 10 >>> 0, 0); calls.push(...p.calls);
    if (!p.ok) return { stop: 'refused', calls };
  }
  const thr = levelThreshold(m, c);
  const eq = opts.plainXp ? m.r32(c + 0x12c) : xpNextLevel(m, c);
  const d0 = (eq - m.r32(c + 0x12c)) >>> 0;
  m.w32(c + 0x12c, (m.r32(c + 0x12c) - ((thr - d0) >>> 0)) >>> 0);
  m.w8(c + 0x23, m.r8(c + 0x23) + 1);
  if (!m.r8(a5 - 0x30 + idx)) { calls.push(['clock', [0x5a0]]); m.w8(a5 - 0x30 + idx, 1); }
  calls.push(['b64a', [1]]);
  if (!opts.noMaxRestore) { m.w16(c + 0x126, maxHp(m, c)); m.w16(c + 0x128, maxSp(m, c)); }
  return { stop: 'ok', calls };
}

// ---------------------------------------------------------------- traps, thievery, per-step tick (overlay 4)
/** OV4+0xE65C thievery skill of a character: 2*level, +15 (class 6) / +30 (class 5), race +10 (1, 3) / +5 (2) / -10 (4), plus the equipment bonus (index 10); 0 when the thievery skill byte `+0x27` is clear; floored at 0. */
export function thievery(m: Mem, c: number, opts: { noSkillGate?: boolean; noRace?: boolean } = {}): number {
  let d4 = (charLevel(m, c) * 2) & 0xffff;
  const cls = m.r8(c + 0x13);
  if (cls === 6) d4 = (d4 + 0xf) & 0xffff; else if (cls === 5) d4 = (d4 + 0x1e) & 0xffff;
  const race = m.r8(c + 0x11);
  if (!opts.noRace) {
    if (race === 1 || race === 3) d4 = (d4 + 10) & 0xffff; else if (race === 2) d4 = (d4 + 5) & 0xffff; else if (race === 4) d4 = (d4 - 10) & 0xffff;
  }
  d4 = (d4 + (equipBonus(m, c, 10) & 0xffff)) & 0xffff;
  if (!m.r8(c + 0x27) && !opts.noSkillGate) d4 = 0;
  return s16(d4) >= 1 ? s16(d4) >>> 0 : 0;
}
export const TRAP = { target: 0x70e0, count: -0x1672, timers: [-0x1322, -0x1320, -0x131e, -0x131c] } as const;
export interface TrapOpts { noPowerShield?: boolean; noHalving?: boolean; noElementTimer?: boolean }
/**
 * OV4+0xED8E trap / hazard damage `(damage, kind, target)`. Kinds 0..7 (kind >= 8 leaves a register uninitialised, not modelled; the callers use rand(0,6)):
 * 0 physical (cue 4); 1 (cue 0x12, animation 6); 2..5 subtract the party element timer A4-0x1322 / -0x1320 / -0x131E / -0x131C (cues 0xD, 0xE, 0xF, 0x11); 6 cue 0x10; 7 kills (damage = current HP, +0x120 = 1, cue 0x35).
 * For kind != 0 each victim saves (OV4+0x82DC, type = kind) repeatedly: every success halves the damage until a failed save or 0. Power Shield (+0x103) is subtracted, floor 0.
 * Target selection by the byte A4+0x70E0: 0 = every member in record order; 1 = only `target`; 2 = the first two members whose worst condition is not 0xC..0xF.
 */
export function trapDamage(m: Mem, dmg: number, kind: number, target: number, opts: TrapOpts = {}): Call[] {
  const calls: Call[] = [];
  const mode = m.r8(g(TRAP.target));
  const n = () => m.r8(g(TRAP.count));
  let d4 = s16(target), m4 = 0, m6 = 0;
  const m8 = s16(target + 1);
  m.w16(g(0x7158), 0);
  const hit = () => {
    let d5 = s16(dmg);
    const c = chr(s16(d4));
    m.w8(c + 0x11b, 0);
    let d6 = 0;
    const timer = (i: number) => (opts.noElementTimer ? 0 : m.r16(g(TRAP.timers[i])));
    switch (u16(kind)) {
      case 0: d6 = 4; break;
      case 1: d6 = 0x12; break;
      case 2: d5 = s16(d5 - timer(0)); d6 = 0xd; break;
      case 3: d5 = s16(d5 - timer(1)); d6 = 0xe; break;
      case 4: d5 = s16(d5 - timer(2)); d6 = 0xf; break;
      case 5: d5 = s16(d5 - timer(3)); d6 = 0x11; break;
      case 6: d6 = 0x10; break;
      case 7: d6 = 0x35; break;
      default: throw new Error('kind >= 8 not modelled');
    }
    if (u16(kind) !== 0 && !opts.noHalving) {
      // OV4+0x82DC with a type >= 7 never loads its bonus: it leaves the caller's D4 (here the victim's index) as the save value
      const save = () => (u16(kind) >= 7 ? (s16(randRange(m, 1, s16(d4 + 0x28))) > s16(d4) ? 0 : 1) : savingThrow(m, c, u16(kind)));
      while (save()) { d5 >>= 1; if (d5 === 0) break; }
    }
    calls.push(['cue', [d6]]);
    if (m.r8(c + 0x103) && !opts.noPowerShield) d5 = s16(d5 - m.r8(c + 0x103));
    if (d5 < 0) d5 = 0;
    if (u16(kind) === 7) { d5 = s16(m.r16(c + 0x126)); m.w8(c + 0x120, 1); }
    damageChar(m, c, d5 & 0xffff);
  };
  let jumped = false;
  if (mode === 2) {
    d4 = 0;
    for (let i = 0; i < n(); i++) {
      const cond = worstCondition(m, chr(i)) & 0xff;
      if (((cond - 0xc) & 0xffff) < 4) continue;
      if (d4 === 0) d4 = i + 1; else { m4 = i + 1; d4 -= 1; jumped = true; break; }
    }
  }
  if (!jumped) {
    d4 = mode === 0 ? 0 : d4;
    for (; s16(mode === 0 ? n() : m8) > d4; d4++) {
      hit();
      if (m4 !== 0) break;
    }
  } else hit();
  if (m4 !== 0 && m6 === 0) { d4 = m4 - 1; m6++; hit(); }
  wipeCheck(m);
  return calls;
}
/** OV4+0x108EC per-step tick: nothing while the party-wiped flag A4-0x3307 is set; else the clock runs 1 minute (10 when A4-0x3305 != 0), the monster view R+0x98CA is rebuilt when A4-0x32E0 is non-zero, and A4-0x32E0 = 3. */
export function stepTick(m: Mem): Call[] {
  const calls: Call[] = [];
  if (m.r8(g(-0x3307))) return calls;
  calls.push(['timepass', [m.r8(g(-0x3305)) ? 10 : 1]]);
  if (m.r8(g(-0x32e0))) calls.push(['monsterview', []]);
  m.w8(g(-0x32e0), 3);
  return calls;
}
