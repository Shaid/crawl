/**
 * Diffs tools/wizardry6/combat.ts (the attack resolver LAB_0CD0, CODE+0x1f33e) against vectors
 * produced by running Bane's own routine under Unicorn (tools/wizardry6/oracle/combat.py).
 * Each vector carries the input footprint (every byte the game read), every byte it wrote, the
 * effect log of stubbed callees, and the generator state after. The committed subset is
 * oracle/combat-vectors.json; set W6_COMBAT_VECTORS to a larger generated file for a full sweep.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mem, resolveAttack } from '../combat.ts';
import { W6Rng } from '../rules.ts';

const path = process.env.W6_COMBAT_VECTORS ?? resolve('tools/wizardry6/oracle/combat-vectors.json');
const V: any[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];

/** Message-text scratch buffers (-10836..-10596 rel. A4): presentation, not rules. */
const isText = (a: number, a4: number) => a - a4 >= -10836 && a - a4 < -10596;

function run(v: any, tweak?: (r: { rng: W6Rng; mem: Mem }) => void) {
  const mem = new Mem(v.foot);
  const rng = new W6Rng(v.seed);
  tweak?.({ rng, mem });
  const fx = resolveAttack(mem, rng, {
    a4: v.a4, attacker: v.T, hand: v.hand, kind: v.kind,
    itemCastWord: (id) => { if (!(id in v.items)) throw new Error('item'); return v.items[id]; },
  });
  const wrote: Record<string, number> = {};
  for (const [a, b] of mem.wrote) if (!isText(a, v.a4)) wrote[a] = b;
  const want: Record<string, number> = {};
  for (const [a, b] of Object.entries<number>(v.diff)) if (!isText(Number(a), v.a4)) want[a] = b;
  return { fx, wrote, want, rng: [...rng.s] };
}

function mismatches(tweak?: (v: any, r: { rng: W6Rng; mem: Mem }) => void): number {
  let bad = 0;
  for (const v of V) {
    try {
      const r = run(v, tweak ? (x) => tweak(v, x) : undefined);
      const want = Object.fromEntries(Object.entries(r.want).sort((a, b) => +a[0] - +b[0]));
      const ok = JSON.stringify(r.wrote) === JSON.stringify(want)
        && JSON.stringify(r.fx) === JSON.stringify(v.effects)
        && JSON.stringify(r.rng) === JSON.stringify(v.rng);
      if (!ok) bad++;
    } catch {
      bad++;
    }
  }
  return bad;
}

describe.skipIf(V.length === 0)('attack resolver (CODE+0x1f33e)', () => {
  it('matches the game on every vector: bytes written, effect log, RNG state', () => {
    expect(mismatches()).toBe(0);
  });
  it('covers every attack kind, both sides, and every logged effect', () => {
    const kinds = new Set(V.map((v) => v.kind));
    const fam = new Set(V.map((v) => v.fam));
    const fx = new Set(V.flatMap((v) => v.effects.map((e: any) => e[0])));
    expect([...kinds].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...fam].sort()).toEqual(['mm', 'mp', 'pm']);
    expect([...fx].sort()).toEqual(['set_status', 'spell_effect', 'use_ammo', 'weapon_proc']);
  });
  it('null control: a different RNG seed disagrees', () => {
    expect(mismatches((_v, r) => { r.rng.s[0] = (r.rng.s[0] + 1) % 30000 || 1; })).toBeGreaterThan(V.length / 4);
  });
  it('null control: a defender with one more armour point disagrees somewhere', () => {
    const bump = (v: any, r: { mem: Mem }) => {
      const tg = r.mem.u8(v.T + 0x1f);
      const rec = r.mem.u32(v.a4 - 15294 + 4 * tg);
      r.mem.b.set(rec + 0xbe, (r.mem.u8(rec + 0xbe) + 5) & 0xff);
    };
    expect(mismatches(bump)).toBeGreaterThan(0);
  });
  it('reading outside the recorded footprint throws', () => {
    const m = new Mem({ '1': 5 });
    expect(m.u8(1)).toBe(5);
    expect(() => m.u8(2)).toThrow();
  });
});
