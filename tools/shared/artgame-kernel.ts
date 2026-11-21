/**
 * ArtGame (Steve Fabian "ArtKernal") container + packer, shared by
 * Abandoned Places 1 and 2. Spec: docs/abandonedplaces/amiga/data-structure.md §2–§3.
 *
 * - Directory: 32-byte big-endian records `name[16] offset stored size u16 packed u16 group`;
 *   a 2-byte `0000` separator starts each new disk section.
 * - Packer: backward byte-oriented LZ (reads from the end of the packed data, writes from
 *   the end of the output). Trailer = chk byte + 24-bit size, `size = b[n-1]<<16|b[n-2]<<8|b[n-3]`.
 *   chk is XORed with every control byte; a valid stream ends with chk == 0.
 *   Reader: AP2 kernel hunk0 +0x22BE (LAB_01C2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ArtEntry {
  /** Directory section = disk index (AP1: Disk.(section+1); AP2: ap2.00<section>). */
  section: number;
  name: string;
  /** Byte offset into the section's disk image / blob. */
  offset: number;
  stored: number;
  size: number;
  packed: boolean;
  group: number;
}

function validName(rec: Uint8Array): boolean {
  let n = 0;
  while (n < 16 && rec[n] !== 0) n++;
  if (n === 0) return false;
  for (let i = 0; i < n; i++) if (rec[i] <= 32 || rec[i] >= 127) return false;
  for (let i = n; i < 16; i++) if (rec[i] !== 0) return false;
  return true;
}

/**
 * Parse a directory starting at `start`. Stops at the first position that is neither a
 * valid record nor a `0000` separator followed by a valid record (so trailing zero
 * padding and code after the AP1 directory are not consumed).
 */
export function parseArtDirectory(buf: Uint8Array, start = 0, end = buf.length): ArtEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: ArtEntry[] = [];
  let p = start;
  let section = 0;
  while (p + 32 <= end) {
    if (validName(buf.subarray(p, p + 32))) {
      let n = 0;
      while (buf[p + n] !== 0) n++;
      out.push({
        section,
        name: String.fromCharCode(...buf.subarray(p, p + n)),
        offset: dv.getUint32(p + 16),
        stored: dv.getUint32(p + 20),
        size: dv.getUint32(p + 24),
        packed: dv.getUint16(p + 28) === 1,
        group: dv.getUint16(p + 30),
      });
      p += 32;
    } else if (
      out.length > 0 &&
      buf[p] === 0 && buf[p + 1] === 0 &&
      p + 2 + 32 <= end && validName(buf.subarray(p + 2, p + 34))
    ) {
      section++;
      p += 2;
    } else break;
  }
  return out;
}

export interface UnpackResult {
  data: Uint8Array;
  /** Running XOR of all control bytes against the trailer chk; 0 = valid. */
  checksum: number;
  /** Source bytes left unread when the output was full; 0 = fully consumed. */
  inputLeft: number;
}

/** Unpack one packed stream. Throws on structural overrun; check `checksum`/`inputLeft`. */
export function unpackArtGame(src: Uint8Array): UnpackResult {
  const n = src.length;
  if (n < 5) throw new Error('artgame: stream too short');
  const size = (src[n - 1] << 16) | (src[n - 2] << 8) | src[n - 3];
  let chk = src[n - 4];
  let a0 = n - 4;
  const out = new Uint8Array(size);
  let a1 = size;
  let d0 = 0, d1 = 0, d2 = 0;
  const at = (i: number): number => (i >= 0 ? src[i] : 0);
  for (;;) {
    const p = a0 - d0;
    const d3 = at(p - 1), d4 = at(p - 2), d5 = at(p - 3), d6 = at(p - 4);
    if (d1) {
      let s = a1 + d2 + 1;
      if (s - d1 < 0 || a1 - d1 < 0) throw new Error('artgame: match overrun');
      for (let i = 0; i < d1; i++) { s--; a1--; out[a1] = out[s]; }
    }
    if (d0) {
      if (a0 - d0 < 0 || a1 - d0 < 0) throw new Error('artgame: literal overrun');
      for (let i = 0; i < d0; i++) { a0--; a1--; out[a1] = src[a0]; }
      d0 = 0;
    }
    d1 = 0;
    if (a1 === 0) break;
    if (a0 <= 0) throw new Error('artgame: input exhausted');
    chk ^= d3;
    const c = d3 >> 3;
    if (c < 4) { a0 -= 1; d0 = (d3 & 0x1f) + 1; }
    else if (c < 8) { a0 -= 2; d0 = (((d3 & 0x1f) << 8) | d4) + 0x21; }
    else if (c < 12) { a0 -= 2; d1 = ((d3 >> 2) & 7) + 3; d2 = ((d3 & 3) << 8) | d4; }
    else if (c < 14) { a0 -= 1; d2 = d3 & 0xf; d1 = 2; }
    else if (c === 14) { a0 -= 3; d1 = (d3 & 7) + (d4 & 0x80 ? 12 : 4); d2 = ((d4 & 0x7f) << 8) | d5; }
    else if (c === 15) { a0 -= 4; d1 = (((d3 & 7) << 8) | d4) + 5; d2 = (d5 << 8) | d6; }
    else if (c < 24) { a0 -= 2; d1 = ((d3 >> 2) & 3) + 3; d0 = ((d3 >> 4) & 3) + 1; d2 = ((d3 & 3) << 8) | d4; }
    else { a0 -= 3; d0 = ((d3 >> 2) & 0xf) + 1; d1 = ((d3 & 3) | ((d4 & 0xc0) >> 4)) + 4; d2 = ((d4 & 0x3f) << 8) | d5; }
  }
  return { data: out, checksum: chk & 0xff, inputLeft: a0 };
}

/** Unpack and require checksum 0, full input consumption and the expected size. */
export function unpackArtGameStrict(src: Uint8Array, expectedSize: number): Uint8Array {
  const r = unpackArtGame(src);
  if (r.checksum !== 0) throw new Error(`artgame: checksum 0x${r.checksum.toString(16)}`);
  if (r.inputLeft !== 0) throw new Error(`artgame: ${r.inputLeft} input bytes unconsumed`);
  if (r.data.length !== expectedSize) throw new Error(`artgame: size ${r.data.length} != ${expectedSize}`);
  return r.data;
}

/** Bytes of one entry (unpacked if packed). */
export function readArtEntry(image: Uint8Array, e: ArtEntry): Uint8Array {
  const raw = image.subarray(e.offset, e.offset + e.stored);
  if (raw.length !== e.stored) throw new Error(`artgame: ${e.name} runs past its image`);
  if (!e.packed) {
    if (e.stored !== e.size) throw new Error(`artgame: stored ${e.name} size mismatch`);
    return raw;
  }
  return unpackArtGameStrict(raw, e.size);
}

export interface ArtVolume {
  game: 'abandonedplaces' | 'abandonedplaces2';
  entries: ArtEntry[];
  /** Disk image / blob bytes per section. */
  images: Uint8Array[];
}

/** Absolute directory start in Disk.1 for AP1. */
export const AP1_DIR_OFFSET = 0x5800;

export function loadArtVolume(game: ArtVolume['game'], dataDir: string): ArtVolume {
  if (game === 'abandonedplaces') {
    const disks = [1, 2, 3, 4, 5].map((k) => new Uint8Array(readFileSync(resolve(dataDir, `Disk.${k}`))));
    const entries = parseArtDirectory(disks[0], AP1_DIR_OFFSET, 0x9800);
    return { game, entries, images: disks };
  }
  const dir = new Uint8Array(readFileSync(resolve(dataDir, 'data/ap2.dir')));
  const entries = parseArtDirectory(dir);
  const images = [0, 1, 2, 3].map((k) => new Uint8Array(readFileSync(resolve(dataDir, `data/ap2.00${k}`))));
  // Section 4 (save_00/01.dat) lives on the unshipped save disk.
  return { game, entries: entries.filter((e) => e.section < 4), images };
}

export function artVolumeAvailable(game: ArtVolume['game'], dataDir: string): boolean {
  return game === 'abandonedplaces'
    ? existsSync(resolve(dataDir, 'Disk.1'))
    : existsSync(resolve(dataDir, 'data/ap2.dir')) && existsSync(resolve(dataDir, 'data/ap2.003'));
}

export function readVolumeEntry(v: ArtVolume, e: ArtEntry): Uint8Array {
  return readArtEntry(v.images[e.section], e);
}
