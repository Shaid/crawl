/**
 * Wizardry 6 (Amiga) chest trap effects, ported from the game's 68k code and diffed against it under Unicorn
 * (oracle/combat6.py -> oracle/{trap,dmg,status,cond,pick}-vectors.json, __tests__/traps.test.ts). Original TypeScript
 * derived from the disassembly only.
 *
 *   chestTrap     LAB_1C0D (`Bane` CODE+0x4ba56): the trap id (1..15) and the opener; 15 effects through a jump table
 *   damageMember  LAB_1BFC (0x4b760): `count`d`sides` damage, capped at the member's HP; 0 HP kills (LAB_1BF8 with kind 3)
 *   applyStatus   LAB_1C02 (0x4b88a): a status counter (+290 + index) raised by base + count d sides after a resist roll
 *   instantCond   LAB_1BF8 (0x4b66a): a condition (+417) raised to `kind`, with an optional resist roll; kind 3 kills
 *   pickTrap      LAB_1C31 (0x4c2f0): which trap a chest carries (the (Random(100)+1)-th set bit of the 16-bit mask at chest +36)
 *
 * Presentation (messages, portrait redraw, the delay, window calls) is recorded as effects in the order the game makes
 * them, with the same name and argument bytes the oracle logs; it is not rules. Message ids are table ids only.
 * Party record i is at -17922 + i * 0x1b0 (A4-relative); the level is -18340(A4), the party size -15306(A4).
 */
import { s16, type Effect } from './combat.ts';
import { type Ctx, testBit } from './planner.ts';

const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');
const hex32 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
const P = (c: Ctx, who: number): number => c.a4 - 17922 + s16(who) * 0x1b0;

/** LAB_1BEA: base + sum over `count` of (Random(sides) + 1). `count` and `sides` are bytes. */
export function rollDice(c: Ctx, count: number, sides: number, base: number): number {
  // LAB_1BED leaves the packed {base, count, sides} in its static scratch at -30330(A4)
  c.m.w16(c.a4 - 30330, base); c.m.w8(c.a4 - 30328, count); c.m.w8(c.a4 - 30327, sides);
  let n = count & 0xff;
  let t = s16(base);
  while (n > 0) { t = s16(t + c.rng.random(sides & 0xff) + 1); n--; }
  return t;
}

/** LAB_1BF8(who, msg, resist, kind): raise the condition to `kind` unless the resist roll saves; kind >= 3 kills. */
export function instantCond(c: Ctx, who: number, msg: number, resist: number, kind: number, fx: Effect[]): void {
  const { m, rng } = c;
  const p = P(c, who);
  if (s16(resist) !== 0) {
    if (rng.random(100) <= m.u8(p + 338 + s16(resist))) return;
  }
  if (m.u8(p + 417) >= (kind & 0xffff)) return;
  m.w8(p + 417, kind);
  if (s16(kind) >= 3) {
    m.w16(p + 24, 0); m.w16(p + 28, 0);
    fx.push(['jt-32634', hex16(m.u8(p + 414) + 8)]);
  }
  fx.push(['jt-32676', hex16(msg)], ['LAB_1BEE', hex16(who)], ['LAB_1B9A', hex16(who)], ['LAB_1B62', hex16(m.u16(c.a4 - 18604))]);
}

/** LAB_1BFC(who, count, sides). */
export function damageMember(c: Ctx, who: number, count: number, sides: number, fx: Effect[]): void {
  const { m } = c;
  const p = P(c, who);
  let dmg = rollDice(c, count, sides, 0);
  if (dmg === 0) return;
  if (m.u8(p + 417) >= 3) return;
  fx.push(['jt-32676', hex16(0x146f)], ['jt-32676', hex16(0x1470)]);
  if (dmg > s16(m.u16(p + 24))) dmg = s16(m.u16(p + 24));
  m.w16(p + 24, m.u16(p + 24) - dmg);
  fx.push(['LAB_1BEE', hex16(who)], ['LAB_1B9A', hex16(who)]);
  if (s16(m.u16(p + 24)) > 0) {
    fx.push(['jt-32634', hex16(2)], ['LAB_1B62', hex16(m.u16(c.a4 - 18604))]);
  } else {
    fx.push(['LAB_1B62', hex16(4)]);
    instantCond(c, who, 0x1490, 0, 3, fx);
  }
}

/** LAB_1C02(who, msg, resist, counter, p16, p18, p20): p16 / p18 are the dice count / sides (low bytes), p20 the base or 0xff (permanent). */
export function applyStatus(c: Ctx, who: number, msg: number, resist: number, counter: number, p16: number, p18: number, p20: number, fx: Effect[]): void {
  const { m, rng } = c;
  const p = P(c, who);
  if (m.u8(p + 417) >= 2) return;
  let dur = rollDice(c, p16, p18, p20);
  if (s16(resist) !== 0) {
    if (rng.random(100) <= m.u8(p + 338 + s16(resist))) return;
  }
  const ci = s16(counter);
  if ((p20 & 0xffff) === 0xff) {
    m.w8(p + 290 + ci, 0xff);
  } else {
    if (((m.u8(p + 290 + ci) + dur) & 0xffff) > 250) dur = 250 - m.u8(p + 290 + ci);
    m.w8(p + 290 + ci, m.u8(p + 290 + ci) + (dur & 0xff));
  }
  if (ci === 5) m.w8(p + 420, p16 & 0xff);
  fx.push(['jt-32676', hex16(msg)], ['LAB_1BEE', hex16(who)], ['LAB_1B9A', hex16(who)], ['LAB_1B62', hex16(m.u16(c.a4 - 18604))]);
}

/** LAB_1C0B(a, b): the trap animation request. */
function anim(c: Ctx, a: number, b: number, fx: Effect[]): void {
  const { m, a4 } = c;
  m.w16(a4 - 3124, 0);
  if (s16(b) >= 0) { m.w16(a4 - 3122, 0); m.w16(a4 - 3120, a); m.w16(a4 - 3118, b); }
  fx.push(['jt-32676', hex16(0x146b)]);
  fx.push(['LAB_1BE6', hex32(m.u32(a4 - 18490)) + hex16(m.u16(a4 - 3116))]);
  fx.push(['LAB_1BE6', hex32(m.u32(a4 - 18490)) + hex16(m.u16(a4 - 3116))]);
}

/** LAB_1C0D(trap, who). `who` is the opener (the member who tried the chest). */
export function chestTrap(c: Ctx, trap: number, who: number, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  const win = (): string => hex32(m.u32(a4 - 18490));
  fx.push(['jt-32736', win() + '0000'], ['jt-32466', '']);
  const t = s16(trap);
  if (t === 0) {
    fx.push(['jt-32676', hex16(0x146c)], ['LAB_1BE6', win() + hex16(m.u16(a4 - 3116))]);
    return;
  }
  if (t < 0 || t >= 16) return;
  const np = (): number => s16(m.u16(a4 - 15306));
  const lvl = (): number => s16(m.u16(a4 - 18340));
  const each = (f: (i: number) => void): void => { for (let i = 0; i < np(); i++) f(i); };
  const st = (i: number, msg: number, ri: number, ci: number, cnt: number, sd: number, base: number): void =>
    applyStatus(c, i, msg, ri, ci, cnt, sd, base, fx);
  switch (t) {
    case 1:
      anim(c, 0, 15, fx);
      each((i) => damageMember(c, i, lvl() + 1, 8, fx));
      break;
    case 2:
      anim(c, 0, 16, fx);
      each((i) => st(i, 0x1485, 10, 3, 10, 10, 0x32));
      break;
    case 3: anim(c, 0, -1, fx); break;
    case 4:
      anim(c, who, 6, fx);
      damageMember(c, who, 1, 6, fx);
      st(who, 0x1487, 0, 5, lvl() + 2, 10, 0x32);
      break;
    case 5:
      anim(c, 0, 2, fx);
      each((i) => {
        if (rng.random(100) <= m.u8(P(c, i) + 340)) return;
        switch (rng.random(6)) {
          case 0: damageMember(c, i, lvl() + 1, 8, fx); break;
          case 1: st(i, 0x1486, 2, 4, 10, 10, 0x32); break;
          case 2: st(i, 0x1484, 9, 2, 10, 10, 0x32); break;
          case 3: st(i, 0x1485, 4, 3, 10, 10, 0x32); break;
          case 4: instantCond(c, i, 0x148c, 0x0b, 3, fx); break;
          case 5: instantCond(c, i, 0x148f, 0x0b, 2, fx); break;
          default: break;
        }
      });
      break;
    case 6:
      anim(c, 0, 16, fx);
      each((i) => {
        const p = P(c, i);
        st(i, 0x1491, 11, 9, 10, 10, 0x32);
        const strike = (stat: number, msg2: number): boolean => {
          if (rng.random(100) <= m.u8(p + 349) + 0x4b) return false;
          if (m.u8(p + stat) <= 3 || m.u8(p + 417) >= 3) return false;
          m.w8(p + stat, m.u8(p + stat) - 1);
          fx.push(['jt-32676', hex16(0x1492)], ['jt-32676', hex16(msg2)], ['LAB_1BEE', hex16(i)], ['LAB_1B62', hex16(m.u16(a4 - 18604))]);
          return true;
        };
        if (!strike(300, 0x1493)) strike(303, 0x1494);
      });
      break;
    case 7: anim(c, 0, 16, fx); break;
    case 8:
      anim(c, 0, 2, fx);
      each((i) => {
        const p = P(c, i);
        if (rng.random(100) <= m.u8(p + 349) + 0x32) return;
        if (m.u8(p + 417) >= 3) return;
        m.w16(p + 26, m.u16(p + 26) - (rng.random(4) + 1));
        if (s16(m.u16(p + 26)) < 1) m.w16(p + 26, 1);
        if (s16(m.u16(p + 24)) > s16(m.u16(p + 26))) m.w16(p + 24, m.u16(p + 26));
        fx.push(['jt-32676', hex16(0x1492)], ['jt-32676', hex16(0x1495)], ['LAB_1BEE', hex16(i)], ['LAB_1B62', hex16(m.u16(a4 - 18604))]);
      });
      break;
    case 9: anim(c, 0, -1, fx); break;
    case 10:
      anim(c, 0, 16, fx);
      each((i) => instantCond(c, i, 0x148f, 0x0b, 2, fx));
      break;
    case 11: anim(c, 0, 4, fx); break;
    case 12: {
      let v: number;
      do { v = rng.random(np()); } while (m.u8(P(c, v) + 417) >= 3);
      anim(c, v, 4, fx);
      fx.push(['jt-32676', hex16(0x1496)], ['jt-32736', win() + '0001'], ['jt-32628', win()], ['jt-32634', hex16(0)],
        ['LAB_1B62', hex16(m.u16(a4 - 18604))], ['jt-32676', hex16(0x1497)], ['LAB_1BEE', hex16(v)], ['LAB_1B62', hex16(m.u16(a4 - 18604))]);
      damageMember(c, v, lvl() + 1, 8, fx);
      const p = P(c, v);
      if (m.u8(p + 417) < 3 && rng.random(21) > m.u8(p + 307)) {
        fx.push(['jt-32676', hex16(0x1498)], ['LAB_1BEE', hex16(v)], ['LAB_1B62', hex16(m.u16(a4 - 18604))]);
        damageMember(c, v, (lvl() + 1) * 2, 8, fx);
        if (rng.random(21) > m.u8(p + 307)) instantCond(c, v, 0x1499, 0x0b, 3, fx);
      }
      fx.push(['jt-32676', hex16(0x149a)], ['jt-32736', win() + '0001'], ['jt-32628', win()], ['jt-32634', hex16(0)],
        ['LAB_1B62', hex16(m.u16(a4 - 18604))]);
      break;
    }
    case 13:
      anim(c, 0, 3, fx);
      each((i) => { damageMember(c, i, lvl() + 1, 8, fx); st(i, 0x149b, 5, 8, 10, 10, 0x32); });
      break;
    case 14:
      anim(c, 0, 0, fx);
      each((i) => damageMember(c, i, lvl() + 1, 10, fx));
      break;
    case 15:
      anim(c, 0, 4, fx);
      each((i) => instantCond(c, i, 0x148c, 0x0b, 3, fx));
      break;
    default: break;
  }
}

/** LAB_1C31(chest): the trap id -3236(A4) the chest at `chest` carries. */
export function pickTrap(c: Ctx, chest: number, fx: Effect[]): void {
  const { m, rng, a4 } = c;
  m.w16(a4 - 3236, 0);
  let need = rng.random(100) + 1;
  let laps = 0;
  while (need > 0 && laps < 100) {
    m.w16(a4 - 3236, m.u16(a4 - 3236) + 1);
    if (s16(m.u16(a4 - 3236)) > 15) { m.w16(a4 - 3236, 0); laps++; }
    if (testBit(m, chest + 36, m.u16(a4 - 3236)) === 1) need--;
  }
  fx.push(['jt-32676', hex16(m.u16(a4 - 3236) + 0x14b4)]);
}
