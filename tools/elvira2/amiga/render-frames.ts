/**
 * Headless frames of the Elvira II walker -> build/cache/elvira2/walker-frames/.
 * Usage: npx tsx tools/elvira2/amiga/render-frames.ts [dataDir] [roomId ...]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { buildMaze } from '../../waxworks/amiga/export-maze.ts';
import { ELVIRA2_SPEC } from './export-maze.ts';
import { WaxworksView, SCENE_X, SCENE_Y, startRoomFor } from '../../walker/games-waxworks.ts';
import { ELVIRA2_START_ROOM_ID } from '../../walker/games-elvira2.ts';

const dataDir = resolve(process.argv[2] ?? 'data/elvira2/amiga/data');
const outDir = resolve('build/cache/elvira2/walker-frames');
mkdirSync(outDir, { recursive: true });
const { maze, sheets } = buildMaze(dataDir, ELVIRA2_SPEC);

async function frame(view: WaxworksView, name: string) {
  const W = 320, H = 200;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const ref = maze.pictures[String(view.pictureId)];
  if (ref) {
    const s = sheets.get(ref.zone)!;
    const ox = (ref.index % maze.sheetCols) * maze.picWidth;
    const oy = Math.floor(ref.index / maze.sheetCols) * maze.picHeight;
    for (let y = 0; y < maze.picHeight; y++)
      for (let x = 0; x < maze.picWidth; x++) {
        const si = ((oy + y) * s.width + ox + x) * 4;
        const di = ((SCENE_Y + y) * W + SCENE_X + x) * 4;
        rgba.set(s.rgba.subarray(si, si + 4), di);
      }
  }
  await writePNG(resolve(outDir, `${name}.png`), rgba, W, H);
  console.log(name, `world ${view.worldIndex} room ${view.room.id} facing ${view.pose.facing} pic ${ref ? ref.script : '-'}`);
}

for (const wi of maze.worlds.keys()) {
  const world = maze.worlds[wi];
  const v = new WaxworksView(maze, wi, null, { roomId: startRoomFor(world, ELVIRA2_START_ROOM_ID).id, facing: 0 }, { id: 'elvira2', label: 'Elvira II' });
  await frame(v, `w${wi}-0-start`);
  for (let k = 0; k < 5; k++) {
    if (!v.forward()) v.turn('right');
    await frame(v, `w${wi}-${k + 1}`);
  }
}
