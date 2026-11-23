import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4Mem, applyExpiry } from './rules-spell';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'rules_oracle');
const gen = resolve(dir, 'generated/vectors_events.json.gz');
const V = JSON.parse(gunzipSync(readFileSync(existsSync(gen) ? gen : resolve(dir, 'vectors_events.json.gz'))).toString());
const CH = (k: number) => 0x1758 + 0xa8 * k;

const build = (c: any): A4Mem => {
  const a = new A4Mem();
  a.setW(0x174a, c.mode); a.setW(0x1a14, c.a14); a.setW(0x1a16, c.a16); a.setB(0x1a26, c.a26);
  c.chars.forEach((ch: any, k: number) => { a.setW(CH(k) + 0x4e, ch.hp); for (const [o, v] of Object.entries<number>(ch.b)) a.setB(CH(k) + +o, v); });
  for (const [o, v] of Object.entries<number>(c.g)) a.setW(+o, v);
  return a;
};
const compare = (a: A4Mem, c: any): string[] => {
  const d: string[] = [];
  c.out.chars.forEach((ch: any, k: number) => {
    if (a.sw(CH(k) + 0x4e) !== ch.hp) d.push(`hp${k}`);
    for (const [o, v] of Object.entries<number>(ch.b)) if (a.b(CH(k) + +o) !== v) d.push(`c${k}+${(+o).toString(16)}`);
  });
  for (const [o, v] of Object.entries<number>(c.out.g)) if (a.w(+o) !== v) d.push(`w${(+o).toString(16)}`);
  for (const [o, v] of Object.entries<number>(c.out.f)) if (a.b(+o) !== v) d.push(`f${(+o).toString(16)}`);
  return d;
};

describe('due-event expiry handlers 0x1E-0x25 (real +0x12BA..+0x1F9C in musashi) vs TS', () => {
  it('matches on every case: character bytes, counters, global words and redraw flags', () => {
    let bad = 0, first = '';
    for (const c of V.cases) { const a = build(c); applyExpiry(a, c.ev); const d = compare(a, c); if (d.length) { bad++; if (!first) first = JSON.stringify([c.ev, d]); } }
    expect(first).toBe('');
    expect(bad).toBe(0);
  });
  it('covers all seven event types', () => {
    const per = new Map<number, number>();
    for (const c of V.cases) per.set(c.ev.type, (per.get(c.ev.type) ?? 0) + 1);
    expect([...per.keys()].sort()).toEqual([0x1e, 0x1f, 0x20, 0x21, 0x23, 0x24, 0x25]);
    expect(Math.min(...per.values())).toBeGreaterThan(10);
  });
  it('null control: dropping the a2 == 0 gate on the AC subtraction disagrees', () => {
    let diff = 0;
    for (const c of V.cases) if (c.ev.type === 0x1e) { const a = build(c); applyExpiry(a, { ...c.ev, a2: 0 }); if (compare(a, c).length) diff++; }
    expect(diff).toBeGreaterThan(10);
  });
});
