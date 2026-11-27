/**
 * Black Crypt's in-shell 3D view: the walker's `BlackCryptView` (loaded by `tools/walker/bc-loader.ts`, the same stack as the walker page's `?play=1`) with the engine's live
 * scene attached (`createBcLive`: monsters, doors, floor items, hit effects, door clicks -> `openDoor`), driven from `BcEngine.view()` every frame. Imported lazily by the
 * entry's `viewFactory`, so the shell's registry does not pull the walker in until a game starts.
 */
import { BcEngine, type BcState, type BcView } from './engine';
import { createBcLive, type BcLive } from './live-play';
import { loadBlackCryptView } from '../../walker/bc-loader';
import { createWalkerSurface } from '../../remake/walker-surface';
import type { ViewContext, ViewSurface } from '../../remake/registry';
import type { BlackCryptView } from '../../walker/games';

export async function createBcView(ctx: ViewContext): Promise<ViewSurface> {
  const groups = ((await (await fetch(`${ctx.assetBase}/data/monster-names.json`)).json()) as { groups: Parameters<typeof createBcLive>[0]['groups'] }).groups;
  const poseOf = (v: BcView) => ({ level: v.map, x: v.pose.x, y: v.pose.y, facing: v.pose.facing as 0 | 1 | 2 | 3 });
  let live: BcLive | null = null;
  return createWalkerSurface(ctx, poseOf(BcEngine.view(ctx.state() as BcState)), {
    poseOf,
    load: (level, pose) => loadBlackCryptView(ctx.assetBase, level, pose, { play: true, onInteract: ctx.setStatus }),
    attach(gv) {
      const v = gv as BlackCryptView;
      live = createBcLive({ state: () => ctx.state() as BcState, banks: v.banks, groups, getPose: () => v.pose, onCommand: c => ctx.command(c) });
      v.setLive(live);
      return (_view, f) => {
        if (f.ticks) { live!.feed(f.events as Parameters<BcLive['feed']>[0]); for (let i = 0; i < f.ticks; i++) live!.tick(); v.refreshLive(); }
      };
    },
  });
}
