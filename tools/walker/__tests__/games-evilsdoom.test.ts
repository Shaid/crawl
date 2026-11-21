import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canEnter, gatherView, GRID, mirrorArt, mirrorPhase, renderView, stepPose, wallSlots, VIEW_W, VIEW_H,
  type EdLevel, type Slot,
} from '../../evilsdoom/amigaaga/view-model.ts';

function synth(set: (x: number, y: number) => number): EdLevel {
  const grid = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) grid[y * GRID + x] = x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1 ? 0x80 : set(x, y);
  return { grid };
}

describe("Evil's Doom movement / collision (synthetic)", () => {
  const open = synth(() => 0);
  it('facing 0 is -y, 1 is +x; turnR = +1; borders block', () => {
    expect(stepPose(open, { x: 5, y: 5, facing: 0 }, 'fwd')).toEqual({ x: 5, y: 4, facing: 0 });
    expect(stepPose(open, { x: 5, y: 5, facing: 1 }, 'fwd')).toEqual({ x: 6, y: 5, facing: 1 });
    expect(stepPose(open, { x: 5, y: 5, facing: 0 }, 'left')).toEqual({ x: 4, y: 5, facing: 0 });
    expect(stepPose(open, { x: 5, y: 5, facing: 3 }, 'turnR')).toEqual({ x: 5, y: 5, facing: 0 });
    expect(stepPose(open, { x: 5, y: 1, facing: 0 }, 'fwd')).toBeNull();
  });
  it('solid blocks unless bit 6 (illusion); open cell bit 1 blocks; door bit 3 walkable (doors not decoded)', () => {
    const l = synth((x) => ({ 2: 0x80, 3: 0xc0, 4: 0x02, 5: 0x08, 6: 0x04 } as Record<number, number>)[x] ?? 0);
    expect(canEnter(l, 2, 5)).toBe(false);
    expect(canEnter(l, 3, 5)).toBe(true);
    expect(canEnter(l, 4, 5)).toBe(false);
    expect(canEnter(l, 5, 5)).toBe(true);
    expect(canEnter(l, 6, 5)).toBe(true);
  });
  it('mirror phase flips on every move and turn', () => {
    const o = { x: 5, y: 5, facing: 0 };
    expect(mirrorPhase(5, 5, 0, o)).toBe(0);
    expect(mirrorPhase(5, 4, 0, o)).toBe(1);
    expect(mirrorPhase(5, 5, 3, o)).toBe(1);
    expect(mirrorPhase(5, 4, 3, o)).toBe(0);
  });
});

describe("Evil's Doom view gather + wall emit (synthetic)", () => {
  it('gather order: cell 11 is one ahead, 13/14 left/right, 15 behind, per facing', () => {
    const l = synth((x, y) => (x === 10 && y === 9 ? 0x11 : x === 9 && y === 10 ? 0x22 : x === 11 && y === 10 ? 0x33 : 0));
    const n = gatherView(l, 10, 10, 0);
    expect([n[11], n[13], n[14]]).toEqual([0x11, 0x22, 0x33]);
    const e = gatherView(l, 10, 10, 1); // facing +x: ahead (11,10), left (10,9)
    expect([e[11], e[13], e[15]]).toEqual([0x33, 0x11, 0x22]);
  });
  it('wall to the right (facing N) is slot 4, and slot 3 when facing S (wrong-orientation control)', () => {
    const l = synth((x, y) => (x === 11 && y === 10 ? 0x80 : 0));
    expect(wallSlots(gatherView(l, 10, 10, 0))).toContain(4);
    expect(wallSlots(gatherView(l, 10, 10, 0))).not.toContain(3);
    expect(wallSlots(gatherView(l, 10, 10, 2))).toContain(3);
    expect(wallSlots(gatherView(l, 10, 10, 2))).not.toContain(4);
  });
  it('a wall ahead at depth 1 hides depth 2/3 front faces; corridor sides emit side faces', () => {
    const blocked = synth((x, y) => (x === 10 && y <= 9 ? 0x80 : 0));
    const s = wallSlots(gatherView(blocked, 10, 10, 0));
    expect(s).toContain(0x00);
    expect(s).not.toContain(0x01);
    expect(s).not.toContain(0x02);
    const corridor = synth((x) => (x !== 10 ? 0x80 : 0));
    const c = wallSlots(gatherView(corridor, 10, 15, 0));
    for (const k of [3, 4, 5, 6, 7, 8, 9, 10]) expect(c).toContain(k);
    expect(c).not.toContain(0x00);
  });
});

describe("Evil's Doom mirror buffer (synthetic)", () => {
  const slots: Slot[] = Array.from({ length: 25 }, (_, i) => ({ src: i * 12, x: 0, y: 0, w: 1, h: 2, mod: 0 }));
  it('is an involution and reverses bit order within a row', () => {
    const a = new Uint8Array(17 * 12).map((_, i) => (i * 37 + 11) & 255);
    const m = mirrorArt(a, slots);
    expect(Array.from(mirrorArt(m, slots))).toEqual(Array.from(a));
    a[0] = 0x80; a[1] = 0x00;
    const m2 = mirrorArt(a, slots);
    expect([m2[0], m2[1]]).toEqual([0x00, 0x01]);
  });
});

const ASSETS = resolve('public/assets/evilsdoom/amigaaga/walker');
const PRG = resolve('build/cache/evilsdoom/unpacked/PRG');
const have = existsSync(resolve(ASSETS, 'dungeons.json')) && existsSync(resolve(PRG, 'BEL.dat')) && existsSync(resolve('data/evilsdoom/amigaaga/data/SAVE/B/.BEL'));

describe.skipIf(!have)("Evil's Doom real data", async () => {
  const { readModule } = await import('../../evilsdoom/amigaaga/module.ts');
  const tags = ['BEL', 'CLL', 'IOW', 'MIN', 'MYT'];
  const mods = Object.fromEntries(tags.map((t) => [t, readModule(new Uint8Array(readFileSync(resolve(PRG, `${t}.dat`))), `.${t}`)]));
  const dungeons = JSON.parse(readFileSync(resolve(ASSETS, 'dungeons.json'), 'utf8')) as Array<{ tag: string; wal: string; slots: Slot[]; levels: Array<{ id: number; level: number; grid: string; start: { x: number; y: number; facing: number; source: string } }> }>;

  it('level counts per module match the guides (CLL 10, BEL 7, MIN 9, MYT 6, IOW 4) and every grid has a solid top/left/right border', () => {
    const n = Object.fromEntries(tags.map((t) => [t, mods[t].gridOffsets.filter((g) => g !== null).length]));
    expect(n).toEqual({ BEL: 7, CLL: 10, IOW: 4, MIN: 9, MYT: 6 });
    for (const t of tags) expect(mods[t].stateSize).toBe(readFileSync(resolve('data/evilsdoom/amigaaga/data/SAVE/B', `.${t}`)).length);
    const unbordered: number[] = [];
    for (const d of dungeons) for (const l of d.levels) {
      const g = Buffer.from(l.grid, 'base64');
      if (![...Array(30).keys()].every((i) => g[i] & 0x80 && g[i * 30] & 0x80 && g[i * 30 + 29] & 0x80)) unbordered.push(l.id);
    }
    // Belcoon level 2 (id 11) is walled off at row 28 and its row 29 is all 0x00 (unreachable);
    // Castle Mythil level 2's gate gap (15,29) is in the bottom row, which this check skips.
    expect(unbordered).toEqual([11]);
    const b2 = Buffer.from(dungeons.find((d) => d.tag === 'BEL')!.levels[1].grid, 'base64');
    expect([...b2.subarray(28 * 30, 29 * 30)].every((v) => v === 0x80)).toBe(true);
  });

  it('the 25-slot table is identical in all modules and slots 0-16 tile DT0+DT1 exactly at 3 planes (2/4 planes fail)', () => {
    for (const t of tags) expect(mods[t].slots).toEqual(mods.BEL.slots);
    const s = mods.BEL.slots;
    const dt0 = readFileSync(resolve('build/cache/evilsdoom/unpacked/WAL/BELCOON.DT0')).length;
    const dt1 = readFileSync(resolve('build/cache/evilsdoom/unpacked/WAL/BELCOON.DT1')).length;
    const tiles = (planes: number) => {
      let off = 0;
      for (let i = 0; i <= 16; i++) { if (s[i].src !== off) return false; off += planes * (s[i].w * 2 + s[i].mod) * s[i].h; if (i === 14 && off !== dt0) return false; }
      return off === dt0 + dt1;
    };
    expect(tiles(3)).toBe(true);
    expect(tiles(2)).toBe(false);
    expect(tiles(4)).toBe(false);
  });

  it('bit-2 cells line up between consecutive levels far above chance (stairs hypothesis)', () => {
    let hits = 0, shuffledHits = 0;
    for (const d of dungeons) for (let i = 0; i + 1 < d.levels.length; i++) {
      const a = Buffer.from(d.levels[i].grid, 'base64'), b = Buffer.from(d.levels[i + 1].grid, 'base64');
      for (let c = 0; c < 900; c++) {
        if ((a[c] & 0x84) !== 0x04) continue;
        if ((b[c] & 0x84) === 0x04) hits++;
        const t = (c * 7 + 13) % 900; // null control: unrelated cell
        if ((b[t] & 0x84) === 0x04) shuffledHits++;
      }
    }
    expect(hits).toBeGreaterThan(10);
    expect(shuffledHits).toBeLessThan(hits / 4);
  });

  it('saved start pose is enterable and renders a non-blank frame', () => {
    const d = dungeons.find((x) => x.tag === 'BEL')!;
    const l = d.levels.find((v) => v.start.source === 'save')!;
    const grid = new Uint8Array(Buffer.from(l.grid, 'base64'));
    expect(canEnter({ grid }, l.start.x, l.start.y)).toBe(true);
    const normal = new Uint8Array(Buffer.from(JSON.parse(readFileSync(resolve(ASSETS, `art/${d.wal}.json`), 'utf8')).data, 'base64'));
    const px = renderView({ grid }, d.slots, { normal, mirror: mirrorArt(normal, d.slots) }, l.start.x, l.start.y, 0, 0);
    expect(px.length).toBe(VIEW_W * VIEW_H);
    expect(new Set(px).size).toBeGreaterThan(4);
  });
});
