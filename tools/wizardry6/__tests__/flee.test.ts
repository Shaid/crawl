/**
 * Diffs flee.ts (hide LAB_0FC5, run LAB_0FD2) against the game's routines under Unicorn, only the message
 * printing stubbed (oracle/combat3.py flee). Committed subset: oracle/flee-vectors.json (W6_FLEE_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { hide, run } from '../flee.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_FLEE_VECTORS', 'flee-vectors.json');
const body = (v: any, mem: any, rng: any) => (v.what === 'hide' ? hide : run)({ m: mem, rng, a4: v.a4 }, v.A);

describe.skipIf(V.length === 0)('hide LAB_0FC5 and run LAB_0FD2', () => {
  it('matches the game: flag written, skill gain, RNG state', () => {
    expect(mismatches(V, body)).toBe(0);
  }, 120_000);
  it('covers both actions, successes and failures', () => {
    expect(V.some((v) => v.what === 'hide')).toBe(true);
    expect(V.some((v) => v.what === 'run')).toBe(true);
    const flags = V.filter((v) => Object.entries<number>(v.diff).some(([a, b]) => Number(a) === v.A + 43 && b !== 0));
    expect(flags.length).toBeGreaterThan(V.length / 10);
    expect(flags.length).toBeLessThan(V.length);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 1) % 30000 || 1; })).toBeGreaterThan(V.length / 10);
  });
  it('null control: a different chance (monster presence byte) disagrees', () => {
    const tweak = (v: any, m: any) => { for (let g = 1; g < 6; g++) { const R = m.u32(v.a4 - 15294 + 4 * g); for (const q of [122, 137]) if (m.b.has(R + q)) m.b.set(R + q, (m.u8(R + q) + 40) & 0xff); } };
    expect(mismatches(V, body, tweak)).toBeGreaterThan(0);
  });
});
