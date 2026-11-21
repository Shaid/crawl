/**
 * Evil's Doom (Amiga AGA) first-person view + movement rules, re-implemented from the per-dungeon
 * program module (cited offsets are `PRG/BEL.dat` file offsets; the other four modules carry the
 * same code at shifted addresses and the same 25-entry slot table / emit order — checked by the
 * real-data test). Browser-safe: no node imports.
 *
 *  - Map: 30x30 bytes per level, row-major, `grid[y*30+x]` (accessor +0x9CCA).
 *  - Facing 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x); key $81 = +1, $85 = -1 (+0x91AE..+0x91D4).
 *  - View gather (+0xBFF6): 17 cells copied to A6+$1872 in a fixed order, see `VIEW_CELLS`.
 *  - Draw list (+0xAB72): painter's order far->near, cmd 3 = one wall piece by slot number; the
 *    wall-emitting tests are transcribed in `wallSlots` (doors, decorations, objects, monsters and
 *    floor items — cmds 1/2/4-9 — are not drawn yet).
 *  - Piece blit (cmd-3 handler +0xCCBE): straight A->D copy, 3 consecutive source planes into
 *    view planes 0-2 (plane 3 cleared), so wall pixels are colour indices 0-7.
 *  - Ceiling = slot 15, floor = slot 16 (DT1, not in the draw list); rows 84-162 are cleared every
 *    frame (+0xBFB8), so anything beyond depth 3 is colour 0.
 *  - Step mirroring (+0x9CE0): after every successful move or turn the game swaps the wall-art
 *    buffer with its runtime mirror (built at +0xD5C4: rows byte-reversed, bytes bit-reversed, for
 *    slots 0-16) and swaps the source of side-wall slot pairs 3/4, 5/6 ... 13/14.
 */

export const GRID = 30;
export const VIEW_W = 368; // 46 bytes/row (blit modulo base 0x2E)
export const VIEW_H = 274; // plane stride 0x313C / 46
export type Facing = 0 | 1 | 2 | 3;

export interface Slot { src: number; x: number; y: number; w: number; h: number; mod: number }

export interface EdLevel {
  /** 900 bytes, row-major. */
  grid: Uint8Array;
}

/** (right, forward) offsets of the 17 gathered cells, in A6+$1872 order (+0xC0B8 for facing N). */
export const VIEW_CELLS: ReadonlyArray<readonly [number, number]> = [
  [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3],
  [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
  [-1, 1], [0, 1], [1, 1],
  [-1, 0], [1, 0],
  [0, -1],
  [0, 0],
];

/** Unit vectors per facing: [forward dx, forward dy, right dx, right dy]. */
const AXES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -1, 1, 0],
  [1, 0, 0, 1],
  [0, 1, -1, 0],
  [-1, 0, 0, -1],
];

export const DELTAS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Out-of-grid cells read as solid (the game reads neighbouring memory there; only reachable at depth >= 2 past a solid border). */
export function cellAt(level: EdLevel, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return 0x80;
  return level.grid[y * GRID + x];
}

export function gatherView(level: EdLevel, x: number, y: number, facing: Facing): Uint8Array {
  const [fx, fy, rx, ry] = AXES[facing];
  const out = new Uint8Array(17);
  VIEW_CELLS.forEach(([r, f], i) => { out[i] = cellAt(level, x + f * fx + r * rx, y + f * fy + r * ry); });
  return out;
}

const solid = (v: number) => (v & 0x80) !== 0;

/**
 * Wall-slot emit sequence of the draw-list builder (+0xAB72..+0xB9AA), only the cmd-3 entries.
 * `c[i]` is gathered cell i (see VIEW_CELLS). Emit order is the game's, so later slots overdraw
 * earlier ones.
 */
export function wallSlots(c: Uint8Array): number[] {
  const s: number[] = [];
  const S = (i: number) => solid(c[i]);
  // +0xAB96: far-left column, depth 3
  if (!S(6) && !S(10) && !S(13) && S(0)) { s.push(0x16); if (!S(1)) s.push(0x0d); }
  // +0xAC10: far-right column, depth 3
  if (!S(8) && !S(12) && !S(14) && S(4)) { s.push(0x18); if (!S(3)) s.push(0x0e); }
  // +0xACA4 / +0xADC4: depth 3, one left/right of centre
  if (S(1) && !S(6)) s.push(0x15);
  if (S(3) && !S(8)) s.push(0x17);
  // +0xAEE8: depth 3 centre, or the side faces of its neighbours
  if (S(2)) { if (!S(11) && !S(7)) s.push(0x02); } else { if (S(1)) s.push(0x09); if (S(3)) s.push(0x0a); }
  // +0xB038 / +0xB1BA: depth 2, one left/right
  if (S(6)) { if (!S(10)) s.push(0x13); } else if (S(5)) s.push(0x0b);
  if (S(8)) { if (!S(12)) s.push(0x14); } else if (S(9)) s.push(0x0c);
  // +0xB336: depth 2 centre
  if (S(7)) { if (!S(11)) s.push(0x01); } else { if (S(6)) s.push(0x07); if (S(8)) s.push(0x08); }
  // +0xB582 / +0xB662: depth 1, one left/right
  if (S(10) && !S(13)) s.push(0x11);
  if (S(12) && !S(14)) s.push(0x12);
  // +0xB742: depth 1 centre
  if (S(11)) s.push(0x00); else { if (S(10)) s.push(0x05); if (S(12)) s.push(0x06); }
  // +0xB998: immediately left/right
  if (S(13)) s.push(0x03);
  if (S(14)) s.push(0x04);
  return s;
}

/**
 * Movement test (+0x9BCE forward, +0x9C0E back, +0x9C4A/+0x9C80 sideways): a solid cell blocks
 * unless bit 6 is also set (illusory wall: the game prints message $146 and lets you through);
 * an open cell blocks if bit 1 is set; bit 3 (door) blocks unless its door object is open — the
 * door objects are not decoded yet, so doors are treated as open here.
 */
export function canEnter(level: EdLevel, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  const v = cellAt(level, x, y);
  if (v & 0x80) return (v & 0x40) !== 0;
  return (v & 0x02) === 0;
}

export type Op = 'fwd' | 'back' | 'left' | 'right' | 'turnL' | 'turnR';

export function stepPose(level: EdLevel, pose: { x: number; y: number; facing: Facing }, op: Op, noclip = false): { x: number; y: number; facing: Facing } | null {
  const { x, y, facing } = pose;
  if (op === 'turnL') return { x, y, facing: ((facing + 3) & 3) as Facing };
  if (op === 'turnR') return { x, y, facing: ((facing + 1) & 3) as Facing };
  const dir = op === 'fwd' ? facing : op === 'back' ? (facing + 2) & 3 : op === 'left' ? (facing + 3) & 3 : (facing + 1) & 3;
  const nx = x + DELTAS[dir][0], ny = y + DELTAS[dir][1];
  if (noclip ? nx < 0 || ny < 0 || nx >= GRID || ny >= GRID : !canEnter(level, nx, ny)) return null;
  return { x: nx, y: ny, facing };
}

/**
 * Mirror phase. The game flips on every successful move/turn, i.e. it is the parity of the step
 * count since module entry (which forces phase 0, +0x0CF0). Every move changes x+y by 1 and every
 * turn changes facing by 1 (mod 4), so (x+y+facing) has exactly that parity, up to the phase of
 * the pose the count started from (`origin`).
 */
export function mirrorPhase(x: number, y: number, facing: number, origin: { x: number; y: number; facing: number }): 0 | 1 {
  return ((x + y + facing - origin.x - origin.y - origin.facing) & 1) as 0 | 1;
}

const REV = new Uint8Array(256).map((_, b) => {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
  return r;
});

/** Runtime mirror buffer (+0xD5C4) over slots 0-16 (all mod 0): per plane row, bytes reversed and bit-reversed. */
export function mirrorArt(art: Uint8Array, slots: Slot[]): Uint8Array {
  const m = new Uint8Array(art.length);
  for (let s = 0; s <= 16; s++) {
    const { src, w, h } = slots[s];
    const rb = w * 2;
    for (let p = 0; p < 3; p++) {
      for (let y = 0; y < h; y++) {
        const row = src + p * rb * h + y * rb;
        for (let b = 0; b < rb; b++) m[row + rb - 1 - b] = REV[art[row + b]];
      }
    }
  }
  return m;
}

function blit(out: Uint8Array, art: Uint8Array, slot: Slot, src: number): void {
  const rb = slot.w * 2 + slot.mod;
  const ps = rb * slot.h;
  for (let y = 0; y < slot.h; y++) {
    const Y = slot.y + y;
    if (Y >= VIEW_H) break;
    for (let xb = 0; xb < slot.w * 2; xb++) {
      const o = src + y * rb + xb;
      const p0 = art[o], p1 = art[o + ps], p2 = art[o + 2 * ps];
      for (let b = 0; b < 8; b++) {
        const X = slot.x + xb * 8 + b;
        if (X >= VIEW_W) break;
        const sh = 7 - b;
        out[Y * VIEW_W + X] = ((p0 >> sh) & 1) | (((p1 >> sh) & 1) << 1) | (((p2 >> sh) & 1) << 2);
      }
    }
  }
}

export interface Art { normal: Uint8Array; mirror: Uint8Array }

/** Render one frame as colour indices 0..15 (VIEW_W x VIEW_H). */
export function renderView(level: EdLevel, slots: Slot[], art: Art, x: number, y: number, facing: Facing, phase: 0 | 1): Uint8Array {
  const out = new Uint8Array(VIEW_W * VIEW_H);
  const buf = phase ? art.mirror : art.normal;
  const srcOf = (s: number): number => {
    if (phase && s >= 3 && s <= 14) return slots[s % 2 === 1 ? s + 1 : s - 1].src;
    return slots[s].src;
  };
  blit(out, buf, slots[15], srcOf(15));
  blit(out, buf, slots[16], srcOf(16));
  for (const s of wallSlots(gatherView(level, x, y, facing))) blit(out, buf, slots[s], srcOf(s));
  return out;
}

/** $0RGB 12-bit words -> 8-bit RGB (nibble x 17). */
export function paletteRGB(words: number[]): Array<[number, number, number]> {
  return words.map((w) => [((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]);
}
