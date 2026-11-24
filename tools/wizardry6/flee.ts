/**
 * Wizardry 6 (Amiga) hide LAB_0FC5 (`Bane` CODE+0x282aa) and run LAB_0FD2 (CODE+0x2846c), the two round actions
 * the executor (round.ts) hands off. Ported from the 68k and diffed against the game with only the message
 * printing stubbed (oracle/combat3.py flee -> oracle/flee-vectors.json, __tests__/flee.test.ts).
 *
 * Member byte +0x2b (43) is the **hidden / fled flag**: hide sets it to 1 (the attack resolver reads 1 as the
 * surprise-attack bonus and the retargeting treats a non-zero member as untargetable), run sets it to 2 (the
 * end-of-round check LAB_0A03 reads any 2 in the party as "the party fled", game state 0x17).
 */
import { s16, skillUse, type Mem } from './combat.ts';
import { type Ctx, member, recBase, grpBase } from './planner.ts';

const pr = (c: Ctx, i: number): number => c.a4 - 17922 + i * 0x1b0;

/** The success chance of a hide, before the roll: party member (g 0) vs monster. */
export function hideChance(c: Ctx, A: number): number {
  const { m, a4 } = c;
  const g = s16(m.u16(a4 - 15138)), i = s16(m.u16(a4 - 15136));
  if (g === 0) {
    const ng = s16(m.u16(a4 - 15140));
    let t = s16(m.u16(pr(c, i) + 36) + m.u8(pr(c, i) + 324) + 50);
    for (let q = 1; q <= ng; q++) t = s16(t - (m.u8(grpBase(c, q) + 413) + m.u8(recBase(c, q) + 122) + m.u8(recBase(c, q) + 135)));
    return t;
  }
  let t = s16(m.u16(A) * 5 + 50);
  const n = Math.min(3, s16(m.u16(a4 - 15306)));
  for (let k = 0; k < n; k++) t = s16(t - (m.u16(pr(c, k) + 36) + m.u8(pr(c, k) + 301)));
  return t;
}

/** LAB_0FC5: roll Random(100) < chance: member hidden (flag 1) and the HIDE skill (16) trains. */
export function hide(c: Ctx, A: number): boolean {
  const { m, rng, a4 } = c;
  const t = hideChance(c, A);
  if (rng.random(100) < t) {
    m.w8(A + 43, 1);
    skillUse(m, rng, a4, s16(m.u16(a4 - 15136)), 16, 1);
    return true;
  }
  return false;
}

/** The success chance of a run: member strength + 90 minus the monsters' presence; zero when the fight cannot be fled (-15128 == 1). */
export function runChance(c: Ctx, A: number): number {
  const { m, a4 } = c;
  const ag = s16(m.u16(a4 - 15138));
  const ng = s16(m.u16(a4 - 15140));
  let t = s16(m.u16(A) + 90);
  for (let q = 1; q <= ng; q++) {
    t = s16(t - (m.u8(recBase(c, q) + 122) * m.u8(grpBase(c, q) + 413)));
    t = s16(t - 2 * (m.u8(recBase(c, q) + 137) - m.u8(recBase(c, ag) + 137)));
  }
  if (s16(m.u16(a4 - 15128)) === 1) t = 0;
  return t;
}

/** LAB_0FD2: Random(100) < chance: the member flees (flag 2). */
export function run(c: Ctx, A: number): boolean {
  const { m, rng } = c;
  const t = runChance(c, A);
  if (rng.random(100) < t) { m.w8(A + 43, 2); return true; }
  return false;
}

export type { Mem };
void member;
