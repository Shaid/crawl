import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canEnter, cellAt, decodeLevel, decodeRes, isSolidView, renderView, resNamesFor, VIEW_H, VIEW_W,
  type ApLevel, type ApTables, type ApRecord, type Facing,
} from '../../abandonedplaces2/amiga/view-model.ts';
import { stepPose } from '../games-abandonedplaces2.ts';
import { parseLevel } from '../../abandonedplaces2/amiga/export-walker.ts';
import { halfBright, planeMapFor, screenPalette, toScreenIndex } from '../../abandonedplaces2/amiga/screen-palette.ts';

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
  it('nearest front wall (level 0 at 16,12 facing N; wall at 16,11) is one coherent flipped wl record, not scrambled', () => {
    const px = renderView(lv, tables, theme, 16, 12, 0 as Facing);
    const r = theme.res.wl_00![0]!;
    // slot 33 = kind 2, id1=id2=0, parity (16^11)&1 = 1 -> flipped; flipped x = 26 - 0 + 140 - 144 = 22, content starts at 26
    const score = (flip: boolean, shift: number) => {
      let m = 0, n = 0;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.pw; x++) {
        const v = r.pix[y * r.pw + (flip ? r.pw - 1 - x : x)];
        if (v === 255) continue;
        n++;
        if (px[(8 + y) * VIEW_W + 22 + shift + x] === v) m++;
      }
      return m / n;
    };
    expect(score(true, 0)).toBe(1);
    expect(score(false, 0)).toBeLessThan(0.5); // null control: unflipped / wrong orientation collapses
    expect(score(true, 7)).toBeLessThan(0.5); // null control: wrong x offset
  });
  it('another level: nearest wall at level 2 also draws record 0 at the expected slot', () => {
    const l2 = decodeLevel(levels[2]);
    const th2 = { res: Object.fromEntries(resNamesFor(l2).map((n) => [n, decodeRes(J(`res/${n}.json`))])) };
    let found: [number, number] | null = null;
    for (let y = 2; y < 30 && !found; y++) for (let x = 2; x < 30 && !found; x++) {
      if (!(cellAt(l2, x, y)[5] & 3) && (cellAt(l2, x, y - 1)[5] & 1) && !(cellAt(l2, x, y)[3] & 8) && !(cellAt(l2, x, y - 1)[3] & 8) && !(cellAt(l2, x - 1, y - 1)[5] & 0) ) found = [x, y];
    }
    expect(found).not.toBeNull();
    const [x, y] = found!;
    const px = renderView(l2, tables, th2, x, y, 0 as Facing);
    const r = th2.res[l2.families.wl!]![0]!;
    const par = (x ^ (y - 1)) & 1; // id1 == id2 == 0: parity 1 flips
    let m = 0, n = 0;
    for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.pw; xx++) {
      const v = r.pix[yy * r.pw + (par ? r.pw - 1 - xx : xx)];
      if (v === 255) continue;
      n++;
      if (px[(8 + yy) * VIEW_W + (par ? 22 : 26) + xx] === v) m++;
    }
    expect(m / n).toBeGreaterThan(0.99);
  });
  it('level 13 black band is the fl horizon void (rows 38-63 of every fl image), visible only when no wall is within 4 cells', () => {
    const l13 = decodeLevel(levels[13]);
    const th = { res: Object.fromEntries(resNamesFor(l13).map((n) => [n, decodeRes(J(`res/${n}.json`))])) };
    const open = renderView(l13, tables, th, 16, 17, 0 as Facing); // column x=16, y=10..17 all open
    for (let yy = 38; yy <= 63; yy++) expect(open[yy * VIEW_W + 96]).toBe(0);
    for (const fl of ['fl_00', 'fl_03', 'fl_06'] as const) {
      const rr = (fl === 'fl_06' ? th.res.fl_06 : decodeRes(J(`res/${fl}.json`)))![0]!;
      expect(rr.pix[50 * rr.pw + 96]).toBe(0); // the band is in the shipped art itself
    }
    // a wall within range covers the band (fails if the renderer dropped far-wall pieces)
    const cells = Uint8Array.from(l13.cells);
    cells[(15 * l13.w + 16) * 8 + 5] = 1; // wall 2 cells ahead of (16,17)
    const walled = renderView({ ...l13, cells }, tables, th, 16, 17, 0 as Facing);
    expect(Array.from({ length: 26 }, (_, i) => walled[(38 + i) * VIEW_W + 96]).filter((v) => v !== 0).length).toBeGreaterThan(20);
  });
});

describe('AP2 screen palette: plane remap + EHB (spec §5.1)', () => {
  it('desc 4 sends image plane 3 to the EHB plane; desc 8/9 send plane 4 there', () => {
    expect(toScreenIndex(12, 'desc4')).toBe(32 + 4);
    expect(toScreenIndex(14, 'desc4')).toBe(32 + 6);
    expect(toScreenIndex(7, 'desc4')).toBe(7);
    expect(toScreenIndex(22, 'desc8')).toBe(32 + 6);
    expect(toScreenIndex(12, 'desc8')).toBe(12);
    expect(toScreenIndex(22, 'identity')).toBe(22);
    expect(planeMapFor('wl_00')).toBe('desc4');
    expect(planeMapFor('mon_17')).toBe('desc8');
    expect(planeMapFor('items')).toBe('identity');
  });
  it('64-entry palette: set 0-15, display 16-31, half-bright on the nibble', () => {
    const c = (n: number) => ({ r: ((n >> 8) & 15) * 17, g: ((n >> 4) & 15) * 17, b: (n & 15) * 17 });
    const set = Array.from({ length: 32 }, (_, i) => c(i === 5 ? 0x777 : 0x111 * (i & 15)));
    const disp = Array.from({ length: 32 }, () => c(0xf00));
    const p = screenPalette(set, disp);
    expect(p.length).toBe(64);
    expect(p[5]).toEqual(c(0x777));
    expect(p[16]).toEqual(c(0xf00)); // set_NN[16..31] never reaches the screen
    expect(p[32 + 5]).toEqual(c(0x333)); // 7>>1 = 3, not round(0x77/2)
    expect(halfBright(c(0xf00))).toEqual(c(0x700));
  });
});

const MAIN = resolve('build/cache/abandonedplaces2/main');
describe.skipIf(!have || !existsSync(MAIN))('AP2 screen palette (real data)', () => {
  const main = new Uint8Array(readFileSync(MAIN)).subarray(0x20);
  const hex = (a: number, n: number) => Buffer.from(main.subarray(a, a + n)).toString('hex');
  it('main carries the facts the remap rests on', () => {
    expect(hex(0x14e90, 4)).toBe('01006200'); // copper BPLCON0: 6 planes, no HAM/DPF = EHB
    expect(hex(0x3a8c, 16)).toBe('2028000c222800142141000c21400014'); // desc 4: swap plane ptr 3 <-> 5
    expect(hex(0x3aec, 16)).toBe('20280010222800142141001021400014'); // desc 8: swap 4 <-> 5
    expect(hex(0x3b4c, 16)).toBe('20280010222800142141001021400014'); // desc 9: swap 4 <-> 5
    expect(hex(0x47e4, 12)).toBe('207a0b5c227a0b5c303c000f'); // $5342 -> $5346, 16 words only
  });
  it('level 0 corridor has no lime/teal speckle; the old raw set_00 lookup would (null control)', () => {
    const levels = J('levels.json');
    const lv = decodeLevel(levels[0]);
    const th = { res: Object.fromEntries(resNamesFor(lv).map((n) => [n, decodeRes(J(`res/${n}.json`))])) };
    const pal = J('pal/set_00.json') as [number, number, number][];
    expect(pal.length).toBe(64);
    const px = renderView(lv, J('tables.json'), th, 2, 1, 1 as Facing);
    const greenish = ([r, g, b]: [number, number, number]) => g - r > 40 && g >= b;
    const share = (look: (v: number) => [number, number, number]) => Array.from(px).filter((v) => greenish(look(v))).length / px.length;
    expect(share((v) => pal[v])).toBe(0);
    // Undo the desc-4 remap and look the image value up in raw set_00.clr, as the old exporter did.
    const raw = new Uint8Array(readFileSync(resolve('build/cache/abandonedplaces2/set_00.clr')));
    const rawPal = Array.from({ length: 32 }, (_, i) => {
      const w = (raw[i * 2] << 8) | raw[i * 2 + 1];
      return [((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17] as [number, number, number];
    });
    const unmap = (v: number) => (v & 7) | (v & 32 ? 8 : 0) | (v & 16);
    expect(share((v) => rawPal[unmap(v)])).toBeGreaterThan(0.1);
  });
});
