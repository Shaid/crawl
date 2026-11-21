/**
 * Elvira II (Amiga) room-graph exporter: the Waxworks pipeline
 * (`tools/waxworks/amiga/export-maze.ts`) run with Elvira II's `MazeSpec`
 * (plain `gameamiga`, its own `runit` opcode grammar, its own VC opcode
 * lengths, each zone's own type-2 picture bank).
 *
 * Usage: npx tsx tools/elvira2/amiga/export-maze.ts [dataDir]
 * Writes public/assets/elvira2/amiga/data/maze.json + maze/z<zone>.png.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG, writeJson } from '@seer-project/pipeline';
import { ELVIRA2_VC_PARAM_BYTES } from '../../shared/agos-vc.ts';
import { buildMaze, type MazeSpec } from '../../waxworks/amiga/export-maze.ts';
import type { MazeFile } from '../../waxworks/amiga/maze-map.ts';

export const ELVIRA2_SPEC: MazeSpec = {
  variant: 'elvira2',
  scheme: 'elvira',
  packedGamePc: false,
  sharedBank: (zone) => zone,
  vcTable: ELVIRA2_VC_PARAM_BYTES,
  minWorldRooms: 2,
};

export async function exportElvira2Maze(dataDir: string): Promise<MazeFile> {
  const { maze, sheets } = buildMaze(dataDir, ELVIRA2_SPEC);
  const out = resolve('public/assets/elvira2/amiga');
  mkdirSync(resolve(out, 'maze'), { recursive: true });
  mkdirSync(resolve(out, 'data'), { recursive: true });
  for (const [zone, s] of sheets) await writePNG(resolve(out, 'maze', `z${zone}.png`), s.rgba, s.width, s.height);
  await writeJson(resolve(out, 'data', 'maze.json'), maze);
  console.log(
    `elvira2/amiga maze: ${maze.worlds.length} worlds, ${maze.stats.rooms} rooms, ${Object.keys(maze.pictures).length} pictures in ${sheets.size} sheets, ` +
      `${maze.stats.roomPicturesRendered}/${maze.stats.roomPictures} room pictures rendered, ${maze.stats.roomsUncertain} rooms gated by unmodelled conditions`,
  );
  return maze;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = resolve(process.argv[2] ?? 'data/elvira2/amiga/data');
  if (!existsSync(dataDir)) throw new Error(`no data dir ${dataDir}`);
  exportElvira2Maze(dataDir).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
