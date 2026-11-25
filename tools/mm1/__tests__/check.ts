import { expect } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';

export const mem = (v: any) => new StrictMem(v.init, v.wpre);
export type Out = { ax?: number; bx?: number; cx?: number; dx?: number; si?: number; di?: number; bp?: number; cf?: number; zf?: number; stop?: number; calls?: any[] };

/** Run `fn` on every vector of `name`: the port may read only recorded bytes, and its write set / values and declared
 *  output registers (+ logged stub calls when `calls` is returned) must equal the game's. */
export function mustMatch(name: string, fn: (m: StrictMem, v: any) => Out | void, min = 20) {
  const V = load(name);
  expect(V.length).toBeGreaterThanOrEqual(min);
  for (const v of V) {
    const m = mem(v);
    const r: any = fn(m, v) || {};
    for (const k of ['ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'cf', 'zf', 'stop']) {
      if (r[k] !== undefined && r[k] !== v.out[k]) expect(r[k], `${name} reg ${k} args ${JSON.stringify(v.args)}`).toBe(v.out[k]);
    }
    if (r.calls !== undefined && JSON.stringify(r.calls) !== JSON.stringify(v.calls)) expect(r.calls, `${name} calls ${JSON.stringify(v.args)}`).toEqual(v.calls);
    const ch = m.changes();
    if (JSON.stringify(ch) !== JSON.stringify(v.fin)) expect(ch, `${name} writes ${JSON.stringify(v.args)}`).toEqual(v.fin);
    const ws = m.writeSet().sort((a, b) => a - b), want = [...Object.keys(v.fin).map(Number), ...v.wset].sort((a, b) => a - b);
    if (JSON.stringify(ws) !== JSON.stringify(want)) expect(ws, `${name} write set ${JSON.stringify(v.args)}`).toEqual(want);
  }
}
/** number of vectors on which the (wrong) variant disagrees with the game: throws, wrong register, wrong write */
export function nullBad(name: string, bad: (m: StrictMem, v: any) => Out | void) {
  let n = 0;
  for (const v of load(name)) {
    const m = mem(v);
    try {
      const r: any = bad(m, v) || {};
      let ok = true;
      for (const k of ['ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'cf', 'zf', 'stop']) if (r[k] !== undefined && r[k] !== v.out[k]) ok = false;
      if (r.calls !== undefined && JSON.stringify(r.calls) !== JSON.stringify(v.calls)) ok = false;
      if (JSON.stringify(m.changes()) !== JSON.stringify(v.fin)) ok = false;
      if (!ok) n++;
    } catch { n++; }
  }
  return n;
}
