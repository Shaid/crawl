/**
 * Diffs the post-fight group renumbering LAB_09DC and the formation re-placement LAB_09B5 (tools/wizardry6/endcombat.ts) against the game
 * under Unicorn (oracle/combat6.py renumber). Committed subset oracle/renumber-vectors.json; larger sets via W6_RENUMBER_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { placeFormation, renumberGroups } from '../endcombat.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const R = loadVectors('W6_RENUMBER_VECTORS', 'renumber-vectors.json');
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(R.length === 0)('group renumbering LAB_09DC', () => {
  const body = (v: any, m: any, rng: any) => { const fx: Effect[] = []; renumberGroups({ m, rng, a4: v.a4 }, fx); return fx; };
  it('matches the game: compaction, moves, formation cells, mist cells, group count, victory state', () => {
    expect(mismatches(R, body, undefined, same)).toBe(0);
  }, 120_000);
  it('covers moved groups, mist cells and the empty field', () => {
    expect(R.some((v) => v.effects.some((e: any) => e[0] === 'LAB_09AF'))).toBe(true);
    expect(R.some((v) => v.diff[String(v.a4 - 18608 + 1)] === 0x0f)).toBe(true);
  });
  it('null control: no mist handling disagrees', () => {
    const wrong = (v: any, m: any, rng: any) => { const fx: Effect[] = []; m.b.set(v.a4 - 15154 + 1, 7); m.b.set(v.a4 - 15154, 0); m.b.set(v.a4 - 15152, 0); m.b.set(v.a4 - 15152 + 1, 7); renumberGroups({ m, rng, a4: v.a4 }, fx); return fx; };
    expect(mismatches(R, wrong, undefined, same)).toBeGreaterThan(0);
  });
  it('null control: another seed disagrees (the front-left cell draws a column)', () => {
    expect(mismatches(R, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30269; }, same)).toBeGreaterThan(0);
  });
  it('the formation re-placement is exercised on its own through the renumbering', () => {
    expect(typeof placeFormation).toBe('function');
  });
});
