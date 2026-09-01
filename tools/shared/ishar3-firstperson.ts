/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) first-person outdoor
 * renderer -- ATTEMPTED, NOT ACHIEVED (2026-09-01). See
 * `docs/ishar-container-format.md` §8.6 for the full write-up and paths-tried
 * table; `docs/ishar/TODO.md` for the open-item row. This module is left in
 * the tree because the globals/facing table/screen constants below ARE
 * genuinely confirmed by disassembly and may be useful groundwork for a
 * future pass -- but `renderIshar3LocationFrame()` produces WRONG,
 * wildly-out-of-range output for every location script tried and is NOT
 * wired into `tools/walker/games-ishar.ts` (`LOCATION_SCRIPTS.ishar3 = []`).
 * Do not use this module's render output as ground truth for anything.
 *
 * Same engine family and same generic scene-compositor mechanism as
 * `ishar-firstperson.ts` -- reuses `computeScenePlacements()`/
 * `compositeFrame()`/`fillPlaceholderSkyGround()` from that module UNCHANGED,
 * following the `crystals-firstperson.ts`/`ishar2-firstperson.ts` precedent.
 * Only the `SceneEnv`/global addresses/facing conversion/screen constants
 * below are Ishar 3-specific.
 *
 * **Global addresses, CONFIRMED by direct disassembly of
 * `FORET.bin`/`JUNGLE.bin`/`MONTAGNE.bin`**: `omainb(0x14b6)` and
 * `omainb(0x257)` are the two position globals (bounded, in the ring-loop
 * clamp logic, against the confirmed grid dimensions -- `0x14b6` against 57,
 * `0x257` against 82, matching `ISHAR_REGION_LAYOUT.ishar3`'s
 * `{width:57, height:82}` -- `partyX = 0x14b6`, `partyY = 0x257`), and
 * `omainb(0x14b7)` (adjacent to `0x14b6`, matching the "facing sits next to
 * X" layout seen in Ishar 1/2 too) is `partyFacing`, dispatched by a
 * `cswitch2 base=2 count=4` at the very top of the script
 * (`targets=[869,608,1126,82,345]` in `FORET.bin`).
 *
 * **The facing encoding is DIFFERENT from Ishar 1/2's `+1` convention --
 * derived by directly tracing each of the 4 non-default target blocks'
 * own world-coordinate update math** (which axis each block adds/subtracts
 * its ring-depth counter to/from, and the sign): raw value `1` decrements
 * the X-role coordinate (`worldX = partyX - depth`), value `-1` increments
 * it (`worldX = partyX + depth`), value `2` increments the Y-role
 * coordinate (`worldY = partyY + depth`), value `-2` decrements it
 * (`worldY = partyY - depth`). Matched against this project's own N/E/S/W
 * convention (`tools/walker/games.ts`'s `dirs`: N=(0,-1), E=(1,0), S=(0,1),
 * W=(-1,0)) by which world axis/sign each raw value updates:
 * `ISHAR3_FACING_RAW = [-2, -1, 2, 1]` for N/E/S/W (index 0-3) -- a REAL,
 * traced 4-entry table, not a formula, unlike Ishar 1/2's `facing+1`. Value
 * `0` is the cswitch2's own default/no-op slot (same target as the
 * out-of-range fallthrough) -- never emitted by this table. **This
 * dispatch's real ROLE is unconfirmed** -- see below, it may not gate the
 * terrain scan the way Ishar 1/2's analogous dispatch does.
 *
 * `ISHAR3_GAME_SCREEN` is CONFIRMED from `MAIN.bin`'s own `cdefsc
 * scridx=0x000e` 32-byte config block -- byte-IDENTICAL to Ishar 2's own
 * config block (see `ishar2-firstperson.ts`), both distinct from Ishar 1's.
 *
 * **NOT rendered correctly this session**: `FORET.bin` (paired backdrop
 * `FFORET.bin`) against real `CONT*-3.FIC` forest cells produces noisy,
 * non-forest-like images at every position/facing tried (5 combinations
 * across 2 test cells). Root-caused to a genuine STRUCTURAL difference from
 * Ishar 1/2, not a global-address/facing-table bug: `FORET.bin` executes
 * FOUR terrain-scan blocks UNCONDITIONALLY every frame (4 distinct
 * `cjsr target=1127` call sites, none gated by the facing `cswitch2` above)
 * -- a "diamond scan" around the player along both world axes -- rather
 * than Ishar 1/2's single facing-SELECTED forward scan. The per-cell
 * screen-projection formula (shared subroutine at file offset `0x6d3`,
 * `screenX = lateralLoopVar * scaleConstant[ring]`) is internally
 * consistent in isolation, but the outer ring loop's lateral-bound
 * narrow/widen logic lets the effective lateral magnitude reach ~28-49 in
 * practice (not the ~7 the initial clamp suggests), producing screen
 * x-offsets from -9,408 to +1,197 against a 255px-wide screen. Confirmed
 * NOT script-specific: `JUNGLE.bin` (paired `FJUNGLE.bin`) shares the
 * byte-identical 4x-`cjsr`-1127 shell shape. See
 * `docs/ishar-container-format.md` §8.6 for the full paths-tried table.
 * `MONTAGNE.bin` is structurally more complex still (1,370 instructions, 8
 * `cswitch2` sites) -- likely multi-sub-biome, not investigated.
 */

import type { SceneEnv } from './alis-interp.ts';
import { computeScenePlacements, compositeFrame, fillPlaceholderSkyGround, type FirstPersonFrame, type RegionGridSource } from './ishar-firstperson.ts';

/** Ishar 3's confirmed party-state globals (`basemain`-relative). See module doc for the disassembly evidence. */
export const ISHAR3_GLOBALS = {
  partyX: 0x14b6,
  partyY: 0x257,
  partyFacing: 0x14b7,
  gridBufferA: 0x260,
  gridBufferB: 0x14ae,
} as const;

/** N/E/S/W (index 0-3) -> raw `omainb(0x14b7)` facing value. See module doc for the per-block coordinate-update trace this was derived from. */
export const ISHAR3_FACING_RAW: readonly [number, number, number, number] = [-2, -1, 2, 1];

/** Ishar 3's game screen (`cdefsc scridx=0x000e`), CONFIRMED from `MAIN.bin`'s own decompiled config block -- byte-identical to Ishar 2's. */
export const ISHAR3_GAME_SCREEN = { xCenter: 127, horizonY: 78, width: 255, height: 112 } as const;

function makeIshar3SceneEnv(globals: Record<number, number>, grid: RegionGridSource): SceneEnv {
  return {
    readMain(addr) {
      return globals[addr] ?? 0;
    },
    readGrid(addr, pop, direct) {
      const buf = addr === ISHAR3_GLOBALS.gridBufferB ? 'B' : 'A';
      const x = pop();
      const y = direct;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
      return grid.read(buf, x, y);
    },
  };
}

export interface Ishar3LocationFrameOptions {
  /** Decompressed location script (e.g. `FORET.bin`, `JUNGLE.bin`). */
  location: Uint8Array;
  /** Decompressed backdrop companion (`FFORET.bin`, `FJUNGLE.bin`, ...). */
  fond?: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  grid: RegionGridSource;
  screen?: { xCenter: number; horizonY: number; width: number; height: number };
}

/**
 * Render one Ishar 3 outdoor-biome first-person frame by executing
 * `opts.location`'s real bytecode. See module doc for scope/confidence.
 */
export function renderIshar3LocationFrame(opts: Ishar3LocationFrameOptions): FirstPersonFrame {
  const screen = opts.screen ?? ISHAR3_GAME_SCREEN;
  const warnings: string[] = [];
  const canvas = new Uint8Array(screen.width * screen.height * 4);
  fillPlaceholderSkyGround(canvas, screen);

  const globals: Record<number, number> = {
    [ISHAR3_GLOBALS.partyX]: opts.partyX,
    [ISHAR3_GLOBALS.partyY]: opts.partyY,
    [ISHAR3_GLOBALS.partyFacing]: ISHAR3_FACING_RAW[opts.facing],
  };
  const env = makeIshar3SceneEnv(globals, opts.grid);

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
