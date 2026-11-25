/**
 * Might & Magic II (Amiga) game rules, pass 5: the undead engine (Turn Undead, Holy Word) and the remaining leaves.
 * Ported from the root hunk's 68000 code and diffed against the retail executable under Unicorn (tools/mm2/rules_oracle/rules6.py);
 * see docs/mm2/amiga/game-rules.md section 15. Conventions as in rules.ts.
 */
import { type Mem, g } from './rules-mem.ts';
import { charPtr, randRange, unpackMonster } from './rules.ts';
import { confirmAll } from './rules4.ts';
import { monsterDies } from './rules3.ts';

/**
 * CODE+0xC028 `undead_engine(limit)`: the engine of combat spells 54 (Turn Undead, 0xBFEE) and 93 (Holy Word, 0xC72A).
 * Gate: the cast-on-everything confirm (CODE+0xD390: antimagic square refuses), then a once-per-fight flag A4-1311 (a second cast only shows the
 * fizzle text). Walks the battle slots (the count A4-30654, capped at 10 when `limit != 0`), unpacks each (CODE+0x4C8E) and, for an undead
 * (A4-4525 != 0), rolls `rand(1, limit)` (byte; no roll = 0xFF when `limit` is 0): a roll `>=` the slot's record index (u8 A4-4574[slot]) kills it
 * through the real monster_dies (A4-1310 = 1 around it, slot in A4-1309), after which the slot is revisited because the table compacts.
 * The cast is a failure message when nothing died. A4-1312 is cleared on every exit.
 * Turn Undead's limit is the caster level (+0x71) times 16 while the level is below 16 (byte), else the level itself (so a level-0 caster
 * passes 0 = Holy Word's unconditional rule); Holy Word sets A4-1312 = 1 first and passes 0.
 */
export function undeadEngine(m: Mem, limit: number, o: { noRoll?: boolean; noRevisit?: boolean; noCap?: boolean } = {}): void {
  limit &= 0xff;
  if (confirmAll(m) !== 0) {
    if (m.r8(g(-1311)) === 0) {
      m.w8(g(-1311), 1);
      let count = m.r8(g(-30654));
      if (limit !== 0 && count > 10 && !o.noCap) count = 10;
      let slot = 0;
      let killed = 0;
      for (;;) {
        unpackMonster(m, slot);
        if (m.r8(g(-4525)) !== 0) {
          let roll = 0xff;
          if (limit !== 0 && !o.noRoll) roll = randRange(m, 1, limit) & 0xff;
          const idx = m.r8(g(-4574) + slot);
          if (!(roll < idx)) {
            killed++;
            m.w8(g(-1310), 1);
            m.w8(g(-1309), slot);
            monsterDies(m);
            m.w8(g(-1310), 0);
            if (!o.noRevisit) slot = (slot - 1) & 0xff;
          }
        }
        slot = (slot + 1) & 0xff;
        if (slot === 11) count = 1;
        count = (count - 1) & 0xff;
        if (count === 0) break;
      }
      void killed; // killed == 0 only selects the fizzle text (UI)
    }
  }
  m.w8(g(-1312), 0);
}

/** Spells 54 and 93 (handlers 0xBFEE / 0xC72A) in front of the engine. */
export function castUndead(m: Mem, spell: number, o: { noRoll?: boolean; noRevisit?: boolean; noCap?: boolean; flat?: boolean } = {}): void {
  if (spell === 54) {
    let a = m.r8(m.r32(g(-18380)) + 0x71);
    if (a < 0x10) a = (a * 16) & 0xff;
    undeadEngine(m, o.flat ? 0 : a, o);
  } else if (spell === 93) {
    m.w8(g(-1312), 1);
    undeadEngine(m, 0, o);
  } else throw new Error('spell ' + spell + ' is not an undead spell');
}

/* ------------------------------------------------ party pool payments and sharing (gold, gems, food) */

const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
/** CODE+0x477E: party slot (signed word) to the roster record. */
const cp = (m: Mem, slot: number) => charPtr(m, s16(slot));
/** Roster index below 24 = a real character (24..47 are hirelings, who keep and pay nothing). */
const real = (m: Mem, i: number) => s16(m.r16(g(-31082) + 2 * i)) < 0x18;
const count = (m: Mem) => m.r16(g(-31066));

/**
 * CODE+0x7BBE share_gold(who): every real member (roster index < 24) gets an equal share of the real members' total gold (+0x66 long) and the
 * remainder goes to `who`; returns 0 and changes nothing when `who` itself is a hireling. With fewer than two real members nothing moves.
 */
export function shareGold(m: Mem, who: number, o: { noRemainder?: boolean } = {}): number {
  const ok = s16(m.r16(g(-31082) + 2 * s16(who))) < 0x18 ? 1 : 0;
  if (!ok) return 0;
  let sum = 0;
  const list: number[] = [];
  for (let i = 0; s16(i) < s16(count(m)); i++) {
    if (real(m, i)) {
      sum = (sum + m.r32(cp(m, i) + 0x66)) >>> 0;
      list.push(i);
    }
  }
  if (list.length > 1) {
    const q = Math.floor(sum / list.length) >>> 0;
    for (const i of list) {
      m.w32(cp(m, i) + 0x66, q);
      sum = (sum - q) >>> 0;
    }
    if (!o.noRemainder) m.w32(cp(m, who) + 0x66, (m.r32(cp(m, who) + 0x66) + sum) >>> 0);
  }
  return 1;
}

/** CODE+0x7CB0 share_gems(who): ALL party members (hirelings too) get the average of their gems (+0x5C word); the remainder (low word) is added to `who`. Returns 1. */
export function shareGems(m: Mem, who: number): number {
  let sum = 0;
  const n = count(m);
  for (let i = 0; i < n; i++) sum = (sum + m.r16(cp(m, i) + 0x5c)) >>> 0;
  const q = Math.floor(sum / s16(n)) & 0xffff;
  for (let i = 0; i < n; i++) {
    m.w16(cp(m, i) + 0x5c, q);
    sum = (sum - q) >>> 0;
  }
  m.w16(cp(m, who) + 0x5c, m.r16(cp(m, who) + 0x5c) + (sum & 0xffff));
  return 1;
}

/** CODE+0x7D3E share_food(who): all members get the average food (+0x25 byte, the sum is 16 bits); the remainder (low byte) goes to `who`. Returns 1. */
export function shareFood(m: Mem, who: number): number {
  let sum = 0;
  const n = count(m);
  for (let i = 0; i < n; i++) sum = (sum + m.r8(cp(m, i) + 0x25)) & 0xffff;
  const q = Math.floor(sum / n) & 0xff;
  for (let i = 0; i < n; i++) {
    m.w8(cp(m, i) + 0x25, q);
    sum = (sum - q) & 0xffff;
  }
  m.w8(cp(m, who) + 0x25, m.r8(cp(m, who) + 0x25) + (sum & 0xff));
  return 1;
}

type Pool = { off: number; bytes: 1 | 2 | 4; share: (m: Mem, who: number) => number };
const POOL: Record<'gold' | 'gems' | 'food', Pool> = {
  gold: { off: 0x66, bytes: 4, share: shareGold },
  gems: { off: 0x5c, bytes: 2, share: shareGems },
  food: { off: 0x25, bytes: 1, share: shareFood },
};

/**
 * CODE+0x6ACE / 0x6B9A / 0x6C66 pay_gold / pay_gems / pay_food(amount) out of the real members' pool: the sum of their gold (long) / gems (word) / food (byte) must be
 * `>= amount` (unsigned, in the pool's own width); the rest is stored on the FIRST real member (the others drop to 0) and then shared out again with the
 * matching share routine (gems and food share among everybody, hirelings included). A4-31057 = 1 on success, which is also the return value (else 0 and nothing changes).
 * With no real member the 'first' index stays 0xFFFF and the share routine runs on slot -1 (reads the table word before A4-31082).
 */
export function payPool(m: Mem, kind: 'gold' | 'gems' | 'food', amount: number, o: { noFirst?: boolean } = {}): number {
  const P = POOL[kind];
  const wrap = (v: number) => (P.bytes === 4 ? v >>> 0 : v & ((1 << (8 * P.bytes)) - 1));
  const rd = (a: number) => (P.bytes === 4 ? m.r32(a) : P.bytes === 2 ? m.r16(a) : m.r8(a));
  const wr = (a: number, v: number) => (P.bytes === 4 ? m.w32(a, v) : P.bytes === 2 ? m.w16(a, v) : m.w8(a, v));
  m.w8(g(-31057), 0);
  let first = 0xffff;
  let sum = 0;
  for (let i = 0; s16(i) < s16(count(m)); i++) if (real(m, i)) sum = wrap(sum + rd(cp(m, i) + P.off));
  amount = wrap(amount);
  if (!(sum < amount)) {
    sum = wrap(sum - amount);
    m.w8(g(-31057), 1);
    for (let i = 0; s16(i) < s16(count(m)); i++) {
      if (real(m, i)) {
        if (first === 0xffff) first = i;
        wr(cp(m, i) + P.off, sum);
        sum = 0;
      }
    }
    if (!o.noFirst) P.share(m, first);
  }
  return m.r8(g(-31057)) !== 0 ? 1 : 0;
}
