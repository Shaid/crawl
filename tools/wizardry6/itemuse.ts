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
import { encounterGroup, encounterMonster } from './randenc.ts';

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

/**
 * LAB_07FA (CODE+0x120da): one time tick of party member `i`, the world's per-step / per-rest-minute rule.
 * `hpDie` (rolled), `stamMult` (stamina regeneration as a percentage of max, roll half + half + 1), `dt` the elapsed ticks
 * (scales regen +418 and the poison +419 / disease +420 drains, and counts the ten status timers +290..+299 down; 255 is
 * permanent), `spFlag` also regenerates spell points (Random(rate+1) per realm, rate = record +284+k). A member at
 * condition >= 3 (dead) is skipped; hit points <= 0 kills (condition 3, stamina 0); stamina <= 0 sets the exhaustion
 * counter +292 = Random(6)+6. Ported from the game and diffed against it (oracle/combat4.py tick -> tick-vectors.json).
 */
export function tickMember(c: Ctx, i: number, hpDie: number, stamMult: number, dt: number, spFlag: number, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  const P = a4 - 17922 + i * 0x1b0;
  if (m.u8(P + 417) >= 3) return;
  let v = (rng.random(hpDie & 0xffff) + m.u8(P + 418) * dt - m.u8(P + 419) * dt - m.u8(P + 420) * dt) & 0xffff;
  m.w16(P + 24, m.u16(P + 24) + v);
  if (s16(m.u16(P + 24)) > s16(m.u16(P + 26))) m.w16(P + 24, m.u16(P + 26));
  if (s16(m.u16(P + 24)) <= 0) {
    m.w16(P + 24, 0); m.w16(P + 28, 0); m.w8(P + 417, 3);
    fx.push(['LAB_0751', hex16(i)]);
    return;
  }
  if (s16(m.u16(P + 28)) <= 0) { m.w16(P + 28, 0); m.w8(P + 292, rng.random(6) + 6); }
  if (stamMult > 0) {
    v = tdiv(s16(m.u16(P + 30)) * stamMult, 100) & 0xffff;
    const h = tdiv(s16(v), 2);
    m.w16(P + 28, m.u16(P + 28) + ((rng.random(h & 0xffff) + h + 1) & 0xffff));
    if (s16(m.u16(P + 28)) > s16(m.u16(P + 30))) m.w16(P + 28, m.u16(P + 30));
  }
  for (let k = 0; k < 10; k++) {
    let t = m.u8(P + 290 + k);
    if (t > 0 && t !== 255) { t -= dt; if (t < 0) t = 0; m.w8(P + 290 + k, t); }
  }
  if (m.u8(P + 295) === 0 || m.u8(P + 420) === 0) { m.w8(P + 295, 0); m.w8(P + 420, 0); }
  if (spFlag > 0) {
    for (let k = 0; k < 6; k++) {
      m.w16(P + 40 + 4 * k, m.u16(P + 40 + 4 * k) + rng.random(m.u8(P + 284 + k) + 1));
      if (s16(m.u16(P + 40 + 4 * k)) > s16(m.u16(P + 42 + 4 * k))) m.w16(P + 40 + 4 * k, m.u16(P + 42 + 4 * k));
    }
  }
  fx.push(['LAB_0751', hex16(i)]);
}

/** LAB_07A0 (CODE+0x112ac): count the six party-wide minute timers (-18138 + 4k) down by `dt`; at zero the paired word (-18136 + 4k, k > 0) clears too. */
export function tickTimers(c: Ctx, dt: number): void {
  const { m, a4 } = c;
  for (let k = 0; k < 6; k++) {
    const a = a4 - 18138 + 4 * k;
    m.w16(a, m.u16(a) - dt);
    if (s16(m.u16(a)) <= 0) { m.w16(a, 0); if (k !== 0) m.w16(a + 2, 0); }
  }
}

/**
 * LAB_0808 (CODE+0x12456): camp. Up to 8 rest minutes, each advancing the world clock (-18302) by 60 and ticking every
 * member through {@link tickMember} (dt 6, spell points on, stamina regeneration = record +423, hit-point die = record
 * +422 + 1 only while wall-clock "chunks" of 4 minutes since the last rest remain), re-rolling the exhaustion counter
 * +292, curing one disease point (+420) and zeroing one random member's counter. After each minute a wandering encounter
 * interrupts with Random(1000) >= 975 (2.5 percent): returns 1. A member above 3/4 of max stamina at the end loses the
 * exhaustion counter. Diffed against the game (oracle/combat4.py rest).
 */
export function restParty(c: Ctx, fx: Effect[]): number {
  const { m, rng, a4 } = c;
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  m.w16(a4 - 10886, 0);
  let left = 8;
  m.w32(a4 - 18294, (m.u32(a4 - 18294) + ((m.u32(a4 - 18302) - m.u32(a4 - 18298)) | 0)) >>> 0);
  let minutes = s16(tdiv(m.u32(a4 - 18294) | 0, 60));
  let chunks = 0;
  while (minutes >= 4) { chunks++; minutes -= 4; m.w32(a4 - 18294, (m.u32(a4 - 18294) - 240) >>> 0); }
  m.w32(a4 - 18298, m.u32(a4 - 18302));
  while (left > 0 && m.s16(a4 - 10886) === 0 && m.s16(a4 - 18610) === 5) {
    for (let i = 0; i < np; i++) { m.w8(P(i) + 292, 10); fx.push(['LAB_0751', hex16(i)]); }
    left--;
    m.w32(a4 - 18302, (m.u32(a4 - 18302) + 60) >>> 0);
    tickTimers(c, 60);
    for (let i = 0; i < np; i++) {
      tickMember(c, i, chunks > 0 ? m.u8(P(i) + 422) + 1 : 0, m.u8(P(i) + 423), 6, 1, fx);
      m.w8(P(i) + 292, rng.random(5));
      if (m.u8(P(i) + 420) > 0) m.w8(P(i) + 420, m.u8(P(i) + 420) - 1);
    }
    chunks--;
    m.w8(P(rng.random(np)) + 292, 0);
    if (rng.random(1000) >= 0x3cf) return 1;
  }
  for (let i = 0; i < np; i++) {
    if (s16(m.u16(P(i) + 28)) > tdiv(s16(m.u16(P(i) + 30)) * 3, 4)) m.w8(P(i) + 292, 0);
    fx.push(['LAB_0751', hex16(i)]);
  }
  return 0;
}

const REM = (a: number, b: number): number => a - tdiv(a, b) * b;

/**
 * The per-step world tick, the tail of the post-move routine LAB_08A7 from LAB_08AE (CODE+0x13d60) to LAB_08BD
 * (CODE+0x13f1c). Returns false when it ended the step with a new game state (party wiped = 8, encounter = 10) and
 * true when it fell through. Rules: the clock (-18302) advances one unit per step; on clock % 10 == 5 every living member
 * ticks once (dt 1) and the member whose slot equals (clock % 60) / 10 pays hunger: stamina -= encumbrance (+421) + 1 and
 * also regenerates spell points; if no member is at condition 0 the party is lost (state 8); if every member has an
 * exhaustion counter (+292 or +293) the party camps (restParty), and an interrupted camp starts a wandering encounter;
 * otherwise each step is a wandering encounter with Random(1000) >= 995 (0.5 percent). The encounter id comes from
 * encounterGroup(level) / encounterMonster (randenc.ts) and is stored through the pointer at -18306. Diffed against the game
 * (oracle/combat4.py steptick, with the bit-map and zone code after LAB_08BD left out).
 */
export function stepTick(c: Ctx, fx: Effect[]): boolean {
  const { m, rng, a4 } = c;
  const np = s16(m.u16(a4 - 15306));
  const P = (i: number): number => a4 - 17922 + i * 0x1b0;
  const clock = (m.u32(a4 - 18302) + 1) >>> 0;
  m.w32(a4 - 18302, clock);
  if (REM(clock, 10) === 5) {
    for (let i = 0; i < np; i++) {
      if (m.u8(P(i) + 417) >= 3) continue;
      const flag = i === tdiv(REM(clock, 60), 10) ? 1 : 0;
      if (flag) {
        m.w16(P(i) + 28, m.u16(P(i) + 28) - (m.u8(P(i) + 421) + 1));
        if (s16(m.u16(P(i) + 28)) < 0) m.w16(P(i) + 28, 0);
      }
      tickMember(c, i, 0, 0, 1, flag, fx);
    }
  }
  let healthy = 0, tired = 0;
  for (let i = 0; i < np; i++) {
    if (m.u8(P(i) + 417) === 0) healthy++;
    if (m.u8(P(i) + 292) > 0 || m.u8(P(i) + 293) > 0) tired++;
  }
  const encounter = (): boolean => {
    const id = encounterMonster(c, encounterGroup(c, s16(m.u16(a4 - 18330))));
    m.w16(m.u32(a4 - 18306), id);
    m.w16(a4 - 15100, 0); m.w16(a4 - 15128, 0); m.w16(a4 - 18610, 10);
    return false;
  };
  if (healthy === 0) { m.w16(a4 - 18610, 8); return false; }
  if (tired === np && restParty(c, fx) === 1) return encounter();
  m.w16(a4 - 10892, 0); m.w16(a4 - 10896, 0);
  if (rng.random(1000) >= 0x3e3) return encounter();
  return true;
}

/**
 * Chest disarm, the decision half of LAB_1C5B (CODE+0x4c880, from CODE+0x4ca82; the trap-type menu before it is UI).
 * The player names the trap (`chosen`, one of 16); naming it wrong springs it (-1). Otherwise the chance is
 * level (+36) + (+323)/2 + (+304)/2 - 2 * dungeon level, plus (+304) * 3 for class 3 (trains skill 15, x3) or
 * (+304) * 2 for classes 4, 6 and 13 (trains skill 15, x2), clamped to 5..95. Random(100) below it disarms (1); above
 * 100 - (100 - chance) / 3 springs the trap (-1); in between nothing happens (0, retry). Diffed against the game
 * (oracle/combat4.py disarm).
 */
export function disarmChest(c: Ctx, who: number, chosen: number): number {
  const { m, rng, a4 } = c;
  if (s16(chosen) !== s16(m.u16(a4 - 3236))) return -1;
  const P = a4 - 17922 + who * 0x1b0;
  let ch = s16(m.u16(P + 36) + (m.u8(P + 323) >> 1) + (m.u8(P + 304) >> 1) - 2 * s16(m.u16(a4 - 18340)));
  const cls = m.u8(P + 415);
  if (cls === 3) { ch = s16(ch + m.u8(P + 304) * 3); skillUse(m, rng, a4, who, 15, 3); }
  else if (cls === 13 || cls === 4 || cls === 6) { ch = s16(ch + m.u8(P + 304) * 2); skillUse(m, rng, a4, who, 15, 2); }
  if (ch > 0x5f) ch = 0x5f;
  if (ch < 5) ch = 5;
  const roll = rng.random(100);
  if (roll < ch) return 1;
  return roll > 100 - tdiv(100 - ch, 3) ? -1 : 0;
}
