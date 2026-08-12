import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeNibbleRle,
  encodeNibbleRle,
  decodeImage32,
  encodeImage32,
  packPlanes,
  unpackPlanes,
  image32FrameBytes,
  image32BytesPerRow,
  type Image32Frame,
} from '../image32.ts';

const FIXTURE = resolve(import.meta.dirname, '../fixtures/anm_decoded/51');

/** Deterministic pseudo-random indices in 0..31. */
function randomIndices(width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = s % 32;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('image32 nibble-RLE codec', () => {
  it('decodes a hand-computed known-answer stream', () => {
    // 0x11 -> literal nibbles 1,1; 0xAB -> literal 0xA,0xB; 0x0F -> run of 16× nibble 0.
    const stream = Uint8Array.from([0x11, 0xab, 0x0f]);
    const { bytes, next } = decodeNibbleRle(stream, 0, 10);
    expect([...bytes]).toEqual([0x11, 0xab, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(next).toBe(3);
  });

  it('decodes a 0xF run (word-aligned) to repeated 0xFF bytes', () => {
    // 0xFE -> run of 15 × nibble 0xF => 7.5 bytes -> 7 full 0xFF bytes + one pending high nibble.
    const { bytes, next } = decodeNibbleRle(Uint8Array.from([0xfe, 0x00]), 0, 8);
    expect(bytes.length).toBe(8);
    // 15 nibbles of 0xF pack MSB-first: FFFF FFFF FFFF FFFF F... 7 bytes then 0xF0.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[7]).toBe(0xf0);
    expect(next).toBe(2);
  });

  it('round-trips arbitrary byte streams (decode(encode(x)) === x)', () => {
    for (const seed of [1, 7, 42]) {
      let s = seed >>> 0;
      const raw = new Uint8Array(512);
      for (let i = 0; i < raw.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        raw[i] = s & 0xff;
      }
      const encoded = encodeNibbleRle(raw);
      const { bytes } = decodeNibbleRle(encoded, 0, raw.length);
      expect(bytesEqual(bytes, raw)).toBe(true);
    }
  });

  it('encode is byte-stable (encode(decode(encode(x))) === encode(x))', () => {
    let s = 99;
    const raw = new Uint8Array(300);
    for (let i = 0; i < raw.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      raw[i] = s & 0xff;
    }
    const e1 = encodeNibbleRle(raw);
    const { bytes } = decodeNibbleRle(e1, 0, raw.length);
    expect(bytesEqual(encodeNibbleRle(bytes), e1)).toBe(true);
  });
});

describe('image32 planar packing', () => {
  it('rassize word-aligns rows', () => {
    expect(image32BytesPerRow(16)).toBe(2);
    expect(image32BytesPerRow(17)).toBe(4); // ((17+15)>>3) & ~1 = 4
    expect(image32BytesPerRow(84)).toBe(12);
    expect(image32FrameBytes(84, 86)).toBe(5 * 86 * 12);
  });

  it('packPlanes/unpackPlanes round-trip indices, including non-16px widths', () => {
    for (const [w, h] of [[17, 9], [84, 86], [32, 32], [1, 1]] as const) {
      const idx = randomIndices(w, h, w * 31 + h);
      const planes = packPlanes(idx, w, h);
      const back = unpackPlanes(planes, w, h);
      expect(bytesEqual(back, idx)).toBe(true);
    }
  });
});

describe('image32 chunk codec', () => {
  it('encodes then decodes a synthetic sheet with identical fields and pixels', () => {
    const frames: Image32Frame[] = [
      { width: 16, height: 16, flags: 0, indices: randomIndices(16, 16, 1) },
      { width: 32, height: 8, flags: 3, indices: randomIndices(32, 8, 2) },
    ];
    const palette = Array.from({ length: 32 }, (_, i) => (i * 0x111) & 0xfff);
    const bytes = encodeImage32(frames, palette, 3);
    const back = decodeImage32(bytes);
    expect(back.frameCount).toBe(2);
    expect(back.depthOrMode).toBe(3);
    expect(back.paletteWords).toEqual(palette);
    for (let i = 0; i < frames.length; i++) {
      expect(back.frames[i].width).toBe(frames[i].width);
      expect(back.frames[i].height).toBe(frames[i].height);
      expect(back.frames[i].flags).toBe(frames[i].flags);
      expect(bytesEqual(back.frames[i].indices, frames[i].indices)).toBe(true);
    }
  });

  it('decode/encode round-trips the real decoded frames of 51.anm byte-exact', () => {
    const meta = JSON.parse(readFileSync(resolve(FIXTURE, 'meta.json'), 'utf-8')) as {
      image_frames: number;
      image_depth: number;
      palette_words_be: number[];
      image_frame_info: { width: number; height: number; flags: number }[];
    };
    const frames: Image32Frame[] = [];
    for (let i = 0; i < meta.image_frames; i++) {
      const { width, height, flags } = meta.image_frame_info[i];
      const planeBytes = new Uint8Array(
        readFileSync(resolve(FIXTURE, `frame_${String(i).padStart(3, '0')}/plane0.bin`)).length * 5,
      );
      for (let p = 0; p < 5; p++) {
        const plane = readFileSync(resolve(FIXTURE, `frame_${String(i).padStart(3, '0')}/plane${p}.bin`));
        planeBytes.set(plane, p * plane.length);
      }
      frames.push({ width, height, flags, indices: unpackPlanes(planeBytes, width, height) });
    }

    const encoded = encodeImage32(frames, meta.palette_words_be, meta.image_depth);
    const decoded = decodeImage32(encoded);

    expect(decoded.frameCount).toBe(meta.image_frames);
    expect(decoded.depthOrMode).toBe(meta.image_depth);
    expect(decoded.paletteWords).toEqual(meta.palette_words_be);

    // Re-encode the decoded chunk and confirm pixel-identical output.
    const reEncoded = encodeImage32(decoded.frames, decoded.paletteWords, decoded.depthOrMode);
    expect(bytesEqual(reEncoded, encoded)).toBe(true);

    // And confirm each decoded frame's pixels match the real fixture planes.
    for (let i = 0; i < frames.length; i++) {
      expect(bytesEqual(decoded.frames[i].indices, frames[i].indices)).toBe(true);
    }
  });
});
