/**
 * Abandoned Places 2 (Amiga): how a dungeon image's pixel values reach the screen, and the
 * 64-entry screen palette they index. Spec: docs/abandonedplaces2/amiga/data-structure.md §5.1.
 * Offsets are hunk offsets in the unpacked `main` (= file offset - 0x20).
 *
 * - The dungeon screen is **6 bitplanes, EHB** (one copper list, `main`+0x14E80, BPLCON0 = 0x6200);
 *   screen values 32-63 show colour (v-32) at half brightness (each 4-bit gun >> 1).
 * - Colour registers 0-31 come from target buffer `$5346`, which holds `display.clr` (startup list
 *   +0x168B6 -> dest table +0x16A66). On level load `set_NN.clr` is read into `$5342` (+0x12396) and
 *   **only its first 16 words** are copied into `$5346` (+0x47E4, `moveq #15` loop) before the
 *   fade-in (+0x486E). So: 0-15 = set_NN, 16-31 = display.clr[16..31]. set_NN[16..31] never shows.
 * - Images are blitted plane by plane through a bitmap descriptor's plane-pointer list
 *   (blitter +0x5F6E: image plane k -> pointer slot k; slots past the image's planes are filled
 *   from def word 9, which is 0 for every dungeon family). The view buffer descriptors have
 *   **swapped** pointers (set-up +0x3A84 / +0x3AE4 / +0x3B44):
 *     desc 4 (walls +0x7D2C, floor +0x7282, pits, gates, stairs, ceiling objects): slots 3 <-> 5
 *     desc 8 (on-wall decorations +0x6C4C) and desc 9 (monsters +0x70CA, chests, fire, water): 4 <-> 5
 *   so a 4-plane wall's plane 3 is the EHB plane, and a 5-plane monster's plane 4 is.
 */
import type { RGB } from '../../shared/amiga-planar.ts';

/** image plane k -> screen plane, per view-buffer descriptor. */
export const PLANE_MAP = {
  desc4: [0, 1, 2, 5, 4, 3],
  desc8: [0, 1, 2, 3, 5, 4],
  identity: [0, 1, 2, 3, 4, 5],
} as const;
export type PlaneMapName = keyof typeof PLANE_MAP;

const DESC4 = new Set(['wl', 'fl', 'pit', 'gt', 'strd', 'stru', 'obj', 'sww', 'swg', 'swp']);
const DESC8 = new Set(['onwl', 'mon', 'chest', 'fire', 'water']);

/** Which plane mapping the game uses for a triplet base name (`wl_00`, `mon_17`, `chest` ...). */
export function planeMapFor(base: string): PlaneMapName {
  const fam = base.replace(/_\d\d$/, '');
  if (DESC4.has(fam)) return 'desc4';
  if (DESC8.has(fam)) return 'desc8';
  return 'identity'; // UI images (items in the inventory, icons, fonts ...): plain screen planes
}

/** Image pixel value -> screen pixel value (0..63). */
export function toScreenIndex(v: number, map: PlaneMapName): number {
  const m = PLANE_MAP[map];
  let out = 0;
  for (let k = 0; k < 6; k++) if (v & (1 << k)) out |= 1 << m[k];
  return out;
}

/** EHB half-bright: shift each 4-bit gun right by one (on the nibble, not the 8-bit value). */
export function halfBright(c: RGB): RGB {
  const h = (x: number) => ((Math.round(x / 17) >> 1) * 17);
  return { r: h(c.r), g: h(c.g), b: h(c.b) };
}

/** 64-entry screen palette for a dungeon set: set[0..15] + display[16..31] + EHB halves. */
export function screenPalette(set: RGB[], display: RGB[]): RGB[] {
  const black = { r: 0, g: 0, b: 0 };
  const base: RGB[] = [];
  for (let i = 0; i < 16; i++) base.push(set[i] ?? black);
  for (let i = 16; i < 32; i++) base.push(display[i] ?? black);
  return [...base, ...base.map(halfBright)];
}
