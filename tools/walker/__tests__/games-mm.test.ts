/**
 * `tools/walker/games-mm.ts` — pure per-game selection logic between the
 * decoded MM1/MM2 data and the shared `walker-mm` frustum engine.
 * `wallEntryForCode` picks the MM1 WALLPIX entry by wall CODE (1/2/3 ->
 * `.OVR` wallEntries[0/1/2]), as ScummVM `GameView::drawTile` does — not by
 * view depth (audit 2026-11-13 finding 1).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MM1_TOWN_START, wallEntryForCode } from '../games-mm.ts';

describe('wallEntryForCode', () => {
  const entries = [0, 1, 2]; // Sorpigal: plain brick / door+torches / torch
  it('code 1/2/3 select MAP_2/MAP_4/MAP_6', () => {
    expect(wallEntryForCode(entries, 1)).toBe(0);
    expect(wallEntryForCode(entries, 2)).toBe(1);
    expect(wallEntryForCode(entries, 3)).toBe(2);
  });
  it('overland biome sets differ per code', () => {
    const areaa1 = [6, 13, 12];
    expect([1, 2, 3].map((c) => wallEntryForCode(areaa1, c))).toEqual([6, 13, 12]);
  });
  it('falls back to entry 0 when a lane is missing', () => {
    expect(wallEntryForCode([5], 2)).toBe(5);
    expect(wallEntryForCode([5], 3)).toBe(5);
  });
});

describe('MM1 town starts', () => {
  it('match ScummVM Maps::loadTown', () => {
    expect(MM1_TOWN_START[0]).toEqual({ x: 8, y: 3, facing: 0 });
    expect(MM1_TOWN_START[3]).toEqual({ x: 11, y: 8, facing: 1 });
  });
});

const OVR = resolve('public/assets/mm1/dosega/data/ovr.json');
describe('MM1 .OVR exits (real data)', { skip: !existsSync(OVR) }, () => {
  const ov = JSON.parse(readFileSync(OVR, 'utf8')).overlays as { exits: { screen: number | null }[] }[];
  const ex = ov.map((o) => o.exits.map((e) => e.screen));
  const reciprocal = (shift: number) => {
    let good = 0;
    ex.forEach((e, i) =>
      e.forEach((t, k) => {
        if (t === null || t === i) return;
        if (ex[t][(k + shift) % 4] === i) good++;
      }),
    );
    return good;
  };
  it('62 of 66 cross-screen links are reciprocal (N<->S, E<->W); pp2 -> dragad accounts for 4', () => {
    expect(reciprocal(2)).toBe(62);
  });
  it('null control: un-opposed pairing collapses to 0', () => {
    expect(reciprocal(0)).toBe(0);
  });
  it('indoor maps wrap onto themselves; the 20 overland sectors link to each other', () => {
    expect(ex[0]).toEqual([0, 0, 0, 0]);
    expect(ex[14][1]).toBe(18); // areaa1 east -> areab1
  });
});
