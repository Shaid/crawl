/**
 * Might & Magic II's in-shell 3D view: the walker's `MM2View` (the frustum renderer, the same one `?game=mm2` uses) driven from `Mm2Engine.view().pose` every frame. The walker
 * view draws the static map (a door opened in play is not drawn open, no monsters in the scene: TODO `mm2-remake-view`); the HUD says what is ahead. Imported lazily by the
 * entry's `viewFactory`.
 */
import { Mm2Engine, type Mm2State, type Mm2View } from './engine';
import { loadMM2View } from '../../walker/games-mm';
import { createWalkerSurface } from '../../remake/walker-surface';
import type { ViewContext, ViewSurface } from '../../remake/registry';

export function createMm2View(ctx: ViewContext): Promise<ViewSurface> {
  const poseOf = (v: Mm2View) => ({ level: v.pose.screen, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 });
  return createWalkerSurface(ctx, poseOf(Mm2Engine.view(ctx.state() as Mm2State)), { poseOf, load: (level, pose) => loadMM2View(ctx.assetBase, level, pose) });
}
