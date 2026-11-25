/**
 * Wizardry 6 (Amiga) per-cell entity dispatcher `LAB_06B6` (`Bane` CODE+0xe9be) and the entity-kind handlers ported so far, diffed against
 * the game under Unicorn (oracle/combat6.py -> oracle/{dispatch,...}-vectors.json, __tests__/entities.test.ts). Original TypeScript
 * derived from the disassembly only.
 *
 * The level block at `-18458(A4)` (B) holds 144 entity slots as structure-of-arrays: word `+0` (message / sub-type), `+288` word, `+576` word
 * (packed parameters), kind byte `+864` (0 = empty), x `+1008`, y `+1152`, region `+1296`, per-region start `+1728`, operand byte `+1584`,
 * and the trigger-flag index `+1440`. Kind table (jump table at CODE+0xeafc, base 0xeb40), 25 kinds:
 *   1 teleport LAB_05D4 | 2 message LAB_05BB (only while -10896 is set) | 3 LAB_05DA | 4 scripted encounter LAB_062F | 5 scripted encounter (inline)
 *   6 LAB_0685 | 7 door state LAB_05EA | 8 message: LAB_05B1(word, 0) when word +0 > 0 else LAB_05E0 | 9 LAB_061D | 10 LAB_05F1 | 11 LAB_05F6
 *   12 LAB_0674 | 13 LAB_068C | 16 LAB_062B | 17 LAB_05EF (empty) | 18 LAB_05D9 (empty) | 21 LAB_0643 | 22 LAB_0664 | 23 LAB_066A
 *   24 LAB_0695 | 25 LAB_069B | 14, 15, 19, 20 and 0, >= 26: nothing.
 */
import { s16, type Effect } from './combat.ts';
import { type Ctx, testBit } from './planner.ts';
import { entityKind5, setBit } from './scripted.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

/** Kind -> handler routine name (the names the oracle logs for its stubs). */
export const ENTITY_HANDLERS: Readonly<Record<number, string>> = {
  1: 'LAB_05D4', 2: 'LAB_05BB', 3: 'LAB_05DA', 4: 'LAB_062F', 6: 'LAB_0685', 7: 'LAB_05EA', 9: 'LAB_061D', 10: 'LAB_05F1',
  11: 'LAB_05F6', 12: 'LAB_0674', 13: 'LAB_068C', 16: 'LAB_062B', 17: 'LAB_05EF', 18: 'LAB_05D9', 21: 'LAB_0643', 22: 'LAB_0664',
  23: 'LAB_066A', 24: 'LAB_0695', 25: 'LAB_069B',
};

/** jt -32382 (CODE+0x8fe6) FindEntitySlot(x, y, region, from): the first entity at or after `from` on that cell with a kind and no fired flag, or -1.
 *  The scan stops at the first slot of another region (slots are stored sorted by region). */
export function findEntity(c: Ctx, x: number, y: number, region: number, from: number): number {
  const { m, a4 } = c;
  const B = m.u32(a4 - 18458);
  for (let i = s16(from); i < 0x90; i++) {
    if (m.u8(B + 1296 + i) !== (region & 0xffff)) return -1;
    if (m.u8(B + 1008 + i) === (x & 0xffff) && m.u8(B + 1152 + i) === (y & 0xffff) && m.u8(B + 864 + i) > 0 &&
      testBit(m, a4 - 18290 + s16(m.u16(a4 - 18340)) * 10, m.u8(B + 1440 + i)) === 0) return i;
  }
  return -1;
}

/** Handlers a caller supplies: name -> run (the real ones are ported in this file or stubbed by the caller). */
export type EntityHandlers = (name: string, fx: Effect[], argsHex?: string) => void;

/** LAB_06B6: scan the entities on the party's cell in order and run each one's handler until a handler leaves the state (-18610) other than 5. */
export function dispatchEntities(c: Ctx, run: EntityHandlers, fx: Effect[]): void {
  const { m, a4 } = c;
  m.w16(a4 - 18312, 0xffff);
  m.w16(a4 - 10920, 0);
  for (;;) {
    const idx = findEntity(c, m.u16(a4 - 18334), m.u16(a4 - 18332), m.u16(a4 - 18330), m.u16(a4 - 18148));
    m.w16(a4 - 18148, idx);
    if (idx === -1) {
      if (m.u16(a4 - 10920) === 1) fx.push(['jt-32466', '']);
      return;
    }
    m.w16(a4 - 10918, 1);
    const B = m.u32(a4 - 18458);
    const kind = m.u8(B + 864 + s16(m.u16(a4 - 18148)));
    switch (kind) {
      case 5: entityKind5(c); break;
      case 2: if (m.u16(a4 - 10896) !== 0) run('LAB_05BB', fx); break;
      case 8: {
        const w = m.u16(B + 2 * s16(m.u16(a4 - 18148)));
        if (s16(w) > 0) run('LAB_05B1', fx, hex16(w) + '0000'); else run('LAB_05E0', fx);
        break;
      }
      default: if (ENTITY_HANDLERS[kind] !== undefined) run(ENTITY_HANDLERS[kind], fx);
    }
    if (s16(m.u16(a4 - 18610)) !== 5) return;
    if (m.u16(a4 - 10918) === 1) m.w16(a4 - 18148, m.u16(a4 - 18148) + 1);
  }
}

/** JT -32472: the `width`-bit field of a word at bit `pos`. */
const field = (v: number, pos: number, width: number): number => ((v & 0xffff) >> pos) & ((1 << width) - 1);

const trans = (c: Ctx): number => c.a4 - 18290 + s16(c.m.u16(c.a4 - 18340)) * 10;
const pers = (c: Ctx): number => c.a4 - 30310 + s16(c.m.u16(c.a4 - 18340)) * 10;

/**
 * LAB_05CD(mode) (CODE+0xbc34): mark the current entity as fired. Mode 1 or more sets its trigger-flag bit (byte +1440, when non-zero) in the
 * transient table of this level (-18290 + level * 10), mode 2 or more also in the persistent one (-30310 + level * 10).
 */
export function markFired(c: Ctx, mode: number): void {
  const { m, a4 } = c;
  if (s16(mode) <= 0) return;
  const B = m.u32(a4 - 18458);
  const bit = m.u8(B + 1440 + s16(m.u16(a4 - 18148)));
  if (bit === 0) return;
  setBit(c, trans(c), bit, 1);
  if (s16(mode) > 1) setBit(c, pers(c), bit, 1);
}

/** LAB_066D(a, b, c) (CODE+0xdc..): flip two trigger flags. With c = 0 flag `a` is cleared and flag `b` set, otherwise `b` cleared and `a` set; both tables. */
export function flipTriggers(c: Ctx, a: number, b: number, flag: number): void {
  const first = (flag & 0xffff) === 0 ? a : b;
  const second = (flag & 0xffff) === 0 ? b : a;
  if ((first & 0xffff) !== 0) { setBit(c, trans(c), first, 0); setBit(c, pers(c), first, 0); }
  if ((second & 0xffff) !== 0) { setBit(c, trans(c), second, 1); setBit(c, pers(c), second, 1); }
}

/** Entity kind 3, LAB_05DA (CODE+0xbe60): an entity that only acts when the party faces the stored direction; shows its message and may start the event state 0x15. */
export function entityKind3(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  const B = m.u32(a4 - 18458);
  const idx = s16(m.u16(a4 - 18148));
  const E = m.u16(B + 576 + 2 * idx);
  if (field(E, 14, 1) === 1) {
    const f = field(E, 12, 2);
    m.w16(a4 - 18312, f);
    if (f !== m.u16(a4 - 18328)) return;
  }
  const w = m.u16(B + 2 * idx);
  if (s16(w) > 0) fx.push(['LAB_05B1', hex16(w) + '0000']);
  if (field(E, 8, 1) === 1) return;
  m.w16(a4 - 15296, m.u8(B + 1584 + idx));
  m.w16(a4 - 18610, 0x15);
}

/** Entity kind 16, LAB_062B (CODE+0xce4a): a facing-gated message that can also end the scan (state 9) or mark itself fired. */
export function entityKind16(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  const B = m.u32(a4 - 18458);
  const idx = s16(m.u16(a4 - 18148));
  const E = m.u16(B + 576 + 2 * idx);
  if (field(E, 6, 1) === 1) {
    const f = field(E, 4, 2);
    m.w16(a4 - 18312, f);
    if (f !== m.u16(a4 - 18328)) return;
  }
  if (field(E, 3, 1) === 1) { m.w16(a4 - 18610, 9); return; }
  fx.push(['LAB_05B1', hex16(m.u16(B + 2 * idx)) + hex16(field(m.u16(B + 576 + 2 * idx), 2, 1))]);
  markFired(c, field(m.u16(B + 576 + 2 * idx), 0, 2));
}

/** Entity kind 6, LAB_0685 (CODE+0xdf76): a key-item switch. If any party member carries the item whose id is the entity word (slot flag bit 0), the two trigger flags flip one way, else the other; `markFired` runs when none carries it. */
export function entityKind6(c: Ctx): void {
  const { m, a4 } = c;
  const B = m.u32(a4 - 18458);
  const idx = s16(m.u16(a4 - 18148));
  let missing = 1;
  const id = m.u16(B + 2 * idx);
  for (let mem = 0; mem < s16(m.u16(a4 - 15306)); mem++) {
    const P = a4 - 17922 + mem * 0x1b0;
    for (let k = 0; k < m.u8(P + 428); k++) {
      if (m.u16(P + 64 + 8 * k) === id && (m.u8(P + 71 + 8 * k) & 1) !== 0) missing = 0;
    }
  }
  flipTriggers(c, m.u16(B + 288 + 2 * idx), m.u8(B + 1584 + idx), missing);
  if (missing === 0) markFired(c, field(m.u16(B + 576 + 2 * idx), 0, 2));
}
