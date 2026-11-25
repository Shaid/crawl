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
 * Summons (ids 45 CREATE LIFE, 59 ILLUSION, 71 CONJURATION) pick their six candidate monster ids and call the
 * summon routine LAB_0EEE (encounter.ts `summon`) through the engine hook; ids 39, 46, 52, 56, 60, 62, 73, 77 have no combat effect (the game's case is empty).
 */
import { type Mem, s16, dice69, skillUse } from './combat.ts';
import { type Ctx, grpBase, member, groupCount } from './planner.ts';
import recipes from './spell-recipes.json' with { type: 'json' };
import spellCases from './spell-cases.json' with { type: 'json' };

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const tdiv = (a: number, b: number): number => Math.trunc(a / b);

/** Leaf engines the dispatcher calls (each is its own routine; see engines.ts). Returns D0. */
export interface Engines { call(name: string, words: number[]): number }

/** The ids with no combat effect (empty case in the game's switch). */
export const NO_EFFECT: ReadonlySet<number> = new Set([39, 46, 52, 56, 60, 62, 73, 77]);
/** Ids that call the summon routine LAB_0EEE. */
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
/** One operation of spell-cases.json (see the file's `ops` table). */
type SpellOp = { op: string; when?: string; group?: string; off: number; offs: number[]; amt: number[]; mode: number; addr: number; pool?: string; who?: string; dice?: number[][]; stamina?: number[][]; hp?: number[][]; k: number; type: number; aliveOnly?: boolean };
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
  const healStamina = (tgrp: number, tidx: number, n: number, sides: number, bonus: number) => {
    const M = member(c, tgrp, tidx);
    const h = dice69(m, rng, a4, n, sides, bonus);
    m.w16(M + 6, m.u16(M + 6) + h);
    if (s16(m.u16(M + 6)) > s16(m.u16(M + 8))) m.w16(M + 6, m.u16(M + 8));
    if (tgrp === 0) psync(tidx);
  };
  const healHp = (tgrp: number, tidx: number, n: number, sides: number, bonus: number) => {
    const M = member(c, tgrp, tidx);
    const h = dice69(m, rng, a4, n, sides, bonus);
    m.w16(M + 2, m.u16(M + 2) + h);
    if (s16(m.u16(M + 2)) > s16(m.u16(M + 4))) m.w16(M + 2, m.u16(M + 4));
    if (tgrp === 0) psync(tidx);
  };
  const eachMember = (g: number, f: (M: number) => void) => {
    for (let i = 0; i < groupCount(c, g); i++) f(member(c, g, i));
  };

  if (NO_EFFECT.has(spell) || spell < 0 || spell >= 82) return;
  if (SUMMON.has(spell)) {
    const party = agf() === 0 || agf() === 6;
    const lvlf = (): number => s16(m.u16(a4 - 18340));
    const rep = (id: number) => [id, id, id, id, id, id];
    let ids = rep(0), n = 0;
    if (spell === 45) {
      if (party) { ids = [0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]; n = power; }
      else {
        const lvl = lvlf();
        if (lvl === 10) { ids = rep(0xd6); n = power; }
        else if (lvl === 11) { ids = [0xd6, 0xd6, 0xd7, 0xd7, 0xd8, 0xd8]; n = power; }
        else if (lvl === 12) { ids = [0xd6, 0xd6, 0xd6, 0xd7, 0xd7, 0xd9]; n = power; }
      }
    } else if (spell === 59) {
      if (party) { ids = [0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf]; n = power; }
      else {
        const lvl = lvlf();
        if (lvl === 9) { ids = [0xda, 0xda, 0xdb, 0xdb, 0xdb, 0xde]; n = power; }
        else if (lvl >= 10 && lvl <= 12) { ids = [0xdb, 0xdb, 0xdb, 0xde, 0xde, 0xdf]; n = power; }
      }
    } else if (party) {
      if (rng.random(2) === 0) ids = [0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd];
      else ids = [0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3];
      n = power;
    } else {
      const own = m.u8(GB(agf()) + 410);
      if (own === 0x96 || own === 0x99) { ids = rep(0xd3); n = 1; }
      else {
        const lvl = lvlf();
        if (lvl === 9) { ids = [0xc8, 0xcf, 0xca, 0xd0, 0xcb, 0xd1]; n = power; }
        else if (lvl === 10) { ids = [0xc9, 0xc9, 0xd0, 0xd0, 0xd0, 0xd0]; n = power; }
        else if (lvl === 11) { ids = [0xca, 0xca, 0xd0, 0xcb, 0xcb, 0xd2]; n = power; }
        else if (lvl === 12) { ids = [0xc8, 0xc9, 0xce, 0xd0, 0xd1, 0xd1]; n = power; }
      }
    }
    eng.call('summon', [...ids, n]);
    return;
  }
  // data-driven cases (spell-cases.json): the direct state writers
  const OPS = (spellCases as unknown as { cases: Record<string, SpellOp[]> }).cases[String(spell)];
  if (OPS) {
    const half = tdiv(s16(power - 1), 2) + 1;
    const amt = (a: number[]): number => (a[0] ?? 0) + (a[1] ?? 0) * power + (a[2] ?? 0) * half;
    const cloudOf = (g: number) => GB(g);
    for (const op of OPS) {
      if (op.when === 'casterIsParty' && agf() !== 0) continue;
      switch (op.op) {
        case 'groupByte': {
          const base = GB(op.group === 'target' ? tg : agf());
          m.w8(base + op.off, buffCounter(amt(op.amt), m.u8(base + op.off), op.mode));
          break;
        }
        case 'globalAdd': m.w16(a4 + op.addr, m.u16(a4 + op.addr) + amt(op.amt)); break;
        case 'globalBuff': m.w16(a4 + op.addr, buffCounter(amt(op.amt), m.u16(a4 + op.addr), op.mode)); break;
        case 'memberSigned': m.w8(T + op.off, buffCounter(amt(op.amt), s8(m.u8(T + op.off)), op.mode)); break;
        case 'membersAll':
          eachMember(op.group === 'target' ? tg : agf(), (M) => {
            if (op.aliveOnly && m.u8(M + 34) >= 3) return;
            for (const off of op.offs) m.w8(M + off, buffCounter(amt(op.amt), s8(m.u8(M + off)), op.mode));
          });
          break;
        case 'heal': {
          const [g, i] = op.who === 'target' ? [tg, ti] : [agf(), aif()];
          const [n, sides, bonus] = (op.dice as number[][]).map(amt);
          (op.pool === 'hp' ? healHp : healStamina)(g, i, n, sides, bonus);
          break;
        }
        case 'healCasterBoth': {
          const M = member(c, agf(), aif());
          const [sn, ss, sb] = (op.stamina as number[][]).map(amt);
          let h = dice69(m, rng, a4, sn, ss, sb);
          m.w16(M + 6, m.u16(M + 6) + h);
          if (s16(m.u16(M + 6)) > s16(m.u16(M + 8))) m.w16(M + 6, m.u16(M + 8));
          const [hn, hs, hb] = (op.hp as number[][]).map(amt);
          h = dice69(m, rng, a4, hn, hs, hb);
          m.w16(M + 2, m.u16(M + 2) + h);
          if (s16(m.u16(M + 2)) > s16(m.u16(M + 4))) m.w16(M + 2, m.u16(M + 4));
          if (agf() === 0) psync(aif());
          break;
        }
        case 'healPools':
          if (agf() === 0) {
            for (let k = 0; k < 6; k++) {
              const [pn, ps, pb] = (op.dice as number[][]).map(amt);
              const h = dice69(m, rng, a4, pn, ps, pb);
              const cur = a4 - 17882 + aif() * 0x1b0 + k * 4;
              m.w16(cur, m.u16(cur) + h);
              if (s16(m.u16(cur)) > s16(m.u16(cur + 2))) m.w16(cur, m.u16(cur + 2));
            }
          }
          break;
        case 'cure':
          for (const off of op.offs) {
            let v = m.u8(T + off) - amt(op.amt);
            if (v < 0) v = 0;
            m.w8(T + off, v);
          }
          if (tg === 0) psync(ti);
          break;
        case 'cloud': {
          callRecipe();
          const base = cloudOf(tg);
          let v = m.u8(base + 402 + op.k);
          if (power > v) v = power;
          m.w8(base + 402 + op.k, v + 1);
          m.w8(base + 406 + op.k, tickf() + 1);
          break;
        }
        case 'typeOnly': {
          const type = m.u8(m.u32(a4 - 15294 + 4 * tg) + 208);
          callRecipe({ 5: type === op.type ? s16(str + 3 * s16(m.u16(A) - m.u16(T))) : -100 });
          break;
        }
      }
    }
    return;
  }
  switch (spell) {
    case 44: {
      const v = eng.call('resscale', [tg, power, 0, str]);
      eachMember(tg, (M) => m.w8(M + 38, buffCounter(v, s8(m.u8(M + 38)), 0)));
      return;
    }
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
      healHp(agf(), aif(), tdiv(s16(dmg), 7), 7, tdiv(s16(dmg), 7));   // falls through into HEAL WOUNDS' code, aimed at the caster
      return;
    }
    default:
      if (rows) callRecipe();
      else throw new Error(`spell ${spell}: no recipe or case`);
  }
}


/**
 * LAB_0F72 (CODE+0x27132): one cast by member A: the action word at A+10 is `power*256 + spell`. Rolls the
 * anti-magic gate, the caster's success chance, fizzle / backfire, the silence check, runs the effect through
 * `effect(A, spell, power)` (LAB_0F06) and charges the party caster's spell points. Returns the stamina cost
 * `Random(power) + spellLevel + power`.
 *
 * Spell table row (6 bytes at A4-31698): +0 realm (SP pool), +1 level, +2 SP per power, +3 flags (bit 0 can
 * fizzle, bit 1 can backfire), +4 heal-ally flag (planner), +5 open.
 */
export function castSpell(c: Ctx, A: number, effect: (A: number, spell: number, power: number) => void): number {
  const { m, rng, a4 } = c;
  m.w8(grpBase(c, 0) + 413, m.u8(a4 - 15305));
  const w = s16(m.u16(A + 10));
  const power = tdiv(w, 256);
  const spell = w % 256;
  const ag = s16(m.u16(a4 - 15138)), ai = s16(m.u16(a4 - 15136));
  const row = a4 - 31698 + spell * 6;
  const lvl = m.u8(row + 1);
  m.w16(a4 - 10484, 0); m.w16(a4 - 10482, 0);                      // backfire B, fizzle F
  let F = 0, B = 0;
  const anti = m.u8(grpBase(c, ag) + 401);
  if (rng.random(anti + s16(m.u16(A)) + 1) < anti) F = 1;
  const P = a4 - 17922 + ai * 0x1b0;                                // party record (caster, party side)
  if (ag === 0) {
    const cls = m.u8(P + 415);
    let chance: number;
    if (cls === 5 || cls === 4 || cls === 13) chance = s16(Math.floor(m.u8(P + 333) / 3) + 90 - lvl * power);
    else {
      chance = s16(Math.floor(m.u8(P + 321) / 3) + 90 - lvl * power);
      skillUse(m, rng, a4, ai, 13, 2);
    }
    if (rng.random(100) > chance) {
      if (rng.random(36) > m.u8(P + 307) + 18) { F = 0; B = 1; } else F = 1;
    }
  } else {
    const chance = s16(s16(m.u16(member(c, ag, ai))) * 3 + 88 - lvl * power);
    if (rng.random(100) > chance) {
      if (rng.random(7) === 0) { F = 0; B = 1; } else F = 1;
    }
  }
  let silenceable = 1;
  if (ag === 0) {
    const cls = m.u8(P + 415);
    if (cls === 5 || cls === 4 || cls === 13) silenceable = 0;
  } else {
    const t = m.u8(m.u32(a4 - 15294 + 4 * ag) + 208);
    if (t === 5 || t === 4 || t === 0xd) silenceable = 0;
  }
  const flags = () => m.u8(a4 - 31695 + spell * 6);
  if (B === 1 && !(flags() & 2)) { B = 0; F = 1; }
  if (F === 1 && !(flags() & 1)) F = 0;
  m.w16(a4 - 10484, B); m.w16(a4 - 10482, F);
  if (silenceable === 1 && m.u8(A + 14) > 0) {
    /* SILENCED! */
  } else if (F === 1) {
    /* FIZZLE! */
  } else {
    if (B === 1) { m.w8(A + 31, ag); m.w8(A + 32, ai); }            // BACKFIRE!: aimed at the caster itself
    effect(A, spell, power);
  }
  if (ag === 0) {
    const pool = a4 - 17882 + ai * 0x1b0 + m.u8(row) * 4;
    m.w16(pool, m.u16(pool) - m.u8(row + 2) * power);
  }
  return s16(rng.random(power) + lvl + power);
}
