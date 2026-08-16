/**
 * Browser-safe SNES Wizardry 6 dungeon-view model. Pure (no Node/DOM
 * imports) so both a Node verification renderer and the browser walker
 * harness (`tools/walker/games-w6-snes.ts`) share it -- same pattern as
 * the Amiga port's `view-model.ts`.
 *
 * This is a **v1, honestly-approximate** dispatch, not a full port of the
 * SNES engine's own 26-slot/wallValue render dispatch (`data-structure.md`
 * §3.14.5/§3.14.7) -- that dispatch's final wallValue -> table-index
 * mapping (`$80:DE1B`'s second-stage lookup) is not fully traced (see
 * `docs/wizardry6/TODO.md` row `snes-dungeon-view-wall-dispatch`). What
 * *is* newly confirmed this session (§3.14.11): every one of the 15
 * bank-`$89` per-depth/per-direction "wallValue table" addresses §3.14.5
 * already cites resolves its **index-1 entry** to the *exact* `(x,y,w,h)`
 * placement §3.14.5's own table gives for that direction/depth -- 15/15,
 * `resolveComposeWord` in `decode-dungeon-composer.ts`. That's decisive
 * confirmation of the table *shape* and geometry, even without the
 * wallValue -> index mapping: index 1 is always a real, correctly-placed
 * "this direction is blocked" wall piece, and index 0 is uniformly the
 * literal value `0x101` (an odd, non-decodable "open, draw nothing"
 * sentinel -- distinct from the ordinary `0xFFFF` "slot unused" marker
 * `parseLibrary` already handles) across all 15 tables, matching the raw
 * wall field's own `0 == open` convention exactly.
 *
 * **v1 dispatch, one rule per direction per depth:**
 * - raw 2-bit wall field `0` -> open, draw nothing.
 * - raw 2-bit wall field `1`/`2`/`3` -> draw that direction/depth's table
 *   **index-1** entry (the confirmed-placement generic wall). This does
 *   NOT distinguish door/torch/decorated-wall variants from a plain wall
 *   -- the real per-wallValue art selection remains open.
 * - **Exception, fully confirmed** (§3.14.7): feature nibble `== 6` at
 *   depth 1 dead ahead (frustum slot 3) always draws the fixed door piece
 *   (compose word `0x02E8`), overriding the generic-wall rule.
 */

export interface DenseMazeGrid {
  width: number;
  height: number;
  /** Raw SNES wall byte per cell, row-major (`y*width+x`). Bits 0-1 = wall
   * on the +Y (`facing===0`, north) side, 2-3 = +X (east), 4-5 = -Y
   * (south), 6-7 = -X (west) -- confirmed absolute mapping,
   * `data-structure.md` §3.14.8's cross-platform table. Off-map cells are
   * filled `0xFF` (solid on all 4 sides). */
  wall: Uint8Array;
  /** Raw SNES feature byte per cell (bits 0-3 feature code incl. the
   * `0x0D`/`0x0E` "no feature" sentinels, 4-5 orientation, 6-7 SNES-only
   * flags, §3.14.8). Off-map cells filled `0x0D`. */
  feature: Uint8Array;
}

export interface MazeLevelRaw {
  level: number;
  origins: Array<{ x: number; y: number }>;
  cells: Array<{ region: number; major: number; minor: number; wall: number; feature: number }>;
}

const OFFMAP_WALL = 0xff; // all 4 packed 2-bit sub-fields = 3 (solid)
const OFFMAP_FEATURE = 0x0d; // the confirmed "no feature" sentinel

/**
 * Densify one level's region/major/minor cell list (raw `data/maze.json`
 * shape, `decode-maze.ts`) into a flat grid, tight-cropped to the active
 * regions' bounding box -- same convention as the Amiga port's
 * `export-dungeon-levels.ts` `densifyLevel`. `major`/`minor` place a cell
 * within its region: **global Y = originY + (7 - major)`, global X =
 * originX + minor`** (the confirmed major-axis reversal, §3.14.8 -- SNES
 * `major` runs opposite to the Amiga's `localY`).
 */
export function densifyMazeLevel(level: MazeLevelRaw): DenseMazeGrid {
  const usedRegions = new Set(level.cells.map((c) => c.region));
  const origins = level.origins.filter((_, i) => usedRegions.has(i));
  // A region spans originX..originX+7 in global X (minor 0..7 direct), and
  // originY..originY+7 in global Y (major 7..0 after the confirmed reversal
  // -- major=7 gives the SMALLEST global Y, major=0 the LARGEST).
  const minX = Math.min(...origins.map((o) => o.x));
  const minY = Math.min(...origins.map((o) => o.y));
  const maxX = Math.max(...origins.map((o) => o.x + 7));
  const maxY = Math.max(...origins.map((o) => o.y + 7));

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const wall = new Uint8Array(width * height).fill(OFFMAP_WALL);
  const feature = new Uint8Array(width * height).fill(OFFMAP_FEATURE);

  for (const cell of level.cells) {
    const origin = level.origins[cell.region];
    if (!origin) continue;
    const gx = origin.x + cell.minor - minX;
    const gy = origin.y + (7 - cell.major) - minY;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
    const idx = gy * width + gx;
    wall[idx] = cell.wall;
    feature[idx] = cell.feature;
  }

  return { width, height, wall, feature };
}

/** Extract the 2-bit wall sub-field for absolute compass `facing` (0=N/+Y, 1=E/+X, 2=S/-Y, 3=W/-X -- `@seer-project/dungeon`'s `Direction.ts` convention) directly from one cell's raw wall byte. No neighbour lookup needed -- the SNES stores all 4 absolute sides redundantly per cell (§3.14.7/§3.14.8), unlike the Amiga's shared-edge two-plane scheme. */
export function wallForFacing(wallByte: number, facing: 0 | 1 | 2 | 3): number {
  return (wallByte >> (facing * 2)) & 0x3;
}

/** Decode a raw feature byte into its feature code (0-15, `0x0D`/`0x0E` sentinels normalised to 0 = "no feature") and 2-bit orientation. */
export function featureOf(byte: number): { feature: number; orient: number } {
  const nibble = byte & 0x0f;
  const isEmpty = nibble === 0x0d || nibble === 0x0e;
  return { feature: isEmpty ? 0 : nibble, orient: (byte >> 4) & 0x3 };
}

const FACING_DELTAS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: 1 }, // 0 = N
  { dx: 1, dy: 0 }, // 1 = E
  { dx: 0, dy: -1 }, // 2 = S
  { dx: -1, dy: 0 }, // 3 = W
];

export function stepForward(x: number, y: number, facing: number, depth: number): { x: number; y: number } {
  const d = FACING_DELTAS[facing]!;
  return { x: x + d.dx * depth, y: y + d.dy * depth };
}

function inBounds(grid: DenseMazeGrid, x: number, y: number): boolean {
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

function cellWallByte(grid: DenseMazeGrid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.wall[y * grid.width + x]! : OFFMAP_WALL;
}

function cellFeatureByte(grid: DenseMazeGrid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.feature[y * grid.width + x]! : OFFMAP_FEATURE;
}

/** Whether the party can step one cell in compass direction `dir` from `(x, y)` -- open iff that direction's wall sub-field is 0. */
export function canStepSnes(grid: DenseMazeGrid, x: number, y: number, dir: 0 | 1 | 2 | 3): boolean {
  const dest = stepForward(x, y, dir, 1);
  if (!inBounds(grid, dest.x, dest.y)) return false;
  return wallForFacing(cellWallByte(grid, x, y), dir) === 0;
}

export const MAX_DEPTH = 3; // depths 0..2 -- matches the 3 confirmed bank-$89 table addresses this v1 uses (front0-2/left0-2/right0-2)

export type ViewOp =
  | { kind: 'backdrop' }
  | { kind: 'front' | 'left' | 'right'; depth: number }
  | { kind: 'door' };

/**
 * Resolve the v1 draw op list for one pose: always the backdrop, then a
 * generic-wall op per depth/direction wherever that direction's wall
 * sub-field is nonzero, with the confirmed depth-1/front door override.
 * Draw order is far-to-near (the caller composites back-to-front) so a
 * nearer wall overdraws whatever backdrop/farther-wall art it occludes.
 */
export function resolveViewOps(grid: DenseMazeGrid, x: number, y: number, facing: number): ViewOp[] {
  const ops: ViewOp[] = [{ kind: 'backdrop' }];

  for (let depth = MAX_DEPTH - 1; depth >= 0; depth--) {
    const cell = stepForward(x, y, facing, depth);
    const wallByte = cellWallByte(grid, cell.x, cell.y);
    const featByte = cellFeatureByte(grid, cell.x, cell.y);
    const { feature } = featureOf(featByte);

    const frontVal = wallForFacing(wallByte, facing as 0 | 1 | 2 | 3);
    const leftVal = wallForFacing(wallByte, ((facing + 3) % 4) as 0 | 1 | 2 | 3);
    const rightVal = wallForFacing(wallByte, ((facing + 1) % 4) as 0 | 1 | 2 | 3);

    // Confirmed door override (§3.14.7): feature==6, frustum slot 3 == depth 1 dead ahead.
    if (depth === 1 && feature === 6) {
      ops.push({ kind: 'door' });
    } else if (frontVal !== 0) {
      ops.push({ kind: 'front', depth });
    }
    if (leftVal !== 0) ops.push({ kind: 'left', depth });
    if (rightVal !== 0) ops.push({ kind: 'right', depth });
  }

  return ops;
}

// ─────────────────────────────────────────────────────────────────────────
// Pixel compositing -- pure array ops, shared by the Node verification
// renderer (`render-through-dungeon.ts`) and the browser walker
// (`tools/walker/games-w6-snes.ts`). Neither needs a DOM/canvas dependency
// here: both decode their PNGs to RGBA however suits their environment
// (pngjs in Node, `<canvas>` readback in the browser) and hand the raw
// bytes to `extractPoolIndices`/`compositeSnesView`.
// ─────────────────────────────────────────────────────────────────────────

export interface ViewPiece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Row-major pool-tile index (0..10239) or `null` for an empty/out-of-pool cell. */
  cells: (number | null)[];
}

export interface ViewPiecesFile {
  viewport: { w: number; h: number };
  tileSize: number;
  poolAtlas: string;
  poolCols: number;
  backdrop: ViewPiece;
  door: ViewPiece;
  wall: Record<'front' | 'left' | 'right', (ViewPiece | null)[]>;
}

/** Recover the raw pool-tile index buffer (0-15 per pixel) from a decoded `dungeon-art-indexed.png` RGBA buffer -- the index was written into the R channel at export time (`export-dungeon-view.ts`). */
export function extractPoolIndices(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = rgba[i * 4]!;
  return out;
}

/** One flat RGBA color, `[r,g,b]` (0-255 each); index 0 is always transparent (the confirmed BG-transparent slot, §3.14.10) and never sampled here since a pool index of 0 is skipped. */
export type Palette16 = ReadonlyArray<{ r: number; g: number; b: number }>;

function blitPiece(
  dest: Uint8ClampedArray,
  destW: number,
  destH: number,
  piece: ViewPiece,
  tileSize: number,
  pool: Uint8Array,
  poolW: number,
  poolCols: number,
  palette: Palette16,
): void {
  for (let row = 0; row < piece.h; row++) {
    for (let col = 0; col < piece.w; col++) {
      const tileIdx = piece.cells[row * piece.w + col];
      if (tileIdx === null || tileIdx === undefined) continue;
      const srcTileX = (tileIdx % poolCols) * tileSize;
      const srcTileY = Math.floor(tileIdx / poolCols) * tileSize;
      const dstX0 = (piece.x + col) * tileSize;
      const dstY0 = (piece.y + row) * tileSize;
      for (let py = 0; py < tileSize; py++) {
        const dy = dstY0 + py;
        if (dy < 0 || dy >= destH) continue;
        for (let px = 0; px < tileSize; px++) {
          const dx = dstX0 + px;
          if (dx < 0 || dx >= destW) continue;
          const paletteIdx = pool[(srcTileY + py) * poolW + (srcTileX + px)]!;
          if (paletteIdx === 0) continue; // transparent
          const c = palette[paletteIdx];
          if (!c) continue;
          const o = (dy * destW + dx) * 4;
          dest[o] = c.r;
          dest[o + 1] = c.g;
          dest[o + 2] = c.b;
          dest[o + 3] = 255;
        }
      }
    }
  }
}

/** Composite one pose's resolved `ViewOp`s into a fresh `viewport.w*tileSize x viewport.h*tileSize` RGBA buffer. */
export function compositeSnesView(
  viewPieces: ViewPiecesFile,
  pool: Uint8Array,
  poolW: number,
  palette: Palette16,
  ops: ViewOp[],
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = viewPieces.viewport.w * viewPieces.tileSize;
  const height = viewPieces.viewport.h * viewPieces.tileSize;
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Fill black first: the confirmed backdrop piece (§3.14.6) has a real,
  // legitimate transparent void where the corridor continues (the doorway
  // opening / floor perspective) -- there is no confirmed always-drawn
  // floor/ceiling-continuation piece for SNES yet (the Amiga port has an
  // analogous, still-open gap of its own, `walker-user-reported-inaccuracy`
  // in docs/wizardry6/TODO.md). A black fill reads as dungeon shadow rather
  // than a broken/missing-texture hole.
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const blit = (piece: ViewPiece | null | undefined) => {
    if (!piece) return;
    blitPiece(rgba, width, height, piece, viewPieces.tileSize, pool, poolW, viewPieces.poolCols, palette);
  };

  for (const op of ops) {
    if (op.kind === 'backdrop') blit(viewPieces.backdrop);
    else if (op.kind === 'door') blit(viewPieces.door);
    else blit(viewPieces.wall[op.kind][op.depth]);
  }

  return { rgba, width, height };
}
