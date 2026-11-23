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
 * Ishar 1's CONT5 cave, doors and levers worked the way the game works
 * them (2026-11-25). Needs the savestate with the cave mouth's manual
 * prompt answered (`manual.ts` `answerManualPrompt`, kept as
 * `build/cache/ishar-oracle/states/cave-answered.state`: region 15 at
 * (13,24)). The party is poked to its starting cell once; the rest is the
 * game's own buttons and view clicks:
 * - the lever puzzle (levers 14..19 swap the gates 24..35): `U` clicks the
 *   view centre with an empty hand, SOURIS sends PCAVE message 20; five
 *   gate refusals follow the pulled levers;
 * - door 11 at (16,24): refused shut, then opened by clicking its lock
 *   plate with key kind 12 in the hand (`pokew 1506 12`, the item kind
 *   SOURIS compares with the door form's material), then walked through.
 */
const CAVE_STATE = 'build/cache/ishar-oracle/states/cave-answered.state';
const ISHAR1_CAVE_WALKS = [
  { name: 'lever puzzle', at: [33, 13], walk: 'FFRURFFLLFFFLFFULFFRULFFRRFFFFFULULFFLLFRFFLFFRULFLFF', key: null },
  { name: 'door 11 with its key', at: [13, 24], walk: 'FFFFUFFFRFLL', key: 12 },
] as const;

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar.dataDir, 'MAIN.DO')) || !existsSync(CAVE_STATE))('ishar cave doors and levers vs the game (alis oracle)', () => {
  it.each(ISHAR1_CAVE_WALKS)('$name: moves, door tables and view like the game', ({ at, walk, key }) => {
    const out = tempDir('ishar-cave-test-');
    try {
      prepareGameDir('ishar');
      const state = join(out, 'start.state');
      // poke the cell, raw facing 1, then turn right (raw 2) so the game redraws there
      const pre = captureLegWalk('ishar', (_c, done) => (done.length ? null : ['R']), join(out, 'pre'), {
        maxLegs: 1, noNpcs: true, startState: CAVE_STATE, start: { region: 15, row: 13, col: 24, facingRaw: 2 },
        legCommands: [`poke 137c ${at[0]}`, `poke 137d ${at[1]}`, 'poke 137e 1', 'pokew 1542 500'], finalState: state,
      });
      const p = pre.at(-1)!;
      const start = { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
      expect(start).toEqual({ region: 15, row: at[0], col: at[1], facingRaw: 2 });
      const steps = captureLegWalk('ishar', (_c, done) => (done.length ? null : ([...walk] as Array<'F' | 'L' | 'R' | 'U'>)), join(out, 'walk'), {
        maxLegs: 1, noNpcs: true, startState: state, start, legCommands: ['pokew 1542 500'],
        ...(key !== null ? { use: [184, 65] as const, useCommands: ['pokew 1742 -1', `pokew 1506 ${key}`] } : {}),
      });
      const data = loadTitleData('ishar');
      const cw = crawlWalk(data, { region: 15, row: at[0], col: at[1], facing: data.spec.facingRaw.indexOf(2) as 0 | 1 | 2 | 3 }, steps, contLayers('ishar', data), {}, 1, p.mem?.zone?.[0], false);
      let bad = 0;
      cw.forEach((w, i) => {
        const r = comparePose('ishar', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, tables: w.tablesAgree ?? true, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, tables: true, matched: r.oracle, crawl: r.oracle });
        bad += r.pixelsMasked - r.pixelsMaskedEqual;
      });
      // one frame of the lever walk differs by 14 pixels (step 23, (33,11) facing north: a small
      // object on the floor ahead and two dark edge pixels; not traced)
      expect(bad).toBeLessThanOrEqual(20);
      if (key !== null) expect(steps.at(-1)!.mem!.doorOpen![11]).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
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
  // Zach's town (2026-11-23): the VHOUSE2 height residual of 2026-11-23 no longer reproduces
  { selector: -2, walk: 'FFFFFFLFFLFFRFFFLLFF', groups: ['FVILLE', 'VHOUSE2'] },
  { selector: 5, walk: 'FFFFFFFFLFFFFLFFFLFFFLLL', groups: ['FVILLE', 'VHOUSE2'] },
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
      // The same walk on crawl's own new-game table (PARAM's INITPV.FIC read, `entities.files`)
      // instead of the oracle's dumps: what the standalone walker draws.
      const own = steps.map((s) => ({ ...s, mem: Object.fromEntries(Object.entries(s.mem ?? {}).filter(([k]) => k !== 'ent4012' && k !== 'ent3b60')) }));
      let ownNear = 0, ownPeople = 0;
      crawlWalk(data, { ...ORACLE_TITLES.ishar3.start }, own, contLayers('ishar3', data)).forEach((w, i) => {
        ownNear += comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves).matchedNearX;
        ownPeople += w.leaves.filter((l) => l.script.startsWith('VPERSO')).length;
      });
      expect([ownNear, ownPeople]).toEqual([near, people]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});

/**
 * Ishar 3: Maz's districts. MAIN swaps the location add-ons
 * (`ishar3LocationAddOns`) whenever GERDEP `+0x1d36` changes the location
 * `0x3b33`. A guard blocks the street west of (39,33) at a new game, so the
 * walk starts with the party poked to (40,31) and walks through locations
 * 5, 7, 8, 12 and 11 (vbank, vrampart, vhouse3, varcade, vtheatre, vpalais,
 * vobs, varche2); townspeople and thieves removed.
 */
const ISHAR3_DISTRICTS = 'FRFRFFFFFLFFFRFFRFLFRFFLFFLLFFRFFLFRFLFFLFRFFFFFFLFRFFLFFRFFFFFLFFRFFFLFFFRFFFFFRFFFRFFFLFLLFRFFFRFFFFFFFFFLFRFLLFLFFFLF';

describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 Maz districts vs the game (alis oracle)', () => {
  it('swaps the location add-ons like the game and matches the view', () => {
    const out = tempDir('ishar3-districts-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const state = join(out, 'poked.state');
      const pre = captureLegWalk('ishar3', (_c, done) => (done.length ? null : ['L', 'R']), join(out, 'pre'), { noNpcs: true, maxLegs: 1, legCommands: ['poke 257 40', 'poke 14b6 31'], finalState: state });
      const p = pre[pre.length - 1]!;
      const at = { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
      // two legs, each starting at noon (the clock would reach dusk, whose palette the game applies a step late)
      const actions = [...ISHAR3_DISTRICTS] as Array<'F' | 'L' | 'R'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length >= actions.length ? null : actions.slice(done.length, done.length + 60)), join(out, 'walk'), { noNpcs: true, startState: state, start: at, maxLegs: 2, legCommands: ['pokew 3c08 12'] });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 0, p.mem?.zone?.[0], false);
      const locations = new Set(steps.map((s) => s.mem?.zone?.[0]));
      expect([5, 7, 8, 12, 11].every((l) => locations.has(l))).toBe(true);
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, matched: r.oracle, crawl: r.oracle });
        expect(r.pixelsMaskedEqual / r.pixelsMasked, `step ${i} pixels`).toBeGreaterThan(0.999);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 3's dungeon lever (2026-11-25): trip to the dungeon (location 4),
 * poke the party onto the lever cell CONT5-3 (8,45) (code 47, layer 1 -23:
 * lever 13) facing raw 2, then `U` clicks the view with an empty hand.
 * SOURIS sends the lever's PCAVE entity message 20 and PCAVE `+0x32f`
 * toggles lever 13 and door 13 (`ishar3PullLever`); crawl predicts both
 * tables and redraws the lever. The walk then goes on through the dungeon.
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 dungeon lever vs the game (alis oracle)', () => {
  it('pulls the lever like the game and matches the view', () => {
    const out = tempDir('ishar3-lever-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const trip = join(out, 'trip.state');
      const at0 = captureTrip('ishar3', [38], trip, 600, { commands: ['poke 3b33 4'] });
      const state = join(out, 'poked.state');
      const pre = captureLegWalk('ishar3', (_c, done) => (done.length ? null : ['R']), join(out, 'pre'), { noNpcs: true, maxLegs: 1, startState: trip, start: at0, legCommands: ['poke 257 8', 'poke 14b6 45', 'poke 14b7 1', 'pokew 16e0 500'], finalState: state });
      const p = pre.at(-1)!;
      const at = { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
      expect(at).toEqual({ region: 7, row: 8, col: 45, facingRaw: 2 });
      const actions = [...'ULLFRFFFRFFLFF'] as Array<'F' | 'L' | 'R' | 'U'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: state, start: at, maxLegs: 1, legCommands: ['pokew 16e0 500'] });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 1, p.mem?.zone?.[0], false);
      expect(steps[0]!.mem!.levers![13]).toBe(1);
      expect(steps[0]!.mem!.doors![13]).toBe(1);
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, tables: w.tablesAgree ?? true, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, tables: true, matched: r.oracle, crawl: r.oracle });
        // the pull frame shows the mouse pointer at the click (54 px)
        expect(r.pixelsMasked - r.pixelsMaskedEqual, `step ${i} pixels`).toBeLessThanOrEqual(60);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 3's keyhole doors (2026-11-23): trip to the dungeon (location 4),
 * poke the party into CONT5-3 (28,47) facing raw -2, turn to face door 25
 * on the cell's col-1 edge, walk into it (refused), then `U` clicks its
 * keyhole (179, 87) with key -19 in the hand (`ishar3DoorKey`). SOURIS
 * sends the door's PCAVE message 19 and the hand empties; crawl predicts
 * the door table and redraws. The walk then goes through the door.
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 keyhole door vs the game (alis oracle)', () => {
  it('opens the door with its key like the game and matches the view', () => {
    const out = tempDir('ishar3-keydoor-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const trip = join(out, 'trip.state');
      const at0 = captureTrip('ishar3', [38], trip, 600, { commands: ['poke 3b33 4'] });
      const state = join(out, 'poked.state');
      const pre = captureLegWalk('ishar3', (_c, done) => (done.length ? null : ['R']), join(out, 'pre'), { noNpcs: true, maxLegs: 1, startState: trip, start: at0, legCommands: ['poke 257 28', 'poke 14b6 47', 'poke 14b7 254', 'pokew 16e0 500'], finalState: state });
      const p = pre.at(-1)!;
      const at = { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
      expect(at).toEqual({ region: 7, row: 28, col: 47, facingRaw: 1 });
      const actions = [...'FUFFLFRFFRRFF'] as Array<'F' | 'L' | 'R' | 'U'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: state, start: at, maxLegs: 1, legCommands: ['pokew 16e0 500'], use: [179, 87], useCommands: ['pokew 19c8 -1', 'pokew 168e -19'] });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 1, p.mem?.zone?.[0], false);
      expect(steps[0]!.mem!.doors![25]).toBe(0);
      expect(steps[1]!.mem!.doors![25]).toBe(1);
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        // The use frame: the game's door entity is still in the display list,
        // raised 96 px (3 rows left in the view), and the view behind it keeps
        // the rising leaf's trail until the next step redraws; crawl draws the
        // end state (no door sprite). Every later frame matches.
        const missing = steps[i]!.action === 'U' ? 1 : 0;
        expect({ i, move: w.moveAgrees, tables: w.tablesAgree ?? true, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, tables: true, matched: r.oracle - missing, crawl: r.oracle - missing });
        if (!missing) expect(r.pixelsMasked - r.pixelsMaskedEqual, `step ${i} pixels`).toBe(0);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 3's dungeon locations 26 and 27 through a door opened the real way
 * (2026-11-23): poked into the closed room behind keyhole door 39 at
 * CONT5-3 (37,52), the party walks onto the door's cell, clicks the keyhole
 * with key -21 and walks out to location 26 (DJ4/FDJ4 + DJDEC) and 27
 * (DJ1/FDJ1 + DJDEC2/DJDEC). Region 7's group also holds a DJDEC, so the
 * scene must kill location 26's own DJDEC on the way to 27, as MAIN
 * `+0x26bf` does (it kills by entity type, not by name).
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 dungeon locations 26-27 through a keyhole door vs the game (alis oracle)', () => {
  it('walks through door 39 like the game and matches the view', () => {
    const out = tempDir('ishar3-loc26-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const trip = join(out, 'trip.state');
      const at0 = captureTrip('ishar3', [38], trip, 600, { commands: ['poke 3b33 4'] });
      const state = join(out, 'poked.state');
      const pre = captureLegWalk('ishar3', (_c, done) => (done.length ? null : ['R']), join(out, 'pre'), { noNpcs: true, maxLegs: 1, startState: trip, start: at0, legCommands: ['poke 257 37', 'poke 14b6 52', 'poke 14b7 254', 'pokew 16e0 500'], finalState: state });
      const p = pre.at(-1)!;
      const at = { region: p.region, row: p.row, col: p.col, facingRaw: p.facingRaw };
      expect(at).toEqual({ region: 7, row: 37, col: 52, facingRaw: 1 });
      const actions = [...'FUFFRFFFFFLFFLFRFFRFFFFFLFFRFLFFFFLRLRRFFRF'] as Array<'F' | 'L' | 'R' | 'U'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: state, start: at, maxLegs: 1, legCommands: ['pokew 16e0 500'], use: [179, 87], useCommands: ['pokew 19c8 -1', 'pokew 168e -21'] });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 1, p.mem?.zone?.[0], false);
      expect(steps.length).toBe(actions.length);
      expect(steps[1]!.mem!.doors![39]).toBe(1);
      expect(new Set(steps.map((s) => s.mem!.zone![0]))).toEqual(new Set([21, 26, 27]));
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        // the use frame: the raised door entity and its trail, as in the keyhole test above
        const missing = steps[i]!.action === 'U' ? 1 : 0;
        expect({ i, move: w.moveAgrees, tables: w.tablesAgree ?? true, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, tables: true, matched: r.oracle - missing, crawl: r.oracle - missing });
        if (!missing) expect(r.pixelsMasked - r.pixelsMaskedEqual, `step ${i} pixels`).toBe(0);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Ishar 2's click door (2026-11-23): trip to the first dungeon (selector
 * 7), poke the party next to CONT5's zone-35 cell (44,24) so a step onto it
 * starts DJ2, walk to (50,23), click the leaf of door 9 with an empty hand
 * (`U` at the title's use point): PCAVE opens it, the party walks through,
 * and GERDEP `+0x13d5` shuts it after that move (`ISHAR2_CLICK_DOORS`).
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar2.dataDir, 'MAIN.DO')))('ishar2 click door vs the game (alis oracle)', () => {
  it('opens door 9 with a click like the game and matches the view', () => {
    const out = tempDir('ishar2-clickdoor-test-');
    try {
      prepareGameDir('ishar2');
      if (!existsSync(savestatePath('ishar2'))) bootToSavestate('ishar2', join(out, 'boot'));
      const trip = join(out, 'trip.state');
      const at = captureTrip('ishar2', [14, 7], trip);
      expect(at).toEqual({ region: 5, row: 10, col: 46, facingRaw: 2 });
      // the first F (from the poked (44,25)) steps onto the zone cell; then the route to the door, U, through, and back
      const actions = [...'FLLFFLFFFFFFLFFFUFFRRFFF'] as Array<'F' | 'L' | 'R' | 'U'>;
      const steps = captureLegWalk('ishar2', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: trip, start: at, maxLegs: 1, legCommands: ['poke 2ab4 44', 'poke 2ab5 25', 'poke 2ab6 1', 'pokew 2d5c 500'] });
      expect(steps.length).toBe(actions.length);
      const u = actions.indexOf('U');
      expect(steps[u - 1]!.mem!.doorOpen![9]).toBe(0);
      expect(steps[u]!.mem!.doorOpen![9]).toBe(1);
      expect(steps[u + 1]!.mem!.doorOpen![9]).toBe(0);
      expect([steps[u + 1]!.row, steps[u + 1]!.col]).toEqual([50, 22]);
      const data = loadTitleData('ishar2');
      // the walk starts at the poked cell (the first step is the move onto the zone cell)
      const start = { region: 5, row: 44, col: 25, facing: 0 as const };
      const cw = crawlWalk(data, start, steps, contLayers('ishar2', data), {}, 0, 30, false);
      cw.forEach((w, i) => {
        const r = comparePose('ishar2', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        // the click frame: the game's leaf is mid-slide (PCAVE +0x3a9), crawl draws the end state
        const missing = steps[i]!.action === 'U' ? 1 : 0;
        expect({ i, move: w.moveAgrees, tables: w.tablesAgree ?? true, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, tables: true, matched: r.oracle - missing, crawl: r.oracle - missing });
        if (!missing) expect(r.pixelsMasked - r.pixelsMaskedEqual, `step ${i} pixels`).toBeLessThanOrEqual(0);
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Maz location 4 (2026-11-23): the dungeon gate's way back. Trip to the
 * dungeon (location 4 poked), then MAIN message 38 again with location 21
 * poked: the party arrives in Maz, region 1, location 4, at (11,13) of
 * CONT1-3 (`0x3dbb` = 1; an earlier note had CONT2-3). The arrival state
 * has not been woken, so the scene starts with no extra wake (one extra
 * wake mirrors FVILLE's ground against the game's).
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 Maz location 4 vs the game (alis oracle)', () => {
  it('arrives from the dungeon gate and walks like the game', () => {
    const out = tempDir('ishar3-loc4-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const dj = join(out, 'dj.state');
      captureTrip('ishar3', [38], dj, 600, { commands: ['poke 3b33 4'] });
      const back = join(out, 'back.state');
      const at = captureTrip('ishar3', [38], back, 600, { startState: dj, commands: ['poke 3b33 21'] });
      expect(at).toEqual({ region: 1, row: 11, col: 13, facingRaw: -1 });
      const actions = [...'FFFLFFFFFRRFFFFFFFFFLFFFLFFFFFRFFFF'] as Array<'F' | 'L' | 'R'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: back, start: at, maxLegs: 1, legCommands: ['pokew 16e0 500'] });
      expect(new Set(steps.map((s) => s.mem!.zone![0]))).toEqual(new Set([4]));
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 0, 4, false);
      let px = 0, pt = 0;
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, matched: r.matched, crawl: r.crawl }).toEqual({ i, move: true, matched: r.oracle, crawl: r.oracle });
        px += r.pixelsMaskedEqual;
        pt += r.pixelsMasked;
      });
      expect(px / pt).toBeGreaterThan(0.9999);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * Maz location 6 (2026-11-23): back from the mountains (trip to location 6,
 * then MAIN message 38 again from region 9): region 1 (55,35). VJARDIN's
 * tree (slot 9, palOffset 22) has nibbles that pass the bank's end; the
 * game keeps them in the bank (`decodeIsharBitmap`).
 */
describe.skipIf(!oracleAvailable() || !existsSync(join(ORACLE_TITLES.ishar3.dataDir, 'MAIN.DO')))('ishar3 Maz location 6 vs the game (alis oracle)', () => {
  it('draws VJARDIN in the game\'s colours', () => {
    const out = tempDir('ishar3-loc6-test-');
    try {
      prepareGameDir('ishar3');
      if (!existsSync(savestatePath('ishar3'))) bootToSavestate('ishar3', join(out, 'boot'));
      const mt = join(out, 'mt.state');
      captureTrip('ishar3', [38], mt, 600, { commands: ['poke 3b33 6'] });
      const back = join(out, 'back.state');
      const at = captureTrip('ishar3', [38], back, 600, { startState: mt, commands: ['poke 3b33 35'] });
      expect(at).toEqual({ region: 1, row: 55, col: 35, facingRaw: -1 });
      const actions = [...'RLFFRFFLFFLLFF'] as Array<'F' | 'L' | 'R'>;
      const steps = captureLegWalk('ishar3', (_c, done) => (done.length ? null : actions), join(out, 'walk'), { noNpcs: true, startState: back, start: at, maxLegs: 1, legCommands: ['pokew 16e0 500'] });
      const data = loadTitleData('ishar3');
      const start = { region: at.region, row: at.row, col: at.col, facing: data.spec.facingRaw.indexOf(at.facingRaw) as 0 | 1 | 2 | 3 };
      const cw = crawlWalk(data, start, steps, contLayers('ishar3', data), {}, 0, 6, false);
      expect(cw.some((w) => w.leaves.some((l) => l.script === 'VJARDIN' && l.index === 9))).toBe(true);
      cw.forEach((w, i) => {
        const r = comparePose('ishar3', steps[i]!.frame, data, w.scripts, w.canvas, w.leaves, false);
        expect({ i, move: w.moveAgrees, matched: r.matched, crawl: r.crawl, px: r.pixelsMasked - r.pixelsMaskedEqual }).toEqual({ i, move: true, matched: r.oracle, crawl: r.oracle, px: 0 });
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
