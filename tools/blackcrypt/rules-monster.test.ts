import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng } from './rules';
import { monsterMelee, awardXp, runBehaviour, hpAtLeastMorale, vitalsTick, monsterSpecial, VM_CALLS, type AiScripts, type VmResult, type TickCall } from './rules-monster';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8'));
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');

const meleeIn = (c: any[]) => ({
  gfx: c[1], b2: c[2], b3: c[3], b6: c[4], maxHp: c[5], px: c[6], py: c[7], mx: c[8], my: c[9], facing: c[10], pos: c[11], op: c[12], flag: c[13],
  form: c.slice(14, 18), hp: c.slice(18, 22), ac: c.slice(22, 26), s0f: c[1] === 0x80b9 ? c[26] : 1,
});

describe('monster melee (real 9D28) vs TS', () => {
  const run = (c: any, tweak = false) => {
    const rng = new BcRng(c.in[0]);
    const inp = meleeIn(c.in);
    if (tweak) inp.ac = inp.ac.map((a: number) => a + 4); // null control: perturbed armour term
    return { o: monsterMelee(inp, rng), seed: hex(rng) };
  };
  it('matches the oracle on 2500 cases (return, damage list, flags, RNG state)', () => {
    for (const c of V.mmelee) {
      const { o, seed } = run(c);
      expect({ ret: o.ret, outflag: o.outflag, s0f: o.s0f, s0a: o.s0a, dmg: o.dmg, sched: o.sched, seed })
        .toEqual({ ret: c.ret, outflag: c.outflag, s0f: c.s0f, s0a: c.s0a, dmg: c.dmg, sched: c.sched, seed: c.seedAfter });
    }
  });
  it('null control: armour perturbation disagrees', () => {
    const bad = V.mmelee.filter((c: any) => JSON.stringify(run(c, true).o.dmg) !== JSON.stringify(c.dmg)).length;
    expect(bad).toBeGreaterThan(20);
  });
  it('covers attacks, misses and hits', () => {
    expect(V.mmelee.filter((c: any) => c.outflag).length).toBeGreaterThan(100);
    expect(V.mmelee.filter((c: any) => c.dmg.length).length).toBeGreaterThan(50);
  });
});

describe('monster death XP (real 7ED0) vs TS', () => {
  const run = (c: any, tweak = false) => {
    const f = c.in; const rng = new BcRng(f[0]);
    const chars = [0, 1, 2, 3].map(i => ({ hp: f[4 + i], xp: f[8 + i] }));
    const xp = awardXp(chars, { b2: f[1], w6: f[2] + (tweak ? 1 : 0), maxHp: f[3] }, rng);
    return { xp, seed: hex(rng) };
  };
  it('matches the oracle on 400 cases', () => {
    for (const c of V.xp) expect(run(c)).toEqual({ xp: c.xp, seed: c.seedAfter });
  });
  it('null control', () => {
    expect(V.xp.filter((c: any) => JSON.stringify(run(c, true).xp) !== JSON.stringify(c.xp)).length).toBeGreaterThan(300);
  });
});

describe('behaviour VM (real AAFC) vs TS', () => {
  const sc: AiScripts = V.aiScripts;
  const run = (c: any, tweakOp = false): { r: VmResult; seed: string } => {
    const f = c.in; const rng = new BcRng(f[0]);
    const scripts: AiScripts = tweakOp ? { starts: sc.starts, cells: sc.cells.map(x => (x[0] === 5 ? [5, x[1], x[2] + 1, x[3]] : x)) as any } : sc;
    const m = { gfx: f[9], b3: f[6], b5: f[3], b7: f[8], hp: f[4], w0c: f[7], type: f[1], pc: f[2], maxHp: f[5], s0e: 0, vars: f.slice(15, 23) } as any;
    // oracle input: seed type pc sp hp mhp b3 w0c b7 gfx px py x rc y vars(8) s11 s12 f
    m.vars[2] = f[23]; m.vars[3] = f[24]; // S+0x11/0x12 alias vars[2]/[3]
    const w = { px: f[10], py: f[11], x: f[12], y: f[14], hookRet: f[13], tick: 1000, a1e8e: 0 };
    const r = runBehaviour(m, w, scripts, rng, hpAtLeastMorale);
    return { r, seed: hex(rng) };
  };
  const SEEN: number[] = [VM_CALLS.move, VM_CALLS.attack, VM_CALLS.spell, VM_CALLS.special, VM_CALLS.step, VM_CALLS.flee, VM_CALLS.steal, VM_CALLS.message, VM_CALLS.sched];
  it('matches the oracle on all cases (state, call sequence, scheduled event, RNG state)', () => {
    let n = 0;
    for (const c of V.ai) {
      const { r, seed } = run(c);
      const m = r.m;
      expect([m.pc, m.hp, m.maxHp, m.gfx, m.b7, m.type, m.s0e, ...m.vars]).toEqual([c.pc, c.pHp, c.sMax, c.gfx, c.b7, c.type, c.s0e, ...c.vars]);
      expect(seed).toBe(c.seedAfter);
      const got = r.calls.map(x => x.off);
      const exp = c.log.filter((e: any) => e.off !== VM_CALLS.sched && SEEN.includes(e.off)).map((e: any) => e.off);
      expect(got).toEqual(exp);
      const ev = c.log.find((e: any) => e.off === VM_CALLS.sched);
      if (ev) {
        expect(r.event).not.toBeNull();
        expect([ev.w[0] >> 8, (ev.w[1] << 16) | ev.w[2], ev.w[3] >> 8, ev.w[4] >> 8]).toEqual([1, r.event!.due, r.event!.a1, r.event!.a2]);
      } else expect(r.event).toBeNull();
      n++;
    }
    expect(n).toBeGreaterThan(1000);
  });
  it('executes every decoded opcode except STEP_RANDOM with free directions and ACT_SPECIAL internals', () => {
    const seen = new Set<number>();
    for (const c of V.ai) run(c).r.ops.forEach(o => seen.add(o));
    for (const op of [2, 3, 4, 5, 6, 9, 0x0a, 0x0b, 0x0d, 0x0e, 0x10, 0x12, 0x13, 0x16, 0x19, 0x1c, 0x1d, 0x1e, 0x21, 0x22, 0x24, 0x27, 0x28, 0x29, 0x2b, 0xff]) {
      expect(seen.has(op), `op ${op.toString(16)} never executed`).toBe(true);
    }
  });
  it('null control: a one-tick longer movement speed disagrees', () => {
    let bad = 0;
    for (const c of V.ai) {
      const f = c.in; const rng = new BcRng(f[0]);
      const m = { gfx: f[9], b3: f[6], b5: f[3] + 1, b7: f[8], hp: f[4], w0c: f[7], type: f[1], pc: f[2], maxHp: f[5], s0e: 0, vars: f.slice(15, 23) } as any;
      m.vars[2] = f[23]; m.vars[3] = f[24];
      const r = runBehaviour(m, { px: f[10], py: f[11], x: f[12], y: f[14], hookRet: f[13], tick: 1000, a1e8e: 0 }, sc, rng, hpAtLeastMorale);
      const ev = c.log.find((e: any) => e.off === VM_CALLS.sched);
      if (ev && r.event && r.event.due !== ((ev.w[1] << 16) | ev.w[2])) bad++;
    }
    expect(bad).toBeGreaterThan(100);
  });
});

describe('tick handler vitals (real 8B2) vs TS', () => {
  const run = (c: any, tweak = false) => {
    const rng = new BcRng(c.in.seed);
    const chars = c.in.chars.map((x: number[]) => ({ hp: x[0], maxHp: x[1], level: x[2], food: x[3], water: x[4], poison: x[5], disease: x[6], regen: x[7], prot86: x[8], state: x[9] }));
    const r = vitalsTick({ t: c.in.t + (tweak ? 64 : 0), resting: !!c.in.resting, hazard: !!c.in.hazard, light: c.in.light, hold: c.in.hold, chars }, rng);
    return r;
  };
  const enc = (calls: TickCall[]) => calls.map(k => k.kind === 'scan' ? ['b614', 0, 0, 0, 0] : k.kind === 'adjust' ? ['17eea', k.char, k.energy & 0xffff, k.food & 0xffff, k.water & 0xffff] : ['17686', k.char, k.dmg, k.type, 1]);
  it('matches the oracle on 1500 cases (hp, counters, call sequence incl. RNG-dependent damage)', () => {
    for (const c of V.tick) {
      const r = run(c);
      expect({ hp: r.hp, light: r.light, hold: r.hold, calls: enc(r.calls) }).toEqual({ hp: c.hp, light: c.light, hold: c.hold, calls: c.calls });
    }
  });
  it('covers every periodic section', () => {
    const kinds = new Set<string>();
    for (const c of V.tick) for (const k of c.calls) kinds.add(k[0] + ':' + (k[0] === '17686' ? k[3] : ''));
    for (const k of ['b614:', '17eea:', '17686:4', '17686:5', '17686:6']) expect(kinds.has(k), k).toBe(true);
  });
  it('null control: shifting the tick by 64 disagrees', () => {
    const bad = V.tick.filter((c: any) => JSON.stringify(enc(run(c, true).calls)) !== JSON.stringify(c.calls)).length;
    expect(bad).toBeGreaterThan(200);
  });
});

describe('monster special attacks, disease and poison (real 98A8) vs TS', () => {
  const run = (c: any, tweak = false) => {
    const f = c.in; const rng = new BcRng(f[0]);
    const r = monsterSpecial({ bit: f[1], dir: f[2], pos: f[3], facing: f[4], maxHp: f[5], form: f.slice(6, 10), hp: f.slice(10, 14), resist: f.slice(14, 18), shield: f.slice(18, 22), prot: f.slice(22, 26), con: f.slice(26, 30) }, tweak ? V.tables.statBonusT1.map(() => 0) : V.tables.statBonusT1, rng);
    return { r, seed: hex(rng) };
  };
  it('matches the oracle on 1500 cases', () => {
    for (const c of V.special) {
      const { r, seed } = run(c);
      expect({ dmg: r.dmg, poison: r.poison, disease: r.disease, sched: r.sched, seed }).toEqual({ dmg: c.dmg, poison: c.poison, disease: c.disease, sched: c.sched, seed: c.seedAfter });
    }
  });
  it('covers both statuses landing and being resisted', () => {
    expect(V.special.filter((c: any) => c.dmg.some((d: number[]) => d[2] === 5)).length).toBeGreaterThan(100);
    expect(V.special.filter((c: any) => c.dmg.some((d: number[]) => d[2] === 6)).length).toBeGreaterThan(30);
  });
  it('null control: zeroing the constitution table changes disease outcomes', () => {
    expect(V.special.filter((c: any) => c.in[1] === 14 && JSON.stringify(run(c, true).r.dmg) !== JSON.stringify(c.dmg)).length).toBeGreaterThan(10);
  });
});
