/**
 * Waxworks room graph model shared by the exporter, the walker view and the
 * tests: types for `data/maze.json`, the 3-D layout of the room graph, and
 * the movement rule.
 *
 * Movement (`moveDirn`, Elvira II loader's Waxworks override): the exit in
 * direction `d` is taken only when that direction's 2-bit door state is 1
 * (open); states 2/3 are closed/locked doors. Directions 0..3 are the four
 * compass sides in facing order (forward = exit[facing]), 4/5 up/down;
 * back-exits pair 0<->2, 1<->3, 4<->5 (2,890/2,890 exits reciprocal in the
 * shipped database). Turning is `facing = (facing + 1) % 4` (right) /
 * `(facing + 3) % 4` (left), subroutines 24/25.
 */

export interface MazeRoom {
  /** Item id of the room in `gameamiga`. */
  id: number;
  x: number;
  y: number;
  z: number;
  /** Destination room id per direction (0 = none). */
  exits: number[];
  /** 2 bits per direction: 0 none, 1 open, 2 closed, 3 locked. */
  doorStates: number;
  /** Picture handle (key of `MazeFile.pictures`) per facing 0..3; 0 = no picture. */
  pics: number[];
  /** A line gated by an unmodelled condition was skipped while resolving this room's pictures. */
  uncertain: boolean;
}

export interface MazeWorld {
  id: number;
  label: string;
  /** Picture zones used by the world's rooms, with room counts. */
  zones: Record<string, number>;
  rooms: MazeRoom[];
}

export interface MazePictureRef {
  /** VC script id the picture came from (zone = script/100). Distinct handles can share a script (different consulted variables). */
  script: number;
  zone: number;
  /** Cell index in that zone's sheet (`cols` per row). */
  index: number;
}

export interface MazeFile {
  version: 1;
  picWidth: number;
  picHeight: number;
  sheetCols: number;
  worlds: MazeWorld[];
  pictures: Record<string, MazePictureRef>;
  stats: Record<string, number>;
}

export const BACK_DIR = [2, 3, 0, 1, 5, 4] as const;
/** Layout step per direction: N (0,-1), E (+1,0), S (0,+1), W (-1,0), up z+1, down z-1. */
export const DIR_STEP: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const DIR_NAMES = ['N', 'E', 'S', 'W', 'Up', 'Down'] as const;

export function doorState(room: MazeRoom, dir: number): number {
  return (room.doorStates >> (dir * 2)) & 3;
}

export type MoveResult =
  | { ok: true; to: number }
  | { ok: false; reason: 'no-exit' | 'closed' | 'locked' | 'no-room' };

export function tryMove(world: Map<number, MazeRoom>, from: number, dir: number): MoveResult {
  const r = world.get(from);
  if (!r) return { ok: false, reason: 'no-room' };
  const st = doorState(r, dir);
  if (st === 0 || !r.exits[dir]) return { ok: false, reason: 'no-exit' };
  if (st === 2) return { ok: false, reason: 'closed' };
  if (st === 3) return { ok: false, reason: 'locked' };
  const to = r.exits[dir];
  if (!world.has(to)) return { ok: false, reason: 'no-room' };
  return { ok: true, to };
}

/** BFS layout of a connected room set on the (x,y,z) lattice; rooms that collide keep the first claimant's cell and are nudged east until free. */
export function layoutRooms(ids: number[], exitsOf: (id: number) => number[]): { pos: Map<number, [number, number, number]>; conflicts: number } {
  const pos = new Map<number, [number, number, number]>();
  const occ = new Set<string>();
  const key = (p: readonly number[]) => `${p[0]},${p[1]},${p[2]}`;
  let conflicts = 0;
  for (const start of ids) {
    if (pos.has(start)) continue;
    // each component gets an origin far from the previous ones
    const base: [number, number, number] = [0, 0, 0];
    if (pos.size) {
      let maxX = -Infinity;
      for (const p of pos.values()) maxX = Math.max(maxX, p[0]);
      base[0] = maxX + 3;
    }
    pos.set(start, base);
    occ.add(key(base));
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const n = queue[qi];
      const pn = pos.get(n)!;
      const ex = exitsOf(n);
      for (let d = 0; d < 6; d++) {
        const t = ex[d];
        if (!t || pos.has(t)) continue;
        let p: [number, number, number] = [pn[0] + DIR_STEP[d][0], pn[1] + DIR_STEP[d][1], pn[2] + DIR_STEP[d][2]];
        if (occ.has(key(p))) {
          conflicts++;
          while (occ.has(key(p))) p = [p[0] + 1, p[1], p[2]];
        }
        pos.set(t, p);
        occ.add(key(p));
        queue.push(t);
      }
    }
  }
  return { pos, conflicts };
}
