/**
 * `tools/walker/mm3-indoor-view.ts` — the TS port of
 * `scripts/mm3lib/dos_indoor_view.py`'s `build_wall_list`. Both are pure
 * reimplementations of the same frozen `mm3_indoor_view.json` table
 * (Python and TS ship separate copies of the *algorithm* but read the
 * *same* committed table via `scripts/extract_mm3_dos_mazes.py`'s publish
 * step — see that table's `_meta` field for provenance).
 *
 * `mm3-indoor-view-fixture.json` is a golden fixture: 90 real (maze id,
 * position, facing, alt, torch) cases run through the Python reference
 * (itself verified byte-identical to a live-disassembly oracle across
 * 497,664 cases — see `dos_indoor_view.py`'s module doc) and their
 * expected draw lists recorded. This test re-runs the same cases through
 * the TS port and checks for an exact match — the strongest practical
 * regression guard without needing Python in the JS test pipeline.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWallList, type IndoorViewTable } from '../mm3-indoor-view.ts';

const TABLE_PATH = resolve(import.meta.dirname, '../../../scripts/mm3lib/mm3_indoor_view.json');
const FIXTURE_PATH = resolve(import.meta.dirname, './mm3-indoor-view-fixture.json');
const hasData = existsSync(TABLE_PATH) && existsSync(FIXTURE_PATH);

const MASK_TO_DIR: Record<number, number> = { 0x7000: 0, 0x0700: 1, 0x0070: 2, 0x0007: 3 };
const DIR_SHIFT = [12, 8, 4, 0];

function wallGraphicIndex(walls: number[], x: number, y: number, dir: number): number {
  const v = walls[y * 16 + x]!;
  return (v >> DIR_SHIFT[dir & 3]!) & 7;
}

interface FixtureCase {
  mazeId: number;
  x: number;
  y: number;
  facing: number;
  alt: number;
  torch: number;
  expected: Array<{ sprite: string; frame: number; x: number; y: number; flags: number }>;
}

interface Fixture {
  /** mazeId (as a string key) -> that maze's 256-entry wall array — one copy per unique maze, not per case. */
  mazeWalls: Record<string, number[]>;
  cases: FixtureCase[];
}

describe('buildWallList vs. the verified Python reference (golden fixture)', { skip: !hasData }, () => {
  const table: IndoorViewTable = hasData ? JSON.parse(readFileSync(TABLE_PATH, 'utf8')) : ({} as IndoorViewTable);
  const fixture: Fixture = hasData ? JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) : { mazeWalls: {}, cases: [] };
  const cases = fixture.cases;

  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('matches the Python reference exactly on every fixture case', () => {
    let mismatches = 0;
    for (const c of cases) {
      const walls = fixture.mazeWalls[String(c.mazeId)]!;
      const getWall = (dx: number, dy: number, mask: number): number => {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return 1;
        return wallGraphicIndex(walls, x, y, MASK_TO_DIR[mask]!);
      };
      const got = buildWallList(table, getWall, c.facing, c.alt, c.torch);
      const gotStr = JSON.stringify(got);
      const wantStr = JSON.stringify(c.expected);
      if (gotStr !== wantStr) {
        mismatches++;
        if (mismatches <= 2) {
          console.error(`mismatch: maze ${c.mazeId} (${c.x},${c.y}) facing=${c.facing} alt=${c.alt} torch=${c.torch}`);
          console.error('  got: ', gotStr);
          console.error('  want:', wantStr);
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});
