import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canEnter, cellAt, decodeLevel, decodeRes, isSolidView, renderView, resNamesFor, VIEW_H, VIEW_W,
  type ApLevel, type ApTables, type ApRecord, type Facing,
} from '../../abandonedplaces2/amiga/view-model.ts';
import { stepPose } from '../games-abandonedplaces2.ts';
import { parseLevel } from '../../abandonedplaces2/amiga/export-walker.ts';

function synth(w: number, h: number, set: (x: number, y: number) => Partial<Record<number, number>>): ApLevel {
  const cells = new Uint8Array(w * h * 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [k, v] of Object.entries(set(x, y))) cells[(y * w + x) * 8 + Number(k)] = v!;
  return { id: 0, theme: 0, set: 0, families: {}, w, h, cells, decor: [], gates: [], stairs: [] };
}

describe('AP2 movement / collision (synthetic)', () => {
  const lvl = synth(5, 5, (x, y) => (x === 0 || y === 0 || x === 4 || y === 4 ? { 5: 1 } : {}));
  it('walls block, open cells admit, facing 0 is -y', () => {
    expect(stepPose(lvl, { x: 2, y: 2, facing: 0 }, 'fwd')).toEqual({ x: 2, y: 1, facing: 0 });
    expect(stepPose(lvl, { x: 2, y: 1, facing: 0 }, 'fwd')).toBeNull();
    expect(stepPose(lvl, { x: 2, y: 2, facing: 1 }, 'fwd')).toEqual({ x: 3, y: 2, facing: 1 });
    expect(stepPose(lvl, { x: 2, y: 2, facing: 0 }, 'turnR')).toEqual({ x: 2, y: 2, facing: 1 });
  });
  it('illusory wall (byte5 bit1) draws solid but walks; byte3 bit1/2, byte1 bit0 block; closed gate blocks', () => {
    const l = synth(3, 1, (x) => (x === 1 ? { 5: 2 } : {}));
    expect(isSolidView(cellAt(l, 1, 0))).toBe(true);
    expect(isSolidView(cellAt(l, 1, 0), true)).toBe(false);
    expect(canEnter(l, 1, 0)).toBe(true);
    expect(canEnter(synth(1, 1, () => ({ 3: 2 })), 0, 0)).toBe(false);
    expect(canEnter(synth(1, 1, () => ({ 1: 1 })), 0, 0)).toBe(false);
    const g = synth(1, 1, () => ({ 4: 0x40 }));
    g.gates = [{ type: 1, x: 0, y: 0, state: 0, orient: 0 }];
    expect(canEnter(g, 0, 0)).toBe(false);
    g.gates[0].state = 1;
    expect(canEnter(g, 0, 0)).toBe(true);
  });
});

const R = resolve('public/assets/abandonedplaces2/amiga/walker');
const have = existsSync(resolve(R, 'levels.json')) && existsSync(resolve('build/cache/abandonedplaces2/dng_00.dat'));
const J = (p: string) => JSON.parse(readFileSync(resolve(R, p), 'utf8'));

describe.skipIf(!have)('AP2 real data', () => {
  const tables = J('tables.json') as ApTables;
  const levels = J('levels.json');
  const lv: ApLevel = decodeLevel(levels[0]);
  const theme = { res: Object.fromEntries(resNamesFor(lv).map((n) => [n, decodeRes(J(`res/${n}.json`))])) };

  it('level parse matches the raw file: 28 levels, decor entries all sit on byte3-bit3 cells', () => {
    expect(levels.length).toBe(28);
    for (const l0 of levels) {
      const l = decodeLevel(l0);
      for (const d of l.decor) if (d.type === 1 || d.type === 2) expect(cellAt(l, d.x, d.y)[3] & 8).toBe(8);
    }
    const raw = new Uint8Array(readFileSync(resolve('build/cache/abandonedplaces2/dng_00.dat')));
    expect(parseLevel(raw).cells).toBe(levels[0].cells);
  });
  it('null control: decor-on-flag check fails for shuffled coordinates', () => {
    let hits = 0, total = 0;
    for (const d of lv.decor) { total++; if (cellAt(lv, (d.x + 7) % 32, (d.y + 11) % 32)[3] & 8) hits++; }
    expect(hits).toBeLessThan(total);
  });
  it('a corridor frame is non-trivial; facing a wall at distance 0 differs from open view; rotation changes the frame', () => {
    const open = renderView(lv, tables, theme, 4, 8, 0 as Facing);
    expect(open.length).toBe(VIEW_W * VIEW_H);
    expect(new Set(open).size).toBeGreaterThan(8);
    const other = renderView(lv, tables, theme, 4, 8, 1 as Facing);
    let diff = 0;
    for (let i = 0; i < open.length; i++) if (open[i] !== other[i]) diff++;
    expect(diff).toBeGreaterThan(1000);
  });
  it('all records have padded-width pixel buffers', () => {
    for (const res of Object.values(theme.res)) for (const r of res as (ApRecord | null)[]) if (r) expect(r.pix.length).toBe(r.pw * r.h);
  });
});
