/**
 * Rendering helpers shared by the Dungeon Master / Chaos Strikes Back /
 * Dungeon Master II extractors: a top-down per-level square-type map (a
 * diagram — synthetic colours, not decoded game palette) and a simple
 * shelf-packed greyscale atlas for `IMGx` items (real decoded pixel
 * *indices*, rendered on a 16-level greyscale ramp because the real Amiga
 * 16-colour palette is not yet recovered from the executable — see
 * `docs/dungeonmaster-format.md` § "Palette — open").
 */
import type { ParsedMap, Square, SquareType } from './dungeonmaster-dungeon.ts';
import type { DecodedImage } from './dungeonmaster-codec.ts';

const CELL = 10; // px per dungeon square in the top-down diagram

const TYPE_COLOR: Record<SquareType, [number, number, number]> = {
  wall: [40, 40, 48],
  floor: [210, 200, 180],
  pit: [30, 30, 90],
  stairs: [90, 200, 90],
  door: [180, 120, 40],
  teleporter: [160, 60, 200],
  trickwall: [90, 90, 110],
  empty: [15, 15, 15],
};

function putPx(rgba: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= w) return;
  const o = (y * w + x) * 4;
  rgba[o] = r;
  rgba[o + 1] = g;
  rgba[o + 2] = b;
  rgba[o + 3] = a;
}

function fillCell(rgba: Uint8Array, atlasW: number, cx: number, cy: number, sq: Square) {
  const [r, g, b] = TYPE_COLOR[sq.type];
  for (let dy = 1; dy < CELL - 1; dy++) {
    for (let dx = 1; dx < CELL - 1; dx++) putPx(rgba, atlasW, cx * CELL + dx, cy * CELL + dy, r, g, b);
  }
  if (sq.hasObject) {
    // Small bright marker in the corner for squares carrying an item/monster/etc.
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) putPx(rgba, atlasW, cx * CELL + 1 + dx, cy * CELL + 1 + dy, 255, 220, 60);
  }
}

/** Render one map's square grid as a top-down colour-coded diagram (RGBA). */
export function renderMapTopDown(map: ParsedMap): { rgba: Uint8Array; width: number; height: number } {
  const width = map.def.width * CELL;
  const height = map.def.height * CELL;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < map.def.height; y++) {
    for (let x = 0; x < map.def.width; x++) fillCell(rgba, width, x, y, map.squares[y][x]);
  }
  return { rgba, width, height };
}

export interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pack decoded `IMGx` images into one greyscale RGBA atlas via a simple
 * shelf (row) packer. Pixel index -1 (transparent) renders alpha 0;
 * indices 0-15 map to a linear grey ramp (`index * 17`).
 */
export function packGreyscaleAtlas(
  images: { name: string; img: DecodedImage }[],
  maxWidth = 1024,
): { rgba: Uint8Array; width: number; height: number; frames: AtlasFrame[] } {
  const frames: AtlasFrame[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let atlasW = 0;
  for (const { name, img } of images) {
    if (shelfX + img.width > maxWidth) {
      shelfY += shelfH + 1;
      shelfX = 0;
      shelfH = 0;
    }
    frames.push({ name, x: shelfX, y: shelfY, w: img.width, h: img.height });
    shelfX += img.width + 1;
    shelfH = Math.max(shelfH, img.height);
    atlasW = Math.max(atlasW, shelfX);
  }
  const atlasH = shelfY + shelfH;
  const rgba = new Uint8Array(atlasW * atlasH * 4);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const { img } = images[i];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const idx = img.pixels[y * img.width + x];
        if (idx < 0) continue; // leave transparent (rgba already zero-initialized)
        const v = idx * 17;
        putPx(rgba, atlasW, f.x + x, f.y + y, v, v, v);
      }
    }
  }
  return { rgba, width: atlasW, height: atlasH, frames };
}
