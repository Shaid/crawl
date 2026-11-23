/**
 * Wizardry 6 (Amiga) spell engines under the dispatcher (spells.ts): the group shield reduction
 * LAB_0E62 / LAB_0E66 (CODE+0x23654 / 0x236cc), the area damage engine LAB_0E6C (0x23758), the area status
 * engines LAB_0E7C (0x238ac) and LAB_0E90 (0x23aa0), the whole-side wrappers LAB_0EA8 (0x23d38, drain),
 * LAB_0EAD (per-member level check) and LAB_0EB5 (0x23f18). Ported from the game's code and diffed against it
 * (oracle/combat3.py engines -> oracle/engine-vectors.json, __tests__/engines.test.ts). Not ported: LAB_0EC0
 * (WEAKEN / SLOW) and LAB_0ED3 (PRISMIC MISSILE).
 *
 * Words are the stack arguments in call order ({@link Engine} names follow the dispatcher log). A negative
 * target index means "area": min(|n|, group size) consecutive members starting at a random one.
 */
import { applyStatus, s16, setStatus, spellDamage, type Effect } from './combat.ts';
import { type Ctx, grpBase, groupCount, member } from './planner.ts';

const tdiv = (a: number, b: number): number => Math.trunc(a / b);
const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

/** LAB_0E62 (CODE+0x23654): one shield byte (group +396+slot) trims a dice count with probability s/rmax. */
export function shieldSlot(c: Ctx, g: number, slot: number, val: number, rmax: number): number {
  const { m, rng } = c;
  const s = m.u8(grpBase(c, g) + slot + 396);
  let v = s16(val);
  if (rng.random(rmax) < s) {
    let n = tdiv(v * s, 100);
    while (n > 0) { v = s16(v - rng.random(2)); n--; }
  }
  return v < 1 ? 1 : v;
}

/** LAB_0E66 (CODE+0x236cc): the shields that apply to an element: 1 fire (slot 0), 3 cold (1), 5 air (3), then the all-element slot 4. */
export function shield(c: Ctx, g: number, elem: number, val: number): number {
  let v = val;
  if (elem === 1) v = shieldSlot(c, g, 0, v, 10);
  else if (elem === 3) v = shieldSlot(c, g, 1, v, 10);
  else if (elem === 5) v = shieldSlot(c, g, 3, v, 10);
  return shieldSlot(c, g, 4, v, 10);
}

const sync = (fx: Effect[], g: number, idx: number): void => { if (g === 0) fx.push(['psync', hex16(idx) + hex16(0)]); };

/** Run LAB_0E4F for one target and execute the SetStatus it asks for on a kill. Returns the damage. */
function damageOne(c: Ctx, fx: Effect[], g: number, t: number, d1: number, sides: number, d2: number, res: number, mod: number): number {
  const r = spellDamage(c.m, c.rng, c.a4, g, t, d1, sides, d2, res, mod);
  for (const [name, hex] of r.fx) {
    if (name === 'set_status') setStatus(c.m, c.rng, c.a4, hexWords(hex));
  }
  // LAB_0E4F itself refreshes a wounded (still standing) party member's panel with psync(idx, 1)
  if (g === 0 && s16(r.dmg) > 0 && c.m.s16(member(c, 0, t) + 2) > 0) fx.push(['psync', hex16(t) + hex16(1)]);
  return r.dmg;
}
const hexWords = (h: string): number[] => (h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16));

/** Apply `f` to the single target t >= 0, or to the area picked by a negative t. */
function eachTarget(c: Ctx, g: number, t: number, f: (idx: number) => void): void {
  if (s16(t) >= 0) { f(t); return; }
  const cnt = groupCount(c, g);
  let n = Math.abs(s16(t));
  if (n > cnt) n = cnt;
  const start = c.rng.random(cnt - n);
  for (let i = start; i < start + n; i++) f(i);
}

/** LAB_0E6C: [g, t, d1, d2, count2, resist, mod] */
export function areaDamage(c: Ctx, w0: number[], fx: Effect[]): void {
  const [g, t, d1, d2, cnt2, res, mod] = w0.map(s16);
  const v1 = s16(d1) > 0 ? shield(c, g, res, d1) : d1;
  const v2 = s16(d2) > 0 ? shield(c, g, res, d2) : d2;
  eachTarget(c, g, t, (i) => { damageOne(c, fx, g, i, v1, v2, cnt2, res, mod); sync(fx, g, i); });
}

/** LAB_0E7C: [g, t, msg, resist, slotOrState, mod, kill(1)|status, d1, d2, c, w7, w8] */
export function areaStatus(c: Ctx, w0: number[], fx: Effect[]): void {
  const { m, a4 } = c;
  m.w16(a4 - 10488, 2);
  const [g, t, msg, res, slot, mod, kill, d1, d2, cc, w7, w8] = w0.map(s16);
  const v1 = s16(d1) > 0 ? shield(c, g, res, d1) : d1;
  const v2 = s16(d2) > 0 ? shield(c, g, res, d2) : d2;
  eachTarget(c, g, t, (i) => {
    if (s16(kill) === 1) setStatus(m, c.rng, a4, [g, i, msg, res, slot, mod, w7, w8]);
    else applyStatus(m, c.rng, a4, g, i, res, slot, mod, v1, v2, cc);
    sync(fx, g, i);
  });
}

/**
 * LAB_0E90: damage first, then a status if it did damage.
 * Words: 0 g, 1 t, 2 msg, 3 resist, 4 dice2, 5 mod, 6 d1, 7 sides, 8 state/slot, 9 kill flag, 10 d3, 11 d4, 12 c, 13 w7, 14 w8.
 */
export function areaStatus2(c: Ctx, w0: number[], fx: Effect[]): void {
  const w = w0.map(s16);
  const { m, a4 } = c;
  m.w16(a4 - 10488, 4);
  const [g, t, msg, res, cnt2, mod, , , slot, kill, , , cc, w7, w8] = w;
  const sh = (x: number) => (s16(x) > 0 ? shield(c, g, res, x) : x);
  const v1 = sh(w[6]), v2 = sh(w[7]), v3 = sh(w[10]), v4 = sh(w[11]);
  eachTarget(c, g, t, (i) => {
    const r = damageOne(c, fx, g, i, v1, v2, cnt2, res, mod);
    if (s16(r) > 0) {
      if (s16(kill) === 1) setStatus(m, c.rng, a4, [g, i, msg, res, slot, mod, w7, w8]);
      else applyStatus(m, c.rng, a4, g, i, res, slot, mod, v3, v4, cc);
    }
    sync(fx, g, i);
  });
}

/** LAB_0EA8: drain every monster group (side 1..5) or the party and allies, area damage up to 10 targets. */
export function groupDrain(c: Ctx, w0: number[], fx: Effect[]): void {
  const [side, a10, a12, a14, a16, a18] = w0.map(s16);
  const rest = [a10, a12, a14, a16, a18];
  if (s16(side) > 0 && s16(side) < 6) {
    for (let g = 1; g <= s16(c.m.u16(c.a4 - 15140)); g++) areaDamage(c, [g, -10, ...rest], fx);
  } else {
    areaDamage(c, [0, -10, ...rest], fx);
    if (groupCount(c, 6) > 0) areaDamage(c, [6, -10, ...rest], fx);
  }
}

/** LAB_0EAD: [g, msg, res, a14, mod, kill, d1, d2, c, w7, w8]: one group member by member through LAB_0E7C, with the air-pocket and level immunity checks. */
export function groupMembers(c: Ctx, w0: number[], fx: Effect[]): void {
  const { m, a4 } = c;
  m.w16(a4 - 10488, 2);
  const [g, a10, a12, a14, a16, a18, a20, a22, a24, a26, a28] = w0.map(s16);
  let lim = 0;
  if (s16(a14) === 3 && s16(a18) === 1) {
    if (s16(a12) === 5 && Math.floor(m.u8(grpBase(c, g) + 399) / 5) > (a20 & 0xffff)) return;
    if (s16(a12) === 5) lim = 2;
    if (s16(a12) === 11) lim = 3;
  }
  for (let i = 0; i < groupCount(c, g); i++) {
    let md = a16;
    if (lim > 0 && s16(m.u16(grpBase(c, g) + i * 44)) > s16(a20 * lim)) md = -100;
    areaStatus(c, [g, i, a10, a12, a14, md, a18, a20, a22, a24, a26, a28], fx);
  }
}

/** LAB_0EB5: [side, 10 words]: every monster group (side 1..5) or party and allies through LAB_0EAD. */
export function groupAll(c: Ctx, w0: number[], fx: Effect[]): void {
  const [side, ...rest] = w0.map(s16);
  if (s16(side) > 0 && s16(side) < 6) {
    for (let g = 1; g <= s16(c.m.u16(c.a4 - 15140)); g++) groupMembers(c, [g, ...rest], fx);
  } else {
    groupMembers(c, [0, ...rest], fx);
    if (groupCount(c, 6) > 0) groupMembers(c, [6, ...rest], fx);
  }
}
