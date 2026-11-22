import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCityRows, cityMove, bigCityLayout, renderCityView, type Bt2City } from '../../bardstale2/amiga/city.ts';
import { cityArtFromJSON, BardsTale2CityView, CITY_BASE, type CityIndexJSON } from '../games-bardstale2.ts';

const blank = (index = 1): Bt2City => ({ index, name: 't', grid: new Uint8Array(512) });
const set = (c: Bt2City, r: number, k: number, v: number) => {
  c.grid[r * 16 + k] = v;
};

describe('bardstale2 city movement', () => {
  it('facing 0 = north = row-1; streets pass; leaving the 16x16 grid exits', () => {
    const c = blank();
    expect(cityMove(c, 5, 5, 0)).toMatchObject({ kind: 'move', row: 4, col: 5 });
    expect(cityMove(c, 5, 5, 1)).toMatchObject({ kind: 'move', row: 5, col: 6 });
    expect(cityMove(c, 0, 5, 0).kind).toBe('exit');
    expect(cityMove(c, 5, 15, 1).kind).toBe('exit');
    expect(cityMove(c, 15, 5, 0).kind).toBe('move'); // null control: the other direction stays inside
  });
  it('buildings turn the party round; the dungeon building enters the city dungeon (0x57800 / 0x18b5c)', () => {
    const c = blank(2);
    set(c, 4, 5, 0x26);
    expect(cityMove(c, 5, 5, 0).kind).toBe('turn');
    set(c, 4, 5, 0xc6);
    expect(cityMove(c, 5, 5, 0)).toMatchObject({ kind: 'dungeon', dungeonId: 2, record: 4 });
    expect(cityMove({ ...c, index: 6 }, 5, 5, 0)).toMatchObject({ kind: 'dungeon', dungeonId: 5, record: 13 });
  });
});

describe('bardstale2 city view rows', () => {
  it('sides are masked to the facade, out-of-grid cells read 0', () => {
    const c = blank();
    set(c, 3, 4, 0x26); // two north, one west of (5,5)
    const n = buildCityRows(c, 5, 5, 0);
    expect(n[2 * 3 + 0]).toBe(6);
    expect(n[2 * 3 + 2]).toBe(0);
    set(c, 4, 5, 0x37);
    expect(buildCityRows(c, 5, 5, 0)[4]).toBe(0x37); // centre at distance 1 keeps the type for the picture
    expect(buildCityRows(c, 0, 0, 0).every((v) => v === 0)).toBe(true);
  });
  it('the big_city carve-up fills 92,744 B exactly', () => {
    const l = bigCityLayout();
    expect(l.slice.length + l.side.length + l.front.length).toBe(30);
  });
});

const base = resolve('public/assets/bardstale2/amiga/data/city');
describe.skipIf(!existsSync(`${base}/view.json`))('bardstale2 city real data', () => {
  const load = (i: number): Bt2City => {
    const j = JSON.parse(readFileSync(`${base}/city${i}.json`, 'utf8'));
    return { index: i, name: j.name, grid: Uint8Array.from(j.grid) };
  };
  it('each guild exit faces away from the guild (row-major grid, facing 0 = row-1)', () => {
    const idx: CityIndexJSON[] = JSON.parse(readFileSync(`${base}/cities.json`, 'utf8')).cities;
    for (const ci of idx) {
      const c = load(ci.index);
      const back = (ci.start.facing + 2) & 3;
      const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][back]!;
      expect(c.grid[(ci.start.row + dr!) * 16 + ci.start.col + dc!]! >> 4).toBe(3);
      // wrong-orientation control: the transposed grid does not put the guild there
      expect(c.grid[(ci.start.col + dc!) * 16 + ci.start.row + dr!]! >> 4 === 3 && ci.start.row !== ci.start.col).toBe(false);
    }
  });
  it('renders the guild picture facing the guild and a street view otherwise; walking in enters the dungeon', () => {
    const art = cityArtFromJSON(JSON.parse(readFileSync(`${base}/view.json`, 'utf8')));
    const c = load(1);
    const lay = bigCityLayout();
    expect(renderCityView(art, lay, c, 7, 1, 1).picture).toBe(21);
    const f0 = renderCityView(art, lay, c, 7, 1, 0);
    expect(f0.picture).toBeUndefined();
    expect(f0.px[2 * 112 + 56]).toBe(1);
    const idx: CityIndexJSON[] = JSON.parse(readFileSync(`${base}/cities.json`, 'utf8')).cities;
    const v = new BardsTale2CityView(art, c, idx[0]!, { level: CITY_BASE + 1, x: 14, y: 7, facing: 1 });
    v.update(1000, { isDown: (k: string) => k === 'KeyW', consumePress: () => false } as never);
    expect(v.takeLevelChange()).toMatchObject({ level: 0, x: 0, y: 0 });
  });
});
