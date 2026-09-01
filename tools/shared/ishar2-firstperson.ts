/**
 * Ishar 2: Messengers of Doom (Amiga AGA) first-person outdoor renderer.
 * Same engine family and same generic scene-compositor mechanism as
 * `ishar-firstperson.ts` (a location script's own compiled ALIS bytecode IS
 * the renderer -- see `docs/ishar-container-format.md` §8) -- reuses
 * `computeScenePlacements()`/`compositeFrame()`/`fillPlaceholderSkyGround()`
 * from that module UNCHANGED, following the `crystals-firstperson.ts`
 * precedent. Only the `SceneEnv`/global addresses/screen constants below are
 * Ishar 2-specific.
 *
 * **Global addresses and facing convention, CONFIRMED this session by direct
 * disassembly comparison against Ishar 1's already-verified `FORET.bin`**:
 * Ishar 2's outdoor scripts (`FORET1.bin`, `PLAINE1.bin`, `ARBO.bin`,
 * `VILLE.bin`, `MONTAGNE.bin` -- all disassemble clean, 0 errors) share
 * Ishar 1's EXACT facing/ring-loop shell byte-for-byte in structure (only
 * addresses and tuning constants differ): a `cswitch2 base=-1 count=3` on
 * `omainb(0x2ab6)` dispatches on facing at the very top of the script, and
 * each of the 4 direction blocks builds two locals -- one from
 * `omainb(0x2ab4) +/- lateralOffset`, one from `omainb(0x2ab5) +/-
 * depthOffset` -- that feed `omaintc(0x80)` as `[push(X-role) ... direct =
 * Y-role]`, in the IDENTICAL relative operand position Ishar 1's `FORET.bin`
 * uses for `omainb(0x137c)`/`omainb(0x137d)` (`ISHAR1_GLOBALS.partyX`/
 * `partyY`) feeding `omaintc(0x80)`. This structural correspondence (same
 * shell, same slot roles, only the literal addresses/constants swapped) is
 * the evidence for `ISHAR2_GLOBALS.partyX = 0x2ab4` / `partyY = 0x2ab5` --
 * not an independent re-derivation of which grid axis each address spans.
 * `partyFacing = 0x2ab6` uses the SAME `rawValue = facingIndex + 1`
 * conversion as Ishar 1 (`cswitch2 base=-1`, matching shape exactly) --
 * CONFIRMED empirically by checking `FORET1.bin`'s own facing-block=1 world-
 * coordinate math updates the Y-role local by `-depth` (i.e. "moving
 * forward" decreases the Y-role coordinate), the same North-analogous
 * direction Ishar 1's own facing-value-1 block produces.
 *
 * `ISHAR2_GAME_SCREEN` is independently CONFIRMED from `MAIN.bin`'s own
 * `cdefsc scridx=0x000e` 32-byte config block, using the same field offsets
 * Ishar 1's `ISHAR1_GAME_SCREEN` uses (`+4:6` xCenter, `+6:8` horizonY,
 * `+0xc:0xe` width, `+0xe:0x10` height) -- byte-identical config block to
 * Ishar 3's own (see `ishar3-firstperson.ts`), both distinct from Ishar 1's.
 *
 * RENDERED end-to-end this session: `FORET1.bin` (paired backdrop
 * `FOND1.bin`) at real `CONT1.FIC` forest cells (terrain dispatch
 * `cswitch2 base=-30 count=3`, i.e. sign-extended cell value in `[30,33]` --
 * a dense 563-cell cluster found around x=8-45,y=48+ in `CONT1.FIC`) and
 * `VILLE.bin` (paired backdrop `FVILLE.bin`) at real `CONT1.FIC` cells --
 * see `docs/ishar-container-format.md` §8.4 for the render verification.
 * `ARBO.bin`/`PLAINE1.bin`/`MONTAGNE.bin` disassemble clean under the same
 * shell but weren't exercised end-to-end this session (`MONTAGNE.bin` is
 * also structurally more complex -- 1,462 instructions vs. ~200-500 for the
 * others, with 8 `cswitch2` sites instead of 2 -- likely a multi-sub-biome
 * script, out of scope this pass).
 */

import type { SceneEnv } from './alis-interp.ts';
import { computeScenePlacements, compositeFrame, fillPlaceholderSkyGround, type FirstPersonFrame, type RegionGridSource } from './ishar-firstperson.ts';

/** Ishar 2's confirmed party-state globals (`basemain`-relative). See module doc for the structural-correspondence evidence. */
export const ISHAR2_GLOBALS = {
  partyX: 0x2ab4,
  partyY: 0x2ab5,
  partyFacing: 0x2ab6,
  gridBufferA: 0x80,
  gridBufferB: 0x159c,
} as const;

/** Ishar 2's game screen (`cdefsc scridx=0x000e`), CONFIRMED from `MAIN.bin`'s own decompiled config block -- see module doc. */
export const ISHAR2_GAME_SCREEN = { xCenter: 127, horizonY: 78, width: 255, height: 112 } as const;

function makeIshar2SceneEnv(globals: Record<number, number>, grid: RegionGridSource): SceneEnv {
  return {
    readMain(addr) {
      return globals[addr] ?? 0;
    },
    // Same count=1 (single stride) formula as Ishar 1's world grid -- see
    // `ishar-firstperson.ts`'s `makeSceneEnv` for the shared convention this
    // mirrors (`x = pop()`, `y = direct`).
    readGrid(addr, pop, direct) {
      const buf = addr === ISHAR2_GLOBALS.gridBufferB ? 'B' : 'A';
      const x = pop();
      const y = direct;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
      return grid.read(buf, x, y);
    },
  };
}

export interface Ishar2LocationFrameOptions {
  /** Decompressed location script (e.g. `FORET1.bin`, `VILLE.bin`). */
  location: Uint8Array;
  /** Decompressed backdrop companion (`FOND1.bin`, `FVILLE.bin`, ...) -- optional, unlike Ishar 1 there is no single shared backdrop file per this session's investigation (each location has its own `F<name>.bin`). */
  fond?: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  grid: RegionGridSource;
  screen?: { xCenter: number; horizonY: number; width: number; height: number };
}

/**
 * Render one Ishar 2 outdoor-biome first-person frame by executing
 * `opts.location`'s real bytecode. See module doc for scope/confidence.
 */
export function renderIshar2LocationFrame(opts: Ishar2LocationFrameOptions): FirstPersonFrame {
  const screen = opts.screen ?? ISHAR2_GAME_SCREEN;
  const warnings: string[] = [];
  const canvas = new Uint8Array(screen.width * screen.height * 4);
  fillPlaceholderSkyGround(canvas, screen);

  const globals: Record<number, number> = {
    [ISHAR2_GLOBALS.partyX]: opts.partyX,
    [ISHAR2_GLOBALS.partyY]: opts.partyY,
    [ISHAR2_GLOBALS.partyFacing]: opts.facing + 1,
  };
  const env = makeIshar2SceneEnv(globals, opts.grid);

  let placementCount = 0;
  if (opts.fond) {
    const fondLeaves = computeScenePlacements(opts.fond, env, warnings);
    compositeFrame(fondLeaves, screen, canvas);
    placementCount += fondLeaves.length;
  }

  const locationLeaves = computeScenePlacements(opts.location, env, warnings);
  locationLeaves.sort((a, b) => b.sortY - a.sortY);
  compositeFrame(locationLeaves, screen, canvas);
  placementCount += locationLeaves.length;

  return { width: screen.width, height: screen.height, rgba: canvas, placementCount, warnings };
}
