/**
 * Black Crypt (Amiga): the ACTION EXECUTOR (`+0xC4F6`, opcode switch `+0xCE9C`) and the helpers it calls. HARNESS (pass 8): `rules_oracle/make_vectors_pass8.py` runs the real routine in musashi for
 * every opcode on synthetic images and `rules-pass8.test.ts` diffs EVERY changed byte of the A4 image, the RNG state and the hooked-call log.
 *
 * An action record is 8 bytes at A4+0x836 + 8 id: [0] opcode, [2] x, [3] y, [6] value (the other bytes belong to TriggerActionsAt). The executor (arguments: the record id, a byte) reads opcode, x (d3), y (d4),
 * value (d5), runs the handler, then a SECOND, opcode-keyed pass that only plays the "something moved" sound for the wall / pillar / pit / door / glyph opcodes (UI, no state). Unhandled opcodes
 * (0x1B, >= 0x24) do nothing. The party redraw flag A4+0x1748 is set by every handler that changes what the party can see (marked R below).
 *
 *   0x00 / 0x01 / 0x02  spell-failed flag (cell bit 30): toggle / set / clear                                  (no R)
 *   0x03 / 0x04 / 0x05  pillar (structure type 0x17 on the square): toggle word +0xA / set 0 / set 1; becoming 0 crushes the square (crush: below)   R if the structure exists
 *   0x06 / 0x07 / 0x08  pit (type 0x14): toggle / 0 / 1; becoming 0 crushes the square then drops its items (pit drop)         R
 *   0x09 / 0x0A / 0x0B  teleporter (type 0x12) word +0xA: toggle / 0 / 1                                       R
 *   0x0C                structure of type VALUE on the square: word +0xA ^= 2                                  (no R)
 *   0x0D / 0x16         type VALUE: when word +0xA & 2 == 2 then word +0xA -= 2    (switch / plate "on" of the trigger family)
 *   0x0E / 0x17         type VALUE: when byte +0xB bit 1 is clear then word +0xA += 2
 *   0x0F / 0x10 / 0x11  cell bit (0x1000 << VALUE) (the four wall bits are 0x1000..0x8000): toggle / set / clear   R
 *   0x12                spawn monster template column VALUE on the square (spawnMonster), then (success only) the activation scan
 *   0x13                hold the party: word A4+0x1756 += VALUE; redraw flag A4+0x174C in screen modes 1 and 10; A4+0x1E80 = A4+0x1E82 = 0
 *   0x14                drop every living character's two hand items on the square (and the cursor item), R
 *   0x15                teleport the party to (x, y) (facing unchanged); VALUE > 0 then runs the stairs follow-up +0x16C62(VALUE); activation scan
 *   0x18 / 0x19 / 0x1A  door (type 0x11) word +0xE: toggle bit 0 (when it becomes closed the square is crushed) / set bit 0 (open) / clear bit 0 (crush)   R
 *   0x1C / 0x1D         party damage (fire / ice, the same rule): every character with hp > 1 takes 5 + rand16(5 * VALUE) through DamageCharacter(kind 4, flag 1)
 *   0x1E                dungeon ramp = VALUE (A4+0x1E62, palette setter +0x26900) and teleport the party to (x, y), activation scan
 *   0x1F                ramp = VALUE only
 *   0x20 / 0x21 / 0x22  magic field / glyph structure (type 0x10) word +0xA: toggle (becoming 0 crushes) / 0 (crush) / 1           R
 *   0x23                crush the square, R
 * CRUSH (`+0xC41A`, x, y): every MONSTER (word 0 bit 15) on the square is unlinked, its carried chain (word +0xA) and then the primary and the secondary are freed (carried in order, primary, secondary).
 */
import { BcRng } from './rules';
import { A4Mem } from './rules-spell';
import { OBJ, CELL, lookupType, unlinkObj, freeObj, insertObj, adjustWeight, spawnMonster, adjustVitals, occupancy } from './rules-spell9';
import { damageCharacter, linkHead, triggerActions } from './rules-death';
import { stepPos } from './rules-spell';

const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;
const setL = (a: A4Mem, o: number, v: number) => { a.setW(o, (v >>> 16) & 0xffff); a.setW(o + 2, v & 0xffff); };

export interface ExecHooks {
  /** the activation scan `+0xB614` */ scan(): void;
  /** the stairs / teleporter follow-up `+0x16C62(arg)` */ stairs?(arg: number): void;
  /** the equipment-effect recompute `+0x18088 (char, row, slot, 1)` run when a hand item leaves the pack */ equipRemove?(ch: number, row: number, slot: number): void;
  /** the dungeon accent-ramp setter `+0x26900` */ palette?(ramp: number): void;
  /** the monster-spawn visibility / scan flag */
}

/** `+0xC41A`: crush the monsters on a square */
export function crushSquare(a: A4Mem, x: number, y: number): void {
  let id = getL(a, CELL(x, y)) & 0xfff;
  while (id !== 0) {
    const next = a.w(OBJ(id) + 0x12);
    if (a.b(OBJ(id)) & 0x80) {
      const sec = a.w(OBJ(id) + 0x10);
      unlinkObj(a, id, x, y);
      let c = a.w(OBJ(id) + 0xa);
      while (c !== 0) { const n = a.w(OBJ(c) + 0x12); freeObj(a, c); c = n; }
      freeObj(a, id); freeObj(a, sec);
    }
    id = next;
  }
}

/** `+0xC2DA` (structure id, x, y): the pit drop. Items (type nibble 0x90 / 0x30 / 0x60 / 0xC0 of byte +4, gfx word non-zero) on the pit's square move to the pit's destination (words +0xC / +0xE); a party standing on the pit follows. */
export function pitDrop(a: A4Mem, id: number, x: number, y: number, h: ExecHooks): void {
  const dx = a.w(OBJ(id) + 0xc), dy = a.w(OBJ(id) + 0xe);
  let o = getL(a, CELL(x, y)) & 0xfff;
  while (o !== 0) {
    const next = a.w(OBJ(o) + 0x12), t = a.b(OBJ(o) + 4) & 0xf0;
    if ((a.w(OBJ(o)) & 0x7fff) !== 0 && (t === 0x90 || t === 0x30 || t === 0x60 || t === 0xc0)) {
      a.setB(0x1748, 1);
      unlinkObj(a, o, x, y);
      linkHead(a, o, dx, dy);
    }
    o = next;
  }
  if (a.w(0x1742) === x && a.w(0x1740) === y) { a.setW(0x1742, dx); a.setW(0x1740, dy); h.scan(); }
}

/** `+0xC052` (x, y): the "items drop" action */
export function dropHandItems(a: A4Mem, rng: BcRng, x: number, y: number, h: ExecHooks): void {
  const tail = { id: getL(a, CELL(x, y)) & 0xfff };
  while (tail.id !== 0 && a.w(OBJ(tail.id) + 0x12) !== 0) tail.id = a.w(OBJ(tail.id) + 0x12);
  for (let ch = 0; ch < 4; ch++) {
    if (a.sw(0x1758 + 0xa8 * ch + 0x4e) <= 0) continue;
    for (let k = 2; k <= 3; k++) {
      const o = 0x1758 + 0xa8 * ch + 0x16 + 2 * k, item = a.w(o);
      if (item === 0) continue;
      h.equipRemove?.(ch, 0, k);
      a.setW(o, 0);
      adjustWeight(a, 0, 0, item);          // (sic) the game passes the ROW (0), not the character, as the character argument
      insertObj(a, rng, tail, item, x, y);
    }
  }
  const mode = a.w(0x174a);
  if (mode === 1) a.setB(0x174c, 1);
  else if (mode === 2) { a.setB(0x174c, 1); a.setB(0x174d, 1); }
  else if (mode === 4) a.setB(0x174c, 1);
  else if (mode === 10) a.setB(0x1e9e, 1);
  if (a.w(0x1a22) !== 0) { insertObj(a, rng, tail, a.w(0x1a22), x, y); a.setW(0x1a22, 0); }
  a.setB(0x1748, 1);
}

/** `+0x4600`: the party fire / ice damage loop of opcodes 0x1C / 0x1D */
export function partyDamageRaw(a: A4Mem, rng: BcRng, t1: number[], base: number, n: number, kind: number): void {
  const tick = getL(a, 0x1750);
  for (let ch = 0; ch < 4; ch++) {
    if (a.sw(0x1758 + 0xa8 * ch + 0x4e) <= 1) continue;
    const dmg = rng.rand16(n & 0xffff) + base;
    damageCharacter(a, rng, t1, ch, dmg & 0xffff, kind, 1, tick);
  }
}
export function partyDamage(a: A4Mem, rng: BcRng, t1: number[], value: number): void { partyDamageRaw(a, rng, t1, 5, ((value << 24) >> 24) * 5, 4); }

/**
 * GLYPH EFFECT `+0x4662` (the party stepped on a type-0x10 structure whose word +0xC is 3: enter verdict 5), HARNESS (family `glyph`). Redraw flags A4+0x174D / 0x174C / 0x1749 / 0x1748 are cleared. The
 * structure g (type 0x10 on the party square) has a = word +0xE and kind = word +0x10:
 *   kind 1, a != 0    every living character (hp > 1) takes 0xFFFF - the damage word is -1: DamageCharacter's compare is unsigned, so this KILLS the whole party (rand16(0) = 0)
 *   kind 1, a == 0    every character with hp > 1 is reduced to 1 hp (damage = hp - 1, kind 4)
 *   kind 2 or 3       fire / ice: every character with hp > 1 takes 5 + rand16(5 a) (kind 4, flag 1)
 *   kind 4            poison cloud: every character with hp > 1 and byte +0x8B == 0 takes 1 + rand16(10) (kind 5) and its poison counter +0x9A is incremented
 *   kind 0 or >= 5    no effect of its own; the damage loop then runs with the CALLER's d6 / d7 (register garbage in the original: base d6, rand16 bound d7, kind 4). The shipped data never uses it.
 * Then, whatever the kind, the glyph structure is UNLINKED from the square and freed (a glyph fires once) and the UI word A4+0x1A1A = 0.
 */
export function glyphEffect(a: A4Mem, rng: BcRng, t1: number[], regs = { d6: 0, d7: 0 }): void {
  for (const o of [0x174d, 0x174c, 0x1749, 0x1748]) a.setB(o, 0);
  const x = a.w(0x1742), y = a.w(0x1740);
  const g = lookupType(a, x, y, 0x10);
  const av = a.w(OBJ(g) + 0xe), kind = a.w(OBJ(g) + 0x10);
  const tick = getL(a, 0x1750);
  let d5 = 0, d6 = regs.d6, d7 = regs.d7;
  const hp = (ch: number) => a.sw(0x1758 + 0xa8 * ch + 0x4e);
  if (kind === 1) {
    if (av !== 0) { d6 = 0xffff; d7 = 0; }
    else { for (let ch = 0; ch < 4; ch++) if (hp(ch) > 1) damageCharacter(a, rng, t1, ch, (hp(ch) - 1) & 0xffff, 4, 1, tick); d5 = 1; }
  } else if (kind === 2 || kind === 3) { d6 = 5; d7 = (av * 5) & 0xffff; }
  else if (kind === 4) {
    for (let ch = 0; ch < 4; ch++) {
      if (hp(ch) <= 1 || a.b(0x1758 + 0xa8 * ch + 0x8b) !== 0) continue;
      const d4 = rng.rand16(10) + 1;
      a.setB(0x1758 + 0xa8 * ch + 0x9a, a.b(0x1758 + 0xa8 * ch + 0x9a) + 1);
      damageCharacter(a, rng, t1, ch, d4, 5, 1, tick);
    }
    d5 = 1;
  }
  unlinkObj(a, g, x, y); freeObj(a, g); a.setW(0x1a1a, 0);
  if (d5 === 0) partyDamageRaw(a, rng, t1, d6, d7, 4);
}

/**
 * PIT EFFECT `+0x1734A` (the party fell through a pit: enter verdict 2), HARNESS (family `pit`): every character with hp > 0 (signed) and byte +0x8A == 0 (a levitation / feather-fall flag; the
 * 0x8A byte is the character's own) takes 5 + rand16(bound) damage through DamageCharacter (kind 4, flag 1), bound = dex - 10 when dex (signed byte +0x68) > 15, else dex + 5. The redraw flag
 * A4+0x1748 is cleared (before each damage and at the end). The move to the level below is the stairs follow-up, not this routine.
 */
export function pitEffect(a: A4Mem, rng: BcRng, t1: number[]): void {
  const tick = getL(a, 0x1750);
  for (let ch = 0; ch < 4; ch++) {
    const c = 0x1758 + 0xa8 * ch;
    if (a.sw(c + 0x4e) <= 0 || a.b(c + 0x8a) !== 0) continue;
    a.setB(0x1748, 0);
    const dex = a.sb(c + 0x68);
    const bound = dex > 15 ? dex - 10 : dex + 5;
    damageCharacter(a, rng, t1, ch, (rng.rand16(bound & 0xffff) + 5) & 0xffff, 4, 1, tick);
  }
  a.setB(0x1748, 0);
}

export function executeAction(a: A4Mem, rng: BcRng, t1: number[], id: number, h: ExecHooks): void {
  const r = 0x836 + 8 * id;
  const op = a.b(r), x = a.b(r + 2), y = a.b(r + 3), v = a.b(r + 6);
  const cellOf = () => CELL(x, y);
  const flag = () => a.setB(0x1748, 1);
  const word = (o: number, f: (w: number) => number) => a.setW(o, f(a.w(o)) & 0xffff);
  const withType = (type: number, f: (o: number, sid: number) => void) => { const s = lookupType(a, x, y, type); if (s !== 0) f(OBJ(s), s); };
  const bit = (n: number) => (n & 63) >= 32 ? 0 : (0x1000 << (n & 63)) >>> 0;
  switch (op) {
    case 0x00: setL(a, cellOf(), (getL(a, cellOf()) ^ 0x40000000) >>> 0); break;
    case 0x01: setL(a, cellOf(), (getL(a, cellOf()) | 0x40000000) >>> 0); break;
    case 0x02: setL(a, cellOf(), (getL(a, cellOf()) & ~0x40000000) >>> 0); break;
    case 0x03: withType(0x17, o => { word(o + 0xa, w => w ^ 1); if (a.w(o + 0xa) === 0) crushSquare(a, x, y); flag(); }); break;
    case 0x04: withType(0x17, o => { a.setW(o + 0xa, 0); crushSquare(a, x, y); flag(); }); break;
    case 0x05: withType(0x17, o => { a.setW(o + 0xa, 1); flag(); }); break;
    case 0x06: withType(0x14, (o, s) => { word(o + 0xa, w => w ^ 1); if (a.w(o + 0xa) === 0) { crushSquare(a, x, y); pitDrop(a, s, x, y, h); } flag(); }); break;
    case 0x07: withType(0x14, (o, s) => { a.setW(o + 0xa, 0); crushSquare(a, x, y); pitDrop(a, s, x, y, h); flag(); }); break;
    case 0x08: withType(0x14, o => { a.setW(o + 0xa, 1); flag(); }); break;
    case 0x09: withType(0x12, o => { word(o + 0xa, w => w ^ 1); flag(); }); break;
    case 0x0a: withType(0x12, o => { a.setW(o + 0xa, 0); flag(); }); break;
    case 0x0b: withType(0x12, o => { a.setW(o + 0xa, 1); flag(); }); break;
    case 0x0c: withType(v, o => word(o + 0xa, w => w ^ 2)); break;
    case 0x0d: case 0x16: withType(v, o => { if ((a.w(o + 0xa) & 2) === 2) word(o + 0xa, w => w - 2); }); break;
    case 0x0e: case 0x17: withType(v, o => { if ((a.b(o + 0xb) & 2) === 0) word(o + 0xa, w => w + 2); }); break;
    case 0x0f: setL(a, cellOf(), (getL(a, cellOf()) ^ bit(v)) >>> 0); flag(); break;
    case 0x10: setL(a, cellOf(), (getL(a, cellOf()) | bit(v)) >>> 0); flag(); break;
    case 0x11: setL(a, cellOf(), (getL(a, cellOf()) & ~bit(v)) >>> 0); flag(); break;
    case 0x12: if (spawnMonster(a, rng, v, x, y) !== 0) h.scan(); break;
    case 0x13: {
      word(0x1756, w => w + v);
      const m = a.w(0x174a); if (m === 1 || m === 10) a.setB(0x174c, 1);
      a.setW(0x1e80, 0); a.setW(0x1e82, 0); break;
    }
    case 0x14: dropHandItems(a, rng, x, y, h); break;
    case 0x15:
      a.setW(0x1742, x); a.setW(0x1740, y);
      if (v > 0) h.stairs?.(v);
      h.scan(); break;
    case 0x18: withType(0x11, o => { word(o + 0xe, w => w ^ 1); if ((a.b(o + 0xf) & 1) === 0) crushSquare(a, x, y); flag(); }); break;
    case 0x19: withType(0x11, o => { a.setW(o + 0xe, (a.w(o + 0xe) & 0xfe) + 1); flag(); }); break;
    case 0x1a: withType(0x11, o => { a.setW(o + 0xe, a.w(o + 0xe) & 0xfe); crushSquare(a, x, y); flag(); }); break;
    case 0x1c: case 0x1d: partyDamage(a, rng, t1, v); break;
    case 0x1e: h.palette?.(v); a.setW(0x1e62, v); a.setW(0x1742, x); a.setW(0x1740, y); h.scan(); break;
    case 0x1f: a.setW(0x1e62, v); h.palette?.(v); break;
    case 0x20: withType(0x10, o => { word(o + 0xa, w => w ^ 1); if (a.w(o + 0xa) === 0) crushSquare(a, x, y); flag(); }); break;
    case 0x21: withType(0x10, o => { a.setW(o + 0xa, 0); crushSquare(a, x, y); flag(); }); break;
    case 0x22: withType(0x10, o => { a.setW(o + 0xa, 1); flag(); }); break;
    case 0x23: crushSquare(a, x, y); flag(); break;
    default: break;
  }
}


/**
 * THE PARTY'S DOOR CLICK `+0x1110A` (the click that opens or closes the door in front of the party), HARNESS (family `door`). Does nothing while the UI word A4+0x1A18 is 0. On the square in front of
 * the party (stepped by the facing), the LAST door (type 0x11) and the LAST door-trigger structure (type 0x0F) of the chain are used; no door ends it. The trigger structure's word +2 is set to 1
 * for the duration and cleared again at the end (a click lock for the UI). The door's state word +0xE:
 *   0 (closed, unlocked)  AdjustVitals(selected character A4+0x1A24, -2, -1, -1); state = 1 (open); when the trigger structure exists, has word +0xC != 0 and byte +0xF bit 0:
 *                         TriggerActionsAt(front, 0x0F); then the activation scan. (Opening a door is a TRIGGER: it can run action records.)
 *   1 (open)              when ANY monster occupies the doorway (the occupancy mask `+0x8458` of the square is non-zero) the door does not close (the trigger's +2 = 0 and a text) and nothing else
 *                         happens; otherwise AdjustVitals(-2, -1, -1), state = 0, and TriggerActionsAt(front, 0x0F) when the trigger has +0xC != 0 and byte +0xF bit 1 (the close trigger)
 *   anything else         (2 = locked) a text; nothing changes (a locked door is opened only by its lock, `keyUse`)
 * Opening and closing both cost the selected character 2 energy, 1 food and 1 water.
 */
export function doorClick(a: A4Mem, rng: BcRng, t1: number[], h: ExecHooks): void {
  if (a.w(0x1a18) === 0) return;
  const [fx, fy] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  let d4 = 0, d3 = 0, id = getL(a, CELL(fx, fy)) & 0xfff;
  while (id !== 0) {
    const t = a.b(OBJ(id) + 5);
    if (t === 0x11) d4 = id; else if (t === 0x0f) d3 = id;
    id = a.w(OBJ(id) + 0x12);
  }
  if (d4 === 0) return;
  if (d3 !== 0) a.setW(OBJ(d3) + 2, 1);
  const door = OBJ(d4), exec = (rid: number) => executeAction(a, rng, t1, rid, h);
  const tick = getL(a, 0x1750);
  const trig = (bit: number) => { if (d3 !== 0 && a.w(OBJ(d3) + 0xc) !== 0 && (a.b(OBJ(d3) + 0xf) & bit) !== 0) triggerActions(a, fx, fy, 0x0f, tick, exec); };
  const e = a.w(door + 0xe);
  if (e === 0) {
    adjustVitals(a, t1, a.w(0x1a24), -2, -1, -1);
    a.setW(door + 0xe, 1);
    trig(1);
    h.scan();
  } else if (e === 1) {
    if (occupancy(a, fx, fy, 0) !== 0) { if (d3 !== 0) a.setW(OBJ(d3) + 2, 0); return; }
    adjustVitals(a, t1, a.w(0x1a24), -2, -1, -1);
    a.setW(door + 0xe, 0);
    trig(2);
  }
  if (d3 !== 0) a.setW(OBJ(d3) + 2, 0);
}

/**
 * KEY ON A LOCK `+0x16AA8`, HARNESS (family `key`). Needs a cursor item (A4+0x1A22) of item type 6 (a KEY). The lock is the structure of type 0x22 on the square in front. The key opens it only when
 * its word +0xC equals the lock's word +0xC (the key id) and the lock's word +0xE (the number of keys still needed) is not 0; otherwise a text and nothing changes (the key is NOT lost). On a fit: the lock's
 * +0xE is decremented, the key object is FREED and the cursor cleared (keys are consumed). When the lock's count reaches 0 the FIRST door (type 0x11) of the front square gets state 0 (unlocked, closed;
 * with no door on the square object 0 is written, a game quirk the sim ignores) and the door click `+0x1110A` runs at once (so the door also opens); otherwise (more keys needed) the selected
 * character pays AdjustVitals(-2, -1, -1).
 */
export function keyUse(a: A4Mem, rng: BcRng, t1: number[], h: ExecHooks): void {
  const cur = a.w(0x1a22);
  if (cur === 0 || a.b(OBJ(cur) + 5) !== 6) return;
  const [fx, fy] = stepPos(a.w(0x1742), a.w(0x1740), a.w(0x1744));
  const lock = lookupType(a, fx, fy, 0x22);
  if (lock === 0) return;
  if (a.w(OBJ(lock) + 0xc) !== a.w(OBJ(cur) + 0xc) || a.w(OBJ(lock) + 0xe) === 0) return;
  a.setW(OBJ(lock) + 0xe, a.w(OBJ(lock) + 0xe) - 1);
  freeObj(a, cur); a.setW(0x1a22, 0);
  if (a.w(OBJ(lock) + 0xe) === 0) {
    let d = getL(a, CELL(fx, fy)) & 0xfff;
    while (d !== 0 && a.b(OBJ(d) + 5) !== 0x11) d = a.w(OBJ(d) + 0x12);
    a.setW(OBJ(d) + 0xe, 0);
    doorClick(a, rng, t1, h);
  } else adjustVitals(a, t1, a.w(0x1a24), -2, -1, -1);
}
