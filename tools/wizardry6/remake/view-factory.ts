/**
 * Wizardry 6's in-shell 3D view: the walker's `Wizardry6View` (the pixel-exact Amiga renderer, `tools/walker/games.ts`) driven from `W6Engine.view().pose` each frame. It draws the
 * static level (a door the engine opened is not drawn open, monsters are not in the scene: TODO `w6-remake-view`). Imported lazily by the entry's `viewFactory`. The loader below
 * is the walker page's `loadWizardry6` (tools/walker/walker.ts) for a given level, without the page's DOM; same files, same construction.
 */
import { PieceBank, DEFAULT_BINDINGS, parseRampPalette, FlatGridLevel, type Pose, type RampPaletteFile } from '@seer-project/dungeon';
import { validateDungeonLevelFile, validateSlotTableFile } from '@seer-project/dungeon/schema';
import type { AtlasMeta } from '@seer-project/core';
import { Wizardry6View, type GameView } from '../../walker/games';
import { fetchJSON, tryFetchJSON, decodePNGToRGBA, loadBank } from '../../walker/bc-loader';
import { createWalkerSurface } from '../../remake/walker-surface';
import { W6TriggerState, type W6LevelLinks } from '../movement';
import type { CellPlanes } from '../evaluate-cell';
import type { ViewContext, ViewSurface } from '../../remake/registry';
import { W6Engine, type W6State, type W6View } from './engine';

export async function loadW6WalkerView(assetBase: string, levelId: number, pose: Pose): Promise<GameView> {
  const rawLevel = await fetchJSON<unknown>(`${assetBase}/dungeon/level${String(levelId).padStart(2, '0')}.json`);
  const levelFile = validateDungeonLevelFile(rawLevel);
  const unit = levelFile.units[0]!;
  const origin = (rawLevel as { origin?: { x: number; y: number } }).origin ?? { x: 0, y: 0 };
  const w6 = (rawLevel as { w6?: { links?: W6LevelLinks } }).w6;
  const planes: CellPlanes = {
    width: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.width : 16, height: levelFile.cellSpace.kind === 'flat' ? levelFile.cellSpace.height : 16,
    wallA: unit.planes.wallA, wallB: unit.planes.wallB, feature: unit.planes.feature, orient: unit.planes.orient, flagP: unit.planes.flagP, flagQ: unit.planes.flagQ, region: unit.planes.region, level: levelId,
  };
  const slots = validateSlotTableFile(await fetchJSON<unknown>(`${assetBase}/dungeon/slots.json`));
  const bankRef = slots.banks[0]!;
  const [atlas, indexImg, maskImg, paletteFile] = await Promise.all([
    tryFetchJSON<AtlasMeta>(`${assetBase}/${bankRef.atlas}`),
    decodePNGToRGBA(`${assetBase}/${bankRef.image}`),
    decodePNGToRGBA(`${assetBase}/${bankRef.image.replace('.png', '-mask.png')}`),
    tryFetchJSON<RampPaletteFile>(`${assetBase}/${bankRef.palette ?? 'palettes/mazedata.json'}`),
  ]);
  if (!atlas || !indexImg || !maskImg || !paletteFile) throw new Error(`wizardry6: missing indexed atlas/palette under ${assetBase} (npm run w6:atlas && npm run w6:slots)`);
  const palette = parseRampPalette(paletteFile);
  const bank = PieceBank.fromIndexedRGBA(indexImg.rgba, maskImg.rgba, indexImg.width, indexImg.height, atlas, palette);
  const level = new FlatGridLevel(levelFile, unit);
  const automapBank = await loadBank('/assets/blackcrypt/amiga', 'sprites/automap.json', 'sprites/automap.png');
  return new Wizardry6View({
    planes, slots, bank, palette, bindings: DEFAULT_BINDINGS, levelId, levelLabel: `Level ${String(levelId).padStart(2, '0')}`,
    startPose: { ...pose, level: levelId },
    level, automapBank, origin, links: w6?.links, triggers: new W6TriggerState(),
  });
}

export function createW6View(ctx: ViewContext): Promise<ViewSurface> {
  const poseOf = (v: W6View): Pose => ({ level: v.pose.level, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 });
  return createWalkerSurface(ctx, poseOf(W6Engine.view(ctx.state() as W6State)), { poseOf, load: (level, pose) => loadW6WalkerView(ctx.assetBase, level, pose) });
}
