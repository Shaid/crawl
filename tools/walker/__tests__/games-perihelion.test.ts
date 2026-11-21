import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  step, toggleDoor, windowOf, farCalls, nearCalls, renderView, blocks, toSeerFacing, toGameFacing,
  VIEW_W, VIEW_H, type PeriMap, type GameFacing, type ViewData,
} from '../../perihelion/amiga/view-model.ts';
import { MainProgram, readDungeons, readPalette, decodeLeaf, dataDir } from '../../perihelion/amiga/exe.ts';
import { buildWalker } from '../../perihelion/amiga/export-walker.ts';

/** rows top (y = 0) first; '#' 1 wall, '.' 0 floor, '+' 2 closed door, digits literal */
function synth(rows: string[]): PeriMap {
  const width = rows[0]!.length, height = rows.length;
  const cells: number[] = [];
  for (const r of rows) for (const c of r) cells.push(c === '#' ? 1 : c === '.' ? 0 : c === '+' ? 2 : Number(c));
  return { width, height, cells };
}

describe('Perihelion movement / collision (synthetic)', () => {
  const m = synth([
    '#####',
    '#...#',
    '#.#+#',
    '#..4#',
    '##6##',
  ]);
  it('facing 0 moves +y, 1 -x, 2 -y, 3 +x; walls and closed doors block', () => {
    expect(step(m, 2, { x: 1, y: 1, facing: 0 }, 'fwd', null).pose).toEqual({ x: 1, y: 2, facing: 0 });
    expect(step(m, 2, { x: 2, y: 1, facing: 1 }, 'fwd', null).pose).toEqual({ x: 1, y: 1, facing: 1 });
    expect(step(m, 2, { x: 1, y: 2, facing: 2 }, 'fwd', null).pose).toEqual({ x: 1, y: 1, facing: 2 });
    expect(step(m, 2, { x: 1, y: 1, facing: 3 }, 'fwd', null).pose).toEqual({ x: 2, y: 1, facing: 3 });
    expect(step(m, 2, { x: 2, y: 1, facing: 0 }, 'fwd', null).pose).toBeNull(); // wall (2,2)
    expect(step(m, 2, { x: 3, y: 1, facing: 0 }, 'fwd', null).pose).toBeNull(); // closed door (3,2)
  });
  it('turns: q = facing-1, e = facing+1; strafes: d = facing+1 direction, a = facing+3', () => {
    expect(step(m, 2, { x: 1, y: 1, facing: 0 }, 'turnR', null).pose!.facing).toBe(1);
    expect(step(m, 2, { x: 1, y: 1, facing: 0 }, 'turnL', null).pose!.facing).toBe(3);
    // facing 0 (+y): right ('d') is -x, left ('a') is +x
    expect(step(m, 2, { x: 2, y: 1, facing: 0 }, 'right', null).pose).toEqual({ x: 1, y: 1, facing: 0 });
    expect(step(m, 2, { x: 2, y: 1, facing: 0 }, 'left', null).pose).toEqual({ x: 3, y: 1, facing: 0 });
    expect(step(m, 2, { x: 1, y: 2, facing: 0 }, 'back', null).pose).toEqual({ x: 1, y: 1, facing: 0 });
  });
  it('ladders (4/5) block only in dungeon 4; exits (6) are refused with a message', () => {
    expect(step(m, 2, { x: 2, y: 3, facing: 3 }, 'fwd', null).pose).toEqual({ x: 3, y: 3, facing: 3 });
    expect(step(m, 4, { x: 2, y: 3, facing: 3 }, 'fwd', null).pose).toBeNull();
    const r = step(m, 2, { x: 2, y: 3, facing: 0 }, 'fwd', null);
    expect(r.pose).toBeNull();
    expect(r.message).toMatch(/exit/);
    expect(blocks(1, 4)).toBe(false);
  });
  it('dungeon 1 doorway (3): w/a/d refused, s returns to the previous square', () => {
    const c = synth(['#####', '#.3.#', '#####']);
    expect(step(c, 1, { x: 2, y: 1, facing: 3 }, 'fwd', { x: 1, y: 1 }).pose).toBeNull();
    expect(step(c, 1, { x: 2, y: 1, facing: 3 }, 'back', { x: 1, y: 1 }).pose).toEqual({ x: 1, y: 1, facing: 3 });
    // a 3 elsewhere is an open door you walk through
    expect(step(c, 2, { x: 2, y: 1, facing: 3 }, 'fwd', { x: 1, y: 1 }).pose).toEqual({ x: 3, y: 1, facing: 3 });
  });
  it('use toggles the door ahead 2 <-> 3 and nothing else', () => {
    const c = synth(['#+.']);
    expect(toggleDoor(c, { x: 2, y: 0, facing: 1 })).toBe(true);
    expect(c.cells[1]).toBe(3);
    expect(toggleDoor(c, { x: 2, y: 0, facing: 1 })).toBe(true);
    expect(c.cells[1]).toBe(2);
    expect(toggleDoor(c, { x: 1, y: 0, facing: 1 })).toBe(false); // wall ahead
  });
  it('seer <-> game facing: game 0 (+y) is south, 2 (-y) north; bijection', () => {
    for (let f = 0; f < 4; f++) expect(toSeerFacing(toGameFacing(f))).toBe(f);
    expect(toSeerFacing(0)).toBe(2);
    expect(toSeerFacing(3)).toBe(1); // +x = east
  });
});

describe('Perihelion view window and composers (synthetic)', () => {
  // x:   0123456
  const m = synth([
    '#######', // y0
    '#..1..#', // y1
    '#.....#', // y2
    '#.2.3.#', // y3
    '#.....#', // y4
    '#######', // y5
  ]);
  it('window +7 is forward and +1 is LEFT for every facing (a mirrored variant fails)', () => {
    // party at (3,4) facing 2 (-y): ahead (3,3) = '.', left (-x) = (2,4) '.', two ahead-left (2,3) = 2
    const w = windowOf(m, 3, 4, 2);
    expect(w(7)).toBe(0);
    expect(w(14)).toBe(0);
    expect(w(21)).toBe(1);   // (3,1)
    expect(w(8)).toBe(2);    // (2,3) closed door ahead-left
    expect(w(6)).toBe(3);    // (4,3) open door ahead-right
    // facing 0 (+y) from (3,2): left is +x
    const s = windowOf(m, 3, 2, 0);
    expect(s(8)).toBe(3);    // (4,3)
    expect(s(6)).toBe(2);    // (2,3)
    expect(s(1)).toBe(0);
    expect(windowOf(m, 0, 0, 0)(-1)).toBe(1); // outside the grid reads as wall
  });
  it('far composer: a wall one ahead hides everything behind it; open corridor draws deeper rows', () => {
    const wall = (o: number) => (o === 7 ? 1 : 0);
    const calls = farCalls(wall);
    expect(calls).toContain(0xc3c14);                // front wall, row 1
    expect(calls).not.toContain(0xc3ce6);            // row 2 front never gathered
    const open = (o: number) => (o === 21 ? 1 : 0);
    const deep = farCalls(open);
    expect(deep).toContain(0xc3dfe);                 // front wall, row 3
    expect(deep).not.toContain(0xc3c14);
    expect(deep[0]).toBe(-1);                        // background first
  });
  it('far composer: door types pick door leaves; side walls only for type 1', () => {
    expect(farCalls((o) => (o === 7 ? 2 : 0))).toContain(0xc3f3c);
    expect(farCalls((o) => (o === 7 ? 3 : 0))).toContain(0xc4154);
    expect(farCalls((o) => (o === 1 ? 1 : 0))).toContain(0xc3a2a);
    expect(farCalls((o) => (o === 1 ? 2 : 0))).not.toContain(0xc3a2a);
  });
  it('near composer: standing in a doorway shows only the interior picture', () => {
    expect(nearCalls((o) => (o === 0 ? 3 : 0), false)).toEqual([0xc3960]);
    expect(nearCalls(() => 0, true)).toContain(0xc3564);
    expect(nearCalls(() => 0, false)).toContain(0xc35aa);
  });
});

const HAVE_DATA = existsSync(resolve(dataDir(), '000316B00105D570'));

describe.skipIf(!HAVE_DATA)('Perihelion real data', () => {
  const p = HAVE_DATA ? MainProgram.load() : null!;
  it('image is loaded at $80000: entry JMP $B7454 lands on MOVE.L #$B74D8,$80', () => {
    expect(p.u16(0x80000)).toBe(0x4ef9);
    expect(p.u32(0x80002)).toBe(0xb7454);
    expect(p.u16(0xb7454)).toBe(0x21fc);
    expect(p.u32(0xb7456)).toBe(0xb74d8);
  });
  it('five grids fill their spans exactly; starts are open floor with a wall-free square ahead', () => {
    const ds = readDungeons(p);
    expect(ds.map((d) => [d.width, d.height])).toEqual([[20, 20], [32, 44], [30, 27], [20, 22], [30, 32]]);
    for (const d of ds) {
      const m = { width: d.width, height: d.height, cells: d.cells };
      expect(m.cells[d.start.y * d.width + d.start.x]).toBe(0);
      expect(step(m, d.index, { ...d.start, facing: d.start.facing as GameFacing }, 'fwd', null).pose).not.toBeNull();
      // control: the same start with the facing reversed walks into the exit side (blocked)
      const back = step(m, d.index, { ...d.start, facing: ((d.start.facing + 2) & 3) as GameFacing }, 'fwd', null);
      expect(back.pose).toBeNull();
      expect(d.cells.every((v) => v <= 6)).toBe(true);
    }
  });
  it('palette at $E7BDE starts black / white', () => {
    const pal = readPalette(p);
    expect(pal[0]).toBe(0x000);
    expect(pal[1]).toBe(0xfff);
  });
  it('leaf decoder: the closed-door leaf $C3F3C draws frame + door, stepping over its blitter save', () => {
    expect(decodeLeaf(p, 0xc3f3c, 0)).toEqual([[12, 10, 0, 1], [15, 21, 0, 1]]);
    expect(decodeLeaf(p, 0xc3c14, 1)).toEqual([[7, 10, 1, 1]]); // parity flips the front wall
    expect(() => decodeLeaf(p, 0xc2a2e, 0)).toThrow(); // the view entry is not a leaf
  });
  it('rendered start views are not blank and differ from the mirrored-window control', () => {
    const { json, atlases } = buildWalker();
    for (const d of json.dungeons) {
      const v: ViewData = { kind: d.kind, atlas: { w: d.atlas.w, h: d.atlas.h, px: atlases.get(d.index)! }, composer: json.composers[d.kind], leaves: json.leaves };
      const m: PeriMap = { width: d.width, height: d.height, cells: d.cells };
      const px = renderView(m, v, d.start.x, d.start.y, d.start.facing as GameFacing);
      expect(px.length).toBe(VIEW_W * VIEW_H);
      expect(new Set(px).size).toBeGreaterThan(8);
      const turned = renderView(m, v, d.start.x, d.start.y, ((d.start.facing + 1) & 3) as GameFacing);
      let diff = 0;
      for (let i = 0; i < px.length; i++) if (px[i] !== turned[i]) diff++;
      expect(diff).toBeGreaterThan(px.length / 10);
    }
  });
});
