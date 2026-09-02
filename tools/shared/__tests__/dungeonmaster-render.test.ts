import { describe, it, expect } from 'vitest';
import { renderMapTopDown, packGreyscaleAtlas } from '../dungeonmaster-render.ts';
import type { ParsedMap, Square } from '../dungeonmaster-dungeon.ts';
import type { DecodedImage } from '../dungeonmaster-codec.ts';

function sq(type: Square['type'], hasObject = false): Square {
  return { type, hasObject, attr: 0 };
}

describe('renderMapTopDown', () => {
  it('renders a 2x2 map at 10px/cell with the object marker only on flagged squares', () => {
    const map: ParsedMap = {
      def: { index: 0, mapDataOffsetWords: 0, offsetX: 0, offsetY: 0, width: 2, height: 2, level: 0, floorRandomCount: 0, floorCount: 0, wallRandomCount: 0, wallCount: 0, difficulty: 0, creatureTypesCount: 0, doorDecoCount: 0, doorType1Index: 0, doorType0Index: 0, mapGraphicsStyle: 0, floorCeilingStyle: 0 },
      squares: [
        [sq('wall'), sq('floor', true)],
        [sq('floor'), sq('door')],
      ],
      creatureGraphics: [],
      wallDecoGraphics: [],
      floorDecoGraphics: [],
      doorDecoGraphics: [],
    };
    const { rgba, width, height } = renderMapTopDown(map);
    expect(width).toBe(20);
    expect(height).toBe(20);
    expect(rgba).toHaveLength(20 * 20 * 4);

    // Object marker (bright yellow-ish) appears somewhere in the (1,0) cell
    // (top-right, the floor square with hasObject=true), and nowhere in the
    // (0,0) wall cell (hasObject=false).
    const px = (x: number, y: number) => {
      const o = (y * width + x) * 4;
      return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
    };
    expect(px(11, 1)).toEqual([255, 220, 60, 255]); // marker corner of cell (1,0)
    expect(px(1, 1)).not.toEqual([255, 220, 60, 255]); // cell (0,0), no marker
  });
});

describe('packGreyscaleAtlas', () => {
  it('shelf-packs images left-to-right, wrapping to a new row past maxWidth', () => {
    const img = (w: number, h: number, fill: number): DecodedImage => ({
      width: w,
      height: h,
      pixels: new Int16Array(w * h).fill(fill),
    });
    const images = [
      { name: 'a', img: img(6, 4, 15) }, // max grey value (15*17=255)
      { name: 'b', img: img(6, 4, -1) }, // fully transparent
    ];
    const atlas = packGreyscaleAtlas(images, 10); // maxWidth=10 forces a wrap after 'a'
    expect(atlas.frames).toEqual([
      { name: 'a', x: 0, y: 0, w: 6, h: 4 },
      { name: 'b', x: 0, y: 5, w: 6, h: 4 }, // wrapped: shelfY = 0 + shelfH(4) + 1
    ]);
    expect(atlas.width).toBe(7); // shelfX reaches w(6)+1 gutter = 7 before wrapping
    expect(atlas.height).toBe(9); // 4 (row0) + 1 (gutter) + 4 (row1)

    // 'a' is solid white (index 15 -> grey 255), alpha 255.
    const oA = (1 * atlas.width + 1) * 4;
    expect(Array.from(atlas.rgba.subarray(oA, oA + 4))).toEqual([255, 255, 255, 255]);
    // 'b' is fully transparent (alpha 0).
    const oB = ((5 + 1) * atlas.width + 1) * 4;
    expect(atlas.rgba[oB + 3]).toBe(0);
  });
});
