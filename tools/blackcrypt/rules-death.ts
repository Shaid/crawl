/**
 * Black Crypt (Amiga): MONSTER DEATH with its loot drop (`+0x7ED0`) and DamageCharacter (`+0x17686`) on the A4 object memory. HARNESS (pass 7): `rules_oracle/make_vectors_pass7.py` families
 * `death` and `dmg` run the real routines (musashi) on synthetic images and `rules-pass7.test.ts` diffs EVERY changed byte, the RNG state and the hooked calls.
 */
import { BcRng } from './rules';
import { A4Mem } from './rules-spell';
import { OBJ, CELL, QN, allocObj, freeObj, unlinkObj, insertObj, adjustVitals, scheduleEvent, cancelEvent } from './rules-spell9';

const CHAR = (k: number) => 0x1758 + 0xa8 * k;
const getL = (a: A4Mem, o: number) => ((a.w(o) << 16) | a.w(o + 2)) >>> 0;

/** the last object id of the chain on (x, y) (0 when the square is empty) */
export function chainTail(a: A4Mem, x: number, y: number): number {
  let id = getL(a, CELL(x, y)) & 0xfff;
  while (id !== 0 && a.w(OBJ(id) + 0x12) !== 0) id = a.w(OBJ(id) + 0x12);
  return id;
}
/** +0xB25A (id): every queued event whose word +0xA equals `id` (monster events carry the monster id there) is removed, the others keep their order; nodes go to the free list */
export function cancelEventsFor(a: A4Mem, id: number): void {
  let cur = a.b(0x173f);
  while (cur !== 0x96) { const next = a.b(QN(cur) + 9); if (a.w(QN(cur) + 0xa) === id) cancelEvent(a, cur); cur = next; }
}
/** behaviour types whose script starts with op 0x15 (death script): value = the script pc the monster restarts at (word at script + 4). Read from the S_2 script table: only type 5 (pc 10). HARNESS (types 0..11). */
export const DEATH_SCRIPT_PC: Record<number, number> = { 5: 10 };

export interface DeathResult { dead: boolean; held?: string; xp: number[]; levelUps: number[]; scan: boolean }
/**
 * MonsterDeath (+0x7ED0), HARNESS. `P` = primary record id, `(x, y)` its square. Order of effects:
 *  1. gfx 0x80C5 (the Ram boss) with hp < 50: A4+0x1A1E = 1 if it was 0 and hp is held at 49 (so it never dies by hp alone);
 *  2. hp >= 1 (signed): nothing else happens;
 *  3. behaviour type (word +0xE) 5: the script starts with op 0x15: the secondary's pc word +4 = 10 and the monster does NOT die (hp stays < 1);
 *  4. the primary is unlinked from the square; its carried chain (word +0xA) is inserted one object at a time at the END of the square's chain (the InsertObj rule: one rand16(4) draw each,
 *     in chain order); then the secondary and the primary go back on the object free list (secondary first); every queued event whose word +0xA is the primary id is cancelled; the
 *     activation scan `+0xB614` runs (the caller); then every living character gets xp += rand16(secondary maxHp) + rand16(primary byte +2) + secondary word +6 (two draws per
 *     character, slot order), followed by the level-up check (the caller).
 */
export function monsterDeath(a: A4Mem, rng: BcRng, P: number, x: number, y: number): DeathResult {
  const res: DeathResult = { dead: false, xp: [], levelUps: [], scan: false };
  const S = a.w(OBJ(P) + 0x10), w0 = a.w(OBJ(P));
  if (w0 === 0x80c5 && a.sw(OBJ(P) + 8) < 0x32) { if (a.w(0x1a1e) === 0) a.setW(0x1a1e, 1); a.setW(OBJ(P) + 8, 0x31); }
  if (a.sw(OBJ(P) + 8) >= 1) return res;
  const pc = DEATH_SCRIPT_PC[a.w(OBJ(P) + 0xe)];
  if (pc !== undefined) { a.setW(OBJ(S) + 4, pc); res.held = 'death script'; return res; }
  unlinkObj(a, P, x, y);
  let d2 = a.w(OBJ(P) + 0xa);
  const tail = { id: chainTail(a, x, y) };
  while (d2 !== 0) { const next = a.w(OBJ(d2) + 0x12); insertObj(a, rng, tail, d2, x, y); d2 = next; }
  freeObj(a, S); freeObj(a, P);
  cancelEventsFor(a, P);
  res.scan = true; res.dead = true;
  for (let k = 0; k < 4; k++) {
    if (a.sw(CHAR(k) + 0x4e) <= 0) { res.xp.push(getL(a, CHAR(k) + 0xa0)); continue; }
    const r1 = rng.rand16(a.w(OBJ(S) + 8)), r2 = rng.rand16(a.b(OBJ(P) + 2));
    const gain = (r1 + r2 + a.w(OBJ(S) + 6)) & 0xffff;
    const xp = (getL(a, CHAR(k) + 0xa0) + gain) >>> 0;
    a.setW(CHAR(k) + 0xa0, xp >>> 16); a.setW(CHAR(k) + 0xa2, xp & 0xffff);
    res.xp.push(xp); res.levelUps.push(k);
  }
  return res;
}

export interface DamageResult { died: boolean; gameOver: boolean }
/**
 * DamageCharacter (+0x17686), HARNESS. `dmg` is compared UNSIGNED against the signed word hp. A character whose invulnerability byte +0x8C is set takes nothing (and nothing else happens).
 * Otherwise AdjustVitals(ch, -3, -2, -3) always runs first.
 *  survive (dmg < hp): hp -= dmg; byte +0x61 = kind, word +0x5C = dmg, byte +0x60 += 1; events 0x0A at tick + 2 (all args 0) and 0x16 at tick + 5 (a1 = character) are scheduled
 *    (0x16 later clears +0x61 / +0x5C and counts +0x60 down, see rules-pop.ts).
 *  death (dmg >= hp): hp = 0; the square tail is found; carried weight (+0xA4 long) = 0; +0x44 = 0xFF; word A4+0x1E2A -= byte +0x85, word A4+0x1E2C -= byte +0x84 (the character's share of the
 *    Wizard-Sight / detect-trap counters); all 18 pack words (+0x16 + 12 row + 2 col) and 5 equipment words (+0x3A + 2 k) that are non-zero are cleared and dropped on the party square in
 *    that order (InsertObj, one draw each); when `flag` is set a CORPSE object (type 0x26, gfx word 0x0C, word +0xC = the character index, word +2 = 0x8000) is allocated and dropped last (+0x175C4);
 *    redraw flag A4+0x1748; the selected-character word A4+0x1A24 (if it was this one) becomes 4 and then the first living slot of the formation A4+0x1E74 (scanning 3 down to 0);
 *    the active-character word A4+0x1A14 (if this one) becomes 0 and then the HIGHEST-index living character (scanning 1..3); screen-mode redraw flags (modes 1 / 10 also set A4+0x1E9E); if nobody is alive A4+0x1E88 = 2
 *    (game over); finally every queued event of type 0x1E / 0x1F / 0x14 / 0x15 / 0x16 / 0x25 whose a1 is this character is cancelled.
 */
export function damageCharacter(a: A4Mem, rng: BcRng, t1: number[], ch: number, dmg: number, kind: number, flag: number, tick: number): DamageResult {
  const c = CHAR(ch), mode = a.w(0x174a);
  const res = { died: false, gameOver: false };
  if (a.b(c + 0x8c) !== 0) return res;
  adjustVitals(a, t1, ch, 0xfffd, 0xfffe, 0xfffd);
  if (dmg >= a.w(c + 0x4e)) {
    res.died = true;
    a.setW(c + 0x4e, 0);
    const px = a.w(0x1742), py = a.w(0x1740);
    const tail = { id: chainTail(a, px, py) };
    a.setW(c + 0xa4, 0); a.setW(c + 0xa6, 0); a.setB(c + 0x44, 0xff);
    a.setW(0x1e2a, a.w(0x1e2a) - a.b(c + 0x85)); a.setW(0x1e2c, a.w(0x1e2c) - a.b(c + 0x84));
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
      const o = c + 0x16 + 12 * r + 2 * k, id = a.w(o);
      if (id !== 0) { a.setW(o, 0); insertObj(a, rng, tail, id, px, py); }
    }
    for (let k = 0; k < 5; k++) {
      const o = c + 0x3a + 2 * k, id = a.w(o);
      if (id !== 0) { a.setW(o, 0); insertObj(a, rng, tail, id, px, py); }
    }
    if (flag !== 0) {
      const id = allocObj(a);
      a.setB(OBJ(id) + 4, 0); a.setB(OBJ(id) + 5, 0x26); a.setW(OBJ(id) + 0xc, ch); a.setW(OBJ(id), 0xc);
      a.setW(OBJ(id) + 0x12, 0); a.setW(OBJ(id) + 0xa, 0); a.setW(OBJ(id) + 8, 0); a.setW(OBJ(id) + 2, 0x8000);
      insertObj(a, rng, tail, id, px, py);
    }
    a.setB(0x1748, 1);
    if (a.w(0x1a24) === ch) {
      a.setW(0x1a24, 4);
      for (let d = 3; d >= 0; d--) { const w = a.w(0x1e74 + 2 * d); if (a.sw(CHAR(w) + 0x4e) > 0) a.setW(0x1a24, w); }
    }
    let lead = false;
    if (a.w(0x1a14) === ch) {
      lead = true; a.setW(0x1a14, 0);
      for (let d = 1; d <= 3; d++) if (a.sw(CHAR(d) + 0x4e) > 0) a.setW(0x1a14, d);
    }
    if (mode === 1 || mode === 10) { a.setB(0x174d, 1); a.setB(0x174c, 1); a.setB(0x1e9e, 1); }
    else if (a.w(0x1a16) === ch || (lead && mode === 3)) { /* redraw of the viewed character: no flag */ }
    else if (mode === 2 || mode === 4 || mode === 3) a.setB(0x174d, 1);
    let alive = 0; for (let d = 0; d < 4; d++) if (a.sw(CHAR(d) + 0x4e) > 0) alive++;
    if (alive === 0) { a.setW(0x1e88, 2); res.gameOver = true; }
    let n = a.b(0x173f);
    while (n !== 0x96) {
      const next = a.b(QN(n) + 9), t = a.b(QN(n) + 4);
      if ((t === 0x1e || t === 0x1f || t === 0x14 || t === 0x15 || t === 0x16 || t === 0x25) && a.b(QN(n) + 5) === (ch & 0xff)) cancelEvent(a, n);
      n = next;
    }
    return res;
  }
  a.setW(c + 0x4e, a.w(c + 0x4e) - dmg);
  a.setB(c + 0x61, kind); a.setW(c + 0x5c, dmg); a.setB(c + 0x60, a.b(c + 0x60) + 1);
  scheduleEvent(a, 0x0a, (tick + 2) >>> 0, 0, 0, 0, 0, 0);
  scheduleEvent(a, 0x16, (tick + 5) >>> 0, ch, 0, 0, 0, 0);
  if (mode === 1 || mode === 10) a.setB(0x174c, 1);
  else if ((mode === 2 || mode === 4) && a.w(0x1a16) === ch && a.b(0x1a26) === 0) a.setB(0x174d, 1);
  else if (mode === 3 && a.w(0x1a14) === ch) a.setB(0x174d, 1);
  return res;
}

/** +0x74 (id, x, y): link the object at the HEAD of the square's chain: its next word = the old head id, the cell's low 12 bits = id (the flag bits stay) */
export function linkHead(a: A4Mem, id: number, x: number, y: number): void {
  const cell = getL(a, CELL(x, y));
  a.setW(OBJ(id) + 0x12, cell & 0xfff);
  const v = ((cell & 0xfffff000) + id) >>> 0;
  a.setW(CELL(x, y), v >>> 16); a.setW(CELL(x, y) + 2, v & 0xffff);
}
/**
 * Behaviour-VM op 0x0A TELEPORT (handler `+0xADA2`), HARNESS. The monster (primary `P`, secondary `S`) leaves the square (ox, oy) (unlink `+0xFE`: the object's own next word is left alone), is
 * linked at the HEAD of (x = cell byte a, y = cell word w1) (`+0x74`), and the secondary's distance byte +0xE becomes |partyX - y| + |partyY - y| (the code subtracts y from BOTH axes) as a
 * byte. The VM pc advances by one. The visibility helper `+0x8388` (UI) runs before and after each step and, when it leaves the redraw flag A4+0x1748 set, the flag is cleared. No check
 * is made that the target square is free or inside the map: a script's own coordinates are trusted.
 */
export function vmTeleport(a: A4Mem, P: number, S: number, ox: number, oy: number, x: number, y: number): void {
  unlinkObj(a, P, ox, oy);
  if (a.b(0x1748) !== 0) a.setB(0x1748, 0);
  linkHead(a, P, x, y);
  if (a.b(0x1748) !== 0) a.setB(0x1748, 0);
  const px = a.w(0x1742), py = a.w(0x1740);
  const s16 = (v: number) => (v << 16) >> 16;
  a.setB(OBJ(S) + 0xe, Math.abs(s16(px - y)) + Math.abs(s16(py - y)));
}

export interface EnterResult { code: number; x: number; y: number; facing: number }
/**
 * The PARTY square-enter test (`+0x27BAA`), HARNESS. Walks the chain of the square; the first object with a verdict ends the walk. `msgDone` is the UI word A4+0x1998 (1 while no message is
 * being printed; stairs and teleporters refuse to fire, code 1, until the text is finished). Verdicts, by object:
 *   monster (word 0 bit 15)          8
 *   door 0x11                        pass when byte +0xF bit 0 is set (open), else 1
 *   stairs 0x14 / teleporter 0x12    pass when word +0xA != 0; else 1 until `msgDone`; stairs also pass when word +0x10 == 1; otherwise the party is RELOCATED: unless +0x10 == 4 the
 *                                    position becomes (word +0xC, word +0xE), the facing becomes (word +8 + facing) & 3; the verdict is 2 (stairs), else 3 (+0x10 == 2 or 3), 4 (+0x10 == 4), 9
 *   0x17, 0x1F                       1 (0x17 only while word +0xA == 0; 0x1F always)
 *   structure 0x10 (+0xA == 0)       word +0xC == 3: 5, == 2: 7, else pass (a plain field / wall of kind 1 does not stop the party here)
 *   trap 0x1E (+0xA == 0)            6;   0x2F (+0xA == 0) 1
 * An object with word +0xA != 0 (a timer running or an already-sprung structure) is passed over for 0x14 / 0x12 / 0x17 / 0x10 / 0x1E / 0x2F.
 */
export function enterParty(a: A4Mem, x: number, y: number, facing: number, msgDone: boolean): EnterResult {
  let code = 0, id = getL(a, CELL(x, y)) & 0xfff;
  let rx = x, ry = y, rf = facing;
  while (id !== 0 && code === 0) {
    const o = OBJ(id);
    if (a.w(o) & 0x8000) { code = 8; }
    else {
      const t = a.b(o + 5), inert = a.w(o + 0xa) !== 0;
      if (t === 0x11) { if ((a.b(o + 0xf) & 1) === 0) code = 1; }
      else if (t === 0x14 || t === 0x12) {
        if (!inert) {
          if (!msgDone) code = 1;
          else if (!(t === 0x14 && a.w(o + 0x10) === 1)) {
            if (a.w(o + 0x10) !== 4) { rx = a.w(o + 0xc); ry = a.w(o + 0xe); }
            rf = (a.w(o + 8) + rf) & 3;
            code = t === 0x14 ? 2 : a.w(o + 0x10) === 2 || a.w(o + 0x10) === 3 ? 3 : a.w(o + 0x10) === 4 ? 4 : 9;
            if (t === 0x14) code = 2;
          }
        }
      } else if (t === 0x17) { if (!inert) code = 1; }
      else if (t === 0x10) { if (!inert) { if (a.w(o + 0xc) === 3) code = 5; else if (a.w(o + 0xc) === 2) code = 7; } }
      else if (t === 0x1e) { if (!inert) code = 6; }
      else if (t === 0x1f) code = 1;
      else if (t === 0x2f) { if (!inert) code = 1; }
    }
    id = a.w(o + 0x12);
  }
  return { code, x: rx, y: ry, facing: rf };
}
