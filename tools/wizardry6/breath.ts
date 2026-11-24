/**
 * Wizardry 6 (Amiga) breath attack LAB_0FB1 (`Bane` CODE+0x27b26): the monster action 8. Ported from the 68k and
 * diffed against the game with the area engines running for real (oracle/combat3.py breath ->
 * oracle/breath-vectors.json, __tests__/breath.test.ts). The member word `A+10` is the breath type (record byte
 * +216): 0 none, 1..12 below. Returns the stamina cost the executor charges (`Random(n) + staminaMax / d`).
 *
 * Strength `K`: count the doublings of 25 (25, 50, ... 800) that the breather's HP word `A+2` exceeds (1 + count),
 * then `K = clamp(1, 6, (K x stamina) / staminaMax + 1)`; the damage mod is `4K`. Every type hits the target group
 * `A+31` as an area (min(K, size) members, the `-K` target word of the engines). Types 10, 11 and 12 are blocked
 * while the breather is silenced (`A+14 > 0`).
 *
 *  type  engine        what                                 resist  cost
 *   1    area damage   2d5 x K                              1       Random(4) + max/6
 *   2    area damage   2d5 x K                              7       Random(2) + max/20
 *   3    area damage   3d4 x K                              3       Random(4) + max/6
 *   4    area status   slot 3, 2K d1                        4       Random(4) + max/10
 *   5    area status 2 damage 1d6x(8)K, slot 8 (poison?)    5       Random(4) + max/6
 *   6    area status 2 damage 1d5x(5)K, slot 2              6       Random(3) + max/8
 *   7    area status   slot 6, fixed 5s (a gaze)            13      Random(2) + max/20
 *   8    area damage   1d7 x K                              8       Random(6) + max/4
 *   9    area status   slot 2 sleep-like                    9       Random(3) + max/10
 *  10    area damage   2d4 x K                              10      Random(4) + max/10  (silence-gated)
 *  11    area status   slot 1 kill (state 1?)               10      Random(3) + max/8   (silence-gated)
 *  12    area status 2 damage + slot 2                      10      Random(4) + max/10  (silence-gated)
 * (the element names are **hyp**; the numbers are exact.)
 */
import { s16, type Effect } from './combat.ts';
import { areaDamage, areaStatus, areaStatus2 } from './engines.ts';
import type { Ctx } from './planner.ts';

const tdiv = (a: number, b: number): number => Math.trunc(a / b);

export function breath(c: Ctx, A: number, fx: Effect[]): number {
  const { m, rng, a4 } = c;
  m.w16(a4 - 10480, 0);
  const g = m.u8(A + 31), t0 = m.u8(A + 32);
  let lim = 25, k = 1;
  for (let j = 0; j < 6; j++) { if (s16(m.u16(A + 2)) > lim) k++; lim *= 2; }
  k = tdiv(s16(k * s16(m.u16(A + 6))), s16(m.u16(A + 8)) || 1) + 1;     // LAB_? signed 32-bit divide
  if (k < 1) k = 1;
  if (k > 6) k = 6;
  const M = k * 4;
  const max = s16(m.u16(A + 8));
  const gate = (flag: number): number => {
    if (flag === 1) return 1;
    const ag = s16(m.u16(a4 - 15138));
    if (ag !== 0) {
      const R1 = m.u32(a4 - 15290);
      if (m.u8(R1 + 210) > 0 && m.u8(R1 + 210) !== 6 && m.u8(m.u32(a4 - 15294 + 4 * ag) + 210) === m.u8(R1 + 210)) m.w16(a4 - 10486, 14);
    }
    return 0;
  };
  const dmg = (d1: number, d2: number, res: number, t = -k) => areaDamage(c, [g, t, d1, d2, k, res, M], fx);
  const stat = (w: number[]) => areaStatus(c, [g, ...w], fx);
  const stat2 = (w: number[]) => areaStatus2(c, [g, ...w], fx);
  const silenced = (): number => (m.u8(A + 14) > 0 ? 1 : 0);
  let cost = 0;
  switch (s16(m.u16(A + 10))) {
    case 1: gate(0); dmg(2, 5, 1); cost = rng.random(4) + tdiv(max, 6); break;
    case 2: gate(0); dmg(2, 5, 7); cost = rng.random(2) + tdiv(max, 20); break;
    case 3: gate(0); dmg(3, 4, 3); cost = rng.random(4) + tdiv(max, 6); break;
    case 8: gate(0); dmg(1, 7, 8); cost = rng.random(6) + tdiv(max, 4); break;
    case 10:
      if (gate(silenced()) === 0) dmg(2, 4, 10, -(k + 1));
      cost = rng.random(4) + tdiv(max, 10); break;
    case 12:
      if (gate(silenced()) === 0) stat2([-(k + 1), 0xd97, 10, k, M, 1, 4, 7, 0, 10 * k, 2, 10 * k, 0, 0]);
      cost = rng.random(4) + tdiv(max, 10); break;
    case 4: gate(0); stat([-k, 0xd93, 4, 3, M, 0, 2 * k, 1, k, 0, 0]); cost = rng.random(4) + tdiv(max, 10); break;
    case 5: gate(0); stat2([-(k + 1), 0xd98, 5, k, M, 1, 6, 8, 0, k, 4, k, 0, 0]); cost = rng.random(4) + tdiv(max, 6); break;
    case 6: gate(0); stat2([-k, 0xd95, 6, k, M, 1, 5, 5, 0, 10 * k, 2, k, 0, 0]); cost = rng.random(3) + tdiv(max, 8); break;
    case 7: gate(0); stat([t0, 0xdaa, 13, 6, 15, 0, 5, 5, 5, 5, 5]); cost = rng.random(2) + tdiv(max, 20); break;
    case 9: gate(0); stat([-(k + 1), 0xd92, 9, 2, M, 0, k, 2, k, 0, 0]); cost = rng.random(3) + tdiv(max, 10); break;
    case 11:
      if (gate(silenced()) === 0) stat([-10, 0xd91, 10, 1, M, 0, k, 1, k, 0, 0]);
      cost = rng.random(3) + tdiv(max, 8); break;
    default: break;
  }
  return cost;
}
