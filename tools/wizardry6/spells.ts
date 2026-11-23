/**
 * Wizardry 6 (Amiga) spell effect dispatcher LAB_0F06 (`Bane` CODE+0x24ea0): `castEffect(A, spell, power)`,
 * plus the group-buff counter helper LAB_0EBA (CODE+0x23ff0) and the spell-strength helper LAB_0E2A
 * (CODE+0x22c08). Ported from the game's code and diffed against it with the leaf engines logged
 * (tools/wizardry6/oracle/combat3.py spells -> oracle/spell-vectors.json, __tests__/spells.test.ts).
 *
 * The dispatcher is a switch over the 82 spell ids onto a handful of engines. Spells that only call
 * engines are the rows of spell-recipes.json (argument words as small linear forms; derived by fitting the
 * game's own call log, then checked on every vector); the rest write state directly and are cases below.
 * Engines are calls through {@link Engines}; the area/status engines themselves are in engines.ts.
 *
 * Not ported (recorded as open): ids 45 CREATE LIFE, 59 ILLUSION, 71 CONJURATION (they call the summon
 * routine LAB_0EEE); ids 39, 46, 52, 56, 60, 62, 73, 77 have no combat effect (the game's case is empty).
 */
import { type Mem, s16, dice69 } from './combat.ts';
import { type Ctx, grpBase, member, groupCount } from './planner.ts';
import recipes from './spell-recipes.json' with { type: 'json' };

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const tdiv = (a: number, b: number): number => Math.trunc(a / b);

/** Leaf engines the dispatcher calls (each is its own routine; see engines.ts). Returns D0. */
export interface Engines { call(name: string, words: number[]): number }

/** The ids with no combat effect (empty case in the game's switch). */
export const NO_EFFECT: ReadonlySet<number> = new Set([39, 46, 52, 56, 60, 62, 73, 77]);
/** Ids that call the summon routine LAB_0EEE and are not ported. */
export const SUMMON: ReadonlySet<number> = new Set([45, 59, 71]);

/** LAB_0EBA (CODE+0x23ff0): add a buff/debuff amount to a counter. mode 0 buff (>= amount), 1 debuff (<= -amount). */
export function buffCounter(amount: number, cur: number, mode: number): number {
  amount = s16(amount); cur = s16(cur);
  if (mode === 1) {
    if (cur > 0) cur = s16(cur - amount);
    else if (cur > -amount) cur = s16(-amount);
  } else if (mode === 0) {
    if (cur < 0) cur = s16(cur + amount);
    else if (cur < amount) cur = amount;
  }
  return cur;
}

/** LAB_0E2A (CODE+0x22c08): strength index from the spell's level and the cast power. */
export function strengthIndex(m: Mem, a4: number, spell: number, power: number): number {
  return s16((m.u8(a4 - 31697 + spell * 6) - 1) * 3 + s16(power - 1) * 3);
}

type Recipe = { fn: string; args: number[][] };
const RECIPES = (recipes as { recipes: Record<string, Recipe[]> }).recipes;

/** LAB_0F06: apply the effect of `spell` at `power` from caster member A (target = A[31]/A[32]). */
export function castEffect(c: Ctx, A: number, spell: number, power: number, eng: Engines): void {
  const { m, rng, a4 } = c;
  const tg = m.u8(A + 31), ti = m.u8(A + 32);
  m.w16(a4 - 10480, 0);
  // the caster's group / index / current tick are read only by the cases that use them (footprint discipline)
  const agf = (): number => s16(m.u16(a4 - 15138));
  const aif = (): number => s16(m.u16(a4 - 15136));
  const tickf = (): number => s16(m.u16(a4 - 15134));
  const T = member(c, tg, ti);
  let str = s16(s16(m.u16(A) - m.u16(T)) + strengthIndex(m, a4, spell, power));
  const psync = (idx: number) => eng.call('psync', [idx, 0]);
  const GB = (g: number) => grpBase(c, g);
  const rows = RECIPES[String(spell)];
  const d = s16(m.u16(A) - m.u16(T));
  const vars: Array<() => number> = [() => 1, () => power, () => d, () => tg, () => ti, agf, aif,
    () => (agf() === 0 || agf() === 6 ? 1 : 0)];
  const callRecipe = (over?: Record<number, number>) => {
    for (const r of rows) {
      eng.call(r.fn, r.args.map((co, a) => over && a in over ? over[a]
        : s16(co.reduce((s, k, i) => (k === 0 ? s : s + k * vars[i]()), 0))));
    }
  };
  const healStamina = (tgrp: number, tidx: number, p: number) => {
    const M = member(c, tgrp, tidx);
    const h = dice69(m, rng, a4, p * 2, 8, p);
    m.w16(M + 6, m.u16(M + 6) + h);
    if (s16(m.u16(M + 6)) > s16(m.u16(M + 8))) m.w16(M + 6, m.u16(M + 8));
    if (tgrp === 0) psync(tidx);
  };
  const healHp = (tgrp: number, tidx: number, p: number) => {
    const M = member(c, tgrp, tidx);
    const h = dice69(m, rng, a4, p, 7, p);
    m.w16(M + 2, m.u16(M + 2) + h);
    if (s16(m.u16(M + 2)) > s16(m.u16(M + 4))) m.w16(M + 2, m.u16(M + 4));
    if (tgrp === 0) psync(tidx);
  };
  const eachMember = (g: number, f: (M: number) => void) => {
    for (let i = 0; i < groupCount(c, g); i++) f(member(c, g, i));
  };
  const half = tdiv(s16(power - 1), 2) + 1;

  if (NO_EFFECT.has(spell) || spell < 0 || spell >= 82) return;
  if (SUMMON.has(spell)) throw new Error(`spell ${spell} (summon routine LAB_0EEE) is not ported`);
  switch (spell) {
    case 3: case 16: case 21: case 23: {
      const k = spell === 3 ? 396 : spell === 16 ? 397 : spell === 21 ? 398 : 399;
      m.w8(GB(agf()) + k, buffCounter(power * 15, m.u8(GB(agf()) + k), 0));
      return;
    }
    case 70:
      m.w8(GB(agf()) + 400, buffCounter(power * 10, m.u8(GB(agf()) + 400), 0));
      if (agf() === 0) {
        m.w16(a4 - 18122, m.u16(a4 - 18122) + power * 50);
        m.w16(a4 - 18120, buffCounter(power * 10, m.u16(a4 - 18120), 0));
      }
      return;
    case 72:
      m.w8(GB(tg) + 401, buffCounter(power * 2, m.u8(GB(tg) + 401), 0));
      return;
    case 37:
      m.w8(T + 38, buffCounter(power, s8(m.u8(T + 38)), 1));
      return;
    case 49:
      eachMember(agf(), (M) => {
        m.w8(M + 38, buffCounter(half, s8(m.u8(M + 38)), 1));
        m.w8(M + 39, buffCounter(half, s8(m.u8(M + 39)), 1));
      });
      return;
    case 44: {
      const v = eng.call('resscale', [tg, power, 0, str]);
      eachMember(tg, (M) => m.w8(M + 38, buffCounter(v, s8(m.u8(M + 38)), 0)));
      return;
    }
    case 14:
      eachMember(agf(), (M) => { if (m.u8(M + 34) < 3) m.w8(M + 41, buffCounter(power * 2, s8(m.u8(M + 41)), 0)); });
      return;
    case 28: {
      for (let k = 0; k < 4; k++) {
        let v = m.u8(GB(agf()) + 402 + k) - power;
        if (v < 0) v = 0;
        m.w8(GB(agf()) + 402 + k, v);
      }
      if (m.u8(GB(agf()) + 399) > 0) {
        let v = m.u8(GB(agf()) + 399) - power * 10;
        if (v < 0) v = 0;
        m.w8(GB(agf()) + 399, v);
      }
      return;
    }
    case 30: m.w16(a4 - 18118, m.u16(a4 - 18118) + power * 5); return;
    case 38: m.w16(a4 - 18138, m.u16(a4 - 18138) + power * 100); return;
    case 41:
      m.w16(a4 - 18134, m.u16(a4 - 18134) + power * 50);
      m.w16(a4 - 18132, buffCounter(half, m.u16(a4 - 18132), 0));
      return;
    case 53:
      m.w16(a4 - 18130, m.u16(a4 - 18130) + power * 50);
      m.w16(a4 - 18128, buffCounter(power * 5 + 70, m.u16(a4 - 18128), 0));
      return;
    case 68:
      m.w16(a4 - 18126, m.u16(a4 - 18126) + power * 35);
      m.w16(a4 - 18124, buffCounter(half, m.u16(a4 - 18124), 0));
      return;
    case 54:
      for (let g = 1; g <= s16(m.u16(a4 - 15140)); g++) {
        if (rng.random(100) < power * 10 + 80 - s16(m.u16(a4 - 18340)) * 5) m.w8(GB(g) + 412, 0);
      }
      return;
    case 69: {
      const M = member(c, agf(), aif());
      if (m.u8(M + 36) === 0) m.w8(M + 37, rng.random(tdiv(tickf(), 2)) + tdiv(tickf(), 2));
      m.w8(M + 36, m.u8(M + 36) + power * 3);
      return;
    }
    case 7: case 25: case 31: case 43: {
      // area damage / status engine, then the lingering cloud on the target group (clouds 402..405 + trigger tick)
      callRecipe();
      const k = spell === 7 ? 0 : spell === 25 ? 1 : spell === 31 ? 2 : 3;
      let v = m.u8(GB(tg) + 402 + k);
      if (power > v) v = power;
      m.w8(GB(tg) + 402 + k, v + 1);
      m.w8(GB(tg) + 406 + k, tickf() + 1);
      return;
    }
    case 67: case 75: {
      // kills only the matching monster type (0x14 / 0x15); anything else gets a -100 modifier (cannot land)
      const type = m.u8(m.u32(a4 - 15294 + 4 * tg) + 208);
      callRecipe({ 5: type === (spell === 67 ? 0x14 : 0x15) ? s16(str + 3 * s16(m.u16(A) - m.u16(T))) : -100 });
      return;
    }
    case 10: healStamina(tg, ti, power); return;
    case 64: healHp(tg, ti, power); return;
    case 80: {
      const M = member(c, agf(), aif());
      let h = dice69(m, rng, a4, power, 8, power);
      m.w16(M + 6, m.u16(M + 6) + h);
      if (s16(m.u16(M + 6)) > s16(m.u16(M + 8))) m.w16(M + 6, m.u16(M + 8));
      h = dice69(m, rng, a4, power, 2, 0);
      m.w16(M + 2, m.u16(M + 2) + h);
      if (s16(m.u16(M + 2)) > s16(m.u16(M + 4))) m.w16(M + 2, m.u16(M + 4));
      if (agf() === 0) psync(aif());
      return;
    }
    case 81:
      if (agf() === 0) {
        for (let k = 0; k < 6; k++) {
          const h = dice69(m, rng, a4, power, 10, 0);
          const cur = a4 - 17882 + aif() * 0x1b0 + k * 4;
          m.w16(cur, m.u16(cur) + h);
          if (s16(m.u16(cur)) > s16(m.u16(cur + 2))) m.w16(cur, m.u16(cur + 2));
        }
      }
      return;
    case 15: case 57: {
      const k = spell === 15 ? 17 : 21;
      let v = m.u8(T + k) - power * 25;
      if (v < 0) v = 0;
      m.w8(T + k, v);
      if (tg === 0) psync(ti);
      return;
    }
    case 26: {
      let v = m.u8(T + 35) - power;
      if (v <= 0) { v = 0; m.w8(T + 19, 0); }
      m.w8(T + 35, v);
      v = m.u8(T + 19) - power * 5;
      if (v <= 0) { v = 0; m.w8(T + 35, 0); }
      m.w8(T + 19, v);
      if (tg === 0) psync(ti);
      return;
    }
    case 51: {
      for (const k of [1, 2, 4, 8, 9]) {
        let v = m.u8(T + 14 + k) - power * 2;
        if (v < 0) v = 0;
        m.w8(T + 14 + k, v);
      }
      if (tg === 0) psync(ti);
      return;
    }
    case 29:
      if (rng.random(100) < power * 5) eng.call('area_stat', [tg, ti, 3489, 6, 3, str, 1, 0, 0, 0, 14, 6]);
      else eng.call('area_stat2', [tg, ti, 3477, 6, power, str, 3, 5, 5, 0, power * 10, 4, power * 10, 0, 0]);
      return;
    case 79: {
      const R = m.u32(a4 - 15294 + 4 * tg);
      const r208 = m.u8(R + 208);
      if (!((r208 === 0x16 && s16(m.u16(a4 - 15126)) !== 0) || r208 === 0x14 || r208 === 0x15)) str = -100;
      let v = tdiv(s16(m.u16(T + 2)) * 8, s16(m.u16(T + 4)));
      if (v < 2) v = 2;
      eng.call('area_dmg', [tg, ti, 1, v, power, 0, str]);
      return;
    }
    case 74: {
      const dmg = eng.call('spelldmg', [tg, ti, power * 4, 4, power * 4, 11, str]);
      if (tg === 0) psync(ti);
      healHp(agf(), aif(), tdiv(s16(dmg), 7));   // falls through into HEAL WOUNDS' code, aimed at the caster
      return;
    }
    default:
      if (rows) callRecipe();
      else throw new Error(`spell ${spell}: no recipe or case`);
  }
}

