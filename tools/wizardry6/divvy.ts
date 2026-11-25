/**
 * Wizardry 6 (Amiga) victory loot hand-out, ported from the game's 68k code and diffed against it under Unicorn (oracle/combat6.py ->
 * oracle/{give,listdel,chest1da4}-vectors.json, __tests__/divvy.test.ts). Original TypeScript derived from the disassembly only.
 *
 * The loot screen `LAB_1D2D` itself only draws the found-item list and reads the cursor (window calls, `LAB_1B89` input); its rules are
 * the three routines it calls: `giveItem` (LAB_1D12), `removeListEntry` (LAB_1D2A) and the exit test (the party may not leave while an item
 * whose list flag `-3100(A4)[i]` is 1 is still unclaimed: message 0x13f5).
 * The found-item list: ids `-5446(A4)` (words), quantities `-8674`, values `-3112`, kinds `-8464`, flags `-3100`, names `-9758` (18 bytes each,
 * presentation), count `-3114`.
 */
import { s16, type Effect } from './combat.ts';
import type { LootItem } from './endcombat.ts';
import type { Ctx } from './planner.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** LAB_1D10(slot, member): weight of one slot: the slot's word +2 times its count (byte +6, at least 1) when the item kind (+4) is stackable (table -31716), else times 1. */
export function slotWeight(c: Ctx, slot: number, who: number): number {
  const { m, a4 } = c;
  const S = a4 - 17922 + s16(who) * 0x1b0 + 64 + 8 * s16(slot);
  let n = 1;
  if (m.u8(a4 - 31716 + m.u8(S + 4)) === 1) {
    n = m.u8(S + 6);
    if (n < 1) n = 1;
  }
  return (s16(m.u16(S + 2)) * n) | 0;
}

/**
 * LAB_1D12(who, listIndex): give the found item to member `who`. The item record (ReadSection 1) supplies kind (+60), +61, +30 (word), flag bits (+59) and the quantity
 * dice (+20..+23) for kinds that are not stackable-by-list. The first area (slots 0..9, count +428) is searched from the end for a slot of the same id and a
 * stackable kind with count + quantity <= 250; none: a new slot there while it has fewer than 10, else the same search and a new slot in the second area (slots
 * 10..21, count +429); 22 or more: refuse with -1. A new slot is zeroed first. Then the member's carried weight +32 is rebuilt.
 */
export function giveItem(c: Ctx, who: number, listIndex: number, item: (id: number) => LootItem): number {
  const { m, rng, a4 } = c;
  const P = a4 - 17922 + s16(who) * 0x1b0;
  const id = m.u16(a4 - 5446 + 2 * s16(listIndex));
  const it = item(id);
  let qty: number;
  if (m.u8(a4 - 31716 + it.b60) === 1) {
    qty = m.u8(a4 - 8674 + 2 * s16(listIndex) + 1);
  } else {
    let t = it.w20, n = it.b22;
    while (n > 0) { t = (t + rng.random(it.b23) + 1) & 0xffff; n--; }
    qty = t & 0xff;
  }
  const slot = (k: number): number => P + 64 + 8 * k;
  const fits = (k: number): boolean =>
    m.u16(slot(k)) === id && m.u8(a4 - 31716 + m.u8(slot(k) + 4)) === 1 && m.u8(slot(k) + 6) + qty <= 250;
  let mode = 1;
  let best = m.u8(P + 428);
  for (let k = m.u8(P + 428) - 1; k >= 0; k--) if (fits(k)) { best = k; mode = 0; }
  if (best >= 10) {
    mode = 2;
    best = m.u8(P + 429) + 10;
    for (let k = m.u8(P + 429) - 1; k >= 0; k--) if (fits(k + 10)) { best = k + 10; mode = 0; }
    if (best >= 0x16) return -1;
  }
  const S = slot(best);
  if (mode > 0) {
    m.w8(S + 6, 0);
    if (mode === 1) m.w8(P + 428, m.u8(P + 428) + 1); else m.w8(P + 429, m.u8(P + 429) + 1);
  }
  m.w16(S, id);
  m.w8(S + 4, it.b60);
  m.w8(S + 5, it.b61);
  m.w16(S + 2, it.w30);
  m.w8(S + 6, m.u8(S + 6) + qty);
  let fl = 0;
  if (it.b59 & 8) fl |= 4;
  if (it.b59 & 4) fl |= 8;
  if (it.b59 & 16) fl |= 16;
  if (it.b59 & 32) fl |= 32;
  if (it.b59 & 2) fl |= 64;
  m.w8(S + 7, fl);
  m.w16(P + 32, 0);
  for (let k = 0; k < m.u8(P + 428); k++) m.w16(P + 32, m.u16(P + 32) + slotWeight(c, k, who));
  for (let k = 0; k < m.u8(P + 429); k++) m.w16(P + 32, m.u16(P + 32) + slotWeight(c, k + 10, who));
  return 0;
}

/** LAB_1D2A(i): drop entry i of the found-item list and shift the later ones up (ids, quantities, values, kinds, flags; the names are text). */
export function removeListEntry(c: Ctx, i: number): void {
  const { m, a4 } = c;
  m.w16(a4 - 3114, m.u16(a4 - 3114) - 1);
  for (let k = s16(i); k < s16(m.u16(a4 - 3114)); k++) {
    for (const base of [-5446, -8674, -3112, -8464, -3100]) m.w16(a4 + base + 2 * k, m.u16(a4 + base + 2 * (k + 1)));
  }
}

/** True when the party may not leave the loot screen: some unclaimed list entry carries the must-take flag (-3100(A4)[i] == 1). */
export function lootBlocksExit(c: Ctx): boolean {
  const { m, a4 } = c;
  for (let k = 0; k < s16(m.u16(a4 - 3114)); k++) if (m.u16(a4 - 3100 + 2 * k) === 1) return true;
  return false;
}

/** LAB_1DA4 (CODE+0x4f...): the chest variant of the treasure step; with a treasure id pending (-15296 not -1) the state becomes 0x15 and the roll LAB_1D76 runs; the entity cursor then advances. */
export function chestTreasureStep(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  m.w16(a4 - 3128, 0xffff);
  m.w16(a4 - 7872, 2);
  m.w16(a4 - 3116, 1);
  fx.push(['jt-32676', hex16(0x13ec)], ['jt-32736', hex32(m.u32(a4 - 18490)) + '0000']);   // the "found a chest" banner
  m.w16(a4 - 11722, 0);
  if (s16(m.u16(a4 - 15296)) !== -1) { m.w16(a4 - 18608, 0x15); fx.push(['LAB_1D76', '']); }
  m.w16(a4 - 18148, m.u16(a4 - 18148) + 1);
}
