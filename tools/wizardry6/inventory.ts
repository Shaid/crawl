/**
 * Wizardry 6 (Amiga) item removal LAB_0DE6 (`Bane` CODE+0x22278): use up one unit of the party member's
 * inventory slot `slot` (a thrown or shot item, an ammo stack). When the stack hits zero the item is removed:
 * every equipment pointer to it is reset, the slots above shift down by one, and the member's weight and
 * encumbrance bytes are refreshed. Ported from the game's code and diffed against it
 * (oracle/combat3.py remove -> oracle/remove-vectors.json, __tests__/inventory.test.ts).
 *
 * Two callees are recorded, not ported: LAB_0DDF (CODE+0x2200e, reset a weapon hand to bare fists) and
 * LAB_0DD6 (CODE+0x21f1a, recompute carried weight from the item table).
 */
import { encumbrance, type Effect } from './combat.ts';
import type { Ctx } from './planner.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

/** Party record layout used here: items at +64+8*slot (quantity byte +6), equipment slots +272..279, item count +428. */
export function removeItem(c: Ctx, slot: number, fx: Effect[]): void {
  const { m, a4 } = c;
  const i = ((m.u16(a4 - 15136) ^ 0x8000) - 0x8000);
  const P = a4 - 17922 + i * 0x1b0;
  const qty = P + 70 + 8 * slot;
  if (m.u8(qty) === 0) return;
  m.w8(qty, m.u8(qty) - 1);
  if (m.u8(qty) !== 0) return;
  for (let k = 0; k < 8; k++) {
    if (m.u8(P + 272 + k) !== slot) continue;
    if (k < 2) fx.push(['unequip', hex16(k)]);
    else if (k === 2) m.w8(P + 354, 0);
    else m.w8(P + 352 + k, m.u8(P + 352));
    m.w8(P + 272 + k, 0xff);
  }
  m.w16(P + 64 + 8 * slot, 0);
  m.w8(P + 428, m.u8(P + 428) - 1);
  for (let s = slot; s < m.u8(P + 428); s++) {
    for (let b = 0; b < 8; b++) m.w8(P + 64 + 8 * s + b, m.u8(P + 64 + 8 * (s + 1) + b));
    for (let k = 0; k < 8; k++) if (m.u8(P + 272 + k) === s + 1) m.w8(P + 272 + k, s);
  }
  fx.push(['weight', hex16(i)]);
  const w = encumbrance(m, a4, i);
  m.w8(P + 421, w[5]);
}
