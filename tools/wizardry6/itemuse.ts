/**
 * Wizardry 6 (Amiga) pass-5 item and party-order actions, ported from the game's 68k code and diffed against it
 * under Unicorn (oracle/combat4.py -> oracle/useitem-vectors.json, swap-vectors.json, postcombat-vectors.json;
 * tests __tests__/itemuse.test.ts). Original TypeScript derived from the disassembly only.
 *
 *   useItem      LAB_0F8A (`Bane` CODE+0x275f0)  the "use item" combat action
 *   swapParty    LAB_0FDB / LAB_0FDA (CODE+0x286c0 / 0x285be)  move a party member to another position
 *   postCombat   LAB_0A03 (CODE+0x17814)  sort the party by condition and decide wiped / fled
 *
 * Callees recorded, not ported (each is another harness or presentation): use_ammo LAB_0DE6 (inventory.ts
 * removeItem), spell_effect LAB_0F06 (spells.ts castEffect), refresh LAB_0DFE (portrait redraw).
 */
import { s16, skillUse, type Effect } from './combat.ts';
import { type Ctx, member } from './planner.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
const tdiv = (a: number, b: number): number => Math.trunc(a / b);
const SPELL = -31698;     // 6-byte spell rows; +1 level, +3 flag bits (bit 0 = castable fizzle, bit 1 = backfire)

/** The three bytes of a scenario item record (ReadSection section 1) the action reads: word at +28, bytes +60 and +69. */
export interface ItemRec { w28: number; b60: number; b69: number }

/**
 * LAB_0F8A. Only a party member (group 0) does anything; a monster's "use item" is a delay. The item id is the
 * member's slot `A[10]`. Item word `w28` = `(power << 8) | spell`. Item kinds 12, 13 and 16 only consume the item;
 * a spell id >= 0x50, or a word with a power byte, consume it with a message; otherwise a class-6 member derives the
 * power from skill byte +320 (/15 + 2 - the spell's level), training skill 12. Then the cast: success roll
 * `Random(level*10 + power*5) - 10` against the trained skill (`-16` = 0x18 / 0x16 chosen by the kind), fizzle or
 * backfire flags `-10482/-10484`, backfire retargets the user, then LAB_0F06(A, spell, power).
 */
export function useItem(c: Ctx, A: number, itemRec: (id: number) => ItemRec, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  const g = s16(m.u16(a4 - 15138)), i = s16(m.u16(a4 - 15136));
  if (g !== 0) return;                       // a monster's "use item" does nothing (LAB_0F9D with power 0)
  const P = a4 - 17922 + i * 0x1b0;
  const slot = s16(m.u16(A + 10));
  const rec = itemRec(m.u16(P + 64 + slot * 8));
  const w = s16(rec.w28);
  let pw = 0, sp = 0, skill = -1;
  if (w !== 0) {
    pw = tdiv(w, 256); sp = w - pw * 256;
    if (rec.b60 === 13) skill = 0x18;
    else if (rec.b60 !== 12 && rec.b60 !== 16 && sp < 0x50) {
      if (pw !== 0) skill = 0x16;
      else if (m.u8(P + 415) === 6) {
        pw = tdiv(m.u8(P + 320), 15) + 2 - m.u8(a4 - 31697 + sp * 6);
        skillUse(m, rng, a4, i, 12, 1);
        pw = Math.min(6, Math.max(0, pw));
      }
    }
    fx.push(['use_ammo', hex16(slot)]);      // every item with an effect word is used up
  }
  if (rec.b69 === 7) { m.w16(a4 - 15126, 1); skill = -1; }
  if (pw === 0) return;
  m.w16(a4 - 10484, 0); m.w16(a4 - 10482, 0);
  const r = (rng.random((m.u8(a4 - 31697 + sp * 6) * 10 + pw * 5) & 0xffff) - 10) & 0xffff;
  if (skill !== -1) {
    skillUse(m, rng, a4, i, skill, 3);
    if (r > m.u8(P + 308 + skill)) {
      if (rng.random(0x24) > m.u8(P + 307) + 18) m.w16(a4 - 10484, 1); else m.w16(a4 - 10482, 1);
    }
  }
  const flags = (): number => m.u8(a4 + SPELL + 6 * sp + 3);
  if (m.s16(a4 - 10484) === 1 && (flags() & 2) === 0) { m.w16(a4 - 10484, 0); m.w16(a4 - 10482, 1); }
  if (m.s16(a4 - 10482) === 1 && (flags() & 1) === 0) m.w16(a4 - 10482, 0);
  if (m.s16(a4 - 10482) === 1) return;       // fizzled
  if (m.s16(a4 - 10484) === 1) { m.w8(A + 31, g & 0xff); m.w8(A + 32, i & 0xff); }   // backfire: aimed at the user
  fx.push(['spell_effect', hex32(A) + hex16(sp) + hex16(pw)]);
}

/** The C-runtime exchange helper (JT -32124): swap `n` bytes between two addresses. */
function swapBytes(c: Ctx, p: number, q: number, n: number): void {
  const { m } = c;
  for (let k = 0; k < n; k++) { const x = m.u8(p + k), y = m.u8(q + k); m.w8(p + k, y); m.w8(q + k, x); }
}

/** LAB_0FDA (CODE+0x285be): exchange party members x and y: record (432 B), member struct (44 B) and the two word tables at -15330 / -15318. */
export function swapAdjacent(c: Ctx, x: number, y: number, fx: Effect[]): void {
  const { m, a4 } = c;
  swapBytes(c, a4 - 17922 + x * 0x1b0, a4 - 17922 + y * 0x1b0, 0x1b0);
  swapBytes(c, m.u32(a4 - 15266) + x * 44, m.u32(a4 - 15266) + y * 44, 44);
  for (const base of [-15330, -15318]) {
    const t = m.u16(a4 + base + 2 * y);
    m.w16(a4 + base + 2 * y, m.u16(a4 + base + 2 * x));
    m.w16(a4 + base + 2 * x, t);
  }
  fx.push(['refresh', hex16(x) + hex16(0)]);
  fx.push(['refresh', hex16(y) + hex16(0)]);
}

/** LAB_0FDB (CODE+0x286c0): move member `a` to position `b` by exchanging neighbours two places apart (rows alternate by index parity). */
export function swapParty(c: Ctx, a: number, b: number, fx: Effect[]): void {
  if (a === b) return;
  const s4 = a % 2 === b % 2 ? 0 : b % 2 === 0 ? 1 : -1;
  const s2 = a > b ? -2 : 2;
  for (let guard = 0; b + s4 !== a; guard++) {
    if (guard > 16) throw new Error('swapParty does not terminate');
    swapAdjacent(c, a, a + s2, fx);
    a += s2;
  }
  if (s4 !== 0) swapAdjacent(c, b + s4, b, fx);
}

/**
 * LAB_0A03 (CODE+0x17814): after a fight (and after the encounter banner), sort the party ascending by record byte +417
 * (condition: 0 healthy .. higher worse), then decide the outcome: every member at condition >= 2 sets game state 8
 * (the party is lost); otherwise a member flagged 2 in the combat struct (+43, a successful run) sets state 0x17.
 * Both write the flag -15130 = 1. Portrait redraws (LAB_09BA, LAB_0A02) are recorded.
 */
export function postCombat(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  for (let i = 0; i < np; i++) if (m.u8(member(c, 0, i) + 34) < 3) fx.push(['LAB_09BA', hex16(0)]);
  for (let i = 0; i < np; i++) fx.push(['LAB_0A02', hex16(i)]);
  for (let i = 0; i < np - 1; i++) {
    for (let j = i + 1; j < np; j++) {
      if (m.u8(P(i) + 417) > m.u8(P(j) + 417)) {
        swapBytes(c, P(j), P(i), 0x1b0);
        swapBytes(c, member(c, 0, j), member(c, 0, i), 44);
        for (const base of [-15330, -15318]) {
          const t = m.u16(a4 + base + 2 * i);
          m.w16(a4 + base + 2 * i, m.u16(a4 + base + 2 * j));
          m.w16(a4 + base + 2 * j, t);
        }
      }
    }
  }
  let down = 0, fled = false;
  for (let i = 0; i < np; i++) {
    if (m.u8(P(i) + 417) >= 2) down++;
    if (m.u8(member(c, 0, i) + 43) === 2) fled = true;
  }
  if (down === np) { m.w16(a4 - 18608, 8); m.w16(a4 - 15130, 1); }
  else if (fled) { m.w16(a4 - 18608, 0x17); m.w16(a4 - 15130, 1); }
}
