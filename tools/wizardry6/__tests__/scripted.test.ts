/**
 * Diffs the scripted-encounter trigger code (tools/wizardry6/scripted.ts) against the game under Unicorn
 * (oracle/combat5.py): the region flood LAB_0735, the exploration entry LAB_08A7, the per-move test LAB_08AA, entity kinds
 * 4 and 5, and the zone indicator. Committed subsets: oracle/{region,entry,loop,kind4,kind5,zone}-vectors.json; larger sets via
 * W6_REGION_VECTORS, W6_ENTRY_VECTORS, W6_LOOP_VECTORS, W6_KIND4_VECTORS, W6_KIND5_VECTORS, W6_ZONE_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { entityKind4, entityKind5, exploreEntry, scriptedTest, setRegion, zoneIndicator } from '../scripted.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const RG = loadVectors('W6_REGION_VECTORS', 'region-vectors.json');
const EN = loadVectors('W6_ENTRY_VECTORS', 'entry-vectors.json');
const LP = loadVectors('W6_LOOP_VECTORS', 'loop-vectors.json');
const K4 = loadVectors('W6_KIND4_VECTORS', 'kind4-vectors.json');
const K5 = loadVectors('W6_KIND5_VECTORS', 'kind5-vectors.json');
const ZN = loadVectors('W6_ZONE_VECTORS', 'zone-vectors.json');
const ctx = (v: any, mem: any, rng: any) => ({ m: mem, rng, a4: v.a4 });
const sameFx = (v: any, r: any) => JSON.stringify(r.fx.fx) === JSON.stringify(v.effects);

describe.skipIf(RG.length === 0)('region set / clear LAB_0735', () => {
  const body = (v: any, mem: any, rng: any) => { setRegion(ctx(v, mem, rng), v.lv, v.x, v.y, v.val); return {}; };
  it('matches the game: every bit-map and spot byte written, nothing read outside the footprint', () => {
    expect(mismatches(RG, body)).toBe(0);
  }, 120_000);
  it('covers clears that do work, sets that flood, and no-ops', () => {
    expect(RG.some((v) => v.val === 0 && Object.keys(v.diff).length > 1)).toBe(true);
    expect(RG.some((v) => v.val === 1 && Object.keys(v.diff).length > 1)).toBe(true);
    expect(RG.some((v) => Object.keys(v.diff).length === 0)).toBe(true);
  });
  it('null control: clearing with val 1 (or the wrong cell) disagrees', () => {
    expect(mismatches(RG, (v, m, r) => { setRegion(ctx(v, m, r), v.lv, v.x, v.y, 1 - v.val); return {}; })).toBeGreaterThan(0);
    expect(mismatches(RG, (v, m, r) => { setRegion(ctx(v, m, r), v.lv, v.y, v.x, v.val); return {}; })).toBeGreaterThan(0);
  });
});

describe.skipIf(EN.length === 0)('exploration entry LAB_08A7 (clear, redraw, scripted-spot test)', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const fired = exploreEntry(ctx(v, mem, rng), fx); return { fx, fired }; };
  const ok = (v: any, r: any) => sameFx(v, r) && r.fx.fired === !v.fell;
  it('matches the game: bit-map clear, spot erase, -18608/-18610/-10894, the encounter id and its flags', () => {
    expect(mismatches(EN, body, undefined, ok)).toBe(0);
  }, 120_000);
  it('fires only when the return state is 0x17 (the clear is skipped), never from a plain state 5 re-entry', () => {
    const fired = EN.filter((v) => !v.fell);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((v) => v.ret_state === 0x17)).toBe(true);
    expect(EN.some((v) => v.ret_state === 5 && v.fell)).toBe(true);
  });
  it('null control: testing before the clear, or ignoring the 0x17 skip, disagrees', () => {
    const testFirst = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const c = ctx(v, mem, rng); const fired = scriptedTest(c); return { fx, fired }; };
    expect(mismatches(EN, testFirst, undefined, ok)).toBeGreaterThan(0);
    const noSkip = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; const c = ctx(v, mem, rng); mem.b.set(v.a4 - 18608, 0); mem.b.set(v.a4 - 18608 + 1, 5); return { fx, fired: exploreEntry(c, fx) }; };
    expect(mismatches(EN, noSkip, undefined, ok)).toBeGreaterThan(0);
  });
});

describe.skipIf(LP.length === 0)('per-move scripted test LAB_08AA', () => {
  const body = (v: any, mem: any, rng: any) => ({ fx: [] as Effect[], fired: scriptedTest(ctx(v, mem, rng)) });
  const ok = (v: any, r: any) => sameFx(v, r) && r.fx.fired === !v.fell;
  it('matches the game and fires from any return state (no clear in the loop)', () => {
    expect(mismatches(LP, body, undefined, ok)).toBe(0);
    expect(new Set(LP.filter((v) => !v.fell).map((v) => v.ret_state)).size).toBeGreaterThan(2);
  }, 60_000);
  it('null control: another seed changes the encounter id', () => {
    expect(mismatches(LP, body, (_v, _m, r) => { r.s[0] = (r.s[0] + 3) % 30269; }, ok)).toBeGreaterThan(0);
  });
});

describe.skipIf(K4.length === 0)('entity kind 4 LAB_062F', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; entityKind4(ctx(v, mem, rng), fx); return { fx }; };
  it('matches the game: operand byte as id or group pick, flags, state, cursor advance', () => {
    expect(mismatches(K4, body, undefined, sameFx)).toBe(0);
  }, 60_000);
  it('null control: always treating the operand as a group disagrees', () => {
    const wrong = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; entityKind4(ctx(v, mem, rng), fx, true); return { fx }; };
    expect(mismatches(K4, wrong, undefined, sameFx)).toBeGreaterThan(0);
  });
});

describe.skipIf(K5.length === 0)('entity kind 5 (LAB_06B6 inline)', () => {
  const body = (v: any, mem: any, rng: any) => { entityKind5(ctx(v, mem, rng)); return { fx: [] as Effect[] }; };
  it('matches the game: operand byte is the monster id, state 0x12, cursor advance', () => {
    expect(mismatches(K5, body, undefined, sameFx)).toBe(0);
  }, 60_000);
  it('null control: a wrong cursor offset disagrees', () => {
    expect(mismatches(K5, (v, m, r) => { entityKind5({ m, rng: r, a4: v.a4 }); m.w16(v.a4 - 18148, 0); return { fx: [] as Effect[] }; }, undefined, sameFx)).toBeGreaterThan(0);
  });
});

describe.skipIf(ZN.length === 0)('zone indicator after LAB_08BD', () => {
  const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; zoneIndicator(ctx(v, mem, rng), fx); return { fx }; };
  it('matches the game: messages 2023 / 2054 and the -10894 / -10890 flags', () => {
    expect(mismatches(ZN, body, undefined, sameFx)).toBe(0);
    expect(ZN.some((v) => v.effects.length > 0)).toBe(true);
  }, 60_000);
  it('null control: a different map number disagrees', () => {
    expect(mismatches(ZN, body, (v, m) => { m.b.set(v.a4 - 18340 + 1, 3); }, sameFx)).toBeGreaterThan(0);
  });
});
