import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { artVolumeAvailable } from '../artgame-kernel.ts';
import { unpackAll } from '../../abandonedplaces/unpack.ts';
import { checkGeometry, decodeRecord, parseDef, readClr } from '../artgame-tileset.ts';

describe('artgame-tileset fixtures', () => {
  it('reads 0RGB words and decodes a mask-last 1-colour-plane image', () => {
    expect(readClr(new Uint8Array([0x0f, 0xa0, 0x00, 0x05]))).toEqual([{ r: 255, g: 170, b: 0 }, { r: 0, g: 0, b: 85 }]);
    const def = new Uint8Array(28);
    const dv = new DataView(def.buffer);
    [8, 1, 0, 0, 8, 1, 0x0001 /* 1 plane + mask bit */, 1, 1, 0, 0, 1, 0, 1].forEach((v, i) => dv.setUint16(i * 2, v));
    const recs = parseDef(def, new Uint8Array(4), 2);
    const img = decodeRecord(new Uint8Array([0b10101010, 0b11110000]), recs[0]);
    expect(Array.from(img.indices)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(Array.from(img.mask!)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });
});

const dir = resolve('data/abandonedplaces2/amiga');
describe.skipIf(!artVolumeAvailable('abandonedplaces2', dir))('AP2 tileset triplets', () => {
  const cache = unpackAll('abandonedplaces2').dir;
  const bases = readdirSync(cache).filter((f) => f.endsWith('.def') && existsSync(resolve(cache, f.replace('.def', '.bpl')))).map((f) => f.slice(0, -4));
  it('every non-empty record satisfies the geometry invariants (incl. the former 44 unmasked UI failures)', () => {
    let n = 0, ok = 0;
    for (const b of bases) {
      const bpl = readFileSync(resolve(cache, `${b}.bpl`));
      const ofsP = resolve(cache, `${b}.ofs`);
      const recs = parseDef(new Uint8Array(readFileSync(resolve(cache, `${b}.def`))), existsSync(ofsP) ? new Uint8Array(readFileSync(ofsP)) : null, bpl.length);
      const r = checkGeometry(recs, null, bpl.length);
      n += r.nonEmpty; ok += r.ok;
    }
    expect(n).toBe(1962);
    expect(ok).toBe(n);
  });
  it('mask-last: no colour pixel outside the mask; mask-first (null control) leaks heavily', () => {
    let leakLast = 0, leakFirst = 0, outside = 0;
    for (const b of ['wl_00', 'mon_00', 'obj_00', 'gt_00', 'strd_00']) {
      const bpl = new Uint8Array(readFileSync(resolve(cache, `${b}.bpl`)));
      const recs = parseDef(new Uint8Array(readFileSync(resolve(cache, `${b}.def`))), new Uint8Array(readFileSync(resolve(cache, `${b}.ofs`))), bpl.length);
      for (const r of recs.filter((x) => !x.empty)) {
        const img = decodeRecord(bpl, r);
        for (let i = 0; i < img.indices.length; i++) if (!img.mask![i]) { outside++; if (img.indices[i]) leakLast++; }
        // wrong variant: treat the first plane as the mask and the rest as colour
        const alt = decodeRecord(bpl, { ...r, planes: r.planes, hasMask: false, offset: r.offset + r.planeSize, planeSize: r.planeSize });
        const m0 = decodeRecord(bpl, { ...r, planes: 1, hasMask: false });
        for (let i = 0; i < alt.indices.length; i++) if (!m0.indices[i] && alt.indices[i]) leakFirst++;
      }
    }
    expect(leakLast).toBe(0);
    expect(outside).toBeGreaterThan(10000);
    expect(leakFirst).toBeGreaterThan(outside * 0.1);
  });
});
