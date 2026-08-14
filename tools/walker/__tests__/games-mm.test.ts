/**
 * `tools/walker/games-mm.ts` — the pure per-game selection logic that sits
 * between the decoded MM1/MM2 data and the shared `walker-mm` frustum
 * engine. `wallLaneForDepth` picks which of MM1's near/mid/far WALLPIX
 * entries (`.OVR` `wallEntries[0..2]`) a given frustum depth should render
 * with (previously always used entry 0 for every depth).
 */
import { describe, expect, it } from 'vitest';
import { wallLaneForDepth } from '../games-mm.ts';

describe('wallLaneForDepth', () => {
  it('picks the near/mid/far entry for depths 0/1/2', () => {
    const entries = [6, 13, 12]; // AREAA1: wall07/wall14/wall13
    expect(wallLaneForDepth(entries, 0)).toBe(6);
    expect(wallLaneForDepth(entries, 1)).toBe(13);
    expect(wallLaneForDepth(entries, 2)).toBe(12);
  });

  it('reuses the far lane for depths beyond 2', () => {
    const entries = [6, 13, 12];
    expect(wallLaneForDepth(entries, 3)).toBe(12);
  });

  it('falls back to entry 0 when a lane is missing', () => {
    expect(wallLaneForDepth([5], 1)).toBe(5);
    expect(wallLaneForDepth([5], 2)).toBe(5);
  });
});
