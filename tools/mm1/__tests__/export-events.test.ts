/* eslint-disable @typescript-eslint/no-explicit-any -- harness JSON and recorded vectors are dynamic */
/** The per-map special-cell event table export (tools/mm1/export-events.ts): harness behaviour re-verified against the game files. Needs data/mm1/dosega. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { exportEvents, townTables } from '../export-events.ts';

const DIR = 'data/mm1/dosega';
describe.skipIf(!existsSync(`${DIR}/SORPIGAL.OVR`))('MM1 overlay event table', () => {
  const r = exportEvents(DIR);
  it('TS dispatch decode, text/destination resolution and flag cross-check agree with the harness (0 disagreements)', () => {
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.maps)).toHaveLength(55);
    expect(r.totalCells).toBe(816);
  });
  it('the three odd layouts: DEMON custom dispatcher, PP4 count byte > table, AREAE2 count byte < table', () => {
    expect(r.maps.demon.dispatcher).toBe('custom');
    expect(r.maps.pp4.count).toBeGreaterThan(r.maps.pp4.layout.masks - r.maps.pp4.layout.cells);
    expect(r.maps.pp4.bogusHandlers.length).toBe(2);
    expect(r.maps.areae2.count).toBeLessThan(r.maps.areae2.layout.masks - r.maps.areae2.layout.cells);
    expect(r.maps.areae2.cells).toHaveLength(5);
  });
  it('every special-flagged cell without a table entry falls to the miss path; 4 table entries sit on unflagged cells', () => {
    let nohand = 0, dead = 0;
    for (const m of Object.values<any>(r.maps)) { nohand += m.flaggedNoHandler.length; dead += m.handlerNotFlagged.length; }
    expect(nohand).toBe(2278); expect(dead).toBe(4);
  });
  it('null control: a dispatcher layout off by one handler slot disagrees with the harness', () => {
    expect(exportEvents(DIR, 'dispatchLayout').problems.length).toBeGreaterThan(0);
  });
  it('town tables: food price per member and the three shop stock tables (5 towns x 6 items)', () => {
    const t = townTables(new Uint8Array(readFileSync(`${DIR}/MM.EXE`)).subarray(0x200));
    expect(t.foodPricePerMember).toEqual([5, 10, 20, 200, 50]);
    expect(t.shopStock.map(s => s.towns.length)).toEqual([5, 5, 5]);
    expect(t.shopStock[0].towns[0]).toEqual([2, 3, 5, 61, 62, 86]);
    expect(t.temple.healInjuredOrAiling).toEqual([25, 50, 50, 25, 100]);
  });
});
