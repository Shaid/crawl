import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4Mem } from './rules-spell';
import { BcRng, type RuleTables } from './rules';
import { executeAction, glyphEffect, pitEffect, doorClick, keyUse, type ExecHooks } from './rules-action';
import { triggerActions } from './rules-death';
import { useItem } from './rules-item';
import { popDue } from './rules-pop';

const here = dirname(fileURLToPath(import.meta.url));
const T: RuleTables = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8')).tables;
const gen = resolve(here, 'rules_oracle/generated/vectors_pass8.json.gz');
const V = JSON.parse(gunzipSync(readFileSync(existsSync(gen) ? gen : process.env.V8 ?? resolve(here, 'rules_oracle/vectors_pass8.json.gz'))).toString());
function diffAgainst(c: any, a: A4Mem, before: Map<number, number>, ignore: (o: number) => boolean = () => false): string[] {
  const d: string[] = [];
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  for (const [o, v] of theirs) if (!ignore(o) && mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}: oracle ${v} ts ${mine.get(o)}`);
  for (const [o, v] of mine) if (!theirs.has(o)) d.push(`mem ${o.toString(16)}: ts ${v} oracle none`);
  return d;
}
const uiText = (o: number) => (o >= 0x19a8 && o <= 0x19ae) || (o >= 0x1a8c && o <= 0x1a8e);
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');
const build = (c: any): A4Mem => {
  const a = new A4Mem();
  for (const [k, o, v] of c.pokes as [string, number, number][]) { if (k === 'b') a.setB(o, v); else if (k === 'w') a.setW(o, v); else { a.setW(o, v >>> 16); a.setW(o + 2, v & 0xffff); } }
  return a;
};
function hooksOf(calls: number[][]): ExecHooks {
  return { scan: () => calls.push([0xb614]), stairs: v => calls.push([0x16c62, v]), equipRemove: (ch, row, k) => calls.push([0x18088, ch, row, k, 1]), palette: () => calls.push([0x26900]) };
}
const norm = (log: number[][]) => log.filter(e => e[0] !== 0x17d2a).map(e => e[0] === 0x16c62 ? [e[0], e[1]] : e[0] === 0x18088 ? [e[0], e[1], e[2], e[3], e[4]] : [e[0]]);
export function runTrigx(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
  if (tweak) tweak(a);
  const calls: number[][] = []; const h = hooksOf(calls);
  const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0;
  triggerActions(a, c.x, c.y, c.typ, tick, id => executeAction(a, rng, T.statBonusT1, id, h));
  if (hex(rng) !== c.out.seed) d.push('seed');
  if (JSON.stringify(norm(c.out.log)) !== JSON.stringify(calls)) d.push(`calls ${JSON.stringify(norm(c.out.log))} vs ${JSON.stringify(calls)}`);
  return d.concat(diffAgainst(c, a, before, uiText));
}
export function runExec(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
  if (tweak) tweak(a);
  const calls: number[][] = []; const h = hooksOf(calls);
  executeAction(a, rng, T.statBonusT1, c.rid, h);
  if (hex(rng) !== c.out.seed) d.push('seed');
  if (JSON.stringify(norm(c.out.log)) !== JSON.stringify(calls)) d.push(`calls ${JSON.stringify(norm(c.out.log))} vs ${JSON.stringify(calls)}`);
  return d.concat(diffAgainst(c, a, before, uiText));
}
const opcodes = [...new Set<number>(V.cases.map((c: any) => c.op))].filter(o => o < 0x100);
const FULL = V.cases.length > 1000;   // coverage floors apply to the full generated set; the committed subset only has to agree with the oracle
const fam = (f: string) => V.cases.filter((c: any) => c.fam === f);
describe('pass 8: action executor +0xC4F6 / +0xCE9C', () => {
  const trigx = V.cases.filter((c: any) => c.fam === 'trigx');
  it(`TriggerActionsAt with the real executor behind it, in-line (${trigx.length} cases)`, () => {
    const bad = trigx.map((c: any) => runTrigx(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    expect(trigx.filter((c: any) => Object.keys(c.out.diff).length > 12).length).toBeGreaterThan(0);
  });
  it('null control: running the trigger without its executor disagrees', () => {
    const bad = trigx.filter((c: any) => { const a = build(c); const before = new Map(a.m);
      triggerActions(a, c.x, c.y, c.typ, ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0);
      return diffAgainst(c, a, before, uiText).length > 0; });
    if (FULL) expect(bad.length).toBeGreaterThan(0);
  });
  for (const op of opcodes) {
    const cs = V.cases.filter((c: any) => c.op === op);
    it(`opcode 0x${op.toString(16)} (${cs.length} cases)`, () => {
      const bad = cs.map((c: any) => runExec(c)).filter((x: string[]) => x.length);
      expect(bad.slice(0, 3)).toEqual([]);
      // null control: moving the target square by one column (or the value by one for the party-wide opcodes) disagrees on at least one case wherever the opcode does anything
      if (cs.some((c: any) => Object.keys(c.out.diff).length > 0)) {
        const valueOnly = [0x13, 0x1c, 0x1d, 0x1f].includes(op);
        const nul = cs.filter((c: any) => runExec(c, a => { if (valueOnly) a.setB(0x836 + 8 * c.rid + 6, c.v + 1); else a.setB(0x836 + 8 * c.rid + 2, c.x + 1); }).length > 0);
        expect(nul.length, 'null control').toBeGreaterThan(0);
      }
    });
  }
  const runSq = (c: any, tweak?: (a: A4Mem) => void): string[] => {
    const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
    if (tweak) tweak(a);
    if (c.fam === 'glyph') glyphEffect(a, rng, T.statBonusT1, { d6: c.d6, d7: c.d7 }); else pitEffect(a, rng, T.statBonusT1);
    if (hex(rng) !== c.out.seed) d.push('seed');
    return d.concat(diffAgainst(c, a, before, uiText));
  };
  for (const f of ['glyph', 'pit']) {
    it(`${f}: ${f === 'glyph' ? '+0x4662' : '+0x1734A'} effect matches the real routine (${fam(f).length} cases)`, () => {
      const bad = fam(f).map((c: any) => runSq(c)).filter((x: string[]) => x.length);
      expect(bad.slice(0, 3)).toEqual([]);
      // null control: the shield / levitation byte ignored, resp. the damage bound taken from the wrong dexterity branch
      const nul = fam(f).filter((c: any) => runSq(c, a => { for (let i = 0; i < 4; i++) { a.setB(0x1758 + 0xa8 * i + (f === 'glyph' ? 0x8b : 0x8a), 0); a.setB(0x1758 + 0xa8 * i + 0x68, a.b(0x1758 + 0xa8 * i + 0x68) ^ 0x10); } }).length > 0);
      expect(nul.length).toBeGreaterThan(0);
    });
  }
  it('glyph coverage: every kind fires, the glyph is consumed, the party can be wiped out', () => {
    const kinds = new Set(fam('glyph').map((c: any) => { const a = build(c); return a.w(-0x6e7a + 0x14 + 0x10); }));
    if (FULL) for (const k of [1, 2, 3, 4]) expect(kinds.has(k), 'kind ' + k).toBe(true);
    expect(fam('glyph').some((c: any) => c.out.diff['6118'] !== undefined || Object.keys(c.out.diff).length > 40)).toBe(true);
  });
  const runDK = (c: any, tweak?: (a: A4Mem) => void): string[] => {
    const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
    if (tweak) tweak(a);
    const calls: number[][] = []; const h = hooksOf(calls);
    if (c.fam === 'door') doorClick(a, rng, T.statBonusT1, h); else keyUse(a, rng, T.statBonusT1, h);
    if (hex(rng) !== c.out.seed) d.push('seed');
    if (JSON.stringify(norm(c.out.log)) !== JSON.stringify(calls)) d.push(`calls ${JSON.stringify(norm(c.out.log))} vs ${JSON.stringify(calls)}`);
    return d.concat(diffAgainst(c, a, before, uiText));
  };
  for (const f of ['door', 'key']) {
    it(`${f}: ${f === 'door' ? 'the party door click +0x1110A' : 'key on lock +0x16AA8'} matches the real routine (${fam(f).length} cases)`, () => {
      const bad = fam(f).map((c: any) => runDK(c)).filter((x: string[]) => x.length);
      expect(bad.slice(0, 3)).toEqual([]);
      expect(fam(f).filter((c: any) => Object.keys(c.out.diff).length > 0).length).toBeGreaterThan(fam(f).length / 6);
      // null control: the first door-state change / the key count ignored
      const nul = fam(f).filter((c: any) => runDK(c, a => { a.setW(-0x6e7a + 0x14 * 3 + 0xe, a.w(-0x6e7a + 0x14 * 3 + 0xe) + 1); a.setW(-0x6e7a + 0x14 + 0xe, (a.w(-0x6e7a + 0x14 + 0xe) + 1) % 3); }).length > 0);
      expect(nul.length).toBeGreaterThan(0);
    });
  }
  it('door / key coverage: opening, closing, blocked by a monster, trigger records run, a key unlocks and auto-opens', () => {
    const logs = fam('door').filter((c: any) => c.out.log.some((e: number[]) => e[0] === 0xb614)).length;
    if (!FULL) return;
    expect(logs).toBeGreaterThan(3);
    expect(fam('key').filter((c: any) => c.out.log.some((e: number[]) => e[0] === 0xb614)).length).toBeGreaterThan(3);
  });
  const runItem = (c: any, tweak?: (a: A4Mem) => void, retOverride?: number): string[] => {
    const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
    if (tweak) tweak(a);
    const calls: number[][] = [];
    const ret = retOverride ?? c.ret;
    const r = useItem(a, rng, T.statBonusT1, c.ch, c.item, (off, args) => { calls.push([off, ...args]); return ret; }, (off, args) => calls.push([off, ...args]));
    if (hex(rng) !== c.out.seed) d.push('seed');
    if (r !== c.out.d0) d.push(`result ${c.out.d0} vs ${r}`);
    const log = (c.out.log as number[][]).filter(e => e[0] !== 0xb614 && e[0] !== 0x17d2a).map(e => e[0] === 0x6d9a ? e.slice(0, 6) : e[0] === 0x5070 ? e.slice(0, 4) : e[0] === 0x170a8 ? e.slice(0, 3) : [e[0]]);
    const mine = calls.map(e => e[0] === 0x6d9a ? e.slice(0, 6) : e[0] === 0x5070 ? e.slice(0, 4) : e[0] === 0x170a8 ? e.slice(0, 3) : [e[0]]);
    if (JSON.stringify(log) !== JSON.stringify(mine)) d.push(`calls ${JSON.stringify(log)} vs ${JSON.stringify(mine)}`);
    return d.concat(diffAgainst(c, a, before, uiText));
  };
  it(`item: the use dispatcher +0x12FEA (shell, effect map, inline potions) matches the real routine (${fam('item').length} cases)`, () => {
    const bad = fam('item').map((c: any) => runItem(c)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    if (!FULL) return;
    const effs = new Set(fam('item').map((c: any) => c.eff));
    for (const e of [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f]) expect(effs.has(e), 'effect ' + e.toString(16)).toBe(true);
    // null controls: a different callee return value (the charge rule) and an off-by-one charge byte
    expect(fam('item').filter((c: any) => runItem(c, undefined, c.ret === 0 ? 1 : 0).length > 0).length).toBeGreaterThan(5);
    expect(fam('item').filter((c: any) => runItem(c, a => a.setB(-0x6e7a + 0x14 * c.item + 7, a.b(-0x6e7a + 0x14 * c.item + 7) ^ 1)).length > 0).length).toBeGreaterThan(5);
  });
  it(`popx: the pop loop with event 0x28 running the real executor (the "UI effect call" +0x8C54E is +0xC4F6) matches (${fam('popx').length} cases)`, () => {
    const run = (c: any, exec: boolean) => {
      const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const calls: number[][] = [];
      popDue(a, { slot: (_ev, idx) => { if (exec) executeAction(a, rng, T.statBonusT1, idx, hooksOf(calls)); } });
      const d: string[] = [];
      if (hex(rng) !== c.out.seed) d.push('seed');
      if (JSON.stringify(norm(c.out.log)) !== JSON.stringify(calls)) d.push(`calls ${JSON.stringify(norm(c.out.log))} vs ${JSON.stringify(calls)}`);
      return d.concat(diffAgainst(c, a, before, uiText));
    };
    const bad = fam('popx').map((c: any) => run(c, true)).filter((x: string[]) => x.length);
    expect(bad.slice(0, 3)).toEqual([]);
    if (FULL) expect(fam('popx').filter((c: any) => run(c, false).length > 0).length).toBeGreaterThan(3);   // null control: without the executor the diff is wrong
  });
});
