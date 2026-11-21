/**
 * Abandoned Places 2 `.bpl` / `.def` / `.ofs` image triplets.
 * Spec: docs/abandonedplaces2/amiga/data-structure.md §5.
 *
 * `.def` = N × 28-byte records (14 big-endian words); `.ofs` = N × u32 offsets into `.bpl`
 * (absent for `fl_01+`/`fl_50`/`chrset*`/`icons`: offsets are then implicit, records packed
 * back to back). Each image is stored **sequential planar** (plane after plane, each
 * `bytesPerRow × h`), colour planes first, then — when flag bit 0 is set — one 1-bit
 * **mask plane last** (confirmed: with mask-last, 0 non-zero colour pixels fall outside the
 * mask across wl/mon/obj/gt/strd_00; mask-first leaks 25–85 %).
 */
import { type RGB } from './amiga-planar.ts';

export interface DefRecord {
  index: number;
  w: number;
  h: number;
  /** Slot-frame offset / size (words 2–5). */
  x: number;
  y: number;
  frameW: number;
  frameH: number;
  flags: number;
  /** Colour planes = (flags >> 8) + 1. */
  planes: number;
  /** flags bit 0: a mask plane follows the colour planes. */
  hasMask: boolean;
  bytesPerRow: number;
  planeSize: number;
  /** Stored colour size (word 13; 0 on unmasked UI records). */
  colourSize: number;
  /** Offset into `.bpl`. */
  offset: number;
  empty: boolean;
}

export function parseDef(def: Uint8Array, ofs: Uint8Array | null, bplSize: number): DefRecord[] {
  const n = def.length / 28;
  const dd = new DataView(def.buffer, def.byteOffset, def.byteLength);
  const od = ofs ? new DataView(ofs.buffer, ofs.byteOffset, ofs.byteLength) : null;
  const recs: DefRecord[] = [];
  let implicit = 0;
  for (let i = 0; i < n; i++) {
    const w = (k: number) => dd.getUint16(i * 28 + k * 2);
    const flags = w(6);
    const planeSize = w(11);
    const planes = (flags >> 8) + 1;
    const hasMask = (flags & 1) === 1;
    const empty = planeSize === 0 || w(0) === 0 || w(1) === 0;
    const stride = empty ? 0 : planeSize * (planes + (hasMask ? 1 : 0));
    const offset = od ? od.getUint32(i * 4) : implicit;
    implicit += stride;
    recs.push({
      index: i, w: w(0), h: w(1), x: w(2), y: w(3), frameW: w(4), frameH: w(5), flags, planes, hasMask,
      bytesPerRow: w(7), planeSize, colourSize: w(13), offset, empty,
    });
  }
  // Glyph/icon sheets (`chrset0/1`, `icons`): no `.ofs`, a single `.def` record that
  // describes one cell, repeated back to back through the whole `.bpl`.
  if (!ofs && recs.length === 1 && !recs[0].empty) {
    const r = recs[0];
    const stride = r.planeSize * (r.planes + (r.hasMask ? 1 : 0));
    const count = Math.floor(bplSize / stride);
    for (let i = 1; i < count; i++) recs.push({ ...r, index: i, offset: i * stride });
  }
  return recs;
}

export interface GeometryReport {
  records: number;
  nonEmpty: number;
  ok: number;
  failures: string[];
}

/** Structural invariants per non-empty record (see spec §5). */
export function checkGeometry(recs: DefRecord[], ofs: Uint8Array | null, bplSize: number): GeometryReport {
  const rep: GeometryReport = { records: recs.length, nonEmpty: 0, ok: 0, failures: [] };
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.empty) continue;
    rep.nonEmpty++;
    const stride = r.planeSize * (r.planes + (r.hasMask ? 1 : 0));
    const next = i + 1 < recs.length ? recs[i + 1].offset : bplSize;
    // next non-empty offset (empty records repeat/zero their offset)
    let nextOff = bplSize;
    for (let j = i + 1; j < recs.length; j++) if (!recs[j].empty) { nextOff = recs[j].offset; break; }
    void next;
    const good =
      r.planeSize === r.bytesPerRow * r.h &&
      (r.colourSize === 0 || r.colourSize === r.planes * r.planeSize) &&
      r.bytesPerRow * 8 >= r.w &&
      nextOff - r.offset === stride;
    if (good) rep.ok++;
    else rep.failures.push(`#${i}`);
  }
  void ofs;
  return rep;
}

export interface DecodedImage {
  w: number;
  h: number;
  indices: Uint8Array;
  /** 1 = opaque; absent on unmasked images. */
  mask: Uint8Array | null;
}

function plane(bpl: Uint8Array, base: number, bpr: number, h: number, w: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = (bpl[base + y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1;
  }
  return out;
}

export function decodeRecord(bpl: Uint8Array, r: DefRecord): DecodedImage {
  const indices = new Uint8Array(r.w * r.h);
  for (let p = 0; p < r.planes; p++) {
    const bits = plane(bpl, r.offset + p * r.planeSize, r.bytesPerRow, r.h, r.w);
    for (let i = 0; i < bits.length; i++) indices[i] |= bits[i] << p;
  }
  const mask = r.hasMask ? plane(bpl, r.offset + r.planes * r.planeSize, r.bytesPerRow, r.h, r.w) : null;
  return { w: r.w, h: r.h, indices, mask };
}

/** `set_NN.clr` / `display.clr`: 32 big-endian 0RGB words. */
export function readClr(clr: Uint8Array): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i + 1 < clr.length; i += 2) {
    const w = (clr[i] << 8) | clr[i + 1];
    out.push({ r: ((w >> 8) & 15) * 17, g: ((w >> 4) & 15) * 17, b: (w & 15) * 17 });
  }
  return out;
}

export function imageToRGBA(img: DecodedImage, pal: RGB[], greyscale = false): Uint8Array {
  const out = new Uint8Array(img.w * img.h * 4);
  const maxv = Math.max(1, ...img.indices);
  for (let i = 0; i < img.indices.length; i++) {
    const c = img.indices[i];
    const col = greyscale ? { r: (c * 255) / maxv, g: (c * 255) / maxv, b: (c * 255) / maxv } : (pal[c] ?? { r: 0, g: 0, b: 0 });
    out[i * 4] = col.r; out[i * 4 + 1] = col.g; out[i * 4 + 2] = col.b;
    out[i * 4 + 3] = img.mask ? (img.mask[i] ? 255 : 0) : 255;
  }
  return out;
}
