/**
 * Diffs encounter.ts (LAB_0A31 encounter start: group clear, add-group with companion chain, party structs, evasion)
 * against the game running the whole routine under Unicorn (oracle/combat3.py encounter). The monster loader,
 * formation picker and picture loader are replayed from the game's own logged results. Committed subset:
 * oracle/encounter-vectors.json (W6_ENCOUNTER_VECTORS for a larger set).
 */
import { describe, expect, it } from 'vitest';
import { startEncounter, type EncounterIO } from '../encounter.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_ENCOUNTER_VECTORS', 'encounter-vectors.json');
const hex16 = (v: number): string => (v & 0xffff).toString(16).padStart(4, '0');

function body(v: any, mem: any, rng: any) {
  const log: any[] = [];
  const loads: [number, number, string][] = v.loads.slice();
  const io: EncounterIO = {
    loadMonster(id, dest) {
      const [lid, ldest, hex] = loads.shift()!;
      if (lid !== id || ldest !== dest) throw new Error('load mismatch');
      for (let k = 0; k < 222; k++) mem.w8(dest + k, parseInt(hex.slice(2 * k, 2 * k + 2), 16));
    },
    formation(a) { log.push(['formation', hex16(a)]); return v.ret.formation; },
    picture(a) { log.push(['pic_mon', hex16(a)]); },
  };
  startEncounter({ m: mem, rng, a4: v.a4 }, io);
  return { log, left: loads.length };
}
const check = (v: any, r: any) => r.fx.left === 0 && JSON.stringify(r.fx.log) === JSON.stringify(v.effects.filter((e: any) => e[0] === 'formation' || e[0] === 'pic_mon'));

describe.skipIf(V.length === 0)('encounter start LAB_0A31', () => {
  it('matches the game on every vector: groups, members, companion chain, party structs, evasion, RNG state', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 120_000);
  it('covers one group and companion chains of several groups, evaded and engaged', () => {
    const groups = V.map((v) => v.loads.length);
    expect(Math.max(...groups)).toBeGreaterThanOrEqual(3);
    expect(groups.some((n) => n === 1)).toBe(true);
  });
  it('null control: another seed disagrees', () => {
    expect(mismatches(V, body, (_v, _m, r) => { r.s[2] = (r.s[2] + 1) % 30000 || 1; }, check)).toBeGreaterThan(V.length / 4);
  });
  it('null control: a different dungeon level changes the companion chain or the evasion', () => {
    const tweak = (v: any, m: any) => { if (m.b.has(v.a4 - 18339)) m.b.set(v.a4 - 18339, (m.u8(v.a4 - 18339) + 5) & 0xff); };
    expect(mismatches(V, body, tweak, check)).toBeGreaterThan(0);
  });
});
