/**
 * Real-time pacing for the Black Crypt remake shell, with no DOM and no real clock: the loop is driven by `update(dtMs)` and key events, so a test (or a replay) can
 * feed it a fake clock. It owns three things the engine deliberately does not:
 *
 *  - the tick clock: one `BcEngine.step` per tick period (PAL 160 ms = 8 vblanks, NTSC 166.7 ms = 10, game-rules 10.1; the region is a setting, PAL the default [hyp]),
 *    with a catch-up cap so a stalled tab does not replay minutes of game time;
 *  - the key layer: a tap is never lost (a press released between two ticks still produces its command), a held key repeats after a delay;
 *  - the per-tick command budget.
 *
 * Hyp (not in the retail code we read): the repeat delay / rate and the budget. The game polls its input library once per tick; whether it consumes the Amiga keyboard's
 * auto-repeat events or edge events only is not decoded, so repeat is a shell policy, configurable, off for non-movement commands.
 */
import { BcEngine, type BcState, type BcCmd, type BcEvent } from './engine';

export const TICK_MS = { PAL: 160, NTSC: 1000 / 6 } as const;   // SetIdlePeriod(10): 8 PAL / 10 NTSC vblanks
export type Region = keyof typeof TICK_MS;

export interface KeyBinding { cmd: BcCmd; /** held key repeats (movement, turning, attacks) */ repeat: boolean }

const turn = (by: 1 | -1): BcCmd => ({ kind: 'turn', by });
export const DEFAULT_KEYMAP: Record<string, KeyBinding> = {
  KeyW: { cmd: { kind: 'move', dir: 'forward' }, repeat: true }, ArrowUp: { cmd: { kind: 'move', dir: 'forward' }, repeat: true },
  KeyS: { cmd: { kind: 'move', dir: 'back' }, repeat: true }, ArrowDown: { cmd: { kind: 'move', dir: 'back' }, repeat: true },
  KeyQ: { cmd: turn(-1), repeat: true }, ArrowLeft: { cmd: turn(-1), repeat: true }, KeyE: { cmd: turn(1), repeat: true }, ArrowRight: { cmd: turn(1), repeat: true },
  KeyO: { cmd: { kind: 'openDoor' }, repeat: false },
  Space: { cmd: { kind: 'attack', char: 0 }, repeat: true }, Digit1: { cmd: { kind: 'attack', char: 0 }, repeat: true }, Digit2: { cmd: { kind: 'attack', char: 1 }, repeat: true },
  Digit3: { cmd: { kind: 'attack', char: 2 }, repeat: true }, Digit4: { cmd: { kind: 'attack', char: 3 }, repeat: true },
};

export interface PlayLoopOptions {
  region?: Region;
  keymap?: Record<string, KeyBinding>;
  /** how long a key must be held before it repeats (ms) [hyp] */
  repeatDelayMs?: number;
  /** a held key repeats once every this many ticks [hyp: 1] */
  repeatEveryTicks?: number;
  /** commands handed to the engine per tick [hyp: 2, the old shell's value] */
  maxCmdsPerTick?: number;
  /** longest backlog of unplayed ticks kept when the host stalls */
  maxCatchUpTicks?: number;
}

interface Held { binding: KeyBinding; since: number; lastTick: number; fired: boolean }

export class PlayLoop {
  readonly st: BcState;
  readonly tickMs: number;
  paused = false;
  private readonly keymap: Record<string, KeyBinding>;
  private readonly delay: number; private readonly every: number; private readonly budget: number; private readonly cap: number;
  private now = 0; private acc = 0; private tickNo = 0;
  private held = new Map<string, Held>();
  private taps: BcCmd[] = [];
  /** commands queued by `command()` (mouse clicks and the like) */
  private queued: BcCmd[] = [];
  constructor(st: BcState, o: PlayLoopOptions = {}) {
    this.st = st; this.tickMs = TICK_MS[o.region ?? 'PAL']; this.keymap = o.keymap ?? DEFAULT_KEYMAP;
    this.delay = o.repeatDelayMs ?? 400; this.every = Math.max(1, o.repeatEveryTicks ?? 1); this.budget = o.maxCmdsPerTick ?? 2; this.cap = o.maxCatchUpTicks ?? 5;
  }
  get ticks() { return this.tickNo; }
  keyDown(code: string) {
    const b = this.keymap[code]; if (!b || this.held.has(code)) return;   // an OS-level repeat event of a key already down is ignored: repeat is ours
    this.held.set(code, { binding: b, since: this.now, lastTick: -1, fired: false });
  }
  /** release; a key that never got its first tick (tapped and released inside one tick period) still fires once on the next tick */
  keyUp(code: string) { const h = this.held.get(code); if (h && !h.fired) this.taps.push(h.binding.cmd); this.held.delete(code); }
  /** drop every held key (window blur): a key released while the page was not listening must not stay down */
  releaseAll() { this.held.clear(); }
  /** a command that is not a key (a click on a door): played on the next tick */
  command(c: BcCmd) { this.queued.push(c); }

  /** the commands for the tick that starts now: first tick of a press always fires (a tap is never lost), then repeats after the delay */
  private poll(): BcCmd[] {
    const out: BcCmd[] = [...this.queued.splice(0)];
    const t = this.now - this.acc;   // the tick boundary in loop time
    for (const h of this.held.values()) {
      if (!h.fired) { out.push(h.binding.cmd); h.fired = true; h.lastTick = this.tickNo; continue; }
      if (h.binding.repeat && t - h.since >= this.delay && this.tickNo - h.lastTick >= this.every) { out.push(h.binding.cmd); h.lastTick = this.tickNo; }
    }
    // taps recorded at release (see keyUp)
    out.push(...this.taps.splice(0));
    return out.slice(0, this.budget);
  }
  /** advance the loop by `dtMs` of (real or fake) time; returns the engine events of the ticks that ran */
  update(dtMs: number): { ticks: number; events: BcEvent[] } {
    this.now += dtMs;
    if (this.paused) return { ticks: 0, events: [] };
    this.acc += dtMs;
    const events: BcEvent[] = []; let n = 0;
    while (this.acc >= this.tickMs && n < this.cap) {
      const cmds = this.poll();
      this.acc -= this.tickMs;
      events.push(...BcEngine.step(this.st, cmds));
      this.tickNo++; n++;
    }
    if (this.acc >= this.tickMs) this.acc %= this.tickMs;   // stalled host: drop the backlog beyond the cap
    return { ticks: n, events };
  }
}
