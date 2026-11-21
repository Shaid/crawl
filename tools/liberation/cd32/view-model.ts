/**
 * Liberation: Captive II (CD32) — the city first-person wall view, ported from
 * the game's own composer in `captiveII` (CODE-hunk offsets, file = 0x2C + off):
 *
 *   +0x27F8E  window fill: 5x5 cells x 3 height layers (z-1, z, z+1) around the
 *             player, rotated by facing, into a 75-byte window (566,A5)
 *   +0x2832A / +0x2835A  city cell decode: one cell grid (3 byte planes) gives a
 *             per-layer window value through four 28-byte tables (+0x285BA,
 *             +0x285D6, +0x285F2, +0x2860E, +0x2862A) plus building-height logic
 *   +0x2564E  slot walk: bank-0 slot list (+0x2B22E), 4-byte entries
 *             {window idx, occluder idx, rel. offset to a draw record}
 *   +0x27BBA  city per-type handlers (types 0..7 -> colour mode / texture)
 *   +0x259F8  CPU blitter: AmSp sprite (4 colour planes + mask) into a 6-plane
 *             192x100 view; flags = mirror, vertical-flip/clip code, run mode
 *
 * Browser-safe: no fs. Data comes from `engine.json` (tables read out of
 * captiveII by `engine-tables.ts`) and per-wall-set sprite banks.
 */

export const VIEW_W = 192;
export const VIEW_H = 100;
export const ROW_BYTES = 24;
export const PLANE_BYTES = ROW_BYTES * VIEW_H; // 2400
export const MAP = 64;

/** A draw record (4 bytes at the slot entry's relative offset), plus its row-run list for flag bit 4. */
export interface DrawRec { x: number; y: number; spr: number; fl: number; runs?: number[] }
/** One bank-0 slot entry; `obj` = vector-object handler (not drawn here). */
export interface SlotEntry { idx: number; nbr: number; obj?: boolean; rec?: DrawRec; tex?: { table: number; off: number } | null }

export interface EngineTables {
  /** window-value tables for layer D7 = -1, 0, 1, 2, >=3 (28 bytes each) */
  layer: { m1: number[]; z0: number[]; z1: number[]; z2: number[]; z3: number[] };
  /** city per-type flags word ((2012) table +0x26C16, word +2), indexed by value & 0x3f */
  flags: number[];
  /** vertical clip codes 0..7 (+0x25A62); 7 = bottom-anchored flip */
  clip: number[];
  slots: SlotEntry[];
  /** window visibility script (slot table + word 0, interpreted by +0x28646) */
  vis: number[];
  /** two 6-plane texture tables (+0x2E220, +0x2D5D0), 3072 bytes each (plane stride 512) */
  textures: Uint8Array[];
}

/** One AmSp sprite after the game's own header rewrite (+0x25208). */
export interface Sprite { wb: number; h: number; planes: Uint8Array[]; mask: Uint8Array }

// ── AmSp bank parse (same arithmetic as captiveII +0x25208) ──
export function parseAmSp(buf: Uint8Array, off: number): { sprites: Sprite[]; end: number } {
  const u16 = (o: number) => (buf[o]! << 8) | buf[o + 1]!;
  if (u16(off) !== 0x416d || u16(off + 2) !== 0x5370) throw new Error(`no AmSp at ${off}`);
  const n = u16(off + 4);
  let p = off + 6;
  const sprites: Sprite[] = [];
  for (let i = 0; i < n; i++) {
    const w = u16(p), h = u16(p + 2), planes = u16(p + 4), flags = u16(p + 6);
    const wb = (w & 0x7fff) * 2 - (w >> 15);
    const ps = wb * h;
    const data = p + 10;
    const pl: Uint8Array[] = [];
    for (let k = 0; k < 4; k++) pl.push(k < planes ? buf.subarray(data + k * ps, data + (k + 1) * ps) : new Uint8Array(ps));
    const mask = flags & 0x8000 ? buf.subarray(data + planes * ps, data + (planes + 1) * ps) : new Uint8Array(ps).fill(0xff);
    sprites.push({ wb, h, planes: pl, mask });
    let adv = ps * planes + (flags & 0x8000 ? ps : 0) + 11;
    adv &= ~1;
    p += adv;
  }
  return { sprites, end: p };
}
/** Bank sizes captiveII's VGM loader (+0x250D6) splits every .VGM into. */
export const VGM_BANK_SIZES = [0xa226, 0xec0a, 0x70ba];
export function parseVgm(buf: Uint8Array): Sprite[][] {
  const offs = [0, 0xa226, 0xa226 + 0xec0a, 0xa226 + 0xec0a + 0x70ba];
  return offs.map((o) => parseAmSp(buf, o).sprites);
}

// ── city grid ──
export interface CityZone { world: number; zone: number; planes: Uint8Array /* 3 x 4096 */; start: { x: number; y: number; z: number; facing: number } }

export interface CellValue { v: number; a1: number; a2: number }
/**
 * Window value of one city cell at height layer d7 (captiveII +0x2835A). `v` is
 * the byte written to the window; a1/a2 the aux bytes (+75/+150), which only
 * the vector-object handlers read. Returns null when d7 < -1 (the game leaves
 * the window's 0x06 default there).
 */
export function cellValue(t: EngineTables, c: number, p1: number, p2: number, d7: number): CellValue | null {
  const hi = c & 0xc0;
  const ci = c & 0x3f;
  if (d7 < -1) return null;
  if (d7 === -1) return { v: t.layer.m1[ci]!, a1: 0, a2: 0 };
  if (d7 === 0) {
    let v = t.layer.z0[ci]!;
    let a1 = 0, a2 = 0;
    if (!(v & 0x80)) return { v: v | hi, a1, a2 };
    v &= 0x7f;
    if (v === 2) { a1 = p1 & 0xfb; a2 = p2; }
    if (!(v & 0x40)) return { v, a1, a2 };
    v &= ~0x40;
    if (v === 6) {
      if (!(p1 & 0x80)) return { v, a1, a2 };
      return { v: 21 | hi, a1: (p1 & 7) + 0x44, a2 };
    }
    if (v === 0x18) return { v: ((p1 & 3) + 0x18) | hi, a1, a2 };
    return { v: v | hi, a1: p1, a2 };
  }
  if (d7 === 1) {
    let v = t.layer.z1[ci]!;
    const a2 = p2;
    if (!(v & 0x80)) return { v: v | hi, a1: p1, a2 };
    v &= 0x7f;
    if (!(v & 0x40)) return { v, a1: p1, a2 };
    v &= ~0x40;
    if (v === 0x18) return { v: ((p1 & 3) + 0x18) | hi, a1: p1, a2 };
    if (!(p1 & 0x80)) return { v, a1: p1, a2 };
    return { v: 21 | hi, a1: (p1 & 7) + 0x44, a2 };
  }
  // d7 >= 2: generic upper-layer decode (+0x2838A)
  let v = (d7 === 2 ? t.layer.z2 : t.layer.z3)[ci]!;
  if (!(v & 0x80)) return { v: v | hi, a1: 0, a2: 0 };
  v &= 0x7f;
  const floors = (p1 >> 4) + 2;
  if (v & 0x40) {
    v &= ~0x40;
    if (v !== 0x0b) return { v, a1: 0, a2: 0 };
    if (d7 > floors) return { v: 15 | hi, a1: p1, a2: 0 };
    if (d7 < floors) return { v: v | hi, a1: p1, a2: 0 };
    return { v: 12 | hi, a1: p1, a2: 0 };
  }
  if (d7 === floors) return { v: 16 | hi, a1: 0, a2: 0 };
  if (d7 < floors) return { v, a1: 0, a2: 0 };
  return { v: 15 | hi, a1: 0, a2: 0 };
}

export function cellAt(t: EngineTables, z: CityZone, x: number, y: number, layer: number): number {
  const i = y * MAP + x;
  const r = cellValue(t, z.planes[i]!, z.planes[4096 + i]!, z.planes[8192 + i]!, layer);
  return r ? r.v : 0x06;
}

/** Facing 0 N (-y), 1 E (+x), 2 S (+y), 3 W (-x) — the window orientation of +0x280FC. */
export const FWD: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Fill the 75-byte window like captiveII +0x27F8E (city branch). Out-of-map
 * cells keep the 0x06 default.
 */
export function fillWindow(t: EngineTables, zone: CityZone, x: number, y: number, z: number, facing: number): Uint8Array {
  const win = new Uint8Array(75).fill(0x06);
  let d7 = z;
  const here = zone.planes[y * MAP + x]! & 0x3f;
  if (z === 0 && here === 0x1a) d7++;
  else if (z === 1 && here === 0x1b) d7++;
  // window origin and per-axis index steps (+0x280FC)
  let ox: number, oy: number, sx: number, sy: number;
  switch (facing & 3) {
    case 0: sx = 1; sy = 5; ox = x - 2; oy = y - 4; break;
    case 1: sx = -5; sy = 1; ox = x; oy = y - 2; break;
    case 2: sx = -1; sy = -5; ox = x - 2; oy = y; break;
    default: sx = 5; sy = -1; ox = x - 4; oy = y - 2; break;
  }
  // base index of window cell (ox, oy) for each facing (+0x281EE), before clipping
  const base0 = [0, 20, 24, 4][facing & 3]!;
  for (let l = 0; l < 3; l++) {
    const layer = d7 - 1 + l;
    for (let r = 0; r < 5; r++) {
      const cy = oy + r;
      if (cy < 0 || cy >= MAP) continue;
      for (let c = 0; c < 5; c++) {
        const cx = ox + c;
        if (cx < 0 || cx >= MAP) continue;
        const idx = base0 + r * sy + c * sx;
        const i = cy * MAP + cx;
        const cv = cellValue(t, zone.planes[i]!, zone.planes[4096 + i]!, zone.planes[8192 + i]!, layer);
        if (cv) win[l * 25 + idx] = cv.v & 0xff;
      }
    }
  }
  applyVisibility(win, t.vis);
  return win;
}

/**
 * captiveII +0x28646: hide window cells behind walls. Script bytes: 0 = end;
 * b >= 0x80 -> the next (~b & 0xff) + 1 bytes are window indices set to 8;
 * otherwise b = window index, next byte = skip length: when that cell (in a
 * copy of the window taken before the pass) is open (> 8), skip that many
 * script bytes.
 */
export function applyVisibility(win: Uint8Array, vis: number[]): void {
  const copy = win.slice();
  let p = 0;
  for (;;) {
    const b = vis[p++]!;
    if (b === 0 || b === undefined) return;
    if (b & 0x80) {
      const n = ((~b) & 0xff) + 1;
      for (let k = 0; k < n; k++) win[vis[p++]!] = 8;
    } else {
      const skip = vis[p++]!;
      if (copy[b]! > 8) p += skip;
    }
  }
}

/** Bit-reverse table (captiveII +0x2542E builds the same into (942,A5)). */
const REV = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let r = 0; for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b; t[i] = r; }
  return t;
})();

/**
 * Colour mode: 0 = planes 3,4 set (CMAP colours 24-31/56-63), -1 = planes 3,4
 * clear (colours 0-7/32-39), 1 = 6-plane texture fill through the mask.
 */
export type Mode = 0 | -1 | 1;

/**
 * captiveII +0x259F8 and its CPU paths (+0x25ACE.., +0x25C24, +0x25CE8,
 * +0x25E2E, +0x25ECE / +0x26168 run mode, +0x2656C texture). `view` is 6
 * sequential planes of 2400 bytes.
 */
export function blit(view: Uint8Array, s: Sprite, rec: DrawRec, mode: Mode, t: EngineTables, tex?: { table: number; off: number } | null, phase = 0): void {
  const fl = rec.fl;
  const mirror = (fl & 8) !== 0;
  const code = fl & 7;
  let y0: number, dy: number, rows: number;
  if (code === 0) { y0 = rec.y; dy = 1; rows = s.h; }
  else if (code === 7) { y0 = 99 - rec.y; dy = -1; rows = s.h; }
  else { const d1 = t.clip[code]!; y0 = rec.y + (s.h - d1); dy = -1; rows = s.h - d1 + 1; }
  const wb = s.wb;
  // run mode (flag bit 4): rows split into opaque / masked runs; texture mode ignores it
  let rowOpaque: boolean[] | null = null;
  if ((fl & 0x10) && mode !== 1 && rec.runs) {
    rowOpaque = [];
    for (const b of rec.runs) {
      const n = (b & 0x7f) + 1;
      for (let k = 0; k < n; k++) rowOpaque.push(!(b & 0x80));
    }
    rows = rowOpaque.length;
  }
  let texBase = 0, tb: Uint8Array | null = null;
  if (mode === 1) {
    if (!tex) return;
    tb = t.textures[tex.table]!; texBase = tex.off;
  }
  // texture column phase starts at the first byte address the CPU path touches (+0x2657C / +0x2663E)
  const colStart = (mirror ? rec.x + wb + phase : rec.x + phase) & 3;
  for (let r = 0; r < rows; r++) {
    const yy = y0 + r * dy;
    const opaque = rowOpaque ? rowOpaque[r]! : false;
    for (let k = 0; k < wb; k++) {
      // k = processing order = source byte; mirrored paths walk the destination right to left
      const xb = mirror ? rec.x + wb - 1 - k : rec.x + k;
      if (yy < 0 || yy >= VIEW_H || xb < 0 || xb >= ROW_BYTES) continue;
      const si = r * wb + k;
      let m = opaque ? 0xff : s.mask[si]!;
      if (mirror && !opaque) m = REV[m]!;
      if (m === 0) continue;
      const o = yy * ROW_BYTES + xb;
      if (mode === 1) {
        const rowPh = (r & 7) * 4;
        const colPh = (colStart + (r >> 3) + k) & 3;
        for (let pl = 0; pl < 6; pl++) {
          const b = tb![texBase + pl * 512 + rowPh + colPh]!;
          const p = pl * PLANE_BYTES + o;
          view[p] = (view[p]! & ~m) | (b & m);
        }
        continue;
      }
      const src = [0, 1, 2, 3].map((pl) => { const b = s.planes[pl]![si]!; return mirror ? REV[b]! : b; });
      const hiPlanes = mode === 0 ? m : 0;
      const dst = [0, 1, 2, 5];
      for (let k = 0; k < 4; k++) { const p = dst[k]! * PLANE_BYTES + o; view[p] = (view[p]! & ~m) | src[k]!; }
      for (const k of [3, 4]) { const p = k * PLANE_BYTES + o; view[p] = (view[p]! & ~m) | hiPlanes; }
    }
  }
}

/**
 * Compose the static (non-moving) wall view: slot walk of +0x2564E with the
 * city type handlers of +0x27BBA. Vector objects (negative slot words, the
 * type 1/2 door/sign extras) are not drawn.
 */
export function composeView(t: EngineTables, bank0: Sprite[], win: Uint8Array, phase = 0, backdrop?: Uint8Array): Uint8Array {
  const view = backdrop ? backdrop.slice(0, PLANE_BYTES * 6) : new Uint8Array(PLANE_BYTES * 6);
  for (const e of t.slots) {
    if (e.obj || !e.rec) continue;
    const d5 = win[e.idx]!;
    if (d5 > 7) continue;
    if (e.nbr >= 0 && win[e.nbr]! <= 8) continue;
    const s = bank0[e.rec.spr & 0x3f];
    if (!s) continue;
    switch (d5 & 7) {
      case 1: blit(view, s, e.rec, 0, t); break;
      case 6: blit(view, s, e.rec, 1, t, e.tex, phase); break;
      default: blit(view, s, e.rec, -1, t); break;
    }
  }
  return view;
}

/** 6 planar planes -> 192x100 colour indices 0..63. */
export function chunky(view: Uint8Array): Uint8Array {
  const out = new Uint8Array(VIEW_W * VIEW_H);
  for (let y = 0; y < VIEW_H; y++)
    for (let x = 0; x < VIEW_W; x++) {
      const o = y * ROW_BYTES + (x >> 3), bit = 7 - (x & 7);
      let i = 0;
      for (let p = 0; p < 6; p++) if ((view[p * PLANE_BYTES + o]! >> bit) & 1) i |= 1 << p;
      out[y * VIEW_W + x] = i;
    }
  return out;
}

/**
 * Walker passability at the street layer, read off captiveII +0x24628 / +0x282DA:
 * blocked when the cell's window value has bit 7 (door/object cell, +0x246F4),
 * or its flags word has bits 1-2 (solid), bit 3 (stairs/ramp: layer change,
 * not followed here) or bit 4 (drop to the layer below: the game refuses with
 * -10 unless a ramp is under it).
 */
export function canEnter(t: EngineTables, zone: CityZone, x: number, y: number, z: number): boolean {
  if (x < 0 || y < 0 || x >= MAP || y >= MAP) return false;
  const v = cellAt(t, zone, x, y, z);
  if (v & 0x80) return false;
  const f = t.flags[v & 0x3f]!;
  return (f & 0x1e) === 0;
}
