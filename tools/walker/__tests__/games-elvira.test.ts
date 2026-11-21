/**
 * Elvira 1 (Amiga): the VC opcode table derived from the game's own 750 script
 * segments. Real-data blocks skip when `data/elvira` is absent; the table has
 * null controls (other dialects, a perturbed draw length).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { simonDecr, discoverZones } from '../../shared/agos-vga.ts';
import { parseVga1, scriptStarts, ELVIRA1_VC_PARAM_BYTES, ELVIRA2_VC_PARAM_BYTES, VC_PARAM_BYTES } from '../../shared/agos-vc.ts';

const DATA = resolve('data/elvira/amiga/data');
const HAVE = existsSync(resolve(DATA, '011.pkd'));

describe('real data: Elvira 1 VC dialect', { skip: !HAVE }, () => {
  const zs = discoverZones(readdirSync(DATA), 'elvira').filter((z) => z.type1);
  const segments = zs.flatMap((z) => {
    const v = parseVga1(simonDecr(new Uint8Array(readFileSync(resolve(DATA, z.type1!)))), VC_PARAM_BYTES);
    const st = scriptStarts(v);
    return st.slice(0, -1).map((a, i) => ({ d: v.data, a, b: st[i + 1] }));
  });
  const score = (table: readonly number[], tweak?: (op: number) => number | undefined) => {
    let good = 0;
    for (const s of segments) {
      let p = s.a;
      let ok = true;
      for (;;) {
        if (p + 2 > s.b) { ok = false; break; }
        const o = (s.d[p] << 8) | s.d[p + 1];
        p += 2;
        if (o === 0) break;
        const n = tweak?.(o) ?? table[o];
        if (n === undefined || n < 0) { ok = false; break; }
        p += n;
        if (p > s.b) { ok = false; break; }
      }
      if (ok && p === s.b) good++;
    }
    return good;
  };
  it('750 segments in 65 zones; the Elvira 1 table ends every one on its successor; other dialects and perturbations do not', () => {
    expect(zs.length).toBe(65);
    expect(segments.length).toBe(750);
    expect(score(ELVIRA1_VC_PARAM_BYTES)).toBe(750);
    expect(score(VC_PARAM_BYTES)).toBeLessThan(100); // 54: the Waxworks dialect is far from Elvira 1's
    expect(score(ELVIRA2_VC_PARAM_BYTES)).toBeLessThan(100); // 57
    expect(score(ELVIRA1_VC_PARAM_BYTES, (o) => (o === 10 ? 6 : undefined))).toBeLessThan(650); // a wrong draw length (most scripts do not draw)
    expect(score(ELVIRA1_VC_PARAM_BYTES, (o) => (o === 22 ? 4 : undefined))).toBeLessThan(720); // a wrong setPalette length
  });
});
