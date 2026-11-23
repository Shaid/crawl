/**
 * Crystals of Arborea's 3D view vs the game, with the alis oracle
 * (`tools/ishar/oracle/`). The boot defines a team of six warriors and
 * presses "3D" (`crystalsBoot`); the walks then click the game's own arrow
 * pad.
 *
 * The walks remove the enemy bands' scripts (EBRAIN, EMOVE, ORC_ELF,
 * MORGOT, SHAMNIR: `noNpcs`) and poke the band count `0x2d3f` to 0, so no
 * band meets the party and stops the walk with a fight. That changes the
 * game, so these walks measure scenery and movement only.
 *
 * Skips (does not fail) when the oracle is not built or the retail data is
 * missing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bootToSavestate, captureLegWalk, captureWalk, ORACLE_TITLES, oracleAvailable, prepareGameDir, savestatePath, tempDir, type WalkAction } from '../oracle/alis-oracle.ts';
import { comparePose, contLayers, crawlWalk, loadTitleData } from '../oracle/compare.ts';
import { planRoute } from '../oracle/route.ts';
import { crystalsNewGameGrid } from '../../shared/ishar-scene.ts';

const haveData = existsSync(join(ORACLE_TITLES.crystals.dataDir, 'MAIN.CO'));

/**
 * A seeded random walk from the new-game start (30, 45): forests, plains
 * and a wizard's house two cells ahead at (22, 42), which swaps PLAGES for
 * GHABITAT. It stops before the house's door (HABITAT then opens the house).
 * The hour runs from 1 into the night (NAD's palette slots).
 */
const OUTDOOR_WALK =
  'FFFRFFLFFLFLFFFFFFFFLFFLFFRRLFLLFFFFLFFFFLFLFLRFFLLRFFFLRFLFLFFRLFFFLFFFFFRFFLFLFFRFFLFFLFFFFFFFRFLLFFRFLFLFFFFFRRFFRRFRLRFFRFRFFFFFLFFFFF';

function ready(out: string): void {
  prepareGameDir('crystals');
  if (!existsSync(savestatePath('crystals'))) bootToSavestate('crystals', join(out, 'boot'));
}

describe.skipIf(!oracleAvailable() || !haveData)('crystals outdoor walk vs the game (alis oracle)', () => {
  it('moves like the game and matches every placement and pixel, through the hours and a house swap', () => {
    const out = tempDir('crystals-walk-test-');
    try {
      ready(out);
      const steps = captureWalk('crystals', [...OUTDOOR_WALK] as WalkAction[], out, { noNpcs: true, commands: [[0, 'poke 2d3f 0']] });
      const data = loadTitleData('crystals');
      // the boot state's scene has been woken once (the "3D" press)
      const walk = crawlWalk(data, { ...ORACLE_TITLES.crystals.start }, steps, contLayers('crystals', data), {}, 1, undefined, false);
      // the hour turns several times (NAD's palette slot follows it)
      expect(new Set(steps.map((s) => s.globals[0x2e97])).size).toBeGreaterThan(3);
      expect(walk.some((w) => w.scripts.includes('GHABITAT'))).toBe(true);
      expect(walk.every((w) => w.moveAgrees)).toBe(true);
      let px = 0;
      let bad = 0;
      walk.forEach((w, i) => {
        const r = comparePose('crystals', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, matched: r.matched, crawl: r.crawl }).toEqual({ i, matched: r.oracle, crawl: r.oracle });
        px += r.pixelsMasked;
        bad += r.pixelsMasked - r.pixelsMaskedEqual;
      });
      // every pixel (2026-11-23: the old 0.01% residual was element numbers above 127, which the engine sorts as signed bytes)
      expect(px).toBeGreaterThan(0);
      expect(bad).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.skipIf(!oracleAvailable() || !haveData)('crystals cave vs the game (alis oracle)', () => {
  it('enters the (32, 9) cave mouth and walks the cave layer like the game', () => {
    const out = tempDir('crystals-cave-test-');
    try {
      ready(out);
      const data = loadTitleData('crystals');
      const spec = data.spec;
      const layers = contLayers('crystals', data);
      const grid = crystalsNewGameGrid(new Uint8Array(readFileSync(join(ORACLE_TITLES.crystals.dataDir, 'INIT.FIC'))));
      const cell = (x: number, y: number) => (x < 0 || y < 0 || x > 94 || y > 56 ? 0 : ((grid[114 * x + 2 * y]! ^ 128) - 128));
      // keep clear of the wizards' houses: a step next to one opens it
      const nearHouse = (_r: number, x: number, y: number) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => cell(x + dx, y + dy) >= 60 && cell(x + dx, y + dy) <= 65));
      const t = ORACLE_TITLES.crystals;
      const inside: WalkAction[] = [...'FLFFLLFFRFFRRFFFFLFFRRFFLFLFFFRFFLLF'] as WalkAction[];
      let leg = 0;
      const steps = captureLegWalk(
        'crystals',
        (cur) => {
          leg++;
          if (leg === 1) {
            const from = { region: cur.region, row: cur.row, col: cur.col, facing: t.start.facing };
            return planRoute(spec, layers, from, (s) => s.row === 32 && s.col === 9, new Set(), 400_000, undefined, nearHouse)!.actions;
          }
          return leg === 2 ? inside : null;
        },
        out,
        { noNpcs: true, legCommands: ['poke 2d3f 0'] },
      );
      const walk = crawlWalk(data, { ...t.start }, steps, layers, {}, 1, undefined, false);
      expect(steps.at(-1)!.region).toBe(1);
      expect(walk.every((w) => w.moveAgrees)).toBe(true);
      let px = 0;
      let bad = 0;
      walk.forEach((w, i) => {
        const r = comparePose('crystals', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, matched: r.matched, crawl: r.crawl }).toEqual({ i, matched: r.oracle, crawl: r.oracle });
        px += r.pixelsMasked;
        bad += r.pixelsMasked - r.pixelsMaskedEqual;
      });
      expect(bad / px).toBeLessThan(0.0002);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
