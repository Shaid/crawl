/**
 * Decode MM1 `MAZEDATA.DTA` to JSON + minimap PNG atlases under
 * `public/assets/mm1/dosega/`.
 *
 * Usage: npx tsx tools/mm1/export-maps.ts [dataDir]
 *
 * `dataDir` defaults to `data/mm1/dosega` (the GOG DOS install). Required
 * files: `MAZEDATA.DTA` (geometry), `MM.EXE` (slug table cross-check),
 * `*.OVR` (companion map scripts, used to cross-check screen names).
 *
 * Outputs:
 *   data/maps.json              — every screen, fully decoded cells + stats
 *   screens/mm1-maps.png        — 55 north-up minimaps in one 11×5 atlas
 *   screens/mm1-maps.json       — atlas frame sidecar (frame name = slug)
 *
 * See `docs/mm1/dosega/data-structure.md` for the format spec and the
 * verification evidence (55×512 exact size, MM.EXE slug table @ 0x10C07
 * byte-identical to the 55 `.OVR` filenames, decoded layout sanity).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBinary, writePNG } from '@seer-project/pipeline';
import {
  MM1_MAP_FILE_SIZE,
  MM1_MAP_GRID,
  MM1_MAP_PAGE_SIZE,
  MM1_MAP_SCREEN_SIZE,
  MM1_MAP_SCREENS,
  MM1_MAP_SLUGS,
  decodeMazeData,
  parseMapSlugsFromExe,
  type Mm1MapCell,
  type Mm1MapScreen,
} from './map.ts';
import { writeJson, writeManifest, writePlatformIndex, syncDataManifest } from '../shared/asset-paths.ts';

/** Semantic minimap colours (not a game palette — atlas is a layout aid). */
const CELL_RGB: Record<number, [number, number, number]> = {
  0: [0x18, 0x18, 0x20], // open floor
  1: [0xa8, 0xa8, 0xb0], // wall
  2: [0xf8, 0xc8, 0x50], // torch
  3: [0xe0, 0x70, 0x48], // door
};
const EVENT_RGB: [number, number, number] = [0xff, 0x30, 0x30];
const SCALE = 2; // pixels per cell
const COLS = 11;
const ROWS = 5;

function cellIsDark(cell: Mm1MapCell): boolean {
  return cell.collision.n === 2 || cell.collision.e === 2 || cell.collision.s === 2;
}

function screenStats(cells: Mm1MapCell[][]): Record<string, number> {
  const stats = { walls: 0, torches: 0, doors: 0, events: 0, dark: 0 };
  for (const row of cells) {
    for (const cell of row) {
      for (const code of [cell.visual.n, cell.visual.e, cell.visual.s, cell.visual.w]) {
        if (code === 1) stats.walls++;
        else if (code === 2) stats.torches++;
        else if (code === 3) stats.doors++;
      }
      if (cell.event) stats.events++;
      if (cellIsDark(cell)) stats.dark++;
    }
  }
  return stats;
}

function drawCell(rgba: Uint8Array, aw: number, px: number, py: number, cell: Mm1MapCell): void {
  // px/py are the atlas-pixel origin of this cell (north-up flip already applied).
  let [r, g, b] = CELL_RGB[cell.visual.n] ?? CELL_RGB[0];
  for (const code of [cell.visual.n, cell.visual.e, cell.visual.s, cell.visual.w]) {
    if (code !== 0) [r, g, b] = CELL_RGB[code];
  }
  if (cellIsDark(cell)) {
    r >>= 1; g >>= 1; b >>= 1;
  }
  for (let pyo = 0; pyo < SCALE; pyo++) {
    for (let pxo = 0; pxo < SCALE; pxo++) {
      const i = ((py + pyo) * aw + (px + pxo)) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  if (cell.event) {
    const i = (py * aw + px) * 4;
    rgba[i] = EVENT_RGB[0]; rgba[i + 1] = EVENT_RGB[1]; rgba[i + 2] = EVENT_RGB[2];
  }
}

export interface Mm1ExportResult {
  game: 'mm1';
  platform: 'dosega';
  dataDir: string;
  outDir: string;
  screens: number;
  slugFromExe: boolean;
  ovrMatch: boolean;
  written: string[];
  warnings: string[];
}

export function exportMm1Maps(dataDir: string): Mm1ExportResult {
  const outDir = resolve('public/assets/mm1/dosega');
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const warnings: string[] = [];

  const mazePath = resolve(dataDir, 'MAZEDATA.DTA');
  if (!existsSync(mazePath)) {
    throw new Error(`MAZEDATA.DTA not found at ${mazePath} — point me at the GOG MM1 data dir`);
  }
  const maze = readBinary(mazePath);
  if (maze.length !== MM1_MAP_FILE_SIZE) {
    throw new Error(`MAZEDATA.DTA: expected ${MM1_MAP_FILE_SIZE} B (55×512), got ${maze.length}`);
  }

  // Slug table cross-checks: MM.EXE's embedded table and the .OVR filenames
  // must both agree with the 55-screen order/set.
  let slugs = MM1_MAP_SLUGS;
  let slugFromExe = true;
  const exePath = resolve(dataDir, 'MM.EXE');
  if (existsSync(exePath)) {
    try {
      const parsed = parseMapSlugsFromExe(readBinary(exePath));
      if (!parsed.every((s, i) => s === slugs[i])) {
        warnings.push(`MM.EXE slug table differs from the documented table (${parsed.length} entries) — using MM.EXE`);
        slugs = parsed;
        slugFromExe = false;
      }
    } catch (e) {
      warnings.push(`MM.EXE slug parse failed: ${(e as Error).message}`);
      slugFromExe = false;
    }
  } else {
    warnings.push('MM.EXE not present — slug table not cross-checked');
    slugFromExe = false;
  }

  const ovrStems = readdirSync(dataDir)
    .filter((f) => /\.OVR$/i.test(f))
    .map((f) => f.replace(/\.OVR$/i, '').toLowerCase())
    .sort();
  const ovrMatch =
    ovrStems.length === MM1_MAP_SCREENS &&
    [...new Set(slugs)].sort().every((s, i) => s === ovrStems[i]);
  if (!ovrMatch) {
    warnings.push(`expected ${MM1_MAP_SCREENS} *.OVR stems matching the slug set, got ${ovrStems.length}`);
  }

  const decoded = decodeMazeData(maze, slugs);

  // --- data/maps.json -------------------------------------------------------
  const jsonPath = resolve(outDir, 'data/maps.json');
  mkdirSync(resolve(outDir, 'data'), { recursive: true });
  writeJson(jsonPath, {
    game: 'mm1',
    file: 'MAZEDATA.DTA',
    size: maze.length,
    screenSize: MM1_MAP_SCREEN_SIZE,
    pageSize: MM1_MAP_PAGE_SIZE,
    grid: MM1_MAP_GRID,
    screens: decoded.screens.map((s: Mm1MapScreen) => ({
      index: s.index,
      slug: s.slug,
      title: s.title,
      env: s.env,
      entry: s.entry,
      stats: screenStats(s.cells),
      cells: s.cells.map((row) =>
        row.map((c) => ({
          visual: c.visual,
          collision: c.collision,
          event: c.event,
        })),
      ),
    })),
  });
  written.push(jsonPath);

  // --- screens/mm1-maps.png + sidecar --------------------------------------
  const aw = COLS * MM1_MAP_GRID * SCALE;
  const ah = ROWS * MM1_MAP_GRID * SCALE;
  const atlas = new Uint8Array(aw * ah * 4);
  const frames: { name: string; x: number; y: number; w: number; h: number }[] = [];
  for (let s = 0; s < decoded.screens.length; s++) {
    const col = s % COLS;
    const row = Math.floor(s / COLS);
    const ox = col * MM1_MAP_GRID * SCALE;
    const oy = row * MM1_MAP_GRID * SCALE;
    for (let y = 0; y < MM1_MAP_GRID; y++) {
      for (let x = 0; x < MM1_MAP_GRID; x++) {
        // North-up: atlas row r shows disk row (15 - r).
        drawCell(atlas, aw, ox + x * SCALE, oy + (MM1_MAP_GRID - 1 - y) * SCALE, decoded.screens[s].cells[y][x]);
      }
    }
    frames.push({
      name: decoded.screens[s].slug,
      x: ox,
      y: oy,
      w: MM1_MAP_GRID * SCALE,
      h: MM1_MAP_GRID * SCALE,
    });
  }
  const pngPath = resolve(outDir, 'screens/mm1-maps.png');
  const sidecarPath = resolve(outDir, 'screens/mm1-maps.json');
  mkdirSync(resolve(outDir, 'screens'), { recursive: true });
  writePNG(pngPath, atlas, aw, ah);
  writeJson(sidecarPath, { frames, width: aw, height: ah });
  written.push(pngPath, sidecarPath);

  // --- manifest + platform index --------------------------------------------
  writeManifest([{ name: 'screens/mm1-maps', sprites: decoded.screens.length, hasPalette: false, png: 'screens/mm1-maps.png' }], 'mm1', 'dosega');
  syncDataManifest('mm1', 'dosega');
  writePlatformIndex([{ game: 'mm1', platform: 'dosega' }]);

  return {
    game: 'mm1',
    platform: 'dosega',
    dataDir,
    outDir,
    screens: decoded.screens.length,
    slugFromExe,
    ovrMatch,
    written,
    warnings,
  };
}

export function main(): void {
  const dataDir = process.argv[2] ?? resolve('data/mm1/dosega');
  if (!existsSync(dataDir)) {
    console.error(`Data dir not found: ${dataDir}`);
    process.exit(1);
  }
  const result = exportMm1Maps(dataDir);
  for (const w of result.warnings) console.log(`  ! ${w}`);
  for (const p of result.written) console.log(`  wrote ${p}`);
  console.log(
    `${result.screens} screens decoded; slug table from MM.EXE: ${result.slugFromExe ? 'match' : 'not used'}; ` +
    `.OVR filename match: ${result.ovrMatch ? '55/55' : 'FAIL'}`,
  );
}

const isStandalone =
  process.argv[1]?.endsWith('export-maps.ts') || process.argv[1]?.endsWith('export-maps');
if (isStandalone) main();
