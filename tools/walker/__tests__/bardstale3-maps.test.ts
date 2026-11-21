import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeMapFile, decodeGrp } from '../../bardstale3/amiga/export-maps.ts';
import { lzhufDecode } from '../../bardstale3/amiga/lzhuf.ts';

const D = 'data/_unexplored_/BardsTale3/data';
describe('bardstale3 lzhuf (synthetic)', () => {
  it('a stream of zero bytes does not run past the requested size and reports consumption', () => {
    const { data, consumed } = lzhufDecode(new Uint8Array(64), 0, 16);
    expect(data.length).toBe(16);
    expect(consumed).toBeGreaterThan(0);
  });
});

describe.skipIf(!existsSync(resolve(D, 'maps.hi')))('bardstale3 real data', () => {
  const rd = (n: string) => new Uint8Array(readFileSync(resolve(D, n)));
  it('71 maps decode; every LZHUF stream consumes exactly span+1 (decodeMapFile throws otherwise)', () => {
    const maps = [...decodeMapFile(rd('maps.hi'), 'maps.hi'), ...decodeMapFile(rd('maps.lo'), 'maps.lo')];
    expect(maps).toHaveLength(71);
    expect(maps[0]!.name).toBe('Lucencia');
    expect(maps.filter((m) => m.kind === 'grid')).toHaveLength(10);
    const lu = maps[0]!;
    expect(lu.grid).toHaveLength(144);
    // the directory row words (1..h) step down by w: 0x00b3 .. 0x002f for a 12-wide map
    expect(lu.raw.slice(22, 26)).toEqual([0x00, 0xb3, 0x00, 0xa7]);
  });
  it('null control: starting one byte late breaks the decode of record 0', () => {
    const b = rd('maps.hi');
    const good = lzhufDecode(b, 148 + 4, 863).data;
    const bad = lzhufDecode(b, 148 + 5, 863).data;
    expect(Buffer.compare(Buffer.from(good), Buffer.from(bad))).not.toBe(0);
    expect(Array.from(good.subarray(0, 8))).toEqual([0xcc, 0xf5, 0xe3, 0xe5, 0xee, 0xe3, 0xe9, 0xe1]); // "Lucencia" high-bit
  });
  it('GRP records: header geometry predicts every span (13-byte header + bpr*h)', () => {
    let n = 0;
    for (const f of ['D0WAL.GRP', 'GDUNG.GRP', 'SKARA.GRP', 'WILDWAL.GRP']) {
      const recs = decodeGrp(rd(f)); // throws on any span mismatch
      n += recs.filter((r) => r.px.length).length;
      for (const r of recs) expect(r.px.length).toBe(r.w * r.h);
    }
    expect(n).toBe(32);
  });
});
