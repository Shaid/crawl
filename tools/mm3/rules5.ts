/**
 * Might & Magic III (Amiga) rules ports, pass 5: character creation (overlay 6). docs/mm3/amiga/game-rules.md section 19.
 * Method as rules.ts: strict sparse memory seeded only with the bytes the real routine read under Unicorn
 * (tools/mm3/rules_oracle/rules5.py). `OVn+` = overlay n.
 */
import { type Mem, g } from './rules-mem.ts';
import { type Call, CHAR0, CHAR_SIZE, charLevel, maxHp, maxSp, randRange, YEAR } from './rules.ts';
import { itemPrice, itemPriceText, thievery } from './rules4.ts';
import { pay } from './rules2.ts';

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

/** Class numbers of the creation screen (OV6 strings 0x8D5..0x97B, `%2dKnight` ...): record byte +0x13. */
export const CLASS_NAMES = ['Knight', 'Paladin', 'Archer', 'Cleric', 'Sorcerer', 'Robber', 'Ninja', 'Barbarian', 'Druid', 'Ranger'] as const;
/** Attribute order of the creation buffer / record +0x14, +0x16, ... +0x20 (stride 2: current, then the temporary byte). */
export const STAT_NAMES = ['Might', 'Intellect', 'Personality', 'Endurance', 'Speed', 'Accuracy', 'Luck'] as const;
/** OV6+0x48C minimum attributes per class (signed byte compares, `>=`): [stat index, minimum] pairs, all of them required. */
export const CLASS_MIN: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 15]],                              // Knight
  [[0, 13], [2, 13], [3, 13]],            // Paladin
  [[1, 13], [5, 13]],                     // Archer
  [[2, 13]],                              // Cleric
  [[1, 13]],                              // Sorcerer
  [[6, 13]],                              // Robber
  [[4, 13], [5, 13]],                     // Ninja
  [[3, 15]],                              // Barbarian
  [[1, 15], [2, 15]],                     // Druid
  [[1, 12], [2, 12], [3, 12], [4, 12]],   // Ranger
];
/** OV6+0x48C(stats[7], out[10]): out[k] = 1 when every minimum of class k holds, else 0. */
export function classRequirements(m: Mem, stats: number, out: number, opts: { unsigned?: boolean } = {}): void {
  for (let k = 0; k < 10; k++) {
    let ok = true;
    for (const [i, min] of CLASS_MIN[k]!) {
      const v = opts.unsigned ? m.r8(stats + i) : s8(m.r8(stats + i));
      if (v < min) { ok = false; break; }
    }
    m.w8(out + k, ok ? 1 : 0);
  }
}
/**
 * OV6+0x5FE(stats[7], out[10]) the "Roll" button: clears the seven attributes, then three passes over the seven, each adding
 * `rand(10, 0x4F) / 10` (so 1..7, 8 is reachable through the `hi+1` overshoot); finally computes the class flags (0x48C).
 * Attribute total therefore 3 * (1..7) = 3..21 (24 with the overshoot) per attribute; no race, sex or class adjustment exists anywhere in the roll.
 */
export function rollStats(m: Mem, stats: number, out: number, opts: { passes?: number; divisor?: number } = {}): void {
  for (let i = 0; i < 7; i++) m.w8(stats + i, 0);
  for (let p = 0; p < (opts.passes ?? 3); p++) {
    for (let i = 0; i < 7; i++) {
      const r = randRange(m, 10, 0x4f) & 0xff;
      m.w8(stats + i, m.r8(stats + i) + Math.trunc(r / (opts.divisor ?? 10)));
    }
  }
  classRequirements(m, stats, out);
}

/** per-race 6-byte resistance block of the record: +0x111, +0x107, +0x10B, +0x109, +0x10F, +0x10D from A4-0x260C, -0x2607, -0x2602, -0x25FD, -0x25F8, -0x25F3 [race] */
export const RACE_RES: ReadonlyArray<readonly [number, number]> = [[0x111, -0x260c], [0x107, -0x2607], [0x10b, -0x2602], [0x109, -0x25fd], [0x10f, -0x25f8], [0x10d, -0x25f3]];
export interface BuildOpts { noClassSkill?: boolean; noMaxes?: boolean; noRaceRes?: boolean }
/** scripted input of the harness: the name returned by the name prompt R+0xB5CE */
export interface BuildIo { name: number[] }
/**
 * OV6+0x1A0(class, race, align, sex, stats*, record*) builds a level 1 character from the roll. Class or alignment 0xFF (not chosen) shows
 * "Select a Class and Alignment before saving." and returns 0; an empty name (prompt max 10 chars) returns 0. Otherwise the 0x130-byte record is
 * zeroed, then: name, `+0x124` = u8 A4-0x1661, sex `+0x10`, race `+0x11`, alignment `+0x12`, class `+0x13`, attributes `+0x14,16..20` from the roll,
 * level `+0x23` = 1, the six race resistances, birth year `+0x12A` = year - 18, `+0x25` = u8 A4-0x1327, the class's spell flags (`+0x7A`, `+0x7B`,
 * `+0x53..+0x56`), the class / race skill bytes `+0x27+A4-0x3AF5[class]`, `+0x27+A4-0x3AEB[race]`, `+0x53+A4-0x3AE6[class]`, then max HP `+0x126` and max SP `+0x128`.
 */
export function buildCharacter(m: Mem, io: BuildIo, cls: number, race: number, align: number, sex: number, stats: number, rec: number, opts: BuildOpts = {}): { ret: number; calls: Call[] } {
  const calls: Call[] = [];
  if (cls === 0xff || align === 0xff) return { ret: 0, calls };
  calls.push(['name', [10, 0xc8]]);
  const len = io.name.length;
  if (len === 0) return { ret: 0, calls };
  for (let i = 0; i < 0x130; i++) m.w8(rec + i, 0);
  for (let i = 0; i < len; i++) m.w8(rec + i, io.name[i]!);
  m.w16(rec + 0x124, m.r8(g(-0x1661)));
  m.w8(rec + 0x10, sex); m.w8(rec + 0x11, race); m.w8(rec + 0x13, cls); m.w8(rec + 0x12, align);
  for (let i = 0; i < 7; i++) m.w8(rec + 0x14 + 2 * i, m.r8(stats + i));
  m.w8(rec + 0x23, 1);
  if (!opts.noRaceRes) for (const [off, d] of RACE_RES) m.w8(rec + off, m.r8(g(d) + race));
  m.w16(rec + 0x12a, (m.r16(g(YEAR)) - 0x12) & 0xffff);
  m.w8(rec + 0x25, m.r8(g(-0x1327)));
  // class spell flags (jump table at OV6+0x38A over 0..9; anything else = no spells)
  const SPELL: Record<number, number> = { 3: 2, 4: 2, 8: 2, 1: 1, 2: 1, 9: 1 };
  const kind = cls < 10 ? (SPELL[cls] ?? 0) : 0;
  if (kind === 2) { m.w8(rec + 0x7a, 1); for (let k = 0; k < 4; k++) m.w8(rec + 0x53 + k, 1); m.w8(rec + 0x7b, 0); }
  else if (kind === 1) { m.w8(rec + 0x53, 1); m.w8(rec + 0x7a, 1); m.w8(rec + 0x7b, 0); }
  else m.w8(rec + 0x7b, 0xff);
  if (!opts.noClassSkill) {
    const a = m.r8(g(-0x3af5) + cls); if (a !== 0xff) m.w8(rec + 0x27 + a, 1);
    const b = m.r8(g(-0x3aeb) + race); if (b !== 0xff) m.w8(rec + 0x27 + b, 1);
    const c = m.r8(g(-0x3ae6) + cls); if (c !== 0xff) m.w8(rec + 0x53 + c, 1);
  }
  if (!opts.noMaxes) { m.w16(rec + 0x126, maxHp(m, rec)); m.w16(rec + 0x128, maxSp(m, rec)); }
  return { ret: 1, calls };
}

// ---------------------------------------------------------------- map event: locked chest / trap gate + reward actions OV4+0xE16E
const BUF_1280 = 0x1000000 - 0x1280;
const OV4_PTR = (off: number) => 0x2000000 + 4 * 0x100000 + off;
/** OV4+0xE16E lock kinds (word at A4-0x1046 + 12*object): kind -> party cue / trap sound; kind 0x14 is gated (no pick attempt), other kinds are not locks */
export const LOCK_CUE: Record<number, number> = { 0x04: 0x14, 0x0c: 0x2a, 0x12: 0x2a, 0x14: 0x14, 0x17: 0x14, 0x21: 0x2b, 0x26: 0x14, 0x28: 0x2b };
/** scripted inputs of the harness: the member picker OV4+0xC222 (0xFFFF = cancelled) and the script executor OV4+0xCB20 results */
export interface EventIo { picks: number[]; cb: number[] }
export interface EventOpts { noTrap?: boolean; noXp?: boolean; flatCap?: boolean }
/**
 * OV4+0xE16E(code0, param0, code1, param1, code2, param2, extra): the map-event executor for chests and gated objects.
 * Lock gate: when object index `A4-0x1044` is non-zero and the "attempted" byte `A4+0x70E2` is 0, the object's kind decides (LOCK_CUE; other kinds skip the gate):
 * the attempt counter `+0x70E2` is incremented, the object's word at A4-0x1048+12*i is set to 1 and (kind != 0x14) a party member is picked
 * (cancel -> `+0x70E2 = 0xFF`, return 1). 1 in 4 (`rand(1,4)`) springs the trap `OV4+0xED8E(map byte +0x31E, rand(0,6), member)`.
 * The pick succeeds when `thievery(member) + rand(1,20) >= map byte +0x312`: the member gains `10 * level * difficulty` XP (u32 `+0x12C`),
 * mode `A4-0x104A` = 7, "%s picks the lock!"; otherwise "%s was unable to pick the lock!", `+0x70E2 = 0xFF`, return 1.
 * Then the three actions run: 0x15 appends an item id to the reward list (`+0x709B` count, max 10; parallel arrays `+0x70A4/AE/B8/C2/CC/D6`),
 * 0x22 adds param to the reward gold u32 `+0x70A0`, 0x23 to the gems u32 `+0x709C`, 0x42 generates an item `R+0xB83A(param, A4-0x2F8, 0)` and appends it,
 * 0x43 and every other code run the event script `OV4+0xCB20`; a non-zero result returns 1, and after a 0x43 action a zero result returns 0.
 */
export function eventActions(m: Mem, io: EventIo, acts: ReadonlyArray<readonly [number, number]>, extra: number, opts: EventOpts = {}): { ret: number; calls: Call[] } {
  const calls: Call[] = [];
  const idx = m.r8(g(-0x1044));
  if (idx !== 0 && m.r8(g(0x70e2)) === 0) {
    const kind = m.r16(g(-0x1046) + 12 * idx);
    const cue = LOCK_CUE[kind];
    if (cue !== undefined) {
      m.w8(g(0x70e2), m.r8(g(0x70e2)) + 1);
      m.w16(g(-0x1048) + 12 * idx, 1);
      if (kind !== 0x14) {
        calls.push(['pick', []]);
        const d6 = io.picks.length ? io.picks.shift()! : 0;
        if (d6 === 0xffff) { m.w8(g(0x70e2), 0xff); return { ret: 1, calls }; }
        const map = s8(m.r8(g(0xdb9)));
        if (randRange(m, 1, 4) === 1) {
          const k = randRange(m, 0, 6);
          calls.push(['trap', [m.r8(g(-0xde) + map * 0x340 + 0x31e), k, d6]]);
        }
        const c = g(CHAR0) + d6 * CHAR_SIZE;
        const diff = m.r8(g(-0xde) + map * 0x340 + 0x312);
        const t = ((opts.noTrap ? 0 : thievery(m, c)) + randRange(m, 1, 20)) | 0;
        if (t < diff) {
          calls.push(['sprintf', [BUF_1280, OV4_PTR(0xe627), 0x1000000 + (c - g(0))]]);
          calls.push(['msg', [BUF_1280]]);
          m.w8(g(0x70e2), 0xff);
          return { ret: 1, calls };
        }
        if (!opts.noXp) m.w32(c + 0x12c, (m.r32(c + 0x12c) + Math.imul(charLevel(m, c), diff) * 10) >>> 0);
        m.w8(g(-0x104a), 7);
        calls.push(['sprintf', [BUF_1280, OV4_PTR(0xe5fe), 0x1000000 + (c - g(0))]]);
        calls.push(['cue', [cue]]);
      }
    }
  }
  const append = () => {
    let n = (m.r8(g(0x709b)) + 1) & 0xff;
    m.w8(g(0x709b), n);
    if (s8(n) > 10) { n = 10; m.w8(g(0x709b), 10); }
    return s8(n);
  };
  /** the game re-reads the count byte before every array write (a corrupted count can make an array write hit the count itself) */
  const cnt = () => s8(m.r8(g(0x709b)));
  let flag = 0;
  for (let d4 = 0; d4 < 3; d4++) {
    const [code, param] = acts[d4]!;
    const sub = (code - 0x15) & 0xffff;
    if (sub === 0) {
      append();
      for (const base of [0x70a4, 0x70b8, 0x70c2, 0x70cc, 0x70d6]) m.w8(g(base) + cnt() - 1, 0);
      m.w8(g(0x70ae) + cnt() - 1, param);
    } else if (sub === 0x0d) m.w32(g(0x70a0), (m.r32(g(0x70a0)) + param) >>> 0);
    else if (sub === 0x0e) m.w32(g(0x709c), (m.r32(g(0x709c)) + param) >>> 0);
    else if (sub === 0x2d) {
      append();
      const a3 = g(-0x2f8);
      calls.push(['itemgen', [param & 0xff, 0x1000000 + (a3 - g(0)), 0]]);
      const buf = g(-0x2f8);
      for (const [base, off] of [[0x70d6, 0x90], [0x70cc, 0xa3], [0x70c2, 0xb6], [0x70b8, 0xc9], [0x70ae, 0xdc], [0x70a4, 0xef]] as const) m.w8(g(base) + cnt() - 1, m.r8(buf + off));
    } else {
      if (sub === 0x2e) flag = 1;
      calls.push(['script', [0, 0, code, param, extra]]);
      if ((io.cb.length ? io.cb.shift()! : 0) !== 0) return { ret: 1, calls };
      if (flag) return { ret: 0, calls };
    }
  }
  return { ret: 0, calls };
}

// ---------------------------------------------------------------- OV7 item command: shop flows (entered mid-function in the harness)
const OV7_PTR = (off: number) => 0x2000000 + 7 * 0x100000 + off;
const B1154 = 0x1000000 - 0x1154, B1A86 = 0x1000000 - 0x1a86;
const cptr5 = (c: number) => 0x1000000 + (c - g(0));
/** the harness logs a pointer-looking argument as an id (code offset / DATA displacement / overlay offset), anything else as is */
function lp(v: number): number {
  if (v >= 0x100000 && v < 0x120000) return v - 0x100000;
  if (v >= 0x200000 && v < 0x210000) return 0x1000000 + (v - g(0));
  for (let sg = 1; sg <= 8; sg++) { const b = 0x300000 + sg * 0x20000; if (v >= b && v < b + 0x20000) return 0x2000000 + sg * 0x100000 + (v - b); }
  return v;
}
export interface ShopIo { yn: number[] }
export interface ShopOpts { noSellFlag?: boolean; noBankPay?: boolean; noCap?: boolean; noBrokenBit?: boolean }
export type ShopOp = 'sell' | 'repair' | 'identify' | 'buy' | 'recharge' | 'discard';
/** the item ids that cannot be discarded: R+0x9CA0 over the 16-byte list A4-0x55CE */
export const necessaryItem = (m: Mem, id: number) => { for (let i = 0; i < 16; i++) if (m.r8(g(-0x55ce) + i) === id) return true; return false; };
/**
 * OV7+0x3FE2 item command, the venue modes entered at OV7+0x4408 (discard), 0x4506 (sell), 0x45C4 (repair), 0x462A (identify), 0x46EA (buy), 0x47F6 (recharge);
 * `c` = character record, `slot` = backpack slot (0..17), `mode` = the price mode (d7), `a5` = the caller's frame (`$C(a5)` = price flags for repair/identify).
 * Item bytes of a slot: `+0x90` flags (bit 6 cursed/sticky, bit 7 broken, 0x3F charges), `+0xA3`, `+0xB6`, `+0xC9`, `+0xDC` id, `+0xEF`.
 * - **sell**: ids < 0x46 and not bit 6 of `+0x90`: price `OV7+0x3CC(mode, 0x80 | (+0x2F == 0))` (the half-price divisor depends on `+0x2F`); "Sell %s for %lu gold?"; yes -> the item is removed (`OV4+0xF08A`), gold `A4-0x1308` += price. Otherwise "We have no need of this %s!".
 * - **repair**: needs bit 7 ("That item is not broken!"); price text `OV7+0x7E0(..., sel 0, flags $C(a5))`; yes and `R+0x8964(0, price, 0)` pays -> bit 7 cleared.
 * - **identify**: same but sel 1; paid -> `OV7+0x4E08` builds the class list text and "Identify Item" shows.
 * - **buy** (into the character at `u32 A4+0x3270`): that character's last slot must be empty (`+0xED` == 0, else "%s's backpack is full."); price mode d7, flags 0; yes and paid -> the six item bytes are copied to the buyer's slot 17 (`+0xA1,+0xB4,+0xC7,+0xDA,+0xED,+0x100`) and removed from the seller.
 * - **recharge** (no price): ids <= 0x47 with a non-zero `+0xEF` byte gain `rand(1,6)` charges (`+0x90 & 0x3F`, capped at 0x3F, bits 6/7 kept); anything else plays cue 0x15 and shows the not-rechargeable text.
 * - **discard**: refused for the necessary-item list (`R+0x9CA0`) and for a bit-6 item ("You cannot discard a cursed item!"); otherwise "Permanently discard %s?" and yes removes it (mode 8 returns 2).
 */
export function shopFlow(m: Mem, io: ShopIo, op: ShopOp, c: number, slot: number, mode: number, a5: number, opts: ShopOpts = {}): { ret: number; calls: Call[] } {
  const calls: Call[] = [];
  const name = () => calls.push(['name', [slot, B1154, 1]]);
  const yes = () => { calls.push(['yesno', [B1A86, 0]]); return (io.yn.length ? io.yn.shift()! : 0) !== 0; };
  const idv = () => m.r8(c + 0xdc + slot);
  const flagsAt = c + 0x90 + slot;
  const remove = () => { calls.push(['remove', [cptr5(c), slot]]); };
  switch (op) {
    case 'sell': {
      if (idv() < 0x46 && !(m.r8(flagsAt) & 0x40)) {
        const flags = 0x80 | (opts.noSellFlag ? 0 : m.r8(c + 0x2f) === 0 ? 1 : 0);
        const price = itemPrice(m, c, slot, mode, flags);
        name();
        calls.push(['sprintf', [B1A86, OV7_PTR(0x4d10), B1154, lp(price)]]);
        if (yes()) { remove(); m.w32(g(-0x1308), (m.r32(g(-0x1308)) + price) >>> 0); calls.push(['refresh', [cptr5(c)]]); }
      } else {
        name();
        calls.push(['sprintf', [B1A86, OV7_PTR(0x4d26), B1154]]);
        calls.push(['msg', [B1A86]]);
      }
      return { ret: 0, calls };
    }
    case 'repair': case 'identify': {
      if (op === 'repair' && !(m.r8(flagsAt) & 0x80) && !opts.noBrokenBit) { calls.push(['msg', [OV7_PTR(0x4d42)]]); return { ret: 0, calls }; }
      const t = itemPriceText(m, c, slot, mode, op === 'repair' ? 0 : 1, m.r16(a5 + 0xc));
      calls.push(...t.calls);
      if (!yes()) return { ret: 0, calls };
      const p = pay(m, 0, t.ret, 0); calls.push(...p.calls);
      if (!p.ok) return { ret: 0, calls };
      if (op === 'repair') m.w8(flagsAt, m.r8(flagsAt) & 0x7f);
      else {
        calls.push(['identify', [slot, cptr5(c)]]);
        name();
        calls.push(['sprintf', [B1A86, OV7_PTR(0x4d5b), B1154, 0x1000000 + 0x21fe]]);
      }
      return { ret: 0, calls };
    }
    case 'buy': {
      if (idv() === 0) return { ret: 0, calls };
      const b = m.r32(g(0x3270));
      if (m.r8(b + 0xed) !== 0) {
        calls.push(['sprintf', [B1154, OV7_PTR(0x4d7c), cptr5(b)]]);
        calls.push(['msg', [B1154]]);
        return { ret: 0, calls };
      }
      const price = itemPrice(m, c, slot, mode, 0);
      name();
      calls.push(['sprintf', [B1A86, OV7_PTR(0x4d95), B1154, lp(price)]]);
      if (!yes()) return { ret: 0, calls };
      const p = pay(m, 0, price, opts.noBankPay ? 1 : 0); calls.push(...p.calls);
      if (!p.ok) return { ret: 0, calls };
      for (const [dst, src] of [[0xa1, 0x90], [0xb4, 0xa3], [0xc7, 0xb6], [0xda, 0xc9], [0xed, 0xdc], [0x100, 0xef]] as const) m.w8(b + dst, m.r8(c + src + slot));
      remove(); calls.push(['refresh', [cptr5(c)]], ['refresh', [cptr5(b)]]);
      return { ret: 0, calls };
    }
    case 'recharge': {
      if (idv() === 0) return { ret: 0, calls };
      if (idv() <= 0x47 && m.r8(c + 0xef + slot) !== 0) {
        const r = randRange(m, 1, 6);
        m.w16(a5 - 0x16, r);
        calls.push(['cue', [0x14]]);
        const v = (m.r8(flagsAt) & 0xbf) + r;
        if (v > 0x3f && !opts.noCap) m.w8(flagsAt, m.r8(flagsAt) | 0x3f); else m.w8(flagsAt, m.r8(flagsAt) + r);
      } else {
        calls.push(['cue', [0x15]]);
        calls.push(['sprintf', [B1154, OV7_PTR(0x4daa), lp(m.r32(g(-0x52a6)))]]);
        calls.push(['msg', [B1154]]);
      }
      return { ret: 0, calls };
    }
    case 'discard': {
      const cursed = (m.r8(flagsAt) & 0x40) !== 0;
      if (!necessaryItem(m, idv()) && !cursed) {
        name();
        calls.push(['sprintf', [B1A86, OV7_PTR(0x4ca7), B1154]]);
        if (yes()) { remove(); calls.push(['refresh', [cptr5(c)]]); if (mode === 8) return { ret: 2, calls }; }
        return { ret: 0, calls };
      }
      if (cursed) { calls.push(['msg', [OV7_PTR(0x4cbf)]]); return { ret: 0, calls }; }
      name();
      calls.push(['sprintf', [B1A86, OV7_PTR(0x4ce3), B1154]]);
      calls.push(['msg', [B1A86]]);
      return { ret: 0, calls };
    }
  }
}
