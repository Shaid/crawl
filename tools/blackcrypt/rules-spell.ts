/**
 * Black Crypt (Amiga) player-side spells: the CastSpell dispatcher (S_1 +0x7044), heals / cures / buffs
 * (+0x5070, +0x52D6, +0x540E, +0x51DE, +0x54E2, +0x5710, +0x66E2, ...) and the ray caster (+0x6D9A / +0x435C),
 * plus monster possession / flesh-to-stone (+0x98A8 bits 12-13).
 * Original TypeScript; each function is diffed against the game's own 68k code run in musashi
 * (tools/blackcrypt/rules_oracle/oracle_spell.c, vectors_spell.json). Evidence labels in comments:
 * HARNESS = diffed against the real routine, CODE = read only, HYP = guess.
 * Pure functions over explicit state so a combat simulator can compose them.
 */
import { BcRng, type RuleTables } from './rules';

/** Scheduled event as logged from ScheduleEvent (+0x5EA): type, due tick, a1 (char / target), a2, a3 (magnitude). */
export interface SpEvent { type: number; due: number; a1: number; a2: number; a3: number }

export interface SpChar {
  cls: number; level: number; b6a: number; w65: number; w66: number;
  hp: number; maxHp: number; ac: number; str: number; poison: number; disease: number; food: number; water: number;
  acCnt: number; strCnt: number; wizCnt: number; detCnt: number; res: number; slots: number[]; xp?: number;
}
export interface SpWorld {
  chars: SpChar[]; active: number; formation: number[]; tick: number;
  light: number; hold: number; compass: number; wizSight: number; detect: number; haste: number;
  events: SpEvent[];
}
export interface CastResult { spent: boolean; failed: boolean; picks: number[] }

const b8 = (v: number) => v & 0xff;
const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;
const alive = (c: SpChar) => c.hp > 0;

/** Caster values D3/D4/D5 (S_1 +0x70A0..+0x70D8, HARNESS via rays and buffs). Stat = +0x65 for class 1 / 3, else +0x66. */
export function casterValues(c: SpChar, t: RuleTables): { d3: number; d4: number; d5: number } {
  const d4 = b8(c.level + s8(c.b6a));
  const d5 = d4 > 3 ? (2 * d4 - 4) & 0xffff : 2;
  const stat = (c.cls === 1 || c.cls === 3) ? c.w65 : c.w66;
  return { d3: t.statBonusT1[stat], d4, d5 };
}

/** Healing (+0x5070 / +0x7044): hp += (2 << n) + rand16(16 n), capped at max. n = 2 for spell 9 else 1 (HARNESS). */
export function healTarget(c: SpChar, n: number, rng: BcRng): void {
  const heal = (2 << n) + rng.rand16(16 * n);
  c.hp = s16(c.hp + heal);
  if (c.hp > c.maxHp) c.hp = c.maxHp;
}

/** Party-wide shield (+0x66E2): n = base + (L >= min ? (L + 1 - min) >> 1 : 0), applied to every living character. */
function shieldAll(w: SpWorld, base: number, min: number, lvl: number): void {
  const n = base + (lvl >= min ? (lvl + 1 - min) >> 1 : 0);
  for (let i = 0; i < 4; i++) {
    const c = w.chars[i];
    if (!alive(c)) continue;
    c.ac = s8(c.ac + n); c.acCnt = b8(c.acCnt + 1);
    w.events.push({ type: 0x1e, due: w.tick + 1800, a1: i, a2: 0, a3: n });
  }
}

/**
 * CastSpell for the non-ray spells (S_1 +0x7044 -> table +0x7822). `pick` = the party slot the player clicked (the UI
 * target-pick +0x908AA is the only input). Returns whether the memorised charge was spent (+0x4876) or the
 * cast was cancelled (+0x4960). Ray spells: see castRay. Cancel-old-buff paths (+0x49B4 found an event) are CODE only.
 */
export function castSimple(w: SpWorld, spell: number, pick: number, t: RuleTables, rng: BcRng): CastResult {
  const caster = w.chars[w.active];
  const { d4 } = casterValues(caster, t);
  const res: CastResult = { spent: true, failed: false, picks: [] };
  const tgt = () => { res.picks.push(pick); return w.formation[pick]; };
  switch (spell) {
    case 1: case 32: w.light = (w.light + 120) & 0xffff; break;
    case 3: case 53: case 9: healTarget(w.chars[tgt()], spell === 9 ? 2 : 1, rng); break;
    case 7: { const c = w.chars[tgt()]; c.hp = c.maxHp; break; }
    case 5: case 54: w.chars[tgt()].poison = 0; break;
    case 6: w.chars[tgt()].disease = 0; break;
    case 42: for (const c of w.chars) if (alive(c)) c.poison = 0; break;
    case 40: for (const c of w.chars) if (alive(c)) { c.food = 5000; c.water = 5000; } break;
    case 15: case 27: {
      const k = tgt(); const c = w.chars[k];
      const n = d4 <= 5 ? 1 : ((d4 - 4) >> 1) + 1;
      c.ac = s8(c.ac + n); c.acCnt = b8(c.acCnt + 1);
      w.events.push({ type: 0x1e, due: w.tick + 1800, a1: k, a2: 0, a3: n });
      break;
    }
    case 20: {
      const k = tgt(); const c = w.chars[k];
      c.str = b8(c.str + 2); c.strCnt = b8(c.strCnt + 1);
      w.events.push({ type: 0x1f, due: w.tick + 1800, a1: k, a2: 0, a3: 2 });
      break;
    }
    case 45: shieldAll(w, 2, 6, caster.level); break;
    case 56: shieldAll(w, 1, 4, caster.level); break;
    case 12:
      for (const c of w.chars) if (alive(c)) { c.wizCnt = b8(c.wizCnt + 1); w.wizSight = (w.wizSight + 1) & 0xffff; } /* party counter += 1 per living char */
      w.events.push({ type: 0x21, due: w.tick + 3600, a1: 0, a2: 0, a3: 0 });
      break;
    case 13: w.compass = (w.compass + 1) & 0xffff; w.events.push({ type: 0x20, due: w.tick + 3600, a1: 0, a2: 0, a3: 0 }); break;
    case 19:
      for (const c of w.chars) if (alive(c)) { c.detCnt = b8(c.detCnt + 1); w.detect = (w.detect + 1) & 0xffff; }
      w.events.push({ type: 0x23, due: w.tick + d4 * 360, a1: 0, a2: 0, a3: 0 });
      break;
    case 48: w.haste = (w.haste + 1) & 0xffff; w.events.push({ type: 0x24, due: w.tick + d4 * 120, a1: 0, a2: 0, a3: 0 }); break;
    default: throw new Error('castSimple: spell ' + spell + ' not covered');
  }
  return res;
}

// ================================================================ rays (CastSpellRay +0x6D9A, ray march +0x435C, target pick +0xB308)

/** Object record as the ray code reads it (object table at A4-0x6E7A, 0x14 bytes). */
export interface RayObj {
  kind: 'mon' | 'sec' | 'str';
  /** monster primary: gfx word (bit 15 set = monster), b2 hit byte, hp (+8), S = secondary index (+0x10) */
  gfx?: number; b2?: number; hp?: number; S?: number;
  /** monster secondary: maxHp (+8), w6 xp base, pos (+0x0B: 0..3 corner, 4 centre), alert (+0x12, incremented by every ray that targets the monster) */
  maxHp?: number; w6?: number; pos?: number; alert?: number;
  /** structure: b5 type, wA (state word), wC, w10, b0F */
  b5?: number; wA?: number; wC?: number; w10?: number; b0F?: number;
  /** next object on the square (+0x12) */
  next?: number;
}
export interface RayWorld {
  /** key y * 256 + x -> cell longword (low 12 bits = first object id, bit 12 + d = wall on side d, bit 31 = water square) */
  cells: Map<number, number>;
  objs: Record<number, RayObj>;
  px: number; py: number; facing: number;
  item36: boolean; b1E5C: number;
  chars: { hp: number; xp: number }[];
}

/** One step by facing (S_1 +0x2B4): 0 = y+1, 1 = x+1, 2 = y-1, 3 = x-1 (HARNESS through the march). */
export const stepPos = (x: number, y: number, f: number): [number, number] =>
  f === 0 ? [x, y + 1] : f === 1 ? [x + 1, y] : f === 2 ? [x, y - 1] : [x - 1, y];

const cellAt = (w: RayWorld, x: number, y: number) => w.cells.get(y * 256 + x) ?? 0;

export interface MarchResult { steps: number; res: number; x: number; y: number }
/**
 * Ray march (S_1 +0x435C, mode 2 = spell ray). HARNESS: `res` 0 = range exhausted, 1 = stopped by an object, 2 = stopped by a wall
 * bit on the square being left. Per step: a wall bit (cell bit 12 + facing) on the current square stops the ray BEFORE moving;
 * otherwise it moves one square, and the objects of the new square are walked: ANY monster stops it (res 1, mode 2);
 * a pillar 0x17 / panel 0x1F with state word 0, an illusion wall 0x10 with wC == 2 and state 0, a pit-frame 0x12 with w10 <= 3 and
 * state 0, and a door 0x11 whose b0F bit 0 is clear (closed) also stop it (res 1). So walls and closed doors BLOCK rays; open
 * doors, items and other structures do not. The square the ray stops on is still the "hit" square (monsters there are targeted).
 */
export function marchRay(w: RayWorld, range: number): MarchResult {
  let x = w.px, y = w.py, steps = 0, res = 0;
  while (res === 0 && steps < (range & 0xffff)) {
    if ((cellAt(w, x, y) >>> (12 + w.facing)) & 1) { res = 2; break; }
    [x, y] = stepPos(x, y, w.facing); steps++;
    let id = cellAt(w, x, y) & 0xfff;
    while (id !== 0 && res === 0) {
      const o = w.objs[id];
      const state0 = (o.wA ?? 0) === 0;
      if (o.kind === 'mon') res = 1;
      else if (o.b5 === 0x17 && state0) res = 1;
      else if (o.b5 === 0x1f && state0) res = 1;
      else if (o.b5 === 0x10 && state0 && o.wC === 2) res = 1;
      else if (o.b5 === 0x12 && state0 && (o.w10 ?? 0) <= 3) res = 1;
      else if (o.b5 === 0x11 && ((o.b0F ?? 0) & 1) === 0) res = 1;
      id = o.next ?? 0;
    }
  }
  return { steps, res, x, y };
}

/** Monsters-in-front lookup (S_1 +0xB308, HARNESS through melee and rays): up to two target ids on a square. */
export function pickSquareTargets(w: RayWorld, x: number, y: number): [number, number] {
  const slots = [0, 0, 0, 0, 0];
  for (let id = cellAt(w, x, y) & 0xfff; id !== 0; id = w.objs[id].next ?? 0) {
    const o = w.objs[id];
    if (o.kind === 'mon') slots[w.objs[o.S!].pos!] = id;
  }
  if (slots[4]) return [slots[4], slots[4]];
  const d3 = (w.facing + 3) & 3, d4 = (w.facing + 2) & 3;
  return [slots[d3] || slots[(d3 + 1) & 3], slots[d4] || slots[(d4 + 3) & 3]];
}

export interface RayArgs { mag: number; dmg: number; base: number; pre: number; range: number }
export interface RayResult { bossStage?: boolean; total: number; hits: { id: number; dmg: number; killed: boolean }[]; fizzled: boolean }

/**
 * Whether the ray (pre-effect `pre`) can hurt a monster of gfx word `gfx` (HARNESS sweep through +0x6D9A):
 * 0x80B2 never; 0x80B1 only when the caster's item (char +0x36) has gfx 0xC0; 0x80BE only for pre 0x64, 0x80C5 only for pre 0x65
 * (the boss-killer item rays); everything else only for pre 1 / 0x66 / 0x67 (never 0x64 / 0x65).
 */
export function rayCanHurt(gfx: number, pre: number, item36: boolean): boolean {
  if (gfx === 0x80b2) return false;
  if (gfx === 0x80b1) return item36 && pre !== 0x64 && pre !== 0x65;
  if (gfx === 0x80be) return pre === 0x64;
  if (gfx === 0x80c5) return pre === 0x65;
  return pre !== 0x64 && pre !== 0x65;
}

/**
 * CastSpellRay (S_1 +0x6D9A). Damage per target = `mag + rand16(dmg + 1)` (word), subtracted from the monster's HP word;
 * killed (hp < 1) monsters award XP through awardXp semantics (the level-up check itself is not modelled here).
 * `pre` 0x67 (fire) on a water square (cell bit 31) fizzles unless A4+0x1E5C == 3. A ray that takes no step (blocked at once) returns
 * before any target pick; every picked target has its alert byte +0x12 incremented even when the filter spares it.
 */
export function castRay(w: RayWorld, a: RayArgs, rng: BcRng, awardXp: (chars: { hp: number; xp: number }[], mon: { b2: number; w6: number; maxHp: number }, rng: BcRng) => number[]): RayResult {
  const m = marchRay(w, a.range);
  const out: RayResult = { total: 0, hits: [], fizzled: false };
  if (a.pre === 0x67 && (cellAt(w, w.px, w.py) >>> 31) === 1 && w.b1E5C !== 3) { out.fizzled = true; return out; }
  if (m.steps === 0) return out;
  const ids = pickSquareTargets(w, m.x, m.y);
  for (let k = 0; k < 2; k++) {
    const id = ids[k];
    if (id === 0) continue;
    if (k === 1 && ids[1] === ids[0]) continue;
    const mon = w.objs[id], sec = w.objs[mon.S!];
    sec.alert = b8(sec.alert! + 1);
    if (!rayCanHurt(mon.gfx!, a.pre, w.item36)) continue;
    const d = ((rng.rand16(a.dmg + 1) + a.mag) << 16) >> 16;
    out.total = s16(out.total + d);
    mon.hp = s16(mon.hp! - d);
    /* +0x7ED0: gfx 0x80C5 (the story boss) with hp < 50 is held at 49 and starts the stage machine (A4+0x1A1E): it never dies here (HARNESS) */
    if (mon.gfx === 0x80c5 && mon.hp < 50) { mon.hp = 49; out.bossStage = true; }
    const killed = mon.hp < 1;
    if (killed) {
      const xps = awardXp(w.chars, { b2: mon.b2!, w6: sec.w6!, maxHp: sec.maxHp! }, rng);
      w.chars.forEach((c, i) => { c.xp = xps[i]; });
    }
    out.hits.push({ id, dmg: d, killed });
  }
  return out;
}

/**
 * Ray spell parameters (S_1 handlers +0x7268..+0x7618, Appendix A.3; HARNESS through the dispatcher): magnitude, damage die,
 * pre-effect, range as functions of the caster values. total damage per target = mag + rand16(die + 1).
 */
export const RAY_SPELLS: Record<number, (v: { d3: number; d4: number; d5: number }) => { mag: number; dmg: number; pre: number; range: number; lifesteal?: boolean }> = {
  0: v => ({ mag: v.d3 + 8, dmg: 8, pre: 1, range: 3 }),
  8: v => ({ mag: v.d5 + v.d3, dmg: 6, pre: 1, range: 3 }),
  11: v => ({ mag: v.d3 + 20, dmg: 60, pre: 1, range: 3 }),
  14: v => ({ mag: v.d3 + v.d5, dmg: 6, pre: 0x67, range: 3 }),
  16: v => ({ mag: v.d3 + 10, dmg: 90, pre: 1, range: 3 }),
  17: v => ({ mag: v.d3 + 8, dmg: 24, pre: 1, range: 3, lifesteal: true }),
  23: v => ({ mag: v.d3 + 4, dmg: 8, pre: 1, range: 3 }),
  25: v => ({ mag: v.d3 + v.d5, dmg: 6, pre: 1, range: 3 }),
  28: v => ({ mag: v.d3 + v.d5, dmg: 6, pre: 0x67, range: 3 }),
  29: v => ({ mag: v.d3 + v.d5, dmg: 10, pre: 0x67, range: 3 }),
  30: v => ({ mag: v.d3 + 5, dmg: 45, pre: 0x67, range: 3 }),
  31: v => ({ mag: v.d3 + 10, dmg: 100, pre: 0x67, range: 3 }),
  33: v => ({ mag: v.d3 + v.d5, dmg: 6, pre: 0x67, range: 1 }),
  35: v => ({ mag: 10 * v.d4 + v.d3 + 20, dmg: 50, pre: 1, range: 3 }),
  36: v => ({ mag: v.d3 + 4, dmg: 8, pre: 1, range: 3 }),
  37: v => ({ mag: v.d3 + 20, dmg: 80, pre: 1, range: 3 }),
  38: v => ({ mag: v.d3 + 10, dmg: 15, pre: 1, range: 3 }),
  39: v => ({ mag: v.d3 + 10, dmg: 40, pre: 1, range: 3 }),
  47: v => ({ mag: v.d3 + 5, dmg: 45, pre: 1, range: 3 }),
  49: v => ({ mag: v.d3 + v.d5, dmg: 18, pre: 1, range: 3 }),
  50: v => ({ mag: v.d3 + 50, dmg: 20, pre: 1, range: 3 }),
  52: v => ({ mag: v.d4 < 7 ? v.d3 + 8 : 3 * v.d4 + v.d3 - 10, dmg: 8, pre: 0x67, range: 1 }),
  55: v => ({ mag: v.d3 + 40, dmg: 0, pre: 1, range: 3 }),
  57: v => ({ mag: v.d3 + 5, dmg: 70, pre: 1, range: 3 }),
  58: v => ({ mag: 2 * v.d5 + v.d3 + 10, dmg: 30, pre: 1, range: 3 }),
  59: v => ({ mag: v.d3 + 10, dmg: 100, pre: 0x66, range: 1 }),
};

export interface SpFull extends SpWorld { ray: RayWorld; antimagic: boolean }

/**
 * Full CastSpell for non-ray and ray spells. An anti-magic square (cell bit 30 at the party square, +0x70CA) fizzles any spell
 * ("SPELL FAILED") and the charge is still spent (HARNESS). Ray spells with no target still spend the charge.
 * Lifestealer (17): caster hp += 3 * total / 10 (signed divide), capped at max (HARNESS).
 */
export function castSpell(w: SpFull, spell: number, pick: number, t: RuleTables, rng: BcRng,
  awardXp: Parameters<typeof castRay>[3]): CastResult & { ray?: RayResult } {
  if (w.antimagic) return { spent: true, failed: false, picks: [] };
  const fn = RAY_SPELLS[spell];
  if (!fn) return castSimple(w, spell, pick, t, rng);
  const caster = w.chars[w.active];
  const p = fn(casterValues(caster, t));
  w.ray.chars = w.chars as unknown as RayWorld['chars'];
  for (const c of w.chars) c.xp ??= 0;
  const r = castRay(w.ray, { mag: p.mag, dmg: p.dmg, base: 0, pre: p.pre, range: p.range }, rng, awardXp);
  if (p.lifesteal && r.total > 0) {
    caster.hp = s16(caster.hp + Math.trunc(3 * r.total / 10));
    if (caster.hp > caster.maxHp) caster.hp = caster.maxHp;
  }
  return { spent: true, failed: false, picks: [], ray: r };
}

// ================================================================ memorise and recharge

export interface SpellBook {
  /** 15 pages: head spell id of each page's chain (S_2 +0x1F2, +2) */
  pageHead: number[];
  /** spell id -> next spell in its page (byte +7 of the 8-byte spell record, 0xFF = end) */
  next: number[];
  /** spell id -> spell level (byte +6) */
  level: number[];
  /** spell id -> recharge timer in ticks (word +4); shared by all characters */
  timers: number[];
  /** page -> owned flag (page record byte +1) */
  owned: number[];
}

/**
 * Memorise click on row 0..3 of the open book page (S_1 +0x0F548, HARNESS). `cur` = the character's current page (+0x47).
 * Requires an owned page, a spell whose recharge timer is 0, a spell level <= character level (byte compare), and a free
 * slot among the five (first 0xFF). The timer starts at
 *   R = (L-1)*540 + 1260, reduced by 180 per level that (level + (signed)b6B) exceeds L, floored at 360,
 *   then R += R*T2[stat]/100 (truncating signed divide; stat = +0x66 for class 2 else +0x65), clamped to [60, 32767].
 */
export function memoriseClick(
  b: SpellBook, ch: { cls: number; level: number; b6b: number; w65: number; w66: number; cur: number; slots: number[] }, row: number, t2: number[],
): { memorised: number | null } {
  if (!b.owned[ch.cur]) return { memorised: null };
  let id = b.pageHead[ch.cur];
  for (let k = 0; k < row; k++) { if (id === 0xff) break; id = b.next[id]; }
  if (id === 0xff) return { memorised: null };
  if (b.timers[id] !== 0) return { memorised: null };
  if (ch.level < b.level[id]) return { memorised: null };
  const slot = ch.slots.findIndex(s => s === 0xff);
  if (slot < 0) return { memorised: null };
  const L = b.level[id];
  let R = (L - 1) * 540 + 1260;
  const eff = ch.level + s8(ch.b6b);
  if (L < eff) R -= (eff - L) * 180;
  if (R < 360) R = 360;
  const stat = ch.cls === 2 ? ch.w66 : ch.w65;
  R += Math.trunc(R * t2[stat] / 100);
  if (R > 0x7fff) R = 0x7fff;
  if (R < 0x3c) R = 0x3c;
  b.timers[id] = R;
  ch.slots[slot] = id;
  return { memorised: id };
}

/**
 * Spell recharge tick (the +0x10D2 section of the tick handler +0x8B2, HARNESS): for each of the 15 pages, every spell on it with a
 * nonzero timer loses 1 (2 when `resting` and the page's owner word (A4+0x19F8 + 2*page) names a character whose state byte
 * (A4+0x1A07 + owner) is 1). The page the active character has open (+0x47 of char A4+0x1A16) is skipped unless `showActive` (A4+0x1A18) is set.
 * `mem` = bytes A4+0x19F8 .. (the owner words and state bytes overlap there in the game; reads beyond it return 0).
 * Returns true when a timer on the open page reached 0 (redraw flag A4+0x1749).
 */
export function rechargeTick(
  b: SpellBook, o: { resting: boolean; showActive: boolean; openPage: number; mem: number[] },
): boolean {
  const mb = (i: number) => o.mem[i] ?? 0;
  const ownerOf = (page: number) => (mb(2 * page) << 8) | mb(2 * page + 1);
  let redraw = false;
  for (let page = 0; page < 15; page++) {
    let id = b.pageHead[page], reached = false;
    while (id !== 0xff) {
      const nxt = b.next[id];
      if (b.timers[id] !== 0 && !(page === o.openPage && !o.showActive)) {
        b.timers[id] = s16(b.timers[id] - 1);
        if (o.resting && mb(0x1a07 - 0x19f8 + ownerOf(page)) === 1) b.timers[id] = s16(b.timers[id] - 1);
        if (b.timers[id] <= 0) { b.timers[id] = 0; reached = true; }
      }
      id = nxt;
    }
    if (reached && page === o.openPage) redraw = true;
  }
  return redraw;
}

// ================================================================ monster special attacks: possession (bit 12) and flesh-to-stone (bit 13)

import { pickTarget, pickTargets } from './rules-monster';

export interface PossessIn {
  bit: 12 | 13; gfx: number; dir: number; pos: number; facing: number; maxHp: number; form: number[]; hp: number[];
  resist: number[]; shield: number[]; prot12: number[]; prot13: number[]; carried: number;
}
export interface PossessOut {
  /** DamageCharacter calls (char, dmg, kind, flag) */
  dmg: [number, number, number, number][];
  /** corpse object created for the possessed character (+0x175C4) */
  corpseFor: number | null;
  /** statue object created: (x, y) from the position table and the type byte 0x2F; the statue remembers the character */
  statue: { char: number; x: number; y: number } | null;
  gfx: number; hp: number; maxHp: number; carried: 'corpse' | number; sched: number; b0A: number;
}

/**
 * S_1 +0x98A8 bits 12 / 13 (HARNESS, real routine). Common prefix with bits 14 / 15 (see monsterSpecial): one-target pick (+0x97F0),
 * resist `rand8(100) < char+0x69`, magic shield `+0x83 && rand8(100) > 50`.
 *  - Bit 12 POSSESSION (only a gfx 0x80B7 monster; anything else does nothing): the two front targets are picked (+0x96E8), swapped when
 *    `rand16(100) > 50`, and the first one NOT protected (+0x8F == 0) is taken (none -> nothing). The target is killed (DamageCharacter
 *    with its full HP, kind 4, flag 0), a corpse object holding the carried-chain link is made, the monster becomes gfx 0x80B8 with
 *    HP = max HP = 150.
 *  - Bit 13 FLESH-TO-STONE (any monster): the picked target unless `+0x87 != 0`; killed the same way and a statue (type 0x2F,
 *    position from the S_2 table at +0x24C) remembering the character is created. HP of the monster is unchanged.
 */
export function monsterPossessStone(i: PossessIn, stonePos: [number, number][], rng: BcRng): PossessOut {
  const out: PossessOut = { dmg: [], corpseFor: null, statue: null, gfx: i.gfx, hp: 50, maxHp: i.maxHp, carried: i.carried, sched: 0, b0A: 0 };
  const tgt = pickTarget(i.dir, i.pos, i.facing, i.form, i.hp, rng);
  if (tgt === 4) return out;
  out.sched = 1; out.b0A = 1;
  if (rng.rand8(100) < (((i.resist[tgt] << 24) >> 24) & 0xffff)) return out;
  if (i.shield[tgt] && rng.rand8(100) > 50) return out;
  if (i.bit === 12) {
    if (i.gfx !== 0x80b7) return out;
    let [a, b] = pickTargets(i.dir, i.facing, i.form, i.hp);
    if (rng.rand16(100) > 50) [a, b] = [b, a];
    let t = a;
    if (t === 4 || i.prot12[t]) { t = b; if (t === 4 || i.prot12[t]) t = 4; }
    if (t === 4) return out;
    out.corpseFor = t; out.carried = 'corpse';
    out.dmg.push([t, i.hp[t], 4, 0]);
    out.gfx = 0x80b8; out.hp = 150; out.maxHp = 150;
  } else {
    if (i.prot13[tgt]) return out;
    out.dmg.push([tgt, i.hp[tgt], 4, 0]);
    const [x, y] = stonePos[tgt];
    out.statue = { char: tgt, x, y };
  }
  return out;
}

// ================================================================ facing-square spells: DISMISS (34), BINDING (43), REFRESH (46)

export interface FacingOut { cancelled: number[]; sched: { type: number; id: number }[]; killed: number[]; spent: boolean }

/**
 * DISMISS (S_1 +0x6902) and BINDING (+0x4A4E), cast on the square directly in front of the party.
 * Targets = pickSquareTargets of the next square; a wall bit on the party's own square in the facing direction blocks the spell.
 * DISMISS: skipped for gfx 0x80B2 / 0x80BE / 0x80C5; `thr = clamp(b2 + 7 - ((level-1)>>1), 2, 20)`; kills (HP := 0, XP awarded) iff `rand8(20)+1 >= thr`.
 * BINDING: `resist = clamp((maxHp/10 - level) * 20 + 50, 0, 100)` (secondary-record maxHp, caster level byte +0x5E; the target's alert byte +0x12 is bumped first); the monster is bound (its events cancelled and a type-1 event at now + 200)
 * iff `rand16(100) > resist` (a 16-bit draw).
 */
export function castFacing(
  w: RayWorld & { level: number; tick: number }, spell: 34 | 43, rng: BcRng,
  awardXp: Parameters<typeof castRay>[3],
): FacingOut {
  const out: FacingOut = { cancelled: [], sched: [], killed: [], spent: true };
  if ((cellAt(w, w.px, w.py) >>> (12 + w.facing)) & 1) return out;
  const [x, y] = stepPos(w.px, w.py, w.facing);
  const ids = pickSquareTargets(w, x, y);
  for (let k = 0; k < 2; k++) {
    const id = ids[k];
    if (id === 0 || (k === 1 && id === ids[0])) continue;
    const mon = w.objs[id], sec = w.objs[mon.S!];
    if (spell === 34) {
      sec.alert = b8(sec.alert! + 1);
      if (mon.gfx === 0x80b2 || mon.gfx === 0x80be || mon.gfx === 0x80c5) continue;
      const thr = Math.max(2, Math.min(20, mon.b2! + 7 - ((w.level - 1) >> 1)));
      if (rng.rand8(20) + 1 >= thr) {
        mon.hp = 0; out.killed.push(id); out.cancelled.push(id);
        const xps = awardXp(w.chars, { b2: mon.b2!, w6: sec.w6!, maxHp: sec.maxHp! }, rng);
        w.chars.forEach((c, i) => { c.xp = xps[i]; });
      }
    } else {
      const resist = Math.max(0, Math.min(100, (Math.trunc(sec.maxHp! / 10) - w.level) * 20 + 50));
      sec.alert = b8(sec.alert! + 1);
      if (rng.rand16(100) > resist) { out.cancelled.push(id); out.sched.push({ type: 1, id }); }
    }
  }
  return out;
}

/** REFRESH (S_1 +0x660C, HARNESS): zero the recharge timer of every spell of level < 5 on the pages of the caster's book, walked along the page chain (page record word +4, 0xFF ends) from the caster's first page (byte +0x46), whose owned flag is set. */
export function castRefresh(b: SpellBook, firstPage: number, pageNext: number[]): void {
  for (let p = firstPage; p !== 0xff && p < 15; p = pageNext[p]) {
    if (!b.owned[p]) continue;
    for (let id = b.pageHead[p]; id !== 0xff; id = b.next[id]) if (b.level[id] < 5) b.timers[id] = 0;
  }
}

// ================================================================ due-event handlers 0x1E..0x25 (buff expiry), tick handler +0x8B2 dispatch chain at S_1 +0x1F34

/** A4-relative byte memory the event handlers read and write (sparse: unread bytes are 0). */
export class A4Mem {
  m = new Map<number, number>();
  b(o: number): number { return this.m.get(o) ?? 0; }
  sb(o: number): number { return (this.b(o) << 24) >> 24; }
  w(o: number): number { return (this.b(o) << 8) | this.b(o + 1); }
  sw(o: number): number { return (this.w(o) << 16) >> 16; }
  setB(o: number, v: number) { this.m.set(o, v & 0xff); }
  setW(o: number, v: number) { this.setB(o, v >> 8); this.setB(o + 1, v); }
}
const CHAR = (k: number) => 0x1758 + 0xa8 * k;

/**
 * The expiry handlers of the due-event list (S_1 +0x1968 type 0x1E, +0x1AF8 0x1F, +0x1C04 0x20, +0x1C3E 0x21, +0x1D9A 0x23, +0x1E86 0x24,
 * +0x1E90 0x25), run from the dispatch chain at +0x1F34 up to the common exit +0x1F9C. HARNESS (see rules_oracle/make_vectors_events.py).
 * Event fields: a1 (node +5), a2 (+6), a3 (+7).
 *  0x1E  AC buff:      char a1: byte +0x82+a2 -= 1 (wraps, no floor); when a2 == 0 also AC (+0x62) -= a3.
 *  0x1F  stat buff:    char a1: byte +0x64+a2 -= a3, counter byte +0x78+a2 -= 1.
 *  0x20  compass:      word A4+0x1E28 -= 1.
 *  0x21  wizard sight: every living char (hp > 0) with byte +0x85 != 0: -= 1 and word A4+0x1E2A -= 1.
 *  0x23  detect trap:  same with +0x84 and word A4+0x1E2C.
 *  0x24  haste:        word A4+0x1E2E -= 1.
 *  0x25  PROTECTOR:    every char with signed +0x69 >= 75: -= 75; afterwards A4+0x1A1E = 1 (the Ram-boss stage variable) and redraw flag +0x1748 = 1.
 * UI redraw flags (A4+0x174C / 0x174D / 0x1748) follow the screen mode word A4+0x174A as in the original.
 */
export function applyExpiry(a: A4Mem, ev: { type: number; a1: number; a2: number; a3: number }): void {
  const mode = a.w(0x174a), alive = (k: number) => a.sw(CHAR(k) + 0x4e) > 0;
  const allFlags = () => { if (mode === 1 || mode === 10) a.setB(0x174c, 1); else if (mode === 3) a.setB(0x174d, 1); };
  switch (ev.type) {
    case 0x1e: {
      const c = CHAR(ev.a1);
      a.setB(c + 0x82 + ev.a2, a.b(c + 0x82 + ev.a2) - 1);
      if (ev.a2 === 0) a.setB(c + 0x62, a.sb(c + 0x62) - ev.a3);
      if (!alive(ev.a1)) break;
      if (mode === 1 || mode === 10) a.setB(0x174c, 1);
      else if (mode === 3 && a.w(0x1a14) === ev.a1) a.setB(0x174d, 1);
      break;
    }
    case 0x1f: {
      const c = CHAR(ev.a1);
      a.setB(c + 0x64 + ev.a2, a.sb(c + 0x64 + ev.a2) - ev.a3);
      a.setB(c + 0x78 + ev.a2, a.b(c + 0x78 + ev.a2) - 1);
      if (mode === 4 && a.w(0x1a16) === ev.a1) a.setB(0x174d, 1);
      break;
    }
    case 0x20:
      a.setW(0x1e28, a.w(0x1e28) - 1);
      if (a.w(0x1e28) === 0 && mode === 1 && a.b(0x1a26) === 0) a.setB(0x174d, 1);
      break;
    case 0x21:
      for (let k = 0; k < 4; k++) if (alive(k) && a.b(CHAR(k) + 0x85) !== 0) { a.setB(CHAR(k) + 0x85, a.b(CHAR(k) + 0x85) - 1); a.setW(0x1e2a, a.w(0x1e2a) - 1); }
      allFlags();
      break;
    case 0x23:
      for (let k = 0; k < 4; k++) if (alive(k) && a.b(CHAR(k) + 0x84) !== 0) { a.setB(CHAR(k) + 0x84, a.b(CHAR(k) + 0x84) - 1); a.setW(0x1e2c, a.w(0x1e2c) - 1); }
      if (a.w(0x1e2c) === 0) { a.setB(0x1748, 1); allFlags(); }
      break;
    case 0x24: a.setW(0x1e2e, a.w(0x1e2e) - 1); break;
    case 0x25:
      for (let k = 0; k < 4; k++) {
        if (a.sb(CHAR(k) + 0x69) < 0x4b) continue;
        a.setB(CHAR(k) + 0x69, a.b(CHAR(k) + 0x69) - 0x4b);
        if ((mode === 1 || mode === 10) && alive(k)) a.setB(0x174c, 1);
      }
      a.setW(0x1a1e, 1); a.setB(0x1748, 1);
      break;
    default: throw new Error('applyExpiry: event type ' + ev.type);
  }
}
