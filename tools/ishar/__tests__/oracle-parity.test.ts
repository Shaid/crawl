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
import { bootToSavestate, captureLegWalk, captureTrip, captureWalk, capturePoses, ORACLE_TITLES, oracleAvailable, prepareGameDir, savestatePath, tempDir, type OracleGame, type OraclePose } from '../oracle/alis-oracle.ts';
import { ISHAR2_TRAVEL } from '../../shared/ishar-scene.ts';
import { bootGridB, comparePose, contLayers, crawlSequence, crawlWalk, loadTitleData, oracleRunGrids, oracleRunMemory } from '../oracle/compare.ts';

/**
 * Titles whose pose sample counts the NPCs and monsters (crawl runs the
 * game's entity scripts on the run's own EN1 memory). Ishar 2 and 3 jitter
 * some of them with the engine's shared random generator (`ornd`), which
 * crawl cannot reproduce, so their samples leave the entities out.
 */
const NPC_POSES: Record<'ishar' | 'ishar2' | 'ishar3', boolean> = { ishar: true, ishar2: false, ishar3: false };

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
        const seq = crawlSequence(data, ORACLE_TITLES[game].start, poses, oracleRunGrids(game, data, out), [], NPC_POSES[game] ? oracleRunMemory(game, out) : false);
        const rows = seq.map((c, i) => {
          const r = comparePose(game, frames[i]!, data, c.scripts, c.canvas, c.leaves, NPC_POSES[game]);
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
      const walk = crawlWalk(data, { ...ORACLE_TITLES.ishar2.start }, steps, contLayers('ishar2', data), {}, 0, undefined, false);
      const seen = new Set(walk.flatMap((w) => w.scripts));
      expect(seen.has('VILLAGE1') && seen.has('BOAT')).toBe(true);
      walk.forEach((w, i) => {
        const r = comparePose('ishar2', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, matched: r.matched, crawl: r.crawl, masked: r.pixelsMasked - r.pixelsMaskedEqual }).toEqual({ i, matched: r.oracle, crawl: r.oracle, masked: 0 });
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});

/**
 * Ishar 2's other islands. Each trip is driven the way MAP (the travel map)
 * does it: MAIN message 14 with the selector (harness `send`), from the
 * new-game state; MAIN's arrival table moves the party and loads the
 * island. Then a walk in 5-action legs, each poking the party's hp up
 * (`0x2d5c`: GERDEP takes cold damage on Jon's Island and the dungeon
 * monsters attack). Roaming monsters are removed; the step test reads the
 * monsters left in EN1 and the door flags (`ishar2Enter`).
 */
const ISHAR2_TRIPS: ReadonlyArray<{ selector: number; walk: string; groups: string[] }> = [
  { selector: 6, walk: 'FFFFFFFFFFFFFLLFLLLLFLLL', groups: ['FARBO', 'ARBO'] },
  { selector: 2, walk: 'FLFFFFFFLFLLLFFFLFLLFLLL', groups: ['FMONT', 'MONTAGNE'] },
  { selector: 7, walk: 'FFFFFFFFLFFFFLFFFLFFFLLL', groups: ['FDJCAT', 'FDJ1'] },
  { selector: 8, walk: 'FFFFFFFFLFFFLFFLLFLLFLLL', groups: ['FDJ1'] },
];

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar2.dataDir, 'MAIN.DO')))('ishar2 island trips vs the game (alis oracle)', () => {
  it.each(ISHAR2_TRIPS)('selector $selector: arrives where MAIN says, moves like the game and matches the view', ({ selector, walk, groups }) => {
    const out = tempDir('ishar2-trip-test-');
    try {
      prepareGameDir('ishar2');
      if (!existsSync(savestatePath('ishar2'))) bootToSavestate('ishar2', join(out, 'boot'));
      const state = join(out, 'trip.state');
      const at = captureTrip('ishar2', [14, selector], state);
      const d = ISHAR2_TRAVEL.find((t) => t.selector === selector)!;
      expect(at).toEqual({ region: d.region, row: d.row, col: d.col, facingRaw: d.facingRaw });
      const actions = [...walk] as Array<'F' | 'L' | 'R'>;
      const steps = captureLegWalk('ishar2', (_c, done) => (done.length >= actions.length ? null : actions.slice(done.length, done.length + 5)), join(out, 'walk'), {
        noNpcs: true, startState: state, start: at, legCommands: ['pokew 2d5c 500'],
      });
      expect(steps.length).toBe(actions.length);
      const data = loadTitleData('ishar2');
      const spec = data.spec;
      const start = { region: at.region, row: at.row, col: at.col, facing: spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar2', data), {}, 0, d.zone, false);
      expect(groups.every((g) => cw.some((w) => w.scripts.includes(g)))).toBe(true);
      let px = 0, pxEq = 0;
      cw.forEach((w, i) => {
        const r = comparePose('ishar2', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, matched: r.oracle, crawl: r.oracle });
        px += r.pixelsMasked;
        pxEq += r.pixelsMaskedEqual;
      });
      expect(pxEq / px).toBeGreaterThan(0.9995);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 3's jungle and mountains. The trip is GERDEP's gate message (MAIN
 * message 38) sent from the new-game state with the location poked: Maz
 * location 8 leads to the jungle (region 3, CONT3-3), location 6 to the
 * mountains (region 9, CONT6-3). One leg each (every savestate load moves
 * Ishar 3's clock on by hours). The walks avoid the gate cells.
 */
const ISHAR3_TRIPS: ReadonlyArray<{ location: number; walk: string; group: string[] }> = [
  { location: 8, walk: 'FFLFLFLLLLLFFLFLLFFFFLLL', group: ['FJUNGLE', 'JUNGLE'] },
  { location: 6, walk: 'FLFLFFLLLLLLLLLLLLLLFLLL', group: ['FMONT', 'MONTAGNE'] },
];

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 jungle and mountains vs the game (alis oracle)', () => {
  it.each(ISHAR3_TRIPS)('location $location: moves like the game and matches the view', ({ location, walk, group }) => {
    const out = tempDir('ishar3-trip-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const state = join(out, 'trip.state');
      const at = captureTrip('ishar3', [38], state, 600, { commands: [`poke 3b33 ${location}`] });
      const actions = [...walk] as Array<'F' | 'L' | 'R'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: state, start: at, maxLegs: 1 });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 0, steps[0]?.mem?.zone?.[0], false);
      expect(cw.some((w) => group.every((g) => w.scripts.includes(g)))).toBe(true);
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, matched: r.matched, crawl: r.crawl, masked: r.pixelsMasked - r.pixelsMaskedEqual }).toEqual({ i, move: true, matched: r.oracle, crawl: r.oracle, masked: 0 });
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 3: Maz from the start, south through the streets while the day
 * turns to dusk and night. MAIN derives the phase from the game clock's
 * hour (`0x3c08`; MAIN `+0x4dac`: 8..19 is day) and passes the phase's
 * factors to `cdarkpal` (`ISHAR3_TITLE.darken`). The clock runs too slowly
 * to change phase in a short walk, so the walk sets the hour twice (20 =
 * dusk, 23 = night); nothing else is poked. Townspeople and thieves are
 * removed (`noNpcs`); the walk measures scenery and the day/night palette.
 */
const ISHAR3_WALK = 'RFRFLFRFLFFFFFFLFFRFFFLFFFFRFFFRFFFFLFFFFFFFRFFFLFFRFFLFFF';

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 real walk vs the game (alis oracle)', () => {
  it('moves like the game and matches every placement and pixel through dusk into night', () => {
    const out = tempDir('ishar3-walk-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const steps = captureWalk('ishar3', [...ISHAR3_WALK] as Array<'F' | 'L' | 'R'>, out, { noNpcs: true, commands: [[20, 'pokew 3c08 20'], [40, 'pokew 3c08 23']] });
      const data = loadTitleData('ishar3');
      const walk = crawlWalk(data, { ...ORACLE_TITLES.ishar3.start }, steps, contLayers('ishar3', data), {}, 0, undefined, false);
      // the walk reaches dusk and night (blue factor 256 -> 152 -> 192)
      const factors = new Set(walk.map((w) => w.actual.globals?.[0x3f86] ?? 256));
      expect([...factors].sort()).toEqual([152, 192, 256]);
      expect(walk.every((w) => w.moveAgrees)).toBe(true);
      walk.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, matched: r.matched, crawl: r.crawl }).toEqual({ i, matched: r.oracle, crawl: r.oracle });
        expect(r.pixelsMaskedEqual / r.pixelsMasked, `step ${i} pixels`).toBeGreaterThan(0.995);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});

/**
 * Ishar 3: Maz with its townspeople, the first 30 actions of the walk above
 * with nothing removed or poked. AFFPV places them from the 150-person table
 * (`0x4012..`, dumped each step) through VPERSO1..5. Their x adds the
 * engine's shared random number (`ornd`), so they are matched up to 12 px
 * in x (`matchedNearX`); scenery and depth, height, slot and mirror must agree.
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 townspeople vs the game (alis oracle)', () => {
  it('draws the townspeople where the game does', () => {
    const out = tempDir('ishar3-npc-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const steps = captureWalk('ishar3', [...ISHAR3_WALK.slice(0, 30)] as Array<'F' | 'L' | 'R'>, out);
      const data = loadTitleData('ishar3');
      const walk = crawlWalk(data, { ...ORACLE_TITLES.ishar3.start }, steps, contLayers('ishar3', data));
      let oracle = 0, near = 0, people = 0;
      walk.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves);
        expect({ i, crawl: r.crawl }).toEqual({ i, crawl: r.oracle });
        oracle += r.oracle;
        near += r.matchedNearX;
        people += w.leaves.filter((l) => l.script.startsWith('VPERSO')).length;
      });
      expect(people).toBeGreaterThan(40);
      expect(near / oracle).toBeGreaterThan(0.995);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
