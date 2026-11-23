/** Shared helpers for the pass-3 vector tests: load a committed subset (or a W6_* env override) and
 *  replay it on the footprint-only byte map. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mem } from '../combat.ts';
import { W6Rng } from '../rules.ts';

export function loadVectors(envName: string, file: string): any[] {
  const p = process.env[envName] ?? resolve('tools/wizardry6/oracle', file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

/** Message-text scratch buffers (-10836..-10596 rel. A4): presentation, not rules. */
export const isText = (a: number, a4: number): boolean => a - a4 >= -10836 && a - a4 < -10596;

export interface Replay { mem: Mem; rng: W6Rng; fx: unknown }

/** Run `body` on a footprint Mem + seeded RNG; returns what the port wrote and its RNG state. */
export function replay(v: any, body: (mem: Mem, rng: W6Rng) => unknown, tweak?: (mem: Mem, rng: W6Rng) => void) {
  const mem = new Mem(v.foot);
  const rng = new W6Rng(v.seed);
  tweak?.(mem, rng);
  const fx = body(mem, rng);
  const wrote: Record<string, number> = {};
  for (const [a, b] of mem.wrote) if (!isText(a, v.a4)) wrote[a] = b;
  const want: Record<string, number> = {};
  for (const [a, b] of Object.entries<number>(v.diff)) if (!isText(Number(a), v.a4)) want[a] = b;
  const sort = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort((x, y) => +x[0] - +y[0]));
  return { fx, ok: sort(wrote) === sort(want) && JSON.stringify([...rng.s]) === JSON.stringify(v.rng), wrote, want, rng: [...rng.s] };
}

/** Count vectors whose replay disagrees with the game (exceptions count as mismatches). */
export function mismatches(V: any[], body: (v: any, mem: Mem, rng: W6Rng) => unknown,
  tweak?: (v: any, mem: Mem, rng: W6Rng) => void, extra?: (v: any, r: ReturnType<typeof replay>) => boolean): number {
  let bad = 0;
  for (const v of V) {
    try {
      const r = replay(v, (mem, rng) => body(v, mem, rng), tweak ? (mem, rng) => tweak(v, mem, rng) : undefined);
      if (!r.ok || (extra && !extra(v, r))) bad++;
    } catch { bad++; }
  }
  return bad;
}
