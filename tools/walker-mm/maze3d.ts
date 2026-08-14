/**
 * ASM-faithful 3D frustum engine for the MM1/MM2 maze walkers.
 *
 * Port of the shared core of Vairn/MM2's `wiki/{maze-walker,mm1-maze-walker}/
 * view3d.js` (itself a port of `tools/view3d_trace.py` + `view3d_indoor.py`
 * — traced from the games' own 68k/x86 3D-view code). Both games share this
 * frustum math; only the art sources differ (MM1: WALLPIX slices; MM2: `.32`
 * sheets), which the host supplies.
 *
 * Page-0 wall codes (confirmed by the ASM traces + the collision page:
 * code-2 faces are passable doorways, code-3 faces sit on blocked walls):
 *   `0` open, `1` plain wall, `2` door, `3` wall+torch.
 */

export const MAP_GRID = 16;
export const MAP_PAGE_SIZE = 256;
export const VIEW_W = 208;
export const VIEW_H = 120;
export const ORIGIN_X = 8;
export const SKY_Y = 8;
export const FLOOR_Y = 68;

export const FACE = ['N', 'E', 'S', 'W'] as const;
export const STEP_DX = [0, 1, 0, -1];
export const STEP_DY = [1, 0, -1, 0];

/** Frustum slot constants (order matters — they index the 20-cell view). */
const S_F20 = 0, S_F1F = 1, S_F1E = 2, S_F1D = 3, S_F1C = 4, S_F1B = 5, S_F1A = 6, S_F19 = 7;
const S_F18 = 8, S_F17 = 9, S_F16 = 10, S_F15 = 11, S_F14 = 12, S_F13 = 13, S_F12 = 14, S_F11 = 15;
const S_F10 = 16, S_F0F = 17, S_F0E = 18, S_F0D = 19;

const BUNDLE_N = [0, 1, 255, 0, 1, 0];
const BUNDLE_E = [1, 0, 0, 1, 0, 255];
const BUNDLE_S = [0, 255, 1, 0, 255, 0];
const BUNDLE_W = [255, 0, 0, 255, 0, 1];
const BUNDLES = [BUNDLE_N, BUNDLE_E, BUNDLE_S, BUNDLE_W];

export interface ScreenLike {
  visual: Uint8Array | number[];
  collision: Uint8Array | number[];
  neighbors: number[];
  roof?: number[] | Uint8Array;
  outdoor?: boolean;
  mapWalls?: boolean;
}

export interface Pose {
  screen: number;
  x: number;
  y: number;
  facing: number;
}

export interface Blit {
  kind: 'front' | 'left' | 'right';
  depth: number;
  frame: number;
  x: number;
  y: number;
  code: number;
  mirror?: boolean;
  latX?: number;
}

export interface Scene {
  hood: number[];
  slots: number[];
  blits: Blit[];
  torchBlits: Blit[];
}

export interface TorchOverlay {
  frame: number;
  x: number;
  y: number;
}

function collisionFieldWall(cell: number, dirIdx: number): boolean {
  const d = dirIdx & 3;
  if (d === 3) return (cell & 0x40) !== 0;
  return ((cell >> (d * 2)) & 1) !== 0;
}

function movementToCollisionDir(facing: number): number {
  return (3 - (facing & 3)) & 3;
}

export function movementBlocked(sc: ScreenLike, x: number, y: number, facing: number): boolean {
  const d = facing & 3;
  const cd = movementToCollisionDir(d);
  const col = sc.collision;
  const idx = y * MAP_GRID + x;
  if (collisionFieldWall(col[idx], cd)) return true;
  const nx = x + STEP_DX[d];
  const ny = y + STEP_DY[d];
  if (nx < 0 || ny < 0 || nx >= MAP_GRID || ny >= MAP_GRID) return false;
  const back = movementToCollisionDir((d + 2) & 3);
  const destIdx = ny * MAP_GRID + nx;
  if (collisionFieldWall(col[destIdx], back)) return true;
  if (sc.outdoor && !sc.mapWalls) {
    const destV = sc.visual[destIdx];
    if ((destV & 0x60) === 0x60 || (destV & 0x80) !== 0) return true;
  }
  return false;
}

export interface FacingBits {
  mask: number;
  shift: number;
  mask_d4: number;
  mask_d5: number;
  shift_d4: number;
  shift_d5: number;
}

export function setFacing(facing: number): FacingBits {
  const i = facing & 3;
  const masks = [0xc0, 0x30, 0x0c, 0x03];
  const d1 = masks[i];
  const shFwd = d1 === 0x03 ? 0 : 6 - 2 * i;
  const shD4 = (shFwd + 2) & 7;
  const shD5 = shFwd === 0 ? 6 : shFwd - 2;
  const d5 = d1 === 0x03 ? 0xc0 : (d1 >> 2) & 0xff;
  const d4 = d1 === 0xc0 ? 0x03 : (d1 << 2) & 0xff;
  return { mask: d1, shift: shFwd, mask_d4: d4, mask_d5: d5, shift_d4: shD4, shift_d5: shD5 };
}

function putSlot(slots: number[], idx: number, cell: number, mask: number, shift: number): void {
  if ((cell & mask) === 0) return;
  const code = (cell >> shift) & 3;
  if (code === 0) return;
  slots[idx] = code;
}

export function buildFrustum(hood: number[], f: FacingBits): number[] {
  const slots = new Array<number>(20).fill(0);
  const d1 = f.mask;
  const d4 = f.mask_d4;
  const d5 = f.mask_d5;
  const shFwd = f.shift;
  const shD4 = f.shift_d4;
  const shD5 = f.shift_d5;
  const b = (i: number) => (i >= 0 && i < hood.length ? hood[i] : 0);

  putSlot(slots, S_F20, b(0), d4, shD4);
  if (slots[S_F20] === 0) putSlot(slots, S_F14, b(4), d1, shFwd);
  putSlot(slots, S_F1C, b(0), d5, shD5);
  if (slots[S_F1C] === 0) putSlot(slots, S_F10, b(8), d1, shFwd);

  if (b(0) & d1) {
    putSlot(slots, S_F18, b(0), d1, shFwd);
    if (slots[S_F20] === 0 && slots[S_F14] === 0) putSlot(slots, S_F13, b(5), d1, shFwd);
    if (slots[S_F1C] === 0 && slots[S_F10] === 0) putSlot(slots, S_F0F, b(9), d1, shFwd);
  } else {
    if (b(1) & d4) putSlot(slots, S_F1F, b(1), d4, shD4);
    else putSlot(slots, S_F13, b(5), d1, shFwd);
    if (b(1) & d5) putSlot(slots, S_F1B, b(1), d5, shD5);
    else putSlot(slots, S_F0F, b(9), d1, shFwd);
    putSlot(slots, S_F17, b(1), d1, shFwd);
    if (slots[S_F1F] === 0 && slots[S_F13] === 0) putSlot(slots, S_F12, b(6), d1, shFwd);
    if (slots[S_F1B] === 0 && slots[S_F0F] === 0) putSlot(slots, S_F0E, b(10), d1, shFwd);

    if ((b(1) & d1) === 0) {
      if (b(2) & d4) putSlot(slots, S_F1E, b(2), d4, shD4);
      else putSlot(slots, S_F12, b(6), d1, shFwd);
      if (b(2) & d5) putSlot(slots, S_F1A, b(2), d5, shD5);
      else putSlot(slots, S_F0E, b(10), d1, shFwd);
      putSlot(slots, S_F16, b(2), d1, shFwd);

      if ((b(2) & d1) === 0) {
        if (b(3) & d4) putSlot(slots, S_F1D, b(3), d4, shD4);
        else putSlot(slots, S_F11, b(7), d1, shFwd);
        if (b(3) & d5) putSlot(slots, S_F19, b(3), d5, shD5);
        else putSlot(slots, S_F0D, b(11), d1, shFwd);
        putSlot(slots, S_F15, b(3), d1, shFwd);
      }
    }
  }

  function norm(a: number, bb: number): void {
    if (slots[a] !== 0 && slots[bb] === 2) slots[bb] = 1;
  }
  norm(S_F20, S_F13);
  norm(S_F1C, S_F0F);
  norm(S_F1F, S_F12);
  norm(S_F1B, S_F0E);
  return slots;
}

const frontY = [22, 40, 54, 62];
const frontX = [32, 64, 88, 104];
const leftX1 = [8, 32, 64, 88];
const leftY1 = [8, 22, 40, 54];
const leftX2 = [8, 8, 40, 88];
const leftY2 = [22, 40, 54, 62];
const rightX1 = [192, 160, 136, 120];
const rightY1 = [8, 22, 40, 54];
const rightX2 = [192, 160, 136, 120];
const rightY2 = [22, 40, 54, 62];
const leftBase = [12, 14, 2, 3];
const rightBase = [13, 15, 2, 3];

export function collectBlits(slots: number[]): Blit[] {
  const blits: Blit[] = [];

  function paint(kind: 'front' | 'left' | 'right', paintDepth: number, code: number): void {
    if (code === 0) return;
    const depth = (paintDepth & 0x7f) - 1;
    if (depth < 0 || depth >= 4) return;
    const mirror = paintDepth >= 0x80;
    const isDoor = code === 2;
    if (kind === 'front') {
      blits.push({
        kind, depth,
        frame: depth + (isDoor ? 0x10 : 0),
        x: frontX[depth], y: frontY[depth] + (depth === 0 ? 1 : 0),
        code, latX: 0,
      });
    } else if (kind === 'left') {
      if (mirror) {
        blits.push({
          kind, depth, mirror,
          frame: leftBase[depth] + (isDoor ? 0x10 : 0),
          x: leftX2[depth], y: leftY2[depth],
          code, latX: -2,
        });
      } else {
        blits.push({
          kind, depth,
          frame: depth + 4 + (isDoor ? 0x10 : 0),
          x: leftX1[depth], y: leftY1[depth],
          code, latX: -1,
        });
      }
    } else if (mirror) {
      blits.push({
        kind, depth, mirror,
        frame: rightBase[depth] + (isDoor ? 0x10 : 0),
        x: rightX2[depth], y: rightY2[depth],
        code, latX: 2,
      });
    } else {
      blits.push({
        kind, depth,
        frame: depth + 8 + (isDoor ? 0x10 : 0),
        x: rightX1[depth], y: rightY1[depth],
        code, latX: 1,
      });
    }
  }

  const s = slots;
  paint('left', 4, s[S_F1D]);
  paint('left', 0x84, s[S_F11]);
  paint('right', 4, s[S_F19]);
  paint('right', 0x84, s[S_F0D]);
  paint('front', 4, s[S_F15]);
  paint('left', 3, s[S_F1E]);
  paint('left', 0x83, s[S_F12]);
  paint('right', 3, s[S_F1A]);
  paint('right', 0x83, s[S_F0E]);
  paint('front', 3, s[S_F16]);
  paint('left', 2, s[S_F1F]);
  paint('left', 0x82, s[S_F13]);
  paint('right', 2, s[S_F1B]);
  paint('right', 0x82, s[S_F0F]);
  paint('front', 2, s[S_F17]);
  paint('left', 1, s[S_F20]);
  paint('left', 0x81, s[S_F14]);
  paint('right', 1, s[S_F1C]);
  paint('right', 0x81, s[S_F10]);
  paint('front', 1, s[S_F18]);
  return blits;
}

/** Stitched page-0 sampler: reads the 13-cell hood across screen boundaries. */
export class StitchedVisual {
  private readonly center: Uint8Array | number[];
  private readonly pages: (Uint8Array | number[])[];

  constructor(screens: ScreenLike[], screenId: number) {
    this.center = screens[screenId].visual;
    const n = screens[screenId].neighbors;
    this.pages = [0, 1, 2, 3].map((d) => {
      const idx = n[d];
      if (idx >= 0 && idx < screens.length) return screens[idx].visual;
      return new Array<number>(MAP_PAGE_SIZE).fill(0);
    });
  }

  at(x: number, y: number): number {
    let page = this.center;
    let lx = x;
    let ly = y;
    if (x > 0x0f && x < 0x14) {
      page = this.pages[1];
      lx = x - 0x10;
    } else if (x >= 0xfc) {
      page = this.pages[3];
      lx = x - 0xf0;
    }
    if (y >= MAP_GRID) {
      page = this.pages[0];
      ly = y - MAP_GRID;
    } else if (y < 0) {
      page = this.pages[2];
      ly = y + MAP_GRID;
    }
    if (lx < 0 || ly < 0 || lx >= MAP_GRID || ly >= MAP_GRID) return 0;
    return page[(ly << 4) | lx];
  }
}

function sb(bundle: number[], i: number): number {
  const v = bundle[i] & 0xff;
  return v > 127 ? v - 256 : v;
}

export function refreshHood(grid: StitchedVisual, px: number, py: number, facing: number): number[] {
  const hood = new Array<number>(13).fill(0);
  const b = BUNDLES[facing & 3];
  const dx = sb(b, 0);
  const dy = sb(b, 1);

  function row(sx: number, sy: number, outOff: number): void {
    let x = sx;
    let y = sy;
    for (let i = 0; i < 5; i++) {
      hood[outOff + i] = grid.at(x, y);
      x += dx;
      y += dy;
    }
  }

  row(px, py, 0);
  row(px + sb(b, 2), py + sb(b, 3), 4);
  row(px + sb(b, 4), py + sb(b, 5), 8);
  return hood;
}

export function buildIndoorScene(grid: StitchedVisual, x: number, y: number, facing: number): Scene {
  const hood = refreshHood(grid, x, y, facing);
  const slots = buildFrustum(hood, setFacing(facing));
  const blits = collectBlits(slots);
  const torchBlits = blits.filter((b) => b.code === 3);
  return { hood, slots, blits, torchBlits };
}

/** Step one grid cell; cross screen boundaries when `neighbors` allows. */
export function stepParty(facing: number, x: number, y: number, screen: number, screens: ScreenLike[], noclip = false): Pose {
  const rec = screens[screen];
  if (!noclip && movementBlocked(rec, x, y, facing)) {
    return { screen, x, y, facing };
  }
  x += STEP_DX[facing & 3];
  y += STEP_DY[facing & 3];
  const n = rec.neighbors;
  const nScreens = screens.length;
  if (x < 0) {
    if (n[3] >= 0 && n[3] < nScreens) {
      screen = n[3];
      x = 15;
    }
  } else if (x >= MAP_GRID) {
    if (n[1] >= 0 && n[1] < nScreens) {
      screen = n[1];
      x = 0;
    }
  }
  if (y < 0) {
    if (n[2] >= 0 && n[2] < nScreens) {
      screen = n[2];
      y = 15;
    }
  } else if (y >= MAP_GRID) {
    if (n[0] >= 0 && n[0] < nScreens) {
      screen = n[0];
      y = 0;
    }
  }
  return {
    screen,
    x: Math.max(0, Math.min(15, x)),
    y: Math.max(0, Math.min(15, y)),
    facing,
  };
}

/** Torch overlay placement (game view3dTorchBlitFor); flicker phase 0..2. */
export function torchBlitFor(wb: Blit, phase = 0): TorchOverlay | null {
  // code 3 = wall+torch slot (never door=2)
  if (wb.code !== 3 || wb.depth > 2) return null;
  const flicker = ((phase % 3) + 3) % 3;
  const baseFrame = wb.frame;
  const latX = wb.latX ?? (wb.kind === 'front' ? 0 : wb.kind === 'left' ? (wb.mirror ? -2 : -1) : wb.mirror ? 2 : 1);

  if (latX === 0) {
    return { frame: 0x12 + wb.depth * 3 + flicker, x: [105, 108, 107][wb.depth], y: [44, 52, 60][wb.depth] };
  }
  if (latX === -1 || latX === -2) {
    if ([12, 14, 2, 3].includes(baseFrame)) {
      if (wb.depth === 0) return null;
      return { frame: 0x12 + wb.depth * 3 + flicker, x: [8, 16, 64][wb.depth], y: [44, 52, 60][wb.depth] };
    }
    return { frame: wb.depth * 3 + flicker, x: [8, 43, 73][wb.depth], y: [49, 55, 59][wb.depth] };
  }
  // right side
  if ([13, 15, 2, 3].includes(baseFrame)) {
    if (wb.depth === 0) return null;
    return { frame: 0x12 + wb.depth * 3 + flicker, x: [202, 199, 152][wb.depth], y: [44, 52, 60][wb.depth] };
  }
  return { frame: 9 + wb.depth * 3 + flicker, x: [196, 166, 142][wb.depth], y: [49, 55, 59][wb.depth] };
}

/**
 * MM1 WALLPIX slice name for a frustum frame of wall set `entry`.
 * Frustum frames 0–3 = front (WALLPIX slices 8–11), 4–7 = left (0–3),
 * 8–11 = right (4–7); door frames (0x10+) and the mirrored side bases
 * (12–15) fall back to the wall slice at the same depth — MM1's WALLPIX
 * has no door/torch art.
 */
export function wallpixSliceName(entry: number, frame: number): string {
  const base = frame >= 0x10 ? frame - 0x10 : frame;
  const pad = String(entry).padStart(2, '0');
  if (base <= 3) return `wall${pad}_front${base}`;
  if (base <= 7) return `wall${pad}_left${base - 4}`;
  if (base <= 11) return `wall${pad}_right${base - 8}`;
  if (base === 12) return `wall${pad}_left0`;
  if (base === 14) return `wall${pad}_left1`;
  if (base === 13) return `wall${pad}_right0`;
  if (base === 15) return `wall${pad}_right1`;
  return `wall${pad}_left0`;
}
