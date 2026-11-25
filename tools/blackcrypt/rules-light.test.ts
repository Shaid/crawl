import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4Mem } from './rules-spell';
import { lightEffect } from './rules-item';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(gunzipSync(readFileSync(resolve(here, 'rules_oracle/vectors_light.json.gz'))).toString());
function run(c: any, fn: (a: A4Mem, calls: number[][]) => number): string[] {
  const a = new A4Mem();
  for (const [k, o, v] of c.pokes as [string, number, number][]) { if (k === 'b') a.setB(o, v); else a.setW(o, v); }
  const before = new Map(a.m); const calls: number[][] = [];
  const d0 = fn(a, calls); const d: string[] = [];
  if (d0 !== c.out.d0) d.push(`ret ${d0} vs ${c.out.d0}`);
  const mine = new Map<number, number>();
  for (const [o, v] of a.m) if ((before.get(o) ?? 0) !== v) mine.set(o, v);
  const theirs = new Map<number, number>(Object.entries<number>(c.out.diff).map(([k, v]) => [+k, v]));
  for (const [o, v] of theirs) if (mine.get(o) !== v && !(v === 0 && (before.get(o) ?? 0) === 0)) d.push(`mem ${o.toString(16)}`);
  for (const o of mine.keys()) if (!theirs.has(o)) d.push(`extra ${o.toString(16)}`);
  const lg = c.out.log.filter((e: number[]) => e[0] !== 0x58c6).map((e: number[]) => e[0] === 0x2d46 ? [e[0], e[1]] : [e[0]]);
  if (JSON.stringify(lg) !== JSON.stringify(calls)) d.push('calls');
  return d;
}
describe('LIGHT +0x58C6', () => {
  it(`matches the real routine (${V.cases.length} cases)`, () => {
    expect(V.cases.map((c: any) => run(c, lightEffect)).filter((x: string[]) => x.length).slice(0, 3)).toEqual([]);
  });
  it('null control: +100 instead of +120 disagrees', () => {
    const bad = V.cases.filter((c: any) => run(c, (a, k) => { a.setW(0x1754, (a.w(0x1754) + 100) & 0xffff); k.push([0x2d46, 1], [0x4ae]); return 1; }).length);
    expect(bad.length).toBeGreaterThan(0);
  });
});
