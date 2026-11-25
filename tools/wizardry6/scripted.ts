/**
 * Wizardry 6 (Amiga) scripted-spot and scripted-entity encounter triggers, ported from the game's 68k code and diffed
 * against it under Unicorn (oracle/combat5.py -> oracle/{region,entry,loop,kind4,kind5,zone}-vectors.json,
 * __tests__/scripted.test.ts). Original TypeScript derived from the disassembly only.
 *
 *   setRegion      LAB_0735 (`Bane` CODE+0x101ca): set (val 1) or clear (val 0) the bit of cell (floor, x, y) in the 96-byte
 *                  bit-map at -18018(A4), then flood the connected region over open edges. Clearing also erases every
 *                  scripted spot (block +1274 / +1298, five per floor) that sits on the cell it clears.
 *   exploreEntry   LAB_08A7 from CODE+0x13c54 to LAB_08AD (0x13d26): the entry half of the exploration routine.
 *   scriptedTest   the test at LAB_08AA/08AB (0x13cc4..): the exploration loop repeats it after every move.
 *   entityKind4/5  entity kinds 4 and 5 of the arrival dispatcher LAB_06B6: the encounter id is the entity's operand byte.
 *   zoneIndicator  the zone-bit message code after LAB_08BD (0x13f1c..0x13fde).
 *
 * `floor` is -18330(A4) (0-based floor inside the loaded map -18340(A4)); earlier notes called it the level.
 */
import { s16, type Effect } from './combat.ts';
import { type Ctx, testBit } from './planner.ts';
import { encounterGroup, encounterMonster, getField } from './randenc.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

/** JT -32496 (LAB_018B): set or clear bit `bit` (a word) of the byte array at ptr. */
export function setBit(c: Ctx, ptr: number, bit: number, val: number): void {
  const a = ptr + ((bit & 0xffff) >>> 3);
  const mask = 1 << (bit & 7);
  let b = c.m.u8(a) & ~mask;
  if (val & 0xffff) b |= mask;
  c.m.w8(a, b);
}

/** JT -32484 (LAB_018F): write the `width`-bit field `idx` of a little-endian packed array (reads and writes both bytes). */
export function setField(c: Ctx, ptr: number, idx: number, width: number, val: number): void {
  const mask = 0xffff >>> (16 - width);
  const v = val & mask;
  const pos = width * (idx & 0xffff);
  const a = ptr + (pos >>> 3);
  const s = pos & 7;
  const keep = ~((mask << s) & 0xffff) & 0xffff;
  const put = (v << s) & 0xffff;
  c.m.w8(a, (c.m.u8(a) & keep) | (put & 0xff));
  c.m.w8(a + 1, (c.m.u8(a + 1) & (keep >>> 8)) | (put >>> 8));
}

const BITMAP = -18018;

/** LAB_0735(floor, x, y, val). */
export function setRegion(c: Ctx, floor: number, x: number, y: number, val: number): void {
  const { m, a4 } = c;
  x = (s16(x) + 8) % 8;
  y = (s16(y) + 8) % 8;
  const idx = (((floor << 6) + (y << 3)) + x) & 0xffff;
  const cur = testBit(m, a4 + BITMAP, idx);
  if (cur === (val & 0xffff)) return;
  setBit(c, a4 + BITMAP, idx, val);
  const blk = m.u32(a4 - 18462);
  if ((val & 0xffff) === 0) {
    for (let k = 0; k < 5; k++) {
      const fi = s16(floor) * 5 + k;
      const sx = getField(c, blk + 1274, fi, 3);
      const sy = getField(c, blk + 1298, fi, 3);
      if (sx === x && sy === y) { setField(c, blk + 1274, fi, 3, 0); setField(c, blk + 1298, fi, 3, 0); }
    }
  }
  if (getField(c, blk + 96, idx, 2) === 0 && y < 7) setRegion(c, floor, x, y + 1, val);
  if (getField(c, blk + 288, idx, 2) === 0 && x < 7) setRegion(c, floor, x + 1, y, val);
  if (y > 0 && getField(c, blk + 96, (((y - 1) << 3) + (floor << 6) + x) & 0xffff, 2) === 0) setRegion(c, floor, x, y - 1, val);
  if (x > 0 && getField(c, blk + 288, (((floor << 6) + (y << 3)) + x - 1) & 0xffff, 2) === 0) setRegion(c, floor, x - 1, y, val);
}

/** The test at LAB_08AA..LAB_08AB; true when a scripted encounter starts (the routine returns), false when it falls to LAB_08AD. */
export function scriptedTest(c: Ctx): boolean {
  const { m, a4 } = c;
  const floor = s16(m.u16(a4 - 18330));
  const idx = (((floor << 6) & 0xffff) + ((s16(m.u16(a4 - 18332)) << 3) & 0xffff) + s16(m.u16(a4 - 18334))) & 0xffff;
  const bit = testBit(m, a4 + BITMAP, idx);
  if (bit !== 1) return false;
  const id = encounterMonster(c, encounterGroup(c, floor));
  m.w16(m.u32(a4 - 18306), id);
  m.w16(a4 - 15100, bit); m.w16(a4 - 15128, 0); m.w16(a4 - 18610, 10);
  return true;
}

/** LAB_08A7 from its first instruction: returns true when a scripted encounter started. `fx` records the redraw call. */
export function exploreEntry(c: Ctx, fx: Effect[]): boolean {
  const { m, a4 } = c;
  const floor = s16(m.u16(a4 - 18330));
  if (s16(m.u16(a4 - 18148)) >= 0) {
    const lim = m.u8(m.u32(a4 - 18458) + floor + 1728);
    if (m.u16(a4 - 18148) < lim) m.w16(a4 - 18148, lim);
  }
  if (m.u16(a4 - 18608) !== 0x17) setRegion(c, floor, m.u16(a4 - 18334), m.u16(a4 - 18332), 0);
  fx.push(['LAB_0764', '']);
  m.w16(a4 - 18608, 5); m.w16(a4 - 18610, 5); m.w16(a4 - 10894, 1);
  return scriptedTest(c);
}

/** Entity kind 4 (LAB_062F, CODE+0xcf1c): operand byte is a monster id, or (flag bit 3 of the entity word) a group to pick from. */
export function entityKind4(c: Ctx, fx: Effect[], forceGroup = false): void {
  const { m, a4 } = c;
  const idx = s16(m.u16(a4 - 18148));
  const B = m.u32(a4 - 18458);
  const w = m.u16(B + 576 + 2 * idx);
  const op = (): number => m.u8(B + 1584 + idx);
  const id = forceGroup || ((w >>> 3) & 1) === 1 ? encounterMonster(c, op()) : op();
  m.w16(m.u32(a4 - 18306), id);
  m.w16(a4 - 15100, 1); m.w16(a4 - 15128, 1); m.w16(a4 - 18610, 10);
  fx.push(['LAB_05CD', hex16((m.u16(B + 576 + 2 * idx) >>> 4) & 3)]);
  m.w16(a4 - 18148, idx + 1);
}

/** Entity kind 5 (inline case of LAB_06B6, CODE+0xea30): the operand byte is the monster id; enters state 0x12. */
export function entityKind5(c: Ctx): void {
  const { m, a4 } = c;
  const idx = s16(m.u16(a4 - 18148));
  const id = m.u8(m.u32(a4 - 18458) + idx + 1584);
  m.w16(m.u32(a4 - 18306), id);
  m.w16(a4 - 15100, 1); m.w16(a4 - 18610, 0x12);
  m.w16(a4 - 18148, idx + 1);
}

/** The zone-bit indicator after LAB_08BD: message 2023 on the marked cells of map 5 and of map 12 above floor 8, message 2054 flying over map 8. */
export function zoneIndicator(c: Ctx, fx: Effect[]): void {
  const { m, a4 } = c;
  if (m.u16(a4 - 10890) === 1) m.w16(a4 - 10890, 0);
  const map = s16(m.u16(a4 - 18340));
  const zoneOn = (): boolean => {
    const floor = s16(m.u16(a4 - 18330));
    const idx = (((floor << 6) & 0xffff) + ((s16(m.u16(a4 - 18332)) << 3) & 0xffff) + s16(m.u16(a4 - 18334))) & 0xffff;
    return testBit(m, m.u32(a4 - 18462) + 1082, idx) === 1;
  };
  if (map === 5 || (map === 12 && s16(m.u16(a4 - 18330)) > 8)) {
    if (zoneOn()) { fx.push(['LAB_078D', hex16(0x7e7)]); m.w16(a4 - 10894, 1); return; }
  }
  if (map === 8 && s16(m.u16(a4 - 18136)) === 1) { fx.push(['LAB_078D', hex16(0x806)]); m.w16(a4 - 10894, 1); return; }
  if (m.u16(a4 - 10894) === 1) m.w16(a4 - 10894, 0);
}
