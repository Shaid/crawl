import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canEnter, cellAt, decodeLevel, fromB64, isWallView, renderView, areaIds, VIEW_H, VIEW_W,
  type Ap1Level, type Ap1Tables, type Facing,
} from '../../abandonedplaces/amiga/view-model.ts';
import { stepPose } from '../games-abandonedplaces.ts';
import { parseLevel, LEVEL_BYTES } from '../../abandonedplaces/amiga/export-walker.ts';

function synth(rows: string[]): Ap1Level {
  const grid = new Uint16Array(1024);
  rows.forEach((r, y) => [...r].forEach((c, x) => { grid[y * 32 + x] = c === '#' ? 1 : c === 'i' ? 0x2000 : c === 'H' ? 0x4000 : 0; }));
  return { id: 0, label: 't', index: 0, file: 'x', grid, areas: [[1, 0, 0, 1]], teleports: [], doors: [], start: { x: 0, y: 0, facing: 0, area: 0 } };
}

describe('AP1 movement / collision (synthetic)', () => {
  const lvl = synth(['#####', '#...#', '#.i.#', '#.H.#', '#####']);
  it('walls block, open admit, facing 0 is -y, east is +x', () => {
    expect(stepPose(lvl, { x: 1, y: 2, facing: 0 }, 'fwd')).toEqual({ x: 1, y: 1, facing: 0 });
    expect(stepPose(lvl, { x: 1, y: 1, facing: 0 }, 'fwd')).toBeNull();
    expect(stepPose(lvl, { x: 1, y: 1, facing: 1 }, 'fwd')).toEqual({ x: 2, y: 1, facing: 1 });
    expect(stepPose(lvl, { x: 1, y: 1, facing: 0 }, 'turnR')).toEqual({ x: 1, y: 1, facing: 1 });
    expect(stepPose(lvl, { x: 1, y: 1, facing: 0 }, 'turnL')).toEqual({ x: 1, y: 1, facing: 3 });
  });
  it('strafe/back follow the move tables 0xAD72/82/92', () => {
    expect(stepPose(lvl, { x: 2, y: 1, facing: 0 }, 'right')).toEqual({ x: 3, y: 1, facing: 0 });
    expect(stepPose(lvl, { x: 2, y: 1, facing: 0 }, 'left')).toEqual({ x: 1, y: 1, facing: 0 });
    expect(stepPose(lvl, { x: 2, y: 1, facing: 0 }, 'back')).toEqual({ x: 2, y: 2, facing: 0 });
  });
  it('illusory (0x2000) draws as wall unless detected but is walkable; 0x4000 never blocks the party', () => {
    expect(isWallView(cellAt(lvl, 2, 2))).toBe(true);
    expect(isWallView(cellAt(lvl, 2, 2), true)).toBe(false);
    expect(canEnter(lvl, 2, 2)).toBe(true);
    expect(isWallView(cellAt(lvl, 2, 3))).toBe(false);
    expect(canEnter(lvl, 2, 3)).toBe(true);
    expect(canEnter(lvl, -1, 0)).toBe(false);
  });
});

const R = resolve('public/assets/abandonedplaces/amiga/walker');
const have = existsSync(resolve(R, 'levels.json')) && existsSync(resolve('build/cache/abandonedplaces/dungeon1'));
const J = (p: string) => JSON.parse(readFileSync(resolve(R, p), 'utf8'));

describe.skipIf(!have)('AP1 real data', () => {
  const tables = J('tables.json') as Ap1Tables;
  const raw = J('levels.json');
  const levels = raw.map(decodeLevel) as Ap1Level[];
  const theme = (l: Ap1Level) => {
    const { module, backgnd } = areaIds(l, 0);
    return { pieces: (J(`module/${module}.json`).pieces as string[]).map(fromB64), halves: (J(`backgnd/${backgnd}.json`).halves as string[]).map(fromB64) };
  };

  it('36 levels; every list walk ends exactly at the 10,916-byte record boundary (36/36)', () => {
    expect(levels.length).toBe(36);
    for (let f = 1; f <= 3; f++) {
      const d = new Uint8Array(readFileSync(resolve(`build/cache/abandonedplaces/dungeon${f}`)));
      for (let n = 0; n < 12; n++) expect(parseLevel(d.subarray(n * LEVEL_BYTES, (n + 1) * LEVEL_BYTES)).end).toBe(LEVEL_BYTES);
    }
  });
  it('border is solid and start poses / teleport sources are open cells (null control: shifted sources are not)', () => {
    let srcOpen = 0, src = 0, shifted = 0;
    for (const l of levels) {
      for (let i = 0; i < 32; i++) for (const [x, y] of [[i, 0], [i, 31], [0, i], [31, i]]) expect(cellAt(l, x, y) & 1).toBe(1);
      expect(canEnter(l, l.start.x, l.start.y)).toBe(true);
      for (const t of l.teleports) { src++; if (canEnter(l, t.x, t.y)) srcOpen++; if (canEnter(l, (t.x + 5) % 32, (t.y + 9) % 32)) shifted++; }
    }
    expect(srcOpen).toBe(src);
    expect(shifted).toBeLessThan(src * 0.8);
  });
  it('same-level teleport destinations are open cells', () => {
    for (const l of levels) for (const t of l.teleports) if (t.level === 0 || t.level - 1 === l.index) expect(canEnter(l, t.dx, t.dy)).toBe(true);
  });
  it('cross-level teleport destinations land on open cells of level (value-1): 23/24 vs 7/24 for the (value) null', () => {
    let a = 0, b = 0, n = 0;
    for (const l of levels) {
      const base = l.id - l.index;
      for (const t of l.teleports) {
        if (t.level <= 0 || t.level - 1 === l.index) continue;
        n++;
        const tgt = levels[base + t.level - 1], alt = levels[base + t.level];
        if (tgt && canEnter(tgt, t.dx, t.dy)) a++;
        if (alt && canEnter(alt, t.dx, t.dy)) b++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(20);
    expect(a / n).toBeGreaterThan(0.9);
    expect(b / n).toBeLessThan(0.5);
  });
  it('frame: right size, many colours; wall directly ahead draws the depth-1 front-wall piece (9), removing it changes the frame', () => {
    const l = levels[0];
    const th = theme(l);
    // (2,26) facing north: (2,25) is the entrance cell, open; use a known corridor: find an open cell with a wall ahead
    let pose: [number, number] | null = null;
    for (let y = 1; y < 31 && !pose; y++) for (let x = 1; x < 31; x++) if (!(cellAt(l, x, y) & 1) && (cellAt(l, x, y - 1) & 1) && !(cellAt(l, x, y + 1) & 1)) { pose = [x, y]; break; }
    const [px, py] = pose!;
    const tr: number[] = [];
    const a = renderView(l, tables, th, px, py, 0 as Facing, { trace: tr });
    expect(a.length).toBe(VIEW_W * VIEW_H);
    expect(new Set(a).size).toBeGreaterThan(5);
    expect(tr).toContain(9);
    const open = decodeLevel({ ...raw[0], grid: Array.from(l.grid) });
    open.grid[(py - 1) * 32 + px] = 0;
    const tr2: number[] = [];
    const b = renderView(open, tables, th, px, py, 0 as Facing, { trace: tr2 });
    expect(tr2).not.toContain(9);
    expect(b.some((v, i) => v !== a[i])).toBe(true);
  });
  it('orientation control: facing south of the same wall does not draw piece 9; backdrop parity flips with facing parity', () => {
    const l = levels[0], th = theme(l);
    let found: [number, number] | null = null;
    for (let y = 2; y < 30 && !found; y++) for (let x = 1; x < 31; x++) if (!(cellAt(l, x, y) & 1) && (cellAt(l, x, y - 1) & 1) && !(cellAt(l, x, y + 1) & 1) && !(cellAt(l, x, y + 2) & 1)) { found = [x, y]; break; }
    const [x, y] = found!;
    const n: number[] = [], s: number[] = [];
    renderView(l, tables, th, x, y, 0 as Facing, { trace: n });
    renderView(l, tables, th, x, y, 2 as Facing, { trace: s });
    expect(n).toContain(9);
    expect(s).not.toContain(9);
    expect(tables.backdropParity[0 + 0 + 4 * 0]).not.toBe(tables.backdropParity[0 + 0 + 4 * 1]);
  });
});
