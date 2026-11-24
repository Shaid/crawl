/**
 * Diffs summon (LAB_0EEE, the routine behind CREATE LIFE, ILLUSION and CONJURATION) against the game under
 * Unicorn with the monster loader captured (oracle/combat3.py summon). Committed subset: oracle/summon-vectors.json.
 */
import { describe, expect, it } from 'vitest';
import { summon, type EncounterIO } from '../encounter.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_SUMMON_VECTORS', 'summon-vectors.json');

function body(v: any, mem: any, rng: any) {
  const loads: [number, number, string][] = v.loads.slice();
  const io: EncounterIO = {
    loadMonster(id, dest) {
      const [lid, ldest, hex] = loads.shift()!;
      if (lid !== id || ldest !== dest) throw new Error('load mismatch');
      for (let k = 0; k < 222; k++) mem.w8(dest + k, parseInt(hex.slice(2 * k, 2 * k + 2), 16));
    },
    formation: () => 0, picture: () => undefined,
  };
  summon({ m: mem, rng, a4: v.a4 }, io, v.ids, v.n);
  return loads.length;
}
const check = (_v: any, r: any) => r.fx === 0;

describe.skipIf(V.length === 0)('summon LAB_0EEE', () => {
  it('matches the game: new group, counts, members, RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers new groups, the ally group, refusals', () => {
    expect(V.some((v) => v.loads.length === 1)).toBe(true);
    expect(V.some((v) => v.loads.length === 0)).toBe(true);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30000 || 1; }, check)).toBeGreaterThan(0);
  });
});
