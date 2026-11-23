/**
 * Wizardry 6 (Amiga) monster round planner: LAB_0C63 (`Bane` CODE+0x1e21a), its callees
 * LAB_0C5B (find a wounded ally), LAB_0C5F (pick an attack slot), LAB_0C00 (pick a set bit of an
 * attack-kind mask) and the round entry LAB_0C96 (CODE+0x1e96c), ported from the game's 68k code
 * and diffed against it (tools/wizardry6/oracle/combat3.py, test __tests__/planner.test.ts).
 * Original TypeScript derived from the disassembly only.
 *
 * Groups: 0 = party, 1..5 = monster groups, 6 = the ally group (summoned/charmed helpers; the
 * planner treats it like a monster group aimed at a monster group). Layout: see combat.ts.
 */
import { Mem, s16 } from './combat.ts';
import { W6Rng } from './rules.ts';

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;

export interface Ctx { m: Mem; rng: W6Rng; a4: number }

export const grpBase = (c: Ctx, g: number): number => c.m.u32(c.a4 - 15266 + 4 * g);
export const recBase = (c: Ctx, g: number): number => c.m.u32(c.a4 - 15294 + 4 * g);
export const member = (c: Ctx, g: number, i: number): number => grpBase(c, g) + i * 44;
/** Member count of group g (byte +413 of the group's trailer). */
export const groupCount = (c: Ctx, g: number): number => c.m.u8(grpBase(c, g) + 413);

/** Spell table row (6 bytes at A4-31698): the planner reads byte +1 (level) and +4 (heal/ally flag). */
const SPELL = -31698;

/** TestBit (JT -32490): bit k of the byte array at ptr, LSB first. */
export function testBit(m: Mem, ptr: number, bit: number): number {
  return (m.u8(ptr + (bit >> 3)) >> (bit & 7)) & 1;
}

/** LAB_0C00 (CODE+0x1e...): pick the (Random(8)+1)-th set bit of a mask, cycling from bit 0, 100 tries max. */
export function pickKindBit(c: Ctx, ptr: number): number {
  let cur = -1;
  let tries = 0;
  let need = c.rng.random(8) + 1;
  do {
    cur = (cur + 1) % 8;
    if (testBit(c.m, ptr, cur) === 1) need--;
    else tries++;
  } while (need > 0 && tries < 100);
  return cur;
}

/** LAB_0C5F (CODE+0x1e1c8): pick one of the three attack slots: a valid slot is taken on a coin flip. */
export function pickAttackSlot(c: Ctx, g: number): number {
  const r = recBase(c, g);
  let i = 0;
  for (;;) {
    if (c.m.u8(r + 128 + i) !== 0 && c.rng.random(2) !== 1) return i;
    i = (i + 1) % 3;
  }
}

/**
 * LAB_0C5B (CODE+0x1e0e8): scan group tg for the most wounded member (max HP word +4 minus HP word +2),
 * each better candidate taken on a coin flip; writes it as A's target (+0x1f/+0x20); returns the deficit.
 */
export function findWounded(c: Ctx, A: number, tg: number): number {
  let best = 0;
  const n = groupCount(c, tg);
  for (let i = 0; i < n; i++) {
    const X = member(c, tg, i);
    const d = s16(c.m.u16(X + 4) - c.m.u16(X + 2));
    if (d > best && c.rng.random(2) === 0) {
      c.m.w8(A + 31, tg);
      c.m.w8(A + 32, i);
      best = d;
    }
  }
  return best;
}

/** LAB_0C63 (CODE+0x1e21a): plan every member of group g against target group tg. */
export function planGroup(c: Ctx, g: number, tg: number): void {
  const { m, rng, a4 } = c;
  const n = groupCount(c, g);
  for (let i = 0; i < n; i++) {
    const A = member(c, g, i);
    const R = recBase(c, g);
    let roll = s16(rng.random(10) + m.u8(R + 211) + s8(m.u8(A + 41)));
    if (roll < 1) roll = 1;
    const per = Math.floor((roll & 0xffff) / m.u8(R + 213)) & 0xffff;
    if (m.u8(R + 220) & 2) m.w8(A + 36, 1);
    if (m.u8(A + 36) > 0) {
      const t1 = rng.random(Math.trunc(roll / 2));
      const t2 = rng.random(20);
      m.w8(A + 37, t1 + t2 + Math.trunc(roll / 2));
    }
    m.w8(A + 33, 0);
    m.w8(A + 28, pickAttackSlot(c, g));
    let k = 0;
    do {
      m.w8(A + 29, pickAttackSlot(c, g));
      k++;
    } while (m.u8(A + 29) === m.u8(A + 28) && k < 3);
    let rr = roll;
    for (let s = 0; s < 4; s++) {
      if (s < m.u8(R + 213) && m.u8(A + 34) < 2 && m.u8(A + 17) === 0 && m.u8(A + 16) === 0) {
        m.w8(A + 24 + s, rr);
        rr = s16(rr - per);
      } else m.w8(A + 24 + s, 0);
    }
    let sel = -1;
    m.w8(A + 31, tg);
    do {
      m.w8(A + 32, rng.random(groupCount(c, tg)));
    } while (m.u8(member(c, m.u8(A + 31), m.u8(A + 32)) + 34) >= 3);

    // spell
    if (rng.random(100) < m.u8(R + 168)) {
      sel = 3;
      m.w8(A + 30, 3);
      const r = rng.random(100);
      let thr = 5;
      let idx = 0;
      let spell = -1;
      do {
        if (r < thr) spell = m.u8(R + 138 + idx);
        idx++;
        if (thr < 15) thr += 5;
        else if (thr < 55) thr += 10;
        else thr += 15;
      } while (spell === -1);
      if (m.u8(a4 + SPELL + 4 + spell * 6) === 1) {
        if (g === 6) {
          if (findWounded(c, A, 0) === 0 && findWounded(c, A, 6) === 0) sel = -1;
        } else if (findWounded(c, A, g) === 0) {
          const t = rng.random(s16(m.u16(a4 - 15140))) + 1;
          if (findWounded(c, A, t) === 0) sel = -1;
        }
      }
      let p = s16(m.u16(A) - m.u8(a4 + SPELL + 1 + spell * 6) + 1);
      p = p < 1 ? 1 : p > 6 ? 6 : p;
      while (rng.random(m.u16(A)) + 1 < p) p--;
      m.w16(A + 10, (p << 8) + spell);
    }
    // breath
    if (sel === -1 && rng.random(100) < m.u8(R + 170)) {
      sel = 8;
      m.w8(A + 30, 8);
      m.w16(A + 10, m.u8(R + 216));
    }
    // melee
    if (sel === -1) {
      let c0 = 0;
      if (m.u8(A + 34) < 2 && m.u8(A + 17) === 0 && m.u8(A + 16) === 0) {
        const idx = m.u8(A + 28);
        if (g === 6) c0 = 9;
        else if (g >= 3 && m.u8(R + idx * 16 + 81) <= 1) c0 = 0;
        else {
          c0 = 3;
          if (m.u8(R + idx * 16 + 81) > (g < 3 ? 0 : 2)) c0 = 6;
        }
      }
      if (c0 > groupCount(c, tg)) c0 = groupCount(c, tg);
      let live = 0;
      for (let q = 0; q < c0; q++) if (m.u8(member(c, tg, q) + 34) < 3) live++;
      if (live > 0) {
        m.w8(A + 30, 0);
        m.w8(A + 31, tg);
        m.w8(A + 32, rng.random(live));
        const idx = m.u8(A + 28);
        const kind = m.u8(R + 128 + idx);
        if (kind === 2) m.w16(A + 10, 4);
        else if (kind === 3) m.w16(A + 10, 8);
        else m.w16(A + 10, pickKindBit(c, R + idx * 16 + 83));
      } else m.w8(A + 24, 0);
    }
    m.w16(A + 12, 0xffff);
    if (m.u8(A + 30) === 0) {
      const idx2 = m.u8(A + 29);
      if (g >= 3 && m.u8(R + idx2 * 16 + 81) <= 1) {
        m.w8(A + 25, 0);
        m.w8(A + 27, 0);
      } else {
        const kind = m.u8(R + 128 + idx2);
        if (kind === 2) m.w16(A + 12, 4);
        else if (kind === 3) m.w16(A + 12, 8);
        else m.w16(A + 12, pickKindBit(c, R + idx2 * 16 + 83));
      }
    } else {
      for (let s = 1; s < 4; s++) m.w8(A + 24 + s, 0);
    }
  }
}

/** LAB_0C96 (CODE+0x1e96c): plan every monster group, then the ally group (group 6). */
export function planMonsters(c: Ctx): void {
  const { m, rng, a4 } = c;
  m.w8(grpBase(c, 0) + 413, m.u8(a4 - 15305));
  const n = s16(m.u16(a4 - 15140));
  for (let g = 1; g <= n; g++) {
    if (groupCount(c, 6) > 0 && rng.random(4) === 1 && m.u8(recBase(c, g) + 208) !== 0x16) planGroup(c, g, 6);
    else planGroup(c, g, 0);
  }
  if (groupCount(c, 6) > 0) {
    let g = 1;
    while (g < s16(m.u16(a4 - 15140)) && rng.random(3) === 0) g++;
    planGroup(c, 6, g);
  }
}
