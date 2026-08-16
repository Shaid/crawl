/**
 * Eye of the Beholder (Amiga) `.VMP` wall-view mapping table decoder.
 *
 * Structure confirmed for Amiga by `docs/eotb/amiga/data-structure.md` §
 * "VMP -- Wall View Mapping Table" (5,834 bytes = 2-byte header + 330
 * backdrop indices + 6*431 wall-type indices, all u16, "identical across
 * all wall sets" -- verified: this repo's own `BRICK.VMP`/`BLUE.VMP`/etc.
 * are all exactly 5834 bytes). The per-index bit layout (14-bit tile
 * index + mirror-x + z-mask) and the 25-position `wallRenderData`
 * placement table are from `docs/eotb/amiga/eotb-vmp-spec.md`
 * (ModdingWiki, PC-sourced pseudocode) -- not independently re-derived
 * from Amiga disassembly this session, carried over as the best available
 * oracle for the geometry, which is engine-shared across ports per that
 * doc's own "Games: EOB, EOB2, LoL" byline.
 *
 * **Endianness -- determined empirically, not cited.** The ModdingWiki
 * page states the PC/LoL `.VMP` index array is a flat `unsigned short[]`
 * with no byte-order specified, but doesn't cover Amiga. Every other
 * confirmed Amiga format in this family (`.VCN`'s palette words, `.CPS`'s
 * palette words) uses **big-endian** words. Reading this file's first 15
 * backdrop indices as BE gives the clean ascending run 1,2,3,...,15 (a
 * plausible straightforward raster-order tile layout); reading the same
 * bytes as LE gives 256,512,768,...,3840 (implausible: no reason
 * backdrop tiles would be authored as multiples of 256). Went with BE on
 * that structural evidence, and added a hard oracle check
 * (`decodeVmp` throws if any resolved tile index exceeds `numTiles`) so a
 * wrong guess fails loudly instead of rendering garbage.
 */
export interface VmpTileRef {
  tileIndex: number;
  mirrorX: boolean;
  zMask: boolean;
}

export interface VmpData {
  header: number;
  /** [x][y], 22 wide x 15 tall. */
  backdrop: VmpTileRef[][];
  /** [wallType 0-5][431]. */
  wallTiles: VmpTileRef[][];
}

const BACKDROP_W = 22;
const BACKDROP_H = 15;
const WALL_TYPES = 6;
const WALL_RUN = 431;

function decodeRef(word: number): VmpTileRef {
  return {
    tileIndex: word & 0x3fff,
    mirrorX: (word & 0x4000) !== 0,
    zMask: (word & 0x8000) !== 0,
  };
}

export function decodeVmp(data: Uint8Array, numTiles: number): VmpData {
  // Empirically confirmed against the real corpus (`docs/eotb/amiga/data-structure.md`
  // § "VMP -- Wall View Mapping Table": "330 backdrop + 431*6 wall = 2916
  // words = 5832 bytes + 2 header = 5834") -- every real `.VMP` in this
  // corpus is exactly this size, with NO 101-word backdrop padding
  // between the backdrop block and the first wall-type block. The
  // ModdingWiki PC-era spec's `padding[101]` field does not apply here.
  const expected = 2 + (BACKDROP_W * BACKDROP_H + WALL_TYPES * WALL_RUN) * 2;
  if (data.length !== expected) {
    throw new Error(`decodeVmp: oracle check failed -- expected ${expected} bytes, got ${data.length}`);
  }

  let p = 0;
  const readWord = () => {
    const w = ((data[p]! << 8) | data[p + 1]!) & 0xffff;
    p += 2;
    return w;
  };

  const header = readWord();

  const backdrop: VmpTileRef[][] = [];
  for (let x = 0; x < BACKDROP_W; x++) {
    const col: VmpTileRef[] = [];
    for (let y = 0; y < BACKDROP_H; y++) col.push(decodeRef(readWord()));
    backdrop.push(col);
  }
  const wallTiles: VmpTileRef[][] = [];
  for (let t = 0; t < WALL_TYPES; t++) {
    const run: VmpTileRef[] = [];
    for (let i = 0; i < WALL_RUN; i++) run.push(decodeRef(readWord()));
    wallTiles.push(run);
  }

  let maxIndex = 0;
  for (const col of backdrop) for (const ref of col) maxIndex = Math.max(maxIndex, ref.tileIndex);
  for (const run of wallTiles) for (const ref of run) maxIndex = Math.max(maxIndex, ref.tileIndex);
  if (maxIndex >= numTiles) {
    throw new Error(
      `decodeVmp: oracle check failed -- a resolved tile index (${maxIndex}) is >= numTiles (${numTiles}); endianness/layout guess is likely wrong`,
    );
  }

  return { header, backdrop, wallTiles };
}

/** One of the 25 fixed wall-projection screen positions (`docs/eotb/amiga/eotb-vmp-spec.md` § "Render Code"). */
export interface WallRenderSlot {
  label: string;
  baseOffset: number;
  offsetInViewport: number;
  widthBlocks: number;
  heightBlocks: number;
  skip: number;
  flipX: boolean;
}

export const WALL_RENDER_SLOTS: WallRenderSlot[] = [
  { label: 'A-east', baseOffset: 104, offsetInViewport: 66, widthBlocks: 5, heightBlocks: 1, skip: 2, flipX: false },
  { label: 'B-east', baseOffset: 102, offsetInViewport: 68, widthBlocks: 5, heightBlocks: 3, skip: 0, flipX: false },
  { label: 'C-east', baseOffset: 97, offsetInViewport: 74, widthBlocks: 5, heightBlocks: 1, skip: 0, flipX: false },
  { label: 'E-west', baseOffset: 97, offsetInViewport: 79, widthBlocks: 5, heightBlocks: 1, skip: 0, flipX: true },
  { label: 'F-west', baseOffset: 102, offsetInViewport: 83, widthBlocks: 5, heightBlocks: 3, skip: 0, flipX: true },
  { label: 'G-west', baseOffset: 104, offsetInViewport: 87, widthBlocks: 5, heightBlocks: 1, skip: 2, flipX: true },
  { label: 'B-south', baseOffset: 133, offsetInViewport: 66, widthBlocks: 5, heightBlocks: 2, skip: 4, flipX: false },
  { label: 'C-south', baseOffset: 129, offsetInViewport: 68, widthBlocks: 5, heightBlocks: 6, skip: 0, flipX: false },
  { label: 'D-south', baseOffset: 129, offsetInViewport: 74, widthBlocks: 5, heightBlocks: 6, skip: 0, flipX: false },
  { label: 'E-south', baseOffset: 129, offsetInViewport: 80, widthBlocks: 5, heightBlocks: 6, skip: 0, flipX: false },
  { label: 'F-south', baseOffset: 129, offsetInViewport: 86, widthBlocks: 5, heightBlocks: 2, skip: 4, flipX: false },
  { label: 'H-east', baseOffset: 117, offsetInViewport: 66, widthBlocks: 6, heightBlocks: 2, skip: 0, flipX: false },
  { label: 'I-east', baseOffset: 81, offsetInViewport: 50, widthBlocks: 8, heightBlocks: 2, skip: 0, flipX: false },
  { label: 'K-west', baseOffset: 81, offsetInViewport: 58, widthBlocks: 8, heightBlocks: 2, skip: 0, flipX: true },
  { label: 'L-west', baseOffset: 117, offsetInViewport: 86, widthBlocks: 6, heightBlocks: 2, skip: 0, flipX: true },
  { label: 'I-south', baseOffset: 163, offsetInViewport: 44, widthBlocks: 8, heightBlocks: 6, skip: 4, flipX: false },
  { label: 'J-south', baseOffset: 159, offsetInViewport: 50, widthBlocks: 8, heightBlocks: 10, skip: 0, flipX: false },
  { label: 'K-south', baseOffset: 159, offsetInViewport: 60, widthBlocks: 8, heightBlocks: 6, skip: 4, flipX: false },
  { label: 'M-east', baseOffset: 45, offsetInViewport: 25, widthBlocks: 12, heightBlocks: 3, skip: 0, flipX: false },
  { label: 'O-west', baseOffset: 45, offsetInViewport: 38, widthBlocks: 12, heightBlocks: 3, skip: 0, flipX: true },
  { label: 'M-south', baseOffset: 252, offsetInViewport: 22, widthBlocks: 12, heightBlocks: 3, skip: 13, flipX: false },
  { label: 'O-south', baseOffset: 239, offsetInViewport: 41, widthBlocks: 12, heightBlocks: 3, skip: 13, flipX: false },
  { label: 'N-south', baseOffset: 239, offsetInViewport: 25, widthBlocks: 12, heightBlocks: 16, skip: 0, flipX: false },
  { label: 'P-east', baseOffset: 0, offsetInViewport: 0, widthBlocks: 15, heightBlocks: 3, skip: 0, flipX: false },
  { label: 'Q-west', baseOffset: 0, offsetInViewport: 19, widthBlocks: 15, heightBlocks: 3, skip: 0, flipX: true },
];

/** The 17 maze cells (A-Q) the 25 render slots are computed from, relative to the party at facing 0 (north), from the spec's diagram. Rotate by facing to get the real (dx,dy). */
export const CELL_OFFSETS: Record<string, [number, number]> = {
  A: [-3, -3], B: [-2, -3], C: [-1, -3], D: [0, -3], E: [1, -3], F: [2, -3], G: [3, -3],
  H: [-2, -2], I: [-1, -2], J: [0, -2], K: [1, -2], L: [2, -2],
  M: [-1, -1], N: [0, -1], O: [1, -1],
  P: [-1, 0], Q: [1, 0],
};
