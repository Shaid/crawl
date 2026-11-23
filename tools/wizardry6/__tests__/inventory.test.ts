/**
 * Diffs removeItem (LAB_0DE6, CODE+0x22278: use up one thrown / shot item, compact the inventory) against the
 * game's routine under Unicorn (oracle/combat3.py remove). Committed subset: oracle/remove-vectors.json.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '../combat.ts';
import { removeItem } from '../inventory.ts';
import { loadVectors, mismatches } from './vec-util.ts';

const V = loadVectors('W6_REMOVE_VECTORS', 'remove-vectors.json');
const body = (v: any, mem: any, rng: any) => { const fx: Effect[] = []; removeItem({ m: mem, rng, a4: v.a4 }, v.slot, fx); return fx; };
const check = (v: any, r: any) => JSON.stringify(r.fx) === JSON.stringify(v.effects);

describe.skipIf(V.length === 0)('item removal LAB_0DE6', () => {
  it('matches the game: bytes written (stack, equipment slots, shift), recorded callees', () => {
    expect(mismatches(V, body, undefined, check)).toBe(0);
  }, 60_000);
  it('covers a stack decrement, a full removal with shift, and equipped items', () => {
    expect(V.some((v) => v.effects.length === 0)).toBe(true);
    expect(V.some((v) => v.effects.some((e: any) => e[0] === 'weight'))).toBe(true);
    expect(V.some((v) => v.effects.some((e: any) => e[0] === 'unequip'))).toBe(true);
  });
  it('null control: a different slot disagrees', () => {
    expect(mismatches(V, (v, m, r) => body({ ...v, slot: (v.slot + 1) % 6 }, m, r), undefined, check)).toBeGreaterThan(V.length / 4);
  });
});
