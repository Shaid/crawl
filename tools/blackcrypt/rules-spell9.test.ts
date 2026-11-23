import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng, type RuleTables } from './rules';
import { A4Mem } from './rules-spell';
import { castSpell9, openDoor, forceHammer, adjustWeight, adjustVitals, stepCost, swingCooldown, swingTail, hitReadyDelay } from './rules-spell9';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(gunzipSync(readFileSync(resolve(here, 'rules_oracle/vectors_spells9.json.gz'))).toString());
const T: RuleTables = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8')).tables;
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');

const build = (c: any): A4Mem => {
  const a = new A4Mem();
  for (const [k, o, v] of c.pokes as [string, number, number][]) { if (k === 'b') a.setB(o, v); else if (k === 'w') a.setW(o, v); else { a.setW(o, v >>> 16); a.setW(o + 2, v & 0xffff); } }
  return a;
};
/** run one case; returns the list of disagreements with the oracle (empty = match) */
export function runCase(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed);
  const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0;
  if (tweak) tweak(a);
  const r = castSpell9(a, rng, T, 0, tick);
  const d: string[] = [];
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  for (const [o, v] of theirs) if (mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}: oracle ${v} ts ${mine.get(o)}`);
  for (const [o, v] of mine) if (!theirs.has(o)) d.push(`mem ${o.toString(16)}: ts ${v} oracle none`);
  const spent = c.out.log.find((e: number[]) => e[0] === 0x4876), failed = c.out.log.find((e: number[]) => e[0] === 0x4960);
  if ((spent ? spent[1] >> 0 : undefined) !== r.spent && !(spent && (spent[1] & 0xffff) === r.spent)) d.push(`spent ${spent?.[1]} vs ${r.spent}`);
  if ((failed ? failed[1] : undefined) !== r.failed) d.push(`failed ${failed?.[1]} vs ${r.failed}`);
  const ev = c.out.log.filter((e: number[]) => e[0] === 0x5ea).map((e: number[]) => [e[1] >> 8, ((e[2] << 16) | e[3]) >>> 0, e[4] >> 8, e[5] >> 8, e[6] >> 8]);
  if (JSON.stringify(ev) !== JSON.stringify(r.events.map(e => [e.type, e.due, e.a1, e.a2, e.a3]))) d.push(`events ${JSON.stringify(ev)} vs ${JSON.stringify(r.events)}`);
  if (hex(rng) !== c.out.seed) d.push('seed');
  return d;
}
/** door / FORCEHAMMER / inventory-weight cases: same full-diff comparison */
export function runFam(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const d: string[] = [];
  if (tweak) tweak(a);
  let d0: number | undefined; const cancelled: number[] = []; const ui: number[] = [];
  if (c.fam === 'door') {
    openDoor(a, c.x, c.y);
  } else if (c.fam === 'hammer') { forceHammer(a, cancelled); d0 = 1; }
  else if (c.fam === 'vitals') { ui.push(...(adjustVitals(a, T.statBonusT1, c.ch, c.dE & 0xffff, c.dF & 0xffff, c.dW & 0xffff) ? [c.ch] : [])); }
  else if (c.fam === 'step') ui.push(...stepCost(a, T.statBonusT1));
  else if (c.fam === 'cool') { const v = swingCooldown(a, T.speedT3, c.ch, c.item); if (v !== c.out.a3) d.push(`cooldown ${c.out.a3} vs ${v}`); }
  else if (c.fam === 'ready') {
    const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0; const evs: number[][] = [];
    swingTail(a, T.statBonusT1, c.ch, c.hand, c.a3, tick, !!c.flag, (...e) => evs.push(e));
    const evO = c.out.log.filter((e: number[]) => e[0] === 0x5ea).map((e: number[]) => [e[1] >> 8, ((e[2] << 16) | e[3]) >>> 0, e[4] >> 8, e[5] >> 8, e[6] >> 8, e[7] >> 8]);
    if (JSON.stringify(evO) !== JSON.stringify(evs)) d.push(`events ${JSON.stringify(evO)} vs ${JSON.stringify(evs)}`);
    if (c.flag) ui.push(...[]);
  }
  else d0 = adjustWeight(a, c.ch, c.add, c.rem);
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  for (const [o, v] of theirs) if (mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}: oracle ${v} ts ${mine.get(o)}`);
  for (const [o, v] of mine) if (!theirs.has(o)) d.push(`mem ${o.toString(16)}: ts ${v} oracle none`);
  if (d0 !== undefined && (c.out.d0 & 0xffff) !== d0) d.push(`ret ${c.out.d0} vs ${d0}`);
  const canc = c.out.log.filter((e: number[]) => e[0] === 0xb25a).map((e: number[]) => e[1]);
  if (JSON.stringify(canc) !== JSON.stringify(cancelled)) d.push(`cancel ${canc} vs ${cancelled}`);
  const uiO = c.out.log.filter((e: number[]) => e[0] === 0x170a8).map((e: number[]) => e[1]);
  if ((c.fam === 'vitals' || c.fam === 'step') && JSON.stringify(uiO) !== JSON.stringify(ui)) d.push(`ui ${uiO} vs ${ui}`);
  return d;
}
const bySpell = new Map<number, any[]>(); const byFam = new Map<string, any[]>();
for (const c of V.cases) { if (c.fam) { if (!byFam.has(c.fam)) byFam.set(c.fam, []); byFam.get(c.fam)!.push(c); continue; } if (!bySpell.has(c.spell)) bySpell.set(c.spell, []); bySpell.get(c.spell)!.push(c); }
const NAMES: Record<number, string> = { 10: 'CREATE FOOD', 2: 'REVEAL TRUTH', 51: 'DISPEL ILLUSION', 41: 'REMOVE TRAP', 26: 'READ RUNE', 22: 'DISPEL MAGIC', 24: 'DISPEL MAGIC (2nd page)', 21: 'REMOVE GLYPH', 44: 'CREATE WALL' };

describe('the nine formerly code-read spells (real +0x7044 dispatcher in musashi) vs TS', () => {
  for (const [sp, cs] of bySpell) {
    it(`${NAMES[sp]} (${sp}): every changed byte, hook call, event and RNG state matches on ${cs.length} cases`, () => {
      const bad: string[] = [];
      for (const c of cs) { const d = runCase(c); if (d.length) bad.push(d.slice(0, 3).join('; ')); }
      expect(bad.slice(0, 3)).toEqual([]);
    });
  }
  it('every spell has real effects in the vectors (not only no-op cases)', () => {
    for (const [sp, cs] of bySpell) {
      const eff = cs.filter(c => Object.keys(c.out.diff).some(k => +k !== 0x1e86)).length;
      expect(eff, NAMES[sp]).toBeGreaterThan(cs.length / 4);
    }
  });
  it('DISPEL MAGIC follows its linked group: some cases remove two or more fields', () => {
    let multi = 0;
    for (const c of [...bySpell.get(22)!, ...bySpell.get(24)!]) {
      const cellWords = Object.keys(c.out.diff).filter(k => +k >= -0x37ca && +k < -0x37ca + 0x4000);
      if (new Set(cellWords.map(k => (+k - (-0x37ca)) >> 2)).size >= 2) multi++;
    }
    expect(multi).toBeGreaterThan(2);
  });
  // null controls: a deliberate change to the TS-side input must be seen as a disagreement
  const control = (sp: number, tweak: (a: A4Mem) => void, min: number) => {
    let diff = 0; for (const c of bySpell.get(sp)!) if (runCase(c, tweak).length) diff++;
    expect(diff).toBeGreaterThan(min);
  };
  const act = (a: A4Mem) => 0x1758 + 0xa8 * a.w(0x1a14);
  it('null control: CREATE FOOD with the caster one level lower (3 fewer objects, different RNG draws) disagrees', () => control(10, a => a.setB(act(a) + 0x5e, a.b(act(a) + 0x5e) - 3), 40));
  it('null control: REMOVE TRAP facing the other way disagrees', () => control(41, a => a.setW(0x1744, (a.w(0x1744) + 1) & 3), 8));
  it('null control: REVEAL TRUTH with weights ignored (all carried weights 0) disagrees', () => control(2, a => { for (let k = 0; k < 4; k++) { a.setW(0x1758 + 0xa8 * k + 0xa4, 0); a.setW(0x1758 + 0xa8 * k + 0xa6, 0); } }, 3));
  it('null control: CREATE WALL one level higher moves the scheduled event', () => control(44, a => a.setB(act(a) + 0x5e, a.b(act(a) + 0x5e) + 1), 10));
  it('null control: READ RUNE not facing a rune (byte != 0x6A) disagrees', () => control(26, a => a.setB(-0x779a, 0), 5));

  for (const fam of ['door', 'hammer', 'weight', 'vitals', 'step', 'cool', 'ready']) {
    it(`${fam}: every changed byte, return value and cancelled event matches on ${byFam.get(fam)?.length} cases`, () => {
      const bad: string[] = [];
      for (const c of byFam.get(fam)!) { const d = runFam(c); if (d.length) bad.push(d.slice(0, 3).join('; ')); }
      expect(bad.slice(0, 3)).toEqual([]);
    });
  }
  it('door / hammer / weight vectors cover both outcomes', () => {
    expect(byFam.get('hammer')!.filter(c => Object.keys(c.out.diff).length > 0).length).toBeGreaterThan(8);
    const w = byFam.get('weight')!; expect(w.filter(c => (c.out.d0 & 0xffff) === 1).length).toBeGreaterThan(20); expect(w.filter(c => (c.out.d0 & 0xffff) === 0).length).toBeGreaterThan(20);
    expect(byFam.get('door')!.filter(c => Object.keys(c.out.diff).length > 0).length).toBeGreaterThan(30);
  });
  const famControl = (fam: string, tweak: (a: A4Mem) => void, min: number) => {
    let diff = 0; for (const c of byFam.get(fam)!) if (runFam(c, tweak).length) diff++;
    expect(diff).toBeGreaterThan(min);
  };
  it('null control: FORCEHAMMER with the stage one lower does nothing and disagrees on the effective cases', () => famControl('hammer', a => a.setW(0x1a1e, a.w(0x1a1e) === 4 ? 3 : 4), 8));
  it('null control: weight with the strength limit halved disagrees', () => famControl('weight', a => { for (let k = 0; k < 4; k++) a.setB(0x1758 + 0xa8 * k + 0x6e, 1); }, 10));
  it('null control: facing the other way moves FORCEHAMMER off the boss', () => famControl('hammer', a => a.setW(0x1744, (a.w(0x1744) + 2) & 3), 4));
  it('vitals / step vectors include tired crossings and weight-driven energy costs', () => {
    expect(byFam.get('vitals')!.filter(c => c.out.log.some((e: number[]) => e[0] === 0x170a8)).length).toBeGreaterThan(5);
    expect(byFam.get('step')!.filter(c => c.out.log.some((e: number[]) => e[0] === 0x170a8)).length).toBeGreaterThan(5);
  });
  it('null control: the step cost without the weight term disagrees', () => famControl('step', a => { for (let k = 0; k < 4; k++) { a.setW(0x1758 + 0xa8 * k + 0xa4, 0); a.setW(0x1758 + 0xa8 * k + 0xa6, 0); } }, 50));
  it('null control: AdjustVitals ignoring the sustenance byte disagrees', () => famControl('vitals', a => { for (let k = 0; k < 4; k++) a.setB(0x1758 + 0xa8 * k + 0x90, 0); }, 8));
  it('swing (real +0x1451E): event 0x15 is scheduled exactly on hits, at tick + hitReadyDelay', () => {
    const hpo = -0x6e7a + 0x14 + 8; let hits = 0, misses = 0;
    for (const c of byFam.get('swing') ?? []) {
      const last = (o: number) => [...c.pokes].reverse().find((p: any) => p[1] === o)[2];
      const haste = last(0x1e2e) !== 0;
      const ev = c.out.log.filter((e: number[]) => e[0] === 0x5ea);
      const hit = (String(hpo) in c.out.diff) || (String(hpo + 1) in c.out.diff);
      expect(ev.length).toBe(hit ? 1 : 0);
      if (hit) { hits++; expect(e0(ev[0]) - lastTick(c)).toBe(hitReadyDelay(haste, c.delay)); expect(ev[0][1] >> 8).toBe(0x15); } else misses++;
    }
    expect(hits).toBeGreaterThan(10); expect(misses).toBeGreaterThan(10);
  });
  it('swing cooldown / tail vectors cover the haste, bare-hand and heavy-weapon cases', () => {
    expect(byFam.get('cool')!.filter(c => c.item === 0).length).toBeGreaterThan(5);
    expect(byFam.get('cool')!.filter(c => c.out.a3 > 5).length).toBeGreaterThan(5);
    expect(byFam.get('ready')!.filter(c => c.out.log.some((e: number[]) => e[0] === 0x5ea)).length).toBeGreaterThan(30);
  });
  it('null control: the cooldown with every weapon weighing 0 disagrees', () => famControl('cool', a => { for (const id of [5, 6]) a.setW(-0x6e7a + 0x14 * id + 8, 0); }, 5));
  it('null control: the swing tail without haste disagrees on the hasted cases', () => famControl('ready', a => a.setW(0x1e2e, 0), 10));
});
const e0 = (e: number[]) => ((e[2] << 16) | e[3]) >>> 0;
const lastTick = (c: any) => { const l = [...c.pokes].reverse().filter((p: any) => p[1] === 0x1750)[0][2]; return l >>> 0; };
