/**
 * Dungeon Master II (Amiga) `GRAPHICS.DAT` resource layer: the item-0
 * catalogue, `D=5` text, the item-243 rectangle table, the item-1
 * underlay (overlay -> base image) table, the `IMG4` picture codec with
 * overlay support, and the 16-colour IRGB palettes.
 *
 * Original code. Formats were established from the game's own data and
 * checked against SKUL.FTL (see docs/dungeonmaster2/amiga/data-structure.md
 * § "Viewport (2026-11-21)"); a public DM2 PC reimplementation was used
 * only as a pointer to where things live, not as a source of code or tables.
 *
 * Catalogue field names used here (the header spells `TIDSFGP`):
 *   T category, I item, D data type, S entry, F language/flags, P value.
 * Data types seen: 1 image, 2 sound, 4 rectangle table, 5 text, 7/8 raw,
 * 9 IRGB palette, 11 word value, 12 image offset (packed x<<8|y, signed bytes),
 * 14 nibble remap string.
 */

export interface CatRecord { T: number; I: number; D: number; S: number; F: number; G: number; P: number }

export const DT = { IMAGE: 1, SOUND: 2, RECTS: 4, TEXT: 5, PALETTE: 9, WORD: 11, OFFSET: 12 } as const;

/** Parse GRAPHICS.DAT item 0: `u16 0x8001, u16 count, u16 7` + 7 (name,width) pairs + count x 8-byte records. */
export function parseCatalogue(item0: Uint8Array): CatRecord[] {
  const u16 = (o: number) => (item0[o]! << 8) | item0[o + 1]!;
  if (u16(0) !== 0x8001) throw new Error('GRAPHICS.DAT item 0: not a catalogue (no 0x8001)');
  const n = u16(2);
  const fields = u16(4);
  const base = 6 + fields * 2;
  if (base + n * 8 !== item0.length) throw new Error(`catalogue size mismatch: ${base + n * 8} != ${item0.length}`);
  const out: CatRecord[] = [];
  for (let i = 0; i < n; i++) {
    const o = base + i * 8;
    out.push({ T: item0[o]!, I: item0[o + 1]!, D: item0[o + 2]!, S: item0[o + 3]!, F: item0[o + 4]!, G: item0[o + 5]!, P: u16(o + 6) });
  }
  return out;
}

/** Index records by `T:I:D:S` (first record wins; language variants differ only in F). */
export function catalogueIndex(recs: CatRecord[]): Map<string, CatRecord> {
  const m = new Map<string, CatRecord>();
  for (const r of recs) {
    const k = `${r.T}:${r.I}:${r.D}:${r.S}`;
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

/**
 * Decode a `D=5` text item. Byte i stores `(0xFF - ch - i) & 0xFF`; a zero
 * character terminates (so the last byte is `0xFF - (len-1)`, which is the
 * `0xf0|(15-n)` pattern noted earlier). Returns the string up to the NUL.
 */
export function decodeText(item: Uint8Array): string {
  let s = '';
  for (let i = 0; i < item.length; i++) {
    const c = (0xff - item[i]! - i) & 0xff;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// --- Rectangle table (category 1, item 0, D=4, S=0 -> GRAPHICS.DAT item 243) ---

/** One rectangle record: `kind` 0-8 anchor-in-parent, 9 size box, 10-18 anchor-to-parent-box; `parent` rect id. */
export interface RectRec { kind: number; parent: number; a: number; b: number }

/**
 * Parse the rectangle table: `u16 0xfc0d, u16 nRanges`, nRanges x (u16 first,
 * u16 last) id ranges, then one 8-byte record `{u16 kind, u16 parent, i16 a, i16 b}`
 * per id in range order (tiles item 243 exactly: 2,183 records).
 */
export function parseRects(item: Uint8Array): Map<number, RectRec> {
  const u16 = (o: number) => (item[o]! << 8) | item[o + 1]!;
  const s16 = (o: number) => { const v = u16(o); return v >= 0x8000 ? v - 0x10000 : v; };
  const n = u16(2);
  let o = 4 + n * 4;
  const out = new Map<number, RectRec>();
  for (let i = 0; i < n; i++) {
    const first = u16(4 + i * 4);
    const last = u16(6 + i * 4);
    for (let r = first; r <= last; r++, o += 8) out.set(r, { kind: u16(o), parent: u16(o + 2), a: s16(o + 4), b: s16(o + 6) });
  }
  if (o !== item.length) throw new Error(`rect table does not tile its item (${o} != ${item.length})`);
  return out;
}

/**
 * Where inside a w x h box the 9 anchor codes sit. Code 0 centre, 1 top-left,
 * 2 top-right, 3 bottom-right, 4 bottom-left, 5 top-centre, 6 right-centre,
 * 7 bottom-centre, 8 left-centre. Centre rounds as `(n+1)>>1`; far edges are `n-1`.
 */
export function anchorIn(code: number, w: number, h: number): [number, number] {
  const cx = (w + 1) >> 1, cy = (h + 1) >> 1, rx = w - 1, by = h - 1;
  switch (code) {
    case 0: return [cx, cy];
    case 1: return [0, 0];
    case 2: return [rx, 0];
    case 3: return [rx, by];
    case 4: return [0, by];
    case 5: return [cx, 0];
    case 6: return [rx, cy];
    case 7: return [cx, by];
    case 8: return [0, cy];
    default: throw new Error(`bad anchor code ${code}`);
  }
}

/** A rect resolved to a screen point plus the image anchor that goes on it. */
export interface ResolvedRect { x: number; y: number; align: number }

/** A frame: a positioned box (top-left origin + size) in outermost coordinates. */
interface Frame { ox: number; oy: number; w: number; h: number }

function frameOf(rects: Map<number, RectRec>, id: number, depth = 0): Frame {
  if (depth > 16) throw new Error('rect chain too deep');
  if (id === 0) return { ox: 0, oy: 0, w: 0, h: 0 };
  const p = rects.get(id);
  if (!p) throw new Error(`rect ${id} missing`);
  if (p.kind === 9) {
    // size box: sits at its parent frame's origin
    const f = frameOf(rects, p.parent, depth + 1);
    return { ox: f.ox, oy: f.oy, w: p.a, h: p.b };
  }
  if (p.kind <= 8) {
    const parent = rects.get(p.parent);
    if (parent && parent.kind === 9) {
      // the parent box placed with its `kind` anchor at (a,b) of the box's own parent frame
      const f = frameOf(rects, parent.parent, depth + 1);
      const [ax, ay] = anchorIn(p.kind, parent.a, parent.b);
      return { ox: f.ox + p.a - ax, oy: f.oy + p.b - ay, w: parent.a, h: parent.b };
    }
    if (p.kind === 1) {
      const f = frameOf(rects, p.parent, depth + 1);
      return { ox: f.ox + p.a, oy: f.oy + p.b, w: f.w, h: f.h };
    }
  }
  throw new Error(`rect ${id} (kind ${p.kind}) cannot act as a frame`);
}

/**
 * Resolve a rect id to the point an image is anchored at, in the coordinate
 * space of the outermost box (the walk the SKUL.FTL blit-rect routine does):
 *   kind 0-8  : point = parent frame origin + (a,b); the image's `kind` anchor goes on it.
 *   kind 10-18: point = the `(kind-10)` anchor of the parent frame + (a,b); image anchor = kind-10.
 * Frames: a kind-9 record is a size box at its parent's origin; a kind 0-8
 * record whose parent is a size box places that box (its `kind` anchor at
 * (a,b)); a kind-1 record under a frame offsets it by (a,b).
 */
export function resolveRect(rects: Map<number, RectRec>, id: number): ResolvedRect {
  const r = rects.get(id);
  if (!r) throw new Error(`rect ${id} missing`);
  if (r.kind <= 8) {
    const f = frameOf(rects, r.parent);
    return { x: f.ox + r.a, y: f.oy + r.b, align: r.kind };
  }
  if (r.kind >= 10 && r.kind <= 18) {
    const f = frameOf(rects, r.parent);
    const [ax, ay] = anchorIn(r.kind - 10, f.w, f.h);
    return { x: f.ox + ax + r.a, y: f.oy + ay + r.b, align: r.kind - 10 };
  }
  throw new Error(`rect ${id} kind ${r.kind} is a size box`);
}

/** Top-left of a w x h image whose `align` anchor sits on (x,y). */
export function placeImage(rr: ResolvedRect, w: number, h: number, offX = 0, offY = 0): [number, number] {
  const [ax, ay] = anchorIn(rr.align, w, h);
  return [rr.x + offX - ax, rr.y + offY - ay];
}

// --- Underlay table (category 0, D=8 -> GRAPHICS.DAT item 1) ---

/** Item 1: sorted (overlay item, underlay item) u16 pairs. Overlay images composite over their underlay. */
export function parseUnderlays(item: Uint8Array): Map<number, number> {
  const m = new Map<number, number>();
  for (let o = 0; o + 4 <= item.length; o += 4) m.set((item[o]! << 8) | item[o + 1]!, (item[o + 2]! << 8) | item[o + 3]!);
  return m;
}

// --- IMG4 picture codec ---

export interface Picture {
  width: number;
  height: number;
  /** Signed 6-bit draw offsets from the top of the w/h words (-32 = "none"). */
  offX: number;
  offY: number;
  /** w*h colour nibbles, row-major; -1 = never written. */
  pixels: Int16Array;
}

function sign6(v: number): number { return v >= 32 ? v - 64 : v; }

/**
 * Decode an `IMG4` item. Header: `u16 w, u16 h` (low 10 bits size, top 6 bits
 * a signed offset). Then a local palette of 6 nibbles (base image) or 5 nibbles
 * (overlay image: the item appears in the underlay table), then a run stream of
 * control nibbles: bit 3 = run (length follows: n+2 | 0xF,nn+17 | 0xF,0xFF,nnnn),
 * low 3 bits = colour selector (0-5 local palette slot, 6 copy the pixel one row
 * up, 7 literal colour nibble follows). In an overlay, selector 5 keeps the
 * underlay pixel. The trailing 16 bytes are not read here (a PC 16->256 colour
 * map, unused by the Amiga renderer: the nibbles index the IRGB palette directly).
 */
export function decodePicture(item: Uint8Array, underlay?: Picture): Picture {
  const w0 = (item[0]! << 8) | item[1]!;
  const h0 = (item[2]! << 8) | item[3]!;
  const width = w0 & 0x3ff, height = h0 & 0x3ff;
  const pic: Picture = { width, height, offX: sign6(w0 >> 10), offY: sign6(h0 >> 10), pixels: new Int16Array(width * height).fill(-1) };
  if (underlay) {
    if (underlay.width !== width || underlay.height !== height) throw new Error('underlay size mismatch');
    pic.pixels.set(underlay.pixels);
  }
  let nib = 8; // nibble cursor from item start (after the 4-byte header)
  const rd = () => { const b = item[nib >> 1] ?? 0; const v = nib & 1 ? b & 15 : b >> 4; nib++; return v; };
  const palLen = underlay ? 5 : 6;
  const pal: number[] = [];
  for (let i = 0; i < palLen; i++) pal.push(rd());
  const runLen = () => {
    const a = rd();
    if (a !== 15) return a + 2;
    const v = (rd() << 4) | rd();
    if (v !== 0xff) return v + 17;
    return (rd() << 12) | (rd() << 8) | (rd() << 4) | rd();
  };
  const px = pic.pixels;
  const total = width * height;
  let pos = 0;
  while (pos < total) {
    const ctl = rd();
    const sel = ctl & 7;
    let colour: number; // >=0 fill, -2 copy-up, -3 keep underlay
    if (sel === 6) colour = -2;
    else if (sel === 7) colour = rd();
    else if (underlay && sel === 5) colour = -3;
    else colour = pal[sel]!;
    const n = ctl & 8 ? runLen() : 1;
    for (let i = 0; i < n && pos < total; i++, pos++) {
      if (colour >= 0) px[pos] = colour;
      else if (colour === -2) px[pos] = pos >= width ? px[pos - width]! : -1;
      // -3: leave the underlay pixel in place
    }
  }
  return pic;
}

/** Item-level picture loader that follows the underlay chain (memoised). */
export class PictureBank {
  private cache = new Map<number, Picture>();
  private readonly item: (i: number) => Uint8Array;
  private readonly underlays: Map<number, number>;
  constructor(item: (i: number) => Uint8Array, underlays: Map<number, number>) {
    this.item = item;
    this.underlays = underlays;
  }
  get(i: number): Picture {
    const hit = this.cache.get(i);
    if (hit) return hit;
    const u = this.underlays.get(i);
    const pic = decodePicture(this.item(i), u === undefined ? undefined : this.get(u));
    this.cache.set(i, pic);
    return pic;
  }
}

// --- Palettes ---

/** IRGB palette item: 4-byte entries `(index, r, g, b)`; returns banks of 16 [r,g,b] (64 bytes per bank). */
export function parseIrgbBanks(item: Uint8Array): Array<Array<[number, number, number]>> {
  const banks: Array<Array<[number, number, number]>> = [];
  for (let b = 0; b + 64 <= item.length; b += 64) {
    const pal: Array<[number, number, number]> = Array.from({ length: 16 }, () => [0, 0, 0] as [number, number, number]);
    for (let e = 0; e < 16; e++) {
      const o = b + e * 4;
      pal[item[o]! & 15] = [item[o + 1]!, item[o + 2]!, item[o + 3]!];
    }
    banks.push(pal);
  }
  return banks;
}
