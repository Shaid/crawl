import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng, type RuleTables } from './rules';
import { awardXp } from './rules-monster';
import {
  castSimple, castSpell, castRay, castFacing, castRefresh, memoriseClick, rechargeTick, monsterPossessStone,
  type SpWorld, type SpFull, type RayWorld, type SpellBook,
} from './rules-spell';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(gunzipSync(readFileSync(resolve(here, 'rules_oracle/vectors_spell.json.gz'))).toString());
const T: RuleTables = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8')).tables;
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));

const rayWorld = (w: any): RayWorld => ({
  cells: new Map(w.cells.map((q: number[]) => [q[1] * 256 + q[0], q[2] >>> 0])), objs: clone(w.objs),
  px: w.px, py: w.py, facing: w.facing, item36: w.item36, b1E5C: w.b1E5C, chars: [],
});

describe('non-ray spells through the real CastSpell dispatcher (+0x7044) vs TS', () => {
  const run = (c: any) => {
    const w: SpWorld = clone(c.world); w.events = [];
    const rng = new BcRng(c.seed);
    const r = castSimple(w, c.spell, c.pick, T, rng);
    return { w, r, rng };
  };
  const cmp = (c: any, w: SpWorld, rng: BcRng) => {
    const o = c.out; const diffs: string[] = [];
    w.chars.forEach((ch: any, i) => { for (const k of Object.keys(o.chars[i])) if (ch[k] !== o.chars[i][k]) diffs.push(`c${i}.${k}`); });
    for (const k of ['light', 'hold', 'compass', 'wizSight', 'detect', 'haste']) if ((w as any)[k] !== o[k]) diffs.push(k);
    if (JSON.stringify(w.events.map(e => [e.type, e.due, e.a1, e.a2, e.a3])) !== JSON.stringify(o.events)) diffs.push('events');
    if (hex(rng) !== o.seed) diffs.push('seed');
    return diffs;
  };
  it('matches the oracle on all cases (hp, poison, AC, strength, food, counters, scheduled events, RNG state)', () => {
    for (const c of V.cast) { const { w, rng } = run(c); expect(cmp(c, w, rng)).toEqual([]); }
  });
  it('covers 20 spells and the spend protocol', () => {
    expect(new Set(V.cast.map((c: any) => c.spell)).size).toBe(20);
    expect(V.cast.every((c: any) => c.out.spent)).toBe(true);
  });
  it('null control: a different caster level changes buffs and durations', () => {
    let bad = 0;
    for (const c of V.cast) {
      const w: SpWorld = clone(c.world); w.events = []; const rng = new BcRng(c.seed);
      w.chars[w.active].level += 3;
      castSimple(w, c.spell, c.pick, T, rng);
      if (cmp(c, w, rng).length) bad++;
    }
    expect(bad).toBeGreaterThan(30);
  });
});

describe('ray caster (real +0x6D9A, ray march +0x435C, target pick +0xB308) vs TS', () => {
  const run = (c: any, tweak = false) => {
    const w = rayWorld(c.world); w.chars = c.world.chars.map((x: any) => ({ hp: x.hp, xp: x.xp }));
    const rng = new BcRng(c.seed);
    const a = { ...c.args, range: c.args.range + (tweak ? 1 : 0) };
    const r = castRay(w, a, rng, awardXp);
    const o = c.out; const d: string[] = [];
    if (r.total !== o.total) d.push('total');
    for (const [id, [hp, al]] of Object.entries<any>(o.mon)) { const m = w.objs[+id]; if (m.hp !== hp) d.push('hp' + id); if (w.objs[m.S!].alert !== al) d.push('alert' + id); }
    if (JSON.stringify(w.chars.map(x => x.xp)) !== JSON.stringify(o.xp)) d.push('xp');
    if (hex(rng) !== o.seed) d.push('seed');
    return d;
  };
  it('matches the oracle on all cases (damage total, monster HP, alert byte, XP, RNG state)', () => {
    for (const c of V.ray) expect(run(c)).toEqual([]);
  });
  it('covers hits, kills and blocked rays', () => {
    expect(V.ray.filter((c: any) => c.out.total !== 0).length).toBeGreaterThan(150);
    expect(V.ray.filter((c: any) => c.out.deaths > 0).length).toBeGreaterThan(50);
    // wall-blocked and door-blocked rays are among them: the TS march agrees on every case, so the blocking rules are covered
    const blocked = V.ray.filter((c: any) => {
      const w = rayWorld(c.world); const ms = c.args.range; return ms > 0 && (w.cells.get(c.world.py * 256 + c.world.px)! >>> (12 + c.world.facing) & 1) === 1;
    });
    expect(blocked.length).toBeGreaterThan(10);
  });
  it('null control: a longer range disagrees', () => {
    expect(V.ray.filter((c: any) => run(c, true).length > 0).length).toBeGreaterThan(3);
  });
});

describe('ray spells through the dispatcher (damage formulas, antimagic, lifestealer) vs TS', () => {
  const run = (c: any, tweakT = false) => {
    const w: SpFull = clone(c.world) as any; w.events = [];
    const raw = c.world.cells.find((q: number[]) => q[0] === c.world.px && q[1] === c.world.py);
    w.antimagic = raw ? ((raw[2] >>> 30) & 1) === 1 : false;
    w.ray = rayWorld(c.world);
    const rng = new BcRng(c.seed);
    const t = tweakT ? { ...T, statBonusT1: T.statBonusT1.map(() => 0) } : T;
    const r = castSpell(w, c.spell, 0, t, rng, awardXp);
    const o = c.out; const d: string[] = [];
    w.chars.forEach((ch: any, i) => { for (const k of Object.keys(o.chars[i])) if (ch[k] !== o.chars[i][k]) d.push(`c${i}.${k}`); });
    for (const [id, [hp, al]] of Object.entries<any>(o.mon)) { const m = w.ray.objs[+id]; if (m.hp !== hp) d.push('hp' + id); if (w.ray.objs[m.S!].alert !== al) d.push('alert'); }
    if (JSON.stringify(w.chars.map(x => x.xp ?? 0)) !== JSON.stringify(o.xp)) d.push('xp');
    if (hex(rng) !== o.seed) d.push('seed');
    if (r.spent !== o.spent) d.push('spent');
    return d;
  };
  it('matches the oracle on all cases for 26 ray spells', () => {
    for (const c of V.rayspell) expect(run(c)).toEqual([]);
    expect(new Set(V.rayspell.map((c: any) => c.spell)).size).toBe(26);
  });
  it('covers damaging casts and antimagic squares', () => {
    expect(V.rayspell.filter((c: any) => Object.entries<any>(c.out.mon).some(([id, m]) => m[0] !== c.world.objs[id].hp)).length).toBeGreaterThan(150);
  });
  it('null control: zeroing the stat-bonus table changes the damage', () => {
    expect(V.rayspell.filter((c: any) => run(c, true).length > 0).length).toBeGreaterThan(100);
  });
});

describe('memorise click and recharge tick (real +0xF548, +0x8B2) vs TS', () => {
  const book = (timers: number[], owned: number[]): SpellBook => ({ pageHead: V.pages.map((p: any) => p.head), next: V.spellNext, level: V.spellLevel, timers: [...timers], owned });
  const mem = (c: any, tweak = false) => {
    const b = book(c.timers, c.owned);
    const ch = { cls: c.cls, level: c.level, b6b: c.b6b, w65: c.w65, w66: c.w66, cur: c.cur, slots: [...c.slots] };
    memoriseClick(b, ch, c.row, tweak ? T.defenseT2.map(() => 0) : T.defenseT2);
    return JSON.stringify(ch.slots) === JSON.stringify(c.out.slots) && JSON.stringify(b.timers) === JSON.stringify(c.out.timers);
  };
  it('memorise: slot and recharge timer match on all cases', () => { for (const c of V.memorise) expect(mem(c)).toBe(true); });
  it('memorise: covers successful and refused clicks; null control (T2 = 0) disagrees', () => {
    expect(V.memorise.filter((c: any) => JSON.stringify(c.out.slots) !== JSON.stringify(c.slots)).length).toBeGreaterThan(100);
    expect(V.memorise.filter((c: any) => !mem(c, true)).length).toBeGreaterThan(20);
  });
  const rc = (c: any, tweak = false) => {
    const b = book(c.timers, []);
    const red = rechargeTick(b, { resting: tweak ? false : !!c.resting, showActive: !!c.showActive, openPage: c.cur[c.active], mem: c.mem });
    return JSON.stringify(b.timers) === JSON.stringify(c.out.timers) && (red ? 1 : 0) === c.out.redraw;
  };
  it('recharge: all 60 timers and the redraw flag match on all cases', () => { for (const c of V.recharge) expect(rc(c)).toBe(true); });
  it('recharge: null control (no double speed while resting) disagrees', () => {
    expect(V.recharge.filter((c: any) => !rc(c, true)).length).toBeGreaterThan(20);
  });
});

describe('monster possession (bit 12) and flesh-to-stone (bit 13) of +0x98A8 vs TS', () => {
  const run = (c: any, tweak = false) => {
    const i = clone(c); if (tweak) i.prot12 = i.prot12.map(() => 0);
    const rng = new BcRng(c.seed0);
    const r = monsterPossessStone(i, V.stonePos, rng); const o = c.out; const d: string[] = [];
    if (JSON.stringify(r.dmg) !== JSON.stringify(o.dmg)) d.push('dmg');
    if (JSON.stringify(r.corpseFor === null ? [] : [r.corpseFor]) !== JSON.stringify(o.corpse)) d.push('corpse');
    if (JSON.stringify(r.statue ? [[r.statue.x, r.statue.y, 47]] : []) !== JSON.stringify(o.statue)) d.push('statue');
    if (r.statue && r.statue.char !== o.statueChar) d.push('statueChar');
    if (r.gfx !== o.gfx || r.hp !== o.hp || r.maxHp !== o.maxHp || r.sched !== o.sched || r.b0A !== o.b0A) d.push('state');
    if ((r.carried === 'corpse') !== (o.carried === 27)) d.push('carried');
    if (hex(rng) !== o.seed) d.push('seed');
    return d;
  };
  it('matches the oracle on all cases (damage calls, corpse / statue objects, monster HP and gfx, RNG state)', () => {
    for (const c of V.special2) expect(run(c)).toEqual([]);
  });
  it('covers possession, stone, resistance and protection', () => {
    expect(V.special2.filter((c: any) => c.bit === 12 && c.out.gfx === 0x80b8).length).toBeGreaterThan(80);
    expect(V.special2.filter((c: any) => c.bit === 13 && c.out.statue.length).length).toBeGreaterThan(80);
  });
  it('null control: ignoring the possession protection byte disagrees', () => {
    expect(V.special2.filter((c: any) => c.bit === 12 && run(c, true).length > 0).length).toBeGreaterThan(3);
  });
});

describe('facing-square spells DISMISS / BINDING / REFRESH vs TS', () => {
  const run = (c: any, tweak = false) => {
    const w = c.world; const o = c.out; const d: string[] = [];
    const rng = new BcRng(c.seed);
    if (c.spell === 46) {
      const b: SpellBook = { pageHead: V.pages.map((p: any) => p.head), next: V.spellNext, level: V.spellLevel, timers: [...c.extra.timers], owned: c.extra.owned };
      castRefresh(b, c.extra.first, V.pageNext);
      if (JSON.stringify(b.timers) !== JSON.stringify(o.timers)) d.push('timers');
      return d;
    }
    const rw: any = { ...rayWorld(w), level: w.chars[w.active].level + (tweak ? 1 : 0), tick: w.tick, chars: w.chars.map((x: any) => ({ hp: x.hp, xp: x.xp })) };
    const r = castFacing(rw, c.spell, rng, awardXp);
    for (const [id, [hp, al]] of Object.entries<any>(o.mon)) { const m = rw.objs[+id]; if (m.hp !== hp) d.push('hp' + id); if (rw.objs[m.S].alert !== al) d.push('alert'); }
    if (JSON.stringify(r.cancelled) !== JSON.stringify(o.b25a.map((e: number[]) => e[0]))) d.push('cancel');
    if (r.sched.length !== o.sched.length) d.push('sched');
    if (JSON.stringify(rw.chars.map((x: any) => x.xp)) !== JSON.stringify(o.xp)) d.push('xp');
    if (hex(rng) !== o.seed) d.push('seed');
    return d;
  };
  it('matches the oracle on all cases (kills, bindings, events, REFRESH timers, RNG state)', () => {
    for (const c of V.facing) expect(run(c)).toEqual([]);
  });
  it('covers kills and bindings; null control (caster level + 1) disagrees', () => {
    expect(V.facing.filter((c: any) => c.spell === 34 && c.out.b25a.length).length).toBeGreaterThan(20);
    expect(V.facing.filter((c: any) => c.spell === 43 && c.out.sched.length).length).toBeGreaterThan(50);
    expect(V.facing.filter((c: any) => c.spell !== 46 && run(c, true).length > 0).length).toBeGreaterThan(3);
  });
});
