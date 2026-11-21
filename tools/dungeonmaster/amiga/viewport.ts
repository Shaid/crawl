/**
 * Dungeon Master / Chaos Strikes Back (Amiga) 224x136 dungeon-view compositor.
 *
 * Original code, written from the game's own executable: `KAOS.FTL`'s code
 * block, decompressed by `ftl.ts` (DM build, 143,474 bytes, byte-sum 0x4E23
 * = the module header's check word). Offsets below are into that decompressed
 * code ("K+0x....") or into its initialised-data block, cited as the game's
 * own `A5`-relative address ("A5-0x....").
 *
 *  - Zone layout: `Graphics.DAT` item 696 (loaded at K+0x11BDA, parsed at
 *    K+0x11AEC) and its resolver K+0x1142E (`resolveZone`).
 *  - View: K+0x16846 draws floor/ceiling, then the 17 square routines
 *    K+0x151F2 .. K+0x166CE in a fixed order (`SQUARES`). Each square routine
 *    switches on the element type returned by K+0x6784 (`ViewMap.aspect`).
 *  - Blits: K+0x135C0 (key colour 10), K+0x13638 (opaque), K+0x136B0
 *    (mirrored copy, key colour 10), K+0x13EEC (door), K+0x14046 (ceiling pit).
 *  - Bitmap handles: wall-set slots filled by K+0x22480 / K+0x12842 /
 *    K+0x1275E / K+0x12AE8 and the sub-rectangle table at A5-0x1B6E
 *    (14-byte entries `{type, -, x, y, w, h, ptr}`; see `HANDLES`).
 *
 * Not drawn (the walker's documented gaps, `dm1-walker-ornaments`): wall,
 * floor and door ornaments (K+0x139E2, K+0x13CCC, K+0x13D9E), objects and
 * creatures (K+0x14240), door buttons (K+0x13E40), the teleporter field
 * (K+0x140C4), the destroyed-door mask, and the door bitmap's random flip
 * (K+0x13F50: door types whose flag word at A5-0x2494 has bit 2 get a
 * per-frame random horizontal/vertical flip; the walker never flips).
 */

export const VIEWPORT_W = 224;
export const VIEWPORT_H = 136;
/** Key colour of every transparent blit (the literal 10 pushed by K+0x135C0 / K+0x136B0 / K+0x13938). */
export const TRANSPARENT = 10;

export interface Bitmap {
  w: number;
  h: number;
  px: Uint8Array;
}

/** One item-696 zone record: `{type, parent, d1, d2}` (big-endian words). */
export interface LayoutRec {
  type: number;
  parent: number;
  d1: number;
  d2: number;
}

/** Everything the compositor needs: decoded items + the item-696 layout. */
export interface DmGfx {
  items: Record<number, Bitmap>;
  layout: Map<number, LayoutRec>;
}

/** Element types produced by the square-aspect routine K+0x6784. */
export const EL = {
  WALL: 0,
  CORRIDOR: 1,
  PIT: 2,
  STAIRS: 3,
  DOOR: 4,
  TELEPORTER: 5,
  FAKEWALL: 6,
  /** Door seen from its side (`(dir & 1) == attr bit 3`, K+0x6784). */
  DOOR_SIDE: 16,
  /** Door seen face-on. */
  DOOR_FRONT: 17,
  /** Stairs seen from the side (`(dir & 1) == attr bit 3`, K+0x6784). */
  STAIRS_SIDE: 18,
  /** Stairs seen face-on. */
  STAIRS_FRONT: 19,
} as const;

export interface Aspect {
  element: number;
  stairsUp: boolean;
  doorState: number; // 0 open, 1..3 partial, 4 closed, 5 destroyed
  doorType: number; // 0/1 -> map doorSet0/1
  doorVertical: boolean;
  pitInvisible: boolean;
}

/** What the compositor needs to know about the map. */
export interface ViewMap {
  aspect(x: number, y: number, dir: number): Aspect;
  /** true when the square above (level-1) at x,y is an open pit (ceiling pit). */
  ceilingPit(x: number, y: number): boolean;
  doorSet(doorType: number): number;
}

// ---------------------------------------------------------------- item 696

/** Parse item 696 (magic 0xFC0D, range count, `{first,last}` pairs, then 8-byte records), as K+0x11AEC does. */
export function parseLayout(item696: Uint8Array): Map<number, LayoutRec> {
  const w = (o: number) => {
    if (o + 1 >= item696.length) throw new Error('item 696: truncated');
    return (item696[o]! << 8) | item696[o + 1]!;
  };
  const s = (o: number) => ((w(o) << 16) >> 16);
  if (w(0) !== 0xfc0d) throw new Error('item 696: missing 0xFC0D magic');
  const ranges = w(2);
  let rec = 4 + ranges * 4;
  const out = new Map<number, LayoutRec>();
  for (let r = 0; r < ranges; r++) {
    const first = w(4 + 4 * r);
    const last = w(6 + 4 * r);
    for (let z = first; z <= last; z++, rec += 8) out.set(z, { type: w(rec), parent: w(rec + 2), d1: s(rec + 4), d2: s(rec + 6) });
  }
  if (rec !== item696.length) throw new Error(`item 696: records end at ${rec}, item is ${item696.length} bytes`);
  return out;
}

/** Resolved blit rectangle plus the source offset clipped away on the left/top. */
export interface Coord {
  x: number;
  y: number;
  w: number;
  h: number;
  /** source x/y offset into the bitmap (clipped-away columns/rows) */
  sx: number;
  sy: number;
}

const half = (v: number) => (v + 1) >> 1;

/**
 * Anchor a `w`x`h` box on point (px,py) by anchor code 0..8 (the resolver's
 * 9-way switches, jump tables K+0x11958 for the leaf, K+0x1196A / K+0x1198E
 * for parent boxes): 0 centre, 1 top-left, 2 top-right, 3 bottom-right,
 * 4 bottom-left, 5 top-centre, 6 right-centre, 7 bottom-centre, 8 left-centre.
 * Returns the box's top-left.
 */
function anchorTopLeft(code: number, px: number, py: number, w: number, h: number): [number, number] {
  switch (code) {
    case 0: return [px - half(w), py - half(h)];
    case 1: return [px, py];
    case 2: return [px + 1 - w, py];
    case 3: return [px + 1 - w, py + 1 - h];
    case 4: return [px, py + 1 - h];
    case 5: return [px - half(w), py];
    case 6: return [px + 1 - w, py - half(h)];
    case 7: return [px - half(w), py + 1 - h];
    case 8: return [px, py - half(h)];
    default: throw new Error(`zone anchor ${code}`);
  }
}

/** Offset from a box's top-left to its anchor point (jump table K+0x1197C). */
function anchorOffset(code: number, w: number, h: number): [number, number] {
  switch (code) {
    case 0: return [half(w), half(h)];
    case 1: return [0, 0];
    case 2: return [w - 1, 0];
    case 3: return [w - 1, h - 1];
    case 4: return [0, h - 1];
    case 5: return [half(w), 0];
    case 6: return [w - 1, half(h)];
    case 7: return [half(w), h - 1];
    case 8: return [0, half(h)];
    default: throw new Error(`zone anchor ${code}`);
  }
}

/**
 * The zone resolver K+0x1142E. `w`/`h` are the bitmap (or override) size;
 * `inX`/`inY` are the in/out offset words the game passes by pointer: with
 * bit 15 of `zone` set they are added to the anchor point first. Returns
 * null for zone 0xFFFF, an unknown zone, a type-9 leaf, or a fully clipped
 * rectangle.
 */
export function resolveZone(layout: Map<number, LayoutRec>, zone: number, w: number, h: number, inX = 0, inY = 0): Coord | null {
  if (zone === 0xffff) return null;
  const offsetMode = (zone & 0x8000) !== 0;
  let rec = layout.get(zone & 0x7fff);
  if (!rec || (zone & 0x7fff) === 0) return null;
  // clip rectangle, starts "unbounded" (20000x20000, K+0x11472)
  let cx = 0;
  let cy = 0;
  let cw = 20000;
  let ch = 20000;
  let anchor = rec.type;
  let ax: number;
  let ay: number;
  if (anchor <= 8) {
    ax = rec.d1;
    ay = rec.d2;
  } else if (anchor === 9) return null;
  else {
    anchor -= 10;
    ax = 0;
    ay = 0;
  }
  if (offsetMode) {
    ax += inX;
    ay += inY;
  }
  let pending = false;
  const clipTo = (ox: number, oy: number, pw: number, ph: number) => {
    if (ox > cx) cx = ox;
    if (pw + ox <= cx + cw - 1) cw = pw - cx + ox;
    if (oy > cy) cy = oy;
    if (ph + oy <= cy + ch - 1) ch = ph - cy + oy;
  };
  while (rec.parent !== 0) {
    if (rec.type >= 10 && rec.type <= 18) {
      // relative record: anchored inside its parent box, which is itself placed in the grandparent
      const box = layout.get(rec.parent);
      if (!box) break;
      const outer = layout.get(box.parent);
      if (!outer) break;
      // the box's own top-left inside the outer box (K+0x1150C)
      const [bx, by] = anchorTopLeft(box.type, box.d1, box.d2, outer.d1, outer.d2);
      cx += bx;
      cy += by;
      clipTo(bx, by, outer.d1, outer.d2);
      const [ox, oy] = anchorOffset(rec.type - 10, outer.d1, outer.d2);
      ax += rec.d1 + bx + ox;
      ay += rec.d2 + by + oy;
      rec = outer;
      continue;
    }
    const parent = layout.get(rec.parent);
    if (!parent) break;
    if (parent.type === 1) {
      // plain offset parent
      ax += parent.d1;
      ay += parent.d2;
      cx += parent.d1;
      cy += parent.d2;
    } else if (parent.type === 9) {
      // sized parent: place it by this record's anchor (K+0x1169A), clip to it
      let px: number;
      let py: number;
      if (rec.type <= 8) [px, py] = anchorTopLeft(rec.type, rec.d1, rec.d2, parent.d1, parent.d2);
      else {
        px = parent.d1;
        py = parent.d2;
      }
      if (pending) {
        pending = false;
        ax += px;
        ay += py;
        cx += px;
        cy += py;
      }
      clipTo(px, py, parent.d1, parent.d2);
    } else if (parent.type <= 8) pending = true;
    rec = parent;
  }
  const bw = inX !== 0 && !offsetMode ? inX : w;
  const bh = inY !== 0 && !offsetMode ? inY : h;
  const [x, y] = anchorTopLeft(anchor, ax, ay, bw, bh);
  const out: Coord = { x, y, w: 0, h: 0, sx: 0, sy: 0 };
  const dx = cx - x;
  const dy = cy - y;
  if (dx <= 0) out.w = Math.min(bw, cw + dx);
  else {
    out.sx = dx;
    out.x = cx;
    out.w = Math.min(cw, bw - dx);
  }
  if (dy <= 0) out.h = Math.min(bh, ch + dy);
  else {
    out.sy = dy;
    out.y = cy;
    out.h = Math.min(ch, bh - dy);
  }
  return out.w > 0 && out.h > 0 ? out : null;
}

/** Resolve a zone for a `bw`x`bh` bitmap (the plain K+0x135C0 call shape). */
export function getCoord(layout: Map<number, LayoutRec>, zone: number, bw: number, bh: number): Coord | null {
  return resolveZone(layout, zone, bw, bh);
}

// ---------------------------------------------------------------- bitmap handles

/**
 * A bitmap handle: an item, optionally mirrored once at load (K+0x127B4) and
 * optionally a sub-rectangle `x,w` of it (the A5-0x1B6E slot table;
 * x is in the coordinates of the bitmap as drawn, i.e. of the mirrored copy
 * when the blit mirrors).
 */
interface Handle {
  item: number;
  mirrored?: boolean;
  sub?: { x: number; w: number };
}

/** Wall set 0 = items 86..107 (K+0x12862: `86 + 40*set`), floor set 0 = 78/79 (K+0x1277E: `78 + 2*set`). */
const WALL = 86;
/** Stairs set 0 = items 108..125 (K+0x12AF8: `108 + 40*set`), kept in A5-0x1042[0..17]. */
const STAIRS = 108;
/** Door set s = items 246+3s .. 248+3s (K+0x12D3A), one per depth D3/D2/D1. */
const DOOR_SET0 = 246;

/** The handles the square routines push, named by the game global that holds each one. */
const H = {
  ceiling: { item: 79 }, // A5-0x173C
  floor: { item: 78 }, // A5-0x173E
  w86: { item: WALL + 0 }, // A5-0x1710, D0C door frame
  w87: { item: WALL + 1 }, // A5-0x170C
  w87m: { item: WALL + 1, mirrored: true }, // A5-0x170E (mirror made by K+0x128FE)
  w88: { item: WALL + 2 }, // A5-0x170A
  w89: { item: WALL + 3 }, // A5-0x1708
  w90: { item: WALL + 4 }, // A5-0x1706
  w90a: { item: WALL + 4, sub: { x: 7, w: 4 } }, // A5-0x1704 (slot 36)
  w90b: { item: WALL + 4, sub: { x: 6, w: 4 } }, // A5-0x1702 (slot 37)
  w91: { item: WALL + 5 }, // A5-0x1718
  w91a: { item: WALL + 5, sub: { x: 16, w: 32 } }, // A5-0x171A (slot 47)
  w91b: { item: WALL + 5, sub: { x: 16, w: 32 } }, // A5-0x171C (slot 49)
  w92: { item: WALL + 6 }, // A5-0x1712
  w92a: { item: WALL + 6, sub: { x: 16, w: 60 } }, // A5-0x1714 (slot 44)
  w92b: { item: WALL + 6, sub: { x: 16, w: 60 } }, // A5-0x1716 (slot 46)
  st0a: { item: STAIRS + 0, sub: { x: 50, w: 7 } }, // handle -33 (slot 32, K+0x12B3E)
  st0b: { item: STAIRS + 0, sub: { x: 6, w: 7 } }, // handle -34
  st7a: { item: STAIRS + 7, sub: { x: 62, w: 7 } }, // handle -35
  st7b: { item: STAIRS + 7, sub: { x: 6, w: 7 } }, // handle -36
} satisfies Record<string, Handle>;
/**
 * Wall handles A5-0x173A + 2*(k-7) hold items 93..107 (k = 7..21). When the
 * view parity is odd and option flag `W` (A5-0x3F8B; set from the option
 * byte list parsed at K+0x22D3E) is on, K+0x168C2 swaps in the 15 mirrored
 * handles at A5-0x1700, built at K+0x129EE as the mirror of each wall's
 * left/right counterpart (D0R <-> D0L, D1R <-> D1L, ...; centre walls mirror
 * themselves), and K+0x16C4E restores them after the squares are drawn.
 */
const WALL_PARTNER: Record<number, number> = { 7: 8, 8: 7, 9: 10, 10: 9, 11: 11, 12: 13, 13: 12, 14: 15, 15: 14, 16: 16, 17: 18, 18: 17, 19: 20, 20: 19, 21: 21 };
const stairs = (k: number): Handle => ({ item: STAIRS + k });

// ---------------------------------------------------------------- blitter

type Mode = 'key' | 'opaque' | 'mirror';

class Canvas {
  readonly px = new Uint8Array(VIEWPORT_W * VIEWPORT_H);
}

function mirror(b: Bitmap): Bitmap {
  const px = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) px[y * b.w + x] = b.px[y * b.w + b.w - 1 - x]!;
  return { w: b.w, h: b.h, px };
}

/** Square-routine descriptions, one per view position (see `SQUARES`). */
interface Pos {
  name: string;
  fwd: number;
  right: number;
  /** K+... routine, for the record */
  at: number;
}

/**
 * The 17 square routines in the order K+0x16846 calls them (the four D4
 * calls before them only draw objects, which the walker does not).
 */
const SQUARES: Pos[] = [
  { name: 'D3L2', fwd: 3, right: -2, at: 0x151f2 },
  { name: 'D3R2', fwd: 3, right: 2, at: 0x1533e },
  { name: 'D3L', fwd: 3, right: -1, at: 0x15492 },
  { name: 'D3R', fwd: 3, right: 1, at: 0x15618 },
  { name: 'D3C', fwd: 3, right: 0, at: 0x157c4 },
  { name: 'D2L2', fwd: 2, right: -2, at: 0x1595c },
  { name: 'D2R2', fwd: 2, right: 2, at: 0x159b4 },
  { name: 'D2L', fwd: 2, right: -1, at: 0x15a0c },
  { name: 'D2R', fwd: 2, right: 1, at: 0x15bac },
  { name: 'D2C', fwd: 2, right: 0, at: 0x15d50 },
  { name: 'D1L', fwd: 1, right: -1, at: 0x15f0e },
  { name: 'D1R', fwd: 1, right: 1, at: 0x160ac },
  { name: 'D1C', fwd: 1, right: 0, at: 0x1624c },
  { name: 'D0L', fwd: 0, right: -1, at: 0x164f8 },
  { name: 'D0R', fwd: 0, right: 1, at: 0x165e2 },
  { name: 'D0C', fwd: 0, right: 0, at: 0x166ce },
];

/** Direction steps, the game's tables at A5-0x3128 (x) and A5-0x3120 (y). */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export class DmViewport {
  private readonly gfx: DmGfx;
  private readonly mirrors = new Map<number, Bitmap>();
  private readonly wallFlipOption: boolean;
  private flipWalls = false;

  /** `wallFlip` = the game's `W` option flag (A5-0x3F8B); on by default. */
  constructor(gfx: DmGfx, opts: { wallFlip?: boolean } = {}) {
    this.gfx = gfx;
    this.wallFlipOption = opts.wallFlip ?? true;
  }

  private wall(k: number): Handle {
    return this.flipWalls ? { item: WALL + WALL_PARTNER[k]!, mirrored: true } : { item: WALL + k };
  }

  private bitmap(item: number, mirrored: boolean): Bitmap | null {
    const b = this.gfx.items[item];
    if (!b) return null;
    if (!mirrored) return b;
    let m = this.mirrors.get(item);
    if (!m) this.mirrors.set(item, (m = mirror(b)));
    return m;
  }

  /** Blit `bmp` (already in drawing orientation) through `zone`; `bw` overrides the width used for placement. */
  private put(c: Canvas, bmp: Bitmap, zone: number, key: boolean, srcX0 = 0, bw = 0, inX = 0, inY = 0): void {
    const r = resolveZone(this.gfx.layout, zone, bw || bmp.w, bmp.h, inX, inY);
    if (!r) return;
    for (let j = 0; j < r.h; j++) {
      const dy = r.y + j;
      const sy = r.sy + j;
      if (dy < 0 || dy >= VIEWPORT_H || sy < 0 || sy >= bmp.h) continue;
      for (let i = 0; i < r.w; i++) {
        const dx = r.x + i;
        const sx = srcX0 + r.sx + i;
        if (dx < 0 || dx >= VIEWPORT_W || sx < 0 || sx >= bmp.w) continue;
        const v = bmp.px[sy * bmp.w + sx]!;
        if (key && v === TRANSPARENT) continue;
        c.px[dy * VIEWPORT_W + dx] = v;
      }
    }
  }

  /** K+0x135C0 ('key'), K+0x13638 ('opaque'), K+0x136B0 ('mirror': mirrored copy, keyed). */
  private draw(c: Canvas, h: Handle, zone: number, mode: Mode): void {
    const flip = mode === 'mirror';
    const bmp = this.bitmap(h.item, !!h.mirrored !== flip);
    if (!bmp) return;
    if (h.sub) this.put(c, bmp, zone, mode !== 'opaque', h.sub.x, h.sub.w);
    else this.put(c, bmp, zone, mode !== 'opaque');
  }

  /** Door bitmap at `zone` (K+0x13EEC); `depth` 0/1/2 = the D3/D2/D1 door item. */
  private door(c: Canvas, map: ViewMap, a: Aspect, depth: number, zone: number): void {
    const st = a.doorState;
    if (st === 0) return;
    const bmp = this.bitmap(DOOR_SET0 + 3 * map.doorSet(a.doorType) + depth, false);
    if (!bmp) return;
    if (st >= 4 || a.doorVertical) {
      this.put(c, bmp, st >= 4 ? zone : zone + st, true);
      return;
    }
    // horizontally opening: right half at zone+6+state, left half at zone+3+state (K+0x13FC4 .. K+0x14028)
    const hw = bmp.w >> 1;
    this.put(c, bmp, zone + st + 6, true, hw, 0, hw, 0);
    this.put(c, bmp, zone + st + 3, true, 0, 0, hw, 0);
  }

  /** K+0x14046: draw `item` at `zone` when the square above is an open pit. */
  private ceilingPit(c: Canvas, map: ViewMap, x: number, y: number, item: number, zone: number, flip: boolean): void {
    if (map.ceilingPit(x, y)) this.draw(c, { item }, zone, flip ? 'mirror' : 'key');
  }

  render(map: ViewMap, px: number, py: number, dir: number): Uint8Array {
    const c = new Canvas();
    // K+0x16896: parity (x + y + dir) & 1 decides which of floor/ceiling is mirrored
    const odd = ((px + py + dir) & 1) !== 0;
    this.flipWalls = odd && this.wallFlipOption;
    if (odd) {
      this.draw(c, H.ceiling, 700, 'opaque');
      this.draw(c, H.floor, 701, 'mirror');
    } else {
      this.draw(c, H.ceiling, 700, 'mirror');
      this.draw(c, H.floor, 701, 'opaque');
    }
    for (const s of SQUARES) {
      // K+0x59F4: forward along dir, right along dir+1
      const x = px + s.fwd * DX[dir & 3]! + s.right * DX[(dir + 1) & 3]!;
      const y = py + s.fwd * DY[dir & 3]! + s.right * DY[(dir + 1) & 3]!;
      this.square(c, map, s.name, map.aspect(x, y, dir), x, y);
    }
    return c.px;
  }

  // One case per square routine; element cases with nothing the walker draws are omitted.
  private square(c: Canvas, map: ViewMap, pos: string, a: Aspect, x: number, y: number): void {
    const e = a.element;
    const pit = (item: number, invItem: number, zone: number, mode: Mode) => {
      if (invItem < 0) {
        if (!a.pitInvisible) this.draw(c, { item }, zone, mode);
      } else this.draw(c, { item: a.pitInvisible ? invItem : item }, zone, mode);
    };
    switch (pos) {
      case 'D3L2': // K+0x151F2
        if (e === EL.WALL) this.draw(c, this.wall(18), 702, 'key');
        else if (e === EL.PIT) pit(49, -1, 850, 'key');
        else if (e === EL.STAIRS_FRONT) this.draw(c, a.stairsUp ? H.st0a : H.st7a, a.stairsUp ? 800 : 813, 'key');
        else if (e === EL.DOOR_FRONT) this.door(c, map, a, 0, 3700);
        return;
      case 'D3R2': // K+0x1533E
        if (e === EL.WALL) this.draw(c, this.wall(17), 703, 'key');
        else if (e === EL.PIT) pit(49, -1, 851, 'mirror');
        else if (e === EL.STAIRS_FRONT) this.draw(c, a.stairsUp ? H.st0b : H.st7b, a.stairsUp ? 801 : 814, 'mirror');
        else if (e === EL.DOOR_FRONT) this.door(c, map, a, 0, 3710);
        return;
      case 'D3L': // K+0x15492
        if (e === EL.WALL) this.draw(c, this.wall(20), 705, 'key');
        else if (e === EL.PIT) pit(50, -1, 852, 'key');
        else if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 0 : 7), a.stairsUp ? 802 : 815, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w90, 718, 'key');
          this.draw(c, H.w90a, 719, 'mirror');
          this.door(c, map, a, 0, 3720);
        }
        return;
      case 'D3R': // K+0x15618
        if (e === EL.WALL) this.draw(c, this.wall(19), 706, 'key');
        else if (e === EL.PIT) pit(50, -1, 854, 'mirror');
        else if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 0 : 7), a.stairsUp ? 804 : 817, 'mirror');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w90b, 720, 'key');
          this.draw(c, H.w90, 721, 'mirror');
          this.door(c, map, a, 0, 3740);
        }
        return;
      case 'D3C': // K+0x157C4
        if (e === EL.WALL) this.draw(c, this.wall(21), 704, 'opaque');
        else if (e === EL.PIT) pit(51, -1, 853, 'key');
        else if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 1 : 8), a.stairsUp ? 803 : 816, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w89, 722, 'key');
          this.draw(c, H.w89, 723, 'mirror');
          this.door(c, map, a, 0, 3730);
        }
        return;
      case 'D2L2': // K+0x1595C
        if (e === EL.WALL) this.draw(c, this.wall(13), 707, 'key');
        return;
      case 'D2R2': // K+0x159B4
        if (e === EL.WALL) this.draw(c, this.wall(12), 708, 'key');
        return;
      case 'D2L': // K+0x15A0C
        if (e === EL.WALL) {
          this.draw(c, this.wall(15), 710, 'key');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 2 : 9), a.stairsUp ? 805 : 818, 'key');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(14), 826, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w92a, 729, 'key');
          this.door(c, map, a, 1, 3750);
        } else if (e === EL.PIT) pit(52, 58, 855, 'key');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT && e !== EL.STAIRS_SIDE && e !== EL.DOOR_SIDE && e !== EL.DOOR_FRONT) return;
        this.ceilingPit(c, map, x, y, 64, 864, false);
        return;
      case 'D2R': // K+0x15BAC
        if (e === EL.WALL) {
          this.draw(c, this.wall(14), 711, 'key');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 2 : 9), a.stairsUp ? 807 : 820, 'mirror');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(14), 827, 'mirror');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w92b, 731, 'key');
          this.door(c, map, a, 1, 3770);
          return; // the door case ends the routine: no ceiling pit
        } else if (e === EL.PIT) pit(52, 58, 857, 'mirror');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT && e !== EL.STAIRS_SIDE && e !== EL.DOOR_SIDE) return;
        this.ceilingPit(c, map, x, y, 64, 866, true);
        return;
      case 'D2C': // K+0x15D50
        if (e === EL.WALL) {
          this.draw(c, this.wall(16), 709, 'opaque');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 3 : 10), a.stairsUp ? 806 : 819, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w92, 730, 'key');
          this.draw(c, H.w88, 724, 'key');
          this.draw(c, H.w88, 725, 'mirror');
          this.door(c, map, a, 1, 3760);
          return; // the door case ends the routine: no ceiling pit
        } else if (e === EL.PIT) pit(53, 59, 856, 'key');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT) return;
        this.ceilingPit(c, map, x, y, 65, 865, false);
        return;
      case 'D1L': // K+0x15F0E
        if (e === EL.WALL) {
          this.draw(c, this.wall(10), 713, 'key');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 4 : 11), a.stairsUp ? 808 : 821, 'key');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(a.stairsUp ? 15 : 16), a.stairsUp ? 828 : 830, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w91a, 732, 'key');
          this.door(c, map, a, 2, 3780);
          return; // the door case ends the routine: no ceiling pit
        } else if (e === EL.PIT) pit(54, 60, 858, 'key');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT && e !== EL.STAIRS_SIDE && e !== EL.DOOR_SIDE) return;
        this.ceilingPit(c, map, x, y, 66, 867, false);
        return;
      case 'D1R': // K+0x160AC
        if (e === EL.WALL) {
          this.draw(c, this.wall(9), 714, 'key');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 4 : 11), a.stairsUp ? 810 : 823, 'mirror');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(a.stairsUp ? 15 : 16), a.stairsUp ? 829 : 831, 'mirror');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w91b, 734, 'key');
          this.door(c, map, a, 2, 3800);
          return;
        } else if (e === EL.PIT) pit(54, 60, 860, 'mirror');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT && e !== EL.STAIRS_SIDE && e !== EL.DOOR_SIDE) return;
        this.ceilingPit(c, map, x, y, 66, 869, true);
        return;
      case 'D1C': // K+0x1624C
        if (e === EL.WALL) {
          this.draw(c, this.wall(11), 712, 'opaque');
          return;
        }
        if (e === EL.STAIRS_FRONT) this.draw(c, stairs(a.stairsUp ? 5 : 12), a.stairsUp ? 809 : 822, 'key');
        else if (e === EL.DOOR_FRONT) {
          this.draw(c, H.w91, 733, 'key');
          this.draw(c, H.w87, 726, 'key');
          this.draw(c, H.w87m, 727, 'key');
          this.door(c, map, a, 2, 3790);
          return;
        } else if (e === EL.PIT) pit(55, 61, 859, 'key');
        if (e !== EL.TELEPORTER && e !== EL.CORRIDOR && e !== EL.PIT && e !== EL.STAIRS_FRONT) return;
        this.ceilingPit(c, map, x, y, 67, 868, false);
        return;
      case 'D0L': // K+0x164F8 (bound 0x12: STAIRS_FRONT is out of its table and draws nothing)
        if (e === EL.WALL) this.draw(c, this.wall(8), 716, 'key');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(17), 832, 'key');
        else if (e === EL.PIT || e === EL.CORRIDOR || e === EL.TELEPORTER || e === EL.DOOR_SIDE) {
          if (e === EL.PIT) pit(56, 62, 861, 'key');
          this.ceilingPit(c, map, x, y, 68, 870, false);
        }
        return;
      case 'D0R': // K+0x165E2
        if (e === EL.WALL) this.draw(c, this.wall(7), 717, 'key');
        else if (e === EL.STAIRS_SIDE) this.draw(c, stairs(17), 833, 'mirror');
        else if (e === EL.PIT || e === EL.CORRIDOR || e === EL.TELEPORTER || e === EL.DOOR_SIDE) {
          if (e === EL.PIT) pit(56, 62, 863, 'mirror');
          this.ceilingPit(c, map, x, y, 68, 872, true);
        }
        return;
      case 'D0C': // K+0x166CE
        if (e === EL.DOOR_SIDE) this.draw(c, H.w86, 728, 'key');
        else if (e === EL.PIT) pit(57, 63, 862, 'key');
        else if (e === EL.STAIRS_FRONT) {
          const h = stairs(a.stairsUp ? 6 : 13);
          this.draw(c, h, a.stairsUp ? 811 : 824, 'key');
          this.draw(c, h, a.stairsUp ? 812 : 825, 'mirror');
        }
        this.ceilingPit(c, map, x, y, 69, 871, false);
        return;
    }
  }
}

// ---------------------------------------------------------------- assets

export interface WalkerGfxJson {
  items: Record<string, { w: number; h: number; px: string }>;
  layout696: string;
  palettes: number[][];
}

function fromB64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadGfx(j: WalkerGfxJson): DmGfx {
  const items: Record<number, Bitmap> = {};
  for (const [k, v] of Object.entries(j.items)) items[Number(k)] = { w: v.w, h: v.h, px: fromB64(v.px) };
  return { items, layout: parseLayout(fromB64(j.layout696)) };
}

/** 12-bit Amiga colour words -> 8-bit RGB (nibble x 17). */
export function paletteRgb(words: number[]): Array<{ r: number; g: number; b: number }> {
  return words.map((w) => ({ r: ((w >> 8) & 15) * 17, g: ((w >> 4) & 15) * 17, b: (w & 15) * 17 }));
}
