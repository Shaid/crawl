/**
 * Export Wizardry 6's **slot-key scheme** to `slots.json` (M6:
 * `dungeon-walker-m6-wiring`, "derive the general per-cell slot-key scheme,
 * matching Black Crypt's own M2 milestone").
 *
 * The scheme comes straight from `CODE+0x9b58`'s per-call-site literal
 * `baseIndex` constants (re-read from `disasm/Bane.asm`): the dungeon view
 * is composed of compose-list runs, one record per depth step, and the
 * per-cell dispatcher draws **two pieces per wall call** — an upper
 * perspective strip and a lower wall — each via `DrawMazePiece`'s mirrored
 * `(srcIdx, dstIdx)` path. The five wall call sites (front + two left
 * layers + two right layers, the right being the exact mirror of the left)
 * give the keys:
 *
 *   `wall:<kind>:<depth>`         lower wall (dir 0-2 texture at side slots)
 *   `wall-upper:<kind>:<depth>`   upper perspective strip (dir 48-55 / 44-46)
 *   `door:front:<depth>`          the alternate front-wall door art
 *
 * with `kind ∈ {front, left1, left2, right1, right2}` and `<depth>` 0..2.
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
 * the left) plus the front-door run give the keys:
 *
 *   `wall:front:<depth>` / `door:front:<depth>` — the front wall or door art
 *   `wall-side:L:<depth>` / `wall-side:R:<depth>` — the per-cell side walls
 *   (proper receding side art, dir 4-10, mirrored)
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
  const composeDraw = (baseIndex: number, depth: number) => {
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
      blend: 'or' as const,
      origin: `mazedata-composelist[${baseIndex + depth}] (direct wall draw)`,
    };
  };

  /** Resolve one mirrored `(srcIdx, dstIdx)` compose pair + depth into a package `PieceDraw` — `DrawMazePiece`'s mirrored path (§4.4): graphic from `compose[src+depth].dirIndex`, placement from `compose[dst+depth]`, horizontally mirrored. Returns `null` when either record is a zero-width filler. */
  const mirroredDraw = (srcBase: number, dstBase: number, depth: number) => {
    const srcRec = maze.composeList[srcBase + depth];
    const dstRec = maze.composeList[dstBase + depth];
    if (!srcRec || !dstRec || srcRec.widthBytes === 0 || dstRec.widthBytes === 0) return null;
    const gfx = maze.dirRecords[srcRec.dirIndex]!;
    const frame = frameByName(`mazedata_dir${String(srcRec.dirIndex).padStart(3, '0')}`);
    const srcByteStart = gfx.widthUnits - dstRec.srcClip - dstRec.widthBytes;
    return {
      bank: 'mazedata',
      frame: `mazedata_dir${String(srcRec.dirIndex).padStart(3, '0')}`,
      destX: (dstRec.destXByte + dstRec.srcClip) * 8,
      destY: dstRec.destY,
      srcX: frame.x + srcByteStart * 8,
      srcY: frame.y,
      srcW: dstRec.widthBytes * 8,
      srcH: gfx.heightPx,
      mirrorX: true,
      blend: 'or' as const,
      origin: `mazedata-composelist[${srcBase + depth}->${dstBase + depth}] (mirrored side-wall pair)`,
    };
  };

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

  // Per-cell walls:
  //   side walls: wall-return art (baseIndex 3/6 left, 9/12 right) PLUS the
  //     receding side-wall texture strips (STATIC_CORRIDOR_CALLS[3+depth] left,
  //     [6+depth] right) — all conditional on side-wall detection at that depth.
  //   front wall: baseIndex 0, conditional on front-wall detection.
  for (let depth = 0; depth < 3; depth++) {
    const leftDraws = [
      staticDraw(STATIC_CORRIDOR_CALLS[3 + depth]!),
      composeDraw(3, depth),
      composeDraw(6, depth),
    ].filter((d): d is NonNullable<typeof d> => d !== null);
    slots[`wall-side:L:${depth}`] = leftDraws.length > 0 ? { draws: leftDraws } : null;
    const rightDraws = [
      staticDraw(STATIC_CORRIDOR_CALLS[6 + depth]!),
      composeDraw(9, depth),
      composeDraw(12, depth),
    ].filter((d): d is NonNullable<typeof d> => d !== null);
    slots[`wall-side:R:${depth}`] = rightDraws.length > 0 ? { draws: rightDraws } : null;
    const frontDraw = composeDraw(0x00, depth);
    slots[`wall:front:${depth}`] = frontDraw ? { draws: [frontDraw] } : null;
    slots[`door:front:${depth}`] = (() => { const d = composeDraw(0xb2, depth); return d ? { draws: [d] } : null; })();
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
