/**
 * The Ram-boss stage machine (A4+0x1A1E; boss = the monster with gfx 0x80C5), as far as it is isolated and harnessed.
 * Item effect routines of the three plot items (dispatch table S_1 +0x136FA, effect words 0x8D..0x90 in the shipped bcdfs item records):
 *   0x8D PROTECTOR   +0x78DA   0x8E SOULFREEZER +0x79C2   0x8F VORTEX +0x7B2E   0x90 FORCEHAMMER +0x7C40 (code only, see game-rules.md section 11)
 * Original TypeScript; PROTECTOR / SOULFREEZER / VORTEX are diffed against the game's own 68k code (rules_oracle/make_vectors_boss.py, test rules-boss.test.ts).
 *
 * Stage variable S (A4+0x1A1E):
 *   0 -> 1  a boss with hp < 50 is held at hp 49 and S becomes 1 if it was 0 (monster-death routine +0x7F2E; harness through castRay's `bossStage`)
 *   1 -> 2  PROTECTOR: needs S != 0; every living character whose signed resistance byte (+0x69) is < 75 gets +75 (byte add: a value >= 53 wraps negative, a game quirk),
 *           S 1 -> 2, event 0x25 is (re)scheduled at tick + 200 after cancelling pending 0x25 events. The 0x25 handler later subtracts 75 from every character at >= 75 and
 *           sets S = 1 again, whatever it was (applyExpiry, harness).
 *   2 -> 3  SOULFREEZER: needs S == 2, no wall on the party square in the facing direction, and the boss as first target of the front square
 *           (target pick +0xB308). Boss alert byte += 1, its pending events are cancelled (+0xB25A), an act event (type 1) is scheduled at tick + 200,
 *           and a non-zero secondary byte +0x0A is cleared (palette call +0x2D46(1)).
 *   3 -> 4  VORTEX: needs S == 3, same facing / target test; alert += 1, palette call +0x2D46(1).
 *   4 -> 5  FORCEHAMMER (code): needs S == 4 and the same test; removes the boss from its square and frees its records, clears the state word (+0xA) of the structure
 *           found at lookup(0x0C, 0x11, type 0x12) and then runs the ending text; sets S = 5.
 *   any >= 3 -> 2  whenever the boss's behaviour VM runs (+0xAB5E) while S >= 3 (so the three steps must finish before the boss's next act, 200 ticks after SOULFREEZER).
 */
import { pickSquareTargets, stepPos, type RayWorld } from './rules-spell';

export interface BossCall { fn: 'msg' | 'cancelType' | 'sched' | 'cancelEvents' | 'palette'; type?: number; due?: number; x?: number; y?: number; id?: number }
export interface BossState {
  stage: number; tick: number;
  /** party square and facing; `wall` = wall bit on the party square in the facing direction */
  px: number; py: number; facing: number; wall: boolean;
  /** front-square world: object table and cell map as the ray code reads them (pickSquareTargets) */
  world: RayWorld;
  chars: { hp: number; res: number }[];
}
export interface BossOut { stage: number; alert: Record<number, number>; clearB0a: number[]; res: number[]; calls: BossCall[] }

/** shared prologue of SOULFREEZER / VORTEX / FORCEHAMMER: the boss on the front square, or 0 */
function frontBoss(s: BossState): number {
  if (s.wall) return 0;
  const [x, y] = stepPos(s.px, s.py, s.facing);
  const id = pickSquareTargets(s.world, x, y)[0];
  return id !== 0 && s.world.objs[id].gfx === 0x80c5 ? id : 0;
}

export function ramBossItem(fx: 'prot' | 'sf' | 'vx', s: BossState): BossOut {
  const out: BossOut = { stage: s.stage, alert: {}, clearB0a: [], res: s.chars.map(c => c.res), calls: [] };
  if (fx === 'prot') {
    if (s.stage === 0) return out;
    s.chars.forEach((c, k) => { if (c.hp > 0 && ((out.res[k] << 24) >> 24) < 0x4b) out.res[k] = (out.res[k] + 0x4b) & 0xff; });
    if (s.stage === 1) out.stage = 2;
    out.calls.push({ fn: 'msg' }, { fn: 'cancelType', type: 0x25 }, { fn: 'sched', type: 0x25, due: (s.tick + 200) >>> 0 });
    return out;
  }
  const need = fx === 'sf' ? 2 : 3;
  if (s.stage !== need) return out;
  out.calls.push({ fn: 'msg' });
  const id = frontBoss(s);
  if (!id) return out;
  const S = s.world.objs[id].S!;
  out.stage = need + 1;
  out.alert[S] = (s.world.objs[S].alert! + 1) & 0xff;
  if (fx === 'sf') {
    const [x, y] = stepPos(s.px, s.py, s.facing);
    out.calls.push({ fn: 'cancelEvents', id }, { fn: 'sched', type: 1, due: (s.tick + 200) >>> 0, x: x & 0xff, y: y & 0xff, id });
    if ((s.world.objs[S].b0A ?? 0) !== 0) { out.clearB0a.push(S); out.calls.push({ fn: 'palette' }); }
  } else out.calls.push({ fn: 'palette' });
  return out;
}
