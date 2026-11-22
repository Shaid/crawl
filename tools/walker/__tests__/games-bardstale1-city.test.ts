import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCityRows, cityMove, buildingAction, renderCityView, cityByte, type Bt1City } from '../../bardstale1/amiga/city.ts';
import { cityArtFromJSON, cityFromJSON, BardsTale1CityView, CITY_LEVEL } from '../games-bardstale1.ts';

const blank = (): Bt1City => ({ path: new Uint8Array(900), name: new Uint8Array(900), streetNames: ['Alley'] });
const set = (c: Bt1City, r: number, k: number, v: number) => {
  c.path[r * 30 + k] = v;
};

describe('bardstale1 city movement', () => {
  it('facing 0 = north = row-1, east = col+1; streets pass', () => {
    const c = blank();
    expect(cityMove(c, 10, 10, 0)).toMatchObject({ kind: 'move', row: 9, col: 10 });
    expect(cityMove(c, 10, 10, 1)).toMatchObject({ kind: 'move', row: 10, col: 11 });
    expect(cityMove(c, 10, 10, 2)).toMatchObject({ kind: 'move', row: 11, col: 10 });
    expect(cityMove(c, 10, 10, 3)).toMatchObject({ kind: 'move', row: 10, col: 9 });
  });
  it('a house ahead turns the party round; a house beside does not block (null control)', () => {
    const c = blank();
    set(c, 9, 10, 0x02);
    expect(cityMove(c, 10, 10, 0).kind).toBe('turn');
    expect(cityMove(c, 10, 10, 1).kind).toBe('move');
  });
  it('the (27,25) square puts the party on row 22 (0x802b0)', () => {
    expect(cityMove(blank(), 26, 25, 2)).toMatchObject({ kind: 'move', row: 22, col: 25 });
    expect(cityMove(blank(), 26, 24, 2)).toMatchObject({ kind: 'move', row: 27, col: 24 });
  });
  it('guardian statues and iron gates pass only in their free direction', () => {
    expect(buildingAction(0x60, 15, 3, 0).kind).toBe('move');
    expect(buildingAction(0x60, 15, 3, 2).kind).toBe('blocked');
    expect(buildingAction(0x68, 25, 2, 0).kind).toBe('move');
    expect(buildingAction(0x68, 25, 2, 1).kind).toBe('blocked');
  });
  it('dungeon entrances map to the levs record via 0x17492', () => {
    expect(buildingAction(0x9b, 5, 4, 0)).toMatchObject({ kind: 'dungeon', dungeon: 4, level: 1 });
    expect(buildingAction(0x12, 24, 28, 0)).toMatchObject({ kind: 'dungeon', dungeon: 1, level: 1 });
    expect(buildingAction(0x12, 23, 20, 0).kind).toBe('turn'); // another tavern: no cellar
  });
  it('reads past the path grid into the name grid (no bounds check)', () => {
    const c = blank();
    c.name[5] = 0x33;
    expect(cityByte(c, 30, 5)).toBe(0x33);
  });
});

describe('bardstale1 city view rows', () => {
  it('left/centre/right per facing', () => {
    const c = blank();
    set(c, 8, 9, 0x01); // two north, one west of (10,10)
    const n = buildCityRows(c, 10, 10, 0);
    expect(n[2 * 3 + 0]).toBe(1);
    expect(n[2 * 3 + 2]).toBe(0);
    // facing south it is behind the party (null control)
    expect(buildCityRows(c, 10, 10, 2).some((v) => v)).toBe(false);
    set(c, 12, 11, 0x01); // two south, one east: facing south that is on the left
    expect(buildCityRows(c, 10, 10, 2)[2 * 3 + 0]).toBe(1);
  });
});

const cityJson = resolve('public/assets/bardstale1/amiga/data/city/city.json');
const viewJson = resolve('public/assets/bardstale1/amiga/data/city/view.json');
describe.skipIf(!existsSync(cityJson) || !existsSync(viewJson))('bardstale1 city real data', () => {
  const cj = existsSync(cityJson) ? JSON.parse(readFileSync(cityJson, 'utf8')) : null;
  it('the guild is west of the new-game square (row-major grid, not transposed)', () => {
    const c = cityFromJSON(cj);
    expect(c.path[14 * 30 + 24]).toBe(0x0b);
    expect(c.path[24 * 30 + 14]).not.toBe(0x0b);
    expect(cityMove(c, 14, 25, 3).kind).toBe('leave');
  });
  it('renders: facing west at the start shows the guild picture, other facings differ', () => {
    const c = cityFromJSON(cj);
    const art = cityArtFromJSON(JSON.parse(readFileSync(viewJson, 'utf8')));
    const fr = [0, 1, 2, 3].map((f) => renderCityView(art, c, 14, 25, f));
    expect(fr[3]!.picture).toBe(52);
    expect(fr[0]!.picture).toBeUndefined();
    expect(Buffer.compare(Buffer.from(fr[0]!.px), Buffer.from(fr[2]!.px))).not.toBe(0);
    // sky (colour 1) on top, ground (colour 2) at the bottom centre of an open street view
    expect(fr[0]!.px[2 * 112 + 56]).toBe(1);
    expect(fr[0]!.px[86 * 112 + 56]).toBe(2);
  });
  it('9 dungeon entrances; walking into the castle loads levs record 7', () => {
    expect(cj.entrances.length).toBe(9);
    const v = new BardsTale1CityView(
      cityArtFromJSON(JSON.parse(readFileSync(viewJson, 'utf8'))),
      cityFromJSON(cj),
      cj.entrances,
      { level: CITY_LEVEL, x: 5, y: 5, facing: 3 },
    );
    const keys = { isDown: (k: string) => k === 'KeyW', consumePress: () => false } as never;
    v.update(1000, keys);
    expect(v.takeLevelChange()).toMatchObject({ level: 7, x: 0, y: 0 });
  });
});
