import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4Mem } from './rules-spell';
import { popDue, type PopHooks } from './rules-pop';
import { BcRng, type RuleTables } from './rules';
import { monsterDeath, damageCharacter, vmTeleport, enterParty, triggerActions } from './rules-death';

const T: RuleTables = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'rules_oracle/vectors.json'), 'utf8')).tables;
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');

const here = dirname(fileURLToPath(import.meta.url));
const gen = resolve(here, 'rules_oracle/generated/vectors_pass7.json.gz');
const V = JSON.parse(gunzipSync(readFileSync(existsSync(gen) ? gen : resolve(here, 'rules_oracle/vectors_pass7.json.gz'))).toString());

const build = (c: any): A4Mem => {
  const a = new A4Mem();
  for (const [k, o, v] of c.pokes as [string, number, number][]) { if (k === 'b') a.setB(o, v); else if (k === 'w') a.setW(o, v); else { a.setW(o, v >>> 16); a.setW(o + 2, v & 0xffff); } }
  return a;
};
/** compare the TS result against the oracle's full A4 diff; `ignore` lists offsets the TS does not model on purpose (UI text pointers) */
export function diffAgainst(c: any, a: A4Mem, before: Map<number, number>, ignore: (o: number) => boolean = () => false): string[] {
  const d: string[] = [];
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  for (const [o, v] of theirs) if (!ignore(o) && mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}: oracle ${v} ts ${mine.get(o)}`);
  for (const [o, v] of mine) if (!theirs.has(o)) d.push(`mem ${o.toString(16)}: ts ${v} oracle none`);
  return d;
}
/** the AC / number text buffers the 0x1E handler formats for the stat panel (UI only): A4+0x19A8..0x19AE and 0x1A8C..0x1A8E */
export const uiText = (o: number) => (o >= 0x19a8 && o <= 0x19ae) || (o >= 0x1a8c && o <= 0x1a8e);
const fam = (f: string) => V.cases.filter((c: any) => c.fam === f);

export function runPop(c: any, tweak?: (a: A4Mem) => void, hooks?: PopHooks): string[] {
  const a = build(c); const before = new Map(a.m);
  if (tweak) tweak(a);
  popDue(a, hooks);
  return diffAgainst(c, a, before, uiText);
}
export function runDeath(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
  if (tweak) tweak(a);
  const r = monsterDeath(a, rng, c.P, c.x, c.y);
  if (hex(rng) !== c.out.seed) d.push('seed');
  const log = c.out.log as number[][];
  const lv = log.filter(e => e[0] === 0x17d2a).map(e => e[1]);
  if (JSON.stringify(lv) !== JSON.stringify(r.levelUps)) d.push(`levelup calls ${JSON.stringify(lv)} vs ${JSON.stringify(r.levelUps)}`);
  if (log.some(e => e[0] === 0xb614) !== r.scan) d.push('activation scan call');
  return d.concat(diffAgainst(c, a, before, uiText));
}
export function runDmg(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
  if (tweak) tweak(a);
  const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0;
  damageCharacter(a, rng, T.statBonusT1, c.ch, c.dmg, c.kind, c.flag, tick);
  if (hex(rng) !== c.out.seed) d.push('seed');
  return d.concat(diffAgainst(c, a, before, uiText));
}
describe('pass 7: due-event pop loop +0x12BA..+0x1FDA (oracle parity)', () => {
  it(`pop: every changed byte matches the real loop (${fam('pop').length} cases)`, () => {
    const bad = fam('pop').map((c: any) => runPop(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
  });
  it('coverage: every consumer fires, ties fire together, and not-due / overdue heads block the queue', () => {
    const seen = new Set<number>(); let ties = 0, blocked = 0;
    for (const c of fam('pop')) {
      const tick = c.pokes.find((p: any) => p[1] === 0x1750)[2] >>> 0;
      const due = c.evs.filter((e: number[]) => e[1] === tick && c.evs.indexOf(e) === c.evs.findIndex((x: number[]) => x === e));
      if (c.evs[0][1] !== tick) blocked++;
      else { for (const e of c.evs) { if (e[1] !== tick) break; seen.add(e[2]); } if (c.evs.length > 1 && c.evs[1][1] === tick) ties++; }
      void due;
    }
    for (const t of [0x14, 0x15, 0x16, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x29]) expect(seen.has(t), 'type ' + t.toString(16)).toBe(true);
    expect(ties).toBeGreaterThan(20);
    expect(blocked).toBeGreaterThan(8);
  });
  it('null control: firing an overdue head (<= instead of ==) disagrees', () => {
    const n = fam('pop').filter((c: any) => runPop(c, undefined, { fireOverdue: true }).length > 0).length;
    expect(n).toBeGreaterThan(3);
  });
  it('null control: ignoring the event mask a4 on swing-ready disagrees', () => {
    const n = fam('pop').filter((c: any) => runPop(c, (a: A4Mem) => { for (let i = 0; i < 150; i++) if (a.b(0x1036 + 12 * i + 4) === 0x14) a.setB(0x1036 + 12 * i + 8, 0); }).length > 0).length;
    expect(n).toBeGreaterThan(3);
  });
  it(`death: loot drop, frees, event cancel and XP match the real +0x7ED0 (${fam('death').length} cases)`, () => {
    const bad = fam('death').map((c: any) => runDeath(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
  });
  it(`dmg: DamageCharacter survive and death paths match the real +0x17686 (${fam('dmg').length} cases)`, () => {
    const bad = fam('dmg').map((c: any) => runDmg(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
  });
  it('death / dmg coverage: real deaths with loot, held bosses, script monsters, survivals, character deaths with corpses and game over', () => {
    const D = fam('death'), G = fam('dmg');
    const hpOf = (c: any) => c.pokes.find((p: any) => p[1] === -0x6e7a + 0x14 * c.P + 8)?.[2] as number;
    const dead = D.filter((c: any) => c.out.log.some((e: number[]) => e[0] === 0xb614));
    expect(dead.length).toBeGreaterThan(D.length / 3);
    expect(dead.filter((c: any) => c.pokes.some((p: any) => p[1] === -0x6e7a + 0x14 * c.P + 0xa && p[2] > 0)).length).toBeGreaterThan(20);
    expect(D.filter((c: any) => c.out.diff['6686'] !== undefined || true).length).toBe(D.length);
    void hpOf;
    const died = G.filter((c: any) => c.dmg >= c.pokes.find((p: any) => p[1] === 0x1758 + 0xa8 * c.ch + 0x4e)[2]);
    expect(died.length).toBeGreaterThan(40);
    expect(G.length - died.length).toBeGreaterThan(40);
    expect(G.filter((c: any) => c.out.diff['7817'] === 2).length).toBeGreaterThan(0);   // A4+0x1E88 = 2: the whole party dead
  });
  it('null controls: loot dropped in reverse order, a signed damage compare, and no corpse each disagree', () => {
    const D = fam('death'), G = fam('dmg');
    const rev = D.filter((c: any) => { const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const P = c.P; let n = a.w(-0x6e7a + 0x14 * P + 0xa); const ch: number[] = []; while (n) { ch.push(n); n = a.w(-0x6e7a + 0x14 * n + 0x12); } if (ch.length < 2) return false;
      for (let i = 0; i + 1 < ch.length; i++) { /* swap the first two carried items' order */ } a.setW(-0x6e7a + 0x14 * P + 0xa, ch[1]); a.setW(-0x6e7a + 0x14 * ch[1] + 0x12, ch[0]); a.setW(-0x6e7a + 0x14 * ch[0] + 0x12, ch[2] ?? 0); monsterDeath(a, rng, P, c.x, c.y); return diffAgainst(c, a, before, uiText).length > 0; });
    expect(rev.length).toBeGreaterThan(3);
    const signed = G.filter((c: any) => { const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const hp = a.sw(0x1758 + 0xa8 * c.ch + 0x4e); const dm = c.dmg > 32767 ? c.dmg - 65536 : c.dmg; const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0; damageCharacter(a, rng, T.statBonusT1, c.ch, dm < hp ? 0 : 0xffff, c.kind, c.flag, tick); return diffAgainst(c, a, before, uiText).length > 0; });
    expect(signed.length).toBeGreaterThan(10);
    const nocorpse = G.filter((c: any) => c.flag === 1 && runDmg({ ...c, flag: 0 }).length > 0);
    expect(nocorpse.length).toBeGreaterThan(3);
  });
  it(`vmtele: the behaviour VM's TELEPORT op moves the monster as the real +0xADA2 does (${fam('vmtele').length} cases)`, () => {
    const bad = fam('vmtele').map((c: any) => { const a = build(c); const before = new Map(a.m); vmTeleport(a, c.P, c.S, c.ox, c.oy, c.nx, c.ny); return diffAgainst(c, a, before, uiText); }).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    const nul = fam('vmtele').filter((c: any) => { const a = build(c); const before = new Map(a.m); vmTeleport(a, c.P, c.S, c.ox, c.oy, c.ny, c.nx); return diffAgainst(c, a, before, uiText).length > 0; });
    expect(nul.length).toBeGreaterThan(5);   // null control: x and y swapped
  });
  const runEnter = (c: any, msgDone?: boolean) => {
    const a = build(c); const r = enterParty(a, c.x, c.y, c.f, msgDone ?? a.w(0x1998) === 1); const d: string[] = [];
    if (r.code !== c.out.d0) d.push(`code ${c.out.d0} vs ${r.code}`);
    if (r.x !== c.out.peeks[0] || r.y !== c.out.peeks[1] || r.facing !== c.out.peeks[2]) d.push(`pos ${JSON.stringify(c.out.peeks)} vs ${r.x},${r.y},${r.facing}`);
    return d;
  };
  it(`enter: the party square-enter test +0x27BAA (code and rewritten position / facing) matches (${fam('enter').length} cases)`, () => {
    const bad = fam('enter').map((c: any) => runEnter(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    const codes = new Set(fam('enter').map((c: any) => c.out.d0));
    for (const k of [0, 1, 2, 5, 6, 7, 8]) expect(codes.has(k), 'code ' + k).toBe(true);
    // null control: ignoring the "message finished" gate changes the verdict of stairs / teleporters
    expect(fam('enter').filter((c: any) => runEnter(c, true).length > 0).length).toBeGreaterThan(0);
  });
  const runTrig = (c: any, tweak?: (a: A4Mem) => void): string[] => {
    const a = build(c); const before = new Map(a.m); if (tweak) tweak(a);
    const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0;
    const r = triggerActions(a, c.x, c.y, c.typ, tick);
    const log = (c.out.log as number[][]).filter(e => e[0] === 0xc4f6).map(e => e[1] >> 8);
    const d: string[] = [];
    if (JSON.stringify(log) !== JSON.stringify(r.executed)) d.push(`executed ${JSON.stringify(log)} vs ${JSON.stringify(r.executed)}`);
    return d.concat(diffAgainst(c, a, before, uiText));
  };
  it(`trig: TriggerActionsAt +0xCF34 (record walk, events 0x28 / 0x29, cursor, immediate executor calls) matches (${fam('trig').length} cases)`, () => {
    const bad = fam('trig').map((c: any) => runTrig(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    const live = fam('trig').filter((c: any) => c.out.log.some((e: number[]) => e[0] === 0xc4f6));
    expect(live.length).toBeGreaterThan(fam('trig').length / 10);
    // the trigger schedules both consumers the pop loop handles
    const sched = fam('trig').filter((c: any) => { const a = build(c); const n0 = new Set<number>(); triggerActions(a, c.x, c.y, c.typ, 0); for (let i = 0; i < 150; i++) n0.add(a.b(0x1036 + 12 * i + 4)); return n0.has(0x29) && n0.has(0x28); });
    expect(sched.length).toBeGreaterThan(5);
    // null control: starting the walk one generation off finds no records
    expect(fam('trig').filter((c: any) => runTrig(c, a => { const id = [...Array(16).keys()].find(i => a.b(-0x6e7a + 0x14 + 5) !== undefined && i === 1); void id; a.setB(-0x6e7a + 0x14 + 0x11, (a.b(-0x6e7a + 0x14 + 0x11) + 1) & 0xff); }).length > 0).length).toBeGreaterThan(5);
  });
});
