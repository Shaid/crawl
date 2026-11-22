/**
 * Full walker-vs-game parity sweep for the SNES Wizardry 6 dungeon view
 * (`data-structure.md` §3.14.13). For every party cell of a level (the
 * region boxes from `$80:D78E`, (0,0) placeholders excluded) x 4 facings:
 *
 * - game: `SnesW6Machine.runPose` -- the ROM's window builder, palette,
 *   tilemap, `$80:C69F` walk, `$83:E25A` painter and DMA, read back as
 *   144x120 4bpp pixels; then `tryMove` for all four relative directions
 *   (the ROM's `$80:C40B` decision);
 * - walker: `resolveViewWords` + `compositeSnesView` + `canStepWindow` on
 *   the window `export-maze-windows.ts` assigns to that cell.
 *
 * A second pass checks window retention (`$80:D039`): for every accepted
 * forward step that stays inside the centre region, the game continues
 * from the previous pose's WRAM and the walker keeps the previous window.
 *
 * Run one level per process (memory): `npx tsx
 * tools/wizardry6/snes/oracle/sweep-parity.ts <level> [stride] [--png
 * gx,gy,facing --out dir]`. Needs only the ROM (`W6_SNES_ROM` or the
 * default `data/` path). Prints one summary line; exits 1 on any residual.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { SnesW6Machine, partyCells, DEFAULT_ROM_PATH, type PoseResult } from './machine.ts';
import { buildDungeonView } from '../export-dungeon-view.ts';
import { buildMazeWindows } from '../export-maze-windows.ts';
import {
  resolveViewWords,
  compositeSnesView,
  extractPoolIndices,
  canStepWindow,
  decodeMazeWindow,
  inCentreRegion,
  type MazeWindow,
  type ViewPiecesFile,
} from '../view-model.ts';

export interface ParityContext {
  rom: Uint8Array;
  machine: SnesW6Machine;
  vp: ViewPiecesFile;
  pool: Uint8Array;
  poolW: number;
}

export function makeParityContext(rom: Uint8Array): ParityContext {
  const view = buildDungeonView(rom);
  return {
    rom,
    machine: new SnesW6Machine(rom),
    vp: view.viewPieces,
    pool: extractPoolIndices(view.atlas.rgba, view.atlas.width, view.atlas.height),
    poolW: view.atlas.width,
  };
}

const IDENTITY = Array.from({ length: 16 }, (_, i) => ({ r: i, g: i, b: i }));

/** Walker pixels as raw 4bpp indices (identity palette, index in R). */
export function walkerIndices(ctx: ParityContext, words: number[]): Uint8Array {
  const { rgba, width, height } = compositeSnesView(ctx.vp, ctx.pool, ctx.poolW, IDENTITY, words);
  const idx = new Uint8Array(width * height);
  for (let i = 0; i < idx.length; i++) idx[i] = rgba[i * 4]!;
  return idx;
}

export interface PoseParity {
  words: boolean;
  pixels: number; // differing pixels
  moves: [boolean, boolean, boolean, boolean]; // walker == game, rel 0-3
  game: PoseResult;
  walkerWords: number[];
  walkerIdx: Uint8Array;
}

export function comparePose(ctx: ParityContext, w: MazeWindow, level: number, gx: number, gy: number, facing: number): PoseParity {
  const game = ctx.machine.runPose(level, gx, gy, facing);
  if (game.error) throw new Error(`game run failed at L${level} (${gx},${gy}) f${facing}: ${game.error}`);
  const gameMoves = ([0, 1, 2, 3] as const).map((rel) => ctx.machine.tryMove(rel));
  const walkerWords = resolveViewWords(ctx.vp, w, gx, gy, facing);
  const walkerIdx = walkerIndices(ctx, walkerWords);
  let pixels = 0;
  for (let i = 0; i < walkerIdx.length; i++) if (walkerIdx[i] !== game.idx[i]) pixels++;
  const words = game.words.length === walkerWords.length && game.words.every((v, i) => v === walkerWords[i]);
  const moves = [0, 1, 2, 3].map((rel) => canStepWindow(ctx.vp, w, gx, gy, facing, (facing + rel) & 3) === gameMoves[rel]) as PoseParity['moves'];
  return { words, pixels, moves, game, walkerWords, walkerIdx };
}

function rgbOf(cgram: Uint16Array, pal: number, v: number): [number, number, number] {
  const c = cgram[v ? pal * 16 + v : 0]!;
  return [(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3];
}

/** game | walker | diff (red = differing index); both panels coloured through the game's own CGRAM and BG2 tile palettes, so only index differences show. */
export function writeTriptych(path: string, p: PoseParity): void {
  const W = 144;
  const H = 120;
  const png = new PNG({ width: W * 3 + 8, height: H });
  png.data.fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const pal = p.game.palNo[i]!;
      const g = rgbOf(p.game.cgram, pal, p.game.idx[i]!);
      const w = rgbOf(p.game.cgram, pal, p.walkerIdx[i]!);
      const same = p.game.idx[i] === p.walkerIdx[i];
      const d: [number, number, number] = same ? [g[0] >> 2, g[1] >> 2, g[2] >> 2] : [255, 0, 0];
      for (const [panel, c] of [[0, g], [1, w], [2, d]] as const) {
        const o = (y * png.width + panel * (W + 4) + x) * 4;
        png.data[o] = c[0];
        png.data[o + 1] = c[1];
        png.data[o + 2] = c[2];
        png.data[o + 3] = 255;
      }
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

export interface LevelReport {
  level: number;
  poses: number;
  wordMismatch: number;
  pixelMismatchPoses: number;
  pixelsDiffering: number;
  moveChecks: number;
  moveMismatch: number;
  retentionChecks: number;
  retentionMismatch: number;
  residuals: Array<Record<string, unknown>>;
}

export function sweepLevel(ctx: ParityContext, level: number, stride = 1): LevelReport {
  const file = buildMazeWindows(ctx.rom, [level]);
  const decoded = new Map<number, MazeWindow>();
  const win = (i: number) => {
    let w = decoded.get(i);
    if (!w) decoded.set(i, (w = decodeMazeWindow(file, i)));
    return w;
  };
  const r: LevelReport = { level, poses: 0, wordMismatch: 0, pixelMismatchPoses: 0, pixelsDiffering: 0, moveChecks: 0, moveMismatch: 0, retentionChecks: 0, retentionMismatch: 0, residuals: [] };
  const cells = partyCells(ctx.rom, level);
  for (let ci = 0; ci < cells.length; ci += stride) {
    const c = cells[ci]!;
    const w = win(file.cells[level]![`${c.gx},${c.gy}`]!);
    for (let facing = 0; facing < 4; facing++) {
      const p = comparePose(ctx, w, level, c.gx, c.gy, facing);
      r.poses++;
      r.moveChecks += 4;
      const badMoves = p.moves.filter((m) => !m).length;
      r.moveMismatch += badMoves;
      if (!p.words) r.wordMismatch++;
      if (p.pixels) {
        r.pixelMismatchPoses++;
        r.pixelsDiffering += p.pixels;
      }
      if ((!p.words || p.pixels || badMoves) && r.residuals.length < 200) {
        const gs = new Set(p.game.words);
        const ws = new Set(p.walkerWords);
        r.residuals.push({
          gx: c.gx,
          gy: c.gy,
          facing,
          pixels: p.pixels,
          moves: p.moves,
          missing: p.game.words.filter((v) => !ws.has(v)).map((v) => v.toString(16)),
          extra: p.walkerWords.filter((v) => !gs.has(v)).map((v) => v.toString(16)),
        });
      }
      // $80:D039 retention: step forward in the game from this pose's WRAM if it stays in the centre region
      if (canStepWindow(ctx.vp, w, c.gx, c.gy, facing, facing)) {
        const nx = c.gx + [0, 1, 0, -1][facing]!;
        const ny = c.gy + [1, 0, -1, 0][facing]!;
        if (inCentreRegion(w, level, nx, ny)) {
          ctx.machine.runPose(level, c.gx, c.gy, facing);
          const g2 = ctx.machine.continuePose(nx, ny, facing);
          const ww = resolveViewWords(ctx.vp, w, nx, ny, facing);
          r.retentionChecks++;
          if (g2.error || g2.words.length !== ww.length || g2.words.some((v, i) => v !== ww[i])) {
            r.retentionMismatch++;
            if (r.residuals.length < 200) r.residuals.push({ retention: true, gx: c.gx, gy: c.gy, facing });
          }
        }
      }
    }
  }
  return r;
}

function main() {
  const args = process.argv.slice(2);
  const level = Number(args[0]);
  const stride = args[1] && !args[1].startsWith('--') ? Number(args[1]) : 1;
  const romPath = process.env.W6_SNES_ROM ?? DEFAULT_ROM_PATH;
  const ctx = makeParityContext(new Uint8Array(readFileSync(romPath)));
  const pngAt = args.indexOf('--png');
  const outAt = args.indexOf('--out');
  if (pngAt >= 0) {
    const out = resolve(outAt >= 0 ? args[outAt + 1]! : '.');
    mkdirSync(out, { recursive: true });
    const file = buildMazeWindows(ctx.rom, [level]);
    for (const spec of args.slice(pngAt + 1).filter((a) => /^\d+,\d+,\d$/.test(a))) {
      const [gx, gy, facing] = spec.split(',').map(Number) as [number, number, number];
      const w = decodeMazeWindow(file, file.cells[level]![`${gx},${gy}`]!);
      const p = comparePose(ctx, w, level, gx, gy, facing);
      const path = resolve(out, `L${level}-${gx}-${gy}-f${facing}.png`);
      writeTriptych(path, p);
      console.log(`${path}: words ${p.words ? 'equal' : 'DIFFER'}, ${p.pixels} px differ`);
    }
    return;
  }
  const t0 = Date.now();
  const r = sweepLevel(ctx, level, stride);
  console.log(
    `L${level}: poses=${r.poses} wordListMismatch=${r.wordMismatch} pixelMismatchPoses=${r.pixelMismatchPoses} pixelsDiffering=${r.pixelsDiffering} ` +
      `moves=${r.moveChecks - r.moveMismatch}/${r.moveChecks} retention=${r.retentionChecks - r.retentionMismatch}/${r.retentionChecks} secs=${((Date.now() - t0) / 1000).toFixed(0)}`,
  );
  if (outAt >= 0) {
    mkdirSync(resolve(args[outAt + 1]!), { recursive: true });
    writeFileSync(resolve(args[outAt + 1]!, `L${String(level).padStart(2, '0')}.json`), JSON.stringify(r, null, 1));
  }
  if (r.wordMismatch || r.pixelMismatchPoses || r.moveMismatch || r.retentionMismatch) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('sweep-parity.ts')) main();
