import { describe, expect, it } from 'vitest';
import {
  parseAnm,
  parseTvHeader,
  parseSequences,
  findImageChunkMarker,
  composeAnmFrame,
  anmFrameCount,
  ANM_TV_HEADER_SIZE,
} from '../anm.ts';
import { encodeImage32 } from '../image32.ts';

/** Deterministic indices in 0..31. */
function pat(width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s % 31) + 1; // never 0 so pixels are opaque for the blit checks
  }
  return out;
}

function buildAnm(): Uint8Array {
  const base = { width: 84, height: 86, flags: 0, indices: pat(84, 86, 1) };
  const patch = { width: 80, height: 77, flags: 0, indices: pat(80, 77, 2) };
  const chunk = encodeImage32([base, patch], Array.from({ length: 32 }, (_, i) => i * 0x111), 3);

  const head: number[] = [];
  head.push(0x00, 0x00, 0x54, 0x56); // reserved, "TV"
  for (let i = 0; i < 5; i++) head.push(0x03, 0x01, 0x50, 0x4d); // prelude slots (3,1,80,77)
  for (let i = 5; i < 11; i++) head.push(0xff, 0xff, 0xff, 0xff); // unused slots
  head.push(0x1c, 0x01, 0x05); // seq_a/b/c

  const stream: number[] = [];
  stream.push(0xff); // block-1 open
  stream.push(1, 10, 2, 10, 3, 10, 4, 10, 5, 10);
  stream.push(0xff); // block-1 close
  stream.push(4, 10, 3, 10, 2, 10, 1, 10, 0, 10);
  stream.push(0xff); // block-2 close AND image-chunk marker FF

  const out = new Uint8Array(head.length + stream.length + chunk.length);
  out.set(head, 0);
  out.set(stream, head.length);
  out.set(chunk, head.length + stream.length);
  return out;
}

describe('parseTvHeader', () => {
  it('reads magic, prelude slots (skipping 0xFF-filled), and seq header bytes', () => {
    const bytes = buildAnm();
    const tv = parseTvHeader(bytes);
    expect(tv.magic).toBe('TV');
    expect(tv.prelude).toEqual([
      { x: 3, y: 1, width: 80, height: 77 },
      { x: 3, y: 1, width: 80, height: 77 },
      { x: 3, y: 1, width: 80, height: 77 },
      { x: 3, y: 1, width: 80, height: 77 },
      { x: 3, y: 1, width: 80, height: 77 },
    ]);
    expect(tv.seqA).toBe(0x1c);
    expect(tv.seqB).toBe(0x01);
    expect(tv.seqC).toBe(0x05);
  });

  it('rejects a file without the TV magic', () => {
    const bad = buildAnm();
    bad[2] = 0x00;
    bad[3] = 0x01;
    expect(() => parseTvHeader(bad)).toThrow(/TV/);
  });
});

describe('parseSequences', () => {
  it('parses FF-delimited blocks even when seq_b under-reports', () => {
    // Matches the real 51.anm fixture's meta.json sequences exactly.
    const bytes = buildAnm();
    const marker = findImageChunkMarker(bytes, ANM_TV_HEADER_SIZE);
    expect(marker).toBeGreaterThan(0);
    const sequences = parseSequences(bytes, ANM_TV_HEADER_SIZE, marker);
    expect(sequences).toEqual([
      [1, 10, 2, 10, 3, 10, 4, 10, 5, 10],
      [4, 10, 3, 10, 2, 10, 1, 10, 0, 10],
    ]);
  });
});

describe('parseAnm', () => {
  it('parses header + sequence stream + image chunk end to end', () => {
    const anm = parseAnm(buildAnm());
    expect(anm.tv.prelude.length).toBe(5);
    expect(anm.sequences).toEqual([
      [1, 10, 2, 10, 3, 10, 4, 10, 5, 10],
      [4, 10, 3, 10, 2, 10, 1, 10, 0, 10],
    ]);
    expect(anm.image.frameCount).toBe(2);
    expect(anm.image.depthOrMode).toBe(3);
    expect(anm.image.frames[0].width).toBe(84);
    expect(anm.image.frames[0].height).toBe(86);
    expect(anm.image.frames[1].width).toBe(80);
    expect(anm.image.frames[1].height).toBe(77);
    expect(anmFrameCount(anm)).toBe(6);
  });
});

describe('composeAnmFrame', () => {
  it('frame 0 is the raw base sprite', () => {
    const anm = parseAnm(buildAnm());
    const comp = composeAnmFrame(anm, 0, 84, 86);
    expect(comp.slot).toBeNull();
    expect(comp.indices).toEqual(anm.image.frames[0].indices);
  });

  it('frame k clears the prelude rect and blits the patch on top', () => {
    const anm = parseAnm(buildAnm());
    const base = anm.image.frames[0];
    const patch = anm.image.frames[1];
    const comp = composeAnmFrame(anm, 1, 84, 86);
    expect(comp.slot).toEqual({ x: 3, y: 1, width: 80, height: 77 });

    // Inside the patch rect: patch pixel (pen 0 is transparent, but our
    // synthetic patch has no 0 pixels so it must match the patch exactly).
    const px = 4 + 10; // x inside rect
    const py = 1 + 10; // y inside rect
    expect(comp.indices[py * 84 + px]).toBe(patch.indices[(py - 1) * 80 + (px - 3)]);
    // Outside the rect (top-left corner): base unchanged.
    expect(comp.indices[0]).toBe(base.indices[0]);
    // Right of the patch rect (patch spans x 3..82, so x=83 is outside), in the row band.
    expect(comp.indices[(1 + 10) * 84 + 83]).toBe(base.indices[11 * 84 + 83]);
  });
});
