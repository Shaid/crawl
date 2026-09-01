/**
 * Crystals of Arborea (Silmarils, 1990, Amiga) first-person outdoor
 * renderer. Same engine family and same generic scene-compositor mechanism
 * as `ishar-firstperson.ts` (a location script's own compiled ALIS bytecode
 * IS the renderer -- see `docs/ishar-container-format.md` §8) but Crystals'
 * outdoor scripts index a genuinely different on-disk data source: not a
 * per-region `CONT*.FIC` world grid (confirmed absent for this title, see
 * `docs/crystalsofarborea/amiga/data-structure.md` §3), but a single
 * `INIT.FIC` file (10,830 bytes) loaded whole into `basemain+0x7c` by
 * `MAIN.CO`'s own bytecode, addressed via a genuinely N-ary `omaintc(0x7c)`
 * read (`cdim`-declared `count=2, dims=[2,114]`) rather than Ishar 1's
 * `count=1` single-stride world grids.
 *
 * **The N-ary indexing formula, derived and CONFIRMED this session**: traced
 * every `omaintc(0x7c)` call site in `ARBRE.bin`/`NPLAINE.bin`/`PLAGES.bin`
 * (via `alis-disasm.ts`) to the identical push sequence `[odirb(0x24)
 * opushacc odirb(0x25) opushacc omainb(0x2b3c) omaintc(0x7c)]`, then derived
 * the real address arithmetic directly from `github.com/maestun/alis`'s
 * source (not the disassembly alone): `tabchar()` (`alis.c:1431`) computes
 * `result = addr + varD7`, then for `i` in `0..length-1` (`length` = the
 * array's `cdim`-declared `count`, read from a header `cdim` writes just
 * below the array's base -- `opcodes.c:613`) does `result += dims[i] *
 * (*acc++)`, where `*acc++` pops the VM eval-stack in the SAME direction
 * `opushacc`/`opile` push/pop it (LIFO -- the stack grows downward via
 * `*(--acc) = value`, so the FIRST `*acc++` after N pushes reads the LAST-
 * pushed value). For Crystals' `dims=[2,114]`, that means:
 *
 * `index = direct + 2*pop() + 114*pop()`
 *
 * where `direct` = the accumulator at call time (`omainb(0x2b3c)`, a main
 * global this session found NO writer for anywhere in `ARBRE.bin`/
 * `MAIN.bin`'s reached CFG -- it evaluates to the default 0, selecting what
 * turned out to be the OUTDOOR/terrain layer, see below), the FIRST `pop()`
 * (multiplied by `dims[0]=2`) is the LAST-pushed value (`odirb(0x25)` =
 * `omainb(0x2b39) - ring`, a party-Y-like "depth" local), and the SECOND
 * `pop()` (multiplied by `dims[1]=114`) is the FIRST-pushed value
 * (`odirb(0x24)` = `omainb(0x2b38) + lateral`, a party-X-like "column"
 * local).
 *
 * **This is CONFIRMED, not just structurally plausible**, on three
 * independent grounds:
 * 1. Byte-exact size fit: `95 * 114 = 10,830` exactly the real `INIT.FIC`
 *    file size, with zero remainder -- the formula's own implied bounds
 *    (`X` in `0..94`, `2*Y+direct` in `0..113`) exactly tile the whole file.
 * 2. A whole-array visual render (`Y`-major, `X`-minor, i.e. plotting
 *    `INIT.FIC[114*X + 2*Y + Z]` as a 95x57 grid for each `Z` in `{0,1}`)
 *    shows two DIFFERENT, unmistakably coherent maps: `Z=0` is a sparse
 *    terrain-feature map (small positive codes 1-20 scattered over a
 *    mostly-void field, bordered by high-bit/negative "obstacle" codes --
 *    the same alphabet shape as Ishar 1's confirmed `CONT1.FIC`) and `Z=1`
 *    is a dense grid of rectangular room/building outlines (walls of
 *    negative/high-bit codes enclosing small floor areas) -- exactly the
 *    two content classes Crystals' own in-game manual text names as
 *    distinct modes ("THE MAP" / outdoor vs. "3D MODE" -- see
 *    `data-structure.md` §4's `MANUEL.CO` finding).
 * 3. Feeding the formula real `INIT.FIC` bytes into the ALIS interpreter and
 *    running `ARBRE.bin`'s real bytecode for several real party
 *    positions/facings produces composited frames that are unmistakably,
 *    visually a FOREST (multiple distinct tree silhouettes of varying
 *    size/position) -- `ARBRE` being French for "tree". `NPLAINE.CO`
 *    ("plain") independently produces a sparse low ground-hugging
 *    vegetation band rather than tall trees at the same position -- a
 *    second, semantically-appropriate content difference for free.
 *
 * `CAVINT.bin` ("cave interior") was found to use the SAME formula (same
 * push/pop shape, own local-var numbers `0x2c`/`0x2d`) for its own
 * ring-loop-shaped scene calls, PLUS a second, structurally distinct set of
 * calls with an explicit `+1`/`-1` local offset (checking the 4 orthogonal
 * neighbour cells of the current position) -- almost certainly a
 * movement/collision test, analogous to Ishar 1's `GERDEP.bin`. Tested with
 * `sceneLayer=1` (a plausible "this is an indoor script, use the room
 * layer" guess, since nothing in `CAVINT.bin`'s own reached CFG writes
 * `omainb(0x2b3c)` either) at the same test position as `ARBRE`/`NPLAINE`:
 * produces a non-trivial placement count (208) but the composited frame is
 * blank (every leaf lands off-screen or fully transparent) -- INCONCLUSIVE,
 * not shipped. `PLAGES.bin` ("beaches") was likewise tested at the same
 * position with the SAME formula and also produced a blank frame -- this is
 * expected and not a formula failure: the test position was chosen from
 * `ARBRE`'s own terrain-cluster search and there is no reason it should
 * also be a "beach" cell under `PLAGES`'s own cell-dispatch table. Neither
 * is wired into the walker.
 *
 * Everything else (the generic scene-compositor execution, sprite/composite
 * resolution, screen-space projection) is IDENTICAL to Ishar 1's mechanism
 * and reuses `alis-interp.ts`/`ishar-firstperson.ts`'s already-verified
 * `computeScenePlacements()`/`compositeFrame()`/`fillPlaceholderSkyGround()`
 * unchanged -- only the `SceneEnv.readGrid` implementation and the
 * party/screen constants are Crystals-specific.
 */

import type { SceneEnv } from './alis-interp.ts';
import { computeScenePlacements, compositeFrame, fillPlaceholderSkyGround, type FirstPersonFrame } from './ishar-firstperson.ts';

/** Crystals' confirmed party-state globals (`basemain`-relative) -- the same offsets across `ARBRE.CO`/`NPLAINE.CO`/`PLAGES.CO`/`CAVINT.CO`. */
export const CRYSTALS_GLOBALS = {
  partyX: 0x2b38,
  partyY: 0x2b39,
  partyFacing: 0x2b3a,
  /** `omainb(0x2b3c)` -- the local-scene-array "layer" selector (the `direct`/`varD7` term in the indexing formula below). No writer was found in this session's reached CFG; defaults to 0, which resolves to the outdoor/terrain layer (see module doc). */
  sceneLayer: 0x2b3c,
} as const;

/**
 * Crystals' game screen (`cdefsc scridx=0x000e` in `MAIN.bin`, the same
 * magic `scridx` Ishar 1 uses for its own first-person screen) --
 * CONFIRMED directly from `MAIN.bin`'s decompiled `cdefsc` 32-byte config
 * block using the same field offsets Ishar 1's `ISHAR1_GAME_SCREEN` uses
 * (`+4:6` xCenter, `+6:8` horizonY, `+0xc:0xe` width, `+0xe:0x10` height).
 * Crystals predates Ishar's AGA hi-res-adjacent geometry -- this is a plain
 * 320x151-ish OCS/ECS-era screen, not Ishar 1's 255x125.
 */
export const CRYSTALS_GAME_SCREEN = { xCenter: 159, horizonY: 112, width: 319, height: 151 } as const;

/** `basemain+0x7c`'s `cdim`-declared shape (`MAIN.bin+0x60`: `off=0x7c count=2 elemsz=1 dims=[2,114]`). */
const SCENE_ARRAY_ADDR = 0x7c;
const SCENE_ARRAY_DIM0 = 2; // multiplies the FIRST pop() -- the LAST-pushed eval-stack value
const SCENE_ARRAY_DIM1 = 114; // multiplies the SECOND pop() -- the FIRST-pushed eval-stack value

export interface CrystalsSceneEnvOptions {
  /** Raw `INIT.FIC` bytes (10,830 B) -- i.e. `vram[basemain+0x7c ..]` byte-for-byte, per `MAIN.CO`'s own single `cfreadb(addr=0x7c, len=0x2a4e)`. */
  initFic: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  /** `omainb(0x2b3c)` -- see `CRYSTALS_GLOBALS.sceneLayer`'s doc comment. Defaults to 0 (outdoor/terrain layer). */
  sceneLayer?: number;
}

function makeCrystalsSceneEnv(opts: CrystalsSceneEnvOptions): SceneEnv {
  const globals: Record<number, number> = {
    [CRYSTALS_GLOBALS.partyX]: opts.partyX,
    [CRYSTALS_GLOBALS.partyY]: opts.partyY,
    [CRYSTALS_GLOBALS.partyFacing]: opts.facing + 1, // same +1 convention as Ishar 1, see ishar-firstperson.ts
    [CRYSTALS_GLOBALS.sceneLayer]: opts.sceneLayer ?? 0,
  };
  return {
    readMain(addr) {
      return globals[addr] ?? 0;
    },
    readGrid(addr, pop, direct) {
      if (addr !== SCENE_ARRAY_ADDR) return 0; // this title only has one local-scene array
      const p1 = pop(); // dims[0] = 2
      const p2 = pop(); // dims[1] = 114
      const index = direct + SCENE_ARRAY_DIM0 * p1 + SCENE_ARRAY_DIM1 * p2;
      if (index < 0 || index >= opts.initFic.length) return 0;
      const v = opts.initFic[index]!;
      return v >= 0x80 ? v - 0x100 : v; // tabchar/omaintc reads sign-extended (opernames.c: `(s8)xread8(addr)`)
    },
  };
}

export interface CrystalsLocationFrameOptions {
  /** Decompressed location script (e.g. `ARBRE.bin`, `NPLAINE.bin`). */
  location: Uint8Array;
  initFic: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  sceneLayer?: number;
  screen?: { xCenter: number; horizonY: number; width: number; height: number };
}

/**
 * Render one Crystals of Arborea outdoor-biome first-person frame by
 * executing `opts.location`'s real bytecode. See module doc for scope/
 * confidence. CONFIRMED end-to-end for `ARBRE.bin` (RENDERED: an
 * unambiguous forest scene, 4 positions/facings all show distinct,
 * plausible tree arrangements) and `NPLAINE.bin` (RENDERED: a sparser
 * low-vegetation ground band, semantically distinct from ARBRE as
 * expected for a "plain" terrain script). Crystals has no `FOND.bin`-style
 * shared backdrop file in this session's investigation -- omitted here
 * (unlike `renderIsharLocationFrame`, which takes an optional one).
 */
export function renderCrystalsLocationFrame(opts: CrystalsLocationFrameOptions): FirstPersonFrame {
  const screen = opts.screen ?? CRYSTALS_GAME_SCREEN;
  const warnings: string[] = [];
  const canvas = new Uint8Array(screen.width * screen.height * 4);
  fillPlaceholderSkyGround(canvas, screen);

  const env = makeCrystalsSceneEnv(opts);
  const leaves = computeScenePlacements(opts.location, env, warnings);
  leaves.sort((a, b) => b.sortY - a.sortY); // far-to-near painter's algorithm
  compositeFrame(leaves, screen, canvas);

  return { width: screen.width, height: screen.height, rgba: canvas, placementCount: leaves.length, warnings };
}
