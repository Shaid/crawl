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
  /** a graphical front end for this title, if any (the shell itself draws text only) */
  viewUrl?: string;
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
