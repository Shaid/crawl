/**
 * The walker's cave and town layer: Ishar 1's region codes 12-15 are drawn
 * on their CONT grid (code - 10) and entered at MAIN's gateway cells
 * (`ISHAR1_PORTALS`). Runs the walker's own view on the shipped CONT5 grid,
 * with the scene scripts left out (the step test needs none).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISHAR1_TITLE } from '../../shared/ishar-scene.ts';
import { IsharView } from '../../walker/games-ishar.ts';

const CONT5 = 'data/ishar/amigaaga/CONT5.FIC';

describe.skipIf(!existsSync(CONT5))('Ishar 1 walker caves', () => {
  const storage = new Uint8Array(readFileSync(CONT5));
  // the walker's geographic frame: terrain[col*rows + row] = storage[row*90 + col]
  const terrain = new Uint8Array(54 * 90);
  for (let row = 0; row < 54; row++) for (let col = 0; col < 90; col++) terrain[col * 54 + row] = storage[row * 90 + col]!;
  const data = {
    game: 'ishar',
    layout: undefined,
    regions: [{ id: 5, name: 'CONT5', label: 'CONT5 (region 5)', width: 54, height: 90, terrain }],
    storage: new Map([[5, [storage]]]),
    firstPerson: undefined,
    scene: { spec: ISHAR1_TITLE, scripts: new Map<string, Uint8Array>() },
  };
  const keys = (code: string) => ({ isDown: (c: string) => c === code });

  it('steps through the CONT5 cave mouth into region 15 and back out', () => {
    // (12,24) facing south (walker facing 1 = raw 2 = row + 1)
    const view = new IsharView('ishar', 'Ishar 1', data as never, 5, { level: 5, x: 12, y: 24, facing: 1 });
    expect(view.update(1000, keys('KeyW'))).toEqual({ level: 15, x: 13, y: 24, facing: 1 });
    expect(view.levelId).toBe(5);
    expect(view.levelLabel).toContain('cave code 15');
    expect(view.update(1000, keys('KeyS'))).toEqual({ level: 5, x: 12, y: 24, facing: 1 });
  });
});
