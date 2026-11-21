/**
 * EOB3 dungeon-view engine: runs the game's own AESOP/16 `dungeon`,
 * `features`, `doors`, ... class bytecode (via `tools/aesop/vm.ts`) to
 * produce the per-frame `draw_bitmap` list, then composites it into a
 * 176x120 indexed buffer. draw_bitmap/set_x1/set_x2/set_palette semantics are
 * the AESOP/16 runtime natives; level objects follow the game's own
 * `load_range` (INTERP.EXE vaddr 0x137d0). See docs/eotb3/dosvga/data-structure.md sec 10.
 */
import { ObjectSystem, decodeClassJson, type Interpreter, type Value } from '../aesop/vm.ts';

export const VIEW_W = 176;
export const VIEW_H = 120;

const KERNEL = 1382, DUNGEON = 1381, CAMP = 1385, ENTITIES = 1370, NPC = 1622;
const OBJ_KERNEL = 0, OBJ_DUNGEON = 2001, OBJ_CAMP = 2002, OBJ_AREA = 2010;
const MSG_RESTORE = 2, MSG_ENTER_LEVEL = 256, MSG_INIT_VIEWSPACE = 222,
  MSG_DRAW_FLOOR = 223, MSG_DRAW_WALLS = 224, MSG_DRAW_OBJECTS = 225;
/** Per-palette-region first DAC colour (PAL_FIXED, WALLS, M1, M2, OUT): the u16[5]
 *  table at INTERP.EXE vaddr 0x30fb8 (file+0x253b8), read by the palette routine at
 *  0x16884 (`mov di,[region*2+0xfb8]`). Verified by scripts/verify_eotb3_step_tables.py. */
const FIRST_COLOR = [0x00, 0xb0, 0xc0, 0xe0, 0xb0];

export interface WalkerPack {
  classes: Array<Parameters<typeof decodeClassJson>[0]>;
  levels: Array<{ level: number; name: string; area: string; lvlmap: number[]; records: Array<{ slot: number; cls: number; statics: string }> }>;
  palettes: Record<string, { name: string; colors: number[][] }>;
  vfxIndex: Record<string, { name: string; offset: number; size: number; shapes: number }>;
  vfx: Uint8Array;
}

export interface DrawCall {
  table: number;
  number: number;
  x: number;
  y: number;
  scale: number;
  flip: number;
  clipX1: number;
  clipX2: number;
}

export interface Shape { w: number; h: number; pixels: Uint8Array; mask: Uint8Array }

/** Decode one shape of a "1.10" VFX table (same as scripts/eotb3lib/bitmap.py). */
export function decodeVfxShape(b: Uint8Array, index: number): Shape {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = dv.getUint32(8 + index * 8, true);
  const h = dv.getUint16(off, true) + 1;
  const w = dv.getUint16(off + 2, true) + 1;
  const pixels = new Uint8Array(w * h), mask = new Uint8Array(w * h);
  let pos = off + 24;
  for (let y = 0; y < h && pos < b.length; y++) {
    let x = 0;
    while (pos < b.length) {
      const m = b[pos++]!;
      if (m === 0) break;
      if (m === 1) { x += b[pos++]!; continue; }
      const n = m >> 1;
      if (m & 1) {
        for (let i = 0; i < n; i++, x++) if (x < w) { pixels[y * w + x] = b[pos]!; mask[y * w + x] = 1; pos++; } else pos++;
      } else {
        const px = b[pos++]!;
        for (let i = 0; i < n; i++, x++) if (x < w) { pixels[y * w + x] = px; mask[y * w + x] = 1; }
      }
    }
  }
  return { w, h, pixels, mask };
}

export class Eotb3Engine {
  private sys!: ObjectSystem;
  private draws: DrawCall[] = [];
  private clip = [0, VIEW_W - 1];
  private nextWindow = 1;
  private shapeCache = new Map<string, Shape>();
  readonly dac = new Uint8Array(256 * 3);
  wallset = 0;
  level = 0;
  lvlmap = new Uint8Array(1024);
  /** runtime functions hit that we stub to 0 (diagnostics) */
  readonly stubbed = new Map<string, number>();
  objectCount = 0;

  readonly pack: WalkerPack;
  constructor(pack: WalkerPack) {
    this.pack = pack;
  }

  private setPalette(region: number, resId: number): void {
    const p = this.pack.palettes[String(resId)];
    if (!p) return;
    const first = FIRST_COLOR[region] ?? 0;
    p.colors.forEach((c, i) => {
      const at = (first + i) * 3;
      if (at + 2 < this.dac.length) { this.dac[at] = c[0]!; this.dac[at + 1] = c[1]!; this.dac[at + 2] = c[2]!; }
    });
  }

  private runtime = (_vm: Interpreter, name: string, a: Value[]): Value => {
    switch (name) {
      case 'draw_bitmap':
        this.draws.push({ table: a[1]!, number: a[2]!, x: a[3]!, y: a[4]!, scale: a[5] ?? 0, flip: a[6] ?? 0, clipX1: this.clip[0]!, clipX2: this.clip[1]! });
        return 0;
      case 'set_x1': this.clip[0] = a[1]!; return 0;
      case 'set_x2': this.clip[1] = a[1]!; return 0;
      case 'assign_subwindow': return this.nextWindow++;
      case 'set_palette': this.setPalette(a[0]!, a[1]!); return 0;
      case 'rnd': return Math.min(a[0] ?? 0, a[1] ?? 0);
      default:
        this.stubbed.set(name, (this.stubbed.get(name) ?? 0) + 1);
        return 0;
    }
  };

  loadLevel(level: number): void {
    const L = this.pack.levels.find((l) => l.level === level);
    if (!L) throw new Error(`no level ${level}`);
    this.level = level;
    const sys = (this.sys = new ObjectSystem());
    for (const c of this.pack.classes) sys.addClass(decodeClassJson(c));
    sys.runtimeFn = this.runtime;
    this.dac.fill(0);
    this.setPalette(0, 335); // "Fixed palette"
    this.nextWindow = 1;
    sys.allocAt(OBJ_KERNEL, KERNEL);
    sys.allocAt(OBJ_DUNGEON, DUNGEON);
    sys.allocAt(OBJ_CAMP, CAMP);
    sys.send(OBJ_DUNGEON, 0, []); // create: view/scrn windows, item_render...
    this.lvlmap = Uint8Array.from(L.lvlmap);
    const dg = sys.staticsOf(OBJ_DUNGEON)!;
    dg.set(this.lvlmap, 0); // lvlmap@0 (dungeon is a root class)
    dg.fill(0xff, 1024, 1024 + 3 * 2048); // lvlobj grid empty
    // area class enters the level: sets wallset (extern store) + palettes
    sys.allocAt(OBJ_AREA, sys.classByName(L.area));
    try { sys.send(OBJ_AREA, MSG_ENTER_LEVEL, []); } catch { /* init-events etc. not needed */ }
    this.wallset = sys.field(OBJ_DUNGEON, DUNGEON, 7168, 4);
    this.setField(OBJ_KERNEL, KERNEL, 'B:party_lvl', level);
    this.objectCount = this.placeObjects(L);
  }

  private setField(obj: number, cls: number, tag: string, v: number): void {
    const off = this.sys.classes.get(cls)!.exportedVars.get(tag)!;
    this.sys.setField(obj, cls, off, tag[0] === 'W' ? 2 : tag[0] === 'L' ? 4 : 1, v);
  }

  /** The game's `load_range` (INTERP.EXE 0x137d0): per slot allocate the class object, copy the
   *  record's statics verbatim at object+4 (0x13980-0x13989), then send message 2 (restore;
   *  0x1399a). The lvlobj cell-chain relink below is the walker's stand-in for that restore
   *  handler's work (the handlers need the full runtime) -- not game-verified. */
  private placeObjects(L: WalkerPack['levels'][number]): number {
    const sys = this.sys;
    let placed = 0;
    for (const r of L.records) {
      const st = Uint8Array.from(atob(r.statics), (c) => c.charCodeAt(0));
      const x = st[2]!, y = st[3]!;
      if (x > 31 || y > 31 || !sys.classes.has(r.cls)) continue;
      sys.allocAt(r.slot, r.cls);
      const dst = sys.staticsOf(r.slot)!;
      dst.set(st.subarray(0, Math.min(st.length, dst.length)));
      sys.setField(r.slot, ENTITIES, 0, 2, x + y * 32); // place
      sys.setField(r.slot, ENTITIES, 4, 1, L.level);
      sys.setField(r.slot, ENTITIES, 6, 2, 0xffff);
      sys.setField(r.slot, ENTITIES, 8, 2, 0xffff);
      const plane = sys.isSubclassOf(r.cls, NPC) ? 4096 : 0;
      const cell = sys.classStatics(OBJ_DUNGEON, DUNGEON, 1024 + plane + y * 64 + x * 2, 2)!;
      let head = cell.b[cell.at]! | (cell.b[cell.at + 1]! << 8);
      if (head === 0xffff) { cell.b[cell.at] = r.slot & 0xff; cell.b[cell.at + 1] = r.slot >> 8; }
      else {
        let tail = head;
        for (let g = 0; g < 1000; g++) {
          const nx = sys.field(tail, ENTITIES, 6, 2);
          if (nx === 0xffff) break;
          tail = nx;
        }
        sys.setField(tail, ENTITIES, 6, 2, r.slot);
        sys.setField(r.slot, ENTITIES, 8, 2, tail);
      }
      try { sys.send(r.slot, MSG_RESTORE, []); } catch { /* restore hooks need the full runtime */ }
      placed++;
    }
    return placed;
  }

  /** Run one dungeon-view frame (kernel `draw view`, minus HUD) and return the draw list. */
  drawList(x: number, y: number, facing: number): DrawCall[] {
    const sys = this.sys;
    this.setField(OBJ_KERNEL, KERNEL, 'B:party_x', x);
    this.setField(OBJ_KERNEL, KERNEL, 'B:party_y', y);
    this.setField(OBJ_KERNEL, KERNEL, 'B:party_fdir', facing);
    this.draws = [];
    this.clip = [0, VIEW_W - 1];
    sys.send(OBJ_DUNGEON, MSG_INIT_VIEWSPACE, [x, y, facing]);
    sys.send(OBJ_DUNGEON, MSG_DRAW_FLOOR, [0]);
    this.clip = [0, VIEW_W - 1];
    sys.send(OBJ_DUNGEON, MSG_DRAW_WALLS, []);
    sys.send(OBJ_DUNGEON, MSG_DRAW_OBJECTS, [0]);
    return this.draws;
  }

  private shape(table: number, n: number): Shape | null {
    const key = `${table}:${n}`;
    let s = this.shapeCache.get(key);
    if (s) return s;
    const e = this.pack.vfxIndex[String(table)];
    if (!e || n < 0 || n >= e.shapes) return null;
    s = decodeVfxShape(this.pack.vfx.subarray(e.offset, e.offset + e.size), n);
    this.shapeCache.set(key, s);
    return s;
  }

  /** Composite a draw list to a 176x120 palette-index buffer (0 = untouched/black). */
  composite(draws: DrawCall[]): Uint8Array {
    const out = new Uint8Array(VIEW_W * VIEW_H);
    for (const d of draws) {
      const s = this.shape(d.table, d.number);
      if (!s) continue;
      let dw = s.w, dh = s.h, ox = d.x, oy = d.y;
      if (d.scale > 0 && d.scale !== 256) {
        dw = Math.floor((s.w * d.scale) / 256); dh = Math.floor((s.h * d.scale) / 256);
        ox += (s.w - dw) >> 1; oy += (s.h - dh) >> 1;
      }
      for (let yy = 0; yy < dh; yy++) {
        const py = oy + yy;
        if (py < 0 || py >= VIEW_H) continue;
        let sy = dh === s.h ? yy : Math.floor((yy * s.h) / dh);
        if (d.flip & 2) sy = s.h - 1 - sy;
        for (let xx = 0; xx < dw; xx++) {
          const px = ox + xx;
          if (px < Math.max(0, d.clipX1) || px > Math.min(VIEW_W - 1, d.clipX2)) continue;
          let sx = dw === s.w ? xx : Math.floor((xx * s.w) / dw);
          if (d.flip & 1) sx = s.w - 1 - sx;
          const si = sy * s.w + sx;
          if (s.mask[si]) out[py * VIEW_W + px] = s.pixels[si]!;
        }
      }
    }
    return out;
  }

  /** The cell value the dungeon's own wall test uses: 0xFF = open, else wall. */
  isOpen(x: number, y: number): boolean {
    return this.lvlmap[(y & 31) * 32 + (x & 31)] === 0xff;
  }

  /** Object ids (features, plane 0) in a cell, for movement/doors. */
  cellObjects(x: number, y: number): number[] {
    const out: number[] = [];
    const c = this.sys.classStatics(OBJ_DUNGEON, DUNGEON, 1024 + y * 64 + x * 2, 2)!;
    let id = c.b[c.at]! | (c.b[c.at + 1]! << 8);
    for (let g = 0; id !== 0xffff && g < 50; g++) { out.push(id); id = this.sys.field(id, ENTITIES, 6, 2); }
    return out;
  }
  classNameOf(id: number): string { return this.sys.classes.get(this.sys.classOf(id))?.name ?? '?'; }
  /** dungeon `impedance`(mover=kernel, x, y): < 0 blocks the party (kernel `step`). */
  impedance(x: number, y: number): number {
    return this.sys.send(OBJ_DUNGEON, 95, [OBJ_KERNEL, x, y]);
  }
  rgb(i: number): [number, number, number] { return [this.dac[i * 3]!, this.dac[i * 3 + 1]!, this.dac[i * 3 + 2]!]; }
}
