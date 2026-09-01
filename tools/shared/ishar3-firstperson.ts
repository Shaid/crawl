/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) first-person outdoor
 * renderer -- CONFIRMED (2026-09-02), superseding an earlier "ATTEMPTED, NOT
 * ACHIEVED" verdict from 2026-09-01. See `docs/ishar-container-format.md`
 * §8.6's correction block for the full re-investigation and paths-tried
 * table; `docs/ishar/TODO.md` (row removed, item closed).
 *
 * **What was actually wrong with the earlier verdict**: it claimed Ishar 3's
 * outdoor scripts execute "4 unconditional diamond-scan quadrant blocks"
 * every frame (not gated by the facing dispatch) -- based on a flat grep for
 * `cjsr target=1127` finding 4 lexical call sites with no CFG-reachability
 * check. A full disassembly this session shows each of those 4 sites sits
 * inside its OWN block, reached only via ONE `cswitch2 base=2 count=4`
 * target (exactly Ishar 1/2's shell shape -- one block per facing), and every
 * block ends with `cjmp` to the SAME shared `cret`. So only ONE block runs
 * per frame, selected by facing -- never 4. **No code in this module or in
 * `alis-interp.ts` needed to change**: `renderIshar3LocationFrame()`, run
 * completely unmodified against real bytecode + real `CONT4-3.FIC` grid
 * data at several real interior positions/facings, already produces
 * coherent, non-degenerate first-person frames (recognizable tree/foliage
 * silhouettes against sky, visibly different per facing) -- see §8.6 for the
 * PNGs and the render-verification detail.
 *
 * **A real, source-confirmed residual quirk remains** (independent of the
 * CFG misdiagnosis above): in each facing block, one of the two lateral-scan
 * bounds (`0x54`/`0x55` in the disassembly) can get set to the FULL distance
 * to the region edge on the far axis, rather than clamped to the normal
 * ~6-7 cell view width -- literally the opposite of the OTHER bound's
 * (correctly-shrinking) edge clamp in the same block. The per-ring narrowing
 * loop that's supposed to bring it back down requires an EXACT match against
 * `-(ring+1)`/`ring+1` each step, which a bound that started far outside the
 * normal 1-7 ring range never reaches, so it stays stuck at the wide value
 * for every ring including the closest (largest on-screen scale). This is
 * NOT a decode bug: the operator semantics (`osup`'s `acc-before OP
 * new-operand` convention) were independently confirmed this session against
 * `github.com/maestun/alis`'s real source (`opernames.c`'s
 * `readexec_opername_saveD7()`+`osup()`), ruling out an interpreter
 * operand-order mistake. Empirically it's HARMLESS for interior positions
 * (`compositeFrame()`'s per-pixel clip silently drops the resulting
 * off-screen placements -- confirmed by comparing raw placement x-ranges
 * against the actually-visible composited output) but produces a visibly
 * messier/less-distinct scene for a position near a grid CORNER (both axes
 * close to their own edges at once, e.g. `(7,3)` in the 57x82 grid) --
 * plausibly a real, low-impact engine quirk rather than a hand-decode error,
 * left undocumented further since it doesn't block shipping.
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
 * dispatch's real ROLE is now CONFIRMED**: it gates the terrain scan exactly
 * the way Ishar 1/2's analogous dispatch does -- each of the 4 non-default
 * targets is a self-contained block (own ring loop, own lateral-bound setup)
 * that ends by jumping to the shared `cret`, so only ONE block executes per
 * frame (see the module-level correction note above for the full CFG
 * evidence; this supersedes an earlier "unconfirmed, may not gate" hedge).
 *
 * `ISHAR3_GAME_SCREEN` is CONFIRMED from `MAIN.bin`'s own `cdefsc
 * scridx=0x000e` 32-byte config block -- byte-IDENTICAL to Ishar 2's own
 * config block (see `ishar2-firstperson.ts`), both distinct from Ishar 1's.
 *
 * **RENDERED this session**: `FORET.bin` (paired backdrop `FFORET.bin`) and
 * `JUNGLE.bin` (paired `FJUNGLE.bin`) both against real `CONT4-3.FIC` cells
 * produce coherent, recognizable tree/foliage silhouettes against a sky/
 * ground split, at every interior position/facing tried (7 combinations
 * across 3 positions) -- see `docs/ishar-container-format.md` §8.6's
 * correction block for the PNGs and the full render-verification detail,
 * plus the module-level doc comment above for the residual lateral-bound
 * quirk (real, source-confirmed, but empirically harmless for interior
 * positions -- only visibly messier right at a grid corner). `MONTAGNE.bin`
 * is structurally more complex still (1,370 instructions, 8 `cswitch2`
 * sites) -- likely multi-sub-biome, not investigated.
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
