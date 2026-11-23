/**
 * Wizardry 6 (Amiga) combat round driver: LAB_102D (`Bane` CODE+0x29704, the 100-tick loop that decides
 * order of play), the per-action executor LAB_0FF9 (CODE+0x289a4: status pre-checks, retargeting, the
 * party pseudo-record sync, the action dispatch and stamina cost) and the target helpers LAB_0FE6 /
 * LAB_0FEE. Ported from the game's 68k code and diffed against it with the action callees stubbed and
 * logged (tools/wizardry6/oracle/combat3.py round -> oracle/round-vectors.json, __tests__/round.test.ts).
 * Original TypeScript derived from the disassembly only.
 *
 * What is NOT here (recorded as effects with the exact stack arguments, each its own harness):
 *   attack LAB_0DF4 (Attack, combat.ts), cast LAB_0F72, breath LAB_0FB1, useitem LAB_0F8A, equip LAB_0FC4,
 *   hide LAB_0FC5, run LAB_0FD2, swap LAB_0FDB, psync LAB_0DFE (party record write-back),
 *   area_dmg LAB_0E6C / area_status LAB_0E90 (the lingering group clouds), cloud_msg LAB_1029.
 */
import { Mem, s16, type Effect } from './combat.ts';
import { type Ctx, grpBase, recBase, member, groupCount, testBit } from './planner.ts';

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
const tdiv = (a: number, b: number): number => Math.trunc(a / b);

/** Results the stubbed callees hand back (the real ones are other harnesses). */
export interface RoundRet { cast: number; breath: number }

/** `on` (optional) runs the moment an action callee is logged, so a caller can execute it inline (the simulator does: the callee may change what later actions see) and set `ret` before the stamina cost reads it. */
export interface RoundState { fx: Effect[]; ret: RoundRet; stop: boolean; on?: (e: Effect) => void }

const emit = (st: RoundState, e: Effect): void => { st.fx.push(e); st.on?.(e); };

const pr = (c: Ctx, i: number): number => c.a4 - 17922 + i * 0x1b0;   // party record base

/** LAB_0DF5 (CODE+0x224d8): stamina cost: A[6] -= n, floored at 0. */
export function payStamina(m: Mem, A: number, n: number): void {
  let v = s16(m.u16(A + 6) - n);
  if (v < 0) v = 0;
  m.w16(A + 6, v);
}

/** LAB_0FE6 (CODE+0x287e6): next living, un-blinked party member near `old` (two tries), else `old`. */
export function retargetParty(c: Ctx, old: number): number {
  const { m, a4 } = c;
  let x = old > 0 ? old - 1 : old;
  for (let t = 0; t < 2; t++) {
    const M = member(c, 0, x);
    if (m.u8(M + 34) < 3 && m.u8(M + 43) === 0) return x;
    x = old < s16(m.u16(a4 - 15306)) - 1 ? old + 1 : old;
  }
  return old;
}

/** LAB_0FEE (CODE+0x28866): replacement target in group g2 by the attacker's formation column order. */
export function retargetGroup(c: Ctx, g2: number, old: number): number {
  const { m, a4 } = c;
  const idx = s16(m.u16(a4 - 15136));
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 5; k++) {
      const col = m.u8(a4 - 31774 + (idx % 6) * 5 + k);
      if (s16(m.u16(a4 - 15160 + row * 10 + col * 2)) === g2) {
        for (let j = 0; j < groupCount(c, g2); j++) {
          if (s8(m.u8(member(c, g2, j) + 42)) === col + row * 10) return j;
        }
      }
    }
  }
  for (let j = 0; j < groupCount(c, g2); j++) if (m.u8(member(c, g2, j) + 34) < 3) return j;
  return old;
}

/** The party pseudo-record fill LAB_0FF9 does before every action (party attacker, or party defender). */
function fillPseudo(c: Ctx, pi: number, defenderSide: boolean): void {
  const { m } = c;
  const rec0 = recBase(c, 0);
  const P = pr(c, pi);
  m.w8(rec0 + 134, m.u8(P + 300)); m.w8(rec0 + 135, m.u8(P + 301));
  m.w8(rec0 + 136, m.u8(P + 304)); m.w8(rec0 + 137, m.u8(P + 305));
  for (let k = 0; k < 14; k++) m.w8(rec0 + 148 + k, m.u8(P + 338 + k));
  for (let k = 0; k < 8; k++) m.w8(rec0 + 190 + k, m.u8(P + 352 + k));
  if (!defenderSide) {
    m.w8(rec0 + 190, s8(m.u8(rec0 + 190)) + s8(m.u8(rec0 + 191)) + s8(m.u8(rec0 + 192)));
  } else {
    for (let k = 0; k < 8; k++) {
      if (k === 1 || k === 2) continue;
      m.w8(rec0 + 190 + k, s8(m.u8(rec0 + 190 + k)) + s8(m.u8(rec0 + 191)) + s8(m.u8(rec0 + 192)));
    }
  }
  m.w8(rec0 + 211, m.u8(P + 427)); m.w8(rec0 + 213, m.u8(P + 426)); m.w8(rec0 + 212, m.u8(P + 425));
  m.w8(rec0 + 214, m.u8(P + 414)); m.w8(rec0 + 208, m.u8(P + 415));
}

/** LAB_0FF9 (CODE+0x289a4): execute the current action of member (g, i) = (-15138, -15136)(A4). */
export function executeAction(c: Ctx, st: RoundState): void {
  const { m, rng, a4 } = c;
  const g = s16(m.u16(a4 - 15138));
  const i = s16(m.u16(a4 - 15136));
  const rec0 = recBase(c, 0);
  m.w8(rec0 + 220, 0);
  m.w16(a4 - 10486, 6); m.w16(a4 - 10484, 0); m.w16(a4 - 10482, 0);
  const A = member(c, g, i);
  if (m.u8(A + 34) >= 2 || m.u8(A + 17) > 0 || m.u8(A + 16) > 0) return;
  let msg = 0, self = 0, x = 0;
  if (msg === 0 && m.u8(A + 15) > 0 && rng.random(100) > 80 && m.u8(A + 30) !== 7) msg = 0xc89;
  if (msg === 0 && m.u8(A + 21) > 0 && rng.random(100) > 40) {
    msg = rng.random(3) + 0xc85;
    if (rng.random(100) > 80) { msg = 0xc88; self = 1; }
  }
  if (msg === 0 && m.u8(A + 20) > 0) {
    msg = 0xc8a;
    if (rng.random(100) > 25) self = 1;
  }
  if (msg === 0 && m.u8(A + 18) > 0 && rng.random(100) > 80) { msg = 0xc84; self = 0; }
  if (msg === 0 && m.u8(A + 22) > 0 && rng.random(100) > 75) { msg = 0xc83; self = 0; }
  if (m.u8(recBase(c, g) + 220) & 4) {
    const T = member(c, m.u8(A + 31), m.u8(A + 32));
    if (m.u8(T + 20) > 0) {
      msg = 0xc92;
      if (m.u8(grpBase(c, g) + 410) === 0x97) { m.w8(A + 43, 3); m.w8(A + 36, 1); x = 2; } else x = 1;
    }
  }
  if (msg > 0) {
    if (x > 0) {
      if (m.u8(A + 42) !== 0xff) {
        const row = tdiv(s8(m.u8(A + 42)), 10), col = s8(m.u8(A + 42)) % 10;
        m.w16(a4 - 11734, 0);
        m.w16(a4 - 10478 + row * 10 + col * 2, 1);
        m.w16(a4 - 15160 + row * 10 + col * 2, 0);
        m.w8(a4 - 15124 + row * 5 + col, 0);
        m.w8(a4 - 15114 + row * 5 + col, 0);
      }
      m.w8(A + 42, 0xff);
      if (x === 1) { m.w8(A + 34, 3); m.w16(A + 2, 0); }
      for (let k = 0; k < 4; k++) m.w8(A + 24 + k, 0);
      return;
    }
    if (self === 0) { m.w8(A + 16, m.u8(A + 16) + 1); return; }
    m.w8(A + 30, 0); m.w8(A + 33, 0); m.w16(A + 12, 0xffff); m.w16(A + 10, 0xff);
    const mask = g === 0 ? pr(c, i) + 255 : recBase(c, g) + 83;
    for (let k = 7; k >= 0; k--) if (testBit(m, mask, k) === 1) m.w16(A + 10, k);
    if (m.u16(A + 10) === 0xff) m.w16(A + 10, 8);
    m.w8(A + 28, 0);
    m.w8(A + 31, g);
    m.w8(A + 32, rng.random(groupCount(c, g)));
  }
  // retarget when the chosen target is dead or blinked out
  {
    const T = member(c, m.u8(A + 31), m.u8(A + 32));
    if (m.u8(T + 34) >= 3 || m.u8(T + 43) !== 0) {
      if (m.u8(A + 31) === 0) m.w8(A + 32, retargetParty(c, m.u8(A + 32)));
      else m.w8(A + 32, retargetGroup(c, m.u8(A + 31), m.u8(A + 32)));
    }
  }
  if (self === 1 && m.u8(A + 32) === i) { m.w8(A + 16, m.u8(A + 16) + 1); return; }
  // pseudo record: the resolver reads the party through group 0's record
  if (g === 0) fillPseudo(c, i, false);
  else if (m.u8(A + 31) === 0) fillPseudo(c, m.u8(A + 32), true);

  const act = m.u8(A + 30);
  const cost = (n: number) => payStamina(m, A, n);
  switch (act) {
    case 0: {
      const T = member(c, m.u8(A + 31), m.u8(A + 32));
      if (m.u8(T + 34) < 3 && m.u8(T + 43) === 0) {
        const sl = m.u8(A + 33) & 1;
        let hand = m.u8(A + 28 + sl);
        if (g === 0 && m.u8(pr(c, i) + 272 + hand) === 0xff) hand = 0;
        const kind = m.u16(A + 10 + 2 * sl);
        emit(st, ['attack', hex32(A) + hex16(hand) + hex16(kind)]);
        cost(kind === 3 || kind === 6 ? rng.random(4) + 3 : rng.random(3) + 2);
      }
      break;
    }
    case 1:
      if (m.u16(A + 10) === 3) {
        const heal = tdiv(s16(m.u16(A + 8)) * 5, 100);
        let v = s16(m.u16(A + 6) + rng.random(heal) + 1);
        m.w16(A + 6, v);
        if (s16(m.u16(A + 6)) > s16(m.u16(A + 8))) m.w16(A + 6, m.u16(A + 8));
      }
      break;
    case 2:
      emit(st, ['equip', '']);
      cost(rng.random(4) + 3);
      m.w16(a4 - 18610, 0x11); m.w16(a4 - 18608, 0xd); m.w16(a4 - 15304, i);
      return;
    case 3: emit(st, ['cast', hex32(A)]); cost(st.ret.cast); break;
    case 4: emit(st, ['useitem', hex32(A)]); cost(rng.random(3) + 1); break;
    case 5: emit(st, ['swap', hex16(i) + hex16(m.u16(A + 10))]); cost(rng.random(4) + 3); break;
    case 6: emit(st, ['hide', hex32(A)]); cost(rng.random(3) + 1); break;
    case 7: emit(st, ['run', hex32(A)]); cost(rng.random(5) + 5); break;
    case 8: emit(st, ['breath', hex32(A)]); cost(st.ret.breath); break;
    default: break;
  }
  if (g === 0) emit(st, ['psync', hex16(i) + hex16(0)]);
}

/** The four lingering group clouds (LAB_103C cases): FIRESTORM, POISON GAS, TOXIC VAPORS, ACID CLOUD. */
function groupCloud(st: RoundState, g: number, k: number, dur: number): void {
  const w = (...a: number[]) => a.map(hex16).join('');
  const mod = dur * 5 + 25;
  if (k === 0) {
    emit(st, ['cloud_msg', w(0xc94, 4)]);
    emit(st, ['area_dmg', w(g, 0xfff6, 2, 4, dur, 1, mod)]);
  } else if (k === 1) {
    emit(st, ['cloud_msg', w(0xc95, 3)]);
    emit(st, ['area_status', w(g, 0xfff6, 0xd95, 6, dur, mod, 1, 4, 5, 0, dur * 10, 2, dur, 0, 0)]);
  } else if (k === 2) {
    emit(st, ['cloud_msg', w(0xc96, 6)]);
    emit(st, ['area_status', w(g, 0xfff6, 0xd98, 5, dur, mod, 2, 3, 8, 0, dur, 4, dur, 0, 0)]);
  } else {
    emit(st, ['cloud_msg', w(0xc97, 6)]);
    emit(st, ['area_dmg', w(g, 0xfff6, 1, 6, dur, 8, mod)]);
  }
}

/** LAB_102D (CODE+0x29704): one combat round: ticks 100..1, groups 0..6, members in order. */
export function runRound(c: Ctx, ret: RoundRet, on?: (e: Effect) => void): Effect[] {
  const { m, rng, a4 } = c;
  const st: RoundState = { fx: [], ret, stop: false, on };
  for (let r = 0; r < 2; r++) for (let q = 0; q < 5; q++) m.w16(a4 - 10478 + r * 10 + q * 2, 0xffff);
  m.w16(a4 - 15134, 100);
  for (;;) {
    for (let g = 0; g < 7; g++) {
      m.w16(a4 - 15138, g);
      m.w16(a4 - 15136, 0);
      for (let i = 0; i < groupCount(c, g); i++, m.w16(a4 - 15136, i)) {
        const A = member(c, g, i);
        const tick = s16(m.u16(a4 - 15134));
        if (m.u8(A + 36) > 0 && m.u8(A + 37) === tick) {
          if (m.u8(A + 43) === 0) {
            if (m.u8(A + 24 + m.u8(A + 33)) !== tick) m.w8(A + 43, 3);
            let d = tick - rng.random(10) - 5;
            if (d < 1) d = 1;
            m.w8(A + 37, d);
          } else if (m.u8(A + 43) === 3) {
            m.w8(A + 43, 0); m.w8(A + 37, 0);
          }
        }
        if (m.u8(A + 24 + m.u8(A + 33)) === tick) {
          if (m.u8(A + 36) > 0 && m.u8(A + 43) === 3) { m.w8(A + 43, 0); m.w8(A + 37, 0); }
          executeAction(c, st);
          m.w8(A + 33, m.u8(A + 33) + 1);
          if (s16(m.u16(a4 - 18610)) !== 0xd) return st.fx;
        } else if (m.u8(A + 24 + m.u8(A + 33)) === 0) {
          m.w8(A + 33, m.u8(A + 33) + 1);
        }
        if (m.u8(A + 33) > 3) m.w8(A + 33, 3);
      }
      if (groupCount(c, g) > 0) {
        for (let k = 0; k < 4; k++) {
          const dur = m.u8(grpBase(c, g) + 402 + k);
          if (m.u8(grpBase(c, g) + 406 + k) === tick0(c) && dur > 0) groupCloud(st, g, k, dur);
        }
      }
      m.w16(a4 - 15138, g + 1);
    }
    m.w16(a4 - 15134, tick0(c) - 1);
    if (s16(m.u16(a4 - 15134)) <= 0) break;
  }
  m.w16(a4 - 18610, 0xe);
  return st.fx;
}

const tick0 = (c: Ctx): number => s16(c.m.u16(c.a4 - 15134));
