import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  artVolumeAvailable, loadArtVolume, parseArtDirectory, readVolumeEntry, unpackArtGame, unpackArtGameStrict,
} from '../artgame-kernel.ts';

const GAMES = [
  { game: 'abandonedplaces', dir: 'data/abandonedplaces/amiga', total: 454, packed: 427, sections: [90, 96, 76, 92, 100] },
  { game: 'abandonedplaces2', dir: 'data/abandonedplaces2/amiga', total: 617, packed: 262, sections: [63, 160, 194, 200] },
] as const;

describe('artgame fixtures', () => {
  it('parses a synthetic directory with separators', () => {
    const rec = (name: string, off: number) => {
      const b = new Uint8Array(32);
      b.set(new TextEncoder().encode(name));
      new DataView(b.buffer).setUint32(16, off);
      return b;
    };
    const buf = new Uint8Array(32 + 2 + 32 + 4);
    buf.set(rec('a', 1), 0);
    buf.set(rec('b', 2), 34);
    const e = parseArtDirectory(buf);
    expect(e.map((x) => [x.name, x.section, x.offset])).toEqual([['a', 0, 1], ['b', 1, 2]]);
  });
  it('unpacks a hand-built literal-only stream and rejects a flipped byte', () => {
    // literals "ABC": control 0x02 (c<4, count=3) read backward after bytes; stream (forward)
    // = [C,B,A? ...] — build: out="ABC"; src = lits reversed then ctl, chk, size.
    const src = new Uint8Array([0x41, 0x42, 0x43, 0x02, 0x02, 3, 0, 0]);
    const r = unpackArtGame(src);
    expect(Array.from(r.data)).toEqual([0x41, 0x42, 0x43]);
    expect(r.checksum).toBe(0);
    expect(r.inputLeft).toBe(0);
    const bad = src.slice(); bad[3] ^= 0x04; // different literal count -> overrun/garbage
    expect(() => unpackArtGameStrict(bad, 3)).toThrow();
  });
});

for (const g of GAMES) {
  const dir = resolve(g.dir);
  describe.skipIf(!artVolumeAvailable(g.game, dir))(`${g.game} corpus`, () => {
    const v = loadArtVolume(g.game, dir);
    it('directory shape', () => {
      expect(v.entries.length).toBe(g.total);
      for (let s = 0; s < g.sections.length; s++) expect(v.entries.filter((e) => e.section === s).length).toBe(g.sections[s]);
      expect(v.entries.filter((e) => e.packed).length).toBe(g.packed);
      // contiguity per section
      for (let i = 1; i < v.entries.length; i++) {
        const a = v.entries[i - 1], b = v.entries[i];
        if (a.section === b.section) expect(b.offset).toBe(a.offset + a.stored);
      }
    });
    it(`all packed records unpack: checksum 0, consumed, size exact (${g.packed})`, () => {
      let ok = 0;
      for (const e of v.entries) {
        const raw = v.images[e.section].subarray(e.offset, e.offset + e.stored);
        if (e.packed) {
          const r = unpackArtGame(raw);
          expect(r.checksum, e.name).toBe(0);
          expect(r.inputLeft, e.name).toBe(0);
          expect(r.data.length, e.name).toBe(e.size);
          ok++;
        } else expect(readVolumeEntry(v, e).length).toBe(e.size);
      }
      expect(ok).toBe(g.packed);
    });
    it('null controls: flipped byte and 1-byte shift fail every sampled record', () => {
      const packed = v.entries.filter((e) => e.packed && e.stored > 64);
      let flipFail = 0, shiftFail = 0, n = 0;
      for (const e of packed.filter((_, i) => i % 7 === 0)) {
        const raw = v.images[e.section].slice(e.offset, e.offset + e.stored);
        n++;
        const f = raw.slice(); f[f.length - 5] ^= 0x01; // first control byte read (chk covers control bytes only)
        try { unpackArtGameStrict(f, e.size); } catch { flipFail++; }
        // trailing-edge shift: drop the last byte (trailer misaligned)
        try { unpackArtGameStrict(raw.subarray(0, raw.length - 1), e.size); } catch { shiftFail++; }
      }
      expect(n).toBeGreaterThan(10);
      expect(flipFail).toBe(n);
      expect(shiftFail).toBe(n);
    });
    it('unpack is deterministic (sha1 stable across two runs of the first packed record)', () => {
      const e = v.entries.find((x) => x.packed)!;
      const h = () => createHash('sha1').update(readVolumeEntry(v, e)).digest('hex');
      expect(h()).toBe(h());
    });
  });
}
