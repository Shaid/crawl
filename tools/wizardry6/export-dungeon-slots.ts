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

  // Two helpers used to live here and are both retired now:
  //
  // - `mirroredDraw` (graphic from `compose[src+depth]`, placement from
  //   `compose[dst+depth]`, horizontally mirrored), for the "18-24(A5) are
  //   mirrored (src,dst) pairs" reading of `0x9b58`'s arg blocks. §4.7.1's
  //   second correction retired that reading — every wall site draws
  //   directly via `composeDraw`.
  // - `staticDraw`, which resolved a `STATIC_CORRIDOR_CALLS` triple (and was
  //   the last consumer of the mirrored path) for the "static ceiling/floor
  //   backdrop". §4.7.7 retired *that*: `LAB_036C`'s 16 calls are not a
  //   backdrop pass, they are an unrolled fully-open-corridor replica of the
  //   real renderer's own per-lane calls, so the ceiling/floor now comes
  //   from the real seven-lane runs below.
  //
  // Both remain reachable in git history and are documented in
  // `data-structure.md` §4.4 / §4.7.7 if a `-11434(A4) != 0` (mirrored
  // parity) variant is ever needed.

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
  // `LAB_0506` picks direct-vs-mirrored per draw off `-11434(A4)`, a
  // once-per-render facing-parity flag (§4.7.6.2). A static slot table can't
  // switch on it — but it doesn't need to: the pair's two indices are the
  // left/right mirror images of each other, so the mirrored branch draws the
  // opposite side's art flipped back, which is the same picture. The direct
  // branch (`-11434 == 0`) is emitted here.
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
  // special-map-mode paths (`0x9258`/`0x92e6`/`0x93f8`). Like
  // `evaluate-cell.ts`'s other overlay assumptions, those arrays are taken
  // as clear here, so only the normal floor is emitted.
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

  const slot = (draw: ReturnType<typeof composeDraw>) => (draw ? { draws: [draw] } : null);

  // Ceiling/floor run to depth 3 (the `0x9b58` ceiling draw precedes its own
  // depth gate, and `LAB_04F8` is that gate's jump target), unlike the wall
  // slots which stop at depth 2.
  for (let depth = 0; depth < 4; depth++) {
    for (const [lane, { ceil, floor }] of Object.entries(BACKDROP_BASE)) {
      slots[`ceil:${lane}:${depth}`] = slot(composeDraw(ceil, depth));
      slots[`floor:${lane}:${depth}`] = slot(composeDraw(floor, depth));
    }
  }

  for (let depth = 0; depth < 3; depth++) {
    for (const [key, { L, R, mode }] of Object.entries(SIDE_BASE)) {
      slots[`${key}:L:${depth}`] = slot(composeDraw(L, depth, mode));
      slots[`${key}:R:${depth}`] = slot(composeDraw(R, depth, mode));
    }
    slots[`wall-lat:L1:${depth}`] = slot(composeDraw(3, depth));
    slots[`wall-lat:L2:${depth}`] = slot(composeDraw(6, depth));
    slots[`wall-lat:R1:${depth}`] = slot(composeDraw(9, depth));
    slots[`wall-lat:R2:${depth}`] = slot(composeDraw(12, depth));
    slots[`wall:front:${depth}`] = slot(composeDraw(0x00, depth));
    slots[`door:front:${depth}`] = slot(composeDraw(0xb2, depth));
  }

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
