import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSeq, frameWords, frameWordCount, frameIndices } from '../cyberpaint-seq.ts';

function be16(v: number) { return [(v >> 8) & 255, v & 255]; }
function be32(v: number) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }

function synthetic(storage: number, payload: number[], w = 16, h = 1): Uint8Array {
  const hdr = new Array(128).fill(0);
  hdr.splice(0, 2, 0xff, 0xff);
  hdr.splice(0x3a, 2, ...be16(w)); hdr.splice(0x3c, 2, ...be16(h));
  hdr[0x3f] = storage; hdr.splice(0x40, 4, ...be32(payload.length));
  const file = new Array(0x80).fill(0);
  file.splice(0, 2, 0xfe, 0xdb); file.splice(4, 4, ...be32(1)); file.splice(0x80, 0, ...be32(0x84));
  return new Uint8Array([...file, ...hdr, ...payload]);
}

describe('cyberpaint-seq synthetic', () => {
  it('decodes RLE (repeat + literal) to the exact size', () => {
    // 16x1 => 4 words: repeat 2 x 0xAAAA, literal 2 words
    const d = synthetic(1, [...be16(2), ...be16(0xaaaa), ...be16(0x8002), ...be16(1), ...be16(2)]);
    const f = parseSeq(d).frames[0];
    expect(Array.from(frameWords(d, f))).toEqual([0xaaaa, 0xaaaa, 1, 2]);
  });
  it('rejects short, long and trailing-byte streams', () => {
    for (const p of [[...be16(1), ...be16(7)], [...be16(5), ...be16(7)], [...be16(4), ...be16(7), 0, 0]]) {
      const d = synthetic(1, p);
      expect(() => frameWords(d, parseSeq(d).frames[0])).toThrow();
    }
  });
  it('raw frames must be exactly ceil(w/16)*h*8 bytes', () => {
    const ok = synthetic(0, new Array(8).fill(0));
    expect(frameWords(ok, parseSeq(ok).frames[0]).length).toBe(4);
    const bad = synthetic(0, new Array(6).fill(0));
    expect(() => frameWords(bad, parseSeq(bad).frames[0])).toThrow();
  });
});

const dir = resolve('data/zombi/amiga/data');
describe.skipIf(!existsSync(dir))('cyberpaint-seq on Zombi data', () => {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.seq$/i.test(f)) : [];
  it('every frame of every file decodes exactly; shifted stream fails (null)', () => {
    let frames = 0, comp = 0, nullFail = 0;
    for (const f of files) {
      const d = new Uint8Array(readFileSync(resolve(dir, f)));
      for (const fr of parseSeq(d).frames) {
        expect(frameWords(d, fr).length).toBe(frameWordCount(fr));
        expect(frameIndices(d, fr).length).toBe(fr.width * fr.height);
        frames++;
        if (fr.storage === 1) {
          comp++;
          try { frameWords(d, fr, 2); } catch { nullFail++; }
        }
      }
    }
    expect(files.length).toBe(11);
    expect(frames).toBe(210);
    expect(nullFail).toBe(comp);
  });
});
