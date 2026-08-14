/**
 * MM2 (PC DOS) `.4` / `.16` graphics codec — CGA/EGA wall sheets and the
 * MONSTERS combat atlas.
 *
 * Direct TypeScript port of Vairn/MM2's reference implementation
 * (`tools/decode_pc_gfx.py` + `tools/mm2_lzw.py`), written with the author's
 * explicit permission (see docs/mm2/index.md "License / porting permission").
 * Format doc: `54-pc-dos-graphics-formats.md`; LZW traced to MM2.EXE @0x2A42.
 *
 * Two containers:
 *
 *  Wall / sprite sheets (THROW, TOWN, CASTLE, SKY, ...)
 *    u32 LE uncompressed_size
 *    LZW bitstream @ +4  (9→12-bit codes, early-change growth, clear 0x100)
 *    decompressed: u8 frame_count (dec[0] & 0x3F), u8 flags @ +1,
 *      offset table @ +2 (packed-u32 (end<<16)|start, plain u32, or u16 —
 *      auto-scored; grouped-u16 sheets interleave [start,end] pairs),
 *      per frame: u16 LE w, u16 LE h, then packed pixels
 *        CGA (.4): (w+3)/4 bytes/row, 2bpp MSB-first, 4 px/byte, palette 1
 *        EGA (.16): (w+1)/2 bytes/row, 4bpp linear, hi nibble = left pixel
 *
 *  Monster combat atlas (MONSTERS.4 / MONSTERS.16)
 *    u32 LE[75] blob file offsets (u32[0] = 300 = table size; picture id N
 *      → entry N-1; 0 = empty slot)
 *    per blob: u32 LE decompressed_size, LZW stream
 *    decompressed: u8 frame_count (dec[0]&0x3F), u8 flags,
 *      u16 LE[frame_count] inner frame offsets, script sequences
 *      ((frame,delay) pairs, 0xFF terminator, 0xFF 0xFF ends all),
 *      per frame: u8 x, u8 y, u8 w, u8 h, then nibble-RLE stream
 *        token: high nibble = run count (run len = count+1), low nibble = code
 *        CGA: code 0-3 = colour, 4-15 = transparent
 *        EGA: code 5 = transparent, else colour = xlat[code]
 *        xlat = [0,1,2,9,6,8,10,3,4,5,7,11,12,13,14,15]
 *      frame 0 = full base sprite on the 96×96 combat canvas; later frames =
 *      delta patches (clear (x,y,w,h) then blit).
 */
import type { RGB } from '../shared/amiga-planar.ts';

export type Bpp = 2 | 4;

// IBM CGA palette 1 (black/cyan/magenta/white high-intensity) — MM2's CGA.DRV
// drv_init issues INT 10h AH=0Bh BX=0x0101. EGA = standard 16-colour RGB.
export const CGA_PALETTE_0: RGB[] = [
  { r: 0, g: 0, b: 0 }, { r: 0, g: 170, b: 0 }, { r: 170, g: 0, b: 0 }, { r: 170, g: 85, b: 0 },
];
export const CGA_PALETTE_1: RGB[] = [
  { r: 0, g: 0, b: 0 }, { r: 85, g: 255, b: 255 }, { r: 255, g: 85, b: 255 }, { r: 255, g: 255, b: 255 },
];
export const EGA_RGB: RGB[] = [
  { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 170 }, { r: 0, g: 170, b: 0 }, { r: 0, g: 170, b: 170 },
  { r: 170, g: 0, b: 0 }, { r: 170, g: 0, b: 170 }, { r: 170, g: 85, b: 0 }, { r: 170, g: 170, b: 170 },
  { r: 85, g: 85, b: 85 }, { r: 85, g: 85, b: 255 }, { r: 85, g: 255, b: 85 }, { r: 85, g: 255, b: 255 },
  { r: 255, g: 85, b: 85 }, { r: 255, g: 85, b: 255 }, { r: 255, g: 255, b: 85 }, { r: 255, g: 255, b: 255 },
];

const EGA_MONSTER_XLAT = [0, 1, 2, 9, 6, 8, 10, 3, 4, 5, 7, 11, 12, 13, 14, 15];

export const COMBAT_CANVAS_W = 96;
export const COMBAT_CANVAS_H = 96;

export function bppForExt(name: string): Bpp {
  return name.toLowerCase().endsWith('.4') ? 2 : 4;
}

export function rowBytes(width: number, bpp: Bpp): number {
  return bpp === 2 ? (width + 3) >> 2 : (width + 1) >> 1;
}

// ---------------------------------------------------------------------------
// LZW (MM2.EXE @0x2A42) — 9→12-bit codes, early-change growth, clear 0x100,
// stop 0x101, root char = expand(code)[0].
// ---------------------------------------------------------------------------

const LZW_MASK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1FF, 0x3FF, 0x7FF, 0xFFF];

export function lzwDecompress(source: Uint8Array, destSize: number): Uint8Array {
  const dictRoot = new Uint16Array(4096);
  const dictCode = new Uint16Array(4096);
  const out = new Uint8Array(destSize);
  let outLen = 0;
  let bitsRead = 0;

  const readCode = (width: number): number | undefined => {
    const base = bitsRead >> 3;
    if (base >= source.length) return undefined;
    const b0 = source[base];
    const b1 = base + 1 < source.length ? source[base + 1] : 0;
    const b2 = base + 2 < source.length ? source[base + 2] : 0;
    let word = b0 | (b1 << 8) | (b2 << 16);
    word >>= bitsRead & 7;
    bitsRead += width;
    return word & LZW_MASK[width];
  };

  const expand = (code: number): number[] => {
    const stack: number[] = [];
    while (code > 0xFF) {
      stack.push(dictRoot[code]);
      code = dictCode[code];
    }
    stack.push(code);
    stack.reverse();
    return stack;
  };

  let codeWidth = 9;
  let dictLimit = 0x200;
  let dictNext = 0x102;
  let prev: number | undefined;

  while (outLen < destSize) {
    let code = readCode(codeWidth);
    if (code === undefined) break;
    if (code === 0x100) {
      codeWidth = 9;
      dictLimit = 0x200;
      dictNext = 0x102;
      code = readCode(codeWidth);
      if (code === undefined) break;
      out[outLen++] = code & 0xFF;
      prev = code;
      continue;
    }
    if (code === 0x101) break;
    if (prev === undefined) break;
    let chars: number[];
    if (code < dictNext) {
      chars = expand(code);
    } else {
      chars = expand(prev);
      chars.push(chars[0]);
    }
    const first = chars[0];
    for (const c of chars) out[outLen++] = c;
    if (dictNext < 4096) {
      dictRoot[dictNext] = first;
      dictCode[dictNext] = prev;
      dictNext += 1;
      if (dictNext >= dictLimit && codeWidth < 12) {
        codeWidth += 1;
        dictLimit <<= 1;
      }
    }
    prev = code;
  }
  return out.slice(0, outLen);
}

// ---------------------------------------------------------------------------
// Wall / sprite sheets
// ---------------------------------------------------------------------------

export interface WallFrame {
  index: number;
  offset: number;
  width: number;
  height: number;
  headerSize: number;
  pixels: Uint8Array;
  tableSlot: number;
}

export interface WallSheet {
  kind: 'wall';
  name: string;
  ext: string;
  bpp: Bpp;
  uncompressedSize: number;
  frameCount: number;
  tableSlotCount: number;
  groupedU16: boolean;
  offsetKind: string;
  frames: WallFrame[];
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function validFrameDims(width: number, height: number, bpp: Bpp): boolean {
  if (width < 4 || height < 1) return false;
  return bpp === 2 ? width <= 320 && height <= 200 : width <= 640 && height <= 200;
}

function frameEnd(offsets: number[], index: number, decLen: number): number {
  const start = offsets[index];
  for (let i = index + 1; i < offsets.length; i++) {
    if (offsets[i] > start) return offsets[i];
  }
  return decLen;
}

function frameHeaderSize(off: number, width: number, height: number, bpp: Bpp, end: number): number {
  const pixLen = rowBytes(width, bpp) * height;
  return off + 4 + pixLen <= end ? 4 : 0;
}

function extractWallFramesFromTable(dec: Uint8Array, offsets: number[], bpp: Bpp, step: number): WallFrame[] {
  const frames: WallFrame[] = [];
  let logical = 0;
  for (let i = 0; i < offsets.length; i += step) {
    const off = offsets[i];
    if (off < 2 || off >= dec.length) continue;
    const end = i + 1 < offsets.length && offsets[i + 1] > off ? offsets[i + 1] : dec.length;
    if (off + 4 > end) continue;
    const width = u16(dec, off);
    const height = u16(dec, off + 2);
    if (!validFrameDims(width, height, bpp)) continue;
    const hdr = frameHeaderSize(off, width, height, bpp, end);
    if (hdr === 0) continue;
    const rb = rowBytes(width, bpp);
    const pixOff = off + hdr;
    const pixLen = rb * height;
    frames.push({
      index: logical, offset: off, width, height, headerSize: hdr,
      pixels: dec.slice(pixOff, pixOff + pixLen), tableSlot: i,
    });
    logical += 1;
  }
  return frames;
}

function isGroupedU16Table(dec: Uint8Array, offsets: number[], bpp: Bpp): boolean {
  if (offsets.length < 4) return false;
  let pairs = 0;
  let matches = 0;
  for (let i = 0; i < offsets.length - 1; i += 2) {
    const start = offsets[i];
    if (start < 2 || start + 4 > dec.length) continue;
    const width = u16(dec, start);
    const height = u16(dec, start + 2);
    if (!validFrameDims(width, height, bpp)) continue;
    const endLimit = frameEnd(offsets, i, dec.length);
    const expected = computedFrameEnd(dec, start, bpp, endLimit);
    if (expected <= start) continue;
    pairs += 1;
    if (offsets[i + 1] === expected) matches += 1;
  }
  return pairs >= 2 && matches >= Math.max(2, Math.floor((pairs * 2) / 3));
}

function computedFrameEnd(dec: Uint8Array, off: number, bpp: Bpp, endLimit: number): number {
  if (off + 4 > endLimit || off + 4 > dec.length) return 0;
  const width = u16(dec, off);
  const height = u16(dec, off + 2);
  if (!validFrameDims(width, height, bpp)) return 0;
  const rb = rowBytes(width, bpp);
  const pixEnd = off + 4 + rb * height;
  return pixEnd <= endLimit && pixEnd <= dec.length ? pixEnd : 0;
}

function extractPackedU32Frames(dec: Uint8Array, frameCount: number, bpp: Bpp): WallFrame[] {
  const frames: WallFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const pos = 2 + i * 4;
    if (pos + 4 > dec.length) break;
    const v = u32(dec, pos);
    const start = v & 0xFFFF;
    let end = v >>> 16;
    if (start < 2 || start >= dec.length) continue;
    if (end <= start) end = dec.length;
    if (start + 4 > end) continue;
    const width = u16(dec, start);
    const height = u16(dec, start + 2);
    if (!validFrameDims(width, height, bpp)) continue;
    const hdr = frameHeaderSize(start, width, height, bpp, end);
    if (hdr === 0) continue;
    const rb = rowBytes(width, bpp);
    const pixOff = start + hdr;
    frames.push({
      index: frames.length, offset: start, width, height, headerSize: hdr,
      pixels: dec.slice(pixOff, pixOff + rb * height), tableSlot: i,
    });
  }
  return frames;
}

function packedU32EndMatches(dec: Uint8Array, frameCount: number, bpp: Bpp): [number, number] {
  let matches = 0;
  let valid = 0;
  for (let i = 0; i < frameCount; i++) {
    const pos = 2 + i * 4;
    if (pos + 4 > dec.length) break;
    const v = u32(dec, pos);
    const start = v & 0xFFFF;
    const end = v >>> 16;
    if (start < 2 || start + 4 > dec.length) continue;
    const width = u16(dec, start);
    const height = u16(dec, start + 2);
    if (!validFrameDims(width, height, bpp)) continue;
    const expected = start + 4 + rowBytes(width, bpp) * height;
    if (expected > dec.length) continue;
    valid += 1;
    if (end === expected || (end === 0 && expected <= dec.length)) matches += 1;
  }
  return [matches, valid];
}

function pickOffsetTable(dec: Uint8Array, frameCount: number, bpp: Bpp): { kind: string; offsets: number[] } {
  if (frameCount === 0) return { kind: 'u16', offsets: [] };
  const u16Table: number[] = [];
  if (2 + frameCount * 2 <= dec.length) {
    for (let i = 0; i < frameCount; i++) u16Table.push(u16(dec, 2 + i * 2));
  }
  const u32Table: number[] = [];
  if (2 + frameCount * 4 <= dec.length) {
    for (let i = 0; i < frameCount; i++) u32Table.push(u32(dec, 2 + i * 4));
  }
  const packedFrames = extractPackedU32Frames(dec, frameCount, bpp);
  const plainFrames = u32Table.length ? extractWallFramesFromTable(dec, u32Table, bpp, 1) : [];
  const u16Frames = u16Table.length ? extractWallFramesFromTable(dec, u16Table, bpp, 1) : [];

  type Scored = [number, number, string, number[]];
  const scored: Scored[] = [];
  if (u32Table.length) {
    scored.push([plainFrames.length, plainFrames.length === frameCount ? 1 : 0, 'u32', u32Table]);
  }
  if (packedFrames.length) {
    const [endM, endV] = packedU32EndMatches(dec, frameCount, bpp);
    const endBonus = endV > 0 && endM >= Math.max(2, Math.floor((endV * 2) / 3)) ? 1 : 0;
    scored.push([packedFrames.length, endBonus, 'packed_u32', u32Table]);
  }
  if (u16Table.length) {
    scored.push([u16Frames.length, 0, 'u16', u16Table]);
  }
  if (!scored.length) return { kind: 'u16', offsets: u16Table };
  scored.sort((a, b) => b[0] - a[0] || b[1] - a[1] || (a[2] === 'u32' ? 0 : 1) - (b[2] === 'u32' ? 0 : 1));
  return { kind: scored[0][2], offsets: scored[0][3] };
}

export function parseWallSheet(name: string, raw: Uint8Array): WallSheet {
  if (raw.length < 8) throw new Error(`${name}: too small for wall sheet header`);
  const decSize = u32(raw, 0);
  if (decSize < 4) throw new Error(`${name}: invalid uncompressed_size ${decSize}`);
  const bpp = bppForExt(name);
  const dec = lzwDecompress(raw.subarray(4), decSize);
  if (dec.length < decSize) throw new Error(`${name}: LZW got ${dec.length} bytes, expected ${decSize}`);
  const tableSlotCount = dec[0] & 0x3F;
  if (tableSlotCount === 0) throw new Error(`${name}: invalid frame_count 0`);
  const { kind, offsets } = pickOffsetTable(dec, tableSlotCount, bpp);
  const groupedU16 = kind === 'u16' && isGroupedU16Table(dec, offsets, bpp);
  let frames: WallFrame[];
  if (kind === 'packed_u32') {
    frames = extractPackedU32Frames(dec, tableSlotCount, bpp);
  } else {
    frames = extractWallFramesFromTable(dec, offsets, bpp, groupedU16 ? 2 : 1);
  }
  if (!frames.length) throw new Error(`${name}: no decodable frames (${kind} table)`);
  return {
    kind: 'wall', name, ext: name.slice(name.lastIndexOf('.')), bpp,
    uncompressedSize: decSize, frameCount: frames.length, tableSlotCount,
    groupedU16, offsetKind: kind, frames,
  };
}

export function decodeWallFrameIndices(width: number, height: number, pixels: Uint8Array, bpp: Bpp): number[] {
  const rb = rowBytes(width, bpp);
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * rb, (y + 1) * rb);
    let x = 0;
    if (bpp === 2) {
      for (const b of row) {
        for (const shift of [6, 4, 2, 0]) {
          if (x >= width) break;
          out.push((b >> shift) & 3);
          x += 1;
        }
      }
    } else {
      for (const b of row) {
        for (const v of [(b >> 4) & 0xF, b & 0xF]) {
          if (x >= width) break;
          out.push(v);
          x += 1;
        }
      }
    }
  }
  return out;
}

export function wallTransparentIndices(bpp: Bpp, frame?: number, outdoor = false): number[] {
  if (frame !== undefined) {
    const base = frame & 0x0F;
    if (base >= 4 && base <= 11) return bpp === 2 ? [1] : [8];
    if (outdoor) return [0];
  }
  return [];
}

export interface WallFrameRGBA {
  width: number;
  height: number;
  /** RGBA, row-major; transparent pixels = alpha 0. */
  rgba: Uint8Array;
}

function paletteForBpp(bpp: Bpp, cgaPalette: 0 | 1 = 1): RGB[] {
  return bpp === 2 ? (cgaPalette === 0 ? CGA_PALETTE_0 : CGA_PALETTE_1) : EGA_RGB;
}

export function renderWallFrameRGBA(
  width: number,
  height: number,
  pixels: Uint8Array,
  bpp: Bpp,
  opts: { frame?: number; outdoor?: boolean; cgaPalette?: 0 | 1 } = {},
): WallFrameRGBA {
  const pal = paletteForBpp(bpp, opts.cgaPalette);
  const idxs = decodeWallFrameIndices(width, height, pixels, bpp);
  const transparent = wallTransparentIndices(bpp, opts.frame, opts.outdoor);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < idxs.length; i++) {
    const idx = idxs[i];
    const key = transparent.includes(idx);
    const c = pal[idx];
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = key ? 0 : 255;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// Monster combat atlas (MONSTERS.4 / MONSTERS.16)
// ---------------------------------------------------------------------------

export interface MonsterFrame {
  pictureId: number;
  frameIndex: number;
  blobOffset: number;
  frameOffset: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stream: Uint8Array;
  ext: string;
  bpp: Bpp;
}

export interface MonsterPicture {
  pictureId: number;
  blobOffset: number;
  frameCount: number;
  flags: number;
  frames: MonsterFrame[];
  /** Animation script sequences: per sequence, (frameIndex, delay) pairs. */
  scripts: number[][];
}

export interface MonsterAtlas {
  name: string;
  ext: string;
  bpp: Bpp;
  /** u32 LE blob-offset table; entry[k] = blob for picture id k+1. */
  offsets: number[];
  /** pictureId → decoded picture, for every non-empty slot that parses. */
  pictures: Map<number, MonsterPicture>;
}

function monsterTableEnd(raw: Uint8Array): number {
  return u32(raw, 0);
}

function decompressMonsterBlob(raw: Uint8Array, off: number): Uint8Array | undefined {
  if (off + 8 > raw.length) return undefined;
  const decSize = u32(raw, off);
  if (decSize < 4 || decSize > 512 * 1024) return undefined;
  try {
    const dec = lzwDecompress(raw.subarray(off + 4), decSize);
    return dec.length >= decSize ? dec : undefined;
  } catch {
    return undefined;
  }
}

export function parseMonsterScripts(dec: Uint8Array, frameCount: number): number[][] {
  const tableEnd = 2 + frameCount * 2;
  const inner: number[] = [];
  for (let i = 0; i < frameCount; i++) inner.push(u16(dec, 2 + i * 2));
  const positives = inner.filter((o) => o > 0);
  const first = positives.length ? Math.min(...positives) : tableEnd;
  const data = dec.subarray(tableEnd, first);
  const scripts: number[][] = [];
  let current: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    if (b === 0xFF) {
      if (i + 1 < data.length && data[i + 1] === 0xFF) {
        if (current.length) scripts.push(current);
        break;
      }
      if (current.length) scripts.push(current);
      current = [];
      i += 1;
      continue;
    }
    if (i + 1 < data.length) {
      current.push(data[i], data[i + 1]);
      i += 2;
    } else {
      i += 1;
    }
  }
  if (current.length) scripts.push(current);
  return scripts;
}

export function parseMonsterPicture(
  raw: Uint8Array, fileOff: number, pictureId: number, ext: string,
): MonsterPicture | undefined {
  const dec = decompressMonsterBlob(raw, fileOff);
  if (!dec) return undefined;
  const frameCount = dec[0] & 0x3F;
  if (frameCount === 0 || 2 + frameCount * 2 > dec.length) return undefined;
  const inner: number[] = [];
  for (let i = 0; i < frameCount; i++) inner.push(u16(dec, 2 + i * 2));
  const ordered = inner.filter((o) => o > 0 && o <= dec.length).sort((a, b) => a - b);
  const bpp = bppForExt(ext);
  const frames: MonsterFrame[] = [];
  for (let fi = 0; fi < inner.length; fi++) {
    const innerOff = inner[fi];
    if (innerOff <= 0 || innerOff >= dec.length) continue;
    const nxt = ordered.filter((o) => o > innerOff);
    const frameEnd = nxt.length ? Math.min(...nxt) : dec.length;
    if (innerOff + 4 > dec.length || frameEnd <= innerOff + 4) continue;
    const x = dec[innerOff];
    const y = dec[innerOff + 1];
    const width = dec[innerOff + 2];
    const height = dec[innerOff + 3];
    if (width < 1 || height < 1 || width > 128 || height > 128) continue;
    frames.push({
      pictureId, frameIndex: fi, blobOffset: fileOff, frameOffset: innerOff,
      x, y, width, height, stream: dec.slice(innerOff + 4, frameEnd), ext, bpp,
    });
  }
  const scripts = parseMonsterScripts(dec, frameCount);
  return { pictureId, blobOffset: fileOff, frameCount, flags: dec[1], frames, scripts };
}

/** Nibble-RLE masked sprite decode → w×h grid of colour indices, null = transparent. */
export function decodeMonsterSprite(width: number, height: number, stream: Uint8Array, bpp: Bpp): (number | null)[][] {
  const grid: (number | null)[][] = Array.from({ length: height }, () => new Array<number | null>(width).fill(null));
  let row = -1;
  let remaining = 0;
  let col = 0;
  let done = false;
  let i = 0;
  while (i < stream.length && !done) {
    const b = stream[i++];
    const count = (b >> 4) & 0xF;
    const low = b & 0xF;
    let transparent: boolean;
    let color: number;
    if (bpp === 2) {
      transparent = low >= 4;
      color = low & 3;
    } else {
      transparent = low === 5;
      color = EGA_MONSTER_XLAT[low];
    }
    for (let k = 0; k < count + 1; k++) {
      if (remaining === 0) {
        row += 1;
        if (row >= height) {
          done = true;
          break;
        }
        col = 0;
        remaining = width;
      }
      if (!transparent && col < width) grid[row][col] = color;
      col += 1;
      remaining -= 1;
    }
  }
  return grid;
}

export function clearMonsterRect(canvas: (number | null)[][], x: number, y: number, w: number, h: number): void {
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const yy = y + r;
      const xx = x + c;
      if (yy >= 0 && yy < canvas.length && xx >= 0 && xx < canvas[0].length) canvas[yy][xx] = null;
    }
  }
}

export function blitMonsterGrid(
  canvas: (number | null)[][], grid: (number | null)[][], ox: number, oy: number,
): void {
  const ch = canvas.length;
  const cw = canvas[0].length;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c];
      if (v === null) continue;
      const y = oy + r;
      const x = ox + c;
      if (y >= 0 && y < ch && x >= 0 && x < cw) canvas[y][x] = v;
    }
  }
}

export function canvasToRGBA(canvas: (number | null)[][], bpp: Bpp, cgaPalette: 0 | 1 = 1): Uint8Array {
  const pal = paletteForBpp(bpp, cgaPalette);
  const h = canvas.length;
  const w = canvas[0].length;
  const out = new Uint8Array(w * h * 4);
  let o = 0;
  for (const row of canvas) {
    for (const v of row) {
      if (v === null) {
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
      } else {
        const c = pal[v];
        out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = 255;
      }
      o += 4;
    }
  }
  return out;
}

/** Composite base frame 0 plus optional delta overlay onto the 96×96 canvas. */
export function compositeCombatFrame(
  frames: MonsterFrame[], frameIdx: number, cgaPalette: 0 | 1 = 1,
): Uint8Array {
  const canvas: (number | null)[][] = Array.from({ length: COMBAT_CANVAS_H }, () => new Array<number | null>(COMBAT_CANVAS_W).fill(null));
  const byIdx = new Map<number, MonsterFrame>();
  for (const f of frames) byIdx.set(f.frameIndex, f);
  const layerIdx = frameIdx === 0 || !byIdx.has(frameIdx) ? [0] : [0, frameIdx];
  const bpp = frames.length ? frames[0].bpp : 2;
  for (const idx of layerIdx) {
    const fr = byIdx.get(idx);
    if (!fr) continue;
    if (idx !== 0) clearMonsterRect(canvas, fr.x, fr.y, fr.width, fr.height);
    const grid = decodeMonsterSprite(fr.width, fr.height, fr.stream, fr.bpp);
    blitMonsterGrid(canvas, grid, fr.x, fr.y);
  }
  return canvasToRGBA(canvas, bpp, cgaPalette);
}

export function parseMonstersAtlas(name: string, raw: Uint8Array): MonsterAtlas {
  if (raw.length < 4) throw new Error(`${name}: too small`);
  const ext = name.slice(name.lastIndexOf('.'));
  const bpp = bppForExt(name);
  const tableEnd = monsterTableEnd(raw);
  const entryCount = tableEnd >> 2;
  const offsets: number[] = [];
  const pictures = new Map<number, MonsterPicture>();
  for (let entry = 0; entry < entryCount; entry++) {
    const off = u32(raw, entry * 4);
    offsets.push(off);
    if (off < tableEnd || off + 8 > raw.length) continue;
    const pictureId = entry + 1;
    const pic = parseMonsterPicture(raw, off, pictureId, ext);
    if (pic && !pictures.has(pictureId)) pictures.set(pictureId, pic);
  }
  return { name, ext, bpp, offsets, pictures };
}
