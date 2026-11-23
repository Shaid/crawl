/**
 * Black Crypt (Amiga): the nine spells that pass 4 had only read from the code, plus the object / inventory-weight helpers they share.
 * Original TypeScript, run against the game's own 68k code in musashi (rules_oracle/make_vectors_spells9.py, test rules-spell9.test.ts): each case
 * compares EVERY byte the real routine changed in the A4 data segment (object table, cell map, character records, globals), the hooked
 * calls (+0x4876 spend, +0x4960 fail, +0x5EA schedule) and the RNG state. All offsets are S_1 offsets; memory offsets are A4-relative (A4Mem).
 *
 * World layout (A4-relative): object record 0x14 bytes at -0x6E7A + 0x14 * id (+0 word type / monster bit 15, +4 byte position nibbles in the high half,
 * +5 byte structure type, +7 byte, +8 word, +0xA word, +0xC word, +0xE word, +0x10 word, +0x12 word = next object on the square); free-list head = the
 * word at -0x6E68 (object 0's next field); cell longword at -0x37CA + y * 256 + x * 4 (low 12 bits = first object id, bit 12 + d = wall on side d).
 *
 * Quirks found by the harness (reproduced, not fixed):
 *  - CREATE WALL with a wall in front returns the CALLER's D3 (the caster's stat bonus) instead of a status code (d3 is never initialised on that path).
 *  - REVEAL TRUTH frees the illusion item and clears the slot even when the weight routine refuses (a carried weight above the limit makes the
 *    subtraction "too heavy"; the item is gone anyway and the carried weight is not reduced).
 */
import { BcRng, type RuleTables } from './rules';
import { A4Mem, stepPos } from './rules-spell';

export const OBJ = (id: number) => -0x6e7a + 0x14 * id;
export const CELL = (x: number, y: number) => -0x37ca + (y << 8) + (x << 2);
const CH = (k: number) => 0x1758 + 0xa8 * k;
const FREE_HEAD = -0x6e68;
const b8 = (v: number) => v & 0xff, s8 = (v: number) => (v << 24) >> 24, s16 = (v: number) => (v << 16) >> 16, u16 = (v: number) => v & 0xffff;

// ---- 32-bit access on top of A4Mem
const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;
const setL = (a: A4Mem, o: number, v: number) => { a.setW(o, (v >>> 16) & 0xffff); a.setW(o + 2, v & 0xffff); };

// ---- object-list primitives (S_1 +0x6, +0x46, +0xFE, +0x27D28, +0x1744A; all harness)
export const objNext = (a: A4Mem, id: number) => a.w(OBJ(id) + 0x12);
/** +0x6: take the head of the free list */
export function allocObj(a: A4Mem): number {
  const id = a.w(FREE_HEAD);
  a.setW(FREE_HEAD, a.w(OBJ(id) + 0x12));
  a.setW(OBJ(id) + 0x12, 0);
  return id;
}
/** +0x46: push an object onto the free list */
export function freeObj(a: A4Mem, id: number): void { a.setW(OBJ(id) + 0x12, a.w(FREE_HEAD)); a.setW(FREE_HEAD, id); }
/** +0xFE (id, x, y): unlink an object from the chain of a square (the object's own next field is left alone) */
export function unlinkObj(a: A4Mem, id: number, x: number, y: number): void {
  let cur = getL(a, CELL(x, y)) & 0xfff, prev = 0;
  while (cur !== 0 && cur !== id) { prev = cur; cur = a.w(OBJ(cur) + 0x12); }
  const nxt = a.w(OBJ(id) + 0x12);
  if (cur > 0 && prev === 0) setL(a, CELL(x, y), ((getL(a, CELL(x, y)) & 0xfffff000) + nxt) >>> 0);
  if (cur > 0 && prev > 0) a.setW(OBJ(prev) + 0x12, nxt);
}
/** +0x27D28 (type in d3, y in d2, x in d1): first non-monster object (word0 bit 15 clear) of that structure type (+5) on the square, else 0 */
export function lookupType(a: A4Mem, x: number, y: number, type: number): number {
  let id = getL(a, CELL(x, y)) & 0xfff;
  while (id !== 0) {
    if (!(a.w(OBJ(id)) & 0x8000) && a.b(OBJ(id) + 5) === type) return id;
    id = a.w(OBJ(id) + 0x12);
  }
  return 0;
}
/** +0x1744A (tail pointer, id, x, y), non-monster branch: a random sub-square nibble pair goes into the high half of byte +4, then the object joins the END of the chain */
export function insertObj(a: A4Mem, rng: BcRng, tail: { id: number }, id: number, x: number, y: number): void {
  a.setW(OBJ(id) + 0x12, 0);
  if (!(a.w(OBJ(id)) & 0x8000)) {
    const d3 = (rng.rand16(4) + a.w(0x1744)) & 3;
    const nib = (1 << ((d3 + 3) & 3)) + (1 << d3);
    a.setB(OBJ(id) + 4, (a.b(OBJ(id) + 4) & 0xf) + (nib << 4));
  } else throw new Error('insertObj: monster branch not modelled');
  if (tail.id === 0) setL(a, CELL(x, y), ((getL(a, CELL(x, y)) & 0xfffff000) + id) >>> 0);
  else a.setW(OBJ(tail.id) + 0x12, id);
  tail.id = id;
}

// ---- inventory weight (+0x11992 item weight, +0x126D2 add / remove)
/** +0x11992: (weight word +8, second word +0xA) of an item; containers (type 0x13 / 0x23) add their contents recursively (chain at +0xC, next at +0x12); the second sum only for type 0x13 */
export function itemWeight(a: A4Mem, id: number): [number, number] {
  if (id === 0) return [0, 0];
  const typ = a.b(OBJ(id) + 5);
  let d5 = a.w(OBJ(id) + 8), d6 = a.w(OBJ(id) + 0xa);
  if (typ === 0x13 || typ === 0x23) {
    let c = a.w(OBJ(id) + 0xc);
    while (c !== 0) {
      let x: number, y: number;
      const ct = a.b(OBJ(c) + 5);
      if (ct === 0x13 || ct === 0x23) [x, y] = itemWeight(a, c); else { x = a.w(OBJ(c) + 8); y = a.w(OBJ(c) + 0xa); }
      d5 = u16(d5 + x);
      if (typ === 0x13) d6 = u16(d6 + y);
      c = a.w(OBJ(c) + 0x12);
    }
  }
  return [d5, d6];
}
/** +0x126D2 (char, addItem, removeItem): carried weight (long at char +0xA4) += w(add) - w(remove) with SIGNED 16-bit item weights; refused (returns 0) when the result exceeds
 * signed(char +0x6E) * 1000; a negative result is stored as 0. */
export function adjustWeight(a: A4Mem, ch: number, add: number, rem: number): number {
  const wa = add ? s16(itemWeight(a, add)[0]) : 0, wr = rem ? s16(itemWeight(a, rem)[0]) : 0;
  const nw = (getL(a, CH(ch) + 0xa4) | 0) + wa - wr;
  if (nw > s16(s8(a.b(CH(ch) + 0x6e))) * 1000) return 0;
  setL(a, CH(ch) + 0xa4, nw >>> 0);
  if (nw < 0) setL(a, CH(ch) + 0xa4, 0);
  return 1;
}

// ---- vitals (AdjustVitals +0x17EEA) and the per-step cost (+0x16FC6 loop of the party-move routine +0x16CC4)
/** AdjustVitals (char, dEnergy, dFood, dWater; HARNESS, 600+ cases): a dead character (hp <= 0) is skipped. Energy (+0x56), food (+0x52), water (+0x54) are WORDS (wrapping adds), the
 * sustenance byte +0x90 turns the food delta into (delta >> 1) + 1 (arithmetic shift, so -1 becomes 0 and -2 becomes 0 too: eating spells slow hunger to nothing). Clamps: energy <= 10000,
 * food / water <= 5000, all >= 0 (signed compares). When energy crosses 1000 (either way) the character gets the "tired" adjustment: STR (+0x64) and DEX (+0x68) change by +1 on the way up
 * and -1 on the way down; AC (+0x62) is unchanged on the way up and moves by statBonusT1[dex - 1] - statBonusT1[dex] (as before the change) on the way down (a game asymmetry);
 * the redraw call +0x170A8 follows. Returns whether the crossing happened. */
export function adjustVitals(a: A4Mem, t1: number[], ch: number, dE: number, dF: number, dW: number): boolean {
  const c = CH(ch);
  if (a.sw(c + 0x4e) <= 0) return false;
  const old = a.sw(c + 0x56);
  a.setW(c + 0x56, a.w(c + 0x56) + dE);
  let d2 = a.sw(c + 0x56);
  let d6 = s16(dF);
  if (a.b(c + 0x90) !== 0) d6 = ((d6 >> 1) + 1) & 0xffff;
  a.setW(c + 0x52, a.w(c + 0x52) + d6); let d4 = a.sw(c + 0x52);
  a.setW(c + 0x54, a.w(c + 0x54) + dW); let d5 = a.sw(c + 0x54);
  if (d2 > 10000) { a.setW(c + 0x56, 10000); d2 = 10000; }
  if (d4 > 5000) { a.setW(c + 0x52, 5000); d4 = 5000; }
  if (d5 > 5000) { a.setW(c + 0x54, 5000); d5 = 5000; }
  if (d2 < 0) { a.setW(c + 0x56, 0); d2 = 0; }
  if (d4 < 0) { a.setW(c + 0x52, 0); d4 = 0; }
  if (d5 < 0) { a.setW(c + 0x54, 0); d5 = 0; }
  if (!((d2 < 1000 && old >= 1000) || (d2 >= 1000 && old < 1000))) return false;
  const bump = (str: number, dex: number, ac: number) => { a.setB(c + 0x64, a.b(c + 0x64) + str); a.setB(c + 0x68, a.b(c + 0x68) + dex); if (ac) a.setB(c + 0x62, a.sb(c + 0x62) + ac * t1[s8(a.b(c + 0x68))]); };
  const up = old < 1000 ? 1 : 0;
  a.setB(c + 0x64, a.b(c + 0x64) + up); a.setB(c + 0x68, a.b(c + 0x68) + up); a.setB(c + 0x62, a.sb(c + 0x62) - t1[s8(a.b(c + 0x68))]);
  const dn = d2 >= 1000 ? 0 : 1;
  void bump;
  a.setB(c + 0x64, a.b(c + 0x64) - dn); a.setB(c + 0x68, a.b(c + 0x68) - dn); a.setB(c + 0x62, a.sb(c + 0x62) + t1[s8(a.b(c + 0x68))]);
  return true;
}
/** Cost of one step (the loop at +0x16FC6; turning uses -1 / -1 / -1 without the weight term, +0x1702A): every character is charged energy -1 - ((carried weight long at +0xA4) >> 11)
 * (arithmetic shift, word subtraction), food -1, water -1 through AdjustVitals. Returns the characters whose tired state flipped. HARNESS. */
export function stepCost(a: A4Mem, t1: number[]): number[] {
  const flipped: number[] = [];
  for (let k = 0; k < 4; k++) {
    const w = getL(a, CH(k) + 0xa4) | 0;
    const dE = (-1 - ((w >> 11) & 0xffff)) & 0xffff;
    if (adjustVitals(a, t1, k, dE, 0xffff, 0xffff)) flipped.push(k);
  }
  return flipped;
}

// ---- the swing cooldown (player action handler +0x13768, event 0x14) and the swing-ready event of a hit (+0x1451E tail, event 0x15)
/** Cooldown of a swing after the weapon in the hand slot (+0x138F0..+0x1394E, HARNESS): bare hands 5; otherwise floor(weaponWeight / 23) (the item's UNSIGNED word +8) + speedT3[signed DEX byte +0x68],
 * never below 5 (signed compare). Ticks. */
export function swingCooldown(a: A4Mem, t3: number[], ch: number, item: number): number {
  if (item === 0) return 5;
  const v = Math.floor(a.w(OBJ(item) + 8) / 23) + s16(t3[s8(a.b(CH(ch) + 0x68))]);
  return v >= 5 ? v : 5;
}
/** Tail of every resolved swing (+0x13E8C..: HARNESS, hit or miss alike): with the swing flag set, haste (word A4+0x1E2E != 0) turns the cooldown c into (c >> 1) + 1 (16-bit arithmetic shift),
 * event 0x14 is scheduled at tick + c (signed word) with a1 = character, a2 = 0, a3 = hand, a4 = 2 - hand; the character's busy byte +0x5F += 2 - hand; and the swing costs energy -4, food -2, water -1
 * (AdjustVitals). A HIT additionally schedules event 0x15 (the hit-resolve / ready event, in +0x1451E) at tick + 5, or with haste min(5, (c >> 1) + 1). */
export function swingTail(a: A4Mem, t1: number[], ch: number, hand: number, cooldown: number, tick: number, flag: boolean,
  sched: (type: number, due: number, a1: number, a2: number, a3: number, a4: number) => void): void {
  if (!flag) return;
  let c = cooldown;
  if (a.w(0x1e2e) !== 0) c = s16(s16(c) >> 1) + 1;
  sched(0x14, (tick + s16(c)) >>> 0, ch & 0xff, 0, hand & 0xff, (2 - hand) & 0xff);
  a.setB(CH(ch) + 0x5f, a.b(CH(ch) + 0x5f) + (2 - hand));
  adjustVitals(a, t1, ch, 0xfffc, 0xfffe, 0xffff);
}
/** Event 0x15 delay of a hit (+0x1451E, HARNESS 47 / 47 hits): 5 ticks; with haste min(5, (cooldown >> 1) + 1). */
export const hitReadyDelay = (haste: boolean, cooldown: number): number => haste ? Math.min(5, (s16(cooldown) >> 1) + 1) : 5;

// ---- doors and the last Ram-boss stage
/** Door open (+0x9056, x, y; HARNESS): the type-0x11 structure at (x, y) gets state word +0xE = 1 (open). With no such structure the write lands on OBJECT 0 (record at -0x6E7A), a harmless quirk.
 * Everything else the routine does is redraw / sound (the visibility call +0x8388 and the UI helpers are hooked out in the harness). The monster-side rule (who may open a closed door) is the
 * enter test of section 10.3; a locked door has state 2 and is never touched by this routine's callers. */
export function openDoor(a: A4Mem, x: number, y: number): void {
  a.setW(OBJ(lookupType(a, x, y, 0x11)) + 0xe, 1);
}
/** Monsters-in-front pick (+0xB308) on raw memory: up to two target ids on a square; a monster is an object whose word 0 has bit 15 set, its secondary record is word +0x10, the sub-square (0..3 corner, 4 centre) byte +0xB of the secondary */
export function pickTargetsMem(a: A4Mem, x: number, y: number): [number, number] {
  const slots = [0, 0, 0, 0, 0], f = a.w(0x1744);
  for (let id = getL(a, CELL(x, y)) & 0xfff; id !== 0; id = a.w(OBJ(id) + 0x12)) {
    if (a.w(OBJ(id)) & 0x8000) slots[a.b(OBJ(a.w(OBJ(id) + 0x10)) + 0xb)] = id;
  }
  if (slots[4]) return [slots[4], slots[4]];
  const d3 = (f + 3) & 3, d4 = (f + 2) & 3;
  return [slots[d3] || slots[(d3 + 1) & 3], slots[d4] || slots[(d4 + 3) & 3]];
}
/** FORCEHAMMER (+0x7C40, plot item effect 0x90; HARNESS for the world changes): needs stage 4, no wall ahead and the Ram boss (gfx 0x80C5) as the first target of the front square.
 * Then: the boss is unlinked from its square and both its records are freed (primary first, then the secondary; its events are cancelled, `cancelled` receives the id), the state word +0xA
 * of the type-0x12 structure at (x = 12, y = 17) is cleared (object 0 when there is none), stage = 5 and the ending sequence starts (word A4+0x1E88 = 3). Animation / text / music are UI. */
export function forceHammer(a: A4Mem, cancelled: number[]): void {
  if (a.w(0x1a1e) !== 4 || wallAhead(a)) return;
  const [x, y] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  const id = pickTargetsMem(a, x, y)[0];
  if (id === 0 || a.w(OBJ(id)) !== 0x80c5) return;
  const sec = a.w(OBJ(id) + 0x10);
  unlinkObj(a, id, x, y); freeObj(a, id); freeObj(a, sec); cancelled.push(id);
  a.setW(OBJ(lookupType(a, 12, 17, 0x12)) + 0xa, 0);
  a.setW(0x1a1e, 5); a.setW(0x1e88, 3);
}

// ---- the nine spells
export interface Sp9Out { spent?: number; failed?: number; events: { type: number; due: number; a1: number; a2: number; a3: number }[]; ret: number }

/** Caster values (+0x70A0..): d4 = level + signed(+0x6A) as a byte; d3 = statBonusT1[signed stat byte] where the stat is +0x65 for class 1 / 3 and +0x66 otherwise */
function casterD(a: A4Mem, t: RuleTables): { d3: number; d4: number } {
  const c = CH(a.w(0x1a14));
  const d4 = b8(a.b(c + 0x5e) + s8(a.b(c + 0x6a)));
  const cls = a.w(c);
  const stat = s8(a.b(c + ((cls === 1 || cls === 3) ? 0x65 : 0x66)));
  return { d3: s16(t.statBonusT1[stat]), d4 };
}
const wallAhead = (a: A4Mem) => (getL(a, CELL(a.w(0x1742), a.w(0x1740))) & (0x1000 << a.w(0x1744))) !== 0;

/** CREATE FOOD (+0x5952): ((arg + 2) / 3) * 2 food objects (type word 0x15, name 0x8005, weight 100) dropped on the party square at random sub-positions */
export function createFood(a: A4Mem, rng: BcRng, arg: number): number {
  const n = u16(Math.floor((arg + 2) / 3) * 2);
  const px = a.w(0x1742), py = a.w(0x1740);
  let t = getL(a, CELL(px, py)) & 0xfff;
  while (t !== 0 && a.w(OBJ(t) + 0x12) !== 0) t = a.w(OBJ(t) + 0x12);
  const tail = { id: t };
  for (let i = 1; i <= n; i++) {
    const id = allocObj(a), o = OBJ(id);
    a.setW(o, 0x15); a.setW(o + 2, 0x8005); a.setB(o + 4, 0xf); a.setB(o + 5, 0xe); a.setW(o + 8, 0x64); a.setW(o + 0xa, 0x4b);
    a.setW(o + 0xc, 0); a.setW(o + 0xe, 0x1c2); a.setW(o + 0x10, 2); a.setB(o + 7, 2);
    insertObj(a, rng, tail, id, px, py);
  }
  return 1;
}
/** REVEAL TRUTH / DISPEL ILLUSION (+0x6C92): every living character's two hand slots (+0x1A, +0x1C): an item of type 0x18 with word +0xE == 1 is removed (weight call, freed, slot cleared). Returns 2 */
export function revealTruth(a: A4Mem): number {
  for (let c = 0; c < 4; c++) {
    if (a.sw(CH(c) + 0x4e) <= 0) continue;
    for (let k = 2; k <= 3; k++) {
      const so = CH(c) + 0x16 + 2 * k, it = a.w(so);
      if (it !== 0 && a.b(OBJ(it) + 5) === 0x18 && a.w(OBJ(it) + 0xe) === 1) { adjustWeight(a, c, 0, it); freeObj(a, it); a.setW(so, 0); }
    }
  }
  return 2;
}
/** REMOVE TRAP (+0x60BE): no wall ahead: the type-0x1E structure on the front square with word +0xE == 1 is unlinked and freed. Returns 1 */
export function removeTrap(a: A4Mem): number {
  if (wallAhead(a)) return 1;
  const [x, y] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  const id = lookupType(a, x, y, 0x1e);
  if (id !== 0 && a.w(OBJ(id) + 0xe) === 1) { unlinkObj(a, id, x, y); freeObj(a, id); }
  return 1;
}
/** DISPEL MAGIC (+0x4C46, linked group) and REMOVE GLYPH (+0x4E0A): the type-0x10 structure ahead with word +0xC == kind (2 = magic field, 3 = glyph) and strength word +0xE <= arg is removed.
 * Dispel also follows the link (x = word +0x10, y = byte +7) and removes each further type-0x10 field with +0xC == 2 until the link is (0, 0) or leads to something else. Returns 1 */
export function dispel(a: A4Mem, arg: number, kind: 2 | 3): number {
  if (wallAhead(a)) return 1;
  const [x, y] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  const id = lookupType(a, x, y, 0x10);
  if (id === 0 || a.w(OBJ(id) + 0xc) !== kind || a.w(OBJ(id) + 0xe) > arg) return 1;
  unlinkObj(a, id, x, y);
  let nx = a.w(OBJ(id) + 0x10), ny = a.b(OBJ(id) + 7);
  freeObj(a, id);
  if (kind === 3) return 1;
  while (nx !== 0 || ny !== 0) {
    const j = lookupType(a, nx, ny, 0x10);
    if (j !== 0 && a.w(OBJ(j) + 0xc) === 2) {
      unlinkObj(a, j, nx, ny);
      const tx = a.w(OBJ(j) + 0x10), ty = a.b(OBJ(j) + 7);
      freeObj(a, j); nx = tx; ny = ty;
    } else { nx = 0; ny = 0; }
  }
  return 1;
}
/** CREATE WALL (+0x4F18): the front square must be open and EMPTY (no objects): a wall structure (type 0x10, +0xC = +0xE = 1) is created and event 0x22 is
 * scheduled at tick + (arg * 180 mod 65536) with a1 = x, a2 = y. Returns 1; -1 when the square is occupied; with a wall ahead the caller's D3 (see the header) */
export function createWall(a: A4Mem, arg: number, callerD3: number, tick: number, sched: (type: number, due: number, a1: number, a2: number, a3: number) => void): number {
  if (wallAhead(a)) return callerD3;
  const [x, y] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  if ((getL(a, CELL(x, y)) & 0xfff) !== 0) return -1;
  const id = allocObj(a), o = OBJ(id);
  a.setW(o, 1); a.setW(o + 0xa, 0); a.setB(o + 5, 0x10); a.setW(o + 0xc, 1); a.setW(o + 0xe, 1); a.setB(o + 4, 0);
  setL(a, CELL(x, y), ((getL(a, CELL(x, y)) & 0xfffff000) + id) >>> 0);
  sched(0x22, (tick + u16(arg * 180)) >>> 0, b8(x), b8(y), 0);
  return 1;
}
/** READ RUNE (+0x655C): when the byte at A4-0x779A is 0x6A (the player faces a rune) the reader UI opens and the spell removes ITS OWN slot (later slots move down, last = 0xFF);
 * otherwise nothing happens and 1 is returned. The rune path returns 0 (neither spent nor failed: it already spent itself). */
export function readRune(a: A4Mem): number {
  if (a.b(-0x779a) !== 0x6a) return 1;
  const ch = a.w(0x1a14);
  for (let d2 = a.b(0x1e70); d2 < 4; d2++) a.setB(CH(ch) + 0x49 + d2, a.b(CH(ch) + 0x49 + d2 + 1));
  a.setB(CH(ch) + 0x4d, 0xff);
  return 0;
}

/** The dispatcher around them (+0x7044): slot -> spell id (0xFF = empty slot, nothing happens), then the result convention: ret > 0 -> +0x4876(ret - 1) (spend), ret < 0 -> +0x4960(-1 - ret) (fail). */
export function castSpell9(a: A4Mem, rng: BcRng, t: RuleTables, slot: number, tick: number): Sp9Out {
  const out: Sp9Out = { events: [], ret: 0 };
  a.setB(0x1e70, slot);
  const act = a.w(0x1a14);
  const spell = a.b(CH(act) + 0x49 + slot);
  a.setB(0x1e86, spell);
  if (spell === 0xff) return out;
  const { d3, d4 } = casterD(a, t);
  let ret: number;
  // an anti-magic square (cell bit 30 on the party square, +0x70CA) fizzles every spell here; the charge is still spent (+0x4876(0))
  if ((getL(a, CELL(a.w(0x1742), a.w(0x1740))) & 0x40000000) !== 0) { out.ret = 1; out.spent = 0; return out; }
  switch (spell) {
    case 10: ret = createFood(a, rng, d4); break;
    case 2: case 51: ret = revealTruth(a); break;
    case 41: ret = removeTrap(a); break;
    case 26: ret = readRune(a); break;
    case 22: case 24: ret = dispel(a, d4, 2); break;
    case 21: ret = dispel(a, d4, 3); break;
    case 44: ret = createWall(a, d4, d3, tick, (type, due, a1, a2, a3) => out.events.push({ type, due, a1, a2, a3 })); break;
    default: throw new Error('castSpell9: spell ' + spell + ' not covered here');
  }
  out.ret = s16(ret);
  if (out.ret > 0) out.spent = out.ret - 1; else if (out.ret < 0) out.failed = -1 - out.ret;
  return out;
}
