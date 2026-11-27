/**
 * Runs an entry's `viewFactory` for a session: DOM-free apart from the two opaque surfaces the page hands in, so it is tested with a fake factory. It owns the surface's
 * lifetime (create lazily and asynchronously, render every frame with the engine's current View, dispose on exit and whenever the session's state is replaced by a slot
 * load / import / new game, then build a fresh one) and the fallback (no factory, or a factory that throws = text HUD only, reason in `error`).
 */
import type { GameSession } from './session';
import type { ViewContext, ViewSurface } from './registry';

export class ViewHost {
  /** why there is no picture (factory threw); null = fine or no factory */
  error: string | null = null;
  /** true when a picture is (or is being) built; false = text HUD only */
  readonly wanted: boolean;
  private surface: ViewSurface | null = null;
  private bound: unknown = null;            // the ShellLoop the current surface was built for
  private building = 0;                     // generation counter; a build finishing for an old generation is disposed at once
  private dead = false;
  private readonly session: GameSession; private readonly ctx: Omit<ViewContext, 'state' | 'command' | 'assetBase'>;
  constructor(session: GameSession, ctx: Omit<ViewContext, 'state' | 'command' | 'assetBase'>) {
    this.session = session; this.ctx = ctx;
    this.wanted = !!session.found.entry.hints.viewFactory;
  }
  get ready() { return this.surface !== null; }

  private teardown() { const s = this.surface; this.surface = null; this.building++; try { s?.dispose(); } catch { /* a faulty dispose must not break the shell */ } }
  private build() {
    const f = this.session.found.entry.hints.viewFactory!; const gen = ++this.building; const loop = this.session.loop; this.bound = loop;
    const ctx: ViewContext = { ...this.ctx, assetBase: this.session.found.entry.assetBase ?? '', state: () => this.session.state, command: c => this.session.loop.command(c) };
    void (async () => {
      try {
        const s = await f(ctx);
        if (this.dead || gen !== this.building) { try { s.dispose(); } catch { /* ignore */ } return; }
        this.surface = s; this.error = null;
      } catch (e) { if (gen === this.building) this.error = (e as Error).message ?? String(e); }
    })();
  }

  /** call once per animation frame after `session.update`; `ticks` is its return value */
  frame(dtMs: number, ticks: number) {
    if (!this.wanted || this.dead) return;
    if (this.bound !== this.session.loop) { this.teardown(); this.error = null; this.build(); return; }
    if (!this.surface) return;
    try { this.surface.render(this.session.view(), { dtMs, ticks, events: ticks ? this.session.lastEvents : [] }); }
    catch (e) { this.error = (e as Error).message ?? String(e); this.teardown(); }
  }
  /** the session ended */
  dispose() { this.dead = true; this.teardown(); }
}
