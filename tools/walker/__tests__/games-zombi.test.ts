/**
 * Zombi walker: the movement rule (`tools/zombi/amiga/map.ts`, mirrors the
 * executable's `move()` at `zombi` S_0 +0x6254) on synthetic data, the
 * view's blit placement and click rectangles, and real-data invariants that
 * skip cleanly when `data/` is absent.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMap, moveArrow, moveVertical, type LieuxRecord, type ZombiMap, ARROW_DELTA, ARROW_EXIT_BYTE, type Arrow } from '../../zombi/amiga/map.ts';
import { buildZombiMap } from '../../zombi/amiga/export-map.ts';
import { ZombiView, ARROW_RECTS, PICTURE_X, PICTURE_Y, startPose, START_LOCATION_ID } from '../games-zombi.ts';

const OPEN = 0x00;
const WALL = 0x0a;
function rec(id: number, exits: number[]): LieuxRecord {
  return { id, exits, b6: 0, flags: 0, pictureOverride: 0, slots: new Array(40).fill(0xff) };
}
/** 2 floors, 3x3: ids 1..3 floor 0 row 1; id 4 on floor 1 above id 2. */
function synth(): ZombiMap {
  const e = (b0: number, b1: number, b2: number, b3: number, down = WALL, up = WALL) => [b0, b1, b2, b3, down, up];
  const recs = [
    rec(1, e(WALL, OPEN, WALL, WALL)),
    rec(2, e(WALL, OPEN, WALL, OPEN, WALL, OPEN)), // top blocked + up open: stairs
    rec(3, e(WALL, 0xfe, WALL, OPEN)),
    rec(4, e(WALL, WALL, WALL, WALL, OPEN, WALL)),
  ];
  const empty = () => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const f0 = empty(); f0[1] = [1, 2, 3];
  const f1 = empty(); f1[1][1] = 4;
  return buildMap([f0, f1], recs, (id) => ({ frame: id - 1, ox: 0, oy: 0 }));
}

describe('moveArrow (the game\'s move())', () => {
  const m = synth();
  it('right = col+1 through exit byte 1; left = col-1 through byte 3', () => {
    const r = moveArrow(m, { level: 0, x: 0, y: 1 }, 'right');
    expect(r.ok && r.to).toEqual({ level: 0, x: 1, y: 1 });
    const l = moveArrow(m, { level: 0, x: 1, y: 1 }, 'left');
    expect(l.ok && l.to).toEqual({ level: 0, x: 0, y: 1 });
  });
  it('a blocked side exit does not move and has no vertical fallback', () => {
    const r = moveArrow(m, { level: 0, x: 0, y: 1 }, 'left');
    expect(r).toMatchObject({ ok: false, reason: 'blocked' });
  });
  it('blocked top falls back to floor+1 (byte 5); blocked bottom to floor-1 (byte 4)', () => {
    const up = moveArrow(m, { level: 0, x: 1, y: 1 }, 'top');
    expect(up).toMatchObject({ ok: true, to: { level: 1, x: 1, y: 1 }, via: 'up', fellBackVertical: true });
    const down = moveArrow(m, { level: 1, x: 1, y: 1 }, 'bottom');
    expect(down).toMatchObject({ ok: true, to: { level: 0, x: 1, y: 1 }, via: 'down' });
  });
  it('no fallback where the vertical byte is blocked', () => {
    expect(moveArrow(m, { level: 0, x: 0, y: 1 }, 'top')).toMatchObject({ ok: false });
  });
  it('0xFE is an edge event, not a fallback', () => {
    expect(moveArrow(m, { level: 0, x: 2, y: 1 }, 'right')).toMatchObject({ ok: false, reason: 'edge', value: 0xfe });
  });
  it('noclip moves to the geometric neighbour only if a cell exists', () => {
    expect(moveArrow(m, { level: 0, x: 0, y: 1 }, 'left', true)).toMatchObject({ ok: false, reason: 'no-cell' });
    expect(moveArrow(m, { level: 0, x: 0, y: 1 }, 'top', true)).toMatchObject({ ok: false, reason: 'no-cell' });
    const r = moveArrow(m, { level: 0, x: 1, y: 1 }, 'left', true);
    expect(r.ok && r.to.x).toBe(0);
  });
  it('0x14 (door) moves like 0x00', () => {
    const m2 = synth();
    m2.levels[0].cells[1 * 3 + 0]!.faces.e = { raw: 0x14, kind: 'door' };
    expect(moveArrow(m2, { level: 0, x: 0, y: 1 }, 'right').ok).toBe(true);
  });
  it('moveVertical needs the same (row, col) cell on the other floor', () => {
    expect(moveVertical(m, { level: 0, x: 1, y: 1 }, 'up').ok).toBe(true);
    expect(moveVertical(m, { level: 0, x: 0, y: 1 }, 'up')).toMatchObject({ ok: false });
  });
});

describe('ZombiView', () => {
  const m = synth();
  const mkView = () => new ZombiView(m, [0, 1, 2, 3].map((i) => ({ name: `${i}`, x: i * 160, y: 0, w: 160, h: 80 })), { screen: 'S' as unknown as CanvasImageSource, lieux: 'L' as unknown as CanvasImageSource }, { level: 0, x: 1, y: 1, facing: 0 });
  it('draws the UI frame at 0,0 and the picture at (8,48)', () => {
    const calls: unknown[][] = [];
    const ctx = { canvas: { width: 0, height: 0 }, fillRect() {}, drawImage: (...a: unknown[]) => calls.push(a), set fillStyle(_v: string) {}, set imageSmoothingEnabled(_v: boolean) {} } as unknown as CanvasRenderingContext2D;
    mkView().renderCanvas(ctx);
    expect(calls[0]).toEqual(['S', 0, 0]);
    expect(calls[1]).toEqual(['L', 160, 0, 160, 80, PICTURE_X, PICTURE_Y, 160, 80]); // id 2 -> frame 1
    expect(PICTURE_X).toBe(8);
    expect(PICTURE_Y).toBe(48);
  });
  it('clicking the arrow rectangles moves; clicking elsewhere does nothing', () => {
    const v = mkView();
    v.pick(3, 90); // left arrow
    expect(v.pose).toMatchObject({ x: 0, y: 1, facing: 3 });
    v.pick(160, 100); // viewport interior
    expect(v.pose).toMatchObject({ x: 0, y: 1 });
  });
  it('a floor change is surfaced through takeLevelChange', () => {
    const v = mkView();
    v.pick(88, 43); // top arrow -> blocked -> stairs up
    expect(v.pose.level).toBe(1);
    expect(v.takeLevelChange()).toMatchObject({ level: 1 });
    expect(v.takeLevelChange()).toBeNull();
    expect(v.takeMessage()).toMatch(/stairs/);
  });
  it('keys: W = top arrow, D = right arrow', () => {
    const v = mkView();
    const p = v.update(200, { isDown: (c: string) => c === 'KeyD' });
    expect(p).toMatchObject({ x: 2, y: 1, facing: 1 });
  });
});

const DATA = resolve('data/zombi/amiga/data/plan');
describe('real data: plan + i-lieux', { skip: !existsSync(DATA) }, () => {
  const map = buildZombiMap(resolve('data/zombi/amiga/data'));
  const cells: Array<{ level: number; x: number; y: number; id: number }> = [];
  for (const l of map.levels) l.cells.forEach((c, i) => c && cells.push({ level: l.id, x: i % l.width, y: Math.floor(i / l.width), id: c.id }));
  const arrows: Arrow[] = ['top', 'right', 'bottom', 'left'];

  it('86 placed cells, ids 1..86 once each', () => {
    expect(cells.length).toBe(86);
    expect(new Set(cells.map((c) => c.id)).size).toBe(86);
  });

  /** Count open exits that land on an occupied cell, under an arbitrary arrow->(exit byte, delta) assignment. */
  function landing(byteFor: (a: Arrow) => number, deltaFor: (a: Arrow) => [number, number]): { open: number; land: number } {
    let open = 0, land = 0;
    for (const c of cells) {
      const cell = map.levels[c.level].cells[c.y * 8 + c.x]!;
      for (const a of arrows) {
        const raw = [cell.faces.s.raw, cell.faces.e.raw, cell.faces.n.raw, cell.faces.w.raw][byteFor(a)];
        if (raw !== 0 && raw !== 0x14) continue;
        open++;
        const [dr, dc] = deltaFor(a);
        if (map.levels[c.level].cells[(c.y + dr) * 8 + c.x + dc]) land++;
      }
    }
    return { open, land };
  }
  it('every open horizontal exit lands on an occupied cell (162/162) — confirmed orientation', () => {
    const r = landing((a) => ARROW_EXIT_BYTE[a], (a) => ARROW_DELTA[a]);
    expect(r.open).toBe(162);
    expect(r.land).toBe(162);
  });
  it('null control: a wrong orientation (bytes 0/2 swapped relative to rows) loses landings', () => {
    const swap = (a: Arrow): Arrow => (a === 'top' ? 'bottom' : a === 'bottom' ? 'top' : a);
    const r = landing((a) => ARROW_EXIT_BYTE[swap(a)], (a) => ARROW_DELTA[a]);
    expect(r.land).toBeLessThan(r.open);
  });
  it('vertical links join the same (row, col) on adjacent floors, reciprocally', () => {
    let links = 0;
    for (const c of cells) {
      for (const dir of ['up', 'down'] as const) {
        const o = moveVertical(map, c, dir);
        if (!o.ok) continue;
        links++;
        const back = moveVertical(map, o.to, dir === 'up' ? 'down' : 'up');
        expect(back.ok && back.to).toEqual({ level: c.level, x: c.x, y: c.y });
      }
    }
    expect(links).toBeGreaterThanOrEqual(8); // 1<->18 and the 25/45/57/60/61 shaft: 6 links x 2 directions = 12
  });
  it('the party starts in the helicopter (id 62) on the roof', () => {
    const sp = startPose(map);
    expect(map.levels[sp.level].cells[sp.y * 8 + sp.x]!.id).toBe(START_LOCATION_ID);
    expect(sp.level).toBe(5);
  });
  it('every picture frame is a valid LIEUX frame (0..81)', () => {
    for (const c of cells) {
      const cell = map.levels[c.level].cells[c.y * 8 + c.x]!;
      expect(cell.picture.frame).toBeGreaterThanOrEqual(0);
      expect(cell.picture.frame).toBeLessThan(82);
    }
  });
  it('rect table is the arrow geometry (rect centres: top above, bottom below, left/right at the sides)', () => {
    const c = (a: Arrow) => { const [x0, y0, x1, y1] = ARROW_RECTS[a]; return [(x0 + x1) / 2, (y0 + y1) / 2]; };
    expect(c('top')[1]).toBeLessThan(c('bottom')[1]);
    expect(c('left')[0]).toBeLessThan(c('right')[0]);
  });
});
