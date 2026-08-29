/**
 * Export Wizardry 6's **slot-key scheme** to `slots.json` (M6:
 * `dungeon-walker-m6-wiring`, "derive the general per-cell slot-key scheme,
 * matching Black Crypt's own M2 milestone").
 *
 * The scheme comes straight from `CODE+0x9b58`'s per-call-site literal
 * `baseIndex` constants (re-read from `disasm/Bane.asm`): the dungeon view
 * is composed of compose-list runs, one record per depth step, and each wall
 * call site draws directly (unmirrored) from `composeList[baseIndex+depth]`
 * (§4.7.1's second correction — the earlier "upper strip + lower wall via
 * `DrawMazePiece`'s mirrored path" reading was over-reading the arg blocks).
 * Those five sites, plus the two `LAB_0506` receding-side-wall sites, give:
 *
 *   `wall:front:<depth>`          front wall (compose baseIndex 0)
 *   `door:front:<depth>`          the alternate front-wall door art (0xb2)
 *   `wall-lat:{L1,L2,R1,R2}:<d>`  lateral column faces (3 / 6 / 9 / 0xc)
 *   `wall-side:{L,R}:<depth>`     receding side-wall strips (static calls 4-9)
 *
 * with `<depth>` 0..2. See `buildSlots`'s per-slot comment and
 * `view-model.ts`'s module doc for which evaluator gates which key.
 *
 * Every placement is resolved from the compose record's own fields
 * (`data-structure.md` §4.4): `destX = (destXByte + srcClip) * 8`,
 * `destY = destY`, source crop `srcX = frameX + srcClip*8`, `srcW =
 * widthBytes*8`, `srcH = dirRecord.heightPx`. This honours `srcClip` — the
 * byte-skip from the source graphic's left edge that the game's
 * `DrawMazePiece` applies (`source = offset + srcClip`) but that the earlier
 * `render-corridor-frame.ts` cell-driven renderer dropped (it blitted from
 * source x=0); the package-driven render is the game-correct one.
 *
 * Static slots are the confirmed ceiling/floor runs from the disassembly-
 * verified 16-call corridor (`static-corridor-calls.ts`, calls 1-3 and
 * 10-12), drawn every frame pose-independent, mirrorX=true (dstIdx==srcIdx
 * still routes through `DrawMazePiece`'s mirrored bit-reversal path — §4.4).
 *
 * Requires the indexed atlas frames (`export-mazedata-indexed.ts`) for the
 * atlas-absolute source crops.
 *
 * Usage: npx tsx tools/wizardry6/export-dungeon-slots.ts <dataDir>
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';
import { parseMazeData, type MazeData } from './decode-maze.ts';

const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;

/**
 * `CODE+0x9b58`'s per-call-site wall baseIndex constants — the verified
 * reference (`render-corridor-frame.ts`, which produced the cell-driven
 * corridor screenshots) draws each wall site DIRECTLY from
 * `composeList[baseIndex + depth]` (unmirrored, source at the graphic's own
 * left edge, `srcClip` only shifting destX). Five wall call sites (front +
 * two left layers + two right layers, the right being the exact mirror of
 * the left) plus the front-door run give `wall:front:<depth>`,
 * `door:front:<depth>` and `wall-lat:{L1,L2,R1,R2}:<depth>`. The receding
 * side art (dir 4-10, mirrored) is a different mechanism — `LAB_0506` off
 * the perpendicular evaluators — and lands in `wall-side:{L,R}:<depth>`.
 *
 * A zero-width compose record draws nothing.
 */
interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildSlots(maze: MazeData, frameByName: (name: string) => FrameRect) {
  const slots: Record<string, unknown> = {};

  /** Resolve compose record `baseIndex + depth` into a package `PieceDraw` exactly as the verified reference `render-corridor-frame.ts` draws it: direct (unmirrored), source at the graphic's own left edge (`srcClip` only shifts destX), OR blend. Returns `null` for a zero-width "draw nothing" filler. */
  const composeDraw = (baseIndex: number, depth: number, mode: 0 | 1 = 1) => {
    const rec = maze.composeList[baseIndex + depth];
    if (!rec || rec.widthBytes === 0) return null;
    const gfx = maze.dirRecords[rec.dirIndex]!;
    const frame = frameByName(`mazedata_dir${String(rec.dirIndex).padStart(3, '0')}`);
    return {
      bank: 'mazedata',
      frame: `mazedata_dir${String(rec.dirIndex).padStart(3, '0')}`,
      destX: (rec.destXByte + rec.srcClip) * 8,
      destY: rec.destY,
      srcX: frame.x,
      srcY: frame.y,
      srcW: rec.widthBytes * 8,
      srcH: gfx.heightPx,
      mirrorX: false,
      blend: (mode === 0 ? 'replace' : 'or') as 'replace' | 'or',
      origin: `mazedata-composelist[${baseIndex + depth}] (direct wall draw)`,
    };
  };

  /**
   * `DrawMazePiece`'s **mirrored** path (§4.4): graphic from
   * `compose[src+depth]`'s dir record, placement (destX/destY/srcClip/
   * widthBytes) from `compose[dst+depth]`, blitted horizontally mirrored —
   * the source bytes walk backwards from `offset + widthUnits - 1 - srcClip`
   * through the bit-reversal LUT, i.e. source columns
   * `[widthUnits - srcClip - widthBytes, widthUnits - srcClip)` reversed.
   *
   * Re-instated (2026-08-16): the parity flags that pick this branch are now
   * fully resolved (`-11434(A4) = (partyX+partyY+facing) & 1`, `-11436(A4)`
   * the same `+ depth` — §4.7.8), and a pixel diff shows the two branches
   * are NOT equivalent (e.g. the front wall's mirror-of-self differs on
   * 5,216 of 7,863 drawn pixels — the stone texture is asymmetric), so every
   * pair-driven slot now also gets a `:alt` variant holding this branch.
   */
  const mirroredDraw = (srcBase: number, dstBase: number, depth: number, mode: 0 | 1 = 1) => {
    const dstRec = maze.composeList[dstBase + depth];
    const srcRec = maze.composeList[srcBase + depth];
    if (!dstRec || dstRec.widthBytes === 0 || !srcRec) return null;
    const gfx = maze.dirRecords[srcRec.dirIndex]!;
    const frame = frameByName(`mazedata_dir${String(srcRec.dirIndex).padStart(3, '0')}`);
    return {
      bank: 'mazedata',
      frame: `mazedata_dir${String(srcRec.dirIndex).padStart(3, '0')}`,
      destX: (dstRec.destXByte + dstRec.srcClip) * 8,
      destY: dstRec.destY,
      srcX: frame.x + (gfx.widthUnits - dstRec.srcClip - dstRec.widthBytes) * 8,
      srcY: frame.y,
      srcW: dstRec.widthBytes * 8,
      srcH: gfx.heightPx,
      mirrorX: true,
      blend: (mode === 0 ? 'replace' : 'or') as 'replace' | 'or',
      origin: `mazedata-composelist[${srcBase + depth}] mirrored onto [${dstBase + depth}]`,
    };
  };

  // The 4 far-end archway pieces (STATIC_CORRIDOR_CALLS 12-15, srcIdx 25/28/31/34)
  // are NOT part of the always-drawn static backdrop — verified against real
  // gameplay: open space shows only ceiling+floor extending, no archway frame.
  // They should only appear when there is specifically an archway feature at
  // depth 2 — but the feature/dispatch value that triggers them is not yet
  // identified. Left unimplemented until that dispatch value is traced.
  // TODO: identify archway feature code and add a dedicated slot (e.g. arch:front:2).

  // Per-cell walls. Three families, each with its OWN gate and its own
  // visibility lane in the game (`view-model.ts`'s module doc comment):
  //
  //   `wall:front:<d>` / `door:front:<d>`  `0x9b58` off the straight-ahead
  //       `EvalCellFace`. baseIndex 0 / 0xb2. Lane `-11432(A4)`.
  //   `wall-lat:{L1,L2,R1,R2}:<d>`  the lateral columns' own forward-facing
  //       walls, `0x9b58` off `EvalCellFace` at lateral ∓1. baseIndex 3/6
  //       left, 9/0xc right. One lane each (`-11424`/`-11416`/`-11408`/
  //       `-11400(A4)`) — so four separate slots, not two pairs.
  //   `wall-side*:{L,R}:<d>`  the receding side walls, `LAB_0506` off the
  //       *perpendicular* evaluators `0x969a`/`0x9876`. Lane `-11432(A4)`,
  //       shared with the front wall. Base indices from §4.7.6.4's arg-slot
  //       table; which variant fires is §4.7.6.2's 14-entry jump table,
  //       dispatched in `view-model.ts`.
  //
  // Two superseded readings, both of which this replaces: bundling the side
  // strip and the column faces into one slot on the lateral-neighbour gate
  // (wrong for the strip on 29.9% of side-wall draw decisions across the 14
  // levels), and sourcing the strip from `STATIC_CORRIDOR_CALLS[3+depth]` —
  // those are compose 16/17/18, i.e. the run's depths **1-3**, so every
  // strip landed one depth too far away. `LAB_0506`'s own base is 0x0f/0x13.
  //
  // `LAB_0506` picks direct-vs-mirrored per draw off `-11434(A4)`.
  // > **Correction (2026-08-16):** this comment used to claim the mirrored
  // > branch "draws the same picture" — refuted by a pixel diff (the pair
  // > art is not mirror-symmetric; see `mirroredDraw`'s doc). `-11434(A4)`
  // > is now resolved as the pose checkerboard parity
  // > `(partyX + partyY + facing) & 1` (§4.7.8) — the Amiga analog of the
  // > SNES port's `$8e` — so both branches are emitted: the direct one
  // > under the plain key, the mirrored one under `<key>:alt`, picked per
  // > pose by `view-model.ts`.
  const SIDE_BASE: Record<string, { L: number; R: number; mode: 0 | 1 }> = {
    // preamble pair `16/18(A5)` — the plain receding side wall.
    'wall-side': { L: 0x0f, R: 0x13, mode: 1 },
    // `20/22(A5)` — codes 1/3/4 (the "partial" wall values).
    'wall-side-partial': { L: 0x53, R: 0x57, mode: 1 },
    // `28/30(A5)` — codes 5/6 (door).
    'wall-side-door': { L: 0xc1, R: 0xc4, mode: 1 },
    // `32/34(A5)` — code 7 (feature 8).
    'wall-side-feat7': { L: 0x110, R: 0x113, mode: 0 },
    // `36/38(A5)` — codes 10-13 (features 9-12).
    'wall-side-feat10': { L: 0x125, R: 0x128, mode: 0 },
    // `24(A5)` / `26(A5)` — codes 3 and 4 each add one always-direct draw.
    // These do NOT mirror-swap: each side has its own index.
    'wall-side-extra3': { L: 0x6a, R: 0x6e, mode: 0 },
    'wall-side-extra4': { L: 0x72, R: 0x76, mode: 0 },
  };

  // ---------------------------------------------------------------------
  // Ceiling / floor **continuation** runs — §4.7.7.
  //
  // The corridor's ceiling and floor are NOT one static backdrop: they are
  // seven parallel `baseIndex + depth` runs, one per draw *lane*, each drawn
  // by the same routine that draws that lane's wall, gated on the same
  // visibility lane. Two routines carry them:
  //
  //   `LAB_04BD` = `CODE+0x9b58`, the wall dispatcher. Its FIRST block
  //     (`0x9b5c`-`0x9bac`, before its own `CMPI.W #3,8(a5); BGE` depth gate)
  //     unconditionally draws `composeList[18(a5) + depth]`; its LAST block
  //     (`LAB_04F8`, `0x0a05e`-`0x0a0ce`, which is also the depth>=3 jump
  //     target) draws `composeList[70(a5) + depth]`. Five call sites in the
  //     depth loop `LAB_055A` supply those two arg slots: front (`0x0ab92`),
  //     left1 (`0x0ad52`), left2 (`0x0ae10`), right1 (`0x0aed0`), right2
  //     (`0x0af90`).
  //   `LAB_0528` = `CODE+0x0a3b0`, a small two-draw routine that exists ONLY
  //     for these pieces — the two receding-side lanes have no wall of their
  //     own here (that's `LAB_0506`'s job). Called at `0x0aca2` (left,
  //     side arg 0) and `0x0afd6` (right, side arg 2); ceiling from
  //     `12(a5) + depth`, floor from `16(a5) + depth`.
  //
  // Collecting the literals pushed at those seven call sites gives three
  // exact 7x4 tables — ceiling 122-149, floor 150-177, "alt floor" 214-241,
  // stride 4, zero gaps, zero overlap. That closure (28 = 7 lanes x 4 depths
  // for each of the three families, with no record left over) is the
  // structural proof that the lane->base assignment below is complete.
  //
  // Every one of these draws has the same direct-vs-mirrored fork on
  // `-11434(A4)` as the wall sites (§4.7.6.2): `-11434 == 0` draws
  // `composeList[own + depth]` directly, otherwise it draws the *paired*
  // lane's graphic at this lane's placement, mirrored. As with the wall
  // slots, the static table emits the direct branch.
  //
  // The third family (`74/76(a5)` for `0x9b58`, `20/22(a5)` for `LAB_0528`)
  // is an ALTERNATE floor selected when `word[-11330(A4) + depth*6 + side*2]`
  // is non-zero — a per-cell override written only by `EvalCellFace`'s
  // special-map-mode paths (`0x9258`/`0x92e6`/`0x93f8`), i.e. the flagP
  // "alt-floor gate" handler (§4.7.9, levels 8/10/12). Emitted below as
  // `floor-alt:<lane>:<depth>` (+ `:alt` mirrored variant); `view-model.ts`
  // selects it via `evalOverlay`'s `altFloor` flag instead of the assumed-
  // clear default the other overlay gates (still) fall back to.
  const BACKDROP_BASE: Record<string, { ceil: number; floor: number; alt: number }> = {
    // `0x0ab92`: 18/20(a5)=122/122, 70/72(a5)=150/150, 74/76(a5)=214/214.
    'front': { ceil: 122, floor: 150, alt: 214 },
    // `0x0aca2` (LAB_0528, side 0): 12/14=126/146, 16/18=154/174, 20/22=218/238.
    'side:L': { ceil: 126, floor: 154, alt: 218 },
    // `0x0ad52`: 18/20=130/142, 70/72=158/170, 74/76=222/234.
    'lat:L1': { ceil: 130, floor: 158, alt: 222 },
    // `0x0ae10`: 18/20=134/138, 70/72=162/166, 74/76=226/230.
    'lat:L2': { ceil: 134, floor: 162, alt: 226 },
    // `0x0aed0`: 18/20=138/134, 70/72=166/162, 74/76=230/226.
    'lat:R1': { ceil: 138, floor: 166, alt: 230 },
    // `0x0af90`: 18/20=142/130, 70/72=170/158, 74/76=234/222.
    'lat:R2': { ceil: 142, floor: 170, alt: 234 },
    // `0x0afd6` (LAB_0528, side 2): 12/14=146/126, 16/18=174/154, 20/22=238/218.
    'side:R': { ceil: 146, floor: 174, alt: 238 },
  };

  /**
   * `0x9b58`'s five call sites' full 35-word argument maps, extracted
   * mechanically from the push sequences before each `JSR LAB_04BD`
   * (`0x0ab92`/`0x0ad52`/`0x0ae10`/`0x0aed0`/`0x0af90`) — §4.7.8. Each
   * value is a compose-list base index (`+ depth` at draw time). The R
   * sites are exact member-swaps of the L sites (internal consistency
   * check, holds 15/15 pairs). Beyond the already-documented slots
   * (ceiling 18/20, wall 22/24, door 44/46, floor 70/72, alt floor 74/76):
   *
   *   26        code-3 single deferred draw (the closed-door leaf, mode 0,
   *             always direct)
   *   28-34     deferred pair-record #1 for codes 1/3/4 (doorway art):
   *             draw (28,30) and (32,34), mode 0, `-11436` parity
   *   36-42     deferred pair-record #2, same codes: (36,38) and (40,42)
   *   48/50     code 6 pair (mode 1)
   *   52/54     code 7 — parity picks WHICH record draws (54 is its own
   *             placement, not a mirror partner), mode 0
   *   56-66     codes 10/11/12 pairs (mode 0)
   *   68        code 13 single (mode 0, always direct)
   *
   * (14/16 hold the kind-1/2 `.PIC`-cel token screen coordinates — the
   * monster/NPC combat-encounter portrait overlay, not modelled in the
   * walker since occupancy is runtime encounter state; §4.7.8's
   * correction block.)
   */
  const SITE_ARGS: Record<string, Record<number, number>> = {
    front: { 18: 0x7a, 20: 0x7a, 22: 0x0, 24: 0x0, 26: 0x5b, 28: 0x17, 30: 0x17, 32: 0x1a, 34: 0x1a, 36: 0x1d, 38: 0x20, 40: 0x20, 42: 0x1d, 44: 0xb2, 46: 0xb2, 48: 0xc7, 50: 0xc7, 52: 0xf2, 54: 0x101, 56: 0x116, 58: 0x116, 60: 0x12b, 62: 0x12b, 64: 0x13a, 66: 0x13a, 68: 0x149, 70: 0x96, 72: 0x96, 74: 0xd6, 76: 0xd6 },
    L1: { 18: 0x82, 20: 0x8e, 22: 0x3, 24: 0xc, 26: 0x5e, 28: 0x23, 30: 0x3e, 32: 0x29, 34: 0x44, 36: 0x2f, 38: 0x50, 40: 0x35, 42: 0x4a, 44: 0xb5, 46: 0xbe, 48: 0xca, 50: 0xd3, 52: 0xf5, 54: 0x104, 56: 0x119, 58: 0x122, 60: 0x12e, 62: 0x137, 64: 0x13d, 66: 0x146, 68: 0x14c, 70: 0x9e, 72: 0xaa, 74: 0xde, 76: 0xea },
    L2: { 18: 0x86, 20: 0x8a, 22: 0x6, 24: 0x9, 26: 0x61, 28: 0x26, 30: 0x3b, 32: 0x2c, 34: 0x41, 36: 0x32, 38: 0x4d, 40: 0x38, 42: 0x47, 44: 0xb8, 46: 0xbb, 48: 0xcd, 50: 0xd0, 52: 0xf8, 54: 0x107, 56: 0x11c, 58: 0x11f, 60: 0x131, 62: 0x134, 64: 0x140, 66: 0x143, 68: 0x14f, 70: 0xa2, 72: 0xa6, 74: 0xe2, 76: 0xe6 },
    R1: { 18: 0x8a, 20: 0x86, 22: 0x9, 24: 0x6, 26: 0x64, 28: 0x3b, 30: 0x26, 32: 0x41, 34: 0x2c, 36: 0x47, 38: 0x38, 40: 0x4d, 42: 0x32, 44: 0xbb, 46: 0xb8, 48: 0xd0, 50: 0xcd, 52: 0xfb, 54: 0x10a, 56: 0x11f, 58: 0x11c, 60: 0x134, 62: 0x131, 64: 0x143, 66: 0x140, 68: 0x152, 70: 0xa6, 72: 0xa2, 74: 0xe6, 76: 0xe2 },
    R2: { 18: 0x8e, 20: 0x82, 22: 0xc, 24: 0x3, 26: 0x67, 28: 0x3e, 30: 0x23, 32: 0x44, 34: 0x29, 36: 0x4a, 38: 0x35, 40: 0x50, 42: 0x2f, 44: 0xbe, 46: 0xb5, 48: 0xd3, 50: 0xca, 52: 0xfe, 54: 0x10d, 56: 0x122, 58: 0x119, 60: 0x137, 62: 0x12e, 64: 0x146, 66: 0x13d, 68: 0x155, 70: 0xaa, 72: 0x9e, 74: 0xea, 76: 0xde },
  };

  const slot = (draw: ReturnType<typeof composeDraw>) => (draw ? { draws: [draw] } : null);
  const multiSlot = (draws: Array<ReturnType<typeof composeDraw>>) => {
    const real = draws.filter((d): d is NonNullable<typeof d> => d !== null);
    return real.length ? { draws: real } : null;
  };

  // Ceiling/floor run to depth 3 (the `0x9b58` ceiling draw precedes its own
  // depth gate, and `LAB_04F8` is that gate's jump target), unlike the wall
  // slots which stop at depth 2. `:alt` = the `-11434(A4) != 0` mirrored
  // branch (pair art at this lane's placement, mirrored).
  //
  // `alt` here is each lane's MIRROR PARTNER's alt-floor base (the third
  // 74/76(a5)-family member of the same pairing ceil/floor already use --
  // §4.7.7.1's SITE_ARGS comment: e.g. front is self-paired (214/214),
  // side:L pairs with side:R (218/238), lat:L1 with lat:R2 (222/234),
  // lat:L2 with lat:R1 (226/230)), so `floor-alt:<lane>:<depth>:alt` can
  // reuse `mirroredDraw` exactly like `ceil`/`floor` do.
  const BACKDROP_PAIR: Record<string, { ceil: number; floor: number; alt: number }> = {
    front: { ceil: 122, floor: 150, alt: 214 },
    'side:L': { ceil: 146, floor: 174, alt: 238 },
    'lat:L1': { ceil: 142, floor: 170, alt: 234 },
    'lat:L2': { ceil: 138, floor: 166, alt: 230 },
    'lat:R1': { ceil: 134, floor: 162, alt: 226 },
    'lat:R2': { ceil: 130, floor: 158, alt: 222 },
    'side:R': { ceil: 126, floor: 154, alt: 218 },
  };
  for (let depth = 0; depth < 4; depth++) {
    for (const [lane, { ceil, floor, alt }] of Object.entries(BACKDROP_BASE)) {
      slots[`ceil:${lane}:${depth}`] = slot(composeDraw(ceil, depth));
      slots[`floor:${lane}:${depth}`] = slot(composeDraw(floor, depth));
      // The alt-floor family (§4.7.9's flagP alt-floor gate, levels 8/10/12) --
      // previously collected but never emitted (§4.7.7.2: "never emitted yet").
      slots[`floor-alt:${lane}:${depth}`] = slot(composeDraw(alt, depth));
      const pair = BACKDROP_PAIR[lane]!;
      slots[`ceil:${lane}:${depth}:alt`] = slot(mirroredDraw(pair.ceil, ceil, depth));
      slots[`floor:${lane}:${depth}:alt`] = slot(mirroredDraw(pair.floor, floor, depth));
      slots[`floor-alt:${lane}:${depth}:alt`] = slot(mirroredDraw(pair.alt, alt, depth));
    }
  }

  // `0x9b58`'s per-site dispatch families (§4.7.8): the main wall (preamble
  // pair 22/24), the door pair (44/46), the codes-1/3/4 "open doorway"
  // deferred records (28-42) and code 3's closed-door leaf (26), and the
  // feature pieces (48-68). Site keys: front / L1 / L2 / R1 / R2, matching
  // the wall-lat naming for the four lateral columns.
  const siteWallKey = (site: string, depth: number) =>
    site === 'front' ? `wall:front:${depth}` : `wall-lat:${site}:${depth}`;
  for (let depth = 0; depth < 3; depth++) {
    for (const [key, { L, R, mode }] of Object.entries(SIDE_BASE)) {
      slots[`${key}:L:${depth}`] = slot(composeDraw(L, depth, mode));
      slots[`${key}:R:${depth}`] = slot(composeDraw(R, depth, mode));
      // extras 24/26(A5) are always-direct (no parity fork, §4.7.6.2)
      if (key !== 'wall-side-extra3' && key !== 'wall-side-extra4') {
        slots[`${key}:L:${depth}:alt`] = slot(mirroredDraw(R, L, depth, mode));
        slots[`${key}:R:${depth}:alt`] = slot(mirroredDraw(L, R, depth, mode));
      }
    }
    for (const [site, a] of Object.entries(SITE_ARGS)) {
      const wallKey = siteWallKey(site, depth);
      slots[wallKey] = slot(composeDraw(a[22]!, depth));
      slots[`${wallKey}:alt`] = slot(mirroredDraw(a[24]!, a[22]!, depth));
      slots[`door:${site}:${depth}`] = slot(composeDraw(a[44]!, depth));
      slots[`door:${site}:${depth}:alt`] = slot(mirroredDraw(a[46]!, a[44]!, depth));
      slots[`door-leaf:${site}:${depth}`] = slot(composeDraw(a[26]!, depth, 0));
      slots[`wall-open:${site}:${depth}`] = multiSlot([
        composeDraw(a[28]!, depth, 0),
        composeDraw(a[32]!, depth, 0),
        composeDraw(a[36]!, depth, 0),
        composeDraw(a[40]!, depth, 0),
      ]);
      slots[`wall-open:${site}:${depth}:alt`] = multiSlot([
        mirroredDraw(a[30]!, a[28]!, depth, 0),
        mirroredDraw(a[34]!, a[32]!, depth, 0),
        mirroredDraw(a[38]!, a[36]!, depth, 0),
        mirroredDraw(a[42]!, a[40]!, depth, 0),
      ]);
      slots[`feat6:${site}:${depth}`] = slot(composeDraw(a[48]!, depth));
      slots[`feat6:${site}:${depth}:alt`] = slot(mirroredDraw(a[50]!, a[48]!, depth));
      // code 7: parity picks WHICH record draws, both direct (§4.7.8)
      slots[`feat7:${site}:${depth}`] = slot(composeDraw(a[52]!, depth, 0));
      slots[`feat7:${site}:${depth}:alt`] = slot(composeDraw(a[54]!, depth, 0));
      slots[`feat10:${site}:${depth}`] = slot(composeDraw(a[56]!, depth, 0));
      slots[`feat10:${site}:${depth}:alt`] = slot(mirroredDraw(a[58]!, a[56]!, depth, 0));
      slots[`feat11:${site}:${depth}`] = slot(composeDraw(a[60]!, depth, 0));
      slots[`feat11:${site}:${depth}:alt`] = slot(mirroredDraw(a[62]!, a[60]!, depth, 0));
      slots[`feat12:${site}:${depth}`] = slot(composeDraw(a[64]!, depth, 0));
      slots[`feat12:${site}:${depth}:alt`] = slot(mirroredDraw(a[66]!, a[64]!, depth, 0));
      slots[`feat13:${site}:${depth}`] = slot(composeDraw(a[68]!, depth, 0));
    }
  }
  // code 14: front depth 0 only, literal compose 0x158 (§4.7.1's table)
  slots['feat14:front:0'] = slot(composeDraw(0x158, 0, 0));
  slots['feat14:front:0:alt'] = slot(mirroredDraw(0x158, 0x158, 0, 0));

  // `LAB_0506`'s preamble also fires at depth 3 (`0x0a178`: `depth == 3 &&
  // code != 0`), where its 14-entry jump table is skipped — so the plain
  // receding side wall, and only that, gets a depth-3 slot.
  slots['wall-side:L:3'] = slot(composeDraw(SIDE_BASE['wall-side']!.L, 3));
  slots['wall-side:R:3'] = slot(composeDraw(SIDE_BASE['wall-side']!.R, 3));

  // > **Correction (2026-08-16):** there is no static ceiling/floor backdrop.
  // > `staticSlots` used to hold compose 122 + 123-125 (ceiling) and 150 +
  // > 151-153 (floor), taken from `CODE+0x632c`/`LAB_036C`'s unrolled
  // > 16-call list. Those calls are not a backdrop pass at all — `LAB_036C`
  // > is a hardcoded, fully-open-corridor replica of the *real* renderer's
  // > own calls (its 123/124/125 are `0x9b58`'s front-lane ceiling draw at
  // > depths 1/2/3, and its 16/17/18↔20/21/22 pairs are `LAB_0506`'s
  // > preamble at depths 1/2/3, both taken with `-11434(A4) != 0`). Emitting
  // > only the front lane's copy left every other lane's ceiling/floor
  // > unpainted, which is the black wedge over an open lateral side
  // > (`TODO.md` `walker-user-reported-inaccuracy`). All seven lanes are now
  // > emitted above as `ceil:*`/`floor:*`, gated by `view-model.ts` on the
  // > same visibility lane as that lane's wall, so `staticSlots` is empty.
  const staticSlots: Array<{ draws: NonNullable<ReturnType<typeof composeDraw>>[] }> = [];

  return {
    schemaVersion: 1,
    game: 'wizardry6',
    platform: 'amiga',
    surface: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
    viewport: { x: 72, y: 32, width: 176, height: 112 },
    depthCount: 3,
    lateralOffsets: [-1, 0, 1],
    frontWallMaxDepth: 3,
    banks: [
      {
        id: 'mazedata',
        atlas: 'maps/mazedata-indexed.json',
        image: 'maps/mazedata-indexed.png',
        indexed: true,
        palette: 'palettes/mazedata.json',
      },
    ],
    slots,
    staticSlots,
    ordering: 'painter-back-to-front',
    provenance: {
      spec: 'docs/wizardry6/amiga/data-structure.md §4.4 (compose list) + §4.7.1 (9b58 baseIndex constants)',
      note: 'wall/door slot keys are baseIndex+depth runs; staticSlots are the confirmed ceiling/floor calls. srcClip is honoured (atlas-absolute srcX) — game-correct, unlike render-corridor-frame.ts.',
    },
  };
}

/**
 * Core export logic, reusable from a pipeline `buildAssets` step as well as
 * the CLI below. Requires `export-mazedata-indexed.ts` to have already
 * written `mazedata-indexed.json` (this reads it back off disk to resolve
 * atlas-absolute frame rects).
 */
export function exportDungeonSlots(dataDir: string): void {
  const data = readBinary(resolve(dataDir, 'mazedata.ega'));
  const maze = parseMazeData(data);

  const atlasPath = resolve('public/assets/wizardry6/amiga/maps/mazedata-indexed.json');
  const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as {
    frames: Array<{ name: string; x: number; y: number; w: number; h: number }>;
  };
  const frameByName = new Map(atlas.frames.map((f) => [f.name, f]));
  const getFrame = (name: string): FrameRect => {
    const f = frameByName.get(name);
    if (!f) throw new Error(`indexed atlas has no frame "${name}" — run export-mazedata-indexed.ts first`);
    return f;
  };

  const slots = buildSlots(maze, getFrame);
  const outDir = resolve('public/assets/wizardry6/amiga/dungeon');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'slots.json'), slots);

  const nWall = Object.keys(slots.slots).filter((k) => slots.slots[k] !== null).length;
  console.log(
    `Wrote dungeon/slots.json: ${nWall}/${Object.keys(slots.slots).length} wall/door slots populated, ${slots.staticSlots!.length} static slots, ${slots.staticSlots!.reduce((n, s) => n + s.draws.length, 0)} static draws`,
  );
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/export-dungeon-slots.ts <dataDir>');
    process.exit(1);
  }
  exportDungeonSlots(dataDir);
}

const isStandalone =
  process.argv[1]?.endsWith('export-dungeon-slots.ts') ||
  process.argv[1]?.endsWith('export-dungeon-slots');

if (isStandalone) main();
