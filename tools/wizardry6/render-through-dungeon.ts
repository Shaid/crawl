/**
 * Render a Wizardry 6 pose **through `@seer-project/dungeon`'s raster
 * pipeline** — `PieceBank.fromIndexedRGBA` (the true-indexed `mazedata.ega`
 * atlas) + `compositeDrawList` + `slots.json` — instead of the manual
 * `IndexedSurface.blit` bypass used by `render-corridor-frame.ts`.
 *
 * This is the M6 "W6 renders through the generic package" proof: it
 * exercises the two package paths Black Crypt never did — `blend: 'or'`
 * (W6's `DrawMazePiece` mode=1 bitwise-OR, which only means anything with
 * real 4bpp indices) and `fromIndexedRGBA`'s index recovery. The only
 * Wizardry-6-specific code here is the per-cell dispatch (EvalCellFace,
 * the wall-type-code -> slot-key mapping), which belongs to the game, not
 * the package.
 *
 * The wall dispatch replicates `render-corridor-frame.ts`'s confirmed
 * semantics (dispatch 0 = open -> nothing; 2 = wall; 5 = door at front,
 * plain-wall fallback elsewhere; everything else falls back to the wall
 * slot), but the *placement* comes from `slots.json`, which honours the
 * compose record's `srcClip` (source crop) — the game-correct reading
 * (`data-structure.md` §4.4) that `render-corridor-frame.ts` dropped by
 * blitting from source x=0.
 *
 * Usage: npx tsx tools/wizardry6/render-through-dungeon.ts <dataDir> <levelFile> <x> <y> <facing>
 */
import { resolve } from 'node:path';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import { IndexedSurface, PieceBank, compositeDrawList } from '@seer-project/dungeon';
import { validateSlotTableFile, type SlotTableFile } from '@seer-project/dungeon/schema';
import { PNG } from 'pngjs';
import type { CellPlanes } from './evaluate-cell.ts';
import { PIC_PALETTE } from './pic-format.ts';
import { buildViewItems } from './view-model.ts';
export { buildViewItems } from './view-model.ts';

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

export function loadIndexedBank(): PieceBank {
  const base = 'public/assets/wizardry6/amiga/maps';
  const png = PNG.sync.read(readFileSync(resolve(base, 'mazedata-indexed.png')));
  const mask = PNG.sync.read(readFileSync(resolve(base, 'mazedata-indexed-mask.png')));
  const atlas = JSON.parse(readFileSync(resolve(base, 'mazedata-indexed.json'), 'utf8'));
  const basePalette = PIC_PALETTE.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }));
  return PieceBank.fromIndexedRGBA(
    new Uint8Array(png.data),
    new Uint8Array(mask.data),
    png.width,
    png.height,
    atlas,
    basePalette,
  );
}

export function loadSlots(): SlotTableFile {
  const raw = JSON.parse(
    readFileSync(resolve('public/assets/wizardry6/amiga/dungeon/slots.json'), 'utf8'),
  );
  return validateSlotTableFile(raw);
}

/** Composite a pose through the package: staticSlots (ceiling/floor) first, then the dispatched wall items. */
export function renderThroughDungeon(
  planes: CellPlanes,
  x: number,
  y: number,
  facing: number,
  slots: SlotTableFile,
  bank: PieceBank,
): IndexedSurface {
  const surface = new IndexedSurface(slots.surface.width, slots.surface.height);
  surface.clear(0);
  const items = buildViewItems(planes, x, y, facing, slots);
  compositeDrawList(surface, { [slots.banks[0]!.id]: bank }, slots, items);
  return surface;
}

function main() {
  const [dataDir, levelFile, xArg, yArg, facingArg] = process.argv.slice(2);
  if (!dataDir || !levelFile || xArg === undefined || yArg === undefined || facingArg === undefined) {
    console.error('Usage: npx tsx tools/wizardry6/render-through-dungeon.ts <dataDir> <levelFile> <x> <y> <facing>');
    process.exit(1);
  }

  const levelData = JSON.parse(
    readFileSync(resolve('public/assets/wizardry6/amiga/dungeon', levelFile), 'utf8'),
  );
  const unit = levelData.units[0];
  const planes: CellPlanes = {
    width: levelData.cellSpace.width,
    height: levelData.cellSpace.height,
    wallA: unit.planes.wallA,
    wallB: unit.planes.wallB,
    feature: unit.planes.feature,
    orient: unit.planes.orient,
  };
  if (!existsSync(resolve(dataDir, 'mazedata.ega'))) {
    console.error(`No ${resolve(dataDir, 'mazedata.ega')} — need real W6 data (run export-mazedata-indexed.ts first)`);
    process.exit(1);
  }
  const x = Number(xArg);
  const y = Number(yArg);
  const facing = Number(facingArg);

  const slots = loadSlots();
  const bank = loadIndexedBank();
  const surface = renderThroughDungeon(planes, x, y, facing, slots, bank);

  const rgba = new Uint8Array(surface.width * surface.height * 4);
  for (let i = 0; i < surface.width * surface.height; i++) {
    const c = PIC_PALETTE[surface.data[i]!] ?? { r: 0, g: 0, b: 0 };
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = 255;
  }
  const outDir = resolve('public/assets/wizardry6/amiga/maps');
  mkdirSync(outDir, { recursive: true });
  const outFile = `through-dungeon-${x}-${y}-f${facing}.png`;
  writePNG(resolve(outDir, outFile), rgba, surface.width, surface.height);
  console.log(`Wrote ${outFile} via @seer-project/dungeon (${surface.width}x${surface.height})`);
}

const isStandalone =
  process.argv[1]?.endsWith('render-through-dungeon.ts') ||
  process.argv[1]?.endsWith('render-through-dungeon');

if (isStandalone) main();
