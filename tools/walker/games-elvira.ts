/**
 * Elvira: Mistress of the Dark (Horror Soft, 1990, Amiga) walker view. Same
 * renderer shape as Waxworks / Elvira II (`games-waxworks.ts`'s
 * `WaxworksView`): one pre-composed picture per room and facing, produced
 * offline by replaying Elvira 1's own room scripts (subroutine `1000 +
 * userflags[0]`, facing v150 = 0/2/4/6) and VC picture scripts
 * (`tools/elvira/amiga/export-maze.ts`). Facing 0..3 = `moveDirn` direction
 * (0 N, 1 E, 2 S, 3 W); forward = exit[facing].
 */
import type { Pose } from '@seer-project/dungeon';
import { WaxworksView, startRoomFor, takeArrival } from './games-waxworks.ts';
import type { MazeFile } from '../waxworks/amiga/maze-map.ts';

/** Start room of the game (`goto i876` closing the start-up block of subroutine 101); exported with the world as `world.start`. HYPOTHESIS: that block is the initial location. */
export const ELVIRA1_START_ROOM_ID = 876;

let cached: MazeFile | null = null;
async function getMaze(assetBase: string): Promise<MazeFile> {
  if (!cached) {
    const res = await fetch(`${assetBase}/data/maze.json`);
    if (!res.ok) throw new Error(`GET ${assetBase}/data/maze.json -> ${res.status}`);
    cached = (await res.json()) as MazeFile;
  }
  return cached;
}

export async function elviraLevelListFromAssets(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const m = await getMaze(assetBase);
  return m.worlds.map((w) => ({ id: w.id, label: w.label }));
}

export async function loadElviraView(assetBase: string, levelId: number, start: Pose | null): Promise<WaxworksView> {
  const maze = await getMaze(assetBase);
  const wi = Math.min(Math.max(levelId, 0), maze.worlds.length - 1);
  const world = maze.worlds[wi];
  let roomId = startRoomFor(world, ELVIRA1_START_ROOM_ID).id;
  let facing = world.start && roomId === world.start.id ? world.start.facing : 0;
  const arrived = takeArrival();
  if (arrived !== null && world.rooms.some((r) => r.id === arrived)) {
    roomId = arrived;
    if (start) facing = start.facing;
  } else if (start) {
    const hit = world.rooms.find((r) => r.x === start.x && r.y === start.y);
    if (hit) roomId = hit.id;
    facing = start.facing;
  }
  return new WaxworksView(maze, wi, assetBase, { roomId, facing }, { id: 'elvira', label: 'Elvira: Mistress of the Dark' });
}
