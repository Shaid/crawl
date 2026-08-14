import { describe, expect, it } from 'vitest';
import {
  decodeMazeData,
  encodeMazeData,
  findEntry,
  mm1EnvForSlug,
  mm1MapTitle,
  parseMapSlugsFromExe,
  MM1_MAP_FILE_SIZE,
  MM1_MAP_GRID,
  MM1_MAP_SCREENS,
  MM1_MAP_SLUGS,
} from '../map.ts';

describe('MM1 slug table', () => {
  it('has exactly 55 unique slugs in MAZEDATA order', () => {
    expect(MM1_MAP_SLUGS.length).toBe(MM1_MAP_SCREENS);
    expect(new Set(MM1_MAP_SLUGS).size).toBe(MM1_MAP_SCREENS);
  });

  it('covers the 5 towns, 9 caves, 20 overland sectors and 21 dungeons', () => {
    const towns = MM1_MAP_SLUGS.filter((s) => mm1EnvForSlug(s) === 'town');
    const caves = MM1_MAP_SLUGS.filter((s) => mm1EnvForSlug(s) === 'cavern');
    const outside = MM1_MAP_SLUGS.filter((s) => mm1EnvForSlug(s) === 'outside');
    expect(new Set(towns)).toEqual(new Set(['sorpigal', 'portsmit', 'algary', 'dusk', 'erliquin', 'alamar', 'blackrn', 'blackrs']));
    expect(outside.length).toBe(20);
    expect(outside.every((s) => /^area[a-e][1-4]$/.test(s))).toBe(true);
    expect(caves.length).toBe(55 - 8 - 20);
  });

  it('titles every slug without throwing and formats the dynamic families', () => {
    for (const s of MM1_MAP_SLUGS) expect(mm1MapTitle(s).length).toBeGreaterThan(0);
    expect(mm1MapTitle('cave3')).toBe('Cave 3');
    expect(mm1MapTitle('areab2')).toBe('Overland B2');
  });

  it('parses the 55-slug table from a synthetic MM.EXE image', () => {
    const buf = new Uint8Array(0x10c07 + 512);
    let off = 0x10c07;
    for (const s of MM1_MAP_SLUGS) {
      for (const c of s) buf[off++] = c.charCodeAt(0);
      buf[off++] = 0;
    }
    expect(parseMapSlugsFromExe(buf)).toEqual([...MM1_MAP_SLUGS]);
  });

  it('rejects an MM.EXE whose slug list does not run to 55', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < 'sorpigal'.length; i++) buf[i] = 'sorpigal'.charCodeAt(i);
    buf[8] = 0;
    expect(() => parseMapSlugsFromExe(buf)).toThrow(/55/);
  });
});

describe('MM1 maze data decode', () => {
  it('round-trips a synthetic 55-screen file byte-exact', () => {
    const data = new Uint8Array(MM1_MAP_FILE_SIZE);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const decoded = decodeMazeData(data);
    expect(decoded.screens.length).toBe(MM1_MAP_SCREENS);
    expect(decoded.screens[0].cells.length).toBe(MM1_MAP_GRID);
    expect(decoded.screens[0].cells[0].length).toBe(MM1_MAP_GRID);
    expect([...encodeMazeData(decoded.screens)]).toEqual([...data]);
  });

  it('rejects data smaller than 55×512', () => {
    expect(() => decodeMazeData(new Uint8Array(MM1_MAP_FILE_SIZE - 1))).toThrow(/28160/);
  });

  it('finds a walk-in entry on an open cell', () => {
    const page = new Uint8Array(256);
    page.fill(0xff, 0, 16); // entire disk row 0 fully blocked
    page[16] = 0x00; // row 1, col 0 open -> x=0, y=1
    expect(findEntry(page)).toEqual([0, 1]);
  });

  it('falls back to the centre on a fully blocked screen', () => {
    expect(findEntry(new Uint8Array(256).fill(0xff))).toEqual([8, 8]);
  });

  it('decodes visual-page wall code 2 as door and 3 as torch, not the reverse', () => {
    // N=2 (door), E=3 (torch): byte = (3<<2)|2 = 0x0E. See the "Correction"
    // note in docs/mm1/dosega/data-structure.md — earlier docs/comments had
    // this backwards.
    const data = new Uint8Array(MM1_MAP_FILE_SIZE);
    data[0] = 0x0e; // screen 0, page 0 (visual), cell (row 0, col 0)
    const decoded = decodeMazeData(data);
    const cell = decoded.screens[0].cells[0][0];
    expect(cell.visual.n).toBe(2); // door
    expect(cell.visual.e).toBe(3); // wall+torch
  });
});
