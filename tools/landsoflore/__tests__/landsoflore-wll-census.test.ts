import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeCmz } from '../decode-maze.ts';
import { decodeWll, buildWllLookup } from '../decode-wll.ts';
import { parsePak, readEntry, CACHE_DIR } from '../export-dungeon.ts';

/** Census of `.WLL` coverage over the cached level PAKs (2026-11 audit: the old "zero misses, sequential 0..51" claim came from LEVEL1/LEVEL12 only). */
function census(n: number) {
  const path = resolve(CACHE_DIR, 'DATA', `L${String(n).padStart(2, '0')}.PAK`);
  if (!existsSync(path)) return null;
  const pak = readFileSync(path);
  const e = parsePak(pak);
  const get = (ext: string) => readEntry(pak, e.get([...e.keys()].find((k) => k.toUpperCase() === `LEVEL${n}.${ext}`)!)!);
  const wll = decodeWll(get('WLL'));
  const keys = wll.records.map((r) => r.wallTypeIndex);
  const lookup = buildWllLookup(wll);
  const maze = decodeCmz(get('CMZ'));
  const missSides = new Map<number, number>();
  for (const cell of maze.cells) for (const v of cell) if (v !== 0 && !lookup.has(v)) missSides.set(v, (missSides.get(v) ?? 0) + 1);
  return { keys, missSides };
}

describe('LoL .WLL census (levels 1-12)', () => {
  it('LEVEL2 and LEVEL3 use raw wall values absent from their own .WLL (the fallback is exercised); every other level has none', () => {
    const l2 = census(2);
    const l3 = census(3);
    if (!l2 || !l3) return;
    expect([...l2.missSides.keys()].sort((a, b) => a - b)).toEqual([46, 53, 54, 55, 56, 57, 59, 60]);
    expect([...l2.missSides.values()].reduce((a, b) => a + b, 0)).toBe(30);
    expect([...l3.missSides.keys()].sort((a, b) => a - b)).toEqual([58, 61, 63, 66, 67]);
    expect([...l3.missSides.values()].reduce((a, b) => a + b, 0)).toBe(20);
    for (const n of [1, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const c = census(n);
      if (c) expect(c.missSides.size, `LEVEL${n}`).toBe(0); // null control: the census can return 0 misses
    }
  });

  it('duplicate .WLL keys occur (LEVEL2/3/10 redefine indices 1 and 2) and the .WLL is not a sequential 0..N array', () => {
    for (const n of [2, 3, 10]) {
      const c = census(n);
      if (!c) continue;
      const dups = c.keys.filter((v, i) => c.keys.indexOf(v) !== i);
      expect(dups).toEqual([1, 2]);
    }
    const l1 = census(1);
    if (l1) expect(l1.keys.every((v, i) => v === i)).toBe(false);
  });
});
