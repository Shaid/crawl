/**
 * Elvira II super-room grid mazes (items 744: 30x30x4, 760: 20x20x6) as walker
 * worlds. Original code; the structure was worked out from the game's own
 * scripts and grids (docs/elvira2/amiga/data-structure.md section 6).
 *
 * Grid index = (z*H + row)*W + col; the scripts' **cell number is index + 1**; direction d of a cell is the 2-bit state
 * at bits 2d..2d+1 (0 N, 1 E, 2 S, 3 W, 4 up, 5 down): N = row-1, E = col+1
 * (script sub 1305: facing 0 -> `v0 -= 30`, 1 -> `+= 1`, 2 -> `+= 30`, 3 -> `-= 1`).
 * Each cell/facing picture is the result of running the maze's own script
 * (`superroom` child `subroutineId`: 1300 / 1499) with the cell in v0 and the
 * facing in v150 (`runRoomSubroutine` with the extended op set).
 */
import type { AgosItem, GamePcDatabase, Subroutine } from '../../shared/agos-gamepc.ts';
import { runRoomSubroutine, VAR_FACING, gridDoorState, type PictureCall, type RoomEvalEnv, type SuperRoomGrid } from '../../waxworks/amiga/room-script.ts';
import { BACK_DIR, type MazeRoom, type MazeWorld } from '../../waxworks/amiga/maze-map.ts';

/** Cell ids in the maze files: `item * CELL_ID_BASE + cell` (room item ids stay below it). */
export const CELL_ID_BASE = 10000;
export const cellId = (item: number, cell: number): number => item * CELL_ID_BASE + cell;

export interface SuperRoomDef {
  item: number;
  subroutineId: number;
  grid: SuperRoomGrid;
}

export function superRoomsOf(db: GamePcDatabase): SuperRoomDef[] {
  const out: SuperRoomDef[] = [];
  for (const it of db.items.values()) {
    for (const c of it.children) {
      if (c.kind === 'superroom') out.push({ item: it.id, subroutineId: c.subroutineId, grid: { x: c.x, y: c.y, z: c.z, states: c.exitStates } });
    }
  }
  return out.sort((a, b) => a.item - b.item);
}

export interface MazeRoomLink {
  room: number;
  item: number;
  cell: number;
  /** Facing at the cell in which the door to the room is ahead; the room's exit back is `(facing + 2) % 4`. */
  facing: number;
  /** `confirmed`: read from the game's scripts; `hypothesis`: see the doc. */
  source: 'script-1286' | 'hypothesis';
}

/**
 * Cell -> room doorways of the 760 maze, read from the scripts: the table in
 * subroutine 1286 (`13 v0 <cell>` / `55 <room>`) names the cell, and the
 * per-room lines of subs 1250-1255 (`13 v0 <cell>`, `13 v150 <facing>`,
 * `141 b2 <room>`) the facing. 22/22 satisfy `room exit dir == (facing+2)%4`.
 */
export function findMazeRoomLinks(subs: Map<number, Subroutine>, item: number): MazeRoomLink[] {
  const found = new Map<number, MazeRoomLink>();
  for (const s of subs.values()) {
    for (const l of s.lines) {
      const o13 = l.ops.filter((o) => o.op === 13);
      const c = o13.find((o) => o.args[0].v === 0 && o.args[1].v < 30000);
      const f = o13.find((o) => o.args[0].v === VAR_FACING);
      const r = l.ops.find((o) => o.op === 141 && o.args[0].v === 2);
      if (c && f && r && r.args[1].v > 0) found.set(r.args[1].v, { room: r.args[1].v, item, cell: c.args[1].v, facing: f.args[1].v, source: 'script-1286' });
    }
  }
  const t = subs.get(1286);
  const inTable = new Set<number>();
  if (t) for (const l of t.lines) for (const o of l.ops) if (o.op === 55 && o.args[0].v > 0) inTable.add(o.args[0].v);
  return [...found.values()].filter((k) => inTable.has(k.room)).sort((a, b) => a.room - b.room);
}

export interface SuperRoomBuildCtx {
  db: GamePcDatabase;
  subs: Map<number, Subroutine>;
  /** Compose a picture call into a handle (0 = nothing drawn). */
  picture: (call: PictureCall) => number;
  /** Cell -> room doorways (760, from the scripts). */
  links: MazeRoomLink[];
  /** Room -> maze entries that are not doorways in the scripts (HYPOTHESIS): room `room`'s exit `dir` arrives at `cell`; the cell's reverse exit leads back. */
  entries: Array<{ room: number; dir: number; item: number; cell: number }>;
  firstWorldId: number;
  /** Where each maze starts (item -> cell, facing); the game's own `sub 0` verbs 281/274 enter 744 at 3240 and 760 at 193. */
  starts: Map<number, { cell: number; facing: number }>;
}

export interface SuperRoomBuild {
  worlds: MazeWorld[];
  stats: { cells: number; pictures: number; rendered: number; uncertainCells: number; pits: number };
}

/** Run a maze script for a cell and facing. */
export function superRoomPictureFor(sr: SuperRoomDef, subs: Map<number, Subroutine>, items: Map<number, AgosItem>, grids: Map<number, SuperRoomGrid>, cell: number, facing: number) {
  const sub = subs.get(sr.subroutineId);
  if (!sub) throw new Error(`super-room ${sr.item}: script ${sr.subroutineId} missing`);
  const env: RoomEvalEnv = { items, vars: new Map([[VAR_FACING, facing], [0, cell]]), bits: new Set(), bits2: new Set(), sr: { current: sr.item, grids, pos: cell, subs, depth: 0 } };
  const result = runRoomSubroutine(sub, env);
  const main = result.pictures.filter((p) => p.mode === 4);
  return { call: main.length ? main[main.length - 1] : null, result };
}

const STEP: ReadonlyArray<readonly [number, number, number]> = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

export function buildSuperRoomWorlds(ctx: SuperRoomBuildCtx): SuperRoomBuild {
  const supers = superRoomsOf(ctx.db);
  const grids = new Map(supers.map((s) => [s.item, s.grid]));
  const worlds: MazeWorld[] = [];
  const stats = { cells: 0, pictures: 0, rendered: 0, uncertainCells: 0, pits: 0 };
  let wid = ctx.firstWorldId;
  for (const sr of supers) {
    const { x: W, y: H, z: Z, states } = sr.grid;
    const linkCells = new Map<number, MazeRoomLink[]>();
    for (const k of ctx.links) if (k.item === sr.item) (linkCells.get(k.cell) ?? linkCells.set(k.cell, []).get(k.cell)!).push(k);
    const entryCells = new Set(ctx.entries.filter((e) => e.item === sr.item).map((e) => e.cell));
    /** `num` = script cell number (grid index + 1). */
    const present = (num: number) => num >= 1 && num <= states.length && (states[num - 1] !== 0 || linkCells.has(num) || entryCells.has(num));
    for (let z = 0; z < Z; z++) {
      const rooms: MazeRoom[] = [];
      const zoneCount: Record<string, number> = {};
      for (let row = 0; row < H; row++) {
        for (let col = 0; col < W; col++) {
          const cell = (z * H + row) * W + col + 1;
          if (!present(cell)) continue;
          const exits = [0, 0, 0, 0, 0, 0];
          let doorStates = 0;
          for (let d = 0; d < 6; d++) {
            const st = gridDoorState(sr.grid, cell, d);
            if (!st) continue;
            const nx = col + STEP[d][0];
            const ny = row + STEP[d][1];
            const nz = z + STEP[d][2];
            if (nx < 0 || ny < 0 || nz < 0 || nx >= W || ny >= H || nz >= Z) continue;
            const ncell = (nz * H + ny) * W + nx + 1;
            if (!present(ncell)) continue;
            // down state 3 is a pit (sub 1315 tests `173 ... 5`): it is not a walkable exit
            if (d === 5 && st === 3) {
              stats.pits++;
              continue;
            }
            exits[d] = cellId(sr.item, ncell);
            doorStates |= st << (d * 2);
          }
          for (const k of linkCells.get(cell) ?? []) {
            const d = (k.facing + 0) % 4;
            exits[d] = k.room;
            doorStates = (doorStates & ~(3 << (d * 2))) | (1 << (d * 2));
          }
          for (const e of ctx.entries) {
            if (e.item !== sr.item || e.cell !== cell) continue;
            const d = BACK_DIR[e.dir];
            exits[d] = e.room;
            doorStates = (doorStates & ~(3 << (d * 2))) | (1 << (d * 2));
          }
          const pics = [0, 0, 0, 0];
          let uncertain = false;
          for (let f = 0; f < 4; f++) {
            const { call, result } = superRoomPictureFor(sr, ctx.subs, ctx.db.items, grids, cell, f);
            if (result.gatedPicture) uncertain = true;
            if (call) {
              stats.pictures++;
              const h = ctx.picture(call);
              if (h) {
                pics[f] = h;
                stats.rendered++;
                const zk = String(Math.floor(call.id / 100));
                zoneCount[zk] = (zoneCount[zk] ?? 0) + 1;
              }
            }
          }
          if (uncertain) stats.uncertainCells++;
          stats.cells++;
          rooms.push({ id: cellId(sr.item, cell), x: col, y: row, z, exits, doorStates, pics, uncertain });
        }
      }
      const world: MazeWorld = { id: wid++, label: `Maze ${sr.item} (${W}x${H}x${Z}) level ${z + 1} of ${Z}: ${rooms.length} cells`, zones: zoneCount, rooms };
      const st = ctx.starts.get(sr.item);
      if (st && Math.floor((st.cell - 1) / (W * H)) === z) world.start = { id: cellId(sr.item, st.cell), facing: st.facing };
      worlds.push(world);
    }
  }
  return { worlds, stats };
}
