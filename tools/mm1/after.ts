/**
 * Might & Magic I (DOS/EGA) after-combat rules, ported from `MM.EXE` (docs/mm1/dosega/game-rules.md section 5): treasure
 * `treas` CODE+0xC3AD, item drops `treitem` CODE+0xC422, 32-bit `divide` CODE+0x8386, post-battle reset `resout` CODE+0xA1EA and the
 * battle-won block CODE+0x9FC1..0xA1BE (experience pool, treasure, split among the living). Strict memory + UI call log, as in rules.ts.
 */
import { type Mem } from './rules-mem.ts';
import { random, resetAc, setMony, resMon2, saveMonster, setInitiative, BDW_TEXT, CHARP, type Call } from './rules.ts';

const u8 = (v: number) => v & 0xff;
const PARTYTAB = 0x3ca8, NPARTY = 0x3bc0;

/** CODE+0xC3AD `treas`: the current monster's treasure byte (+0x18): bit 0 = gems (d6), bits 1-2 = gold: 2 -> d10, 4 -> d100,
 *  6 -> d4 added to the HIGH byte (hundreds of 256).  DS:389C keeps the highest treasure byte seen (drives item drops). */
export type Wrong = 'gemOnBit1' | 'goldHighByte' | 'thresholdOff' | 'divideNoBorrow' | 'maskLow' | 'overflowAllBytes' | 'countAll' | 'xpPoolOnlyLow' | 'budgetNoCap' | 'regenFour' | 'clearAll' | 'advanceAny' | 'roundOff' | 'levelCurrent' | 'noFlee' | 'noMinLevel' | 'noLevelStep' | 'noRaise';
export function treas(m: Mem, wrong?: Wrong): void {
  const al = m.r8(m.r16(0x3cb4) + 0x18);
  if (!(al < m.r8(0x389c))) m.w8(0x389c, al);
  m.w8(0x389b, al);
  if (al & (wrong === 'gemOnBit1' ? 2 : 1)) m.w8(0x3c7f, u8(random(m, 6) + m.r8(0x3c7f)));
  const k = m.r8(0x389b) & 6;
  if (k === 0) return;
  const gold = (v: number) => { const s = v + m.r8(0x3c7d); m.w8(0x3c7d, s); m.w8(0x3c7e, m.r8(0x3c7e) + (s > 255 ? 1 : 0)); };
  if (k === 2) gold(random(m, 10));
  else if (k === 4) gold(random(m, 100));
  else m.w8(wrong === 'goldHighByte' ? 0x3c7d : 0x3c7e, u8(random(m, 4) + m.r8(wrong === 'goldHighByte' ? 0x3c7d : 0x3c7e)));
}

/** CODE+0xC532: drop one item of kind `lvl` (1..5): base = item1[d6-1] + (lvl-1)*item2[d6-1] + d(item2)-1, into the first empty
 *  slot of DS:3C7A..3C7C; remembers the kind in DS:38A0+lvl-1. */
function dropItem(m: Mem, lvl: number, wrong?: Wrong): void {
  m.w8(0x389d, lvl);
  m.w8(0x38a0 + lvl - 1, 1);
  const k = u8(random(m, 6) - 1);
  m.w8(0x389e, m.r8(0x38a6 + k));
  m.w8(0x389f, m.r8(0x38ac + k));
  let bl = m.r8(0x389d);
  for (;;) {
    bl = u8(bl - 1);
    if (bl === 0) break;
    if (wrong !== 'noLevelStep') m.w8(0x389e, u8(m.r8(0x389e) + m.r8(0x389f)));
  }
  const al = u8(u8(random(m, m.r8(0x389f)) - 1) + m.r8(0x389e));
  m.w8(0x389e, al);
  for (const s of [0x3c7a, 0x3c7b, 0x3c7c]) {
    if (m.r8(s) === 0) { m.w8(s, al); return; }
  }
}

/** CODE+0xC422 `treitem`: the five top bits of the highest treasure byte (DS:389C, rotated out one per step, zero shifted in) each
 *  give a chance (11, 21, 31, 41, 51 %) of an item of kind 5..1; then DS:3C79 = the chest/trap level from the lowest kind found. */
export function treItem(m: Mem, wrong?: Wrong): void {
  const T: [number, number][] = [[0x0b, 5], [0x15, 4], [0x1f, 3], [0x29, 2], [0x33, 1]];
  for (const [thr, lvl] of T) {
    const al = m.r8(0x389c);
    m.w8(0x389c, al << 1);
    if (al & 0x80) { if (random(m, 100) < thr + (wrong === 'thresholdOff' ? 1 : 0)) dropItem(m, lvl, wrong); }
  }
  m.w8(0x3c78, 0);
  if (m.r8(0x38a0 + 4) !== 0) { m.w8(0x3c79, 0xa); return; }
  for (const [idx, add] of [[3, 5], [2, 4], [1, 3]] as const) {
    if (m.r8(0x38a0 + idx) !== 0) { m.w8(0x3c79, u8(random(m, 4) + add)); return; }
  }
  if (m.r8(0x38a0) !== 0 || m.r8(0x3c7f) !== 0) { m.w8(0x3c79, u8(random(m, 4) + 1)); return; }
  if (m.r8(0x3c7e) !== 0) { m.w8(0x3c79, u8(random(m, 4) - 1)); return; }
  m.w8(0x3c79, u8(random(m, 2) - 1));
}

/** CODE+0x8386 `divide`: DS:3C86..3C89 (32 bit) / DS:3C8C..3C8D (16 bit) -> quotient in place, remainder DS:3C8A..3C8B
 *  (shift-subtract, 32 steps; a zero divisor gives 0xFFFFFFFF). Returns with CF clear. */
export function divide(m: Mem, wrong?: Wrong): void {
  m.w8(0x3c8a, 0); m.w8(0x3c8b, 0);
  for (let bp = 0x20; bp !== 0; bp--) {
    let c = 0;
    for (let i = 0; i < 6; i++) {
      const a = 0x3c86 + i;
      const v = m.r8(a);
      m.w8(a, (v << 1) | c);
      c = v >> 7;
    }
    const lo = m.r8(0x3c8a) - m.r8(0x3c8c);
    const bl = u8(lo);
    const hi = m.r8(0x3c8b) - m.r8(0x3c8d) - (lo < 0 && wrong !== 'divideNoBorrow' ? 1 : 0);
    if (hi >= 0) { m.w8(0x3c8a, bl); m.w8(0x3c8b, hi); m.w8(0x3c86, m.r8(0x3c86) + 1); }
  }
}

/** CODE+0x72DD `resetsts`: current attribute = base (pairs 0x15/0x16 .. 0x23/0x24 and the spell level 0x2F/0x30) */
export function resetSts(m: Mem): void {
  const c = m.r16(CHARP);
  for (const o of [0x15, 0x17, 0x19, 0x1b, 0x1d, 0x1f, 0x21, 0x23, 0x2f]) m.w8(c + o + 1, m.r8(c + o));
}
/** CODE+0x73C2 `resetres`: current resistances (+0x59..+0x67 odd) = base (+0x58..+0x66 even) */
export function resetRes(m: Mem): void {
  for (let bp = 0x58; bp < 0x68; bp += 2) { const c = m.r16(CHARP); m.w8(c + bp + 1, m.r8(c + bp)); }
}
/** CODE+0x73DF `resallac`: recompute AC for every party member (CHARP restored) */
export function resAllAc(m: Mem): void {
  m.w8(0x3bb8, m.r8(CHARP)); m.w8(0x3bb9, m.r8(CHARP + 1));
  let bl = 0;
  do {
    const bp = u8(bl << 1);
    m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
    m.w8(0x3bba, bl);
    resetAc(m);
    bl = u8(m.r8(0x3bba) + 1);
  } while (bl < m.r8(NPARTY));
  m.w8(CHARP, m.r8(0x3bb8)); m.w8(CHARP + 1, m.r8(0x3bb9));
}
/** CODE+0xA1EA `resout`: after a battle every member gets base attributes and resistances back, the low status bits (sleep
 *  0x01, bit 2 = 0x04 .. mask 0xFA clears bits 0 and 2) cleared unless dead/stoned etc. (bit 7), then AC is recomputed. */
export function resOut(m: Mem, wrong?: Wrong): void {
  let bl = 0;
  do {
    const bp = u8(bl << 1);
    m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
    resetSts(m); resetRes(m);
    const c = m.r16(CHARP);
    const al = m.r8(c + 0x3f);
    if (al < 0x80) m.w8(m.r16(CHARP) + 0x3f, al & (wrong === 'maskLow' ? 0xfe : 0xfa));
    bl++;
  } while (bl < m.r8(NPARTY));
  resAllAc(m);
}

/** CODE+0x9FC1..0xA1BE (+ `resout`): battle won. XP pool = sum of every starting monster's 16-bit award (+0x16/+0x17, 24-bit
 *  accumulator DS:3C86), treasure per monster, pool divided by the number of members whose condition byte is below 0x80, each of
 *  those gets the share added to the 32-bit XP at +0x27 (overflow only sets the top byte to 0xFF). */
export function victory(m: Mem, wrong?: Wrong): { calls: Call[] } {
  const calls: Call[] = [];
  const ptext = () => calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);
  m.w16(0x3cb4, 0x2e80);
  setMony(m);
  let bl = 0;
  for (const o of [0x3c86, 0x3c87, 0x3c88, 0x3c89]) m.w8(o, 0);
  do {
    const mon = m.r16(0x3cb4);
    let s = m.r8(mon + 0x16) + m.r8(0x3c86);
    m.w8(0x3c86, s);
    if (s > 255) { m.w8(0x3c87, m.r8(0x3c87) + 1); if (m.r8(0x3c87) === 0) m.w8(0x3c88, m.r8(0x3c88) + 1); }
    s = m.r8(m.r16(0x3cb4) + 0x17) + m.r8(0x3c87);
    m.w8(0x3c87, wrong === 'xpPoolOnlyLow' ? m.r8(0x3c87) : s);
    if (s > 255 && wrong !== 'xpPoolOnlyLow') m.w8(0x3c88, m.r8(0x3c88) + 1);
    m.w8(0x3bba, bl);
    treas(m);
    bl = m.r8(0x3bba);
    const lo = m.r8(0x3cb4) + 0x20;
    m.w8(0x3cb4, lo);
    if (lo > 255) m.w8(0x3cb5, m.r8(0x3cb5) + 1);
    setMony(m);
    bl++;
  } while (bl < m.r8(0x3897));
  m.w8(0x3c8c, 0); m.w8(0x3c8d, 0);
  m.w16(0x30d2, PARTYTAB);
  bl = 0;
  do {
    const c = m.r16(m.r16(0x30d2));
    if (m.r8(c + 0x3f) < 0x80 || wrong === 'countAll') m.w8(0x3c8c, m.r8(0x3c8c) + 1);
    m.w16(0x30d2, m.r16(0x30d2) + 2);
    bl++;
  } while (bl < m.r8(NPARTY));
  divide(m);
  treItem(m);
  calls.push(['clropt', []]);
  m.w8(0x3bdd, 0); m.w8(0x3bdc, 0xa); m.w16(BDW_TEXT, 0x30b1); ptext();
  for (let i = 0; i < 10; i++) calls.push(['puttoscr', []]);
  m.w8(0x3bdd, 2); m.w8(0x3bdc, 0xa); m.w16(BDW_TEXT, 0x3060); ptext();
  m.w8(0x3bdc, 0xa); m.w8(0x3bdd, 4); m.w16(BDW_TEXT, 0x307f); ptext();
  m.w8(0x3bdd, 6); m.w8(0x3bdc, 0xe);
  m.w8(0x3c14, m.r8(0x3c86)); m.w8(0x3c15, m.r8(0x3c87)); m.w8(0x3c16, m.r8(0x3c88));
  calls.push(['pdec', []]);
  m.w8(0x3bdc, m.r8(0x3bdc) + 1);
  m.w16(BDW_TEXT, 0x309e); ptext();
  m.w8(0x3bdd, 8); m.w8(0x3bdc, 0xa); m.w16(BDW_TEXT, 0x30b1); ptext();
  bl = 0;
  m.w16(0x30d4, PARTYTAB);
  for (;;) {
    const c0 = m.r16(m.r16(0x30d4));
    if (m.r8(c0 + 0x3f) < 0x80) {
      const bp = u8(bl << 1);
      m.w8(CHARP, m.r8(PARTYTAB + bp)); m.w8(CHARP + 1, m.r8(PARTYTAB + bp + 1));
      const c = m.r16(CHARP);
      let carry = 0;
      for (let k = 0; k < 4; k++) {
        const s = m.r8(0x3c86 + k) + m.r8(c + 0x27 + k) + carry;
        m.w8(c + 0x27 + k, s);
        carry = s > 255 ? 1 : 0;
      }
      if (carry) { if (wrong === 'overflowAllBytes') for (let k = 0; k < 4; k++) m.w8(c + 0x27 + k, 0xff); else m.w8(c + 0x2a, 0xff); }
    }
    m.w16(0x30d4, m.r16(0x30d4) + 2);
    bl++;
    if (bl >= m.r8(NPARTY)) break;
  }
  resOut(m);
  return { calls };
}

/** CODE+0x2F87..0x3206 `encounter` (group building only; the menu after it is UI): the budget is half the sum of the levels of the
 *  party members who are not unconscious/dead/stoned (+0x3F & 0xE0 == 0), capped 255, plus half the highest level; monsters are added until the running
 *  level total reaches the budget. Each draw: d(min(modifier + highest/2, getod[0x21])) floored at getod[0x2F] (cap 10) for the level
 *  and d16 for the type; a group of d(record+0x0F) copies follows (until 15 monsters or getod[0x22]). The 32-byte monster records
 *  (DS:0xA962 + (level-1)*512 + (type-1)*32) are copied to DS:2E80... and the toughest one sets DS:3C8E (level) / 3C8F / 3C26. */
export function encGen(m: Mem, wrong?: Wrong): { calls: Call[] } {
  const calls: Call[] = [];
  const getod = (o: number) => m.r8(m.r16(0x132) + o);
  for (const o of [0x17e0, 0x17e1, 0x17e2]) m.w8(o, 0);
  if (m.r8(0x3c21) === 0) { m.w8(0x3c1c, 0); m.w8(0x3c1d, 0); }
  for (const o of [0x3c1a, 0x3c1b, 0x3c1e, 0x3c26, 0x3c8e, 0x3c8f]) m.w8(o, 0);
  let bl = 0;
  do {
    m.w16(CHARP, m.r16(PARTYTAB + u8(bl << 1)));
    const c = m.r16(CHARP);
    const al = m.r8(c + 0x24);
    if (!(al < m.r8(0x3c1b))) m.w8(0x3c1b, al);
    m.w8(0x3bb8, al);
    if ((m.r8(m.r16(CHARP) + 0x3f) & 0xe0) === 0) {
      const s = m.r8(0x3c1a) + m.r8(0x3bb8);
      m.w8(0x3c1a, s);
      if (s > 255) { m.w8(0x3c1a, wrong === 'budgetNoCap' ? s : 0xff); break; }
    }
    bl++;
  } while (bl < m.r8(NPARTY));
  m.w8(0x3c1a, m.r8(0x3c1a) >> 1);
  m.w8(0x3c1b, m.r8(0x3c1b) >> 1);
  const setRecord = () => {   // CODE+0x35C0: DS:3C22 = record for level DS:3C24, type DS:3C25
    m.w16(0x3c22, 0xa962);
    for (let b = m.r8(0x3c24); u8(b - 1) !== 0; b = u8(b - 1)) m.w8(0x3c23, m.r8(0x3c23) + 2);
    for (let b = m.r8(0x3c25); u8(b - 1) !== 0; b = u8(b - 1)) { const lo = m.r8(0x3c22) + 0x20; m.w8(0x3c22, lo); if (lo > 255) m.w8(0x3c23, m.r8(0x3c23) + 1); }
  };
  let build = true;
  if (m.r8(0x3c21) !== 0) { m.w8(0x3c21, 0); build = false; }
  if (build || m.r8(0x3c1c) < m.r8(0x3c1a)) {
    for (let first = true; ; first = false) {
      if (!first || build) {
        // CODE+0x3595 morale/modifier roll
        m.w8(0x3c1e, 0);
        const r = random(m, 100);
        m.w8(0x3c1e, r < 0x33 ? 0 : r < 0x47 ? 1 : r < 0x56 ? 2 : r < 0x60 ? 3 : 4);
        let al = u8(m.r8(0x3c1e) + m.r8(0x3c1b));
        if (al < 2) al = 1;
        else { const ah = getod(0x21); al = al < ah ? al : ah; al = random(m, al); }
        const ah = getod(0x2f);
        if (!(al >= ah) && wrong !== 'noMinLevel') { al = ah; if (al >= 0xb) al = 0xa; }
        const bp = m.r16(0x3c1d) & 0xff;
        m.w8(0x3c29 + bp, al);
        m.w8(0x3c24, al);
        m.w8(0x3c1c, u8(al + m.r8(0x3c1c)));
        const t = random(m, 0x10);
        m.w8(0x3c25, t);
        m.w8(0x3c58 + (m.r16(0x3c1d) & 0xff), t);
        m.w8(0x3c1d, bp + 1);
        if (bp + 1 >= 0xf) break;
        if (bp + 1 >= getod(0x22)) break;
        setRecord();
        let n = random(m, m.r8(m.r16(0x3c22) + 0xf));
        let stop = false;
        while (u8(n - 1) !== 0) {
          n = u8(n - 1);
          let p = (m.r16(0x3c1d) - 1) & 0xff;
          let v = m.r8(p + 0x3c29);
          p = (p + 1) & 0xff;
          m.w8(p + 0x3c29, v);
          m.w8(0x3c1c, u8(v + m.r8(0x3c1c)));
          p = (p - 1) & 0xff;
          v = m.r8(p + 0x3c58);
          p = (p + 1) & 0xff;
          m.w8(p + 0x3c58, v);
          p = (p + 1) & 0xff;
          m.w8(0x3c1d, p);
          if (p >= 0xf || p >= getod(0x22)) { stop = true; break; }
        }
        if (stop) break;
      }
      if (m.r8(0x3c1c) >= m.r8(0x3c1a)) break;
    }
  }
  // CODE+0x3137: materialise the records
  m.w8(0x3bc3, 0);
  m.w16(0x17de, 0x2e80);
  bl = 0;
  do {
    let al = m.r8(0x3c29 + bl);
    let ok = false;
    if (al !== 0 && al <= 0xc) { const idx = ((al - 1) << 4) + m.r8(0x3c58 + bl); ok = idx < 0xc4; }
    if (!ok) {
      m.w8(0x3c29 + bl, 0xa);
      const r = random(m, 0xf);
      m.w8(0x3c58 + bl, r);
    }
    al = m.r8(0x3c29 + bl); m.w8(0x3c24, al);
    al = m.r8(0x3c58 + bl); m.w8(0x3c25, al);
    m.w8(0x3bba, bl);
    setRecord();
    bl = m.r8(0x3bba);
    let bp = 0;
    do { m.w8(0x1928 + bp, m.r8(m.r16(0x3c22) + bp)); bp++; } while (bp !== 0xf);
    m.w8(0x1928 + bp, 0);
    m.w8(0x3bba, bl);
    // CODE+0x3573: monster list line (UI)
    m.w8(0x3bc4, 0x16);
    calls.push(['ph2one', [u8(m.r8(0x3bba) + 0x41)]]);
    calls.push(['ph2one', [0x29]]);
    calls.push(['ph2one', [0x20]]);
    m.w16(BDW_TEXT, 0x1928);
    calls.push(['ph2', [m.r16(BDW_TEXT)]]);
    const lvl = m.r8(0x3c24);
    if (lvl > m.r8(0x3c8e)) {
      m.w8(0x3c8e, lvl);
      m.w8(0x3c8f, m.r8(m.r16(0x3c22) + 0x10));
      m.w8(0x3c26, m.r8(m.r16(0x3c22) + 0x1f));
    }
    const dst = m.r16(0x17de);
    for (let k = 0; k < 0x20; k++) m.w8(dst + k, m.r8(m.r16(0x3c22) + k));
    m.w16(0x17de, m.r16(0x17de) + 0x20);
    bl = m.r8(0x3bba) + 1;
  } while (bl < m.r8(0x3c1d));
  return { calls };
}

const mon2 = (m: Mem, bl: number): number => { m.w16(0x3cb4, m.r16(0x3c58 + 2 * bl)); return setMony(m); };
const logPtext = (m: Mem, calls: Call[]) => calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);

/** CODE+0xAD44 `regenmon`: per monster - flag +0x1E bit 6 regenerates 5 HP (to the maximum at +0x11); a monster with a status gets
 *  a saving throw (d100 <= 8*level+20) and on success loses its highest set status bit.  Then one report line. */
export function regenMon(m: Mem, wrong?: Wrong): { calls: Call[] } {
  const calls: Call[] = [];
  m.w8(0x31cc, 0); m.w8(0x31cb, 0);
  let bl = 0;
  for (;;) {
    mon2(m, bl);
    if (m.r8(m.r16(0x3cb4) + 0x1e) & 0x40) {
      let bp = m.r16(0x38b2);
      if (m.r8(0x3888 + bp) !== m.r8(m.r16(0x3cb4) + 0x11)) {
        m.w8(0x31cb, m.r8(0x31cb) + 1);
        bp = m.r16(0x38b2);
        const s = m.r8(0x3888 + bp) + (wrong === 'regenFour' ? 4 : 5);
        m.w8(0x3888 + bp, s);
        const al = u8(s);
        if (s > 255 || al >= m.r8(m.r16(0x3cb4) + 0x11)) {
          m.w8(0x3bb8, m.r8(m.r16(0x3cb4) + 0x11));
          m.w8(0x3888 + m.r16(0x38b2), m.r8(0x3bb8));
        }
      }
    }
    m.w8(0x31cd, bl);
    const bp = m.r16(0x38b2);
    if (m.r8(0x3879 + bp) !== 0) {
      saveMonster(m);
      if (m.r8(0x31b2) !== 0) {
        m.w8(0x31cc, m.r8(0x31cc) + 1);
        const b2 = m.r16(0x38b2);
        let al = m.r8(0x3879 + b2);
        let done = false;
        for (const k of [0x7f, 0x3f, 0x1f, 0xf, 7, 3, 1]) { al &= k; if (al !== m.r8(0x3879 + b2)) { done = true; break; } }
        if (!done) al = 0;
        m.w8(0x3879 + b2, wrong === 'clearAll' ? 0 : al);
      }
    }
    bl = u8(m.r8(0x31cd) + 1);
    if (bl >= m.r8(0x3c1d)) break;
  }
  if (m.r8(0x31cb) !== 0) { m.w8(0x3bdc, 0); m.w8(0x3bdd, 0x15); m.w16(BDW_TEXT, 0x31ce); logPtext(m, calls); }
  if (m.r8(0x31cc) !== 0) {
    if (m.r8(0x3bdd) !== 0x15) m.w8(0x3bdd, 0x14);
    m.w8(0x3bdd, m.r8(0x3bdd) + 1); m.w8(0x3bdc, 0);
    m.w16(BDW_TEXT, 0x31e8); logPtext(m, calls);
  }
  calls.push(['pmonst', []]);
  return { calls };
}

/** CODE+0xAC41 `monadv` / 0xAC82: every monster behind the melee line (index >= DS:3C11) that has no status except bit 2 and flag
 *  +0x1E bit 7 steps to the front of the order table (the others shift back one place); one line of text per mover. */
export function monAdvance(m: Mem, wrong?: Wrong): { calls: Call[] } {
  const calls: Call[] = [];
  calls.push(['clropt', []]);
  if (!(m.r8(0x3c11) < m.r8(0x3c1d))) return { calls };
  let bl = m.r8(0x3c11);
  do {
    m.w8(0x31b8, bl);
    const bp = mon2(m, bl);
    if ((m.r8(0x3879 + bp) & (wrong === 'advanceAny' ? 0 : 0xfb)) === 0 && m.r8(m.r16(0x3cb4) + 0x1e) >= 0x80) {
      bl = m.r8(0x31b8);
      let b = u8(bl << 1), p = u8(b + 1);
      b = u8(b - 1);
      if (b !== 0) {
        do { m.w8(0x3c58 + p, m.r8(0x3c58 + b)); p = u8(p - 1); b = u8(b - 1); } while (b !== 0);
      }
      m.w8(0x3c58 + p, m.r8(0x3c58 + b));
      m.w8(0x3c58, m.r8(0x3cb4)); m.w8(0x3c59, m.r8(0x3cb5));
      m.w8(0x3bdc, 0); m.w8(0x3bdd, 0x14);
      calls.push(['pmonname', [0]]);
      m.w16(BDW_TEXT, 0x31b9); logPtext(m, calls);
      for (let i = 0; i < 0x1e; i++) calls.push(['cout', [0x20]]);
      calls.push(['pmonst', []]);
    }
    bl = u8(m.r8(0x31b8) + 1);
  } while (bl < m.r8(0x3c1d));
  return { calls };
}

/** CODE+0x9A17 with AL = 'R' (run): d100 <= DS:3C8F, else d100 < DS:3BDB (round counter), escapes (stop 0xA242 after setting the
 *  return square from overlay data 0x17/0x18); failure raises the chance DS:3C8F by 1 (if non-zero) and spends the turn (stop 0x9799). */
export function flee(m: Mem, wrong?: Wrong): { stop: number; calls: Call[] } {
  const getod = (o: number) => m.r8(m.r16(0x132) + o);
  const escape = () => { m.w8(0x3c38, getod(0x17)); m.w8(0x3c39, getod(0x18)); return { stop: 0xa242, calls: [] as Call[] }; };
  const r = random(m, 100);
  if (r <= m.r8(0x3c8f)) return escape();
  const r2 = random(m, 100);
  if (r2 < m.r8(0x3bdb) + (wrong === 'roundOff' ? 1 : 0)) return escape();
  const bl = m.r8(0x3c8f);
  if (bl !== 0 && wrong !== 'noRaise') m.w8(0x3c8f, u8(bl + 1));
  m.w8(0x3855 + (m.r16(0x3bf4) & 0xff), 1);
  return { stop: 0x9799, calls: [] };
}

/** CODE+0x9F1A: end of a combat round. Both initiative thresholds (DS:3BF2/3BF3) count down to 1; when both are 1 a new round
 *  begins: counter, initiative (setinit), AC, the "last attacked" slot, DS:3C1B = base level of the last conscious member,
 *  upkeep (monadv, regenmon). */
export function roundEnd(m: Mem, wrong?: Wrong): { stop: number; calls: Call[] } {
  const calls: Call[] = [];
  if (m.r8(0x3bf2) !== 1 || m.r8(0x3bf3) !== 1) {
    if (m.r8(0x3bf2) !== 1) m.w8(0x3bf2, m.r8(0x3bf2) - 1);
    if (m.r8(0x3bf3) !== 1) m.w8(0x3bf3, m.r8(0x3bf3) - 1);
    return { stop: 0x9799, calls };
  }
  m.w8(0x3bdb, m.r8(0x3bdb) + 1);
  calls.push(['pround', []]);
  calls.push(...setInitiative(m).calls);
  calls.push(['pmonst', []], ['clragone', []], ['pcharco', []]);
  resAllAc(m);
  const al = random(m, m.r8(NPARTY));
  m.w8(0x3847, u8(al - 1));
  let bl = 0;
  do {
    m.w8(CHARP, m.r8(PARTYTAB + u8(bl << 1))); m.w8(CHARP + 1, m.r8(PARTYTAB + u8(bl << 1) + 1));
    if ((m.r8(m.r16(CHARP) + 0x3f) & 0xe0) === 0) m.w8(0x3c1b, m.r8(m.r16(CHARP) + (wrong === 'levelCurrent' ? 0x24 : 0x23)));
    bl++;
  } while (bl < m.r8(NPARTY));
  calls.push(['clropt', []]);
  // invron CODE+0xACF3
  for (let b = 0; b < 7; b++) { m.r8(0x31c4 + b); calls.push(['puttoscr', []]); }
  for (let b = 7; b < 0xa; b++) {
    const v = m.r8(0x33b3 + b);
    if (v === 0x20 || v === 0) break;
    calls.push(['puttoscr', []]);
  }
  calls.push(...monAdvance(m, wrong).calls);
  calls.push(...regenMon(m, wrong).calls);
  // invroff CODE+0xAD27
  m.w8(0x3bdc, 0); m.w8(0x3bdd, 1); m.w16(BDW_TEXT, 0x3632); logPtext(m, calls);
  calls.push(['pround', []]);
  calls.push(['clropt', []]);
  return { stop: 0x9799, calls };
}

/** CODE+0x9A76..0x9B9D: find the next monster that may act (speed byte +0x15 non-zero and >= the monster threshold DS:3BF3, not
 *  yet acted this round, no status in the high nibble); then the nerve check: flag +0x1E bits 4-5 (0 / 0x10 / 0x20 / 0x30 = never)
 *  against DS:3C1B: below the first bound never, in between 50 % or 75 % flee chance, above it always. A runner is removed
 *  without reward.  Stops: 0x9B9D acts (ability), 0x9F1A nobody left to act, 0x9EC9 / 0x9FC1 after a flight (monsters remain / none). */
export function monPick(m: Mem, wrong?: Wrong): { stop: number; calls: Call[] } {
  const calls: Call[] = [];
  let bl = 0;
  for (;;) {
    m.w16(0x3cb4, m.r16(0x3c58 + bl));
    bl = u8(bl + 1);
    setMony(m);
    const sp = m.r8(m.r16(0x3cb4) + 0x15);
    let acts = false;
    if (sp !== 0 && sp >= m.r8(0x3bf3)) {
      const bp = m.r16(0x38b2);
      if (m.r8(0x385b + bp) === 0) {
        m.w8(0x385b + bp, 1);
        if ((m.r8(0x3879 + bp) & 0xf0) === 0) acts = true;
      }
    }
    if (acts) break;
    bl = u8(bl + 1);
    if ((bl >> 1) >= m.r8(0x3c1d)) return { stop: 0x9f1a, calls };
  }
  bl = u8(bl - 1);
  const idx = bl >> 1;
  m.w8(0x3bf5, idx); m.w8(0x3bdd, idx);
  m.w8(0x3bdc, 0xc);
  calls.push(['cout', [u8(idx + 0xc1)]]);
  calls.push(['clropt', []]);
  m.w8(0x3bdd, 0x14); m.w8(0x3bdc, 0);
  calls.push(['pmonname', [m.r16(0x3bf5) & 0xff]]);
  const flag = m.r8(m.r16(0x3cb4) + 0x1e) & 0x30;
  const lvl = () => m.r8(0x3c1b);
  const half = () => random(m, 100) >= 0x32;
  const threeQ = () => random(m, 100) >= 0x4b;
  let flees = false;
  if (flag === 0) {
    const l = lvl();
    if (l < 4) flees = false; else if (l < 9) flees = half(); else if (l < 0xe) flees = threeQ(); else flees = true;
  } else if (flag === 0x10) {
    const l = lvl();
    if (l < 9) flees = false; else if (l < 0xe) flees = half(); else flees = threeQ();
  } else if (flag === 0x20) {
    const l = lvl();
    if (l < 0xe) flees = false; else flees = half();
  }
  if (wrong === 'noFlee') flees = false;
  if (!flees) return { stop: 0x9b9d, calls };
  m.w8(0x3bdc, m.r8(0x3bdc) + 1);
  m.w16(BDW_TEXT, 0x30d6); logPtext(m, calls);
  for (const o of [0x16, 0x17, 0x18]) m.w8(m.r16(0x3cb4) + o, 0);
  const bp = m.r16(0x38b2);
  m.w8(0x3888 + bp, 0); m.w8(0x3879 + bp, 0xff);
  resMon2(m);
  if (m.r8(0x3c1d) === 0) { calls.push(['pmonst', []]); return { stop: 0x9fc1, calls }; }
  return { stop: 0x9ec9, calls };
}
