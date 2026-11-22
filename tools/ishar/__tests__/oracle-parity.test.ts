/**
 * Ishar scene vs the game, on a fixed pose sample, using the alis engine
 * reimplementation (MIT, `maestun/alis`) plus crawl's harness patch as the
 * oracle (`tools/ishar/oracle/`). The broad sweep is
 * `tools/ishar/oracle/sweep.ts`; this is its regression subset.
 *
 * The real walk plays the game's own arrow buttons from the start of a new
 * game, through both CONT1 zones and across the row-53/0 boundary into
 * CONT2 (region change: grid buffers, scene group swap), nothing poked.
 *
 * Skips (does not fail) when the oracle is not built
 * (`bash tools/ishar/oracle/build.sh`) or the retail data is missing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bootToSavestate, captureWalk, capturePoses, ORACLE_TITLES, oracleAvailable, prepareGameDir, savestatePath, tempDir, type OracleGame, type OraclePose } from '../oracle/alis-oracle.ts';
import { bootGridB, comparePose, contLayers, crawlSequence, crawlWalk, loadTitleData, oracleRunGrids } from '../oracle/compare.ts';

const SAMPLES: Record<'ishar' | 'ishar2' | 'ishar3', OraclePose[]> = {
  // CONT1: the start pose, both zone add-ons (lacustre west of col 46,
  // village east of it), a crossing back, and the row-53 edge.
  ishar: [
    { row: 11, col: 29, facing: 0 },
    { row: 18, col: 21, facing: 0 },
    { row: 20, col: 48, facing: 1 },
    { row: 8, col: 62, facing: 0 },
    { row: 15, col: 55, facing: 1 },
    { row: 37, col: 12, facing: 2 },
    { row: 53, col: 34, facing: 3 },
    { row: 32, col: 71, facing: 2 },
  ],
  ishar2: [
    { row: 27, col: 45, facing: 1 },
    { row: 22, col: 44, facing: 3 },
    { row: 39, col: 37, facing: 1 },
    { row: 40, col: 32, facing: 2 },
    { row: 18, col: 55, facing: 2 },
    { row: 44, col: 34, facing: 0 },
  ],
  // Maz (CONT1-3), the Ishar 3 start town; runs under the virtual clock.
  ishar3: [
    { row: 2, col: 50, facing: 0 },
    { row: 7, col: 45, facing: 1 },
    { row: 13, col: 48, facing: 2 },
    { row: 16, col: 48, facing: 3 },
    { row: 10, col: 50, facing: 0 },
    { row: 4, col: 44, facing: 2 },
  ],
};

for (const game of Object.keys(SAMPLES) as Array<'ishar' | 'ishar2' | 'ishar3'>) {
  const haveData = existsSync(join(ORACLE_TITLES[game].dataDir, 'MAIN.DO'));
  describe.skipIf(!oracleAvailable() || !haveData)(`${game} scene vs the game (alis oracle)`, () => {
    it('matches every placement and every pixel of the view', () => {
      const poses = SAMPLES[game];
      const out = tempDir(`${game}-test-`);
      try {
        prepareGameDir(game as OracleGame);
        if (!existsSync(savestatePath(game))) bootToSavestate(game, join(out, 'boot'));
        const frames = capturePoses(game, poses, out);
        expect(frames.map((f) => f.taken)).toEqual(poses.map(() => true));
        const data = loadTitleData(game);
        const seq = crawlSequence(data, ORACLE_TITLES[game].start, poses, oracleRunGrids(game, data, out));
        const rows = seq.map((c, i) => {
          const r = comparePose(game, frames[i]!, data, c.scripts, c.canvas, c.leaves);
          return { i, oracle: r.oracle, matched: r.matched, crawl: r.crawl, masked: r.pixelsMasked - r.pixelsMaskedEqual, missing: r.missing.slice(0, 3), extra: r.extra.slice(0, 3) };
        });
        for (const r of rows) {
          expect(r, `pose ${r.i}`).toMatchObject({ matched: r.oracle, crawl: r.oracle, masked: 0 });
          expect(r.oracle, `pose ${r.i} drew nothing`).toBeGreaterThan(0);
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    }, 120_000);
  });
}

/** Ishar 1: start -> east into the village zone -> south across into CONT2 (route planned on the grids; step 4 repeats a press the game drops: GEREN has started MESSAGEE.DO as the party nears Bormin, an NPC at CONT1 15,29, and the message swallows it). */
const ISHAR1_WALK = 'FFFFFFFFFFFFFFFRFFFFFFFFFFFFFFFFFFFFFFFFFFRFFFFFRFFFFFFFFFFFFFFFRFFFLFRFLFFFRFFFFFFFFFFFFFFFFFFFFFFLFRFLFRFFFFFFFLFRFLFRFLFFRFFFF';

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar.dataDir, 'MAIN.DO')))('ishar real walk vs the game (alis oracle)', () => {
  it('moves like the game and matches every placement and pixel, across a region change', () => {
    const out = tempDir('ishar-walk-test-');
    try {
      prepareGameDir('ishar');
      if (!existsSync(savestatePath('ishar'))) bootToSavestate('ishar', join(out, 'boot'));
      const steps = captureWalk('ishar', [...ISHAR1_WALK] as Array<'F' | 'L' | 'R'>, out);
      const data = loadTitleData('ishar');
      const t = ORACLE_TITLES.ishar;
      const walk = crawlWalk(data, { ...t.start }, steps, contLayers('ishar', data), { B: bootGridB(data, out) });
      expect(steps.at(-1)).toMatchObject({ region: 2 });
      // the one dropped press is the Bormin message (not modelled); monsters
      // on cells are (GERDEP +0x1584, from the per-step monster-table dumps)
      expect(walk.filter((w) => !w.moveAgrees).length).toBeLessThanOrEqual(1);
      let px = 0;
      let bad = 0;
      walk.forEach((w, i) => {
        const r = comparePose('ishar', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves);
        expect({ i, matched: r.matched, crawl: r.crawl }).toEqual({ i, matched: r.oracle, crawl: r.oracle });
        px += r.pixelsMasked;
        bad += r.pixelsMasked - r.pixelsMaskedEqual;
      });
      // Known residual: after the region change two equal-depth sprites
      // (an RPLAINE vs an FBUIS sprite, same y and element) overlap in the opposite
      // order on 2 frames, 5 pixels each. The game's tie order follows the
      // entity slot each script was given (slots freed by the killed group
      // are reused), which crawl approximates by creation order.
      expect(bad).toBeLessThanOrEqual(10);
      expect(px).toBeGreaterThan(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});

/**
 * Ishar 2: from the start (zone 4) north into the village (zone 1), then
 * east to the lake shore (zone 3, the boat), nothing poked. Roaming NPCs
 * (bears, lizards ...) are removed in the oracle (`noNpcs`) so they cannot
 * block the route or start a fight; the walk measures scenery and zones.
 * The game refuses some steps here (shore/water cells): the walkability
 * rule is not ported yet, so moves are not asserted, only the views.
 */
const ISHAR2_WALK = 'LFFFFFLFFFFFFFLFFFFRFLFFFFRFFFFRFFFFRFFFFFFFFFFFFRFFFFFRRFFFRFFFFFFFFFFFFFFFFFFFFFFFLFFFFFFFFFFFFFFFFFFFFFFFFFFRFFFFFFFFFFFFFFFF';

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar2.dataDir, 'MAIN.DO')))('ishar2 real walk vs the game (alis oracle)', () => {
  it('follows the game zones (village, boat) and matches every placement and pixel', () => {
    const out = tempDir('ishar2-walk-test-');
    try {
      prepareGameDir('ishar2');
      if (!existsSync(savestatePath('ishar2'))) bootToSavestate('ishar2', join(out, 'boot'));
      const steps = captureWalk('ishar2', [...ISHAR2_WALK] as Array<'F' | 'L' | 'R'>, out, { noNpcs: true });
      const data = loadTitleData('ishar2');
      const walk = crawlWalk(data, { ...ORACLE_TITLES.ishar2.start }, steps, contLayers('ishar2', data));
      const seen = new Set(walk.flatMap((w) => w.scripts));
      expect(seen.has('VILLAGE1') && seen.has('BOAT')).toBe(true);
      walk.forEach((w, i) => {
        const r = comparePose('ishar2', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves);
        expect({ i, matched: r.matched, crawl: r.crawl, masked: r.pixelsMasked - r.pixelsMaskedEqual }).toEqual({ i, matched: r.oracle, crawl: r.oracle, masked: 0 });
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
