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

/* -------------------------------------- party attack roll (CODE+0x111DA) */

/**
 * Party member attacks monster `target` (melee, or ranged when A4-24114 == 1).
 * Per attack (count = level / classTbl[-28470] + 1):
 *   d = d100: < 6 hits outright, < 9 misses outright
 *   else r = rand(1, (class-flag bit0 of +0x26 ? 3 : 25) + level/classTbl[-28478]) (cap 250),
 *        s = r + (weapon accuracy byte + stat_bonus(accuracy +0x6F) + A4-31133)
 *        s > 255 hit; s <= 10 miss; (s&255) - A4-31141 outside 0..127 miss;
 *        else hit iff (s&255) >= monster AC
 *   hit: damage = rand(1, dieByte) + (weapon bonus + stat_bonus(might +0x6B)), > 250 -> 1
 * Total damage += A4-31129 when anything hit. Melee only: Robber (class 5) crit on d<5 or >90
 * (x2), Ninja (class 6) on d<5 or >94 (x4), d = rand(1, 100 + min(+0x72,100)).
 * The result is handed to CODE+0x11040 (messages and damage application), reported as
 * `resolve [damage, hits, crit]`. The interactive target prompt (target 0xFF) is not modelled.
 */
export function partyAttack(m: Mem, target: number, opts: { noCrit?: boolean; flatAc?: boolean } = {}): { calls: [string, number[]][] } {
  const mode = m.r8(g(-24114));
  let n = mode === 1 ? m.r8(g(-30654)) : m.r8(g(-1316));
  if (n > 10) n = 10;
  let arg = target & 0xff;
  if (n <= 1) arg = 0;
  if (arg === 0xff) throw new Error('interactive target prompt not modelled');
  m.w8(g(-1309), arg);
  const ch = charPtr(m, m.r8(g(-1269)));
  unpackMonster(m, arg);
  for (const d of [-24106, -24111, -24112, -24113]) m.w8(g(d), 0);
  m.w16(g(-3852), 0);
  const cls = m.r8(ch + 15);
  const lvl = m.r8(ch + 113);
  m.w8(g(-24108), Math.floor(lvl / m.r8(g(-28478) + cls)) & 0xff);
  m.w8(g(-24110), (Math.floor(lvl / m.r8(g(-28470) + cls)) + 1) & 0xff);
  m.w8(g(-24109), m.r8(g(-24110)));
  m.w8(g(-24112), m.r8(ch + 76));
  m.w8(g(-24107), m.r8(ch + 77));
  if (mode === 1) {
    m.w8(g(-24107), m.r8(ch + 79));
    if (cls !== 2) m.w8(g(-24112), m.r8(ch + 78));
    else m.w8(g(-24111), randRange(m, 1, Math.min(m.r8(ch + 113), 100)));
  }
  const add8 = (d: number, v: number) => m.w8(g(d), (m.r8(g(d)) + v) & 0xff);
  add8(-24111, m.r8(g(-24107)));
  add8(-24111, statBonus(m, m.r8(ch + 107)));
  add8(-24107, statBonus(m, m.r8(ch + 111)));
  add8(-24107, m.r8(g(-31133)));
  for (let i = 0; i < m.r8(g(-24110)); i++) {
    let hit = 0;
    const d = randRange(m, 1, 100) & 0xff;
    if (d < 6) hit = 1;
    else if (d < 9) hit = 0;
    else {
      const t = m.r8(ch + 38) & 1 ? 3 : 25;
      let w = t + m.r8(g(-24108));
      if (w > 250) w = 250;
      const s = (randRange(m, 1, w) + m.r8(g(-24107))) & 0xffff;
      if (s > 255) hit = 1;
      else if (s <= 10) hit = 0;
      else if ((((s & 0xff) - m.r8(g(-31141))) & 0xffff) >= 0x80) hit = 0;
      else hit = (s & 0xff) < (opts.flatAc ? 0 : m.r8(g(-4532))) ? 0 : 1;
    }
    if (hit) {
      let dmg = (randRange(m, 1, m.r8(g(-24112))) + m.r8(g(-24111))) & 0xff;
      if (dmg > 0xfa) dmg = 1;
      add8(-24113, 1);
      m.w16(g(-3852), m.r16(g(-3852)) + dmg);
    }
  }
  if (m.r8(g(-24113)) !== 0) m.w16(g(-3852), m.r16(g(-3852)) + m.r8(g(-31129)));
  if (mode === 0 && !opts.noCrit) {
    const r = randRange(m, 1, 100 + Math.min(m.r8(ch + 114), 100)) & 0xff;
    if (m.r8(ch + 15) === 5) {
      if (r > 0x5a || r < 5) {
        add8(-24106, 1);
        m.w16(g(-3852), m.r16(g(-3852)) * 2);
      }
    } else if (m.r8(ch + 15) === 6) {
      if (r > 0x5e || r < 5) {
        m.w8(g(-24106), 2);
        m.w16(g(-3852), m.r16(g(-3852)) * 4);
      }
    }
  }
  return { calls: [['resolve', [m.r16(g(-3852)), m.r8(g(-24113)), m.r8(g(-24106))]]] };
}

/* --------------------------------------------- monster/party small rules */

/**
 * CODE+0x105B6: may the acting monster use its group ability this turn?
 * Needs: not status bit 6, ability uses left (A4-1283[slot]) > 0, and rand(1,100) <= the
 * unpacked ability-chance tier (A4-4539, from pabil bits 5-7 -> table {0,10,20,35,50,75,90,100}).
 * Spends one use. Returns 1/0.
 */
export function monsterUsesAbility(m: Mem, opts: { alwaysSpend?: boolean } = {}): number {
  let f = 0;
  const r = randRange(m, 1, 100) & 0xff;
  const slot = m.r8(g(PARTY.curMon));
  if (!(m.r8(g(-1305) + slot) & 0x40) && m.r8(g(-1283) + slot) !== 0 && !(m.r8(g(-4539)) < r)) f = 1;
  if (f || opts.alwaysSpend) m.w8(g(-1283) + slot, (m.r8(g(-1283) + slot) - 1) & 0xff);
  return f;
}

/**
 * CODE+0x10B70 reward for the monster in A4-1309 that just died: unpacked flag bytes
 * (treasure field of monsters.dat) drive three accumulators.
 *  gems  (A4-16146, u16) += rand(1,10)                          if A4-4542
 *  gold  (A4-16144, u32) += rand(1,50)+6 + (b << 8) where b = id (>>4 if A4-4543==2, >>1 if >=3)
 *        plus rand(1,b); b = 0 when A4-4543 == 1                 if A4-4543
 *  item tier (A4-24105/-24104) records the best (id>>4, A4-4541) seen so far  if A4-4541
 *  xp pool (A4-28614, u32) += unpacked monster xp (A4-4510)
 */
export function killReward(m: Mem, opts: { noShift?: boolean } = {}): void {
  const slot = () => m.r8(g(-1309));
  let b = 0;
  if (m.r8(g(-4542))) m.w16(g(-16146), m.r16(g(-16146)) + randRange(m, 1, 10));
  const k = m.r8(g(-4543));
  if (k) {
    b = m.r8(g(-4574) + slot());
    if (k === 2) b = (b >> 4) & 0xff;
    if (k >= 3) b = (b >> 1) & 0xff;
    b = (b + randRange(m, 1, b)) & 0xff;
    const w4 = (randRange(m, 1, 50) + 6) & 0xffff;
    if (k === 1) b = 0;
    m.w32(g(-16144), m.r32(g(-16144)) + w4);
    m.w32(g(-16144), m.r32(g(-16144)) + (opts.noShift ? b : (b << 8) & 0xffff));
  }
  const t = m.r8(g(-4541));
  if (t && !(t < m.r8(g(-24105)))) {
    m.w8(g(-24104), m.r8(g(-4574) + slot()) >> 4);
    m.w8(g(-24105), t);
  }
  m.w32(g(-28614), m.r32(g(-28614)) + m.r32(g(-4510)));
}

/**
 * CODE+0x11E58 party power for encounter generation: sum of every member's +0x74 word,
 * / 8, then by difficulty (A4-31150): 0 -> /4, 1 -> /2, 3 -> x2 (2 unchanged); also leaves
 * half the highest member level (+0x71 / 2) in A4-28610.
 */
export function partyPower(m: Mem, opts: { noDifficulty?: boolean } = {}): void {
  m.w32(g(-28618), 0);
  let top = 0;
  const size = s16(m.r16(g(PARTY.size)));
  for (let i = 0; i < size; i++) {
    const ch = charPtr(m, i);
    m.w32(g(-28618), m.r32(g(-28618)) + m.r16(ch + 116));
    const half = m.r8(ch + 113) >> 1;
    if (half > top) top = half;
  }
  m.w32(g(-28618), Math.floor(m.r32(g(-28618)) / 8));
  const d = m.r8(g(-31150));
  if (!opts.noDifficulty) {
    if (d === 0) m.w32(g(-28618), Math.floor(m.r32(g(-28618)) / 4));
    if (d === 1) m.w32(g(-28618), Math.floor(m.r32(g(-28618)) / 2));
    if (d === 3) m.w32(g(-28618), Math.imul(m.r32(g(-28618)), 2) >>> 0);
  }
  m.w8(g(-28610), top);
}

/** CODE+0x1F6DC monster-cast spell damage: adds (record index>>4) dice rand(1,n) to A4-3852, then x2 + 1. */
export function monsterSpellDamage(m: Mem, n: number, opts: { plain?: boolean } = {}): void {
  const tier = m.r8(g(-4574) + m.r8(g(PARTY.curMon))) >> 4;
  for (let d = 0; d < tier; d++) m.w16(g(-3852), m.r16(g(-3852)) + randRange(m, 1, n));
  if (!opts.plain) {
    m.w16(g(-3852), (m.r16(g(-3852)) * 2) & 0xffff);
    m.w16(g(-3852), m.r16(g(-3852)) + 1);
  }
}

/**
 * CODE+0x04476 copies the character's stored stats into the working copies combat reads:
 * +0x6B <- +0x10 (might), +0x6F <- +0x14 (accuracy), +0x6D <- +0x12 (personality), +0x6C <- +0x11 (int),
 * +0x71 <- +0x20 (level), +0x72 <- +0x23 (spell level), +0x6E <- +0x13 (speed).
 */
export function syncStats(m: Mem, ch: number): void {
  for (const [dst, src] of [[107, 16], [111, 20], [109, 18], [108, 17], [113, 32], [114, 35], [110, 19]] as const) m.w8(ch + dst, m.r8(ch + src));
}

/* ----------------------------------------- spell level / spell points */

export const CLASS = { knight: 0, paladin: 1, archer: 2, cleric: 3, sorcerer: 4, robber: 5, ninja: 6, barbarian: 7 } as const;

/**
 * CODE+0x20064 learn_spell_level(slot): called when a character may have earned a new spell
 * level. w = level (+0x20) for Cleric/Sorcerer, level - 5 for the other classes, then
 * w = w/2 (arithmetic shift, only when > 0). Nothing happens unless 1 <= w <= 10 and w is
 * above the character's current spell level (+0x23). Paladin/Archer cap w at 7.
 * On success: +0x23 and +0x72 = w; the first four spells of tier w (clerical table
 * A4-25762 for Paladin/Cleric, sorcerous A4-25794 for Archer/Sorcerer, 4 entries per
 * tier, 0x80 = none, > 0x2F -> -0x30) are OR-ed into the spell book at +0x51;
 * SP max = SP current = (bonus(INT for Archer/Sorcerer else PERSONALITY) + 3) * w
 * (a stat bonus byte >= 0xF2, i.e. negative, counts as 0). Returns 1, else 0.
 */
export function learnSpellLevel(m: Mem, slot: number, opts: { halfOnly?: boolean } = {}): number {
  const ch = charPtr(m, slot);
  const cur = m.r8(ch + 35);
  let w = m.r8(ch + 32);
  const cls = m.r8(ch + 15);
  if (cls !== 3 && cls !== 4) w -= 6;
  w += 1;
  if (w > 0) w >>= 1;
  if (w < 1 || w > 10) return 0;
  if (!(w > cur)) return 0;
  if ((cls === 2 || cls === 1) && w > 7) w = 7;
  m.w8(ch + 114, w & 0xff);
  m.w8(ch + 35, w & 0xff);
  const tbl = cls === 3 || cls === 1 ? -25762 : -25794;
  for (let k = 0; k < 4; k++) {
    let t = m.r8(g(tbl) + (w - 1) * 4 + k);
    if (t === 0x80) continue;
    if (t > 0x2f) t -= 0x30;
    const a = ch + (t >> 3);
    m.w8(a + 81, m.r8(a + 81) | m.r8(g(-25802) + (t & 7)));
  }
  let b = statBonus(m, m.r8(ch + (cls === 2 || cls === 4 ? 17 : 18)));
  if (b >= 0xf2) b = 0;
  const sp = (opts.halfOnly ? b : (b + 3) * w) & 0xffff;
  m.w16(ch + 88, sp);
  m.w16(ch + 90, sp);
  return 1;
}

/* ------------------------------------------------ end-of-battle XP award */

/**
 * CODE+0x12430 (the non-UI part): the encounter's XP pool (A4-28614, summed by killReward)
 * is divided by the number of party members whose condition byte (+0x26) is < 0x80, and
 * each of those gets the share added to the u32 at +0x62. Treasure (CODE+0x123B0) is
 * triggered when a treasure tier was recorded (A4-24105 or A4-24104 non-zero). Also sets
 * A4-30653 = 1 and A4-31052 = 0. Reported call: `treasure` (when it ran).
 */
export function xpAward(m: Mem, opts: { allMembers?: boolean } = {}): { treasure: boolean } {
  m.w8(g(-30653), 1);
  m.w8(g(-31052), 0);
  const treasure = m.r8(g(-24105)) !== 0 || m.r8(g(-24104)) !== 0;
  const size = s16(m.r16(g(PARTY.size)));
  let living = 0;
  for (let i = 0; i < size; i++) if (m.r8(charPtr(m, i) + 38) < 0x80 || opts.allMembers) living++;
  m.w32(g(-28614), Math.floor(m.r32(g(-28614)) / living));
  for (let i = 0; i < size; i++) {
    const ch = charPtr(m, i);
    if (m.r8(ch + 38) >= 0x80) continue;
    m.w32(ch + 98, m.r32(ch + 98) + m.r32(g(-28614)));
  }
  return { treasure };
}

/* ------------------------------------------------ training (level gain) */

/** CODE+0x04552 saturating byte add: *p = min(255, *p + n) */
export function satAdd8(m: Mem, p: number, n: number): void {
  const lim = (0xff - n) & 0xff;
  if (m.r8(p) > lim) m.w8(p, 0xff);
  else m.w8(p, (m.r8(p) + n) & 0xff);
}

/**
 * CODE+0x20232 train(slot, cost): the level-up of a Hall of Training (hall index in A4-31218).
 *  - a character with any condition bit (+0x26 != 0) is refused;
 *  - cost > gold (+0x66): refused; cost == 0: gold += gold/2 (cap 50000), no payment;
 *  - otherwise gold -= cost. Then +0x20 and +0x71 gain a level (saturating), Robber/Ninja
 *    (class 5, 6) with a non-zero +0x1E gain one there too;
 *  - HP gain = classDie[class] * hallMul[hall] / hallDiv[hall] (tables A4-25818/-25838/-25828),
 *    +1 when there is a remainder (not for Cleric/Robber/Ninja), + endurance bonus
 *    (stat_bonus(+0x27), negative counts as 0), added to +0x5E (HP), +0x60 and +0x74 (HP max);
 *  - Paladin/Archer/Cleric/Sorcerer then run learn_spell_level().
 */
export function train(m: Mem, slot: number, cost: number, opts: { noRoundUp?: boolean } = {}): void {
  const ch = charPtr(m, slot);
  const gold = m.r32(ch + 102);
  const affordable = gold >= cost;
  if (m.r8(ch + 38) !== 0) return;
  if (cost === 0) {
    m.w32(ch + 102, (gold + Math.floor(gold / 2)) >>> 0);
    if (m.r32(ch + 102) > 0xc350) m.w32(ch + 102, 0xc350);
  } else if (!affordable) return;
  if (cost !== 0) m.w32(ch + 102, (m.r32(ch + 102) - cost) >>> 0);
  satAdd8(m, ch + 32, 1);
  satAdd8(m, ch + 113, 1);
  const cls = m.r8(ch + 15);
  if ((cls === 6 || cls === 5) && m.r8(ch + 30) !== 0) satAdd8(m, ch + 30, 1);
  const hall = m.r8(g(-31218));
  const t = Math.imul(m.r16(g(-25818) + 2 * cls), m.r16(g(-25838) + 2 * hall)) & 0xffff;
  const div = m.r16(g(-25828) + 2 * hall);
  let rem = t % div;
  let q = Math.floor(t / div) & 0xffff;
  if (cls === 3 || cls === 6 || cls === 5) rem = 0;
  if (rem !== 0 && !opts.noRoundUp) q = (q + 1) & 0xffff;
  let b = statBonus(m, m.r8(ch + 39));
  if (b >= 0xf0) b = 0;
  q = (q + b) & 0xffff;
  for (const f of [96, 116, 94]) m.w16(ch + f, m.r16(ch + f) + q);
  if (cls === 3 || cls === 4 || cls === 2 || cls === 1) learnSpellLevel(m, slot);
}

/* ------------------------------------------------------------------ rest */

/**
 * CODE+0x19B28 the party's rest (the non-UI part). Every member with condition < 0x80:
 *  - condition &= 0x0D (clears all but bits 0, 2, 3); age (+0x21) >= 0x50 and rand(1,100) < 50 -> dies of old age (0x81)
 *  - HP (+0x5E) 0 -> 1; HP max (+0x74) = HP base (+0x60), or half of the current +0x74 when condition bit 3
 *  - a member with food (+0x25): food -1; unless condition bit 2, HP = HP max; a member with a spell level
 *    (+0x23) gets SP (+0x5A) = (bonus(INT for Sorcerer/Archer else PERSONALITY) + 3) * level (+0x20);
 *    then stats are synced (CODE+0x4476), +0x73 = +0x27, +0x70 = +0x15, SP max (+0x58) = SP
 * Afterwards, unless A4-31158 == 9, a rand(1,60) < 10 roll sets A4-31158 = 9 (an interrupted rest /
 * encounter) and flags A4-31058 / A4-31204. Reported call: `redraw [0,255,255]` for that case.
 */
export function rest(m: Mem, opts: { noFoodGate?: boolean } = {}): { calls: [string, number[]][] } {
  for (const d of [-31142, -31143, -31144, -31145, -31146, -31147, -31135, -31136, -31141, -31137, -31138, -31139, -31140]) m.w8(g(d), 0);
  const calls: [string, number[]][] = [];
  const size = s16(m.r16(g(PARTY.size)));
  for (let i = 0; i < size; i++) {
    const ch = charPtr(m, i);
    if (m.r8(ch + 38) >= 0x80) continue;
    m.w8(ch + 38, m.r8(ch + 38) & 0x0d);
    if (m.r8(ch + 33) >= 0x50 && s16(randRange(m, 1, 100)) < 0x32) m.w8(ch + 38, 0x81);
    if (m.r16(ch + 94) === 0) m.w16(ch + 94, 1);
    if (m.r8(ch + 38) & 8) m.w16(ch + 116, m.r16(ch + 116) >> 1);
    else m.w16(ch + 116, m.r16(ch + 96));
    if (m.r8(ch + 37) === 0 && !opts.noFoodGate) continue;
    m.w8(ch + 37, (m.r8(ch + 37) - 1) & 0xff);
    if (!(m.r8(ch + 38) & 4)) m.w16(ch + 94, m.r16(ch + 116));
    if (m.r8(ch + 35) !== 0) {
      const cls = m.r8(ch + 15);
      let b = statBonus(m, m.r8(ch + (cls === 4 || cls === 2 ? 17 : 18)));
      if (b >= 0xf2) b = 0;
      m.w16(ch + 90, ((b + 3) * m.r8(ch + 32)) & 0xffff);
    }
    syncStats(m, ch);
    m.w8(ch + 115, m.r8(ch + 39));
    m.w8(ch + 112, m.r8(ch + 21));
    m.w16(ch + 88, m.r16(ch + 90));
  }
  if (s16(m.r16(g(-31158))) !== 9 && s16(randRange(m, 1, 60)) < 10) {
    m.w16(g(-31158), 9);
    calls.push(['redraw', [0, 255, 255]]);
    m.w8(g(-31058), 1);
    m.w8(g(-31204), 1);
  }
  return { calls };
}
