/**
 * Wizardry 6 (Amiga) end-of-combat rules, ported from the game's 68k code and diffed against it under Unicorn
 * (oracle/combat5.py -> oracle/{upkeep,compact,decay,writeback,xpsplit,loot,postfull}-vectors.json,
 * __tests__/endcombat.test.ts). Original TypeScript derived from the disassembly only.
 *
 *   memberUpkeep   LAB_09BA (`Bane` CODE+0x1693e): regeneration, poison, death, counters of one member, once per fight
 *   compactGroup   LAB_09C8 (CODE+0x16be2): upkeep of every survivor of a group, then drop the dead (state 3)
 *   decayBuffs     LAB_0AA2 (CODE+0x19144): group buffs and clouds fade by a share of their value
 *   writeBack      LAB_0A02 (CODE+0x1775e): combat struct -> character record
 *   postCombatFull LAB_0A03 (CODE+0x17814) with the real LAB_09BA / LAB_0A02
 *   xpSplit        LAB_1D9A (CODE+0x5031a): the victory XP split
 *   lootRoll       LAB_1D76 from CODE+0x4fe28: treasure record -> gold, bonus XP, item list, shares to the living
 */
import { s16, type Effect } from './combat.ts';
import { sortAndOutcome } from './itemuse.ts';
import { type Ctx, member } from './planner.ts';
import { setBit } from './scripted.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const tdiv = (a: number, b: number): number => Math.trunc(a / b);
const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const w16wrap = (v: number): number => v & 0xffff;

/**
 * LAB_09BA(g, i, a, b). Member struct M (44 bytes) of group g: +2 HP, +4 max, +6 stamina, +8 max, +14..+23 ten status counters,
 * +16 (also the exhaustion counter), +34 state (3 dead), +35 poison level, +36 blink counter, +41 initiative modifier,
 * +42 formation cell, +43 hide/run state. Returns 1 when the member died.
 *   - while the exhaustion counter +16 is set, stamina regenerates by Random(max*5/100) + 1 (capped at the maximum);
 *     stamina at or below 0 is clamped to 0 and sets the counter to Random(6) + 6;
 *   - HP changes by a - b - poison(+35), capped at the maximum; at or below 0 the member dies (HP 0, stamina 0, state 3);
 *   - a dead monster (g != 0) frees its formation cell (three tables) and, when its record flags bit 0 of +220, sets the
 *     unique-slain bit record[+218] in the bit array at -30150(A4);
 *   - then counters +14..+23 each fall by one (0xff is permanent); poison level +35 clears when counter +19 is 0; the
 *     initiative modifier moves one step toward 0; blink +36 falls by one; hide state 3 (blinked) clears.
 * Callers: LAB_0A03 (party, a = record +418 regeneration, b = record +419 poison) and LAB_09C8 (monsters, a = record +215).
 */
export function memberUpkeep(c: Ctx, g: number, i: number, a: number, b: number): number {
  const { m, rng, a4 } = c;
  const M = m.u32(a4 - 15266 + 4 * g) + i * 44;
  let died = 0;
  if (m.u8(M + 16) > 0) {
    const t = tdiv(s16(m.u16(M + 8)) * 5, 100);
    const r = rng.random(w16wrap(t)) + 1;
    m.w16(M + 6, m.u16(M + 6) + r);
    if (s16(m.u16(M + 6)) > s16(m.u16(M + 8))) m.w16(M + 6, m.u16(M + 8));
  }
  if (s16(m.u16(M + 6)) <= 0) { m.w16(M + 6, 0); m.w8(M + 16, rng.random(6) + 6); }
  const delta = s16(w16wrap(a) - w16wrap(b) - m.u8(M + 35));
  m.w16(M + 2, m.u16(M + 2) + delta);
  if (s16(m.u16(M + 2)) > s16(m.u16(M + 4))) m.w16(M + 2, m.u16(M + 4));
  if (s16(m.u16(M + 2)) <= 0) {
    m.w16(M + 2, 0); m.w16(M + 6, 0); m.w8(M + 34, 3); died = 1;
    if (g !== 0) {
      if (m.u8(M + 42) !== 0xff) {
        const v = s8(m.u8(M + 42));
        const q = tdiv(v, 10), r = v - q * 10;
        m.w8(a4 - 15124 + q * 5 + r, 0);
        m.w8(a4 - 15114 + q * 5 + r, 0);
        m.w16(a4 - 15160 + q * 10 + 2 * r, 0);
        m.w8(M + 42, 0xff);
      }
      const R = m.u32(a4 - 15294 + 4 * g);
      if (m.u8(R + 220) & 1) setBit(c, a4 - 30150, m.u8(R + 218), 1);
    }
  }
  for (let k = 0; k < 10; k++) {
    const v = m.u8(M + 14 + k);
    if (v > 0 && v !== 0xff) m.w8(M + 14 + k, v - 1);
  }
  if (m.u8(M + 19) === 0) m.w8(M + 35, 0);
  const v = s8(m.u8(M + 41));
  m.w8(M + 41, v < 0 ? v + 1 : v > 0 ? v - 1 : 0);
  if (m.u8(M + 36) > 0) m.w8(M + 36, m.u8(M + 36) - 1);
  if (m.u8(M + 43) === 3) m.w8(M + 43, 0);
  return died;
}

/** LAB_09C8(g): upkeep (a = record +215, b = 0) of every member below state 3, then keep only the members still below 3, in order. */
export function compactGroup(c: Ctx, g: number): void {
  const { m, a4 } = c;
  const gb = (): number => m.u32(a4 - 15266 + 4 * g);
  let j = 0;
  for (let i = 0; i < m.u8(gb() + 413); i++) {
    if (m.u8(member(c, g, i) + 34) < 3) memberUpkeep(c, g, i, m.u8(m.u32(a4 - 15294 + 4 * g) + 215), 0);
    if (m.u8(member(c, g, i) + 34) >= 3) continue;
    for (let k = 0; k < 44; k++) m.w8(member(c, g, j) + k, m.u8(member(c, g, i) + k));
    j++;
  }
  m.w8(gb() + 413, j);
}

/** LAB_0AA2: group trailer bytes +396..+401 (buffs) lose max(1, v / divisor) with divisors 10, 10, 12, 12, 20 and a flat 1; +402..+405 (clouds) lose 1. */
export function decayBuffs(c: Ctx): void {
  const { m, a4 } = c;
  const DIV = [10, 10, 12, 12, 20, 0];
  for (let g = 0; g < 7; g++) {
    const base = m.u32(a4 - 15266 + 4 * g);
    for (let k = 0; k < 6; k++) {
      let v = m.u8(base + 396 + k);
      if (v <= 0) continue;
      let d = DIV[k] === 0 ? 1 : tdiv(v, DIV[k]);
      if (d < 1) d = 1;
      v -= d;
      if (v < 0) v = 0;
      m.w8(base + 396 + k, v);
    }
    for (let k = 0; k < 4; k++) if (m.u8(base + 402 + k) > 0) m.w8(base + 402 + k, m.u8(base + 402 + k) - 1);
  }
  if (s16(m.u16(a4 - 18122)) > 0) m.w16(a4 - 18120, m.u8(m.u32(a4 - 15266) + 400));
  if (s16(m.u16(a4 - 18120)) <= 0) { m.w16(a4 - 18122, 0); m.w16(a4 - 18120, 0); }
}

/** LAB_0A02(i): party member i's combat struct (group 0) -> character record: HP +24, stamina +28, condition +417, ten counters +290.., poison +420. */
export function writeBack(c: Ctx, i: number): void {
  const { m, a4 } = c;
  const M = m.u32(a4 - 15266) + i * 44;
  const P = a4 - 17922 + i * 0x1b0;
  m.w16(P + 24, m.u16(M + 2));
  m.w16(P + 28, m.u16(M + 6));
  m.w8(P + 417, m.u8(M + 34));
  for (let k = 0; k < 10; k++) m.w8(P + 290 + k, m.u8(M + 14 + k));
  m.w8(P + 420, m.u8(M + 35));
}

/** LAB_0A03: upkeep each living party member once (a = +418, b = +419), death handler LAB_0A1E (recorded), write back, then sort and decide. */
export function postCombatFull(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  for (let i = 0; i < np; i++) {
    if (m.u8(member(c, 0, i) + 34) >= 3) continue;
    if (memberUpkeep(c, 0, i, m.u8(P(i) + 418), m.u8(P(i) + 419)) === 1) fx.push(['LAB_0A1E', hex16(i)]);
  }
  for (let i = 0; i < np; i++) writeBack(c, i);
  sortAndOutcome(c);
}

/** LAB_1D9A: the pool at -15300 is divided (signed 32-bit) among the members whose condition +417 is 0; each gets it added to XP +12. */
export function xpSplit(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  let living = 0;
  for (let i = 0; i < np; i++) if (m.u8(P(i) + 417) === 0) living++;
  const pool = m.u32(a4 - 15300) | 0;
  const share = tdiv(pool, living);
  fx.push(['LAB_1BE6', '']);
  for (let i = 0; i < np; i++) if (m.u8(P(i) + 417) === 0) m.w32(P(i) + 12, (m.u32(P(i) + 12) + share) >>> 0);
}

/** One 90-byte scenario item record the loot routine read: the fields it uses. */
export interface LootItem { w20: number; b22: number; b23: number; w30: number; b59: number; b60: number; b61: number }

/**
 * LAB_1D76 from LAB_1D7A (CODE+0x4fe28). `rec` is the 40-byte treasure record: six entries {A u16, B u16, type u8, pct u8}.
 * Per entry: `Random(100) < pct`, then type 1 gold = Random(A - B) + B, type 2 item id = A + Random(B) (kept when > 0),
 * type 4 bonus XP A * B (every other type does nothing). Nobody living: state 8. Otherwise gold is split among the living
 * (signed 32-bit divide), and each listed item is looked up (ReadSection 1): stackable kinds (table at -31716(A4)) roll
 * base + count dice of sides (LAB_1BEA) else 1; per-item lists -8674 (quantity), -3112 (quantity * record word +30), -8464
 * (record byte +61) and -3100 (record bit 1 of +59) are written. The living each gain the bonus XP (+12) and their gold share (+20).
 */
export function lootRoll(c: Ctx, rec: Uint8Array, item: (id: number) => LootItem, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  const W = (o: number): number => (rec[o] << 8) | rec[o + 1];
  let gold = 0, bonus = 0;
  m.w16(a4 - 3114, 0);
  for (let e = 0; e < 6; e++) {
    const roll = rng.random(100);
    if (roll >= rec[6 * e + 5]) continue;
    const A = W(6 * e), B = W(6 * e + 2);
    const type = rec[6 * e + 4];
    if (type === 1) gold += s16(w16wrap(B + rng.random(w16wrap(A - B))));
    else if (type === 2) {
      const n = s16(m.u16(a4 - 3114));
      m.w16(a4 - 5446 + 2 * n, w16wrap(A + rng.random(B)));
      if (s16(m.u16(a4 - 5446 + 2 * n)) > 0) m.w16(a4 - 3114, n + 1);
    } else if (type === 4) bonus += s16(A) * s16(B);
  }
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  let living = 0;
  for (let i = 0; i < np; i++) if (m.u8(P(i) + 417) === 0) living++;
  if (living === 0) { m.w16(a4 - 18610, 8); return; }
  gold = tdiv(gold, living);
  const count = s16(m.u16(a4 - 3114));
  for (let k = 0; k < count; k++) {
    const it = item(s16(m.u16(a4 - 5446 + 2 * k)));
    fx.push(['LAB_1BE6', '']);
    let qty = 1;
    if (m.u8(a4 - 31716 + it.b60) === 1) {
      let t = it.w20;
      let n = it.b22;
      while (n > 0) { t = w16wrap(t + rng.random(it.b23) + 1); n--; }
      qty = t & 0xff;
    }
    m.w16(a4 - 8674 + 2 * k, qty);
    m.w16(a4 - 3112 + 2 * k, w16wrap(qty * s16(it.w30)));
    m.w16(a4 - 8464 + 2 * k, it.b61);
    m.w16(a4 - 3100 + 2 * k, (it.b59 & 2) ? 1 : 0);
  }
  if (gold > 0) fx.push(['LAB_1BE6', '']);
  if (bonus > 0) fx.push(['LAB_1BE6', '']);
  for (let i = 0; i < np; i++) {
    if (m.u8(P(i) + 417) !== 0) continue;
    m.w32(P(i) + 12, (m.u32(P(i) + 12) + bonus) >>> 0);
    m.w32(P(i) + 20, (m.u32(P(i) + 20) + gold) >>> 0);
  }
  if (s16(m.u16(a4 - 3114)) > 0) fx.push(['LAB_1D2D', '']);
  m.w16(a4 - 3126, 0);
  fx.push(['LAB_1B5B', '']);
  fx.push(['LAB_1B62', hex16(2)]);
}
