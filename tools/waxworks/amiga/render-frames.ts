/**
 * Headless frames of the Waxworks walker: drives `WaxworksView` through a few
 * moves per world and writes the 320x200 frame the view's `renderCanvas`
 * would draw (picture crop at (48,3)) to build/cache/waxworks/walker-frames/.
 * Usage: npx tsx tools/waxworks/amiga/render-frames.ts [dataDir]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { buildMaze } from './export-maze.ts';
import { WaxworksView, SCENE_X, SCENE_Y, startRoomFor } from '../../walker/games-waxworks.ts';

const dataDir = resolve(process.argv[2] ?? 'data/waxworks/amiga/data');
const outDir = resolve('build/cache/waxworks/walker-frames');
mkdirSync(outDir, { recursive: true });
const { maze, sheets } = buildMaze(dataDir);

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

for (const wi of [1, 3, 4]) {
  const world = maze.worlds[wi];
  const v = new WaxworksView(maze, wi, null, { roomId: startRoomFor(world).id, facing: 0 });
  await frame(v, `w${wi}-0-start`);
  for (let k = 0; k < 4; k++) {
    // walk forward where possible, otherwise turn right
    if (!v.forward()) v.turn('right');
    await frame(v, `w${wi}-${k + 1}`);
  }
}
