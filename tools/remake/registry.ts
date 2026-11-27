/**
 * Engine registry: what the shell knows about each title. Registering a new engine is ONE line in `engines.ts`; an entry carries no shell logic, only data and small
 * pure hooks (key map, event text, HUD lines). The shell never imports a game's rules.
 */
import type { Engine } from './engine';
import type { KeyMap } from './loop';

export type AnyEngine = Engine<any, any, any, any, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
export type Region = 'PAL' | 'NTSC';

/** read-only access the shell hands an engine factory for generated (non-retail) assets, e.g. rules tables built by the asset pipeline */
export interface AssetAccess { json<T>(path: string): Promise<T | null> }

export interface ShellHints {
  /** key code -> command (+ whether a held key repeats) */
  keymap?: KeyMap<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** one line of help text under the HUD */
  help?: string;
  /** event -> log line; null / absent = not shown */
  describeEvent?(e: any): string | null;   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** view -> HUD lines (the shell has no idea what a view contains) */
  hud?(view: any): string[];   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** per-region tick period in ms, when the title has a PAL/NTSC difference; absent = the engine's `timing.tickMs`, no region setting */
  regions?: Partial<Record<Region, number>>;
  /** options for `newGame(world, seed, opts)` */
  newGameOptions?: unknown;
  /** a graphical front end for this title on its own page, if any; the shell links to it only when there is no `viewFactory` */
  viewUrl?: string;
  /**
   * An in-shell graphical view: called once per session (and again after a slot load / new game, which replace the engine state) with the shell's canvas and panel area.
   * Returns a surface the shell calls every animation frame with the engine's current View. Absent = the text HUD only (also the fallback when the factory throws).
   */
  viewFactory?(ctx: ViewContext): Promise<ViewSurface> | ViewSurface;
}

/** What the shell hands a `viewFactory`: the surfaces it owns and read-only access to the running game. The factory never sees the session or the engine's internals beyond `state()`. */
export interface ViewContext {
  /** the main picture: backing store 320x200, scaled by CSS; the shell owns its layout */
  canvas: HTMLCanvasElement;
  /** an empty element beside / under the picture for minimap-like panels the factory may fill */
  side: HTMLElement;
  /** the entry's `assetBase` ('' when absent) */
  assetBase: string;
  /** the engine's current state (changes identity only when a new game / slot is loaded, which rebuilds the surface) */
  state(): unknown;
  /** a command from the picture (a click) played on the next tick */
  command(c: unknown): void;
  /** one line of status for the shell to show */
  setStatus(text: string): void;
}

/** What a view factory returns. */
export interface ViewSurface {
  /** once per animation frame. `view` = `engine.view(state)` now; `ticks` = engine ticks that ran since the last frame; `events` = their raw events (empty when none) */
  render(view: unknown, frame: { dtMs: number; ticks: number; events: readonly unknown[] }): void;
  /** called exactly once when the session ends (back to the launcher), or when a slot / new game replaces the state; remove listeners and DOM the factory added */
  dispose(): void;
}

export interface EngineEntry {
  id: string;
  /** shown greyed in the launcher when no data is found */
  title: string;
  /** directories under the data root (relative, no trailing slash) in which this title's retail files may live; detection runs on each */
  dataDirs: string[];
  /** URL prefix of this title's generated (non-retail) assets, for `bind`'s AssetAccess; e.g. '/assets/blackcrypt/amiga' */
  assetBase?: string;
  /** the engine: needs `detect` and `coverage` to work without extra inputs */
  engine: AnyEngine;
  /** optional: produce the runtime engine when `load`/`step` need more than the shell supplies (e.g. BC binds its rules tables) */
  bind?(assets: AssetAccess): Promise<AnyEngine>;
  hints: ShellHints;
}

export class Registry {
  private readonly map = new Map<string, EngineEntry>();
  constructor(entries: EngineEntry[] = []) { for (const e of entries) this.register(e); }
  register(e: EngineEntry) { if (this.map.has(e.id)) throw new Error(`engine ${e.id} registered twice`); if (e.engine.id !== e.id) throw new Error(`entry ${e.id} wraps engine ${e.engine.id}`); this.map.set(e.id, e); return this; }
  get(id: string) { return this.map.get(id); }
  all() { return [...this.map.values()]; }
}
