/**
 * SNES walker-vs-game parity on a fixed sample, with the ROM's own code as
 * the oracle (`tools/wizardry6/snes/oracle/`: the window builder `$80:D073`,
 * the view walk `$80:C69F` + painter, and the movement decision `$80:C40B`
 * run in a 65816 core). The full sweep (every party cell x 4 facings of
 * all 14 levels) is `oracle/sweep-parity.ts`; this is its regression
 * subset. Needs only the ROM -- every asset is rebuilt in memory -- and
 * skips (does not fail) without it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_ROM_PATH, SnesW6Machine, partyCells } from '../oracle/machine.ts';
import { makeParityContext, comparePose, type ParityContext } from '../oracle/sweep-parity.ts';
import { encodeWindow, romStartPose } from '../export-maze-windows.ts';
import { decodeMazeWindow, resolveViewWords, canStepWindow, inCentreRegion, type MazeWindow, type MazeWindowsFile } from '../view-model.ts';

const ROM = resolve(process.env.W6_SNES_ROM ?? DEFAULT_ROM_PATH);
const haveRom = existsSync(ROM);
const LEVELS = 14;
const PER_LEVEL = 6;

let ctx: ParityContext | null = null;
function context(): ParityContext {
  if (!ctx) ctx = makeParityContext(new Uint8Array(readFileSync(ROM)));
  return ctx;
}

let builder: SnesW6Machine | null = null;
/** The window the exporter would ship for (level, gx, gy), through the file's own encode/decode -- on a second machine, so the game's WRAM is untouched. */
function windowFor(c: ParityContext, level: number, gx: number, gy: number): MazeWindow {
  builder ??= new SnesW6Machine(c.rom);
  const raw = builder.buildWindow(level, gx, gy);
  const file = { windows: [encodeWindow(level, raw)], cells: [], start: romStartPose(c.rom) } as MazeWindowsFile;
  return decodeMazeWindow(file, 0);
}

describe.skipIf(!haveRom)('SNES walker matches the game (ROM-driven sample)', () => {
  for (let level = 0; level < LEVELS; level++) {
    it(
      `level ${level}: compose words, pixels and movement on ${PER_LEVEL} cells x 4 facings`,
      () => {
        const c = context();
        const cells = partyCells(c.rom, level);
        const bad: string[] = [];
        for (let k = 0; k < PER_LEVEL; k++) {
          // fixed, spread-out sample: cell k*(n/PER_LEVEL) + level (so levels don't all sample corner cells)
          const cell = cells[(Math.floor((k * cells.length) / PER_LEVEL) + level * 7) % cells.length]!;
          const w = windowFor(c, level, cell.gx, cell.gy);
          for (let facing = 0; facing < 4; facing++) {
            const p = comparePose(c, w, level, cell.gx, cell.gy, facing);
            if (!p.words || p.pixels || p.moves.some((m) => !m)) {
              bad.push(`(${cell.gx},${cell.gy}) f${facing}: words ${p.words ? 'ok' : 'DIFFER'}, ${p.pixels} px, moves ${p.moves.map((m) => (m ? '.' : 'x')).join('')}`);
            }
          }
        }
        expect(bad).toEqual([]);
      },
      60_000,
    );
  }

  it(
    'a 200-step right-hand-rule walk from the ROM start keeps/switches windows like $80:D039',
    () => {
      const c = context();
      const start = romStartPose(c.rom);
      let { x, y, facing } = start;
      const level = start.level;
      let w = windowFor(c, level, x, y);
      c.machine.runPose(level, x, y, facing);
      const bad: string[] = [];
      let crossings = 0;
      const check = (rel: 0 | 1) => {
        const game = c.machine.tryMove(rel);
        const walker = canStepWindow(c.vp, w, x, y, facing, (facing + rel) & 3);
        if (game !== walker) bad.push(`(${x},${y}) f${facing} rel ${rel}: game ${game} walker ${walker}`);
        return game;
      };
      for (let step = 0; step < 200; step++) {
        if (check(1)) facing = (facing + 1) & 3; // right open: turn right, then step
        else if (!check(0)) {
          facing = (facing + 3) & 3; // blocked ahead: turn left in place
          c.machine.continuePose(x, y, facing);
          continue;
        }
        x += [0, 1, 0, -1][facing]!;
        y += [1, 0, -1, 0][facing]!;
        if (!inCentreRegion(w, level, x, y)) {
          w = windowFor(c, level, x, y);
          crossings++;
        }
        const g = c.machine.continuePose(x, y, facing);
        const words = resolveViewWords(c.vp, w, x, y, facing);
        if (g.error || g.words.length !== words.length || g.words.some((v, i) => v !== words[i])) bad.push(`step ${step} (${x},${y}) f${facing}: words differ`);
      }
      expect(bad).toEqual([]);
      expect(crossings).toBeGreaterThan(2);
    },
    60_000,
  );
});
