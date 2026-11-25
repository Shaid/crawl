/**
 * Wizardry 6 (Amiga) thief skills at the chest: inspect (`LAB_1C4B` / `LAB_1C36`) and the can-act test (`LAB_1D56`), ported from
 * the game's 68k code and diffed against it under Unicorn (oracle/combat6.py -> oracle/{inspect,canact}-vectors.json,
 * __tests__/thief.test.ts). Original TypeScript derived from the disassembly only.
 *
 * Inspect does not reveal the trap id: it plays a letter game on the trap's NAME text (`-3214(A4)`, a NUL-terminated string loaded
 * by the trap picker LAB_1C31). Letters already guessed are kept in `-3194(A4)` (bytes), with a flag word each in `-3174(A4)` and their
 * count in `-3134(A4)` (max 18). The chance numbers come from level, class and SKULDUGGERY (+323):
 *   steps = min(level / 5, 6);  skill = byte +323
 *   thief (class 3):                attempts = skill/10 + steps - dungeonLevel + 5,   p = skill/2 + steps + 50 - 2*dungeonLevel
 *   ranger / bard / ninja class 4, 6, 13: attempts = skill/10 + steps - dungeonLevel + 3,   p = skill/2 + steps + 35 - 3*dungeonLevel/2
 *   anyone else:                    attempts = skill/10 + steps - dungeonLevel + 1,   p = skill/2 + steps + 15 - dungeonLevel
 * then attempts >= 1, 5 <= p <= 95.
 */
import { s16, type Effect } from './combat.ts';
import type { Ctx } from './planner.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** LAB_1D56(who): 1 when the member is healthy (+417 = 0) and neither +292 nor +293 counter is set; else 0 and the refusal sound. */
export function canAct(c: Ctx, who: number, fx: Effect[]): number {
  const { m, a4 } = c;
  const p = a4 - 17922 + s16(who) * 0x1b0;
  let ok = 1;
  if (m.u8(p + 417) !== 0) ok = 0;
  if (m.u8(p + 292) > 0 || m.u8(p + 293) > 0) ok = 0;
  if (ok === 0) fx.push(['jt-32634', hex16(0)]);
  return ok;
}

const strlen = (c: Ctx, a: number): number => { let n = 0; while (c.m.u8(a + n) !== 0) n++; return n; };

/** LAB_1C36(window, who, attempts, p): spend `attempts` rounds guessing letters of the trap name. */
export function revealLetters(c: Ctx, win: number, attempts: number, p: number, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  const NAME = a4 - 3214, LET = a4 - 3194, FLG = a4 - 3174, CNT = a4 - 3134;
  let a = s16(attempts);
  for (let i = 0; i < s16(m.u16(CNT)) && a > 0; i++) {
    if (m.u16(FLG + 2 * i) !== 0) continue;
    if (rng.random(100) > 50) {
      if (rng.random(100) < s16(p)) {
        const ch = m.u8(LET + i);
        let idx = -1;
        for (let k = 0; m.u8(NAME + k) !== 0; k++) if (m.u8(NAME + k) === ch) { idx = k; break; }
        if (idx >= 0) { m.w16(FLG + 2 * i, 1); m.w8(NAME + idx, 0x24); } else m.w8(LET + i, 0x2a);
      }
      a--;
    }
  }
  while (a > 0) {
    let left = 0;
    for (let j = 0; j < strlen(c, NAME); j++) if (m.u8(NAME + j) !== 0x24) left++;
    const n = s16(m.u16(CNT));
    if (rng.random(100) < s16(p)) {
      if (left > 0 && n < 18) {
        let k: number;
        do { k = rng.random(strlen(c, NAME)); } while (m.u8(NAME + k) === 0x24);
        m.w8(LET + n, m.u8(NAME + k)); m.w16(FLG + 2 * n, 1); m.w16(CNT, n + 1); m.w8(NAME + k, 0x24);
      }
    } else if (left > 0 && rng.random(100) > 50 && n < 18) {
      m.w8(LET + n, rng.random(26) + 0x41); m.w16(FLG + 2 * n, 0); m.w16(CNT, n + 1);
    }
    a--;
  }
  if (s16(m.u16(a4 - 3236)) === 0) { fx.push(['jt-32550', hex32(win)]); return; }
  for (let k = 0; k < s16(m.u16(CNT)); k++) {
    fx.push(['jt-32562', hex32(win) + hex16(m.u8(LET + k)) + hex16(m.u16(FLG + 2 * k) === 1 ? 6 : 12)]);
  }
}

/** LAB_1C4B(window, who): the inspect command. */
export function inspectChest(c: Ctx, win: number, who: number, fx: Effect[]): void {
  const { m, a4 } = c;
  const P = a4 - 17922 + s16(who) * 0x1b0;
  let steps = Math.trunc(s16(m.u16(P + 36)) / 5);
  if (steps > 6) steps = 6;
  const skill = m.u8(P + 323);
  const lvl = s16(m.u16(a4 - 18340));
  const cls = m.u8(P + 415);
  let att: number, p: number;
  if (cls === 3) {
    att = s16(Math.floor(skill / 10) + steps - lvl + 5);
    p = s16((skill >> 1) + steps + 50 - 2 * lvl);
  } else if (cls === 13 || cls === 4 || cls === 6) {
    att = s16(Math.floor(skill / 10) + steps - lvl + 3);
    p = s16((skill >> 1) + steps + 0x23 - Math.trunc((lvl * 3) / 2));
  } else {
    att = s16(Math.floor(skill / 10) + steps - lvl + 1);
    p = s16((skill >> 1) + steps + 15 - lvl);
  }
  if (att < 1) att = 1;
  if (p < 5) p = 5;
  if (p > 0x5f) p = 0x5f;
  revealLetters(c, win, att, p, fx);
}

/** LAB_0584(who, skill, amount) (CODE+0xb348): thief-skill training. A skill below 100 rises by 1 when Random(skill) <= level * amount. */
export function trainSkill(c: Ctx, who: number, skill: number, amount: number): void {
  const { m, rng, a4 } = c;
  const p = a4 - 17922 + s16(who) * 0x1b0;
  const at = p + 308 + s16(skill);
  const cur = m.u8(at);
  if (cur >= 0x64) return;
  const roll = s16(rng.random(cur) - s16(s16(m.u16(p + 36)) * s16(amount)));
  if (roll <= 0) m.w8(at, cur + 1);
}

/** LAB_06C4(ptr, pos): clear the two bits at `pos` of the big-endian entity word at ptr. */
function clearPair(c: Ctx, ptr: number, pos: number): void {
  for (let p = pos; p < pos + 2; p++) {
    const a = ptr + 1 - Math.trunc(p / 8);
    c.m.w8(a, c.m.u8(a) & ~(1 << (p % 8)));
  }
}

/** LAB_06DB(idx): unlock the cell's door lock (entity word field cleared) and its marker word -18146(A4)[2 * facing]. */
export function unlockEntity(c: Ctx, idx: number, fx: Effect[]): void {
  const { m, a4 } = c;
  const face = s16(m.u16(a4 - 18328));
  m.w16(a4 - 18146 + 2 * face, 0);
  clearPair(c, m.u32(a4 - 18458) + 576 + 2 * s16(idx), s16(2 * face));
  fx.push(['jt-32634', hex16(4)]);
}

/** LAB_06DA(idx): jam the lock: the two-bit field of the facing becomes 2. */
export function jamEntity(c: Ctx, idx: number): void {
  const { m, a4 } = c;
  const ptr = m.u32(a4 - 18458) + 576 + 2 * s16(idx);
  const pos = s16(2 * s16(m.u16(a4 - 18328)));
  let a = ptr + 1 - Math.trunc(pos / 8);
  m.w8(a, m.u8(a) & ~(1 << (pos % 8)));
  a = ptr + 1 - Math.trunc((pos + 1) / 8);
  m.w8(a, m.u8(a) | (1 << ((pos + 1) % 8)));
}

/** The three key / timer polls the lock game makes each round (the game's input layer, not rules). */
export interface LockPolls { keyAvailable(): number; key(): number; timer(): number }

/**
 * LAB_06F9(who, idx) (CODE+0xf63a): the pick-lock tumbler game on the entity `idx` in front of the party. Returns 0 (opened), 1 (failed) or
 * 2 (failed on a stuck lock). Each round re-rolls every tumbler, and the player stops it with CR (or the timer poll ends it): only the LAST round
 * counts. Tumblers: min(difficulty/3 + 1, 6) with difficulty the low 5 bits of operand byte B+1584+idx; each rolls Random(chance) with chance =
 * min(level + SKULDUGGERY, 95) and fails when its roll is <= its threshold word (-10916(A4)[i], normally 0). A lock whose facing field is 2 (jammed)
 * gets one threshold set to 100 (a tumbler that always fails: index (-18338 + -18336) mod tumblers) and failures then return 2.
 * Classes 3, 6 and 13 train skill 15 (amount 4 on success, 1 on a plain failure). Any failure jams the lock 1 time in 3 (field becomes 2);
 * success unlocks (field cleared).
 */
export function pickLock(c: Ctx, who: number, idx: number, polls: LockPolls, fx: Effect[]): number {
  const { m, rng, a4 } = c;
  const B = m.u32(a4 - 18458);
  const P = a4 - 17922 + s16(who) * 0x1b0;
  const diff = m.u8(B + 1584 + s16(idx)) & 0x1f;
  let chance = s16(m.u16(P + 36) + m.u8(P + 323));
  if (chance > 0x5f) chance = 0x5f;
  let tumblers = Math.trunc(diff / 3) + 1;
  if (tumblers > 6) tumblers = 6;
  let stuck = 0;
  const face = s16(m.u16(a4 - 18328));
  const word = m.u16(B + 576 + 2 * s16(idx));
  if (((word >> s16(2 * face)) & 3) === 2) {
    const sum = s16(m.u16(a4 - 18338) + m.u16(a4 - 18336));
    const r = sum % tumblers;
    m.w16(a4 - 10916 + 2 * r, 100);
    stuck = 1;
  }
  fx.push(['jt-32676', hex16(0x83f)]);
  let res = 0;
  for (;;) {
    res = 0;
    for (let i = 0; i < tumblers; i++) {
      const roll = rng.random(chance);
      if (roll <= s16(m.u16(a4 - 10916 + 2 * i))) res = stuck + 1;
    }
    let stop = false;
    if (polls.keyAvailable() !== 0 && (polls.key() & 0xff) === 0x0d) stop = true;
    if (!stop && polls.timer() !== 0) break;
    if (stop) break;
  }
  const thief = (): boolean => { const cls = m.u8(P + 415); return cls === 3 || cls === 6 || cls === 13; };
  if (res === 0) {
    unlockEntity(c, idx, fx);
    if (thief()) trainSkill(c, who, 15, 4);
  } else {
    if (res === 1 && thief()) trainSkill(c, who, 15, 1);
    if (rng.random(3) === 0) jamEntity(c, idx);
  }
  fx.push(['jt-32676', hex16(res + 0x841)]);
  return res;
}
