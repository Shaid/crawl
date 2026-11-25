/**
 * Might & Magic II (Amiga) game rules, ported from the game's own 68000 code.
 * Every routine here is diffed against the retail `mm2` executable run under
 * Unicorn (tools/mm2/rules_oracle/, vectors in tools/mm2/rules_oracle/vectors/)
 * - see docs/mm2/amiga/game-rules.md for offsets and evidence grades.
 *
 * Conventions: `CODE+0x...` offsets are into the root CODE hunk (0x2593C bytes);
 * `A4-n` is SAS/C small data (A4 = DATA+0x7FFE). Ints are 16 bit. Routines take a
 * `Mem` (rules-mem.ts) whose byte layout is the game's own, so ports read and
 * write the same globals the 68k code does.
 */
import { type Mem, g } from './rules-mem.ts';

/* ------------------------------------------------------------------ RNG */

export const SEED = -24802; // A4-24802, u32

/** CODE+0x24048: seed = seed*0x41C64E6D + 0x3039 (mod 2^32); returns (seed>>16)&0x7FFF. */
export function rand15(m: Mem): number {
  const s0 = m.r32(g(SEED));
  // 32x32 -> low 32 bits, split to stay in double precision
  const lo = Math.imul(s0, 0x41c64e6d) >>> 0;
  const s = (lo + 0x3039) >>> 0;
  m.w32(g(SEED), s);
  return (s >>> 16) & 0x7fff;
}

/** CODE+0x2407C srand(w): seed = (u16)w */
export function srand(m: Mem, w: number): void {
  m.w32(g(SEED), w & 0xffff);
}

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;

/**
 * CODE+0x22BC6 rand(lo, hi): returns lo when hi <= lo (no draw); otherwise
 * lo + r / k with r = rand15(), k = 0x8000 / (hi-lo+1) (both unsigned 16-bit
 * divisions). Because k is truncated the result can exceed hi (up to hi+1 for
 * large r). Preconditions mirrored from the 68k code: hi-lo+1 and k are used
 * as unsigned divisors, so 0 < hi-lo+1 <= 0x8000.
 */
export function randRange(m: Mem, lo: number, hi: number): number {
  lo = s16(lo);
  hi = s16(hi);
  if (hi <= lo) return lo & 0xffff;
  const r = rand15(m);
  const range = (hi - lo + 1) & 0xffff;
  const k = Math.floor(0x8000 / range) & 0xffff;
  const q = Math.floor(r / k) & 0xffff;
  return (q + lo) & 0xffff;
}

/* ------------------------------------------------------ monster unpack */

/** A4 displacements used by the monster-record unpacker (CODE+0x4C8E). */
export const MON = {
  bufPtr: -30658, // u32: loaded monsters.dat (26-byte records)
  slotType: -4574, // u8[11]: record index per battle slot
  hpMul: -29804, // u16[4] hp/xp multiplier table
  nib: -29796, // u8[8] table indexed by (code>>4)&0xE / (mres>>5)
  name: -4562, // 14 bytes, & 0x7F
  hp: -4512, // u16
  xp: -4510, // u32
} as const;

const mulu16 = (a: number, b: number) => ((a & 0xffff) * (b & 0xffff)) >>> 0;

/**
 * CODE+0x4C8E unpack_monster(slot): copies record `slotType[slot]` out of the
 * loaded monsters.dat (CODE+0x099C4 copies 26 bytes) and decodes it into the
 * global working struct at A4-4562..A4-4507 (0x38 bytes, cleared first).
 * Field -> offset map is in docs/mm2/amiga/game-rules.md section 3.
 */
export function unpackMonster(m: Mem, slot: number, opts: { capX10?: boolean; noX10?: boolean } = {}): void {
  const id = m.r8(g(MON.slotType + (slot & 0xff)));
  const base = m.r32(g(MON.bufPtr));
  const rec: number[] = [];
  for (let i = 0; i < 26; i++) rec.push(m.r8(base + id * 26 + i));
  for (let i = 0; i < 0x38; i++) m.w8(g(-4562 + i), 0);
  for (let i = 0; i < 14; i++) m.w8(g(-4562 + i), rec[i] & 0x7f);
  const inc = (d: number) => m.w8(g(d), (m.r8(g(d)) + 1) & 0xff);
  const tbl = (k: number) => m.r16(g(MON.hpMul + 2 * k));
  // hp (record 0x0E)
  let c = rec[14];
  m.w16(g(-4512), mulu16((c & 0x3f) + 1, tbl((c >> 6) & 3)));
  // xp (0x0F)
  c = rec[15];
  let xp = Math.imul((c & 0x1f) + 1, tbl((c & 0x60) >> 5)) >>> 0;
  if (c > 0x7f) xp = Math.imul(xp, 1000) >>> 0;
  m.w32(g(-4510), xp);
  // treasure (0x10)
  c = rec[16];
  if (c & 0x80) inc(-4544);
  if (c & 0x40) inc(-4545);
  if (c & 0x20) inc(-4546);
  if (c & 0x04) inc(-4542);
  m.w8(g(-4541), c & 3);
  m.w8(g(-4543), (c >> 3) & 3);
  // pabil (0x11)
  c = rec[17];
  m.w8(g(-4540), c & 0x1f);
  m.w8(g(-4539), m.r8(g(MON.nib + ((c & 0xe0) >> 4))));
  // sabil (0x12)
  c = rec[18];
  if (c & 0x80) inc(-4525);
  if (c & 0x40) inc(-4526);
  if (c & 0x20) inc(-4536);
  m.w8(g(-4537), c & 0x1f);
  // oabil (0x13)
  c = rec[19];
  if (c & 0x80) inc(-4513);
  m.w8(g(-4535), (c & 0x0f) + 1);
  if (c & 0x10) m.w8(g(-4535), mulu16(m.r8(g(-4535)), 10));
  m.w8(g(-4534), (c >> 5) & 3);
  // speed (0x14)
  c = rec[20];
  m.w8(g(-4530), c & 0x0f);
  m.w8(g(-4538), c >> 4);
  inc(-4530);
  inc(-4538);
  // picture (0x15)
  m.w8(g(-4533), rec[21] & 0x7f);
  // ac (0x16)
  c = rec[22];
  if (c & 0x80) inc(-4524);
  if (c & 0x40) inc(-4523);
  m.w8(g(-4532), (c & 0x1f) + 1);
  if (c & 0x20) m.w8(g(-4532), mulu16(m.r8(g(-4532)), 10));
  // damage (0x17) and initiative (0x18): x10 capped at 250 when the value is > 25
  for (const [rc, flagA, flagB, dst] of [
    [rec[23], -4521, -4522, -4531],
    [rec[24], -4519, -4520, -4529],
  ] as const) {
    if (rc & 0x80) inc(flagA);
    if (rc & 0x40) inc(flagB);
    m.w8(g(dst), (rc & 0x1f) + 1);
    if (rc & 0x20 && !opts.noX10) {
      if (opts.capX10 !== false && m.r8(g(dst)) > 0x19) m.w8(g(dst), 0xfa);
      else m.w8(g(dst), mulu16(m.r8(g(dst)), 10));
    }
  }
  // mres (0x19)
  c = rec[25];
  if (c & 1) inc(-4517);
  if (c & 2) inc(-4518);
  if (c & 4) inc(-4516);
  m.w8(g(-4528), (c >> 3) & 3);
  m.w8(g(-4527), m.r8(g(MON.nib + ((c >> 5) & 7))));
}

/* ----------------------------------------------------- party helpers */

export const PARTY = {
  slots: -31082, // u16[8]: roster index per party slot (0xFFFF = empty)
  size: -31066, // u16 member count (low byte also read at A4-31065)
  roster: -10814, // 130-byte character records (in-memory words are big endian)
  curChar: -1272, // u8 acting party slot
  curMon: -1271, // u8 acting monster slot
} as const;
export const CHAR_SIZE = 0x82;

/** CODE+0x0477E char_ptr(slot): roster base + slots[slot] * 130 (MULS) */
export function charPtr(m: Mem, slot: number): number {
  const w = s16(m.r16(g(PARTY.slots) + 2 * slot));
  return g(PARTY.roster) + w * CHAR_SIZE;
}

/* --------------------------------------------- monster melee (CODE+0x10478) */

export const COMBAT = {
  dmg: -3852, // u16 damage accumulator
  hits: -24113, // u8 hits landed
  attacks: -24109, // u8 attacks per round for the acting monster (copied from the unpacked record)
  monTier: -4574, // u8[11]
  status: -1305, // u8[11] monster status bits
  tierThr: -28438, // u8[16] to-hit threshold by monster tier (record index >> 4)
  recAttacks: -4530, // unpacked: attacks per round (speed low nibble + 1)
  recDamage: -4531, // unpacked: damage die
} as const;

export interface MeleeResult {
  calls: [string, number[]][];
}

/**
 * One monster's melee attack on the acting party member. The game rolls, for each
 * of its attacks, d = rand(10,1009)/10 (1..100) against a threshold v and adds rand(1,damage)
 * per hit; then it hands the accumulated damage to the (UI + damage-application)
 * routine CODE+0x0FF42, which this port reports as the call `applyHit [dmg, hits]`.
 *   v = AC <= T ? T - AC : 5       (T = tierThr[monsterId >> 4], AC = char +0x24)
 *   status bit 3 (blinded/..) halves v; status bit 2 halves the total damage.
 */
export function monsterMelee(m: Mem, opts: { noHalve?: boolean; ac5?: boolean } = {}): MeleeResult {
  const ch = charPtr(m, m.r8(g(PARTY.curChar)));
  const slot = m.r8(g(PARTY.curMon));
  m.w16(g(COMBAT.dmg), 0);
  m.w8(g(COMBAT.hits), 0);
  m.w8(g(COMBAT.attacks), m.r8(g(COMBAT.recAttacks)));
  const T = m.r8(g(COMBAT.tierThr) + (m.r8(g(COMBAT.monTier) + slot) >> 4));
  const ac = m.r8(ch + 36);
  let v = ac > T ? 5 : (T - ac) & 0xff;
  if (opts.ac5) v = 5;
  const st = m.r8(g(COMBAT.status) + slot);
  if (st & 8 && !opts.noHalve) v >>= 1;
  for (let i = 0; i < m.r8(g(COMBAT.attacks)); i++) {
    const r = Math.trunc(s16(randRange(m, 10, 1009)) / 10) & 0xff;
    if (v > r) {
      m.w8(g(COMBAT.hits), (m.r8(g(COMBAT.hits)) + 1) & 0xff);
      m.w16(g(COMBAT.dmg), m.r16(g(COMBAT.dmg)) + randRange(m, 1, m.r8(g(COMBAT.recDamage))));
    }
  }
  if (st & 4) m.w16(g(COMBAT.dmg), m.r16(g(COMBAT.dmg)) >> 1);
  return { calls: [['applyHit', [m.r16(g(COMBAT.dmg)), m.r8(g(COMBAT.hits))]]] };
}

/* ------------------------------------------------- character primitives */

/** CODE+0x04442 stat_bonus(v): -3 + number of thresholds (A4-29830) that v exceeds, as a byte (0xFD = -3). */
export function statBonus(m: Mem, v: number): number {
  let b = 0xfd;
  for (let i = 0; v > m.r8(g(-29830) + i); i++) b = (b + 1) & 0xff;
  return b;
}

/**
 * CODE+0x048BA luck save for a character (record +0x20 working level, +0x15 luck):
 * d100 <= 5 always fails, >= 95 always passes, otherwise
 * stat_bonus(luck) + level >= rand(1, level+20)   (a negative sum is replaced by 2).
 */
export function luckSave(m: Mem, ch: number, opts: { noAuto?: boolean } = {}): number {
  const r = randRange(m, 1, 100) & 0xff;
  if (!opts.noAuto) {
    if (r <= 5) return 0;
    if (r >= 0x5f) return 1;
  }
  const lvl = m.r8(ch + 32);
  const d = randRange(m, 1, lvl + 20) & 0xff;
  let b = (statBonus(m, m.r8(ch + 21)) + lvl) & 0xff;
  if (b < lvl) b = 2;
  return b >= d ? 1 : 0;
}

/**
 * CODE+0x04952 damage_char(ch, dmg, pB, pA, pC): the party-member damage routine.
 *  - condition byte (+0x26) >= 0x80 (dead/stoned/...): nothing happens
 *  - *pA != 0: percentage save, (A4-31146 + char+0x16) >= d100 negates the hit entirely; else *pA = 0
 *  - *pB != 0: luck_save() succeeds -> damage / 2
 *  - *pC (damage type, 3 and 0xFF = none): resist = A4-31145 + (char +0x17 / +0x1c / +0x18 /
 *    +0x11+type for type 1 / 2 / 0 / other); resist >= d100 -> damage / 4, else *pC = 0
 *  - damage > 0: clears the asleep bit (0x10); a character already unconscious (0x40) dies
 *    (condition 0x81); otherwise hp (+0x5E) -= damage, and damage >= hp sets 0x40 (unconscious)
 *    with hp = 0. The final (reduced) damage is always left in A4-3852.
 */
export function damageChar(m: Mem, ch: number, dmg: number, pB: number, pA: number, pC: number, opts: { noQuarter?: boolean } = {}): void {
  let flag3 = 0;
  if (m.r8(ch + 38) >= 0x80) return;
  if (m.r8(pA) !== 0) {
    const t = (m.r8(g(-31146)) + m.r8(ch + 22)) & 0xff;
    const r = randRange(m, 1, 100) & 0xff;
    if (!(t < r)) return;
  }
  m.w8(pA, 0);
  if (m.r8(pB) !== 0) {
    if (luckSave(m, ch) !== 0) dmg = (dmg & 0xffff) >> 1;
  }
  const c = m.r8(pC);
  if (!(c === 3 || c === 0xff)) {
    let t = m.r8(g(-31145));
    if (c === 1) t += m.r8(ch + 23);
    else if (c === 2) t += m.r8(ch + 28);
    else if (c === 0) t += m.r8(ch + 24);
    else t += m.r8(ch + c + 17);
    t &= 0xff;
    const r = randRange(m, 1, 100) & 0xff;
    if (t < r) m.w8(pC, 0);
    else if (!opts.noQuarter) dmg = (dmg & 0xffff) >> 2;
  }
  dmg &= 0xffff;
  if (dmg !== 0) {
    m.w8(ch + 38, m.r8(ch + 38) & 0xef);
    if (m.r8(ch + 38) & 0x40) {
      flag3 = 0x81;
      m.w8(ch + 38, 0x81);
    } else {
      const hp = m.r16(ch + 94);
      if (dmg < hp) m.w16(ch + 94, hp - dmg);
      else {
        m.w8(ch + 38, m.r8(ch + 38) | 0x40);
        flag3++;
      }
    }
    if (flag3) m.w16(ch + 94, 0);
  }
  m.w16(g(-3852), dmg);
}
