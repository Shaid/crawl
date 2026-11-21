/**
 * PLACEHOLDER first-person renderer for the DM2 walker: a plain DDA
 * raycaster over the collision model with flat colours. It uses NO DM2
 * artwork (the real viewport compositor is undecoded, see
 * docs/dungeonmaster2/TODO.md `dm2-viewport-scenes`). Colours are
 * arbitrary: grey stone, brown door, green stairs.
 */
import { DX, DY, surfaceOf, type Dm2Map, type DoorStates, type Pose4 } from './model.ts';

export const VIEW_W = 224;
export const VIEW_H = 136;

const COL: Record<string, [number, number, number]> = {
  wall: [150, 150, 160],
  door: [150, 100, 50],
  stairs: [70, 150, 80],
};

export function renderPlaceholder(map: Dm2Map, doors: DoorStates, pose: Pose4): Uint8ClampedArray {
  const out = new Uint8ClampedArray(VIEW_W * VIEW_H * 4);
  const half = VIEW_H / 2;
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      const i = (y * VIEW_W + x) * 4;
      const v = y < half ? 40 + (y / half) * 20 : 30 + ((y - half) / half) * 30; // ceiling / floor gradient
      out[i] = v; out[i + 1] = v; out[i + 2] = v + (y < half ? 10 : 0); out[i + 3] = 255;
    }
  }
  // facing vector; camera plane perpendicular (FOV ~ 66 degrees)
  const dx = DX[pose.facing]!;
  const dy = DY[pose.facing]!;
  const px = -dy * 0.66;
  const py = dx * 0.66;
  const ox = pose.x + 0.5;
  const oy = pose.y + 0.5;
  for (let col = 0; col < VIEW_W; col++) {
    const cam = (2 * col) / VIEW_W - 1;
    const rx = dx + px * cam;
    const ry = dy + py * cam;
    let mx = pose.x;
    let my = pose.y;
    const ddx = rx === 0 ? 1e30 : Math.abs(1 / rx);
    const ddy = ry === 0 ? 1e30 : Math.abs(1 / ry);
    const sx = rx < 0 ? -1 : 1;
    const sy = ry < 0 ? -1 : 1;
    let sdx = rx < 0 ? (ox - mx) * ddx : (mx + 1 - ox) * ddx;
    let sdy = ry < 0 ? (oy - my) * ddy : (my + 1 - oy) * ddy;
    let dist = 0;
    let kind = '';
    let sideX = false;
    for (let n = 0; n < 24; n++) {
      if (sdx < sdy) { dist = sdx; sdx += ddx; mx += sx; sideX = true; } else { dist = sdy; sdy += ddy; my += sy; sideX = false; }
      const enterDir = sideX ? (sx > 0 ? 1 : 3) : sy > 0 ? 2 : 0;
      const s = surfaceOf(map, doors, mx, my, enterDir);
      if (s === 'wall' || s === 'door' || s === 'stairs') { kind = s; break; }
    }
    if (!kind) continue;
    const h = Math.min(VIEW_H, Math.round(VIEW_H / Math.max(dist, 0.2) * 0.9));
    const top = Math.round(half - h / 2);
    const shade = Math.max(0.25, 1 - dist / 8) * (sideX ? 0.8 : 1);
    const c = COL[kind]!;
    for (let y = Math.max(0, top); y < Math.min(VIEW_H, top + h); y++) {
      const i = (y * VIEW_W + col) * 4;
      out[i] = c[0] * shade; out[i + 1] = c[1] * shade; out[i + 2] = c[2] * shade;
    }
  }
  return out;
}
