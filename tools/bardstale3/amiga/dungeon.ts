/**
 * The Bard's Tale III (Amiga): dungeon level record, move rule and first-person view compositor.
 *
 * Browser-safe (no node imports). Every table the compositor uses is read out of the game's own
 * executable `bard3` by `export-dungeon.ts` (`ViewTables`), not typed in here; the code below is an
 * original re-implementation of the routines those tables feed. Addresses are bard3 flat addresses
 * (CODE hunk at 0, DATA hunk at 0x1eb00, BSS at 0x267b4; file offset = addr + 0x28 for CODE,
 * addr - 0x1eb00 + 0x23c10 for DATA). See docs/bardstale3/amiga/data-structure.md §3.
 *
 * Note: `driver` (the file the brief pointed at) is the title/sound loader; the game program is `bard3`
 * (a 3-hunk HUNK executable, `Thief:driver` is one of its strings).
 *
 * Dungeon record (decoded maps.lo/maps.hi record, loader 0x1cb2):
 *   0x00 name (16 B, high-bit ASCII, 0xff pad)
 *   0x10 flags: bits 0-2 encounter level (0x26947), bit 4 stairs sense (prompt text), bits 6-7 GRP set (+3 into
 *        the filename table at DATA 0x20698: 0/1/2 -> gdung.grp, 3 -> dung.tst); every shipped level uses 0 or 1
 *   0x11 level index inside the dungeon (0x268dc)
 *   0x12..0x19 dungeon index of level 0..7 (0xff = none); map index = dungeon index + 10 (table 0x206ed)
 *   0x1a, 0x1b, 0x1c exit y, x and city map (stairs above level 0, opcode 0 at 0xce4a)
 *   0x1d monster set; 0x1e width W; 0x1f height H; 0x20 / 0x21 signed x / y offset of the level in the
 *        dungeon's shared frame (applied on stair moves, 0xcdf0 + 0x1d6a)
 *   0x22 u16LE offset of the special-square list; 0x24 u16LE[H] offset of row y (stored last row first)
 *   cell = 5 bytes at row[y] + 5x: [0] E | N<<4, [1] W | S<<4 (one wall nibble per face), [2] square flags
 *        (0x80 random encounter, 0x40 portal up, 0x20 portal down, 0x10 fixed encounter, 0x08 darkness),
 *        [3] trap flags (0x01 spinner, 0x10 silence, 0x40 damage, ...), [4] automap bits (0x01 seen, 0x08 visited).
 * Coordinates wrap modulo W / H (0x2d7a). Facing 0..3 = N, E, S, W; forward = (x, y) + (0,1)/(1,0)/(0,-1)/(-1,0)
 * (0x20aa2 / 0x20aaa).
 */

export const VIEW_W = 112;
export const VIEW_H = 88;
export const VIEW_BPR = 56;
export const CELL_BYTES = 5;
/** The 0x55 key passed to the mask builder at 0x0006 (from 0x0aa6): colour 5 is transparent in every piece. */
export const TRANSPARENT = 5;

export interface ViewTables {
  /** 0x20d62 -> 4 x 34 (dx, dy) pairs: view cell k for facing f is (x + dx, y + dy) */
  cellOffsets: Array<Array<[number, number]>>;
  /** 0x20d72: wall nibble -> piece 0..4 (0 = nothing drawn) */
  pieceOfNibble: number[];
  /** 0x20c32: wall nibble -> move class (0 open, 1/2 door, 3/0xff blocked) */
  moveClass: number[];
  /** 0x20d82: light level 0..5 -> first slot drawn */
  startSlot: number[];
  /** 61 slots: 0x20e02 view cell, 0x20e3f nibble shift, 0x20ef6 enable, 0x20e7c x/y (x in bytes), 0x20b6a width-1 (bytes),
   *  0x20be4 GRP directory byte offset, 0x20ba7 scale (64 = 1:1), 0x20dc5 mirror (-1) */
  slotCell: number[];
  slotShift: number[];
  slotEnable: number[];
  slotX: number[];
  slotY: number[];
  slotW: number[];
  slotGrp: number[];
  slotScale: number[];
  slotMirror: number[];
  /** 0x1f238: cell byte 2 bits 5-6 -> pseudo wall word for the ceiling/floor portal slots */
  portalWord: number[];
  /** 0x20fd6 / 0x20fe0: light < 4 blanks `darkLen[l]` bytes of the view from `darkOff[l]` (0x9d9e) */
  darkOff: number[];
  darkLen: number[];
  /** 0x20868: the 16-colour palette the view routine hands to SetRGB4 (0x2bdc -> 0x1268) */
  palette: number[];
}

export interface GrpPiece {
  bpr: number;
  h: number;
  /** raw chunky 4bpp bytes (high nibble = left pixel), bpr*h */
  data: Uint8Array;
}

/** GDUNG.GRP: directory entries 0..7 = pieces (even = side 24x97, odd = front 64x55), 8 / 9 = ceiling / floor halves. */
export interface DungeonArt {
  tables: ViewTables;
  /** GRP directory entries in order; null for an empty placeholder */
  entries: Array<GrpPiece | null>;
}

export interface Special {
  /** 0x7f = any row */
  y: number;
  /** 0xff = any column */
  x: number;
  /** first opcode of the script (high bit = continue flag stripped) */
  op: number;
  /** offset of the script in the record */
  script: number;
  /** opcode 3 (teleport, 0xcff2): y, x, target (bit 7 = city map, else dungeon index) */
  teleport?: { y: number; x: number; target: number };
}

export interface Bt3Level {
  name: string;
  flags: number;
  levelIndex: number;
  links: number[];
  exit: { y: number; x: number; city: number };
  monsterSet: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** w*h*5 bytes, row-major from y = 0 (south) */
  cells: Uint8Array;
  specials: Special[];
}

const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const s8 = (v: number) => (v << 24) >> 24;

export function levelName(rec: Uint8Array): string {
  let s = '';
  for (let k = 0; k < 16 && rec[k] !== 0xff; k++) s += String.fromCharCode(rec[k]! & 0x7f);
  return s.trim();
}

/** Parse a decoded dungeon record (any of the 61 non-city maps). */
export function parseLevel(rec: Uint8Array): Bt3Level {
  const w = rec[0x1e]!;
  const h = rec[0x1f]!;
  if (!w || !h) throw new Error('not a dungeon record');
  const cells = new Uint8Array(w * h * CELL_BYTES);
  for (let y = 0; y < h; y++) {
    const ro = u16le(rec, 0x24 + 2 * y);
    if (ro + w * CELL_BYTES > rec.length) throw new Error(`row ${y} offset ${ro} out of range`);
    cells.set(rec.subarray(ro, ro + w * CELL_BYTES), y * w * CELL_BYTES);
  }
  const specials: Special[] = [];
  const so = u16le(rec, 0x22);
  const n = rec[so]!;
  for (let i = 0; i < n; i++) {
    const e = so + 1 + 4 * i;
    const script = u16le(rec, e + 2);
    const op = (rec[script] ?? 0xff) & 0x7f;
    const sp: Special = { y: rec[e]!, x: rec[e + 1]!, op, script };
    if (op === 3) sp.teleport = { y: rec[script + 1]!, x: rec[script + 2]!, target: rec[script + 3]! };
    specials.push(sp);
  }
  return {
    name: levelName(rec),
    flags: rec[0x10]!,
    levelIndex: rec[0x11]!,
    links: Array.from(rec.subarray(0x12, 0x1a)),
    exit: { y: rec[0x1a]!, x: rec[0x1b]!, city: rec[0x1c]! },
    monsterSet: rec[0x1d]!,
    w,
    h,
    ox: s8(rec[0x20]!),
    oy: s8(rec[0x21]!),
    cells,
    specials,
  };
}

export const wrap = (v: number, n: number) => ((v % n) + n) % n;

export function cellAt(lv: Bt3Level, x: number, y: number): Uint8Array {
  const o = (wrap(y, lv.h) * lv.w + wrap(x, lv.w)) * CELL_BYTES;
  return lv.cells.subarray(o, o + CELL_BYTES);
}

/** 0x2bf8: the cell's wall word, byte 1 << 8 | byte 0 = S W N E nibbles (bits 12..15, 8..11, 4..7, 0..3). */
export function wallWord(lv: Bt3Level, x: number, y: number): number {
  const c = cellAt(lv, x, y);
  return (c[1]! << 8) | c[0]!;
}

/** 0x01c8: rotate the wall word so the facing's face lands in bits 4-7 (front), left in 8-11, right in 0-3. */
export const rotateWord = (w: number, facing: number) => {
  const r = (facing & 3) * 4;
  return ((w << r) | (w >>> (16 - r))) & 0xffff;
};

/** Absolute face nibble: 0 = N, 1 = E, 2 = S, 3 = W. */
export function faceNibble(lv: Bt3Level, x: number, y: number, face: number): number {
  const w = wallWord(lv, x, y);
  return (w >> [4, 0, 12, 8][face & 3]!) & 15;
}

export const FORWARD_DX = [0, 1, 0, -1];
export const FORWARD_DY = [1, 0, -1, 0];

/**
 * 0x22ba: may the party step through its front face? Class 0 always; door classes 1 and 2 only for the
 * command that passes a non-zero argument (the 0x4b key, kick: 0x2018); the plain forward key (0x4800, 0x20a8)
 * passes 0 and so is stopped by doors. 3 / 0xff block.
 */
export function canPass(tables: ViewTables, lv: Bt3Level, x: number, y: number, facing: number, kick: boolean): boolean {
  const cls = tables.moveClass[faceNibble(lv, x, y, facing)]!;
  if (cls === 0) return true;
  if (cls === 1 || cls === 2) return kick;
  return false;
}

export function stepForward(lv: Bt3Level, x: number, y: number, facing: number): [number, number] {
  return [wrap(x + FORWARD_DX[facing & 3]!, lv.w), wrap(y + FORWARD_DY[facing & 3]!, lv.h)];
}

/**
 * 0x0062: scaled, optionally mirrored, colour-keyed chunky blit into the 56-byte-wide view.
 * Source pixels are decimated by an accumulator: each source pixel subtracts `scale`, and only when the
 * accumulator goes negative (then +64) is it emitted; rows likewise. `wm1` = output bytes - 1 (DBF count);
 * the source stream runs on past the row end exactly like the game's (it is re-based per row only).
 */
export function blit(
  view: Uint8Array,
  src: Uint8Array,
  srcStart: number,
  x: number,
  y: number,
  wm1: number,
  bpr: number,
  h: number,
  scale: number,
  mirror: boolean,
): void {
  if (wm1 === 0) return;
  let rowAcc = 0;
  let rowOff = 0;
  let dy = y;
  const px = (i: number) => {
    const b = src[i] ?? 0;
    return b;
  };
  for (let r = h; r > 0; r--) {
    rowAcc -= scale;
    if (rowAcc < 0) {
      rowAcc += 64;
      if (dy >= 0 && dy < VIEW_H) {
        let acc = 0;
        // Pixel stream: forward = bytes from the row start, high nibble first; mirror = bytes from the row end
        // backwards, still high nibble first, with each emitted pair swapped into the output byte (0x156).
        let p = 0;
        const base = srcStart + rowOff;
        const next = (): number => {
          const b = px(mirror ? base + bpr - 1 - (p >> 1) : base + (p >> 1));
          const v = p & 1 ? b & 15 : b >> 4;
          p++;
          return v;
        };
        const emit = (): number => {
          for (;;) {
            const v = next();
            acc -= scale;
            if (acc < 0) {
              acc += 64;
              return v;
            }
          }
        };
        let d = dy * VIEW_BPR + x;
        for (let k = 0; k <= wm1; k++) {
          const e0 = emit();
          const e1 = emit();
          const hi = mirror ? e1 : e0;
          const lo = mirror ? e0 : e1;
          const old = view[d]!;
          const nh = hi === TRANSPARENT ? old >> 4 : hi;
          const nl = lo === TRANSPARENT ? old & 15 : lo;
          view[d++] = (nh << 4) | nl;
        }
      }
      dy++;
      if (dy >= VIEW_H) return;
    }
    rowOff += bpr;
  }
}

/** 0x9b92: draw piece `p` (0..3) in slot `s`. `limit` = 16 directory bytes in a dungeon (0x268e4 set). */
export function drawSlot(view: Uint8Array, art: DungeonArt, s: number, p: number, limit = 16): void {
  const t = art.tables;
  const off = t.slotGrp[s]! + 4 * p;
  if (off >= limit) return;
  const e = art.entries[off >> 1];
  if (!e || e.bpr === 0) return;
  let x = t.slotX[s]!;
  let w = t.slotW[s]!;
  let start = 0;
  if (x < 0) {
    start = -x;
    w = w + x > 0 ? w + x : 0;
    x = 0;
  } else if (x + w > 56) {
    w = 55 - x;
  }
  blit(view, e.data, start, x, t.slotY[s]!, w, e.bpr, e.h, t.slotScale[s]!, t.slotMirror[s]! !== 0);
}

/** 0x29dc + 0x9d12: compose the 112x88 chunky view (returns one palette index per pixel). */
export function renderView(art: DungeonArt, lv: Bt3Level, x: number, y: number, facing: number, light = 5): Uint8Array {
  const t = art.tables;
  const offs = t.cellOffsets[facing & 3]!;
  const words: number[] = new Array(34).fill(0);
  for (let k = 0; k <= 24; k++) words[k] = rotateWord(wallWord(lv, x + offs[k]![0], y + offs[k]![1]), facing);
  for (let k = 25; k <= 33; k++) {
    const c = cellAt(lv, x + offs[k]![0], y + offs[k]![1]);
    words[k] = t.portalWord[(c[2]! >> 5) & 3]!;
  }
  const view = new Uint8Array(VIEW_BPR * VIEW_H);
  const ceil = art.entries[8];
  const floor = art.entries[9];
  if (ceil) view.set(ceil.data.subarray(0, 0x9a0), 0);
  if (floor) view.set(floor.data.subarray(0, 0x9a0), 0x9a0);
  if (light < 4) view.fill(0, t.darkOff[light]!, t.darkOff[light]! + t.darkLen[light]!);
  for (let s = t.startSlot[Math.max(0, Math.min(5, light))]!; s < 61; s++) {
    if (!t.slotEnable[s]) continue;
    const nib = (words[t.slotCell[s]!]! >> t.slotShift[s]!) & 15;
    const piece = t.pieceOfNibble[nib]!;
    if (piece) drawSlot(view, art, s, piece - 1);
  }
  const out = new Uint8Array(VIEW_W * VIEW_H);
  for (let i = 0; i < view.length; i++) {
    out[2 * i] = view[i]! >> 4;
    out[2 * i + 1] = view[i]! & 15;
  }
  return out;
}

export function indexedToRGBA(frame: Uint8Array, palette: number[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(frame.length * 4);
  for (let i = 0; i < frame.length; i++) {
    const w = palette[frame[i]!] ?? 0;
    rgba[4 * i] = ((w >> 8) & 15) * 17;
    rgba[4 * i + 1] = ((w >> 4) & 15) * 17;
    rgba[4 * i + 2] = (w & 15) * 17;
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}

/** A start pose: the first stairs special (opcode 0/1) on a concrete square, else the first fully open-ish cell. */
export function startPose(lv: Bt3Level): { x: number; y: number; facing: number } {
  const st = lv.specials.find((s) => (s.op === 0 || s.op === 1) && s.x !== 0xff && s.y !== 0x7f);
  if (st) return { x: st.x, y: st.y, facing: 0 };
  for (let y = 0; y < lv.h; y++)
    for (let x = 0; x < lv.w; x++) {
      for (let f = 0; f < 4; f++) if (faceNibble(lv, x, y, f) === 0) return { x, y, facing: f };
    }
  return { x: 0, y: 0, facing: 0 };
}
