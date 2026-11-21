/**
 * Elvira II super-room mazes (items 744 / 760): the extended script ops on
 * synthetic data, the grid/numbering oracles on the real database (each with a
 * wrong-variant null control), and cross-world movement in the view. Real-data
 * blocks skip when `data/elvira2` is absent.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRoomSubroutine, gridDoorState, type RoomEvalEnv, type SuperRoomGrid } from '../../waxworks/amiga/room-script.ts';
import { BACK_DIR, readGamePc, readGrammarFromExe, readSubroutineBlock, type Operand, type ScriptOp, type Subroutine } from '../../shared/agos-gamepc.ts';
import { buildMaze } from '../../waxworks/amiga/export-maze.ts';
import { ELVIRA2_SPEC } from '../../elvira2/amiga/export-maze.ts';
import { cellId, findMazeRoomLinks, superRoomsOf, superRoomPictureFor } from '../../elvira2/amiga/superrooms.ts';
import { WaxworksView, takeArrival } from '../games-waxworks.ts';
import type { MazeFile } from '../../waxworks/amiga/maze-map.ts';

const w = (v: number): Operand => ({ k: 'w', v });
const b = (v: number): Operand => ({ k: 'b', v });
const i = (v: number): Operand => ({ k: 'i', v });
const op = (o: number, ...args: Operand[]): ScriptOp => ({ op: o, args });
const sub = (id: number, ...lines: ScriptOp[][]): Subroutine => ({ id, lines: lines.map((ops) => ({ ops })) });

describe('super-room ops (synthetic)', () => {
  // 3x1x1 grid, cell numbers 1..3 (1-based): cell 1 open E, cell 2 open W+E, cell 3 open W (state 1)
  const grid: SuperRoomGrid = { x: 3, y: 1, z: 1, states: [1 << 2, (1 << 2) | (1 << 6), 1 << 6] };
  const env = (subs: Subroutine[], pos: number, facing: number): RoomEvalEnv => ({
    items: new Map(), vars: new Map([[150, facing], [0, pos]]), bits: new Set(), bits2: new Set(),
    sr: { current: 744, grids: new Map([[744, grid]]), pos, subs: new Map(subs.map((s) => [s.id, s])), depth: 0 },
  });
  it('door state lookup is 1-based and 0 outside the grid', () => {
    expect(gridDoorState(grid, 1, 1)).toBe(1);
    expect(gridDoorState(grid, 1, 3)).toBe(0);
    expect(gridDoorState(grid, 3, 3)).toBe(1);
    expect(gridDoorState(grid, 0, 1)).toBe(0);
    expect(gridDoorState(grid, 4, 1)).toBe(0);
  });
  it('171 is a condition on the open door, 36 copies a -> b, 71 calls, 165/166 move the cell', () => {
    // picture 100 only if the cell has an open exit in the direction held by v150 (facing)
    const main = sub(1, [op(171, i(744), w(30000), b(0xff96)), op(96, w(100), b(4))]);
    const e1 = env([main], 1, 1);
    expect(runRoomSubroutine(main, e1).pictures.map((p) => p.id)).toEqual([100]);
    expect(runRoomSubroutine(main, env([main], 1, 3)).pictures).toEqual([]); // wall to the west: the line aborts (null control)
    // 36 b150 b6 ; 43 b6 1 ; picture var6 (= facing + 1)
    const turn = sub(2, [op(36, b(150), b(6)), op(43, b(6), w(1)), op(96, w(30006), b(4))]);
    expect(runRoomSubroutine(turn, env([turn], 1, 2)).pictures.map((p) => p.id)).toEqual([3]);
    // 71 runs a nested sub whose picture is collected; `done` ends only the nested sub
    const inner = sub(3, [op(96, w(7), b(4)), op(69)], [op(96, w(8), b(4))]);
    const outer = sub(4, [op(71, w(3)), op(96, w(9), b(4))]);
    expect(runRoomSubroutine(outer, env([outer, inner], 1, 0)).pictures.map((p) => p.id)).toEqual([7, 9]);
    // 165 sets the cell, 166 reads it back: 165 3; 166 b9; picture var9
    const mv = sub(5, [op(165, w(3)), op(166, b(9)), op(96, w(30009), b(4))]);
    expect(runRoomSubroutine(mv, env([mv], 1, 0)).pictures.map((p) => p.id)).toEqual([3]);
    // arithmetic: v0 = 70; 48 b0 30 -> 2 ; 51 b6.. mod
    const ar = sub(6, [op(42, b(0), w(70)), op(48, b(0), w(30)), op(96, w(30000), b(4))]);
    expect(runRoomSubroutine(ar, env([ar], 1, 0)).pictures.map((p) => p.id)).toEqual([2]);
  });
  it('without a super-room env the extended ops are ignored (room behaviour unchanged)', () => {
    const s = sub(1, [op(36, b(150), b(6)), op(96, w(30006), b(4))]);
    const e: RoomEvalEnv = { items: new Map(), vars: new Map([[150, 2]]), bits: new Set(), bits2: new Set() };
    expect(runRoomSubroutine(s, e).pictures.map((p) => p.id)).toEqual([0]);
  });
});

const DATA = resolve('data/elvira2/amiga/data');
const HAVE = existsSync(resolve(DATA, 'gameamiga'));

describe('real data: Elvira II super-rooms', { skip: !HAVE }, () => {
  const g = readGrammarFromExe(new Uint8Array(readFileSync(resolve(DATA, 'runit'))));
  const db = readGamePc(new Uint8Array(readFileSync(resolve(DATA, 'gameamiga'))), 'elvira2', g);
  const subs = new Map<number, Subroutine>(db.subroutines);
  for (const f of readdirSync(DATA).filter((n) => /^tables\d\d$/.test(n))) {
    for (const s of readSubroutineBlock(new Uint8Array(readFileSync(resolve(DATA, f))), 0, g).subs) if (!subs.has(s.id)) subs.set(s.id, s);
  }
  const supers = superRoomsOf(db);
  const sr760 = supers.find((s) => s.item === 760)!;
  const sr744 = supers.find((s) => s.item === 744)!;

  it('grid layout oracle: neighbour exits are reciprocal row-major; a transposed layout is not', () => {
    const STEP = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const score = (sr: typeof sr744, idx: (x: number, y: number, z: number) => number) => {
      let ok = 0, tot = 0;
      for (let z = 0; z < sr.grid.z; z++) for (let y = 0; y < sr.grid.y; y++) for (let x = 0; x < sr.grid.x; x++) {
        const v = sr.grid.states[idx(x, y, z)];
        for (let d = 0; d < 4; d++) {
          if (((v >> (d * 2)) & 3) === 0) continue;
          const nx = x + STEP[d][0], ny = y + STEP[d][1];
          if (nx < 0 || ny < 0 || nx >= sr.grid.x || ny >= sr.grid.y) continue;
          tot++;
          if ((sr.grid.states[idx(nx, ny, z)] >> (BACK_DIR[d] * 2)) & 3) ok++;
        }
      }
      return ok / tot;
    };
    for (const sr of [sr744, sr760]) {
      const { x: W, y: H } = sr.grid;
      expect(score(sr, (x, y, z) => (z * H + y) * W + x)).toBeGreaterThan(0.95);
      // null control: index the same words column-major (only valid for square layers; 30x30 and 20x20 are)
      expect(score(sr, (x, y, z) => (z * H + x) * W + y)).toBeLessThan(0.3);
    }
  });

  it('doorway cells: 22/22 rooms found, exit == back of facing; script cell numbers are 1-based (other offsets fail)', () => {
    const links = findMazeRoomLinks(subs, 760);
    expect(links.length).toBe(22);
    const rooms = new Map<number, number>(); // room -> exit dir into 760
    for (const it of db.items.values()) for (const c of it.children) if (c.kind === 'room') for (const e of c.exits) if (e.dest === 760) rooms.set(it.id, e.dir);
    expect(links.filter((k) => rooms.get(k.room) === (k.facing + 2) % 4).length).toBe(22);
    // null control: a facing shifted by one never satisfies the relation for more than a few
    expect(links.filter((k) => rooms.get(k.room) === (k.facing + 3) % 4).length).toBeLessThan(5);
    const nonEmpty = (off: number) => links.filter((k) => sr760.grid.states[k.cell - 1 + off] !== 0).length;
    expect(nonEmpty(0 - 0)).toBe(22); // index = number - 1
    for (const off of [-2, -1, 1, 2, 19, 20, 21]) expect(nonEmpty(off), `offset ${off}`).toBeLessThan(22);
    // and every doorway cell has a wall (state 0) in the direction of its door
    expect(links.filter((k) => gridDoorState(sr760.grid, k.cell, k.facing) === 0).length).toBe(22);
  });

  it('script and grid agree: "wall ahead" bit (b68) of a cell/facing == no open exit ahead (and 1304 mapping of v150)', () => {
    let n = 0, agree = 0, agreeShift = 0;
    for (let cell = 1; cell <= sr744.grid.states.length; cell += 7) {
      if (!sr744.grid.states[cell - 1]) continue;
      for (let f = 0; f < 4; f++) {
        const grids = new Map([[744, sr744.grid]]);
        const { result } = superRoomPictureFor(sr744, subs, db.items, grids, cell, f);
        void result;
        const env: RoomEvalEnv = { items: db.items, vars: new Map([[150, f], [0, cell]]), bits: new Set(), bits2: new Set(), sr: { current: 744, grids, pos: cell, subs, depth: 0 } };
        runRoomSubroutine(subs.get(1304)!, env);
        const wallAhead = env.bits.has(68);
        const st = gridDoorState(sr744.grid, cell, f);
        if (st > 1) continue; // doors (2/3) are drawn by sub 1319, not as a plain wall
        n++;
        if (wallAhead === (st !== 1)) agree++;
        if (wallAhead === (gridDoorState(sr744.grid, cell, (f + 1) % 4) !== 1)) agreeShift++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(agree).toBe(n);
    expect(agreeShift).toBeLessThan(n * 0.8); // wrong facing mapping would also pass if all cells were symmetric; it is not
  });

  describe('exported worlds', () => {
    const built = buildMaze(DATA, ELVIRA2_SPEC);
    const maze = built.maze;
    const mazeWorlds = maze.worlds.slice(4);
    it('4 + 6 levels, every pictured cell renders non-flat, start cells carried', () => {
      expect(mazeWorlds.length).toBe(10);
      expect(mazeWorlds.filter((x) => x.start).map((x) => x.start!.id).sort()).toEqual([cellId(744, 3240), cellId(760, 193)].sort());
      const pics = mazeWorlds.flatMap((x) => x.rooms.flatMap((r) => r.pics));
      expect(pics.filter((p) => p === 0).length).toBeLessThan(pics.length * 0.005); // a few facings are drawn by a line gated on an unmodelled condition
      expect(maze.stats.mazeCells).toBeGreaterThan(2000);
    });
    it('horizontal exits are reciprocal; stairs match between levels; pits are not exits', () => {
      const all = new Map(maze.worlds.flatMap((x) => x.rooms.map((r) => [r.id, r] as const)));
      let open = 0, back = 0;
      for (const x of mazeWorlds) for (const r of x.rooms) for (let d = 0; d < 6; d++) {
        const to = r.exits[d];
        if (!to || !all.has(to) || to < 10000) continue;
        open++;
        if (all.get(to)!.exits[BACK_DIR[d]] === r.id) back++;
      }
      expect(open).toBeGreaterThan(2000);
      expect(back / open).toBeGreaterThan(0.95);
      expect(maze.stats.mazePits).toBeGreaterThan(0);
    });
    it('rooms <-> maze doorways walk both ways through the view (cross-world level change)', () => {
      const room = maze.worlds.flatMap((x) => x.rooms).find((r) => r.id === 455)!;
      const wi = maze.worlds.findIndex((x) => x.rooms.some((r) => r.id === 455));
      const v = new WaxworksView(maze, wi, null, { roomId: 455, facing: 0 }, { id: 'elvira2', label: 'E2' });
      expect(room.exits[0]).toBe(cellId(760, 391));
      expect(v.forward()).toBeNull();
      const lc = v.takeLevelChange()!;
      expect(maze.worlds[lc.level].rooms.some((r) => r.id === cellId(760, 391))).toBe(true);
      expect(takeArrival()).toBe(cellId(760, 391));
      // from the doorway cell the facing that holds the door leads back to room 455
      const wm = maze.worlds[lc.level];
      const cell = wm.rooms.find((r) => r.id === cellId(760, 391))!;
      const mv = new WaxworksView(maze, lc.level, null, { roomId: cell.id, facing: 2 }, { id: 'elvira2', label: 'E2' });
      mv.forward();
      expect(maze.worlds[mv.takeLevelChange()!.level].rooms.some((r) => r.id === 455)).toBe(true);
      // null control: facing a wall (east) stays blocked, no level change
      const wrong = new WaxworksView(maze, lc.level, null, { roomId: cell.id, facing: 1 }, { id: 'elvira2', label: 'E2' });
      expect(wrong.forward()).toBeNull();
      expect(wrong.takeLevelChange()).toBeNull();
    });
  });
});

void (null as unknown as MazeFile);
