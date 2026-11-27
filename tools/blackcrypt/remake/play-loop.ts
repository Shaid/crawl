/**
 * Real-time pacing for the Black Crypt remake shell, with no DOM and no real clock: the loop is driven by `update(dtMs)` and key events, so a test (or a replay) can
 * feed it a fake clock. It owns three things the engine deliberately does not:
 *
 *  - the tick clock: one `BcEngine.step` per tick period (PAL 160 ms = 8 vblanks, NTSC 166.7 ms = 10, game-rules 10.1; the region is a setting, PAL the default [hyp]),
 *    with a catch-up cap so a stalled tab does not replay minutes of game time;
 *  - the key layer: a tap is never lost (a press released between two ticks still produces its command), a held key repeats after a delay;
 *  - the per-tick command budget.
 *
 * The pacing itself is the engine-agnostic `ShellLoop` (tools/remake/loop.ts); this class only binds it to `BcEngine`.
 *
 * Hyp (not in the retail code we read): the repeat delay / rate and the budget. The game polls its input library once per tick; whether it consumes the Amiga keyboard's
 * auto-repeat events or edge events only is not decoded, so repeat is a shell policy, configurable, off for non-movement commands.
 */
import { BcEngine, type BcState, type BcCmd, type BcEvent } from './engine';
import { ShellLoop, type KeyBinding as GenericBinding } from '../../remake/loop';

export const TICK_MS = { PAL: 160, NTSC: 1000 / 6 } as const;   // SetIdlePeriod(10): 8 PAL / 10 NTSC vblanks
export type Region = keyof typeof TICK_MS;

export type KeyBinding = GenericBinding<BcCmd>;

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

export class PlayLoop extends ShellLoop<BcState, BcCmd, BcEvent> {
  constructor(st: BcState, o: PlayLoopOptions = {}) {
    super(st, (s, c) => BcEngine.step(s, c), TICK_MS[o.region ?? 'PAL'], { ...o, keymap: o.keymap ?? DEFAULT_KEYMAP });
  }
}
