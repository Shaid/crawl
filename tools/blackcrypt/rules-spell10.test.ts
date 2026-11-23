import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BcRng, type RuleTables } from './rules';
import { A4Mem } from './rules-spell';
import { castSpell9, scheduleEvent, cancelEvent, recastCancel, activationScan } from './rules-spell9';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(gunzipSync(readFileSync(resolve(here, 'rules_oracle/vectors_spells10.json.gz'))).toString());
const T: RuleTables = JSON.parse(readFileSync(resolve(here, 'rules_oracle/vectors.json'), 'utf8')).tables;
const hex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');

const build = (c: any): A4Mem => {
  const a = new A4Mem();
  for (const [k, o, v] of c.pokes as [string, number, number][]) { if (k === 'b') a.setB(o, v); else if (k === 'w') a.setW(o, v); else { a.setW(o, v >>> 16); a.setW(o + 2, v & 0xffff); } }
  return a;
};
/** run one case against the TS model; returns the disagreements with the oracle (empty = match). `tweak` applies a deliberate change (null controls). */
export function run10(c: any, tweak?: (a: A4Mem) => void): string[] {
  const a = build(c); const before = new Map(a.m); const rng = new BcRng(c.seed); const d: string[] = [];
  if (tweak) tweak(a);
  const log = c.out.log as number[][];
  const spent = log.find(e => e[0] === 0x4876), failed = log.find(e => e[0] === 0x4960);
  if (c.fam === 'raise' || c.fam === 'tele') {
    const tick = ((a.w(0x1750) << 16) | a.w(0x1752)) >>> 0;
    const r = castSpell9(a, rng, T, 0, tick, { pick: c.pick, map: c.pick });
    if ((spent ? spent[1] & 0xffff : undefined) !== r.spent) d.push(`spent ${spent?.[1]} vs ${r.spent}`);
    if ((failed ? failed[1] & 0xffff : undefined) !== r.failed) d.push(`failed ${failed?.[1]} vs ${r.failed}`);
    if (hex(rng) !== c.out.seed) d.push('seed');
    if (c.fam === 'tele') { const scanned = log.some(e => e[0] === 0xb614); if (scanned !== (r.ret === 2)) d.push('scan hook'); }
  } else if (c.fam === 'scan') activationScan(a, rng, a.w(0x1750) * 65536 + a.w(0x1752));
  else if (c.fam === 'sched') scheduleEvent(a, c.t, c.due, c.a[0], c.a[1], c.a[2], c.a[3], c.wd);
  else if (c.fam === 'cancel') cancelEvent(a, c.id);
  else { const v = recastCancel(a, c.a1, c.t, c.a2); if (v !== (c.out.d0 & 0xff)) d.push(`recast value ${c.out.d0} vs ${v}`); }
  if (c.fam === 'scan' && hex(rng) !== c.out.seed) d.push('seed');
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  const ui = (o: number) => c.fam === 'raise' && o >= 0x1a00 && o <= 0x1a03;   // UI text-pointer copy
  for (const [o, v] of theirs) if (!ui(o) && mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}: oracle ${v} ts ${mine.get(o)}`);
  for (const [o, v] of mine) if (!theirs.has(o)) d.push(`mem ${o.toString(16)}: ts ${v} oracle none`);
  return d;
}
const fam = (f: string) => V.cases.filter((c: any) => c.fam === f);
const mism = (f: string, tweak?: (a: A4Mem) => void) => fam(f).filter((c: any) => run10(c, tweak).length > 0).length;

describe('pass 6: RAISE DEAD, TELEPORT, event queue (oracle parity)', () => {
  for (const f of ['raise', 'tele', 'scan', 'sched', 'cancel', 'recast']) {
    it(`${f}: every changed byte matches the real routine (${fam(f).length} cases)`, () => {
      const bad = fam(f).map((c: any) => run10(c)).filter((x: string[]) => x.length);
      expect(bad.slice(0, 3)).toEqual([]);
    });
  }
  it('coverage: successes and failures of both spells, exhaustion and recast hits', () => {
    const ok = (f: string) => fam(f).filter((c: any) => c.out.log.some((e: number[]) => e[0] === 0x4876)).length;
    expect(ok('raise')).toBeGreaterThan(fam('raise').length / 2);
    expect(ok('tele')).toBeGreaterThan(fam('tele').length / 3);
    expect(fam('raise').length - ok('raise')).toBeGreaterThan(2);
    const exhausted = fam('sched').filter((c: any) => c.pokes.some((p: any[]) => p[1] === 0x173e && p[2] === 0x96));
    expect(exhausted.length).toBeGreaterThan(3);
    const spawned = fam('scan').filter((c: any) => Object.keys(c.out.diff).some(k => +k >= -0x6e7a + 0x14 * 40 && +k < -0x6e7a + 0x14 * 70)).length;
    expect(spawned).toBeGreaterThan(fam('scan').length / 5);
    expect(fam('recast').filter((c: any) => (c.out.d0 & 0xff) !== 0 || Object.keys(c.out.diff).length > 0).length).toBeGreaterThan(5);
  });
  it('null controls: a deliberately altered world disagrees', () => {
    expect(mism('raise', a => a.setW(0x1e74, (a.w(0x1e74) + 1) & 3))).toBeGreaterThan(5);
    expect(mism('tele', a => a.setW(0x1e2a, a.w(0x1e2a) ? 0 : 1))).toBeGreaterThan(5);
    expect(mism('sched', a => a.setB(0x173f, 0x96))).toBeGreaterThan(5);
    expect(mism('scan', a => a.setB(0x1e91, 9))).toBeGreaterThan(5);
  });
});
