/**
 * Black Crypt (Amiga): the tick handler's due-event POP LOOP (S_1 +0x12BA..+0x1FDA) and the consumers of the events that change rules state. HARNESS (pass 7):
 * `rules_oracle/make_vectors_pass7.py` family `pop` runs the real loop (musashi `G 0x12BA 0x1FDA`) on synthetic A4 images and `rules-pass7.test.ts` diffs EVERY changed byte.
 *
 * The loop (code, confirmed by the harness): head = byte A4+0x173F (0x96 = empty); if the head node's due long != the tick counter (A4+0x1750) the loop ends. NOT "<=": an overdue
 * head (due < tick) blocks the whole queue forever, only `==` fires. A due node is dispatched on its type byte (+4) with a1 = +5, a2 = +6, a3 = +7, a4 = +8, word +0xA, then POPPED:
 * the active head becomes node.next (+9), the node is pushed on the free list (A4+0x173E) and the loop restarts. Several events with the same due all fire in the same tick, in queue order.
 * Dispatch (chain +0x1F34): 1, 5, 0xA, 0xB are the monster / structure timers (not here, UI only or owned by the monster chain); 0x14 swing-ready; 0x15 hit-ready; 0x16 cast-ready; 0x1E-0x25
 * buff / state expiry (`applyExpiry`, section 11.2); 0x22 CREATE WALL expiry; 0x28 effect-script slot; 0x29 structure timer; any other type pops without effect.
 */
import { A4Mem, applyExpiry } from './rules-spell';
import { OBJ, QN, lookupType, unlinkObj, freeObj } from './rules-spell9';

const CHAR = (k: number) => 0x1758 + 0xa8 * k;
export interface DueEvent { type: number; a1: number; a2: number; a3: number; a4: number; wd: number }
const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;

/** swing-ready (+0x13DE): the busy byte +0x5F loses the event's mask a4; the hand slot redraw sets A4+0x174C (modes 1 and 10) or A4+0x174D (mode 2, only for the viewed character) */
export function swingReady(a: A4Mem, ev: DueEvent): void {
  const c = CHAR(ev.a1), mode = a.w(0x174a);
  a.setB(c + 0x5f, a.b(c + 0x5f) - ev.a4);
  const alive = a.sw(c + 0x4e) > 0;
  if ((mode === 1 || mode === 10) && alive && a.w(0x1756) === 0) { a.setB(0x174c, 1); return; }
  if (mode === 2 && alive && a.w(0x1a16) === ev.a1 && a.b(CHAR(a.w(0x1a16)) + 0x45) === 0 && a.b(0x1a26) === 0 && a.w(0x1756) === 0) a.setB(0x174d, 1);
}
/** hit-ready (+0x1616): the per-hand "swing in progress" word +0x58 + 2 * a3 is cleared; a living character in modes 1 / 10 sets A4+0x174C */
export function hitReady(a: A4Mem, ev: DueEvent): void {
  const c = CHAR(ev.a1), mode = a.w(0x174a);
  a.setW(c + 0x58 + 2 * ev.a3, 0);
  if ((mode === 1 || mode === 10) && a.sw(c + 0x4e) > 0) a.setB(0x174c, 1);
}
/** cast-ready (+0x17F2): byte +0x60 -= 1; at zero for a living character the redraw flag is set (mode 1 / 10: 0x174C; mode 2 / 4 for the viewed character unless A4+0x1A26 == 3, or mode 3 for the active one: 0x174D), then bytes +0x61 and word +0x5C are cleared */
export function castReady(a: A4Mem, ev: DueEvent): void {
  const c = CHAR(ev.a1), mode = a.w(0x174a);
  a.setB(c + 0x60, a.b(c + 0x60) - 1);
  if (a.b(c + 0x60) !== 0 || a.sw(c + 0x4e) <= 0) return;
  if (mode === 1 || mode === 10) a.setB(0x174c, 1);
  else if ((mode === 2 || mode === 4) && a.w(0x1a16) === ev.a1 && a.b(0x1a26) !== 3) a.setB(0x174d, 1);
  else if (mode === 3 && a.w(0x1a14) === ev.a1) a.setB(0x174d, 1);
  a.setB(c + 0x61, 0); a.setW(c + 0x5c, 0);
}
/** CREATE WALL expiry (+0x1D1E): the type-0x10 structure on (a1, a2) with +0xC == 1 and +0xE == 1 is unlinked and freed, redraw flag A4+0x1748 */
export function wallExpiry(a: A4Mem, ev: DueEvent): void {
  const id = lookupType(a, ev.a1, ev.a2, 0x10);
  if (id !== 0 && a.w(OBJ(id) + 0xc) === 1 && a.w(OBJ(id) + 0xe) === 1) { unlinkObj(a, id, ev.a1, ev.a2); freeObj(a, id); a.setB(0x1748, 1); }
}
/** effect-script slot (+0x1B70): the 8-byte record at A4+0x836 + 8 * (byte A4+0x83D) takes [0] = a4, [2] = a1, [3] = a2, [6] = a3; the UI effect call `+0x8C54E(index)` follows (not a rules effect) */
export function effectSlot(a: A4Mem, ev: DueEvent): number {
  const idx = a.b(0x83d), r = 0x836 + 8 * idx;
  a.setB(r, ev.a4); a.setB(r + 2, ev.a1); a.setB(r + 3, ev.a2); a.setB(r + 6, ev.a3);
  return idx;
}
/** structure timer (+0x1BC2): the first non-monster structure of type a3 on (a1, a2) has its word +0xA decremented. Scheduled by the structure-trigger routine `+0xCF34` (section 14.2) once a trigger sequence has started: it adds 1 to +0xA when it starts and this event takes it back when the longest scripted delay has elapsed */
export function structureTimer(a: A4Mem, ev: DueEvent): void {
  const id = lookupType(a, ev.a1, ev.a2, ev.a3);
  if (id !== 0) a.setW(OBJ(id) + 0xa, a.w(OBJ(id) + 0xa) - 1);
}
export type PopHooks = { fireOverdue?: boolean; unknown?: (ev: DueEvent) => void; slot?: (ev: DueEvent, idx: number) => void; applied?: (ev: DueEvent) => void };

/** run the pop loop for the current tick counter (A4+0x1750). Returns the events fired, in order. */
export function popDue(a: A4Mem, hooks: PopHooks = {}): DueEvent[] {
  const fired: DueEvent[] = [], tick = getL(a, 0x1750);
  for (let guard = 0; guard < 400; guard++) {
    const id = a.b(0x173f);
    if (id === 0x96 || (hooks.fireOverdue ? getL(a, QN(id)) > tick : getL(a, QN(id)) !== tick)) break;
    const n = QN(id);
    const ev: DueEvent = { type: a.b(n + 4), a1: a.b(n + 5), a2: a.b(n + 6), a3: a.b(n + 7), a4: a.b(n + 8), wd: a.w(n + 0xa) };
    switch (ev.type) {
      case 0x14: swingReady(a, ev); break;
      case 0x15: hitReady(a, ev); break;
      case 0x16: castReady(a, ev); break;
      case 0x1e: case 0x1f: case 0x20: case 0x21: case 0x23: case 0x24: case 0x25: applyExpiry(a, ev); break;
      case 0x22: wallExpiry(a, ev); break;
      case 0x28: { const i = effectSlot(a, ev); hooks.slot?.(ev, i); break; }
      case 0x29: structureTimer(a, ev); break;
      default: hooks.unknown?.(ev);
    }
    hooks.applied?.(ev); fired.push(ev);
    // pop: head = next, node onto the free list (+0x1F9C)
    const next = a.b(n + 9);
    a.setB(n + 9, a.b(0x173e)); a.setB(0x173e, id); a.setB(0x173f, next);
  }
  return fired;
}
