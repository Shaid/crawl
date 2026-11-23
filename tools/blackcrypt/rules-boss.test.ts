import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ramBossItem, type BossState } from './rules-boss';
import type { RayObj } from './rules-spell';

const V = JSON.parse(gunzipSync(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'rules_oracle/vectors_boss.json.gz'))).toString());
const DX = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const state = (c: any): BossState => {
  const cells = new Map<number, number>(); const objs: Record<number, RayObj> = {};
  const fx = c.px + DX[c.f][0], fy = c.py + DX[c.f][1];
  let head = 0;
  for (const m of c.mons) { objs[m.P] = { kind: 'mon', gfx: m.gfx, S: m.S, next: head }; objs[m.S] = { kind: 'sec', pos: m.pos, alert: m.alert, b0A: m.b0a }; head = m.P; }
  cells.set(fy * 256 + fx, head);
  return { stage: c.stage, tick: c.tick, px: c.px, py: c.py, facing: c.f, wall: c.walls !== 0, world: { cells, objs, px: c.px, py: c.py, facing: c.f, item36: false, b1E5C: 0, chars: [] }, chars: c.chars };
};

describe('Ram-boss stage machine item effects vs the real 68k (PROTECTOR, SOULFREEZER, VORTEX)', () => {
  const fxOf = (c: any) => c.fx as 'prot' | 'sf' | 'vx';
  const run = (c: any, tweak = false) => {
    const s = state(c);
    if (tweak) s.stage = Math.min(5, s.stage + 1);
    return ramBossItem(fxOf(c), s);
  };
  const same = (c: any, r: ReturnType<typeof ramBossItem>): boolean => {
    if (r.stage !== c.out.stage) return false;
    if (JSON.stringify(r.res) !== JSON.stringify(c.out.res)) return false;
    // alert bytes (S +0x12) and the cleared secondary byte (+0x0A)
    const alert = c.mons.map((m: any) => r.alert[m.S] ?? m.alert);
    if (JSON.stringify(alert) !== JSON.stringify(c.out.alert)) return false;
    const b0a = c.mons.map((m: any) => (r.clearB0a.includes(m.S) ? 0 : m.b0a));
    if (JSON.stringify(b0a) !== JSON.stringify(c.out.b0a)) return false;
    // calls: the oracle logs hooks as [offset, words]; compare the sequence of offsets and the schedule words
    const offs = c.out.calls.map((e: number[]) => e[0]);
    const want = r.calls.flatMap(x => x.fn === 'msg' ? [0x4ae] : x.fn === 'cancelType' ? [0x714] : x.fn === 'sched' ? [0x5ea] : x.fn === 'cancelEvents' ? [0xb25a] : [0x2d46]);
    if (JSON.stringify(offs) !== JSON.stringify(want)) return false;
    for (const e of c.out.calls) if (e[0] === 0x5ea) {
      const due = (e[2] * 65536 + e[3]) >>> 0; const sc = r.calls.find(x => x.fn === 'sched')!;
      if (due !== sc.due || e[1] >> 8 !== sc.type) return false;
    }
    return true;
  };
  it('stage, resistance bytes and the hook call sequence match on all 900 cases', () => {
    let bad = 0, first = '';
    for (const c of V.cases) { const r = run(c); if (!same(c, r)) { bad++; if (!first) first = JSON.stringify({ fx: c.fx, stage: c.stage, out: c.out, mine: r }); } }
    expect(first).toBe('');
    expect(bad).toBe(0);
  });
  it('covers every transition and the refusals', () => {
    const t = new Set(V.cases.map((c: any) => `${c.fx}:${c.stage}>${c.out.stage}`));
    for (const k of ['prot:1>2', 'sf:2>3', 'vx:3>4', 'prot:0>0', 'sf:3>3', 'vx:2>2']) expect(t.has(k)).toBe(true);
    expect(V.cases.filter((c: any) => c.fx === 'sf' && c.stage === 2 && c.out.stage === 2).length).toBeGreaterThan(20); // wall / wrong target
  });
  it('null control: starting one stage later disagrees', () => {
    expect(V.cases.filter((c: any) => !same(c, run(c, true))).length).toBeGreaterThan(100);
  });
});
