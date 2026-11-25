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

/* ------------------------------------------------------------------ shop: sell and examine */

/** CODE+0x46F0 remove_item(buyer, slot): pack slots above `slot` move down one (id +0x3A, charges +0x40, flags +0x46), the last slot (5) is cleared. */
function removePackItem(m: Mem, who: number, slot: number): void {
  let s = slot & 0xffff;
  while (s !== 5) {
    const x = s16(s);
    for (const base of [0x3a, 0x40, 0x46]) m.w8(who + x + base, m.r8(who + x + 1 + base));
    s = (s + 1) & 0xffff;
  }
  m.w8(who + 0x3f, 0);
  m.w8(who + 0x45, 0);
  m.w8(who + 0x4b, 0);
}

/**
 * CODE+0x1BC26 sell the buyer's pack slot `slot` (0..5; the shop list of mode 5 mirrors the pack: stock byte A4-23052[slot] = the item id) to the shop:
 * refused with message 8 when the buyer's condition (+0x26) is set, message 6 when the slot is empty; otherwise the price shown in the table A4-23094[slot]
 * (a long, filled by the price routine 0x1BF16 when the list was drawn) is ADDED to the buyer's gold (+0x66, 32-bit wrap), the 'pay 0' routine 0x1BDD6 runs
 * (a no-op on the data), message 0 and the pack closes the gap. Returns the messages shown (CODE+0x1C432).
 */
export function sellItem(m: Mem, slot: number, o: { noRemove?: boolean } = {}): number[] {
  if (m.r8(m.r32(g(-23102)) + 0x26) !== 0) return [8];
  if (m.r8(g(-23052) + s16(slot)) === 0) return [6];
  const price = m.r32(g(-23094) + 4 * s16(slot));
  const who = m.r32(g(-23102));
  m.w32(who + 0x66, (m.r32(who + 0x66) + price) >>> 0);
  m.r32(m.r32(g(-23102)) + 0x66); // pay(0): gold >= 0 always passes; the data is unchanged (gold - 0)
  m.w32(m.r32(g(-23102)) + 0x66, m.r32(m.r32(g(-23102)) + 0x66));
  if (!o.noRemove) removePackItem(m, m.r32(g(-23102)), slot);
  return [0];
}

/**
 * CODE+0x1B6E0 'examine item' of the shop list (the paid identify screen): message 8 when the buyer's condition is set, 6 when the slot is empty,
 * else it pays the price shown in A4-23094[slot] through CODE+0x1BDD6 (message 4 and nothing else when the buyer's gold, +0x66, is below it) and draws the
 * item's details until ESC (UI only, nothing else is written). Returns the messages shown.
 */
export function inspectItem(m: Mem, slot: number, o: { free?: boolean } = {}): number[] {
  if (m.r8(m.r32(g(-23102)) + 0x26) !== 0) return [8];
  if (m.r8(g(-23052) + s16(slot)) === 0) return [6];
  const price = m.r32(g(-23094) + 4 * s16(slot));
  const who = m.r32(g(-23102));
  const gold = m.r32(who + 0x66);
  if (gold < price) return [4];
  if (!o.free) m.w32(who + 0x66, (gold - price) >>> 0);
  return [];
}

/* ------------------------------------------------------------------ monster advance */

type Calls = [string, number[]][];

/**
 * CODE+0x10118 `advance`: the acting monster (slot A4-1271) steps forward. Needs the flag A4-4523 (set by the unpack of the actor); the slots
 * 0 .. A4-1316-1 are scanned in order (the byte count is re-read each pass), the actor's own slot skipped; the first slot whose unpacked record has
 * A4-4523 == 0 takes the actor's six per-slot values (hp u16 A4-1338, status A4-1305, initiative A4-1294 and A4-1283, acted A4-24138, record index A4-4574)
 * while the actor's slot takes that slot's, and A4-1271 follows the actor to the new slot (screen update CODE+0x1061E(slot), the 'advances!' text: UI).
 * When nothing moved (or the actor was not flagged) the reinforcement routine CODE+0x10082 runs instead.
 */
export function monsterAdvance(m: Mem, o: { noSwapBack?: boolean } = {}): Calls {
  const calls: Calls = [];
  let moved = 0;
  if (m.r8(g(-4523)) !== 0) {
    for (let i = 0; i < m.r8(g(-1316)); i++) {
      if (i !== m.r8(g(-1271))) {
        unpackMonster(m, i);
        if (m.r8(g(-4523)) === 0) {
          moved++;
          const cur = m.r8(g(-1271));
          const hp = m.r16(g(-1338) + 2 * i);
          const st = m.r8(g(-1305) + i);
          const i1 = m.r8(g(-1294) + i);
          const i2 = m.r8(g(-1283) + i);
          const ac = m.r8(g(-24138) + i);
          const ty = m.r8(g(-4574) + i);
          m.w16(g(-1338) + 2 * i, m.r16(g(-1338) + 2 * cur));
          m.w8(g(-1305) + i, m.r8(g(-1305) + cur));
          m.w8(g(-1294) + i, m.r8(g(-1294) + cur));
          m.w8(g(-1283) + i, m.r8(g(-1283) + cur));
          m.w8(g(-24138) + i, m.r8(g(-24138) + cur));
          m.w8(g(-4574) + i, m.r8(g(-4574) + cur));
          if (!o.noSwapBack) {
            m.w16(g(-1338) + 2 * cur, hp);
            m.w8(g(-1305) + cur, st);
            m.w8(g(-1294) + cur, i1);
            m.w8(g(-1283) + cur, i2);
            m.w8(g(-24138) + cur, ac);
            m.w8(g(-4574) + cur, ty);
          }
          m.w8(g(-1271), i);
          calls.push(['show', [i]]);
          unpackMonster(m, i);
        }
      }
      if (moved !== 0) break;
    }
  }
  if (moved === 0) calls.push(['help', []]);
  return calls;
}
