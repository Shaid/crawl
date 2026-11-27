/**
 * Engine-agnostic real-time pacing for the shell: no DOM, no real clock (driven by `update(dtMs)` and key events, so a test can feed a fake clock).
 * It owns what an engine deliberately does not: the tick clock (one `step` per tick period, with a catch-up cap), the key layer (a tap is never lost, a held key repeats
 * after a delay) and the per-tick command budget. Generalised from the Black Crypt `PlayLoop` (which is now a thin subclass of this); the repeat delay / rate and the
 * budget are shell policy, configurable.
 */
export interface KeyBinding<Cmd> { cmd: Cmd; /** a held key repeats (movement, turning, attacks) */ repeat: boolean }
export type KeyMap<Cmd> = Record<string, KeyBinding<Cmd>>;

export interface LoopOptions<Cmd> {
  keymap?: KeyMap<Cmd>;
  /** how long a key must be held before it repeats (ms) */
  repeatDelayMs?: number;
  /** a held key repeats once every this many ticks */
  repeatEveryTicks?: number;
  /** commands handed to the engine per tick */
  maxCmdsPerTick?: number;
  /** longest backlog of unplayed ticks kept when the host stalls */
  maxCatchUpTicks?: number;
}

interface Held<Cmd> { binding: KeyBinding<Cmd>; since: number; lastTick: number; fired: boolean }

export class ShellLoop<State, Cmd, Ev> {
  paused = false;
  tickMs: number;
  private readonly keymap: KeyMap<Cmd>;
  private readonly delay: number; private readonly every: number; private readonly budget: number; private readonly cap: number;
  private now = 0; private acc = 0; private tickNo = 0;
  private held = new Map<string, Held<Cmd>>();
  private taps: Cmd[] = [];
  private queued: Cmd[] = [];
  readonly st: State;
  private readonly stepFn: (st: State, cmds: Cmd[]) => Ev[];
  constructor(st: State, stepFn: (st: State, cmds: Cmd[]) => Ev[], tickMs: number, o: LoopOptions<Cmd> = {}) {
    this.st = st; this.stepFn = stepFn; this.tickMs = tickMs; this.keymap = o.keymap ?? {};
    this.delay = o.repeatDelayMs ?? 400; this.every = Math.max(1, o.repeatEveryTicks ?? 1); this.budget = o.maxCmdsPerTick ?? 2; this.cap = o.maxCatchUpTicks ?? 5;
  }
  get ticks() { return this.tickNo; }
  has(code: string) { return !!this.keymap[code]; }
  keyDown(code: string) {
    const b = this.keymap[code]; if (!b || this.held.has(code)) return;   // an OS-level repeat event of a key already down is ignored: repeat is ours
    this.held.set(code, { binding: b, since: this.now, lastTick: -1, fired: false });
  }
  /** release; a key that never got its first tick (tapped and released inside one tick period) still fires once on the next tick */
  keyUp(code: string) { const h = this.held.get(code); if (h && !h.fired) this.taps.push(h.binding.cmd); this.held.delete(code); }
  /** drop every held key (window blur): a key released while the page was not listening must not stay down */
  releaseAll() { this.held.clear(); }
  /** a command that is not a key (a click): played on the next tick */
  command(c: Cmd) { this.queued.push(c); }

  private poll(): Cmd[] {
    const out: Cmd[] = [...this.queued.splice(0)];
    const t = this.now - this.acc;   // the tick boundary in loop time
    for (const h of this.held.values()) {
      if (!h.fired) { out.push(h.binding.cmd); h.fired = true; h.lastTick = this.tickNo; continue; }
      if (h.binding.repeat && t - h.since >= this.delay && this.tickNo - h.lastTick >= this.every) { out.push(h.binding.cmd); h.lastTick = this.tickNo; }
    }
    out.push(...this.taps.splice(0));
    return out.slice(0, this.budget);
  }
  /** advance by `dtMs` of (real or fake) time; returns the engine events of the ticks that ran */
  update(dtMs: number): { ticks: number; events: Ev[] } {
    this.now += dtMs;
    if (this.paused) return { ticks: 0, events: [] };
    this.acc += dtMs;
    const events: Ev[] = []; let n = 0;
    while (this.acc >= this.tickMs && n < this.cap) {
      const cmds = this.poll();
      this.acc -= this.tickMs;
      events.push(...this.stepFn(this.st, cmds));
      this.tickNo++; n++;
    }
    if (this.acc >= this.tickMs) this.acc %= this.tickMs;   // stalled host: drop the backlog beyond the cap
    return { ticks: n, events };
  }
}
