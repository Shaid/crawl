/**
 * Might & Magic I (DOS/EGA) rules ports, written from the 8086 disassembly of `MM.EXE`
 * (see docs/mm1/dosega/game-rules.md). Each function runs against a strict sparse memory (rules-mem.ts) seeded only with
 * the bytes the real routine read under Unicorn (tools/mm1/rules_oracle). Offsets are DS offsets (= MM.RSM type-3 symbol
 * values); `CODE+x` quotes a CS offset (= MM.RSM type-2 symbol value = load-image offset).
 */
import { type Mem } from './rules-mem.ts';

// ---- globals (DS offsets) ----
export const RNG_N = 0x3bc8;      // random(): requested range n (0 is promoted to 2)
export const RNG_R = 0x3bc9;      // random(): result copy
export const RNG_STATE = 0x3bce;  // 32-bit shift register, little-endian
export const RNG_MASK = 0x3bd2;
export const RNG_RETRY = 0x3bd3;  // shared scratch byte; random() reads it on a REJECTED draw (stale-value quirk)

/** CODE+0x451B `random`. AL = n (1..255; 0 behaves as 2); returns AL = 1..n (u8) . State: 32-bit shift register
 *  s = (s << 1) | (bit6(((s3 << 3) ^ s3) & 0xff)) per step, where s3 is the top byte. The draw takes k = bit-length(n)
 *  steps, keeps the low k bits (mask), accepts when value < n; a rejected draw shifts RNG_RETRY (a scratch byte, 4 after
 *  town/sound setup; NOT the bit count) more steps (256 if the byte is 0) before re-testing. */
export function random(m: Mem, n: number, opt: { retryIsBitCount?: boolean } = {}): number {
  n &= 0xff;
  m.w8(RNG_N, n);
  if (n === 0) { n = 2; m.w8(RNG_N, 2); }
  m.w8(RNG_MASK, 0xff);
  // find the highest set bit of n: each missed bit shifts the mask right and costs one count
  let bp = 8;
  let a = n;
  let cf = 0;
  for (;;) {
    const out = a >> 7;
    a = ((a << 1) | cf) & 0xff;
    if (out) break;
    const mk = m.r8(RNG_MASK);
    m.w8(RNG_MASK, mk >> 1);
    cf = mk & 1;
    bp--;
    if (bp === 0) throw new Error('unreachable: n has no bit set');
  }
  let count = bp;
  for (;;) {
    for (let i = 0; i < count; i++) step(m);
    const v = m.r8(RNG_STATE) & m.r8(RNG_MASK);
    if (v < m.r8(RNG_N)) {
      m.w8(RNG_R, v + 1);
      return (v + 1) & 0xff;
    }
    count = opt.retryIsBitCount ? bp : m.r8(RNG_RETRY) || 65536;   // `mov bp,[3bd3]; and bp,0xff; ... dec bp; jne`: 0 wraps to 65536 steps
  }
}
function step(m: Mem): void {
  const s3 = m.r8(RNG_STATE + 3);
  const x = ((s3 << 3) & 0xff) ^ s3;
  let c = (x >> 6) & 1;
  for (let k = 0; k < 4; k++) {
    const v = m.r8(RNG_STATE + k);
    m.w8(RNG_STATE + k, ((v << 1) | c) & 0xff);
    c = v >> 7;
  }
}

// ---- shared globals ----
export const CHARP = 0x3bd6;      // word: DS offset of the current character record (127-byte records from ROSTER)
export const ROSTER = 0x3cfa;
export const REC = 0x7f;
export const BDW_TEXT = 0x3bd4;   // word: text pointer argument of ptext (UI; the stubbed UI callees only record calls)
const u8 = (v: number) => v & 0xff;

// ---- character creation ----
export const STAT = 0x239b;       // 7 rolled attributes (INT MIG PER END SPD ACC LCK); the 0x28-byte block is cleared first
export const STAT2 = 0x23a2;      // untouched copy of the rolled attributes (before race adjustment)
export const TOTAL = 0x23bc;

/** CODE+0x5A42 `rollstat`: 7 x 3d6 into STAT[0..6], total in TOTAL; re-rolls everything until 65 <= total <= 100. */
export function rollStat(m: Mem): void {
  for (;;) {
    for (let i = 0; i < 0x28; i++) m.w8(STAT + i, 0);
    for (let bl = 0; bl < 7; bl++) {
      let a = random(m, 6);
      m.w8(STAT + bl, a);
      a = u8(random(m, 6) + m.r8(STAT + bl));
      m.w8(STAT + bl, a);
      a = u8(random(m, 6) + m.r8(STAT + bl));
      m.w8(STAT + bl, a);
      m.w8(TOTAL, u8(a + m.r8(TOTAL)));
    }
    const t = m.r8(TOTAL);
    if (t < 0x41 || t >= 0x65) continue;
    for (let i = 0; i < 7; i++) m.w8(STAT2 + i, m.r8(STAT + i));
    return;
  }
}

export const RACE_SEL = 0x23aa;
/** CODE+0x549B..0x551C race adjustment of STAT: 1 Human none; 2 INT+1 ACC+1 MIG-1 END-1; 3 END+1 LCK+1 INT-1 SPD-1;
 *  4 LCK+2 SPD-1 ACC-1; any other value (5) MIG+1 END+1 INT-1 PER-1 LCK-1. */
export function raceAdjust(m: Mem): void {
  const race = m.r8(RACE_SEL);
  const add = (i: number, d: number) => m.w8(STAT + i, m.r8(STAT + i) + d);
  if (race === 1) { m.w16(BDW_TEXT, 0x22ac); return; }
  if (race === 2) { m.w16(BDW_TEXT, 0x22b9); add(0, 1); add(5, 1); add(1, -1); add(3, -1); return; }
  if (race === 3) { m.w16(BDW_TEXT, 0x22c6); add(3, 1); add(6, 1); add(0, -1); add(4, -1); return; }
  if (race === 4) { m.w16(BDW_TEXT, 0x22d3); add(6, 1); add(6, 1); add(4, -1); add(5, -1); return; }
  m.w16(BDW_TEXT, 0x22e0); add(1, 1); add(3, 1); add(0, -1); add(2, -1); add(6, -1);
}

export const CLASSES = 0x23bd;    // 6 eligibility flags (non-zero = class offered; the game stores BL = 0x17)
/** a logged UI call: ptext(text pointer, cursor x, cursor y) - the stub records DS:3BD4 / 3BDC / 3BDD at the call */
export type Call = [string, number[]];
const ptextCall = (m: Mem, calls: Call[]) => calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);
/** CODE+0x5AE4 `pclass`: class eligibility from the rolled attributes (>= 12): Knight MIG; Paladin MIG+PER+END; Archer INT+ACC;
 *  Cleric PER; Sorcerer INT; Robber always. One ptext call per class row (cursor row 5 + class index). */
export function classEligibility(m: Mem): { calls: Call[] } {
  const calls: Call[] = [];
  const ge = (i: number) => m.r8(STAT + i) >= 12;
  m.w8(0x3bdc, 0x17);
  m.w8(0x3bdd, 5);
  const row = (k: number, ok: boolean, okText: number) => {
    if (k > 0) { m.w8(0x3bdd, m.r8(0x3bdd) + 1); m.w8(0x3bdc, 0x17); }
    if (ok) { m.w16(BDW_TEXT, okText); ptextCall(m, calls); m.w8(CLASSES + k, 0x17); }
    else { m.w16(BDW_TEXT, 0x2388); ptextCall(m, calls); }
  };
  row(0, ge(1), 0x2231);
  row(1, ge(1) && ge(2) && ge(3), 0x223e);
  row(2, ge(0) && ge(5), 0x224a);
  row(3, ge(2), 0x2256);
  row(4, ge(0), 0x2262);
  row(5, true, 0x226e);
  return { calls };
}

/** CODE+0x5A00 `setspell` (AL = casting attribute): spell points = 3 + (attr>=13) + (>=15) + (>=17) + (>=19), base and
 *  current; spell level 1/1. */
export function setSpell(m: Mem, al: number): void {
  const pts = 3 + (al >= 13 ? 1 : 0) + (al >= 15 ? 1 : 0) + (al >= 17 ? 1 : 0) + (al >= 19 ? 1 : 0);
  const c = m.r16(CHARP);
  m.w8(c + 0x2b, pts);
  m.w8(c + 0x2d, pts);
  m.w8(c + 0x2f, 1);
  m.w8(c + 0x30, 1);
}

/** CODE+0x5982: starting hit points = AL + END bracket (>=19 +4, 17-18 +3, 15-16 +2, 13-14 +1, 8-12 0, 5-7 -1, <5 -2),
 *  stored (low bytes) as HP current/HP/HP max at +0x33/+0x35/+0x37; then SPD bracket (13 +1, 15 +2, 17 +3, 19 +4) is stored
 *  as the current AC at +0x3D (nothing is written when SPD < 13). */
export function startHp(m: Mem, al: number): void {
  const c = () => m.r16(CHARP);
  for (const o of [0x33, 0x35, 0x37]) m.w8(c() + o, al);
  const end = m.r8(STAT + 3);
  if (!(end >= 8 && end < 13)) {       // 8..12 jumps past the second store
    const d = end >= 0x13 ? 4 : end >= 0x11 ? 3 : end >= 0xf ? 2 : end >= 0xd ? 1 : end < 5 ? -2 : -1;
    for (const o of [0x33, 0x35, 0x37]) m.w8(c() + o, u8(al + d));
  }
  const spd = m.r8(STAT + 4);
  let a = 0;
  if (spd >= 0x13) a = 4; else if (spd >= 0x11) a = 3; else if (spd >= 0xf) a = 2; else if (spd >= 0xd) a = 1; else return;
  m.w8(c() + 0x3d, a);
}

/** CODE+0x57B7..0x597C character commit: first free roster slot (ENDROSTER 0x45E8..), record zeroed (126 bytes, the
 *  portrait byte +0x7E is not touched), name, sex/alignment/race/class, 7 attribute pairs, level 1/1, age 18, class
 *  starting HP (K 12, P 10, A 10, C 8, S 6, R 8) + END bonus, casting SP for Cleric (PER) / Sorcerer (INT), race resistances,
 *  food 10, first backpack item 1, alignment counter from the table at DS:0x222E. Returns the slot. */
export function createCommit(m: Mem): number {
  let slot = 0;
  m.w16(CHARP, ROSTER);
  while (m.r8(0x45e8 + slot) !== 0) {
    m.w16(CHARP, (m.r16(CHARP) + REC) & 0xffff);
    if (++slot === 0x12) throw new Error('roster full -> gostart');
  }
  m.w8(0x45e8 + slot, 1);
  const c = m.r16(CHARP);
  for (let i = 0; i < 0x7e; i++) m.w8(c + i, 0);
  for (let i = 0; i < 15; i++) m.w8(c + i, m.r8(0x23ad + i));
  m.w8(c + 0x10, m.r8(0x23ac));
  m.w8(c + 0x11, m.r8(0x23ab));
  m.w8(c + 0x12, m.r8(0x23ab));
  m.w8(c + 0x13, m.r8(0x23aa));
  m.w8(c + 0x14, m.r8(0x23a9));
  for (let i = 0; i < 7; i++) { m.w8(c + 0x15 + 2 * i, m.r8(STAT + i)); m.w8(c + 0x16 + 2 * i, m.r8(STAT + i)); }
  m.w8(c + 0x23, 1); m.w8(c + 0x24, 1);
  m.w8(c + 0x25, 0x12);
  m.w8(c + 0x6c, 1);
  const cls = m.r8(0x23a9);
  let hp: number;
  if (cls === 1) hp = 0xc;
  else if (cls === 2 || cls === 3) hp = 0xa;
  else if (cls === 4) { setSpell(m, m.r8(STAT + 2)); hp = 8; }
  else if (cls === 5) { setSpell(m, m.r8(STAT + 0)); hp = 6; }
  else { m.w8(c + 0x6c, 0x32); hp = 8; }
  startHp(m, hp);
  const race = m.r8(0x23aa);
  const pair = (o: number, v: number) => { m.w8(c + o, v); m.w8(c + o + 1, v); };
  if (race === 1) { pair(0x62, 0x46); pair(0x66, 0x19); }
  else if (race === 2) pair(0x62, 0x46);
  else if (race === 3) pair(0x64, 0x19);
  else if (race === 4) pair(0x58, 0x14);
  else pair(0x66, 0x32);
  m.w8(c + 0x3e, 0xa);
  m.w8(c + 0x46, 1);
  m.w8(c + 0x6f, m.r8(0x222e + u8(m.r8(c + 0x11) - 1)));
  return slot;
}

/** CODE+0x732A `resetac`: current AC (+0x3D) = base AC (+0x3C) + SPD bracket of the CURRENT speed (+0x1E):
 *  >=13 +1, >=15 +2, >=17 +3, >=19 +4, >=21 +5, >=25 +6, >=30 +7, >=35 +8, >=40 +9; 9..12 +0; below 9 it SUBTRACTS 1
 *  (only while AC > 0), another 1 if speed < 7, another if speed < 5 (stops at 0). Temp in DS:3C86. */
export function resetAc(m: Mem): void {
  const c = m.r16(CHARP);
  let ac = m.r8(c + 0x3c);
  m.w8(0x3c86, ac);
  const spd = m.r8(c + 0x1e);
  const T = [[0x28, 9], [0x23, 8], [0x1e, 7], [0x19, 6], [0x15, 5], [0x13, 4], [0x11, 3], [0xf, 2], [0xd, 1]];
  const hit = T.find(([lim]) => spd >= lim);
  if (hit) { ac = u8(ac + hit[1]); m.w8(0x3c86, ac); }
  else if (spd < 9) {
    if (ac !== 0) {
      ac = u8(ac - 1); m.w8(0x3c86, ac);
      if (ac !== 0 && spd < 7) { ac = u8(ac - 1); m.w8(0x3c86, ac); if (ac !== 0 && spd < 5) { ac = u8(ac - 1); m.w8(0x3c86, ac); } }
    }
  }
  m.w8(c + 0x3d, m.r8(0x3c86));
}

// ---- training (CODE+0x2A3A `right6` pieces and the CODE+0x1B68 commit) ----
const TL = 0x15d1;                 // training: current level (set by the caller from +0x23)
const TTHR = 0x15d3;               // 32-bit XP threshold
const TINC = 0x15db;               // 24-bit per-level increment after level 8
const TCOST = 0x15de;              // 24-bit gold cost
/** CODE+0x2A92..0x2BA3: XP threshold and gold cost of the next level. Classes 1 (Knight), 4 (Cleric), 6 (Robber): base 1500,
 *  +150000 per level after 8; the rest (Paladin, Archer, Sorcerer + invalid): base 2000, +200000. The base doubles for each
 *  of levels 2..8 (7 doublings max), then the increment is added (level - 8) times. Gold cost: 7-entry byte tables
 *  (low bytes at 0x15C3 / 0x15B5, high at 0x15CA / 0x15BC) for levels 1..7, 4000 / 3000 from level 8. */
export function xpThreshold(m: Mem): void {
  for (let i = 0; i < 0x14; i++) m.w8(0x15d2 + i, 0);
  const cls = m.r8(m.r16(CHARP) + 0x14);
  m.w8(0x15d2, cls);
  const b = cls === 1 || cls === 4 || cls === 6;
  m.w8(TTHR, b ? 0xdc : 0xd0); m.w8(TTHR + 1, b ? 5 : 7);
  m.w8(TINC, b ? 0xf0 : 0x40); m.w8(TINC + 1, b ? 0x49 : 0x0d); m.w8(TINC + 2, b ? 2 : 3);
  let bl = m.r8(TL);
  if (bl !== 0) {
    if (bl >= 8) { m.w8(TCOST + 1, b ? 0x0b : 0x0f); m.w8(TCOST, b ? 0xb8 : 0xa0); }
    else { bl = u8(bl - 1); m.w8(TCOST, m.r8((b ? 0x15b5 : 0x15c3) + bl)); m.w8(TCOST + 1, m.r8((b ? 0x15bc : 0x15ca) + bl)); }
  }
  bl = m.r8(TL);
  const rd = () => [0, 1, 2, 3].map((i) => m.r8(TTHR + i));
  const wr = (v: number[]) => v.forEach((x, i) => m.w8(TTHR + i, x));
  let bp = 0;
  for (;;) {
    bl = u8(bl - 1);
    if (bl === 0) return;
    const t = rd();
    let carry = 0; const o = t.map((x) => { const y = ((x << 1) | carry) & 0xff; carry = x >> 7; return y; });
    wr(o);
    bp++;
    if (bp >= 7) break;
  }
  for (;;) {
    bl = u8(bl - 1);
    if (bl === 0) return;
    const t = rd(), inc = [m.r8(TINC), m.r8(TINC + 1), m.r8(TINC + 2), 0];
    let carry = 0; wr(t.map((x, i) => { const s = x + inc[i] + carry; carry = s >> 8; return s & 0xff; }));
  }
}

/** CODE+0x2BA3: (threshold - XP) 32-bit into 0x15D7..0x15DA; borrow (XP > threshold) = may train (continues at 0x2BD4), else 0x2C5F. */
export function xpCompare(m: Mem): { stop: number } {
  const c = m.r16(CHARP);
  let borrow = 0;
  for (let i = 0; i < 4; i++) {
    const d = m.r8(TTHR + i) - m.r8(c + 0x27 + i) - borrow;
    borrow = d < 0 ? 1 : 0;
    m.w8(0x15d7 + i, d & 0xff);
  }
  return { stop: borrow ? 0x2bd4 : 0x2c5f };
}

/** CODE+0x2C2E..0x2C5E: gold - cost (24-bit) into 0x15E1..0x15E3; cantrg (0x15E4) +1 when affordable; cantrex (0x15E5) always +1. */
export function trainGold(m: Mem): void {
  const c = m.r16(CHARP);
  let borrow = 0;
  for (let i = 0; i < 3; i++) {
    const d = m.r8(c + 0x39 + i) - m.r8(TCOST + i) - borrow;
    borrow = d < 0 ? 1 : 0;
    m.w8(0x15e1 + i, d & 0xff);
  }
  if (!borrow) m.w8(0x15e4, u8(m.r8(0x15e4) + 1));
  m.w8(0x15e5, u8(m.r8(0x15e5) + 1));
}

/** CODE+0x1B68..0x1D54 training commit. Refused (stop 0x1B28) when cantrex = 0; stop 0x1B1A after UI messages when the
 *  character has a condition (+0x3F != 0: msg 0x247D) or cannot pay (cantrg = 0: msg 0x2437). Otherwise: gold := remaining
 *  gold, level base/current +1, age +1 (cap 220), +0x6C += 2, HP roll = random(class hit die from 0x1374[class-1]) + END
 *  (+0x1B) bonus (>=13 +1, 15 +2, 17 +3, 19 +4, 21 +5, 24 +6, 27 +7, 30 +8, 35 +9, 40 +10; below 9: -1 for 7-8, -2 for 5-6, -3 below,
 *  never below 1); HP and HP max := HP + gain; spell level from the new level (Paladin/Archer 7,9,11,13 -> 1..4; Cleric/Sorcerer
 *  3,5,7,9,11,13 -> 2..7; Knight/Robber none), set (not added) to +0x2F/+0x30 when the level matches. */
export function levelUp(m: Mem): { stop: number; calls: Call[] } {
  const calls: Call[] = [];
  if (m.r8(0x15e5) === 0) return { stop: 0x1b28, calls };
  const c = m.r16(CHARP);
  if (m.r8(c + 0x3f) !== 0) { calls.push(['msg247d', []]); return { stop: 0x1b1a, calls }; }
  if (m.r8(0x15e4) === 0) { calls.push(['nogold', []]); return { stop: 0x1b1a, calls }; }
  for (let i = 0; i < 3; i++) m.w8(c + 0x39 + i, m.r8(0x15e1 + i));
  m.w8(c + 0x23, u8(m.r8(c + 0x23) + 1));
  m.w8(c + 0x24, u8(m.r8(c + 0x24) + 1));
  let age = u8(m.r8(c + 0x25) + 1); if (age >= 0xdc) age = 0xdc; m.w8(c + 0x25, age);
  m.w8(c + 0x6c, u8(m.r8(c + 0x6c) + 2));
  const bl = u8(m.r8(c + 0x14) - 1);
  let g = random(m, m.r8(0x1374 + bl));
  m.w8(0x3bb8, g);
  const end = m.r8(c + 0x1b);
  const T: [number, number][] = [[0x28, 10], [0x23, 9], [0x1e, 8], [0x1b, 7], [0x18, 6], [0x15, 5], [0x13, 4], [0x11, 3], [0xf, 2], [0xd, 1]];
  const hit = T.find(([lim]) => end >= lim);
  if (hit) { g = u8(g + hit[1]); m.w8(0x3bb8, g); }
  else if (end < 9) {
    const n = end >= 7 ? 1 : end >= 5 ? 2 : 3;
    for (let i = 0; i < n; i++) { g = u8(g - 1); m.w8(0x3bb8, g); if (g === 0) { g = 1; m.w8(0x3bb8, 1); break; } }
  }
  g = m.r8(0x3bb8);
  m.w8(0x137d, g);
  const lo = m.r8(c + 0x35) + g;
  m.w8(c + 0x35, lo & 0xff);
  const hi = u8(m.r8(c + 0x36) + (lo >> 8));
  m.w8(c + 0x36, hi);
  m.w8(c + 0x34, hi); m.w8(c + 0x38, hi);
  m.w8(c + 0x33, m.r8(c + 0x35)); m.w8(c + 0x37, m.r8(c + 0x35));
  let sl = 0;
  const lv = m.r8(c + 0x23);
  if (bl >= 1 && bl < 3) { if (lv === 7) sl = 1; else if (lv === 9) sl = 2; else if (lv === 11) sl = 3; else if (lv === 13) sl = 4; }
  else if (bl >= 3 && bl < 5) { if (lv === 3) sl = 2; else if (lv === 5) sl = 3; else if (lv === 7) sl = 4; else if (lv === 9) sl = 5; else if (lv === 11) sl = 6; else if (lv === 13) sl = 7; }
  if (sl) { m.w8(c + 0x2f, sl); m.w8(c + 0x30, sl); }
  m.w8(0x137c, sl);
  return { stop: 0x1d54, calls };
}

// ---- combat ----
export const TEMPAC = 0x3840, THACO = 0x3841, NUMATT = 0x3842, DMGHIT = 0x3843, BONUS = 0x3844, DMGTOT = 0x3845, NUMHIT = 0x3846;
export const MONBASE = 0x2e80, MONTAB = 0x3c58, NMON = 0x3c1d, MONAC = 0x386a, MONCON = 0x3879, MONHP = 0x3888;

/** CODE+0xC008..0xC061 `rolldmg` core: NUMATT swings. Each swing rolls d20: 20 always hits, 1 always misses, otherwise
 *  hit when (d20 + THACO) mod 256 >= TEMPAC + 10 (TEMPAC is raised by 10 in place). A hit adds d(DMGHIT) + BONUS (8-bit)
 *  to DMGTOT (saturating at 255) and counts NUMHIT. NUMATT = 0 would swing 255 times (BL wraps). */
export function rollDamage(m: Mem): void {
  m.w8(DMGTOT, 0); m.w8(NUMHIT, 0);
  m.w8(TEMPAC, u8(m.r8(TEMPAC) + 10));
  let bl = m.r8(NUMATT);
  for (;;) {
    const r = random(m, 20);
    let hit = r === 20;
    if (!hit && r !== 1) hit = u8(r + m.r8(THACO)) >= m.r8(TEMPAC);
    if (hit) {
      const d = u8(random(m, m.r8(DMGHIT)) + m.r8(BONUS));
      const s = d + m.r8(DMGTOT);
      m.w8(DMGTOT, s > 255 ? 0xff : s);
      m.w8(NUMHIT, u8(m.r8(NUMHIT) + 1));
    }
    bl = u8(bl - 1);
    if (bl === 0) return;
  }
}

/** CODE+0xC263 `setmony`: DS:38B2 := index (0..15) of the monster slot whose address equals DS:3CB4 (15 = not found) */
function setMony(m: Mem): number {
  const p = m.r16(0x3cb4);
  let idx = 0;
  while (idx < 15 && p !== MONBASE + 0x20 * idx) idx++;
  m.w16(0x38b2, idx);
  return idx;
}
/** thresholds used by the SPD/ACC style stat bonuses: first entry with value >= limit */
const pick = (v: number, T: [number, number][]) => { const h = T.find(([lim]) => v >= lim); return h ? h[1] : -1; };
const ACC_T: [number, number][] = [[0x28, 7], [0x23, 6], [0x1e, 5], [0x18, 4], [0x13, 3], [0x10, 2], [0xd, 1], [9, 0]];
const MIG_T: [number, number][] = [[0x28, 13], [0x23, 12], [0x1d, 11], [0x1b, 10], [0x19, 9], [0x17, 8], [0x15, 7], [0x13, 6], [0x12, 5], [0x11, 4], [0x10, 3], [0xf, 2], [0xd, 1], [9, 0]];

/** CODE+0xA399.. `attackp` setup for a party member (current char) attacking monster slot `bl` (index into the turn-order table
 *  0x3C58): THACO = level(+0x24), halved for classes >= 4 and quartered for class 5, + weapon bonus (3899) + ACC(+0x20) bracket
 *  (>=13 +1, 16 +2, 19 +3, 24 +4, 30 +5, 35 +6, 40 +7; <9: -1/-2/-3 for 7-8/5-6/<5, never below 0); NUMATT = 1 + level>>3 for
 *  classes < 4 at level >= 8; DMGHIT = weapon dice (3898); BONUS = weapon bonus (3899) + MIG(+0x18) bracket (13 +1, 15 +2, 16 +3,
 *  17 +4, 18 +5, 19 +6, 21 +7, 23 +8, 25 +9, 27 +10, 29 +11, 35 +12, 40 +13; below 9 reduces like ACC); Archer (class 3)
 *  with a missile (389A) adds (level+1)/2; monster condition high nibble set: THACO +4; party effect 3CA2: THACO+1 BONUS+1;
 *  party effect 3CA6 raises TEMPAC (cap 200). Stop 0xA5D7 = proceed to rolldmg, 0xA5E5 = target immune (weapon bonus 0 and
 *  monster flag +0x1A bit 7). */
export function partyAttackSetup(m: Mem, bl: number): { stop: number; calls: Call[] } {
  const calls: Call[] = [];
  const ui = (name: string, args: number[] = []) => calls.push([name, args]);
  const ptext = () => ui('ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]);
  m.w8(0x3bf5, bl);
  m.w16(0x3cb4, m.r16(MONTAB + 2 * bl));
  const idx = setMony(m);
  m.w8(TEMPAC, m.r8(MONAC + idx));
  const c = m.r16(CHARP);
  m.w8(THACO, m.r8(c + 0x24));
  const cls = m.r8(c + 0x14);
  if (cls >= 4) { m.w8(THACO, m.r8(THACO) >> 1); if (cls === 5) m.w8(THACO, m.r8(THACO) >> 1); }
  m.w8(THACO, u8(m.r8(0x3899) + m.r8(THACO)));
  const acc = m.r8(c + 0x20);
  const ab = pick(acc, ACC_T);
  if (ab >= 0) m.w8(THACO, u8(m.r8(THACO) + ab));
  else if (m.r8(THACO) !== 0) {
    const n = acc >= 7 ? 1 : acc >= 5 ? 2 : 3;
    for (let i = 0; i < n; i++) { m.w8(THACO, u8(m.r8(THACO) - 1)); if (m.r8(THACO) === 0) break; }
  }
  m.w8(NUMATT, 1);
  if (m.r8(c + 0x14) < 4 && m.r8(c + 0x24) >= 8) m.w8(NUMATT, u8((m.r8(c + 0x24) >> 3) + m.r8(NUMATT)));
  m.w8(DMGHIT, m.r8(0x3898));
  m.w8(BONUS, m.r8(0x3899));
  const mig = m.r8(c + 0x18);
  const mb = pick(mig, MIG_T);
  if (mb >= 0) m.w8(BONUS, u8(m.r8(BONUS) + mb));
  else if (m.r8(BONUS) !== 0) {
    const n = mig >= 7 ? 1 : mig >= 5 ? 2 : 3;
    for (let i = 0; i < n; i++) { m.w8(BONUS, u8(m.r8(BONUS) - 1)); if (m.r8(BONUS) === 0) break; }
  }
  ui('clropt');
  m.w16(BDW_TEXT, m.r16(CHARP));
  m.w8(0x3bdd, 0x14);
  m.w8(0x3bdc, 0);
  ptext();
  m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1));
  if (m.r8(0x389a) === 0) m.w16(BDW_TEXT, 0x36ec);
  else {
    m.w16(BDW_TEXT, 0x36f4);
    if (m.r8(c + 0x14) === 3) m.w8(BONUS, u8(((m.r8(c + 0x24) + 1) >> 1) + m.r8(BONUS)));
  }
  ptext();
  m.w8(0x389a, 0);
  m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1));
  ui('pmonname', [m.r8(0x3bf5)]);
  if (m.r8(0x3899) === 0 && (m.r8(m.r16(0x3cb4) + 0x1a) & 0x80)) {
    m.w8(0x3bdc, 0);
    m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1));
    m.w16(BDW_TEXT, 0x319b);
    ptext();
    return { stop: 0xa5e5, calls };
  }
  const i2 = m.r16(0x38b2);
  if (m.r8(MONCON + i2) & 0xf0) m.w8(THACO, u8(m.r8(THACO) + 4));
  if (m.r8(0x3ca2) !== 0) { m.w8(THACO, u8(m.r8(THACO) + 1)); m.w8(BONUS, u8(m.r8(BONUS) + 1)); }
  const e6 = m.r8(0x3ca6);
  if (e6 !== 0) { const s = e6 + m.r8(TEMPAC); m.w8(TEMPAC, s > 255 ? 0xc8 : s); }
  return { stop: 0xa5d7, calls };
}

/** CODE+0x9CAE..0x9D52 monster (slot at DS:3CB4, index DS:38B2) attacks the current character: TEMPAC = character AC (+0x3D)
 *  (+1 with effect 3C9D, +3 with 3CA3); THACO = 2 * DS:[3C29+slot] + 4 (+5 when the character has condition bits 0x23);
 *  missile (3189): DMGHIT = monster +0x1C & 0x7F, one attack; else DMGHIT = +0x13, NUMATT = +0x14; BONUS = effect 3CA6 which is
 *  also added to THACO (cap 0xC0 on overflow). */
export function monsterAttackSetup(m: Mem): void {
  const c = m.r16(CHARP);
  m.w8(TEMPAC, m.r8(c + 0x3d));
  const bp = m.r16(0x38b2);                      // getmony
  m.w8(THACO, u8(m.r8(0x3c29 + bp) * 2 + 4));
  if (m.r8(c + 0x3f) & 0x23) m.w8(THACO, u8(m.r8(THACO) + 5));
  const mon = m.r16(0x3cb4);
  if (m.r8(0x3189) !== 0) { m.w8(DMGHIT, m.r8(mon + 0x1c) & 0x7f); m.w8(NUMATT, 1); }
  else { m.w8(NUMATT, m.r8(mon + 0x14)); m.w8(DMGHIT, m.r8(mon + 0x13)); }
  m.w8(BONUS, 0);
  if (m.r8(0x3c9d) !== 0) m.w8(TEMPAC, u8(m.r8(TEMPAC) + 1));
  if (m.r8(0x3ca3) !== 0) m.w8(TEMPAC, u8(m.r8(TEMPAC) + 3));
  const e6 = m.r8(0x3ca6);
  if (e6 !== 0) {
    m.w8(BONUS, e6);
    const s = e6 + m.r8(THACO);
    m.w8(THACO, s > 255 ? 0xc0 : s);
  }
}

/** CODE+0x9DAB `apdmch`: subtract DMGTOT from the 16-bit HP at +0x33. HP exactly 0 -> condition |= 0x40 (unconscious) or, if
 *  already down (+0x3F & 0xC0), 0xC0 (dead, unless bit 7 set). Quirk: when the LOW byte becomes exactly 0 but the high byte is
 *  non-zero the low byte is NOT stored (the damage is lost). */
export function applyDamageChar(m: Mem): { calls: Call[] } {
  const calls: Call[] = [];
  const c = m.r16(CHARP);
  const dmg = m.r8(DMGTOT);
  const lo = m.r8(c + 0x33);
  let nlo = lo - dmg;
  let dead = false;
  if (nlo >= 0) {
    if (nlo !== 0) { m.w8(c + 0x33, nlo); return { calls }; }
    if (m.r8(c + 0x34) !== 0) return { calls };
    dead = true;
  } else {
    nlo &= 0xff;
    m.w8(0x3bb8, nlo);
    const hi = m.r8(c + 0x34);
    if (hi === 0) dead = true;
    else { m.w8(c + 0x34, hi - 1); m.w8(c + 0x33, m.r8(0x3bb8)); return { calls }; }
  }
  void dead;
  m.w8(c + 0x33, 0); m.w8(c + 0x34, 0);
  const ptext = () => calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);
  const cond = m.r8(c + 0x3f);
  if ((cond & 0xc0) === 0) {
    m.w8(c + 0x3f, cond | 0x40);
    m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1)); m.w8(0x3bdc, 0);
    m.w16(BDW_TEXT, m.r16(CHARP)); ptext();
    m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1)); m.w16(BDW_TEXT, 0x382d); ptext();
    calls.push(['dosound', [8]]);
    return { calls };
  }
  if ((m.r8(c + 0x3f) & 0x80) === 0) m.w8(c + 0x3f, 0xc0);
  m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1)); m.w8(0x3bdc, 0);
  m.w16(BDW_TEXT, m.r16(CHARP)); ptext();
  m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1)); m.w16(BDW_TEXT, 0x383a); ptext();
  calls.push(['dosound', [8]]);
  return { calls };
}

/** CODE+0xC2B0 `resmon2`: remove dead monsters (condition 0xFF) from the turn-order pointer table by shifting it down, decrementing
 *  the count (DS:3C1D) each time; rescans from the top until no dead entry remains or the count reaches 0. */
function resMon2(m: Mem): void {
  for (;;) {
    let bl = 0;
    let dead = false;
    for (;;) {
      m.w16(0x3cb4, m.r16(MONTAB + bl));
      bl += 2;
      const idx = setMony(m);
      if (m.r8(MONCON + idx) === 0xff) { dead = true; break; }
      if ((bl >> 1) >= m.r8(NMON)) return;
    }
    void dead;
    let bp = bl;
    bl -= 2;
    for (;;) {
      m.w8(MONTAB + bl, m.r8(MONTAB + bp)); bl++; bp = (bp + 1) & 0xff;
      m.w8(MONTAB + bl, m.r8(MONTAB + bp)); bl++; bp = (bp + 1) & 0xff;
      if ((bp >> 1) >= m.r8(NMON)) break;
    }
    const n = u8(m.r8(NMON) - 1); m.w8(NMON, n);
    if (n === 0) return;
  }
}

/** CODE+0xC15E `apdmmon`: damage DMGTOT to the monster slot DS:38B2: HP - dmg; a borrow or exactly 0 kills it (HP 0, condition 0xFF,
 *  list compaction, "dies" UI unless DS:2E7F), otherwise HP stored and condition &= 0xCF (clears sleep/paralysis nibble bits 4-5). */
export function applyDamageMonster(m: Mem): { calls: Call[] } {
  const calls: Call[] = [];
  const bp = m.r16(0x38b2);
  const al = m.r8(MONHP + bp) - m.r8(DMGTOT);
  if (al > 0) {
    m.w8(MONHP + bp, al);
    m.w8(MONCON + bp, m.r8(MONCON + bp) & 0xcf);
  } else {
    m.w8(MONHP + bp, 0);
    m.w8(MONCON + bp, 0xff);
    calls.push(['dosound', [9]]);
    if (m.r8(0x2e7f) === 0) {
      m.w8(0x3bdc, 0);
      m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1));
      calls.push(['pmonname', [m.r8(0x3bf5)]]);
      m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1));
      m.w16(BDW_TEXT, 0x382d);
      calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);
    }
    resMon2(m);
  }
  calls.push(['pmonst', []]);
  return { calls };
}

/** CODE+0xB8E3 `setinit`: both act thresholds start at 40; two d7 rolls: equal = no change; second > first: monster threshold
 *  (3BF3) += difference, DS:3BE0 = 1; second < first: party threshold (3BF2) += difference, DS:3BE0 = 2 (and DS:3854 = second). */
export function setInitiative(m: Mem): { calls: Call[] } {
  m.w8(0x3bf2, 0x28); m.w8(0x3bf3, 0x28);
  const a = random(m, 7);
  m.w8(0x3854, a);
  const b = random(m, 7);
  if (b === a) { m.w8(0x3be0, 0); m.w8(0x3be1, 0); }
  else if (b > a) { m.w8(0x3be1, b - a); m.w8(0x3be0, 1); m.w8(0x3bf3, u8(m.r8(0x3be1) + m.r8(0x3bf3))); }
  else { m.w8(0x3854, b); m.w8(0x3be1, a - b); m.w8(0x3be0, 2); m.w8(0x3bf2, u8(m.r8(0x3be1) + m.r8(0x3bf2))); }
  return { calls: [['pinit', []]] };
}

// ---- status, saving throws, monster touch effects ----
/** CODE+0xA655 `savechar`: DS:31B1 = 1 when d100 <= 4*level(+0x24) + luck(+0x22) (+20 for class 2), 8-bit; a roll of 99/100 always fails. */
export function saveChar(m: Mem): number {
  const c = m.r16(CHARP);
  let v = u8(u8(m.r8(c + 0x24) << 2) + m.r8(c + 0x22));
  if (m.r8(c + 0x14) === 2) v = u8(v + 0x14);
  m.w8(0x3bb8, v);
  const r = random(m, 100);
  const ok = r < 0x63 && r <= m.r8(0x3bb8) ? 1 : 0;
  m.w8(0x31b1, ok);
  return ok;
}
/** CODE+0xA6A3 `savemons`: DS:31B2 = 1 when d100 <= 8*[3C29+slot] + 20 (8-bit); a roll of 100 always fails. */
export function saveMonster(m: Mem): number {
  const bp = m.r16(0x38b2);
  const v = u8(u8(m.r8(0x3c29 + bp) << 3) + 0x14);
  m.w8(0x3bb8, v);
  const r = random(m, 100);
  const ok = r !== 100 && r <= m.r8(0x3bb8) ? 1 : 0;
  m.w8(0x31b2, ok);
  return ok;
}
/** CODE+0xA6D3 `setcondi`: add condition bits AL to +0x3F; once bit 7 is set only another bit-7 value can add. */
export function setCondition(m: Mem, al: number): void {
  m.w8(0x3bb8, al);
  const c = m.r16(CHARP);
  const cond = m.r8(c + 0x3f);
  if (cond < 0x80) m.w8(c + 0x3f, cond | al);
  else if (m.r8(0x3bb8) >= 0x80) m.w8(c + 0x3f, m.r8(c + 0x3f) | m.r8(0x3bb8));
}
export const RESIST_NAMES = ['magic', 'fire', 'cold', 'elec', 'acid', 'fear', 'poison', 'psychic'] as const;
const RES_FX = [0x3c9b, 0x3c97, 0x3c96, 0x3c9a, 0x3c99, 0x3c95, 0x3c98, -1];
/** CODE+0xA706..0xA79B resistance rolls (resm1 resf2 resc3 rese4 resa5 resh6 resp7 ress8): returns 1 (CF) when the effect AFFECTS:
 *  value = current resistance (+0x59 + 2*i) + party effect byte (fear/psychic: 0x3CA1 set = immune, psychic has no effect byte);
 *  d120 < 3 or >= value affects. */
export function resistRoll(m: Mem, which: number): number {
  if ((which === 5 || which === 7) && m.r8(0x3ca1) !== 0) return 0;
  const c = m.r16(CHARP);
  let v = m.r8(c + 0x59 + 2 * which);
  if (RES_FX[which] >= 0) v = u8(v + m.r8(RES_FX[which]));
  m.w8(0x3bb8, v);
  const r = random(m, 0x78);
  if (r < 3 || r >= m.r8(0x3bb8)) return 1;
  return 0;
}
/** CODE+0xA7C1 `monresma`: CF = d(100 + level) < (monster +0x19 & 0x7F); 0 when that field is 0 (no roll) */
export function monsterResist(m: Mem): number {
  const v = m.r8(m.r16(0x3cb4) + 0x19) & 0x7f;
  if (v === 0) return 0;
  m.w8(0x3bb8, v);
  const r = random(m, u8(m.r8(m.r16(CHARP) + 0x24) + 0x64));
  return r < m.r8(0x3bb8) ? 1 : 0;
}

class Abort extends Error {}
/** CODE+0xAC2A: effect gate. random(n); random(that); random(n): the effect proceeds only when the THIRD roll equals n (1 in n);
 *  otherwise the handler is abandoned (pop ax; ret). */
function gate(m: Mem, n: number): void {
  m.w8(0x3bb8, n);
  const r1 = random(m, n);
  random(m, r1);
  const r3 = random(m, m.r8(0x3bb8));
  if (r3 !== m.r8(0x3bb8)) throw new Abort();
}
/** Monster touch effects: the 25 handlers of the DS:3229 table (index = bonusOnTouch - 1). Each message is a text pointer plus
 *  the shared tail CODE+0xAC07 (ptext at col 4, cout '!', ptext 0x31B3). */
export function monsterTouch(m: Mem): { calls: Call[] } {
  const calls: Call[] = [];
  const ptext = () => calls.push(['ptext', [m.r16(BDW_TEXT), m.r8(0x3bdc), m.r8(0x3bdd)]]);
  const tail = () => {
    m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1)); m.w8(0x3bdc, 4); ptext();
    calls.push(['cout', [0x21]]);
    m.w16(BDW_TEXT, 0x31b3); m.w8(0x3bdc, 0); ptext();
  };
  const say = (p: number) => { m.w16(BDW_TEXT, p); tail(); };
  const ac25 = (p: number) => { m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1)); m.w8(0x3bdc, 0); m.w16(BDW_TEXT, m.r16(CHARP)); ptext(); m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1)); m.w16(BDW_TEXT, p); ptext(); };
  if (m.r8(0x3189) !== 0) return { calls };
  const mon = m.r16(0x3cb4);
  const v = m.r8(mon + 0x1b);
  if (v === 0) return { calls };
  if (v >= 0x80) { saveChar(m); return { calls }; }
  const c = () => m.r16(CHARP);
  const cond1 = () => { setCondition(m, 8); say(0x3266); };
  const fear = () => { if (resistRoll(m, 5)) { setCondition(m, 0x20); say(0x3277); } };
  const poison = () => { if (resistRoll(m, 6)) { setCondition(m, 0x10); say(0x3288); } };
  try {
    switch (v) {
      case 1: gate(m, 3); m.w8(c() + 0x3e, 0); say(0x325b); break;
      case 2: gate(m, 0x14); cond1(); break;
      case 3: gate(m, 0x14); fear(); break;
      case 4: gate(m, 0x14); poison(); break;
      case 5:
        gate(m, 2);
        if (m.r8(c() + 0x32) === 0 && m.r8(c() + 0x31) === 0) break;
        { const hi = m.r8(c() + 0x32), lo = m.r8(c() + 0x31); m.w8(c() + 0x32, hi >> 1); m.w8(c() + 0x31, lo >> 1); /* `and bp,0xff` between the two rcr clears the carry */ }
        say(0x3297); break;
      case 6: {
        const a = m.r8(c() + 0x1c);
        if (a === 0) setCondition(m, 0xc0);
        else { m.w8(c() + 0x1c, a - 1); if (a - 1 === 0) setCondition(m, 0xc0); }
        m.w16(BDW_TEXT, 0x32a8); m.w8(DMGTOT, u8(m.r8(DMGTOT) + 3)); tail(); break;
      }
      case 7: if (resistRoll(m, 7)) { setCondition(m, 1); say(0x32ba); } break;
      case 8: fear(); break;
      case 9: gate(m, 4); cond1(); break;
      case 10: {
        gate(m, 2);
        if (m.r8(c() + 0x3b) === 0 && m.r8(c() + 0x3a) === 0 && m.r8(c() + 0x39) === 0) break;
        let carry = 0;
        for (const o of [0x3b, 0x3a, 0x39]) { const x = m.r8(c() + o); m.w8(c() + o, (x >> 1) | (carry << 7)); carry = x & 1; }
        say(0x32c8); break;
      }
      case 11: {
        gate(m, 2);
        let bp = 0x4b;
        for (; bp >= 0x46; bp--) if (m.r8(c() + bp) !== 0) break;
        if (bp < 0x46) break;
        m.w8(c() + bp, 0); say(0x32d9); break;
      }
      case 12: poison(); break;
      case 13: gate(m, 3); setCondition(m, 2); say(0x32ea); break;
      case 14: {
        const a = m.r8(c() + 0x24);
        if (a === 0) setCondition(m, 0xc0);
        else { m.w8(c() + 0x24, a - 1); if (a - 1 === 0) setCondition(m, 0xc0); }
        m.w8(DMGTOT, u8(m.r8(DMGTOT) + 10)); say(0x32fb); break;
      }
      case 15: gate(m, 3); if (resistRoll(m, 0)) { setCondition(m, 0xa0); ac25(0x330c); ptext2(); } break;
      case 16:
        if (resistRoll(m, 0)) {
          const s = m.r8(c() + 0x25) + 10;
          m.w8(c() + 0x25, s & 0xff);
          if (s > 255) { m.w8(c() + 0x25, 0xc8); setCondition(m, 0xff); }
          say(0x331f);
        }
        break;
      case 17: {
        const a = m.r8(c() + 0x24);
        if (a >= 3) m.w8(c() + 0x24, a - 2); else { m.w8(c() + 0x24, 0); setCondition(m, 0xc0); }
        m.w8(DMGTOT, u8(m.r8(DMGTOT) + 0x14)); say(0x32fb); break;
      }
      case 18: gate(m, 3); if (resistRoll(m, 0)) { setCondition(m, 0xc0); ac25(0x3332); ptext2(); } break;
      case 19: gate(m, 3); if (resistRoll(m, 0)) { setCondition(m, 0x40); say(0x333c); } break;
      case 20: { const a = m.r8(c() + 0x18); if (a >= 4) m.w8(c() + 0x18, a - 3); else { m.w8(c() + 0x18, 0); setCondition(m, 0xc0); } say(0x3354); break; }
      case 21:
        for (let bp = 0x16; bp < 0x25; bp += 2) {
          const a = m.r8(c() + bp);
          if (a >= 3) m.w8(c() + bp, a - 2);
          else { m.w8(c() + bp, 0); m.w8(0x3bb9, bp); setCondition(m, 0xc0); }
        }
        say(0x3361); break;
      case 22: gate(m, 2); for (let o = 0x46; o < 0x4c; o++) m.w8(c() + o, 0); say(0x3372); break;
      case 23: gate(m, 2); for (const o of [0x39, 0x3a, 0x3b, 0x31, 0x32]) m.w8(c() + o, 0); say(0x3382); break;
      case 24: m.w8(0x3bdd, u8(m.r8(0x3bdd) + 1)); m.w8(0x3bdc, 0); setCondition(m, 0xff); m.w16(BDW_TEXT, m.r16(CHARP)); ptext(); m.w8(0x3bdc, u8(m.r8(0x3bdc) + 1)); m.w16(BDW_TEXT, 0x3397); ptext(); break;
      case 25: m.w8(c() + 0x2b, 0); m.w8(c() + 0x2c, 0); say(0x33a5); break;
      default: throw new Error('table entry beyond 25 is not code');
    }
  } catch (e) { if (!(e instanceof Abort)) throw e; }
  return { calls };
  function ptext2() { /* ac25 already did both ptext calls */ }
}
