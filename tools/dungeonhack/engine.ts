/**
 * Dungeon Hack (DOS/VGA) dungeon-view engine.
 *
 * Same engine family as EOB3 (AESOP/16): the dungeon, kernel, features, doors,
 * items ... SOP class bytecode from HACK.RES runs unchanged on `tools/aesop/vm.ts`
 * (clean-room VM). What differs is the NATIVE side: Dungeon Hack's AESOP.EXE
 * implements `init_viewspace`, `build_clipping`, `draw_walls`, `step_X/Y`, the
 * feature-file reader and the R250 random generator natively, and the maze is
 * produced by the separate MAZE.EXE (scripts/run_dungeonhack_maze.py).
 *
 * The native routines below are written from the game's own x86 code in
 * AESOP.EXE (Borland C++ 1991; module segment 0f36 for the view functions,
 * 0b47:0000 for the RNG) with their lookup tables read straight from the
 * executable's data segment (scripts/extract_dungeonhack_walker.py ->
 * natives.json). Offsets are cited at each function. docs/dungeonhack/dosvga/
 * data-structure.md section 9 has the full derivation.
 *
 * Window model (manual: GRAPHICS.C): page 0 = visible display, page 1 = staging;
 * `assign_subwindow(owner, parent, x1,y1,x2,y2)` shares the parent's buffer;
 * `assign_window` allocates its own. Draw coordinates are ABSOLUTE page coordinates
 * clipped to the window's pane: both the native `draw_walls` (it adds the view
 * origin 138,13 itself, AESOP.EXE 0f36:0b8e) and the bytecode's `draw_bitmap`
 * calls (e.g. x = 266 for a shape 128 px into the view) do so. `set_x1/x2`
 * narrow the clip (absolute), as in EOB3.
 */
import { ObjectSystem, decodeClassJson, type Interpreter, type Value } from '../aesop/vm.ts';

export const VIEW_W = 176;
export const VIEW_H = 120;
const PAGE_W = 320;
const PAGE_H = 200;

const OBJ_KERNEL = 0;
const OBJ_DUNGEON = 2001;
const OBJ_CAMP = 2002;

const MSG_CREATE = 0;
const MSG_REPORT = 89;
const MSG_IMPEDANCE = 244;
const MSG_INIT_VIEWSPACE = 455;
const MSG_DRAW_FLOOR = 456;
const MSG_DRAW_WALLS = 457;
const MSG_DRAW_OBJECTS = 458;
const MSG_INIT_WHOLE_DUNGEON = 469;
const MSG_LOAD_LEVEL = 446;
const MSG_INIT_LEVEL = 447;

export interface DungeonLevel { lvlmap: string; fea: string }
export interface DungeonPack {
  name: string;
  seed: number;
  settings: number[];
  items: string;
  levels: DungeonLevel[];
}
export interface Natives {
  step: number[]; viewspace: number[]; clip: number[];
  wall_dx: number[]; wall_dy: number[]; wall_visidx: number[]; wall_y: number[]; wall_x: number[];
  wall_flip: number[]; wall_shape: number[]; first_color: number[];
}
export interface DhPack {
  classes: Array<Parameters<typeof decodeClassJson>[0]>;
  palettes: Record<string, { name: string; colors: number[][] }>;
  bitmapIndex: Record<string, { name: string; offset: number; size: number; shapes: number }>;
  bitmaps: Uint8Array;
  natives: Natives;
  dungeons: DungeonPack[];
}

export interface Shape { w: number; h: number; pixels: Uint8Array; mask: Uint8Array }

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const s8 = (v: number): number => (v << 24) >> 24;

/** Decode sub-bitmap `index` of an "old format" row/span RLE resource (scripts/eotb3lib/bitmap.py). */
export function decodeOldShape(b: Uint8Array, index: number): Shape {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const subOff = dv.getUint32(6 + index * 4, true);
  const w = dv.getUint16(subOff, true);
  const h = dv.getUint16(subOff + 2, true);
  const pixels = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  let pos = subOff + 4;
  while (pos < b.length) {
    const y = b[pos++]!;
    if (y === 0xff) break;
    if (y >= h) throw new Error(`scanline ${y} >= ${h}`);
    for (;;) {
      let x = b[pos]! | ((b[pos + 1]! & 0x7f) << 8);
      const last = b[pos + 1]! & 0x80;
      let remaining = b[pos + 2]!;
      pos += 4;
      while (remaining > 0) {
        const tok = b[pos++]!;
        const amount = (tok >> 1) + 1;
        const base = y * w + x;
        if (tok & 1) {
          const v = b[pos++]!;
          for (let i = 0; i < amount && x + i < w; i++) { pixels[base + i] = v; mask[base + i] = 1; }
        } else {
          for (let i = 0; i < amount; i++) { if (x + i < w) { pixels[base + i] = b[pos]!; mask[base + i] = 1; } pos++; }
        }
        x += amount;
        remaining -= amount;
      }
      if (last) break;
    }
  }
  return { w, h, pixels, mask };
}

/** AESOP.EXE R250 generator (0a4f:0f87 seed_random, 0a4f:107c rnd). */
export class R250 {
  private tab = new Uint16Array(250);
  private idx = 0;
  private started = false;
  seed(seed: number): void {
    this.started = true;
    this.idx = 0;
    let x = seed >>> 0;
    for (let i = 0; i < 250; i++) {
      this.tab[i] = x >>> 16;
      x = (Math.imul(x, 0x015a4e35) + 1) >>> 0;
    }
    let cx = 0xffff;
    let di = 0x8000;
    for (let si = 0; si < 16; si++) {
      const k = si * 11 + 3;
      this.tab[k] = (this.tab[k]! & cx) | di;
      cx >>= 1;
      di >>= 1;
    }
  }
  raw(): number {
    if (!this.started) this.seed(1);
    const j = this.idx;
    const other = j >= 0x93 ? j - 0x93 : j + 0x67;
    const v = (this.tab[j]! ^ this.tab[other]!) & 0xffff;
    this.tab[j] = v;
    this.idx = j >= 0xf9 ? 0 : j + 1;
    return v;
  }
  rnd(lo: number, hi: number): number {
    const range = hi - lo + 1;
    const r = this.raw();
    return range <= 0 ? lo : lo + (r % range);
  }
}

interface Win {
  buf: Uint8Array;
  stride: number;
  /** pane origin / size inside the buffer */
  ox: number; oy: number; w: number; h: number;
  /** clip, absolute page x */
  cx1: number; cx2: number;
}

export class DhEngine {
  readonly pack: DhPack;
  private sys!: ObjectSystem;
  private wins = new Map<number, Win>();
  private nextWin = 2;
  private shapeCache = new Map<string, Shape | null>();
  private rng = new R250();
  readonly dac = new Uint8Array(256 * 3);
  private feaRecords: Uint8Array = new Uint8Array(0);
  private feaPos = 0;
  /** registered `notify` timers, "object:message" */
  private timers = new Set<string>();
  private dungeon!: DungeonPack;
  private settingsFile: Uint8Array = new Uint8Array(0);
  private filePos = 0;
  level = 0;
  lvlmap = new Uint8Array(1024);
  /** runtime functions that were stubbed to 0 (diagnostics) */
  readonly stubbed = new Map<string, number>();
  trace: string[] | null = null;

  constructor(pack: DhPack) {
    this.pack = pack;
  }

  private cls(name: string): number { return this.sys.classByName(name); }
  private field(obj: number, cls: string, tag: string): number {
    const c = this.sys.classes.get(this.cls(cls))!;
    const off = c.exportedVars.get(tag)!;
    return this.sys.field(obj, c.number, off, tag[0] === 'W' ? 2 : tag[0] === 'L' ? 4 : 1);
  }
  private setField(obj: number, cls: string, tag: string, v: number): void {
    const c = this.sys.classes.get(this.cls(cls))!;
    const off = c.exportedVars.get(tag)!;
    this.sys.setField(obj, c.number, off, tag[0] === 'W' ? 2 : tag[0] === 'L' ? 4 : 1, v);
  }

  // ---------------------------------------------------------------- graphics
  private makePage(): Win {
    return { buf: new Uint8Array(PAGE_W * PAGE_H), stride: PAGE_W, ox: 0, oy: 0, w: PAGE_W, h: PAGE_H, cx1: 0, cx2: PAGE_W - 1 };
  }
  private setPalette(region: number, resId: number): void {
    const p = this.pack.palettes[String(resId)];
    if (!p) return;
    const first = this.pack.natives.first_color[region * 2]! | (this.pack.natives.first_color[region * 2 + 1]! << 8);
    p.colors.forEach((c, i) => {
      const at = (first + i) * 3;
      if (at + 2 < this.dac.length) { this.dac[at] = c[0]!; this.dac[at + 1] = c[1]!; this.dac[at + 2] = c[2]!; }
    });
  }
  private shape(table: number, n: number): Shape | null {
    const key = `${table}:${n}`;
    if (this.shapeCache.has(key)) return this.shapeCache.get(key)!;
    const e = this.pack.bitmapIndex[String(table)];
    let s: Shape | null = null;
    if (e && n >= 0 && n < e.shapes) {
      try { s = decodeOldShape(this.pack.bitmaps.subarray(e.offset, e.offset + e.size), n); } catch { s = null; }
    }
    this.shapeCache.set(key, s);
    return s;
  }
  /** Blit a shape at absolute page (x, y), clipped to the pane. `scale` 0 = 1:1; flip bit0 = X, bit1 = Y. */
  private blit(win: Win, table: number, number: number, x: number, y: number, scale: number, flip: number): void {
    const s = this.shape(table, number);
    if (!s) return;
    let dw = s.w, dh = s.h, ox = x, oy = y;
    if (scale > 0 && scale !== 256) {
      dw = Math.floor((s.w * scale) / 256); dh = Math.floor((s.h * scale) / 256);
      ox += (s.w - dw) >> 1; oy += (s.h - dh) >> 1;
    }
    const x1 = Math.max(win.ox, win.cx1), x2 = Math.min(win.ox + win.w - 1, win.cx2);
    for (let yy = 0; yy < dh; yy++) {
      const py = oy + yy;
      if (py < win.oy || py >= win.oy + win.h) continue;
      let sy = dh === s.h ? yy : Math.floor((yy * s.h) / dh);
      if (flip & 2) sy = s.h - 1 - sy;
      for (let xx = 0; xx < dw; xx++) {
        const px = ox + xx;
        if (px < x1 || px > x2) continue;
        let sx = dw === s.w ? xx : Math.floor((xx * s.w) / dw);
        if (flip & 1) sx = s.w - 1 - sx;
        const si = sy * s.w + sx;
        if (s.mask[si]) win.buf[py * win.stride + px] = s.pixels[si]!;
      }
    }
  }

  // ------------------------------------------------------- native view code
  /** init_viewspace, AESOP.EXE 0f36:040f: the 18 view cells (3 rows deep, 7/5/3/... wide). */
  private initViewspace(x: number, y: number, fdir: number, vx: Uint8Array, vxAt: number, vy: Uint8Array, vyAt: number): void {
    const t = this.pack.natives.viewspace;
    const T = (tab: number): number => s8(t[tab * 8 + fdir]!);
    const F = T(0), D = T(1), E = T(2), C = T(3), A = T(4), B = T(5); // [10eb],[10f3],[10fb],[1103],[110b],[1113]
    const fill = (out: Uint8Array, at: number, base: number, f: number, a: number, b: number): void => {
      const set = (i: number, v: number): void => { out[at + i] = v & 0xff; };
      let cl = base + 3 * f;
      set(0, cl + 3 * a); set(1, cl + 2 * a); set(2, cl + a); set(3, cl);
      set(4, cl + b); set(5, cl + 2 * b); set(6, cl + 3 * b);
      cl = base + 2 * f;
      set(7, cl + 2 * a); set(8, cl + a); set(9, cl); set(10, cl + b); set(11, cl + 2 * b);
      cl = base + f;
      set(12, cl + a); set(13, cl); set(14, cl + b);
      set(15, base + a); set(16, base); set(17, base + b);
    };
    fill(vy, vyAt, y, C, A, B);
    fill(vx, vxAt, x, F, D, E);
  }

  /** build_clipping, AESOP.EXE 0f36:05f4. */
  private buildClipping(m: { l: [Uint8Array, number]; r: [Uint8Array, number]; vis: [Uint8Array, number]; vx: [Uint8Array, number];
    vy: [Uint8Array, number]; nb: [Uint8Array, number]; lvlvis: [Uint8Array, number]; floor: [Uint8Array, number] }): void {
    const clip = this.pack.natives.clip;
    const rdw = (p: [Uint8Array, number], i: number): number => p[0][p[1] + 2 * i]! | (p[0][p[1] + 2 * i + 1]! << 8);
    const wrw = (p: [Uint8Array, number], i: number, v: number): void => { p[0][p[1] + 2 * i] = v & 0xff; p[0][p[1] + 2 * i + 1] = (v >> 8) & 0xff; };
    for (let si = 0; si < 18; si++) {
      wrw(m.l, si, 0);
      wrw(m.r, si, 0xaf);
      m.vis[0][m.vis[1] + si] = 0;
      m.vx[0][m.vx[1] + si]! &= 0x1f;
      m.vy[0][m.vy[1] + si]! &= 0x1f;
      if (s8(clip[si * 18 + 16]!) === 0x7e) continue;
      const cx = m.vx[0][m.vx[1] + si]!;
      const cy = m.vy[0][m.vy[1] + si]!;
      m.vis[0][m.vis[1] + si] = 1;
      for (let j = 0; j < 18; j++) {
        if (s8(m.nb[0][m.nb[1] + j]!) > 1) continue;
        const di = s8(clip[si * 18 + j]!);
        if (di === 0x7f) continue;
        if (di === 0x7e) { m.vis[0][m.vis[1] + si] = 0; break; }
        if (di < 0 && (-di << 3) > rdw(m.l, si)) wrw(m.l, si, -di << 3);
        if (di > 0 && (di << 3) - 1 < rdw(m.r, si)) wrw(m.r, si, (di << 3) - 1);
        if (rdw(m.l, si) > rdw(m.r, si)) { m.vis[0][m.vis[1] + si] = 0; break; }
      }
      if (m.vis[0][m.vis[1] + si]) {
        const at = m.lvlvis[1] + (cy << 5) + cx;
        m.lvlvis[0][at] = (m.lvlvis[0][at]! | 1) & 0xfb;
      }
    }
    for (let si = 0; si < 18; si++) {
      m.floor[0][m.floor[1] + si] = m.vis[0][m.vis[1] + si] && m.nb[0][m.nb[1] + si] ? 1 : 0;
    }
  }

  /** draw_walls, AESOP.EXE 0f36:0785: 25 slots far -> near, shape from `wall_shape[type*26+slot]`. */
  private drawWalls(x: number, y: number, fdir: number, win: Win, wallset: number, lvlmapAt: [Uint8Array, number], floorAt: [Uint8Array, number]): void {
    const n = this.pack.natives;
    for (let k = 0; k < 25; k++) {
      const cx = s8((x + s8(n.wall_dx[fdir * 26 + k]!)) & 0xff);
      const cy = s8((y + s8(n.wall_dy[fdir * 26 + k]!)) & 0xff);
      const idx = (cy << 5) + cx; // signed, may read the byte range before lvlmap (the game does too)
      const at = lvlmapAt[1] + idx;
      const cell = at >= 0 && at < lvlmapAt[0].length ? lvlmapAt[0][at]! : 0;
      if (cell === 0xff) continue;
      if (!floorAt[0][floorAt[1] + n.wall_visidx[k]!]) continue;
      let shape = s8(n.wall_shape[cell * 26 + k] ?? 0);
      let flip = s8(n.wall_flip[k]!);
      if (shape === 0xe) { shape = 0xd; flip ^= 1; } else if (shape === 0xf) { shape = 8; flip ^= 1; } else if (shape === 0x11) { shape = 0x10; flip ^= 1; }
      const px = (n.wall_x[k * 2]! | (n.wall_x[k * 2 + 1]! << 8)) << 16 >> 16;
      const py = (n.wall_y[k * 2]! | (n.wall_y[k * 2 + 1]! << 8)) << 16 >> 16;
      this.blit(win, wallset, shape, px + 138, py + 13, 0, flip); // 0f36:0b8e adds 0x8a / 0x0d
    }
  }

  // -------------------------------------------------------------- step_X/Y
  private stepAxis(v: number, fdir: number, mtype: number, dist: number, axis: 'x' | 'y'): number {
    if (dist === 0) return v;
    const s = this.pack.natives.step; // bytes from DS:10e3
    const at = (a: number): number => s8(s[a - 0x10e3] ?? 0);
    // X uses {10eb, 10f3, 10fb, 10e3}; Y uses {1103, 110b, 1113, 10fb} (0f36:0006 / 0f36:00d0)
    const [t1, t2, t3, tb] = axis === 'x' ? [0x10eb, 0x10f3, 0x10fb, 0x10e3] : [0x1103, 0x110b, 0x1113, 0x10fb];
    let r = v;
    if (mtype === 7) r += at(t1 + fdir) + at(t2 + fdir);
    else if (mtype === 9) r += at(t1 + fdir) + at(t3 + fdir);
    else if (mtype === 8) r += at(t1 + fdir) * 2;
    else if (mtype !== 0) r += at(tb + (mtype << 2) + fdir) * s8(dist);
    return r & 0x1f;
  }

  // ----------------------------------------------------------- runtime fns
  private mem(vm: Interpreter, addr: Value): [Uint8Array, number] | null {
    const m = vm.resolveAddr(addr);
    return m ? [m.buf, m.at] : null;
  }

  private runtime = (vm: Interpreter, name: string, a: Value[]): Value => {
    if (this.trace) this.trace.push(`${name}(${a.join(',')})`);
    switch (name) {
      case 'rnd': return this.rng.rnd(a[0]!, a[1]!);
      case 'dice': { let t = a[2] ?? 0; for (let i = 0; i < a[0]!; i++) t += this.rng.rnd(1, a[1]!); return t; }
      case 'seed_random': this.rng.seed(a[0]!); return 0;
      case 'absv': return Math.abs(a[0]!);
      case 'minv': return Math.min(a[0]!, a[1]!);
      case 'maxv': return Math.max(a[0]!, a[1]!);
      case 'randomize_array': {
        const m = this.mem(vm, a[0]!);
        if (m) { const n = a[1]!; for (let i = 0; i < n; i++) m[0][m[1] + i] = i; for (let i = n - 1; i > 0; i--) { const j = this.rng.rnd(0, i); const t = m[0][m[1] + i]!; m[0][m[1] + i] = m[0][m[1] + j]!; m[0][m[1] + j] = t; } }
        return 0;
      }
      case 'assign_window': {
        const w = a[3]! - a[1]! + 1, h = a[4]! - a[2]! + 1;
        const id = this.nextWin++;
        this.wins.set(id, { buf: new Uint8Array(w * h), stride: w, ox: 0, oy: 0, w, h, cx1: 0, cx2: w - 1 });
        return id;
      }
      case 'assign_subwindow': {
        const parent = this.wins.get(a[1]!);
        if (!parent) return 0;
        const w = a[4]! - a[2]! + 1, h = a[5]! - a[3]! + 1;
        const id = this.nextWin++;
        this.wins.set(id, { buf: parent.buf, stride: parent.stride, ox: a[2]!, oy: a[3]!, w, h, cx1: a[2]!, cx2: a[2]! + w - 1 });
        return id;
      }
      case 'release_window': this.wins.delete(a[0]!); return 0;
      case 'set_x1': { const w = this.wins.get(a[0]!); if (w) w.cx1 = a[1]!; return 0; }
      case 'set_x2': { const w = this.wins.get(a[0]!); if (w) w.cx2 = a[1]!; return 0; }
      case 'wipe_window': {
        const w = this.wins.get(a[0]!);
        if (w) for (let y = 0; y < w.h; y++) w.buf.fill(a[1] ?? 0, (w.oy + y) * w.stride + w.ox, (w.oy + y) * w.stride + w.ox + w.w);
        return 0;
      }
      case 'copy_window': {
        const s = this.wins.get(a[0]!), d = this.wins.get(a[1]!);
        if (s && d) for (let y = 0; y < Math.min(s.h, d.h); y++) {
          const so = (s.oy + y) * s.stride + s.ox, dof = (d.oy + y) * d.stride + d.ox;
          d.buf.set(s.buf.subarray(so, so + Math.min(s.w, d.w)), dof);
        }
        return 0;
      }
      case 'draw_bitmap': {
        const w = this.wins.get(a[0]!);
        if (w) this.blit(w, a[1]!, a[2]!, a[3]!, a[4]!, a[5] ?? 0, a[6] ?? 0);
        return 0;
      }
      case 'set_palette': this.setPalette(a[0]!, a[1]!); return 0;
      case 'step_X': return this.stepAxis(a[0]!, a[1]!, a[2]!, a[3]!, 'x');
      case 'step_Y': return this.stepAxis(a[0]!, a[1]!, a[2]!, a[3]!, 'y');
      case 'step_FDIR': return mtypeFdir(a[0]!, a[1]!);
      case 'init_viewspace': {
        const vx = this.mem(vm, a[3]!), vy = this.mem(vm, a[4]!);
        if (vx && vy) this.initViewspace(a[0]!, a[1]!, a[2]!, vx[0], vx[1], vy[0], vy[1]);
        return 0;
      }
      case 'build_clipping': {
        const p = a.map((v) => this.mem(vm, v));
        if (p.every((v) => v)) this.buildClipping({ l: p[0]!, r: p[1]!, vis: p[2]!, vx: p[3]!, vy: p[4]!, nb: p[5]!, lvlvis: p[6]!, floor: p[7]! });
        return 0;
      }
      case 'draw_walls': {
        const win = this.wins.get(a[3]!), lm = this.mem(vm, a[5]!), fl = this.mem(vm, a[6]!);
        if (win && lm && fl) this.drawWalls(a[0]!, a[1]!, a[2]!, win, a[4]!, lm, fl);
        return 0;
      }
      case 'load_level_map': {
        // (lvlmap*, level): level -1 only returns the dungeon seed
        const lvl = a[1]!;
        if (lvl >= 0) { const m = this.mem(vm, a[0]!); const lv = this.dungeon.levels[lvl]; if (m && lv) m[0].set(b64(lv.lvlmap), m[1]); }
        return this.dungeon.seed | 0;
      }
      case 'open_feature_file': {
        const lvl = a[0]!;
        this.feaRecords = lvl < 0 ? b64(this.dungeon.items) : b64(this.dungeon.levels[lvl]?.fea ?? '');
        this.feaPos = 0;
        return 0;
      }
      case 'get_feature_record': {
        const m = this.mem(vm, a[0]!);
        if (m) for (let i = 0; i < 8; i++) m[0][m[1] + i] = this.feaRecords[this.feaPos + i] ?? 0;
        this.feaPos += 8;
        return 0;
      }
      case 'close_feature_file': return 0;
      case 'load_visibility': case 'save_visibility': return 0;
      case 'create_program': case 'create_object': {
        const [idx, cn] = name === 'create_program' ? [a[0]!, a[1]!] : [-1, a[0]!];
        if (!this.sys.classes.has(cn)) return -1;
        let h = idx;
        if (h < 0) { h = 1000; while (this.sys.classOf(h) >= 0) h++; }
        this.sys.allocAt(h, cn);
        this.sys.send(h, MSG_CREATE, []);
        return h;
      }
      case 'destroy_object': this.sys.destroy(a[0]!); return 0;
      case 'notify': if (/door/.test(this.classNameOf(a[0]!))) this.timers.add(`${a[0]}:${a[1]}`); return 0; // only door animations are pumped (NPC/spell timers are not wired) // (object, message, period, count): pumped by tickTimers
      case 'cancel': this.timers.delete(`${a[0]}:${a[1]}`); return 0;
      case 'open_file': { this.filePos = 0; return 1; }
      case 'read_array_from_file': {
        const m = this.mem(vm, a[0]!);
        if (m) for (let i = 0; i < a[1]!; i++) m[0][m[1] + i] = this.settingsFile[this.filePos + i] ?? 0;
        this.filePos += a[1]!;
        return 0;
      }
      case 'read_number_from_file': {
        let v = 0;
        for (let i = a[0]! - 1; i >= 0; i--) v = v * 256 + (this.settingsFile[this.filePos + i] ?? 0);
        this.filePos += a[0]!;
        return v | 0;
      }
      default:
        this.stubbed.set(name, (this.stubbed.get(name) ?? 0) + 1);
        return 0;
    }
  };

  // ------------------------------------------------------------- level load
  loadLevel(dungeon: number, level: number): void {
    this.dungeon = this.pack.dungeons[dungeon]!;
    this.level = level;
    const sys = (this.sys = new ObjectSystem());
    for (const c of this.pack.classes) sys.addClass(decodeClassJson(c));
    sys.runtimeFn = this.runtime;
    this.dac.fill(0);
    this.setPalette(0, 204); // "Fixed palette"
    this.wins.clear();
    this.wins.set(0, this.makePage());
    this.wins.set(1, this.makePage());
    this.nextWin = 2;
    this.shapeCache.clear();
    this.timers.clear();
    this.rng.seed(this.dungeon.seed);
    // SAVEGAME\SETTINGS.DAT (seed + 12 setting nibbles + 11 tail bytes as installed)
    const st = new Uint8Array(27);
    st.set([this.dungeon.seed & 255, (this.dungeon.seed >> 8) & 255, (this.dungeon.seed >> 16) & 255, (this.dungeon.seed >>> 24) & 255]);
    st.set(this.dungeon.settings, 4);
    this.settingsFile = st;
    sys.allocAt(OBJ_KERNEL, sys.classByName('kernel'));
    sys.allocAt(OBJ_DUNGEON, sys.classByName('dungeon'));
    sys.allocAt(OBJ_CAMP, sys.classByName('camp'));
    sys.allocAt(2004, 1977); // kernel `enter game` creates class 1977 at 2004 (item-use / explosion helper)
    // phase-two `create` instantiates `magic` (2005) and `tables` (2003) before the kernel
    sys.allocAt(2005, sys.classByName('magic'));
    sys.send(2005, MSG_CREATE, []);
    sys.allocAt(2003, sys.classByName('tables'));
    sys.send(2003, MSG_CREATE, []);
    sys.send(OBJ_KERNEL, MSG_CREATE, []);
    sys.send(OBJ_DUNGEON, MSG_CREATE, []);
    this.setField(OBJ_KERNEL, 'kernel', 'B:party_lvl', level);
    sys.send(OBJ_DUNGEON, MSG_INIT_WHOLE_DUNGEON, []);
    this.setField(OBJ_KERNEL, 'kernel', 'B:party_lvl', level);
    sys.send(OBJ_DUNGEON, MSG_LOAD_LEVEL, [level]);
    sys.send(OBJ_DUNGEON, MSG_INIT_LEVEL, []);
    const dg = sys.staticsOf(OBJ_DUNGEON)!;
    const lmOff = sys.classes.get(sys.classByName('dungeon'))!.exportedVars.get('B:lvlmap')!;
    this.lvlmap = dg.slice(lmOff, lmOff + 1024);
  }

  get view(): Win { return this.wins.get(this.viewHandle())!; }
  private viewHandle(): number { return this.field(OBJ_DUNGEON, 'dungeon', 'W:view'); }

  /** Draw one frame (kernel `draw view`, minus HUD) and return the 176x120 palette-index view. */
  frame(x: number, y: number, fdir: number, floorflip = 0): Uint8Array {
    const sys = this.sys;
    this.setField(OBJ_KERNEL, 'kernel', 'B:party_x', x);
    this.setField(OBJ_KERNEL, 'kernel', 'B:party_y', y);
    this.setField(OBJ_KERNEL, 'kernel', 'B:party_fdir', fdir);
    const v = this.view;
    for (let r = 0; r < v.h; r++) v.buf.fill(0, (v.oy + r) * v.stride + v.ox, (v.oy + r) * v.stride + v.ox + v.w);
    v.cx1 = v.ox; v.cx2 = v.ox + v.w - 1;
    sys.send(OBJ_DUNGEON, MSG_INIT_VIEWSPACE, [x, y, fdir]);
    sys.send(OBJ_DUNGEON, MSG_DRAW_FLOOR, [floorflip]);
    v.cx1 = v.ox; v.cx2 = v.ox + v.w - 1;
    sys.send(OBJ_DUNGEON, MSG_DRAW_WALLS, []);
    sys.send(OBJ_DUNGEON, MSG_DRAW_OBJECTS, [0]);
    const out = new Uint8Array(VIEW_W * VIEW_H);
    for (let r = 0; r < VIEW_H; r++) out.set(v.buf.subarray((v.oy + r) * v.stride + v.ox, (v.oy + r) * v.stride + v.ox + VIEW_W), r * VIEW_W);
    return out;
  }

  /** Deliver one tick to every registered `notify` timer (door animations etc.); true if any ran. */
  tickTimers(): boolean {
    const keys = [...this.timers];
    for (const k of keys) {
      const [o, m] = k.split(':').map(Number);
      this.sys.send(o!, m!, []);
    }
    return keys.length > 0;
  }
  /** Send `toggle` (doors, levers, buttons) to every feature in a cell. Returns how many objects handled it. */
  useCell(x: number, y: number): number {
    const ids = this.cellObjects(x, y, 0);
    for (const id of ids) this.sys.send(id, 273, []);
    return ids.length;
  }
  isOpen(x: number, y: number): boolean { return this.lvlmap[(y & 31) * 32 + (x & 31)] === 0xff; }
  /** dungeon `impedance`(mover=kernel, x, y): -1 wall, -2 special event, >= 0 passable (kernel `step`). */
  impedance(x: number, y: number): number { return this.sys.send(OBJ_DUNGEON, MSG_IMPEDANCE, [OBJ_KERNEL, x, y]); }
  stepTo(x: number, y: number, fdir: number, mtype: 2 | 4 | 5 | 6): { x: number; y: number } {
    return { x: this.stepAxis(x, fdir, mtype, 1, 'x'), y: this.stepAxis(y, fdir, mtype, 1, 'y') };
  }
  party(): { x: number; y: number; fdir: number } {
    return { x: this.field(OBJ_KERNEL, 'kernel', 'B:party_x'), y: this.field(OBJ_KERNEL, 'kernel', 'B:party_y'), fdir: this.field(OBJ_KERNEL, 'kernel', 'B:party_fdir') };
  }
  /** Object ids of one plane (0 features / 1 items / 2 monsters) in a cell. */
  cellObjects(x: number, y: number, plane = 0): number[] {
    const out: number[] = [];
    const lo = this.sys.classes.get(this.sys.classByName('dungeon'))!.exportedVars.get('W:lvlobj')!;
    const dg = this.sys.staticsOf(OBJ_DUNGEON)!;
    const at = lo + 2 * (plane * 1024 + y * 32 + x);
    let id = s16(dg[at]! | (dg[at + 1]! << 8));
    for (let g = 0; id !== -1 && g < 50; g++) { out.push(id); id = s16(this.field(id, 'entities', 'W:next')); }
    return out;
  }
  /** The level's own entry pose: first FEAnn.DAT record (type 0: x, y, facing) = the cell beside the up stairs. */
  entry(): { x: number; y: number; fdir: number } {
    const f = b64(this.dungeon.levels[this.level]!.fea);
    return { x: f[1]!, y: f[2]!, fdir: f[3]! };
  }
  /** `level teleporter` destination (x, y, level, facing) of a feature object, or null. */
  teleportOf(id: number): { x: number; y: number; level: number; fdir: number } | null {
    if (this.classNameOf(id) !== 'level teleporter') return null;
    const g = (t: string): number => this.field(id, 'teleporters', t);
    return { x: g('B:dest_x'), y: g('B:dest_y'), level: g('B:dest_lvl'), fdir: g('B:dest_fdir') };
  }
  classNameOf(id: number): string { return this.sys.classes.get(this.sys.classOf(id))?.name ?? '?'; }
  objectCount(): number { let n = 0; for (let i = 0; i < 2000; i++) if (this.sys.classOf(i) >= 0) n++; return n; }
  rgb(i: number): [number, number, number] { return [this.dac[i * 3]!, this.dac[i * 3 + 1]!, this.dac[i * 3 + 2]!]; }
  reportOf(obj: number, arg = 0): number { return this.sys.send(obj, MSG_REPORT, [arg]); }
}

const s16 = (v: number): number => (v << 16) >> 16;

/** step_FDIR (0f36:019a): facing after a turn; mtype 1/3 = turn left/right is not needed by the walker. */
function mtypeFdir(fdir: number, mtype: number): number {
  if (mtype === 1) return (fdir + 3) & 3;
  if (mtype === 3) return (fdir + 1) & 3;
  return fdir & 3;
}
