/**
 * Exports `dungeon/maze-windows.json`: the 24x24 maze windows the SNES
 * Wizardry 6 ROM itself builds around the party, captured by running the
 * game's own builder (`$80:D06C` -> `$80:D073`: `$8B:DE64` maze reload,
 * `D15A`/`D1B7`/`D2BE`/`D450`/`D412`, the origin probes at `$80:D758`, the
 * `$0896` early stop) in the `oracle/` 65816 core, once per party cell, from
 * new-game WRAM (every quest flag clear, `$096C` = `$094D` = 0).
 * `data-structure.md` §3.14.13.
 *
 * Why not rebuild the window from `data/maze.json`: the window depends on
 * which neighbour regions the builder's eight probe points land in from
 * the exact cell the party entered at, on per-region seeds (`$80:D2BE`:
 * level 0 regions 0-5 seed `0x0E`, not `$80:DB8D`'s `0x0D`), on the
 * `$80:DAD7` bit-7 early stop, and on the level-8 `$7E:DBC0` stairs flag
 * the region blitter sets (`$80:D23D`, new-game branch `$096C == 0`). 191
 * distinct windows exist across the 14 levels; a static densified grid
 * matches none of the levels everywhere.
 *
 * Output: `windows[]` (planes base64, `null` = all zero), `cells[level]`
 * (`"gx,gy"` -> window index: the window built on arrival at that cell),
 * and `start` (`$80:891B` entry 0). The walker keeps its window while the
 * party stays inside the window's centre region (`$80:D039`) and switches
 * to `cells[level][cell]` when it leaves.
 *
 * Usage: npx tsx tools/wizardry6/snes/export-maze-windows.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SnesW6Machine, partyCells, type RawWindow } from './oracle/machine.ts';
import type { MazeWindowsFile } from './view-model.ts';

export const LEVEL_COUNT = 14;

function planeB64(p: Uint8Array): string | null {
  return p.some((v) => v !== 0) ? Buffer.from(p).toString('base64') : null;
}

function windowKey(w: RawWindow): string {
  return `${Buffer.concat([w.wall, w.feature, w.variant, w.dbc0]).toString('base64')}|${w.originX},${w.originY},${w.region},${w.be}`;
}

/** One captured window in the file's encoding. */
export function encodeWindow(level: number, w: RawWindow): MazeWindowsFile['windows'][number] {
  return {
    level,
    region: w.region,
    be: w.be,
    originX: w.originX,
    originY: w.originY,
    wall: Buffer.from(w.wall).toString('base64'),
    feature: Buffer.from(w.feature).toString('base64'),
    variant: Buffer.from(w.variant).toString('base64'),
    dbc0: planeB64(w.dbc0),
  };
}

/** `$80:891B` entry 0: facing, level, y (u16), x (u16), `$094C` -- loaded by `$80:88B8` before its `JSL $80:D073`. */
export function romStartPose(rom: Uint8Array): MazeWindowsFile['start'] {
  const o = 0x091b;
  return { level: rom[o + 1]!, y: rom[o + 2]! | (rom[o + 3]! << 8), x: rom[o + 4]! | (rom[o + 5]! << 8), facing: rom[o]!, palette094c: rom[o + 6]! };
}

/** Build the whole file in memory. `levels` restricts which levels are built (others get an empty cell map). */
export function buildMazeWindows(rom: Uint8Array, levels: number[] = [...Array(LEVEL_COUNT).keys()]): MazeWindowsFile & { note: string } {
  const m = new SnesW6Machine(rom);
  const windows: MazeWindowsFile['windows'] = [];
  const byKey = new Map<string, number>();
  const cells: Array<Record<string, number>> = Array.from({ length: LEVEL_COUNT }, () => ({}));
  for (const level of levels) {
    for (const c of partyCells(rom, level)) {
      const w = m.buildWindow(level, c.gx, c.gy);
      const dx = c.gx - w.originX;
      const dy = c.gy - w.originY;
      if (dx < 0 || dx >= 8 || dy < 0 || dy >= 8) {
        throw new Error(`Oracle check FAILED: level ${level} cell (${c.gx},${c.gy}) is outside the centre region the game built (${w.originX},${w.originY})`);
      }
      const key = windowKey(w);
      let idx = byKey.get(key);
      if (idx === undefined) {
        idx = windows.length;
        byKey.set(key, idx);
        windows.push(encodeWindow(level, w));
      }
      cells[level]![`${c.gx},${c.gy}`] = idx;
    }
  }
  return {
    windows,
    cells,
    start: romStartPose(rom),
    note:
      'The 24x24 maze windows $80:D073 builds (WRAM $7E:4300 wall / $7E:4540 feature / $7E:4780 variant / $7E:DBC0 stairs flag; ' +
      'index = row*24+col, row 0 = north; global (originX, originY) sits at row 15 col 8), captured by running the ROM in the ' +
      'tools/wizardry6/snes/oracle/ 65816 core from new-game WRAM. cells[level]["gx,gy"] = the window built on arrival at that cell; ' +
      'the game keeps a window while the party stays in its centre region ($80:D039). data-structure.md §3.14.13.',
  };
}

export function exportMazeWindows(romPath: string, outDir = resolve('public/assets/wizardry6/snes')): void {
  const t0 = Date.now();
  const file = buildMazeWindows(new Uint8Array(readFileSync(romPath)));
  const dir = resolve(outDir, 'dungeon');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'maze-windows.json'), JSON.stringify(file));
  const n = file.cells.reduce((a, c) => a + Object.keys(c).length, 0);
  console.log(`  maze-windows: ${file.windows.length} distinct windows over ${n} party cells, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/export-maze-windows.ts <path-to-sfc>');
    process.exit(1);
  }
  exportMazeWindows(romPath);
}
