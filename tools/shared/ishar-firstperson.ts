/**
 * Ishar 1 (Amiga AGA) first-person outdoor renderer — composites one real
 * frame of the frustum-scan first-person view for a given party
 * position/facing, by actually *executing* a location script's compiled
 * ALIS bytecode (`tools/shared/alis-interp.ts`) against the CONFIRMED
 * `CONT*.FIC` region grid (`tools/shared/ishar-regions.ts`) and the
 * CONFIRMED sprite/bitmap decoder (`tools/shared/ishar-sprites.ts`).
 *
 * Scope: the underlying machinery (`computeScenePlacements()`,
 * `compositeFrame()`, `renderIsharLocationFrame()`) is GENERAL — any Ishar 1
 * outdoor location script sharing the confirmed facing/ring-loop shell can be
 * passed in. Two scripts have been executed end-to-end and visually verified
 * this project: `FORET.bin` (forest, hand-verified byte-for-byte against the
 * reference source during the original `re-oracle` escalation — see
 * `docs/ishar-container-format.md` §8) and `VILLAGE.bin` (village/building
 * biome — shares FORET's exact per-ring elevation/scale constant table
 * byte-for-byte but dispatches its cell value via `cswitch2` against a real
 * building-style selector rather than FORET's `cswitch1` terrain selector;
 * verified against real `CONT1.FIC` cells in the `[-25,-1]` range, which
 * cluster in a real compound at x=52-56,y=14-20 — exactly where a visual
 * inspection of the decoded grid independently noted "building/compound
 * rectangles", see `docs/ishar-container-format.md` §9.1). `PLAINE.bin`
 * and `RAMPART.bin` were RENDERED in a later pass (§8.4) the same way.
 *
 * `TEMPLE.bin` — RENDERED (§8.7), superseding an earlier INCONCLUSIVE
 * verdict. Disassembles clean (252 instrs, 0 errors) under the same shell
 * shape (elevation table byte-identical) with its own cell-value dispatch
 * (`cswitch2 base=-10 count=6`). The earlier pass computed the accepted
 * value range as `[-10,-4]` and found only 4 matching cells corpus-wide,
 * which rendered inconclusively — that range was WRONG (a sign error: the
 * real formula, confirmed against `opcodes.c`'s `cswitch2` C source, is
 * `index = value + base`, so `value = index - base`, giving `[10,16]` for
 * `base=-10`, not `[value = index + base] = [-10,-4]`). The corrected range
 * has hundreds of real matches in `CONT3`/`CONT4`/`CONT6` and renders a
 * genuinely temple-like scene: values 11/12 place a MIRRORED PILLAR PAIR
 * (two placements at `dx=∓99` / `dx=∓113`) when facing north/south (i.e.
 * looking along a colonnade), and a smaller facade sprite when facing
 * east/west — a coherent architectural design, not noise. Uses its own
 * per-location backdrop `FTEMPLE.bin` (a stone-arch texture), confirmed as
 * TEMPLE's real companion asset via `MAIN.bin`'s manifest (`cload("ftemple.AO")`
 * immediately followed, byte-exact instruction-length apart with no branch
 * between, by `cload("temple.AO")`) rather than the shared `fond.bin` every
 * other Ishar 1 script here uses. `RAMPART.bin`/`PLAINE.bin` were RENDERED
 * in §8.4. Ishar 2/3 use different global-variable offsets and screen
 * geometry (see the module-level constants below, which are Ishar-1-specific)
 * — not re-derived this session.
 *
 * Confidence: the underlying algorithm execution is CONFIRMED for FORET and
 * VILLAGE (the interpreter reproduces, from real bytecode + real grid data +
 * a real party pose, exactly the per-ring elevation/lateral-scale constants
 * and per-cell sprite-index-base values that were hand-decoded and cross-
 * checked against `github.com/maestun/alis`'s C source — see
 * `alis-interp.ts`'s module doc). The sprite anchor is now source-confirmed
 * (centre-anchored, `compositeFrame()`, 2026-11-13); the rest of the PIXEL
 * COMPOSITING (backdrop layering, palette choice, the sky/ground fill) is
 * RENDERED: no real screenshot or emulator capture was available to check
 * pixel-exact placement.
 *
 * Grid orientation (2026-11-13): grid reads follow `tabchar()` (row = pop,
 * column = D7) and the walker frame is the TRANSPOSE of storage -- see
 * `RegionGridSource`.
 *
 * A benign artifact seen running EVERY script tried so far (FORET, VILLAGE,
 * and structurally in TEMPLE): after the real per-frame placement pass
 * completes and returns (`cret`), the calling shell's `cjsr(0x5a); cstart(N);
 * cjmp(back-to-cjsr)` idiom is the game's own "re-render every tick"
 * coroutine scheduler — `cstart` spawns a sibling task rather than
 * transferring control, which this interpreter (no task scheduler) treats
 * as a documented no-op and falls through into, producing a tight 2-
 * instruction infinite loop that the `STEP_BUDGET` catches and reports as
 * `'step budget exceeded'`. This is EXPECTED, not a bug: it happens strictly
 * AFTER the one real placement pass has already run and populated
 * `placements`, so it costs a fixed, cheap 200,000-step spin (sub-
 * millisecond) and does not affect output correctness.
 *
 * Colour (2026-09-01 addition, `ishar-palette.ts`): pass `LocationFrameOptions
 * .palette` (e.g. `resolveIsharOwnPalette(fond)` -- `FOND.bin`'s own
 * directory carries Ishar 1's real shared outdoor/world palette, a 256-entry
 * AGA RGB table, CONFIRMED via its `0xFE` palette marker plus a genuinely
 * plausible browns/greens/reds/blues colour structure that ALSO very closely
 * matches several other location scripts' own embedded copies -- see
 * `docs/ishar-sprite-format.md` §5) to render real colour instead of
 * greyscale. Omitting `palette` renders EXACTLY as before (default
 * unchanged, no regression to any existing caller).
 */

import { scriptEntryPoint } from './alis-disasm.ts';
import { runIsharScene, resolveIsharComposite, type SceneEnv } from './alis-interp.ts';
import { findIsharDirectory, resolveIsharSlot, decodeIsharBitmap, isharBitmapToNormalizedGreyscaleRGBA, type IsharBitmap } from './ishar-sprites.ts';
import { isharBitmapToPaletteRGBA, type IsharPalette } from './ishar-palette.ts';
import { unpackSilmarilsScript } from './silmarils-unpack.ts';

/**
 * Ishar 1's confirmed party-state/world globals (`docs/ishar-container-format.md`
 * §9, `basemain`-relative), named by their GRID-STORAGE role (2026-11-13,
 * `ishar-grid-index-transpose`): `tabchar()` (`maestun/alis` `alis.c:2073`)
 * addresses a `count=1` grid as `base + D7 + stride*pop`, so the popped value
 * is the ROW index (`0..53`) and the accumulator D7 the COLUMN index
 * (`0..89`, stride 90). The scripts' own view-edge clamps agree: `FORET.bin`
 * bounds `0x137c` by `54-v-1` (`+0xdd`/`+0x2a7`) and `0x137d` by `90-v-1`
 * (`+0x1d8`). Geographically the ROW index is the east-west axis and the
 * COLUMN index north-south -- the stored grid is the in-game map TRANSPOSED
 * (see `RegionGridSource`); the walker's `partyX`/`partyY` are therefore
 * row/column respectively.
 */
export const ISHAR1_GLOBALS = {
  /** Grid ROW index (popped by `tabchar`) = east-west = walker `partyX`. */
  partyRow: 0x137c,
  /** Grid COLUMN index (`tabchar`'s D7) = north-south = walker `partyY`. */
  partyCol: 0x137d,
  partyFacing: 0x137e,
  locationType: 0x1508,
  gridBufferA: 0x80,
  gridBufferB: 0x234a,
} as const;

/**
 * Ishar 1's game screen (`cscreen 0x000e`, defined by `MAIN.bin`'s own
 * `cdefsc` call) — CONFIRMED from `MAIN.bin`'s decompiled `cdefsc scr=0x000e`
 * 32-byte config block: `config[4:6]`/`config[6:8]` (u16 BE) give the
 * post-projection pixel X-center and horizon-line Y, `config[0xc:0xe]`/
 * `config[0xe:0x10]` give the viewport width/height, and `config[0x18]`
 * (0xff) confirms the perspective divide is disabled (matching the already-
 * confirmed `creducing`-negative-disables-divide finding). This corrects a
 * byte-offset transcription in the originating `re-oracle` escalation
 * (which cited +0xa/+0xc/+0x12/+0x14/+0x1c/+0x1d against the SAME 32-byte
 * block) — the VALUES match exactly (127/86/255/125), only the offsets were
 * off by a constant 5; re-derived directly from `MAIN.bin`'s real bytes
 * this session, not assumed.
 */
export const ISHAR1_GAME_SCREEN = { xCenter: 127, horizonY: 86, width: 255, height: 125 } as const;

/**
 * A `CONT*.FIC` region grid in its STORAGE layout: `width` = row stride
 * (number of columns: 90/60/57 for Ishar 1/2/3), `height` = number of rows,
 * cell `(col,row)` at byte `row*width + col` -- exactly `tabchar()`'s
 * `base + D7 + stride*pop` with `col = D7`, `row = pop`.
 *
 * Orientation (2026-11-13, CONFIRMED for Ishar 1/2 against each title's own
 * `MAP.DO` picture, and for all three by projection handedness): the stored
 * grid is the in-game world map TRANSPOSED -- ROW = east-west (x),
 * COLUMN = north-south (y, increasing southward). Drawn naively (columns
 * across, rows down) it is a mirror image of what the first-person view
 * shows: a cell one column to the display-left of the party's facing lands
 * on screen-RIGHT for every facing of every Ishar 1/2/3 script tested. The
 * walker therefore displays the transpose, and every renderer here takes
 * `partyX` = row, `partyY` = column.
 */
export interface RegionGridSource {
  width: number;
  height: number;
  /** Sign-extended cell reader for one buffer ('A' = `basemain+0x80`, 'B' = `basemain+0x234a`), storage-indexed: returns cell `row*width + col`. Ishar 1 has only one real layer -- pass the same reader for both. */
  read(buffer: 'A' | 'B', col: number, row: number): number;
}

/** Shared `count=1` `tabchar()` grid read for the Ishar 1/2/3 `CONT*.FIC` arrays: `row = pop()`, `col = direct` (D7). Out-of-range reads return 0. */
export function readStorageGrid(grid: RegionGridSource, buf: 'A' | 'B', pop: () => number, direct: number): number {
  const row = pop();
  const col = direct;
  if (row < 0 || col < 0 || col >= grid.width || row >= grid.height) return 0;
  return grid.read(buf, col, row);
}

function makeSceneEnv(globals: Record<number, number>, grid: RegionGridSource): SceneEnv {
  return {
    readMain(addr) {
      return globals[addr] ?? 0;
    },
    // Ishar 1's CONT grids are `cdim count=1` (a single row-width stride):
    // `tabchar()` = `base + D7 + stride*pop`, so the one `pop()` is the ROW
    // and `direct` (D7, the accumulator at call time) is the COLUMN.
    // (Before 2026-11-13 this was transposed -- `x = pop(), y = direct`.)
    readGrid(addr, pop, direct) {
      return readStorageGrid(grid, addr === ISHAR1_GLOBALS.gridBufferB ? 'B' : 'A', pop, direct);
    },
  };
}

export interface ScenePlacementLeaf {
  /** Screen-space, pre-projection: pixelX = screen.xCenter + x; pixelY = screen.horizonY - z. */
  x: number;
  z: number;
  /** World depth -- used only for far-to-near draw-order sorting, not a pixel coordinate. */
  sortY: number;
  bitmap: IsharBitmap;
  invertX: boolean;
}

/** Run one script's frame logic and resolve every `cput`/`cputnat`/`cxputat` placement's `idx` to real decoded bitmap(s) (recursively expanding composite records). Returns leaves in emission order (NOT sorted). */
export function computeScenePlacements(scriptData: Uint8Array, env: SceneEnv, warnings: string[]): ScenePlacementLeaf[] {
  const entry = scriptEntryPoint(scriptData);
  const { placements, warnings: runWarnings } = runIsharScene(scriptData, entry, env);
  warnings.push(...runWarnings);

  const dir = findIsharDirectory(scriptData);
  if (!dir) {
    warnings.push('script has no resource directory -- cannot resolve placement indices');
    return [];
  }
  const resolveSlot = (idx: number) => resolveIsharSlot(scriptData, dir, idx);

  const leaves: ScenePlacementLeaf[] = [];
  for (const p of placements) {
    if (p.idx < 0 || p.idx >= dir.length) continue;
    const composite = resolveIsharComposite(scriptData, dir, p.idx, resolveSlot);
    for (const leaf of composite) {
      const headerOffset = resolveSlot(leaf.index);
      if (headerOffset < 0) continue;
      const bmp = decodeIsharBitmap(scriptData, leaf.index, headerOffset);
      if (!bmp) continue;
      leaves.push({
        x: p.x + leaf.dx,
        z: p.z + leaf.dz,
        sortY: p.y + leaf.dy,
        bitmap: bmp,
        invertX: leaf.invertX,
      });
    }
  }
  return leaves;
}

export interface FirstPersonFrame {
  width: number;
  height: number;
  /** RGBA, row-major, straight (non-premultiplied) alpha. */
  rgba: Uint8Array;
  placementCount: number;
  warnings: string[];
}

function blit(canvas: Uint8Array, cw: number, ch: number, bmp: IsharBitmap, dstX: number, dstY: number, invertX: boolean, palette?: IsharPalette): void {
  const src = palette ? isharBitmapToPaletteRGBA(bmp, palette) : isharBitmapToNormalizedGreyscaleRGBA(bmp);
  for (let y = 0; y < bmp.height; y++) {
    const py = dstY + y;
    if (py < 0 || py >= ch) continue;
    for (let x = 0; x < bmp.width; x++) {
      const sx = invertX ? bmp.width - 1 - x : x;
      const a = src[(y * bmp.width + sx) * 4 + 3]!;
      if (a === 0) continue;
      const px = dstX + x;
      if (px < 0 || px >= cw) continue;
      const si = (y * bmp.width + sx) * 4;
      const di = (py * cw + px) * 4;
      canvas[di] = src[si]!;
      canvas[di + 1] = src[si + 1]!;
      canvas[di + 2] = src[si + 2]!;
      canvas[di + 3] = 255;
    }
  }
}

/**
 * Draw a resolved placement list (already sorted far-to-near by the caller)
 * onto an RGBA canvas. Anchor convention CONFIRMED against the reference
 * (`maestun/alis` `image.c` `deptopix()`, v<60 branch, ~3105-3126):
 * `anchorx = newl >> 1`, `anchory = newh >> 1` where `newl`/`newh` are the
 * STORED width/height (`real - 1`), and `newx = depx - anchorx`,
 * `newy = depy - anchory` -- i.e. every sprite (and backdrop piece) is
 * CENTRE-anchored on its projected point. (Before 2026-11-13 this drew
 * base-anchored, `dstY = pixelY - height`, i.e. every sprite ~h/2 too high.)
 */
export function compositeFrame(
  leaves: ScenePlacementLeaf[],
  screen: { xCenter: number; horizonY: number; width: number; height: number },
  canvas: Uint8Array,
  palette?: IsharPalette,
): void {
  for (const leaf of leaves) {
    const pixelX = screen.xCenter + leaf.x;
    const pixelY = screen.horizonY - leaf.z;
    const dstX = pixelX - ((leaf.bitmap.width - 1) >> 1);
    const dstY = pixelY - ((leaf.bitmap.height - 1) >> 1);
    blit(canvas, screen.width, screen.height, leaf.bitmap, dstX, dstY, leaf.invertX, palette);
  }
}

export interface LocationFrameOptions {
  /** Decompressed location script (e.g. `FORET.bin`, `VILLAGE.bin`). */
  location: Uint8Array;
  /** Decompressed `FOND.bin` (sky/backdrop companion) -- optional; omit to skip the backdrop layer. Ishar 1 ships exactly one `FOND.DO`, shared by every outdoor location script (no per-biome backdrop file exists on disk). */
  fond?: Uint8Array;
  /** East-west position = grid ROW index (see `RegionGridSource` -- the stored grid is the map transposed). */
  partyX: number;
  /** North-south position (increasing southward) = grid COLUMN index. */
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  locationType?: number;
  grid: RegionGridSource;
  screen?: { xCenter: number; horizonY: number; width: number; height: number };
  /**
   * Real AGA colour palette (`ishar-palette.ts`) to render sprites/backdrop
   * with, e.g. `resolveIsharOwnPalette(fond)` for Ishar 1's shared world
   * palette (`FOND.bin`'s own directory, see `ishar-palette.ts` module doc).
   * Omit to render greyscale exactly as before this field was added (no
   * behaviour change for existing callers).
   */
  palette?: IsharPalette;
}

/**
 * Flat two-tone sky/ground placeholder fill split at `screen.horizonY`. The
 * fill colours themselves are NOT from game data: real palettes ARE
 * recovered for this engine family (`ishar-palette.ts`,
 * `ishar-sprite-format.md` §5) and used for sprites when a caller passes
 * one, but what the real game shows behind the backdrop sprites (a cleared
 * colour index? the backdrop covering everything?) is not traced, so this
 * stays a placeholder. Deliberately flat (not a gradient) so it reads
 * unambiguously as "sky" vs "ground" during visual verification. Shared by
 * every location renderer in this engine family (Ishar 1-3, Crystals).
 */
export function fillPlaceholderSkyGround(
  canvas: Uint8Array,
  screen: { width: number; height: number; horizonY: number },
): void {
  for (let y = 0; y < screen.height; y++) {
    const above = y < screen.horizonY;
    for (let x = 0; x < screen.width; x++) {
      const i = (y * screen.width + x) * 4;
      if (above) {
        canvas[i] = 70; canvas[i + 1] = 110; canvas[i + 2] = 170; // flat placeholder sky blue
      } else {
        canvas[i] = 60; canvas[i + 1] = 95; canvas[i + 2] = 50; // flat placeholder ground green
      }
      canvas[i + 3] = 255;
    }
  }
}

/**
 * Render one Ishar 1 outdoor-biome first-person frame by executing
 * `opts.location`'s real bytecode. See module doc for scope/confidence.
 * `facing` uses this project's N/E/S/W = 0/1/2/3 convention in the
 * TRANSPOSED (geographic) frame -- N = -column, E = +row, S = +column,
 * W = -row (see `RegionGridSource`). Raw `omainb(0x137e)` = `facing + 1`:
 * re-derived 2026-11-13 by EXECUTING each script's own `cswitch2 base=-1`
 * facing dispatch for raw values -3..4 and recording every grid cell it
 * reads -- raw 1/2/3/4 scan a symmetric 6-deep wedge toward -column/+row/
 * +column/-row respectively, 0 and out-of-range read nothing (FORET, VILLAGE,
 * PLAINE, RAMPART, TEMPLE identical; `docs/ishar-container-format.md`
 * § "2026-11-13 follow-up"). The old "hand-verified" `facing + 1` was the
 * same table checked in the un-transposed frame, where it was mirrored.
 */
export function renderIsharLocationFrame(opts: LocationFrameOptions): FirstPersonFrame {
  const screen = opts.screen ?? ISHAR1_GAME_SCREEN;
  const warnings: string[] = [];
  const canvas = new Uint8Array(screen.width * screen.height * 4);
  fillPlaceholderSkyGround(canvas, screen);

  const globals: Record<number, number> = {
    [ISHAR1_GLOBALS.partyRow]: opts.partyX,
    [ISHAR1_GLOBALS.partyCol]: opts.partyY,
    [ISHAR1_GLOBALS.partyFacing]: opts.facing + 1,
    [ISHAR1_GLOBALS.locationType]: opts.locationType ?? 0,
  };
  const env = makeSceneEnv(globals, opts.grid);

  let placementCount = 0;

  if (opts.fond) {
    const fondLeaves = computeScenePlacements(opts.fond, env, warnings);
    compositeFrame(fondLeaves, screen, canvas, opts.palette);
    placementCount += fondLeaves.length;
  }

  const locationLeaves = computeScenePlacements(opts.location, env, warnings);
  locationLeaves.sort((a, b) => b.sortY - a.sortY); // far-to-near painter's algorithm
  compositeFrame(locationLeaves, screen, canvas, opts.palette);
  placementCount += locationLeaves.length;

  return { width: screen.width, height: screen.height, rgba: canvas, placementCount, warnings };
}

/** Convenience: unpack a raw `.DO` file straight to its decompressed bytes (small helper so callers don't need to import `silmarils-unpack.ts` separately). */
export function unpackIsharScript(raw: Uint8Array): Uint8Array {
  const result = unpackSilmarilsScript(raw);
  if (!result) throw new Error('not a recognized Silmarils container');
  return result.data;
}
