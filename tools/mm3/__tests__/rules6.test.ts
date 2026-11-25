/**
 * Pass 6 ports (tools/mm3/rules6.ts) vs vectors recorded from the retail executable under Unicorn (tools/mm3/rules_oracle/rules6.py).
 * Strict memory, write sets and return values must match; every unit has a null control.
 */
import { describe, expect, it, vi } from 'vitest';
import { load } from './vectors.ts';
import { StrictMem } from '../rules-mem.ts';
import * as R from '../rules6.ts';

vi.setConfig({ testTimeout: 240000 });
const mem = (v: any) => new StrictMem(v.init, v.wpre);

describe('party skill check OV4+0x102B6', () => {
  const V = load('skillcheck');
  const run = (v: any, o = {}) => { const m = mem(v); const r = R.partySkill(m, v.args[0], o); return { r, ch: m.changes() }; };
  it('matches the game: any / two / all group rule per skill, short-circuit footprint', () => {
    expect(V.length).toBeGreaterThanOrEqual(100);
    for (const v of V) {
      const { r, ch } = run(v);
      expect(r, JSON.stringify(v.args)).toBe(v.ret);
      expect(ch).toEqual(v.fin);
    }
    for (let k = 0; k < 18; k++) {
      expect(V.some((v: any) => v.args[0] === k && v.ret === 1)).toBe(true);
      expect(V.some((v: any) => v.args[0] === k && v.ret === 0)).toBe(true);
    }
  });
  it('null controls: all-skills as any, two-skills as any disagree', () => {
    for (const o of [{ allIsAny: true }, { twoIsAny: true }]) {
      let bad = 0;
      for (const v of V) { try { const { r, ch } = run(v, o); if (r !== v.ret || JSON.stringify(ch) !== JSON.stringify(v.fin)) bad++; } catch { bad++; } }
      expect(bad).toBeGreaterThan(0);
    }
  });
});
