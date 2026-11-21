import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stepPose, toGameFacing, toSeerFacing, decodeArea, flattenAreas } from '../games-crystaldragon.ts';
import {
  absFace, renderView, viewCells, canEnter, VIEW_W, VIEW_X0, WALL_POS,
  type CdArea, type CdSlots, type CdFacing,
} from '../../crystaldragon/amiga/view-model.ts';
import { unSA, unSF, saLeftover, tagOf } from '../../crystaldragon/amiga/codec.ts';
import { composeSet, parseSlotTable } from '../../crystaldragon/amiga/sets.ts';
import { readAreas, readExe, readPalette, readNameIds, dataDir, fileName } from '../../crystaldragon/amiga/export-walker.ts';

/** rows given north-up (first string = highest y); '#' = type-1 wall, '.' = type-0 floor */
function synth(rows: string[], x0 = 10, y0 = -5): CdArea {
  const h = rows.length, w = rows[0]!.length;
  const cells: number[] = new Array(w * h);
  rows.forEach((r, i) => [...r].forEach((c, x) => { cells[(h - 1 - i) * w + x] = c === '#' ? 1 : 0; }));
  return { id: 0, x0, y0, w, h, cells };
}

describe('Crystal Dragon movement / collision (synthetic)', () => {
  //            x: 10 11 12 13 14
  const a = synth([
    '#####', // y -1
    '#...#', // y -2
    '#.#.#', // y -3
    '#...#', // y -4
    '#####', // y -5
  ]);
  it('facing 0 = N moves +y, 2 = E moves +x; walls block', () => {
    expect(stepPose(a, { x: 11, y: -4, facing: 0 }, 'fwd')).toEqual({ x: 11, y: -3, facing: 0 });
    expect(stepPose(a, { x: 11, y: -2, facing: 0 }, 'fwd')).toBeNull();
    expect(stepPose(a, { x: 11, y: -4, facing: 2 }, 'fwd')).toEqual({ x: 12, y: -4, facing: 2 });
    expect(stepPose(a, { x: 11, y: -4, facing: 1 }, 'fwd')).toBeNull(); // S is -y: wall row
    expect(stepPose(a, { x: 11, y: -3, facing: 2 }, 'fwd')).toBeNull(); // pillar of wall at (12,-3)
  });
  it('turns follow N -> E -> S -> W; strafes use the view builder\'s left vector', () => {
    expect(stepPose(a, { x: 11, y: -4, facing: 0 }, 'turnR')!.facing).toBe(2);
    expect(stepPose(a, { x: 11, y: -4, facing: 2 }, 'turnR')!.facing).toBe(1);
    expect(stepPose(a, { x: 11, y: -4, facing: 1 }, 'turnR')!.facing).toBe(3);
    expect(stepPose(a, { x: 11, y: -4, facing: 3 }, 'turnR')!.facing).toBe(0);
    expect(stepPose(a, { x: 11, y: -4, facing: 0 }, 'turnL')!.facing).toBe(3);
    expect(stepPose(a, { x: 12, y: -4, facing: 0 }, 'left')).toEqual({ x: 11, y: -4, facing: 0 });
    expect(stepPose(a, { x: 12, y: -4, facing: 0 }, 'right')).toEqual({ x: 13, y: -4, facing: 0 });
    expect(stepPose(a, { x: 12, y: -2, facing: 2 }, 'left')).toBeNull(); // left of E is N (+y): wall
    expect(stepPose(a, { x: 12, y: -2, facing: 2 }, 'right')).toBeNull(); // (12,-3) is wall
    expect(stepPose(a, { x: 11, y: -3, facing: 0 }, 'back')).toEqual({ x: 11, y: -4, facing: 0 });
  });
  it('outside the area is solid; noclip stays inside the area', () => {
    expect(canEnter(a, 9, -4)).toBe(false);
    expect(stepPose(a, { x: 11, y: -4, facing: 0 }, 'left', true)).toEqual({ x: 10, y: -4, facing: 0 });
    expect(stepPose(a, { x: 10, y: -4, facing: 0 }, 'left', true)).toBeNull();
  });
  it('seer <-> game facing conversion is a bijection that maps E to 2', () => {
    for (let f = 0; f < 4; f++) expect(toSeerFacing(toGameFacing(f))).toBe(f);
    expect(toGameFacing(1)).toBe(2);
  });
});

describe('Crystal Dragon view geometry (synthetic)', () => {
  it('absolute face of the near/left/right sides for every facing (+0x1F988)', () => {
    // side 1 = the face toward the party, 2 = right-hand face of a left cell, 3 = left-hand face of a right cell
    expect([0, 1, 2, 3].map((f) => absFace(1, f))).toEqual([1, 0, 3, 2]);
    expect([0, 1, 2, 3].map((f) => absFace(2, f))).toEqual([2, 3, 1, 0]);
    expect([0, 1, 2, 3].map((f) => absFace(3, f))).toEqual([3, 2, 0, 1]);
  });
  it('view cells are 3 wide x 4 deep, column 0 = left', () => {
    const a = synth(['.....', '.....', '.....', '.....', '.....'], 0, 0);
    a.cells = a.cells.map((_, i) => 0x100 * i); // tag each cell with its index
    const tag = (x: number, y: number) => 0x100 * (y * 5 + x);
    const n = viewCells(a, 2, 0, 0);
    expect(n.slice(0, 3)).toEqual([tag(1, 0), tag(2, 0), tag(3, 0)]);
    expect(n[4]).toBe(tag(2, 1));
    const e = viewCells(a, 0, 2, 2); // facing E: left is +y
    expect(e[0]).toBe(tag(0, 3));
    expect(e[10]).toBe(tag(3, 2));
  });
  // one 1x1 frame per wall position: colour p+1 at x = VIEW_X0 + p, y = 0
  const probe: CdSlots = [{
    remap: false,
    table: { header: 0x100, npos: 39, sets: 1, frame: Array.from({ length: 39 }, (_, p) => p * 4), x: Array.from({ length: 39 }, (_, p) => VIEW_X0 + p), y: new Array(39).fill(0) },
    frames: Array.from({ length: 39 }, (_, p) => ({ w: 1, h: 1, stride: 1, px: new Uint8Array([p + 1]) })),
  }, null, null, null, null, null, null, null, null, null, null, null];
  const drawn = (v: Uint8Array) => Array.from({ length: 17 }, (_, p) => p).filter((p) => v[p] === p + 1);
  it('dead end: the front wall one cell ahead is position 3; null control one step back', () => {
    const a = synth(['###', '###', '#.#', '#.#'], 0, 0); // y 3..0; open (1,0),(1,1)
    const v = drawn(renderView(a, probe, 1, 1, 0));
    expect(v).toEqual(expect.arrayContaining([0, 1, 3]));
    const back = drawn(renderView(a, probe, 1, 0, 0)); // one step back: front wall is now 2 cells ahead
    expect(back).not.toContain(3);
    expect(back).toContain(8);
  });
  it('open corridor: no front face at rows 1-2, the row-3 face is drawn', () => {
    const a = synth(['###', '#.#', '#.#', '#.#'], 0, 0); // y 3..0: (1,3) wall, (1,0..2) open
    const v = drawn(renderView(a, probe, 1, 0, 0));
    expect(v).not.toContain(3);
    expect(v).not.toContain(8);
    expect(v).toContain(13);
    expect(WALL_POS[13]).toEqual([10, 1]);
  });
});

const R = resolve('public/assets/crystaldragon/amiga/walker');
const haveData = existsSync(resolve(dataDir(), 'Crystal_Dragon'));
const haveAssets = existsSync(resolve(R, 'levels.json'));

describe.skipIf(!haveData)('Crystal Dragon real data: codecs', () => {
  const files = readdirSync(dataDir()).filter((n) => /^[0-9a-f]{2,3}$/.test(n));
  it('every SA set decodes, consumes its packed stream exactly and its frames tile the output', () => {
    let n = 0;
    for (const f of files) {
      const d = new Uint8Array(readFileSync(resolve(dataDir(), f)));
      if (tagOf(d) !== 'SA') continue;
      const out = unSA(d);
      expect(saLeftover, f).toBe(0);
      expect(out.length).toBe(new DataView(d.buffer, d.byteOffset).getUint32(6));
      n++;
    }
    expect(n).toBe(86);
  });
  it('null control: a flipped byte in a packed stream breaks the exact-consumption invariant', () => {
    const d = new Uint8Array(readFileSync(resolve(dataDir(), '32')));
    d[d.length - 40] ^= 0x5a;
    const ref = unSA(new Uint8Array(readFileSync(resolve(dataDir(), '32'))));
    let changed: boolean;
    try { const o = unSA(d); changed = saLeftover !== 0 || Buffer.compare(Buffer.from(o), Buffer.from(ref)) !== 0; } catch { changed = true; }
    expect(changed).toBe(true);
  });
  it('the 23 level maps decode to 46,254 bytes and carry at least one area', () => {
    for (let L = 0; L < 23; L++) {
      const id = L * 9 + 0xcc;
      const lv = unSF(new Uint8Array(readFileSync(resolve(dataDir(), fileName(id)))));
      expect(lv.length).toBe(0xb4ae);
      expect(readAreas(lv).length).toBeGreaterThan(0);
    }
  });
  it('palette and .scr name list come from the executable', () => {
    const h = readExe();
    const pal = readPalette(h);
    expect(pal.slice(0, 8)).toEqual([0x000, 0x985, 0x874, 0x763, 0x652, 0x541, 0x430, 0x110]);
    const names = readNameIds(h);
    expect(names.get('wall1.scr')).toBe(0x32);
    expect(names.get('pillar1.scr')).toBe(0x1c);
    expect(names.get('floor1.1.scr')).toBe(0x34);
  });
  it('wall set WALL1 composes 78 frames and its slot table has 2 x 39 positions', () => {
    const fr = composeSet(unSA(new Uint8Array(readFileSync(resolve(dataDir(), '32')))));
    expect(fr.length).toBe(78);
    const t = parseSlotTable(new Uint8Array(readFileSync(resolve(dataDir(), '33'))), 39);
    expect(t.sets).toBe(2);
    expect(t.frame.length).toBe(78);
    // front wall one cell ahead (position 3): frame 3, 116x99 at (24, 7)
    expect([t.frame[3]! >> 2, t.x[3], t.y[3], fr[3]!.w, fr[3]!.h]).toEqual([3, 24, 7, 116, 99]);
  });
});

describe.skipIf(!haveAssets)('Crystal Dragon real data: exported walker', () => {
  const levels = JSON.parse(readFileSync(resolve(R, 'levels.json'), 'utf8'));
  it('23 levels, 83 areas, every start pose is walkable', () => {
    expect(levels.length).toBe(23);
    const flat = flattenAreas(levels);
    expect(flat.length).toBe(83);
    for (const lv of levels) for (const a of lv.areas) {
      const area = decodeArea(a);
      if (area.cells.some((c: number) => (c & 7) === 0)) expect(canEnter(area, a.start.x, a.start.y)).toBe(true);
    }
  });
  it('level 1 start view is not blank and changes with facing', () => {
    const lv = levels[0];
    const a = decodeArea(lv.areas[0]);
    const slots: CdSlots = lv.slots.map((s: { set: number; remap: boolean } | null) => {
      if (!s) return null;
      const j = JSON.parse(readFileSync(resolve(R, 'sets', `${s.set.toString(16)}.json`), 'utf8'));
      return { remap: s.remap, table: j.table, frames: j.frames.map((f: { w: number; h: number; stride: number; px: string }) => ({ ...f, px: new Uint8Array(Buffer.from(f.px, 'base64')) })) };
    });
    const st = lv.areas[0].start;
    const views = [0, 1, 2, 3].map((f) => renderView(a, slots, st.x, st.y, f as CdFacing));
    const nonZero = (v: Uint8Array) => v.reduce((n, c) => n + (c ? 1 : 0), 0);
    expect(nonZero(views[0]!)).toBeGreaterThan(VIEW_W * 40);
    expect(Buffer.compare(Buffer.from(views[0]!), Buffer.from(views[2]!))).not.toBe(0);
  });
});
