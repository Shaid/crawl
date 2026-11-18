/**
 * Real-data verification suite for the MM1 maze codec.
 *
 * Runs ONLY when retail GOG DOS data is present at `data/mm1/dosega/` (the
 * repo's data dirs are gitignored, so this skips cleanly on a fresh clone).
 * Pins the codec against the actual game files:
 *
 *   - MAZEDATA.DTA is exactly 55×512 = 28160 bytes and decodes to 55 screens
 *   - MM.EXE's embedded slug table (file offset 0x10C07) parses to exactly the
 *     documented 55 slugs, in MAZEDATA order
 *   - the 55 `*.OVR` companion filenames are set-equal to the slug table
 *   - decode → encode is byte-exact against the disk file
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeMazeData,
  encodeMazeData,
  parseMapSlugsFromExe,
  MM1_MAP_FILE_SIZE,
  MM1_MAP_SCREENS,
  MM1_MAP_SLUGS,
} from '../map.ts';

const DATA_DIR = resolve('data/mm1/dosega');
const hasData = existsSync(resolve(DATA_DIR, 'MAZEDATA.DTA'));


/**
 * Wall-bit slot pairing (audit 2026-11-13): a wall on a cell's E face must
 * also be on its east neighbour's W face. With the correct W,S,E,N bit order
 * this holds ~99.9%; the old N,E,S,W labelling pairs the wrong slots (~37%).
 */
function symmetry(screens: { cells: { visual: Record<string, number> }[][] }[], eastOf: string, westOf: string) {
  let ok = 0, n = 0;
  for (const s of screens) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 15; x++) {
        const a = s.cells[y][x].visual[eastOf], b = s.cells[y][x + 1].visual[westOf];
        if (a === 0 && b === 0) continue;
        n++;
        if ((a !== 0) === (b !== 0)) ok++;
      }
    }
  }
  return ok / n;
}

describe('MM1 real retail data', { skip: !hasData }, () => {
  it('MAZEDATA.DTA is exactly 55 screens of 512 bytes', () => {
    const maze = readFileSync(resolve(DATA_DIR, 'MAZEDATA.DTA'));
    expect(maze.length).toBe(MM1_MAP_FILE_SIZE);
  });

  it('decodes all 55 screens, re-encoding byte-exact', () => {
    const maze = new Uint8Array(readFileSync(resolve(DATA_DIR, 'MAZEDATA.DTA')));
    const decoded = decodeMazeData(maze);
    expect(decoded.screens.length).toBe(MM1_MAP_SCREENS);
    expect([...encodeMazeData(decoded.screens)]).toEqual([...maze]);
    for (const s of decoded.screens) {
      expect(s.cells.length).toBe(16);
      expect(s.cells[0].length).toBe(16);
    }
  });

  it('MM.EXE slug table matches the documented 55-screen order', () => {
    const exe = new Uint8Array(readFileSync(resolve(DATA_DIR, 'MM.EXE')));
    const slugs = parseMapSlugsFromExe(exe);
    expect(slugs).toEqual([...MM1_MAP_SLUGS]);
  });

  it('the 55 *.OVR filenames are set-equal to the slug table', () => {
    const stems = readdirSync(DATA_DIR)
      .filter((f) => /\.OVR$/i.test(f))
      .map((f) => f.replace(/\.OVR$/i, '').toLowerCase());
    expect(stems.length).toBe(MM1_MAP_SCREENS);
    expect([...stems].sort()).toEqual([...new Set(MM1_MAP_SLUGS)].sort());
  });

  it('every screen has a walk-in entry and non-trivial structure', () => {
    const maze = new Uint8Array(readFileSync(resolve(DATA_DIR, 'MAZEDATA.DTA')));
    const { screens } = decodeMazeData(maze);
    for (const s of screens) {
      expect(s.entry[0]).toBeGreaterThanOrEqual(0);
      expect(s.entry[1]).toBeGreaterThanOrEqual(0);
      // Every real screen has at least one wall-coded cell; the Astral Plane
      // is the sparsest but still structured.
      const wallBytes = [...s.cells.flat()].some((c) =>
        [c.visual.n, c.visual.e, c.visual.s, c.visual.w].some((v) => v !== 0),
      );
      expect(wallBytes).toBe(true);
    }
  });

  it('wall bit labels W,S,E,N: east face pairs with east neighbour west face (null control: N/W)', () => {
    const maze = new Uint8Array(readFileSync(resolve(DATA_DIR, 'MAZEDATA.DTA')));
    const { screens } = decodeMazeData(maze);
    expect(symmetry(screens, 'e', 'w')).toBeGreaterThan(0.99);
    expect(symmetry(screens, 'n', 'w')).toBeLessThan(0.6); // wrong pairing collapses
  });
});
