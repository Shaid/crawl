/**
 * Crystals of Arborea's 3D scene without the oracle: the start pose, the
 * palette rule and the step rule, as measured against the game
 * (`crystals-oracle.test.ts` re-measures them when the oracle is built).
 * Skips when the retail data is missing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRYSTALS_TITLE, crystalsHouseZone, crystalsNewGameGrid, crystalsPaletteSlot, IsharGridBuffers, IsharScene, type IsharPartyState } from '../../shared/ishar-scene.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';

const DIR = 'data/crystalsofarborea/amiga';
const have = existsSync(join(DIR, 'INIT.FIC'));

describe.skipIf(!have)('crystals 3D scene', () => {
  const grid = have ? crystalsNewGameGrid(new Uint8Array(readFileSync(join(DIR, 'INIT.FIC')))) : new Uint8Array();
  const load = (n: string) => {
    const p = join(DIR, `${n.toUpperCase()}.CO`);
    return existsSync(p) ? unpackIsharScript(new Uint8Array(readFileSync(p))) : undefined;
  };
  const cell = (_r: number, row: number, col: number) => ((grid[row * 114 + col]! ^ 128) - 128);

  it('draws the new-game start view like the game (148 sprites, NAD palette slot 0)', () => {
    const st: IsharPartyState = { region: 0, row: 30, col: 45, facing: 1 };
    const scene = new IsharScene(CRYSTALS_TITLE, load, new IsharGridBuffers(CRYSTALS_TITLE, () => [grid]).update(st));
    scene.enter(st);
    scene.step(st);
    expect(scene.leaves().length).toBe(148);
    expect(scene.scriptNames).toEqual(['CIELSOL', 'ARBRE', 'NPLAINE', 'PLAGES', 'TOUR', 'PUIT', 'GEMEEXT', 'HABITAT']);
    // NAD slot 0: index 11 is the sky's 32,160,160
    expect(scene.palette?.colors[11]).toEqual([32, 160, 160]);
  });

  it('picks NAD palette slots by the hour, the cave and the flags', () => {
    const rm = (g: Record<number, number>) => (a: number) => g[a] ?? 0;
    expect(crystalsPaletteSlot(rm({ 0x2e97: 1 }))).toBe(0);
    expect(crystalsPaletteSlot(rm({ 0x2e97: 13 }))).toBe(12);
    expect(crystalsPaletteSlot(rm({ 0x2e97: 6, 0x30a4: 1 }))).toBe(17);
    expect(crystalsPaletteSlot(rm({ 0x2e97: 3, 0x2b3c: 1 }))).toBe(14);
    expect(crystalsPaletteSlot(rm({ 0x2e97: 3, 0x2f36: 1 }))).toBe(13);
  });

  it('steps like GUGUS: obstacles block, the cave mouth switches the layer', () => {
    const at = (row: number, col: number, region = 0): IsharPartyState => ({ region, row, col, facing: 1 });
    // oracle: (27,48) east onto (28,48) = -33 was refused
    expect(CRYSTALS_TITLE.enter!(at(27, 48), at(28, 48), cell)).toBeNull();
    // oracle: the step onto (32,9) = 48 put the party in the cave layer at the same x, y
    expect(CRYSTALS_TITLE.enter!(at(32, 10), at(32, 9), cell)).toMatchObject({ region: 1, row: 32, col: 9 });
  });

  it('swaps PLAGES for GHABITAT with a house two cells ahead, and back', () => {
    const grids = new IsharGridBuffers(CRYSTALS_TITLE, () => [grid]).update({ region: 0, row: 0, col: 0, facing: 0 });
    // oracle: (24,43) facing west, the house (63) at (22,42)
    const z = crystalsHouseZone({ region: 0, row: 24, col: 43, facing: 3 }, grids, 0);
    expect(z).toBeGreaterThan(0);
    expect(crystalsHouseZone({ region: 0, row: 28, col: 43, facing: 1 }, grids, z)).toBe(0);
  });
});
