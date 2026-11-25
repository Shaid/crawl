/**
 * Diffs the entity dispatcher LAB_06B6 (tools/wizardry6/entities.ts) against the game under Unicorn (oracle/combat6.py dispatch), every
 * kind handler stubbed and logged, the stubs scripting the state / advance flag the way real handlers do. Committed subset
 * oracle/dispatch-vectors.json; larger sets via W6_DISPATCH_VECTORS.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { dispatchEntities, ENTITY_HANDLERS, entityKind16, entityKind3, entityKind6, flipTriggers, markFired } from '../entities.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const D = loadVectors('W6_DISPATCH_VECTORS', 'dispatch-vectors.json');
const same = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

/** Replay the stubs' scripted side effects (they are not game code, so the oracle does not track them: write untracked). */
const body = (v: any, m: any, rng: any, swap?: Record<string, string>) => {
  const fx: Effect[] = [];
  const sc = [...v.script];
  const a4 = v.a4;
  const put = (a: number, val: number) => { for (const [k, x] of [[a, val >> 8], [a + 1, val & 0xff]]) { m.b.set(k, x); if (m.wrote.has(k)) m.wrote.set(k, x); } };
  dispatchEntities({ m, rng, a4 }, (name, f, args = '') => {
    f.push([swap?.[name] ?? name, args]);
    const [st, adv, f920] = sc.shift()!;
    put(a4 - 18610, st);
    if (adv !== null) put(a4 - 10918, adv);
    if (f920 !== null) put(a4 - 10920, f920);
  }, fx);
  return fx;
};

describe.skipIf(D.length === 0)('entity dispatcher LAB_06B6', () => {
  it('matches the game: cell scan, kind -> handler table, kind 5 inline, cursor advance, early exit on a state change', () => {
    expect(mismatches(D, (v, m, r) => body(v, m, r), undefined, same)).toBe(0);
  }, 120_000);
  it('covers every kind handler of the table', () => {
    const seen = new Set(D.flatMap((v) => v.effects.map((e: any) => e[0])));
    for (const name of Object.values(ENTITY_HANDLERS)) if (name !== 'LAB_062F') expect(seen.has(name)).toBe(true);
    expect(seen.has('LAB_05B1') && seen.has('LAB_05E0') && seen.has('jt-32466')).toBe(true);
  });
  it('null control: two handlers swapped in the table disagrees', () => {
    expect(mismatches(D, (v, m, r) => body(v, m, r, { LAB_05DA: 'LAB_062B' }), undefined, same)).toBeGreaterThan(0);
  });
  it('null control: ignoring the advance flag disagrees', () => {
    const wrong = (v: any, m: any, r: any) => body({ ...v, script: v.script.map((s: any) => [s[0], 1, s[2]]) }, m, r);
    expect(mismatches(D, wrong, undefined, same)).toBeGreaterThan(0);
  });
});

const K3 = loadVectors('W6_K3_VECTORS', 'k3-vectors.json');
const K16 = loadVectors('W6_K16_VECTORS', 'k16-vectors.json');
const K6 = loadVectors('W6_K6_VECTORS', 'k6-vectors.json');
const MK = loadVectors('W6_MARK_VECTORS', 'mark-vectors.json');
const TG = loadVectors('W6_TRIG_VECTORS', 'trig-vectors.json');
const c = (v: any, m: any, rng: any) => ({ m, rng, a4: v.a4 });

describe.skipIf(K3.length === 0)('entity kind 3 LAB_05DA', () => {
  const body = (v: any, m: any, r: any) => { const fx: Effect[] = []; entityKind3(c(v, m, r), fx); return fx; };
  it('matches the game: facing gate, message, event state 0x15', () => {
    expect(mismatches(K3, body, undefined, same)).toBe(0);
  }, 60_000);
  it('covers the message, the early returns and the state change', () => {
    expect(K3.some((v) => v.effects.length > 0) && K3.some((v) => v.effects.length === 0)).toBe(true);
    expect(K3.some((v) => v.diff[String(v.a4 - 18610 + 1)] === 0x15)).toBe(true);
  });
  it('null control: ignoring the facing gate disagrees', () => {
    expect(mismatches(K3, (v, m, r) => { m.b.set(v.a4 - 18328 + 1, (m.u8(v.a4 - 18328 + 1) + 1) & 3); return body(v, m, r); }, undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(K16.length === 0)('entity kind 16 LAB_062B', () => {
  const body = (v: any, m: any, r: any) => { const fx: Effect[] = []; entityKind16(c(v, m, r), fx); return fx; };
  it('matches the game: facing gate, state 9, message and fired mark', () => {
    expect(mismatches(K16, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: a wrong mode field disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const fx: Effect[] = []; entityKind16(c(v, m, r), fx); markFired(c(v, m, r), 3); return fx; };
    expect(mismatches(K16, wrong, undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(K6.length === 0)('entity kind 6 LAB_0685', () => {
  const body = (v: any, m: any, r: any) => { entityKind6(c(v, m, r)); return [] as Effect[]; };
  it('matches the game: the key-item test over the party and the trigger flips', () => {
    expect(mismatches(K6, body, undefined, same)).toBe(0);
  }, 60_000);
  it('null control: the flip with the opposite sense disagrees', () => {
    const wrong = (v: any, m: any, r: any) => { const x = c(v, m, r); const B = m.u32(v.a4 - 18458); flipTriggers(x, m.u16(B + 288 + 2 * v.idx), m.u8(B + 1584 + v.idx), 1); return [] as Effect[]; };
    expect(mismatches(K6, wrong, undefined, same)).toBeGreaterThan(0);
  });
});

describe.skipIf(MK.length === 0)('mark fired LAB_05CD and trigger flip LAB_066D', () => {
  it('mark matches the game: mode 1 transient, mode 2 also persistent', () => {
    expect(mismatches(MK, (v, m, r) => { markFired(c(v, m, r), v.args[0]); return []; }, undefined, same)).toBe(0);
    expect(mismatches(MK, (v, m, r) => { markFired(c(v, m, r), Math.min(v.args[0], 1)); return []; }, undefined, same)).toBeGreaterThan(0);
  }, 60_000);
  it('flip matches the game', () => {
    expect(mismatches(TG, (v, m, r) => { flipTriggers(c(v, m, r), v.args[0], v.args[1], v.args[2]); return []; }, undefined, same)).toBe(0);
    expect(mismatches(TG, (v, m, r) => { flipTriggers(c(v, m, r), v.args[1], v.args[0], v.args[2]); return []; }, undefined, same)).toBeGreaterThan(0);
  }, 60_000);
});
