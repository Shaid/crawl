/**
 * MM2 (Amiga) `.anm` TV animation codec — animated combat/world sprites.
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/55-graphics-formats-reference.md`
 * §4; structural details cross-checked against `tools/decode_anm.py`, whose
 * output — including the `tools/mm2/fixtures/anm_decoded/51/meta.json` fixture
 * shipped here — anchors the field offsets used below). All multibyte values
 * are big-endian.
 *
 *   +0x00  u16be   reserved (0 in retail)
 *   +0x02  u16be   magic "TV" (0x54 0x56)
 *   +0x04..+0x2F  prelude: 11 slots × 4 bytes { x, y, width, height }
 *                 — slot i describes stored frame i+1; 0xFF-filled slots unused
 *   +0x30  u8      seq_a  (unknown, preserve)
 *   +0x31  u8      seq_b  (sequence hint + 0x80 flag — do NOT parse from this)
 *   +0x32  u8      seq_c  (unknown, preserve)
 *   +0x33..  sequence stream: (frame_index, delay) pairs, 0xFF ends each block,
 *                 until the `FF 00` image-chunk marker
 *   FF 00  marker — image chunk header begins at the `00` byte
 *   ...     standard Image Chunk (see image32.ts)
 *
 * Stored frames ≠ displayed frames (except frame 0):
 *
 *   compose(k):
 *     draw stored_frame[0] at (0,0) full size
 *     if k == 0: done
 *     slot = prelude[k - 1]
 *     clear canvas[slot.x..x+w, slot.y..y+h]
 *     blit stored_frame[k] at (slot.x, slot.y), pen 0 transparent
 *
 * Sequence `frame_index` values are `k` in that function.
 *
 * Verification: header/sequence parsing is asserted against the real
 * `51.anm` metadata fixture; image-chunk decode is exercised through the
 * `.32` round-trip. The raw `51.anm` bytes are not in this repo (no retail
 * data), so the marker-scan offset is only verified on synthetic headers —
 * see docs/mm2/TODO.md.
 */
import { decodeImage32, type Image32File, type Image32FrameInfo } from './image32.ts';

export interface PreludeSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TvHeader {
  magic: string;
  prelude: PreludeSlot[];
  seqA: number;
  seqB: number;
  seqC: number;
}

export interface AnmParsed {
  tv: TvHeader;
  /** Sequence blocks: flat (frame_index, delay) byte values, one array per block. */
  sequences: number[][];
  /** File offset of the `FF 00` image-chunk marker's `FF` byte. */
  imageChunkMarker: number;
  /** Offset where the image chunk header starts (marker's `00` byte). */
  imageChunkOffset: number;
  image: Image32File;
}

export const ANM_PRELUDE_SLOTS = 11;
export const ANM_TV_HEADER_SIZE = 0x33;

/** Parse the 0x00..0x32 TV fixed header. */
export function parseTvHeader(data: Uint8Array): TvHeader {
  if (data.length < 0x33) throw new Error(`parseTvHeader: file too small (${data.length})`);
  if (data[0x02] !== 0x54 || data[0x03] !== 0x56) {
    throw new Error(`parseTvHeader: expected "TV" magic at +0x02, got ${data[0x02].toString(16)} ${data[0x03].toString(16)}`);
  }
  const prelude: PreludeSlot[] = [];
  for (let i = 0; i < ANM_PRELUDE_SLOTS; i++) {
    const o = 4 + i * 4;
    const [x, y, w, h] = [data[o], data[o + 1], data[o + 2], data[o + 3]];
    if (x === 0xff && y === 0xff && w === 0xff && h === 0xff) continue;
    prelude.push({ x, y, width: w, height: h });
  }
  return { magic: 'TV', prelude, seqA: data[0x30], seqB: data[0x31], seqC: data[0x32] };
}

/**
 * Find the `FF 00` image-chunk marker at or after `from`, validating the
 * following header fields. Returns the marker's `FF` offset (the chunk header
 * starts one byte later), or -1.
 */
export function findImageChunkMarker(data: Uint8Array, from: number): number {
  const u16 = (o: number) => (data[o] << 8) | data[o + 1];
  for (let i = from; i + 10 < data.length; i++) {
    if (data[i] !== 0xff || data[i + 1] !== 0x00) continue;
    const hdr = i + 1;
    const frames = u16(hdr);
    const depth = u16(hdr + 2);
    const width = u16(hdr + 4);
    const height = u16(hdr + 6);
    if (frames > 0 && frames < 256 && depth < 64 && width > 0 && width <= 1024 && height > 0 && height <= 1024) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse the sequence stream between the TV header and the image-chunk marker.
 * The parser is marker-driven (the seq_b byte is only a hint and can
 * under-report — e.g. `02.anm` has seq_b=1 but 5 blocks). The stream may
 * contain leading non-0xFF noise; those bytes are skipped.
 */
export function parseSequences(data: Uint8Array, from: number, stop: number): number[][] {
  const sequences: number[][] = [];
  let cur = from;
  while (cur < stop) {
    if (data[cur] !== 0xff) {
      cur++;
      continue;
    }
    cur++;
    const seq: number[] = [];
    while (cur < stop && data[cur] !== 0xff) {
      seq.push(data[cur]);
      cur++;
    }
    if (seq.length > 0) sequences.push(seq);
  }
  return sequences;
}

/** Parse a full `.anm` file. */
export function parseAnm(data: Uint8Array): AnmParsed {
  const tv = parseTvHeader(data);
  const marker = findImageChunkMarker(data, ANM_TV_HEADER_SIZE);
  if (marker < 0) throw new Error('parseAnm: no plausible FF 00 image-chunk marker found');
  const imageChunkOffset = marker + 1;
  const sequences = parseSequences(data, ANM_TV_HEADER_SIZE, marker);
  const image = decodeImage32(data, imageChunkOffset);
  return { tv, sequences, imageChunkMarker: marker, imageChunkOffset, image };
}

/**
 * Compose displayed frame `k` onto a `canvasW × canvasH` index buffer:
 * base frame 0 full-size, then prelude slot k−1 clears its rectangle and the
 * patch is blitted on top (pen 0 transparent). Pixels outside the canvas are
 * dropped. Returns the composed indices and the slot used (null for k === 0).
 */
export function composeAnmFrame(
  anm: Pick<AnmParsed, 'image' | 'tv'>,
  k: number,
  canvasW: number,
  canvasH: number,
): { indices: Uint8Array; width: number; height: number; slot: PreludeSlot | null } {
  const base = anm.image.frames[0];
  if (!base) throw new Error(`composeAnmFrame: no frame 0 (have ${anm.image.frames.length})`);
  const indices = new Uint8Array(canvasW * canvasH).fill(0);

  const blit = (frame: Image32FrameInfo & { indices: Uint8Array }, dx: number, dy: number) => {
    for (let y = 0; y < frame.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= canvasH) continue;
      for (let x = 0; x < frame.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= canvasW) continue;
        const v = frame.indices[y * frame.width + x];
        if (v !== 0) indices[ty * canvasW + tx] = v;
      }
    }
  };

  blit(base, 0, 0);
  if (k === 0) return { indices, width: canvasW, height: canvasH, slot: null };

  const slot = anm.tv.prelude[k - 1];
  if (slot) {
    for (let y = 0; y < slot.height; y++) {
      const ty = slot.y + y;
      if (ty < 0 || ty >= canvasH) continue;
      for (let x = 0; x < slot.width; x++) {
        const tx = slot.x + x;
        if (tx >= 0 && tx < canvasW) indices[ty * canvasW + tx] = 0;
      }
    }
    const patch = anm.image.frames[k];
    if (patch) blit(patch, slot.x, slot.y);
  }

  return { indices, width: canvasW, height: canvasH, slot };
}

/** Highest frame index referenced by any sequence (plus frame 0). */
export function anmFrameCount(anm: Pick<AnmParsed, 'sequences'>): number {
  let max = 0;
  for (const seq of anm.sequences) {
    for (let i = 0; i < seq.length; i += 2) {
      if (seq[i] > max) max = seq[i];
    }
  }
  return max + 1;
}
