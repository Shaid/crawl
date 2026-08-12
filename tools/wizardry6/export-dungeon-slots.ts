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
import { STATIC_CORRIDOR_CALLS, type DrawMazePieceCall } from './static-corridor-calls.ts';

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

  // A `mirroredDraw` helper (graphic from `compose[src+depth]`, placement
  // from `compose[dst+depth]`, horizontally mirrored) used to live here, for
  // the "18-24(A5) are mirrored (src,dst) pairs" reading of `0x9b58`'s arg
  // blocks. §4.7.1's second correction retired that reading — every wall
  // site draws directly via `composeDraw` — and the helper went unused; the
  // mirrored path survives only in `staticDraw`, which genuinely needs it.

  // staticDraw: resolve one DrawMazePieceCall into a PieceDraw for use in
  // both the static backdrop and the conditional far-end archway.
  const staticDraw = (call: DrawMazePieceCall) => {
    const direct = call.dstIdx === 0xffff;
    const placementRec = maze.composeList[direct ? call.srcIdx : call.dstIdx]!;
    const graphicRec = maze.composeList[call.srcIdx]!;
    const gfx = maze.dirRecords[graphicRec.dirIndex]!;
    const frame = frameByName(`mazedata_dir${String(graphicRec.dirIndex).padStart(3, '0')}`);
    const srcByteStart = direct
      ? placementRec.srcClip
      : gfx.widthUnits - placementRec.srcClip - placementRec.widthBytes;
    return {
      bank: 'mazedata',
      frame: `mazedata_dir${String(graphicRec.dirIndex).padStart(3, '0')}`,
      destX: (placementRec.destXByte + placementRec.srcClip) * 8,
      destY: placementRec.destY,
      srcX: frame.x + srcByteStart * 8,
      srcY: frame.y,
      srcW: placementRec.widthBytes * 8,
      srcH: gfx.heightPx,
      mirrorX: !direct,
      blend: (call.mode === 0 ? 'replace' : 'or') as 'replace' | 'or',
      origin: `static-corridor call (${call.srcIdx},${call.mode},${call.dstIdx})`,
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

  const slot = (draw: ReturnType<typeof composeDraw>) => (draw ? { draws: [draw] } : null);
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

  // Static background — only ceiling and floor, drawn every frame.
  // (Assuming no level has gaps in floor or roof; if that proves wrong,
  // these will also need to become conditional.)
  // Ceiling: record 122 (depth=0 centre bar, 144×7 at x=88,y=32) plus the
  // three perspective strips 123-125 (CODE+0x632c STATIC_CORRIDOR_CALLS[0-2]).
  // Record 122 confirmed drawn by the outer renderer CODE+0xa72c via its first
  // unconditional batch (0xab32-0xabba), base index 0x7a=122, depth=0.
  const ceilDraw122 = composeDraw(122, 0);
  // Floor: record 150 (depth=0 centre bar, 144×16 at x=88,y=128) plus strips
  // 151-153.  Record 150 confirmed by the same outer-renderer batch.
  const floorDraw150 = composeDraw(150, 0);

  const staticSlots = [
    { draws: [ceilDraw122, ...STATIC_CORRIDOR_CALLS.slice(0, 3).map(staticDraw)].filter((d): d is NonNullable<typeof d> => d !== null) },  // ceiling
    { draws: [floorDraw150, ...STATIC_CORRIDOR_CALLS.slice(9, 12).map(staticDraw)].filter((d): d is NonNullable<typeof d> => d !== null) }, // floor
  ];

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

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/export-dungeon-slots.ts <dataDir>');
    process.exit(1);
  }

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

const isStandalone =
  process.argv[1]?.endsWith('export-dungeon-slots.ts') ||
  process.argv[1]?.endsWith('export-dungeon-slots');

if (isStandalone) main();
