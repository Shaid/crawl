/**
 * The generic "walker view driven by an engine" surface shared by the title view factories: a `WalkerMount` on the shell's canvases, a `GameView` loaded for the engine's
 * current map, kept in step with the engine's pose each frame (setPose on a move, a fresh load on a map change). Titles supply only how to read a pose from their View, how
 * to load their GameView and, optionally, what to attach to a freshly loaded GameView (Black Crypt's live scene). Imported by the factories, never by the shell itself.
 */
import type { Pose } from '@seer-project/dungeon';
import { WalkerMount } from '../walker/mount';
import type { GameView } from '../walker/games';
import type { ViewContext, ViewSurface } from './registry';

export interface WalkerSurfaceOptions {
  /** the engine View's pose in walker terms (`level` = the walker's level id) */
  poseOf(view: any): Pose;   // eslint-disable-line @typescript-eslint/no-explicit-any
  load(level: number, pose: Pose): Promise<GameView>;
  /** a GameView was loaded (first time or after a map change): attach per-title extras; the returned function runs per frame before drawing */
  attach?(gv: GameView): ((view: any, frame: { dtMs: number; ticks: number; events: readonly unknown[] }) => void) | void;   // eslint-disable-line @typescript-eslint/no-explicit-any
}

const NO_KEYS = { isDown: () => false };

export async function createWalkerSurface(ctx: ViewContext, firstPose: Pose, o: WalkerSurfaceOptions): Promise<ViewSurface> {
  const mount = new WalkerMount(ctx.canvas, ctx.side);
  let perFrame: ReturnType<NonNullable<WalkerSurfaceOptions['attach']>> = undefined;
  let loading = false, disposed = false;
  const install = (gv: GameView) => { mount.setView(gv); perFrame = o.attach?.(gv); };
  try { install(await o.load(firstPose.level, firstPose)); } catch (e) { mount.dispose(); throw e; }
  return {
    render(view, frame) {
      if (disposed) return;
      const gv = mount.current; if (!gv) return;
      const p = o.poseOf(view);
      if (p.level !== gv.pose.level) {
        if (!loading) { loading = true; o.load(p.level, p).then(n => { if (!disposed) { install(n); mount.invalidate(); } }).catch(e => ctx.setStatus(`view: ${(e as Error).message}`)).finally(() => { loading = false; }); }
      } else if (gv.pose.x !== p.x || gv.pose.y !== p.y || gv.pose.facing !== p.facing) gv.setPose(p);
      perFrame?.(view, frame);
      gv.update(frame.dtMs, NO_KEYS);
      mount.render();
    },
    dispose() { disposed = true; mount.dispose(); },
  };
}
