/**
 * `tools/walker/mm3-outdoor-view.ts` — the TS port of
 * `scripts/mm3lib/dos_outdoor_view.py`'s `build_outdoor_draw_list`. Both are
 * pure reimplementations of the same frozen `mm3_outdoor_view.json` table
 * (Python and TS ship separate copies of the *algorithm* but read the *same*
 * committed table via `scripts/extract_mm3_dos_mazes.py`'s publish step —
 * see that table's `_meta` field for provenance).
 *
 * `mm3-outdoor-view-fixture.json` is a golden fixture: all 24 outdoor mazes
 * x 2 positions x 4 facings x 2 alt states (384 cases) run through the
 * Python reference (itself verified byte-identical to the `re-codebreaker`
 * escalation's own `outview.py` reference on 1,344 independent cases — see
 * `dos_outdoor_view.py`'s module doc) and their expected draw lists
 * recorded. This test re-runs the same cases through the TS port and checks
 * for an exact match.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOutdoorDrawList, type OutdoorViewTable } from '../mm3-outdoor-view.ts';

const TABLE_PATH = resolve(import.meta.dirname, '../../../scripts/mm3lib/mm3_outdoor_view.json');
const FIXTURE_PATH = resolve(import.meta.dirname, './mm3-outdoor-view-fixture.json');
const hasData = existsSync(TABLE_PATH) && existsSync(FIXTURE_PATH);

interface FixtureCase {
  mazeId: number;
  x: number;
  y: number;
  facing: number;
  alt: number;
  expected: Array<{ sprite: string; frame: number; x: number; y: number; flags: number }>;
}

interface Fixture {
  /** mazeId (string key) -> that maze's 256-entry wall array. */
  mazeWalls: Record<string, number[]>;
  /** mazeId (string key) -> that maze's 7-entry graphic-set id array. */
  mazeGraphicSets: Record<string, number[]>;
  cases: FixtureCase[];
}

describe('buildOutdoorDrawList vs. the verified Python reference (golden fixture)', { skip: !hasData }, () => {
  const table: OutdoorViewTable = hasData ? JSON.parse(readFileSync(TABLE_PATH, 'utf8')) : ({} as OutdoorViewTable);
  const fixture: Fixture = hasData
    ? JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
    : { mazeWalls: {}, mazeGraphicSets: {}, cases: [] };
  const cases = fixture.cases;

  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('matches the Python reference exactly on every fixture case', () => {
    let mismatches = 0;
    for (const c of cases) {
      const walls = fixture.mazeWalls[String(c.mazeId)]!;
      const graphicSets = fixture.mazeGraphicSets[String(c.mazeId)]!;
      const getWallWord = (dx: number, dy: number): number => {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || x >= 16 || y < 0 || y >= 16) return 0;
        return walls[y * 16 + x]!;
      };
      const got = buildOutdoorDrawList(table, getWallWord, graphicSets, c.facing, c.alt);
      const gotStr = JSON.stringify(got);
      const wantStr = JSON.stringify(c.expected);
      if (gotStr !== wantStr) {
        mismatches++;
        if (mismatches <= 2) {
          console.error(`mismatch: maze ${c.mazeId} (${c.x},${c.y}) facing=${c.facing} alt=${c.alt}`);
          console.error('  got: ', gotStr);
          console.error('  want:', wantStr);
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});
