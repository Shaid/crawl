/**
 * Elvira II: The Jaws of Cerberus (Horror Soft, 1991, Amiga) walker view.
 * Same engine family and renderer shape as Waxworks (`games-waxworks.ts`,
 * whose `WaxworksView` is reused): one pre-composed picture per room and
 * facing, produced offline by replaying the room scripts + VC draw scripts
 * (`tools/elvira2/amiga/export-maze.ts`).
 */
import type { Pose } from '@seer-project/dungeon';
import { WaxworksView, startRoomFor } from './games-waxworks.ts';
import type { MazeFile } from '../waxworks/amiga/maze-map.ts';

/** HYPOTHESIS: not decoded -- falls back to the first fully pictured room of the world. */
export const ELVIRA2_START_ROOM_ID = -1;

let cached: MazeFile | null = null;
async function getMaze(assetBase: string): Promise<MazeFile> {
  if (!cached) {
    const res = await fetch(`${assetBase}/data/maze.json`);
    if (!res.ok) throw new Error(`GET ${assetBase}/data/maze.json -> ${res.status}`);
    cached = (await res.json()) as MazeFile;
  }
  return cached;
}

export async function elvira2LevelListFromAssets(assetBase: string): Promise<Array<{ id: number; label: string }>> {
  const m = await getMaze(assetBase);
  return m.worlds.map((w) => ({ id: w.id, label: w.label.replace(/^World/, 'Area') }));
}

export async function loadElvira2View(assetBase: string, levelId: number, start: Pose | null): Promise<WaxworksView> {
  const maze = await getMaze(assetBase);
  const wi = Math.min(Math.max(levelId, 0), maze.worlds.length - 1);
  const world = maze.worlds[wi];
  let roomId = startRoomFor(world, ELVIRA2_START_ROOM_ID).id;
  let facing = 0;
  if (start) {
    const hit = world.rooms.find((r) => r.x === start.x && r.y === start.y);
    if (hit) roomId = hit.id;
    facing = start.facing;
  }
  return new WaxworksView(maze, wi, assetBase, { roomId, facing }, { id: 'elvira2', label: 'Elvira II: The Jaws of Cerberus' });
}
