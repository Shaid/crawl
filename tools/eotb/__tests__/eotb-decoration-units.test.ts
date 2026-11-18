import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDecorations } from '../decode-decorations.ts';
import { decodeCps } from '../decode-cps.ts';

const A = (n: string) => resolve(`data/eotb/amiga/${n}`);
const load = (name: string) => decodeDecorations(new Uint8Array(readFileSync(A(`${name}.DAT`))));

/** Share of the sheet's opaque pixels (index != 0) covered by the union of the rects. */
function coverage(indices: Uint8Array, rects: { x: number; y: number; w: number; h: number }[], scale: number): number {
  const covered = new Uint8Array(320 * 200);
  for (const r of rects) {
    const x = Math.floor(r.x * scale), w = Math.floor(r.w * scale);
    for (let yy = r.y; yy < Math.min(200, r.y + r.h); yy++)
      for (let xx = x; xx < Math.min(320, x + w); xx++) covered[yy * 320 + xx] = 1;
  }
  let opaque = 0, hit = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] !== 0) { opaque++; hit += covered[i]!; }
  return hit / opaque;
}

describe('decoration rect units (x/w are 8-px columns on disk)', () => {
  it('BRICK rects 0-2 are the documented column-unit packing, converted to pixels', () => {
    const d = load('BRICK');
    expect(d.rects.slice(0, 3)).toEqual([
      { x: 0, y: 55, w: 72, h: 25 },
      { x: 72, y: 55, w: 48, h: 17 },
      { x: 120, y: 55, w: 32, h: 11 },
    ]);
  });

  it('no rect leaves the 320x200 canvas in any wall set', () => {
    for (const n of ['BRICK', 'BLUE', 'DROW', 'GREEN', 'XANATHA']) {
      for (const r of load(n).rects) {
        expect(r.x + r.w).toBeLessThanOrEqual(320);
        expect(r.y + r.h).toBeLessThanOrEqual(200);
      }
    }
  });

  it('rect union covers >=88-95% of the Amiga sheet opaque pixels as pixels, but the unscaled (old) reading covers <40% (null control)', () => {
    if (!existsSync(A('BRICK1.CPS'))) return;
    for (const [dat, cps, min] of [['BRICK', 'BRICK1', 0.95], ['BLUE', 'BLUE', 0.95], ['XANATHA', 'XANATHA', 0.88]] as const) {
      const sheet = decodeCps(new Uint8Array(readFileSync(A(`${cps}.CPS`))));
      const rects = load(dat).rects;
      const good = coverage(sheet.indices, rects, 1);
      const old = coverage(sheet.indices, rects, 1 / 8); // pre-fix reading: raw on-disk x/w used as pixels
      expect(good).toBeGreaterThan(min);
      expect(old).toBeLessThan(0.4);
    }
  });
});
