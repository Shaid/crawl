/** The spell dispatcher's data tables (spell-recipes.json, spell-cases.json) cover every spell id, and spell-cases.json only uses documented ops. */
import { describe, expect, it } from 'vitest';
import recipes from '../spell-recipes.json' with { type: 'json' };
import cases from '../spell-cases.json' with { type: 'json' };
import { NO_EFFECT, SUMMON } from '../spells.ts';

const IN_CODE: number[] = [];
describe('spell dispatcher tables', () => {
  it('every spell id is a recipe, a data case, a summon, a no-effect id or (none left) a code case', () => {
    const rec = new Set(Object.keys((recipes as any).recipes).map(Number));
    const cs = new Set(Object.keys((cases as any).cases).map(Number));
    const missing: number[] = [];
    for (let id = 0; id < 82; id++) {
      if (!(rec.has(id) || cs.has(id) || SUMMON.has(id) || NO_EFFECT.has(id) || IN_CODE.includes(id))) missing.push(id);
    }
    expect(missing).toEqual([]);
  });
  it('the data cases use only documented ops and valid amounts', () => {
    const ops = Object.keys((cases as any).ops);
    for (const [id, list] of Object.entries<any[]>((cases as any).cases)) {
      expect(Number(id)).toBeLessThan(82);
      for (const o of list) {
        expect(ops).toContain(o.op);
        for (const a of [o.amt, ...(o.dice ?? []), ...(o.stamina ?? []), ...(o.hp ?? [])]) if (a) expect(a.length).toBeLessThanOrEqual(3);
      }
    }
  });
  it('null control: dropping the data case for spell 3 leaves it uncovered', () => {
    const cs = new Set(Object.keys((cases as any).cases).map(Number)); cs.delete(3);
    const rec = new Set(Object.keys((recipes as any).recipes).map(Number));
    expect(rec.has(3) || cs.has(3) || SUMMON.has(3) || NO_EFFECT.has(3) || IN_CODE.includes(3)).toBe(false);
  });
});
