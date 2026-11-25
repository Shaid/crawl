/**
 * Wizardry 6 (Amiga) encounter start LAB_0A31 (`Bane` CODE+0x17fde) and the routines it composes: group clear
 * LAB_0984 (CODE+0x15e12), dice LAB_0987 (CODE+0x15e8a), add-group LAB_099B (CODE+0x15ff0, with its companion chain),
 * party-to-combat conversion LAB_09A9 (CODE+0x16364) and the evasion check LAB_09D0 (CODE+0x16d58). Ported from the
 * 68k and diffed against the game running the whole routine under Unicorn (oracle/combat3.py encounter ->
 * oracle/encounter-vectors.json, __tests__/encounter.test.ts).
 *
 * The monster record loader (LoadRecord, CODE+0x9fc, section 4 of scenario.dbs: 250 x 222 bytes), the formation slot
 * picker LAB_098A and the monster picture loaders LAB_097E / LAB_0979 are I/O or presentation: the port calls them
 * through {@link EncounterIO}; the harness feeds it the exact bytes and results the game produced.
 *
 * Group layout written here (group trailer, offsets from the member array): +410 monster id (low byte), +411 formation
 * slot, +412 identified flag (selects which of the record's name strings is shown; the check LAB_09D0 clears it, see game-rules section 10.6), +413 member count. Companion rule (exact in effect, meaning
 * **hyp**): group g gets a companion group only while g < min(5, (level+1)/2 + 1 (+1 for a scripted fight)); two
 * candidates are tried in order, record byte +164+k (monster id) with percent chance +166+k, k = 0, 1.
 */
import { skillUse, s16 } from './combat.ts';
import { type Ctx, grpBase, recBase, member } from './planner.ts';

export interface EncounterIO {
  /** LoadRecord(section 4, dest, id): write the 222-byte monster record at `dest` (through c.m). */
  loadMonster(id: number, dest: number): void;
  /** LAB_098A: formation slot for the picture set `a` (record byte +209); returns the slot. */
  formation(a: number): number;
  /** LAB_0979: load the monster picture `a` (record byte +210). */
  picture(a: number): void;
}

const pr = (c: Ctx, i: number): number => c.a4 - 17922 + i * 0x1b0;

/** LAB_0987: base + n x (Random(sides) + 1), a 16-bit sum. */
export function diceSum(c: Ctx, base: number, n: number, sides: number): number {
  let x = s16(base);
  for (; n > 0; n--) x = s16(x + c.rng.random(sides) + 1);
  return x;
}

/** LAB_0984: clear the formation grid, every group's member array, every count, and the group count / flee state. */
export function clearGroups(c: Ctx): void {
  const { m, a4 } = c;
  for (let k = 0; k < 20; k++) m.w8(a4 - 15160 + k, 0);
  for (let g = 0; g < 7; g++) for (let k = 0; k < 0x1a0; k++) m.w8(grpBase(c, g) + k, 0);
  for (let g = 0; g < 7; g++) m.w8(grpBase(c, g) + 413, 0);
  m.w16(a4 - 15140, 0); m.w16(a4 - 15130, 0); m.w16(a4 - 15132, 0xfffe);
}

/** LAB_099B: add monster group `g` of monster `id`, then maybe a companion group g+1 (recursively). */
export function addGroup(c: Ctx, io: EncounterIO, id: number, g: number): void {
  const { m, rng, a4 } = c;
  m.w16(a4 - 15140, m.u16(a4 - 15140) + 1);
  const R = recBase(c, g), G = grpBase(c, g);
  io.loadMonster(id & 0xffff, R);
  m.w8(G + 410, id & 0xff);
  m.w8(G + 411, io.formation(m.u8(R + 209)));
  if (g === 1) {
    if (m.u8(R + 210) > 0) io.picture(m.u8(R + 210));
    else m.w16(a4 - 15098, 0xffff);
  }
  m.w8(G + 413, diceSum(c, m.u16(R + 0x74), m.u8(R + 0x76), m.u8(R + 0x77)));
  m.w8(G + 412, 1);
  for (let k = 0; k < 6; k++) m.w8(G + 396 + k, 0);
  for (let k = 0; k < 4; k++) m.w8(G + 402 + k, 0);
  for (let i = 0; i < m.u8(G + 413); i++) {
    const A = member(c, g, i);
    m.w16(A, m.u8(R + 122));
    m.w16(A + 4, diceSum(c, m.u16(R + 0x78), m.u8(R + 0x7a), m.u8(R + 0x7b)));
    m.w16(A + 2, m.u16(A + 4));
    m.w16(A + 8, diceSum(c, m.u16(R + 0x7c), m.u8(R + 0x7e), m.u8(R + 0x7f)));
    m.w16(A + 6, m.u16(A + 8));
    m.w8(A + 42, 0xff);
  }
  let d4 = Math.trunc((s16(m.u16(a4 - 18340)) + 1) / 2) + 1;
  if (s16(m.u16(a4 - 15100)) > 0) d4++;
  if (d4 >= 5) d4 = 5;
  if (g < d4) {
    let cand = -1;
    let k = 0;
    do {
      if (m.u8(R + k + 166) > 0 && rng.random(100) < m.u8(R + k + 166)) cand = m.u8(R + k + 164);
      k++;
    } while (k < 2 && cand === -1);
    if (cand !== -1) addGroup(c, io, cand, g + 1);
  }
}

/** LAB_09A9: group 0 from the party records: counts, buffs carried over, and each member's combat struct. */
export function buildParty(c: Ctx): void {
  const { m, a4 } = c;
  const G = grpBase(c, 0);
  m.w8(G + 413, m.u8(a4 - 15305));
  for (let k = 0; k < 6; k++) m.w8(G + 396 + k, 0);
  if (s16(m.u16(a4 - 18122)) > 0) m.w8(G + 400, m.u8(a4 - 18119));
  for (let k = 0; k < 4; k++) m.w8(G + 402 + k, 0);
  for (let i = 0; i < s16(m.u16(a4 - 15306)); i++) {
    const P = pr(c, i), A = member(c, 0, i);
    m.w16(A, m.u16(P + 36));
    m.w16(A + 4, m.u16(P + 26));
    m.w16(A + 2, m.u16(P + 24));
    m.w16(A + 8, m.u16(P + 30));
    m.w16(A + 6, m.u16(P + 28));
    m.w8(A + 34, m.u8(P + 417));
    for (let k = 0; k < 10; k++) m.w8(A + 14 + k, m.u8(P + 290 + k));
    m.w8(A + 35, m.u8(P + 420));
    m.w8(A + 42, 0xff);
  }
}

/**
 * LAB_09D0: for every identified group and party member roll Random(100); the group stays unidentified (flag +412 cleared,
 * skill 23 trains with multiplier 0) if the roll is below `skill23 - 3 x level` (compared as an unsigned word, so a
 * negative difference always evades) or below attribute 1 (record +301).
 */
export function evade(c: Ctx): void {
  const { m, rng, a4 } = c;
  for (let g = 1; g <= s16(m.u16(a4 - 15140)); g++) {
    for (let p = 0; p < s16(m.u16(a4 - 15306)); p++) {
      const r = rng.random(100);
      if (m.u8(grpBase(c, g) + 412) !== 1) continue;
      const d1 = s16(m.u8(pr(c, p) + 331) - s16(m.u16(a4 - 18340)) * 3) & 0xffff;
      if (r < d1 || r < m.u8(pr(c, p) + 301)) {
        m.w8(grpBase(c, g) + 412, 0);
        skillUse(m, rng, a4, p, 23, 0);
      }
    }
  }
}

/** LAB_0A31: start the encounter for monster id `-15102(A4)` (set by the map event). */
export function startEncounter(c: Ctx, io: EncounterIO): void {
  const { m, a4 } = c;
  m.w32(a4 - 15300, 0);
  const id = s16(m.u16(a4 - 15102));
  if (id === 0x80 || id === 0x97 || id === 0x99) m.w16(a4 - 15128, 1);
  clearGroups(c);
  addGroup(c, io, s16(m.u16(a4 - 15102)), 1);
  m.w16(a4 - 15296, m.u8(recBase(c, 1) + s16(m.u16(a4 - 15100)) + 162));
  evade(c);
  buildParty(c);
}

/**
 * LAB_0EEE (CODE+0x24940): summon. `ids` are six candidate monster ids, `n` the spell power. Party side (caster
 * group 0 or 6): the single ally group 6, refused while it has members. Monster side: a new group (max five), refused
 * when n <= 0. A run counter picks the candidate: `cnt` starts at 1 and grows while `n` (decremented each step) stays
 * above 0 and Random(3) is 0, at most to 3; the candidate is ids[n after the loop] (ids[0] when n >= 6). The record's
 * count dice are overridden to (cnt - 1) + cnt x d(sides); the count is clamped 1..9, the new members start with
 * action 10 and the group is not engaged (+412 = 0).
 */
export function summon(c: Ctx, io: EncounterIO, ids: number[], n: number): void {
  const { m, rng, a4 } = c;
  m.w16(a4 - 10480, 0);
  const ag = s16(m.u16(a4 - 15138));
  let g: number;
  if (ag === 0 || ag === 6) {
    g = 6;
    if (m.u8(grpBase(c, 6) + 413) > 0) return;
  } else if (n > 0 && s16(m.u16(a4 - 15140)) < 5) {
    m.w16(a4 - 15140, m.u16(a4 - 15140) + 1);
    g = s16(m.u16(a4 - 15140));
  } else return;
  const G = grpBase(c, g), R = recBase(c, g);
  for (let k = 0; k < 0x1a0; k++) m.w8(G + k, 0);
  let cnt = 0;
  for (;;) {
    cnt++;
    n = s16(n - 1);
    if (n <= 0) break;
    if (rng.random(3) !== 0) break;
    if (cnt >= 3) break;
  }
  const pick = n >= 0 && n < 6 ? ids[n] : ids[0];
  io.loadMonster(pick & 0xffff, R);
  m.w8(G + 410, pick & 0xff);
  m.w8(R + 118, cnt);
  m.w16(R + 116, cnt - 1);
  m.w8(G + 413, diceSum(c, m.u16(R + 0x74), m.u8(R + 0x76), m.u8(R + 0x77)));
  if (m.u8(G + 413) < 1) m.w8(G + 413, 1);
  if (m.u8(G + 413) > 9) m.w8(G + 413, 9);
  for (let k = 0; k < 6; k++) m.w8(G + 396 + k, 0);
  for (let k = 0; k < 4; k++) m.w8(G + 402 + k, 0);
  m.w8(G + 412, 0);
  for (let i = 0; i < m.u8(G + 413); i++) {
    const A = member(c, g, i);
    m.w16(A, m.u8(R + 122));
    m.w16(A + 4, diceSum(c, m.u16(R + 0x78), m.u8(R + 0x7a), m.u8(R + 0x7b)));
    m.w16(A + 2, m.u16(A + 4));
    m.w16(A + 8, diceSum(c, m.u16(R + 0x7c), m.u8(R + 0x7e), m.u8(R + 0x7f)));
    m.w16(A + 6, m.u16(A + 8));
    m.w8(A + 42, 0xff);
    m.w8(A + 30, 10);
    m.w8(A + 33, 0);
    m.w8(A + 24, 0);
  }
}
