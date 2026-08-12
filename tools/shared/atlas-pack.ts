/**
 * Simple shelf-packing atlas layout.
 *
 * Generic, format-agnostic: given a list of named rectangle sizes, computes
 * (x, y) placement for each into a bounded-width atlas, growing height as
 * needed. Not space-optimal (no bin-packing search) -- good enough for
 * offline pipeline atlases where build time matters more than a few percent
 * of wasted pixels. Reuse this instead of writing a new packer per game.
 */

export interface PackInput {
  name: string;
  width: number;
  height: number;
}

export interface PackedRect extends PackInput {
  x: number;
  y: number;
}

export interface PackResult {
  frames: PackedRect[];
  width: number;
  height: number;
}

/**
 * Shelf-pack rectangles left-to-right into rows no wider than `maxWidth`,
 * starting a new row (a "shelf") once the current one would overflow.
 * Input order is preserved within each shelf; sort by descending height
 * first if you want tighter packing.
 */
export function shelfPack(items: PackInput[], maxWidth: number, padding = 1): PackResult {
  const frames: PackedRect[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  let atlasWidth = 0;

  for (const item of items) {
    if (cursorX > 0 && cursorX + item.width > maxWidth) {
      cursorX = 0;
      cursorY += shelfHeight + padding;
      shelfHeight = 0;
    }
    frames.push({ ...item, x: cursorX, y: cursorY });
    cursorX += item.width + padding;
    shelfHeight = Math.max(shelfHeight, item.height);
    atlasWidth = Math.max(atlasWidth, cursorX - padding);
  }

  return { frames, width: atlasWidth, height: cursorY + shelfHeight };
}
