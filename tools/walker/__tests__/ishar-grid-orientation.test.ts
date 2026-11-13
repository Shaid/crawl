/**
 * Regression checks for the 2026-11-13 Ishar grid-orientation fixes
 * (`docs/ishar-container-format.md` § "2026-11-13 follow-up"):
 *  - `tabchar()` indexing (row = pop, column = D7) + the `opile` operand
 *    swap in `alis-interp.ts`: every facing of every shipped Ishar 1/2/3
 *    location script scans a SYMMETRIC wedge (mean lateral offset exactly 0)
 *    in the expected geographic direction (N = -column, E = +row, ...).
 *  - Ishar 3 `FORET.bin` at storage row 70 / column 20 places sprites
 *    (it placed 0 under the old transposed read).
 * Needs the gitignored pipeline output (`public/assets/ishar*`); skipped
 * when it has not been generated.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scriptEntryPoint } from '../../shared/alis-disasm.ts';
import { runIsharScene, type SceneEnv } from '../../shared/alis-interp.ts';
import { ISHAR1_GLOBALS } from '../../shared/ishar-firstperson.ts';
import { ISHAR2_GLOBALS } from '../../shared/ishar2-firstperson.ts';
import { ISHAR3_FACING_RAW, ISHAR3_GLOBALS, renderIshar3LocationFrame } from '../../shared/ishar3-firstperson.ts';

const ASSETS = 'public/assets';
const have = (p: string) => existsSync(`${ASSETS}/${p}`);

interface Title {
  game: string;
  scripts: string[];
  row: number;
  col: number;
  partyRow: number;
  partyCol: number;
  partyFacing: number;
  /** raw facing value per walker N/E/S/W */
  raw: readonly number[];
}

const TITLES: Title[] = [
  { game: 'ishar', scripts: ['foret', 'village', 'plaine', 'rampart', 'temple'], row: 27, col: 45, ...pick(ISHAR1_GLOBALS), raw: [1, 2, 3, 4] },
  { game: 'ishar2', scripts: ['foret1', 'ville'], row: 45, col: 30, ...pick(ISHAR2_GLOBALS), raw: [1, 2, 3, 4] },
  { game: 'ishar3', scripts: ['foret', 'jungle'], row: 41, col: 28, ...pick(ISHAR3_GLOBALS), raw: ISHAR3_FACING_RAW },
];

function pick(g: { partyRow: number; partyCol: number; partyFacing: number }) {
  return { partyRow: g.partyRow, partyCol: g.partyCol, partyFacing: g.partyFacing };
}

// walker N/E/S/W as (dRow, dCol) in the transposed (geographic) frame
const AHEAD: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

describe('Ishar grid orientation (tabchar row=pop, col=D7)', () => {
  for (const t of TITLES) {
    for (const s of t.scripts) {
      const path = `${t.game}/amigaaga/scripts/${s}.bin`;
      it.skipIf(!have(path))(`${t.game}/${s}: each facing scans a symmetric wedge straight ahead`, () => {
        const data = new Uint8Array(readFileSync(`${ASSETS}/${path}`));
        for (let f = 0; f < 4; f++) {
          const reads: Array<[number, number]> = [];
          const globals: Record<number, number> = { [t.partyRow]: t.row, [t.partyCol]: t.col, [t.partyFacing]: t.raw[f]! };
          const env: SceneEnv = {
            readMain: (a) => globals[a] ?? 0,
            readGrid: (_a, pop, direct) => {
              reads.push([pop() - t.row, direct - t.col]);
              return 0;
            },
          };
          runIsharScene(data, scriptEntryPoint(data), env);
          expect(reads.length).toBeGreaterThan(20);
          const [aR, aC] = AHEAD[f]!;
          const ahead = reads.reduce((acc, [r, c]) => acc + r * aR + c * aC, 0) / reads.length;
          const lateral = reads.reduce((acc, [r, c]) => acc + r * aC - c * aR, 0) / reads.length;
          expect(ahead).toBeGreaterThan(2);
          expect(Math.abs(lateral)).toBeLessThan(1e-9);
          // never more than 7 cells to either side (the old operand-order bug let one bound run to the region edge)
          for (const [r, c] of reads) expect(Math.abs(r * aC - c * aR)).toBeLessThanOrEqual(7);
        }
      });
    }
  }

  const i3 = 'ishar3/amigaaga/scripts/foret.bin';
  it.skipIf(!have(i3) || !have('ishar3/amigaaga/data/regions.json'))('ishar3 FORET at row 70 / col 20 places sprites', () => {
    const regions = JSON.parse(readFileSync(`${ASSETS}/ishar3/amigaaga/data/regions.json`, 'utf8')) as {
      width: number;
      height: number;
      regions: Array<{ name: string; layers: number[][] }>;
    };
    const terrain = regions.regions.find((r) => r.name.startsWith('CONT4'))!.layers[0]!;
    const grid = {
      width: regions.width,
      height: regions.height,
      read(_b: 'A' | 'B', col: number, row: number) {
        const v = terrain[row * regions.width + col]!;
        return v >= 128 ? v - 256 : v;
      },
    };
    const location = new Uint8Array(readFileSync(`${ASSETS}/${i3}`));
    let total = 0;
    for (const facing of [0, 1, 2, 3] as const) total += renderIshar3LocationFrame({ location, partyX: 70, partyY: 20, facing, grid }).placementCount;
    expect(total).toBeGreaterThan(100);
  });
});
