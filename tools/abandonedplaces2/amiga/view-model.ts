/**
 * Abandoned Places 2 (Amiga) first-person view model: a port of the slot-table renderer in the
 * unpacked `main` (render entry 0x66CC; per-cell routines 0x67E8, 0x7280, 0x7D2A, 0x7BDC, 0x7C6E,
 * pre-passes 0x76C0/0x7734/0x77A2/0x78A8/0x7932). 4 depth rows x 5 lateral cells, painter order
 * far->near, each solid cell draws up to 4 entries of a 72-slot face table; open cells draw pits,
 * on-wall decorations, stairs and gates. Entities (monsters, items, objects, chests, water, fire,
 * switches) are NOT drawn (see TODO ap2-entities). Spec: data-structure.md §6.
 * Pure: no DOM, no fs.
 */
export const VIEW_W = 192;
export const VIEW_H = 135;

export interface ApRecord { w: number; h: number; pw: number; x: number; y: number; fw: number; fh: number; masked: boolean; pix: Uint8Array }
export type ApRes = (ApRecord | null)[];
export interface ApTables {
  viewOffsets: number[]; rot: number[]; faceSlots: number[]; faceTemplate: number[]; slotDest: number[];
  decorSlot: number[]; decorPair: number[]; pitA: number[]; pitB: number[]; pitADest: number[]; pitBDest: number[];
  gateFace: number[]; gateEdge: number[]; gateBars: number[]; gateFaceDest: number[]; gateEdgeDest: number[]; gateBarsDest: number[];
  gateOrient: number[]; levelTheme: number[]; themeSet: number[]; themeRows: number[][];
}
export interface ApLevel {
  id: number; theme: number; set: number; families: Record<string, string | null>;
  w: number; h: number; cells: Uint8Array;
  decor: { type: number; x: number; y: number; side: number }[];
  gates: { type: number; x: number; y: number; state: number; orient: number }[];
  stairs: { kind: number; x: number; y: number; dx: number; dy: number; level: number }[];
}
export type Facing = 0 | 1 | 2 | 3; // 0 = north (-y), 1 = east, 2 = south, 3 = west (movement deltas 0x115CA)
export const DELTAS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const ZERO_CELL = new Uint8Array(8);
export function cellAt(l: ApLevel, x: number, y: number): Uint8Array {
  if (x < 0 || y < 0 || x >= l.w || y >= l.h) return ZERO_CELL;
  return l.cells.subarray((y * l.w + x) * 8, (y * l.w + x) * 8 + 8);
}
/** 0x7980: wall (byte5 bit0) or illusory wall (bit1) unless the detect flag (0x49A6) is set. */
export function isSolidView(c: Uint8Array, seeIllusions = false): boolean {
  return (c[5] & 1) !== 0 || (!seeIllusions && (c[5] & 2) !== 0);
}
export function gateAt(l: ApLevel, x: number, y: number) {
  return l.gates.find((g) => g.x === x && g.y === y);
}
/** Party move check, 0x9A2E: wall, byte3 bit1/bit2, byte1 bit0, closed gate. Monster bit (byte5 bit7) not modelled. */
export function canEnter(l: ApLevel, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= l.w || y >= l.h) return false;
  const c = cellAt(l, x, y);
  if (c[5] & 1) return false;
  if (c[3] & 6) return false;
  if (c[1] & 1) return false;
  if (c[4] & 0x40) {
    const g = gateAt(l, x, y);
    if (g && (g.state & 1) === 0) return false;
  }
  return true;
}

export interface Theme { res: Record<string, ApRes | null> }

class Canvas {
  px = new Uint8Array(VIEW_W * VIEW_H);
  blit(r: ApRecord, dx: number, dy: number, flip: boolean, atX: number, atY: number): void {
    // dest (atX,atY) is the slot origin; the record adds its own x/y offset (0x5D3C). A flipped
    // draw mirrors inside the frame: x' = x - 2*xoff + frameW - paddedW (0x7DF8..0x7E0E).
    void dx; void dy;
    let x0 = atX, y0 = atY;
    if (flip) x0 = x0 - 2 * r.x + r.fw - r.pw;
    x0 += r.x; y0 += r.y;
    for (let y = 0; y < r.h; y++) {
      const ty = y0 + y;
      if (ty < 0 || ty >= VIEW_H) continue;
      for (let x = 0; x < r.pw; x++) {
        const tx = x0 + x;
        if (tx < 0 || tx >= VIEW_W) continue;
        const v = r.pix[y * r.pw + (flip ? r.pw - 1 - x : x)];
        if (v !== 255) this.px[ty * VIEW_W + tx] = v;
      }
    }
  }
}

export interface RenderOpts { seeIllusions?: boolean; trace?: string[] }

export function renderView(level: ApLevel, t: ApTables, theme: Theme, px: number, py: number, facing: Facing, opts: RenderOpts = {}): Uint8Array {
  const cv = new Canvas();
  const res = (fam: string): ApRes | null => (level.families[fam] ? theme.res[level.families[fam]!] ?? null : null);
  const rec = (fam: string, i: number): ApRecord | null => res(fam)?.[i] ?? null;
  // background (0x7280): parity = (x ^ y ^ facing) & 1 selects the floor/ceiling image
  const bg = rec('fl', (px ^ py ^ facing) & 1);
  if (bg) cv.blit(bg, 0, 0, false, 0, 0);

  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < 4; r++) for (let l = 0; l < 5; l++) {
    const o = (r * 5 + l) * 8 + facing * 2;
    cells.push({ x: px + t.viewOffsets[o], y: py + t.viewOffsets[o + 1] });
  }
  const face = Uint8Array.from(t.faceTemplate); // 72 x (kind,id1,id2)
  const rotOf = (side: number) => t.rot[facing * 4 + side];

  // 0x78A8 + 0x7932: an on-wall decoration with a real record replaces the wall face of its slot
  const decorFor = (c: { x: number; y: number }) =>
    (cellAt(level, c.x, c.y)[3] & 8) ? level.decor.filter((d) => d.x === c.x && d.y === c.y).slice(0, 4) : [];
  cells.forEach((c, idx) => {
    for (const d of decorFor(c)) {
      const fam = d.type === 1 ? 'onwl1' : d.type === 2 ? 'onwl2' : null;
      if (!fam) continue;
      const slot = t.decorSlot[idx * 4 + rotOf(d.side & 3)];
      if (slot < 0) continue;
      const [k, r] = [t.decorPair[slot * 2], t.decorPair[slot * 2 + 1]];
      if (k !== 0 && rec(fam, r)) face[slot * 3] = 0;
    }
  });
  // occlusion pre-passes 0x76C0 / 0x7734 / 0x77A2: a solid cell one row nearer hides the row behind it
  const solid = (i: number) => isSolidView(cellAt(level, cells[i].x, cells[i].y), opts.seeIllusions);
  const passes: [number, number[]][] = [[0, [0, 32, 8]], [1, [16, 56]], [3, [24, 64]]];
  for (const [lat, clears] of passes) {
    let prev = false;
    for (let r = 0; r < 4; r++) {
      const s = solid(r * 5 + lat);
      if (prev) for (const base of clears) face[(base + r) * 3] = 0;
      prev = s;
    }
  }

  const drawSlot = (fam: string, slot: number, kind: number, recIdx: number, cx: number, cy: number) => {
    const r = rec(fam, recIdx);
    if (!r || kind === 0) return;
    const par = (cx ^ cy) & 1;
    const flip = kind === 2 || (kind === 3 && par === 0);
    cv.blit(r, 0, 0, flip, t.slotDest[slot * 2], t.slotDest[slot * 2 + 1]);
  };
  const drawTab = (fam: string, pairs: number[], dest: number[], idx: number) => {
    const kind = pairs[idx * 2], ri = pairs[idx * 2 + 1];
    const r = rec(fam, ri);
    if (!r || kind === 0) return;
    cv.blit(r, 0, 0, kind === 2, dest[idx * 2], dest[idx * 2 + 1]);
  };

  for (let row = 3; row >= 0; row--) for (let lat = 4; lat >= 0; lat--) {
    const idx = row * 5 + lat;
    const c = cells[idx];
    const cell = cellAt(level, c.x, c.y);
    if (isSolidView(cell, opts.seeIllusions)) {
      for (let k = 0; k < 4; k++) {
        const slot = t.faceSlots[idx * 4 + k];
        if (slot === 255) continue;
        const kind = face[slot * 3];
        if (kind === 0) continue;
        const par = (c.x ^ c.y) & 1;
        if (kind === 1) { const r = rec('wl', face[slot * 3 + 1]); if (r) cv.blit(r, 0, 0, false, t.slotDest[slot * 2], t.slotDest[slot * 2 + 1]); }
        else if (kind === 2) {
          const r = rec('wl', face[slot * 3 + (par === 0 ? 1 : 2)]);
          if (r) cv.blit(r, 0, 0, par !== 0, t.slotDest[slot * 2], t.slotDest[slot * 2 + 1]);
        }
      }
      continue;
    }
    // open cell: pits (0x68DE / 0x6918)
    if (cell[4] & 8) drawTab('pit', t.pitA, t.pitADest, idx);
    if (cell[4] & 4) drawTab('pit', t.pitB, t.pitBDest, idx);
    // on-wall decorations (0x6C4A -> 0x7C6E)
    for (const d of decorFor(c)) {
      const fam = d.type === 1 ? 'onwl1' : d.type === 2 ? 'onwl2' : null;
      if (!fam) continue;
      const slot = t.decorSlot[idx * 4 + rotOf(d.side & 3)];
      if (slot < 0) continue;
      drawSlot(fam, slot, t.decorPair[slot * 2], t.decorPair[slot * 2 + 1], c.x, c.y);
    }
    // stairs (0x6CC4): drawn on the cell's near face (rot 2)
    if (cell[4] & 0x30) {
      for (const s of level.stairs.filter((q) => q.x === c.x && q.y === c.y).slice(0, 4)) {
        const fam = s.kind === 1 ? 'strd' : s.kind === 2 ? 'stru' : null;
        if (!fam) continue;
        const slot = t.decorSlot[idx * 4 + 2];
        if (slot < 0) continue;
        drawSlot(fam, slot, t.decorPair[slot * 2], t.decorPair[slot * 2 + 1], c.x, c.y);
      }
    }
    // gates (0x6B04): frame, plus bars when closed and seen face-on
    if (cell[4] & 0x40) {
      const g = gateAt(level, c.x, c.y);
      if (g && g.type === 1) {
        const faceOn = t.gateOrient[(g.orient & 1) * 4 + facing] !== 0;
        if (faceOn) {
          drawTab('gt', t.gateFace, t.gateFaceDest, idx);
          if ((g.state & 0xff00) === 0 && (g.state & 0xf) < 1) drawTab('gt', t.gateBars, t.gateBarsDest, idx);
        } else drawTab('gt', t.gateEdge, t.gateEdgeDest, idx);
      }
    }
  }
  return cv.px;
}

export function entrancePose(level: ApLevel): { x: number; y: number; facing: Facing } {
  for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
    if (!canEnter(level, x, y)) continue;
    for (let f = 0; f < 4; f++) {
      const [dx, dy] = DELTAS[f];
      if (canEnter(level, x + dx, y + dy)) return { x, y, facing: f as Facing };
    }
  }
  return { x: 0, y: 0, facing: 0 };
}

// ── JSON decoding (shared by the browser loader and the node tests) ──────────────────────────
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function decodeRes(j: { recs: ({ w: number; h: number; pw: number; x: number; y: number; fw: number; fh: number; masked: boolean; pix: string } | null)[] }): ApRes {
  return j.recs.map((r) => (r ? { ...r, pix: unb64(r.pix) } : null));
}
export function decodeLevel(j: Omit<ApLevel, 'cells'> & { cells: string }): ApLevel {
  return { ...j, cells: unb64(j.cells) };
}
export function resNamesFor(level: ApLevel): string[] {
  return Object.values(level.families).filter((v): v is string => !!v);
}
