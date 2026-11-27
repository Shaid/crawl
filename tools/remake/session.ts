/**
 * A running game: one engine, its world (re-loadable from the user's files), the state, the generic loop, the event log and the save slots. DOM-free; the
 * page (`shell.ts`) only calls this and paints `hudLines()` / `logLines`. Nothing here knows a game's rules.
 */
import type { AnyEngine, AssetAccess, Region } from './registry';
import type { Found, DataSource } from './detect';
import { withFiles } from './detect';
import { ShellLoop } from './loop';
import { AUTOSAVE, SlotError, SlotStore, b64decode, b64encode, exportSlot, importSlot, type SlotRecord } from './slots';
import { evidenceKey } from './detect';

export interface SessionOptions { region?: Region; autosaveSec?: number; now?: () => number; logLimit?: number }

export class GameSession {
  engine!: AnyEngine;
  world: unknown;
  loop!: ShellLoop<unknown, unknown, unknown>;
  seed = 0;
  readonly logLines: string[] = [];
  /** raw engine events of the last `update` (empty when no tick ran), for a view surface */
  lastEvents: readonly unknown[] = [];
  /** last error from a restore / import, for the UI */
  lastError: string | null = null;
  private region: Region;
  private readonly now: () => number; private readonly logLimit: number; private autosaveMs: number; private sinceAutosave = 0;

  readonly found: Found; readonly src: DataSource; readonly assets: AssetAccess; readonly slots: SlotStore;
  private constructor(found: Found, src: DataSource, assets: AssetAccess, slots: SlotStore, o: SessionOptions) {
    this.found = found; this.src = src; this.assets = assets; this.slots = slots;
    this.region = o.region ?? 'PAL'; this.now = o.now ?? Date.now; this.logLimit = o.logLimit ?? 200; this.autosaveMs = (o.autosaveSec ?? 0) * 1000;
  }

  static async open(found: Found, src: DataSource, assets: AssetAccess, slots: SlotStore, o: SessionOptions = {}): Promise<GameSession> {
    const s = new GameSession(found, src, assets, slots, o);
    s.engine = found.entry.bind ? await found.entry.bind(assets) : found.entry.engine;
    s.world = await s.loadWorld();
    return s;
  }

  /** the world is re-read from the user's files every time (a save never contains it) */
  private loadWorld() { return withFiles(this.src, this.found.files, f => this.engine.load(f, this.found.detection.variant)); }

  get tickMs(): number { return this.found.entry.hints.regions?.[this.region] ?? this.engine.timing.tickMs; }
  setRegion(r: Region) { this.region = r; if (this.loop) this.loop.tickMs = this.tickMs; }
  setAutosave(sec: number) { this.autosaveMs = sec * 1000; }

  private makeLoop(state: unknown) {
    this.loop = new ShellLoop(state, (st, c) => this.engine.step(st, c), this.tickMs, { keymap: this.found.entry.hints.keymap });
    this.sinceAutosave = 0;
  }
  newGame(seed = this.now() >>> 0) {
    this.seed = seed;
    this.makeLoop((this.engine as { newGame(w: unknown, s: number, o?: unknown): unknown }).newGame(this.world, seed, this.found.entry.hints.newGameOptions));
    this.logLines.length = 0;
  }
  get state() { return this.loop.st; }
  view() { return this.engine.view(this.loop.st); }
  hudLines(): string[] { return this.found.entry.hints.hud?.(this.view()) ?? []; }

  /** advance by real time; handles the event log and autosave. Returns the ticks that ran. */
  update(dtMs: number): number {
    const { ticks, events } = this.loop.update(dtMs);
    this.lastEvents = events;
    if (ticks === 0) return 0;
    const d = this.found.entry.hints.describeEvent;
    for (const e of events) { const t = d ? d(e) : null; if (t) this.logLines.push(t); }
    if (this.logLines.length > this.logLimit) this.logLines.splice(0, this.logLines.length - this.logLimit);
    if (this.autosaveMs > 0) { this.sinceAutosave += dtMs; if (this.sinceAutosave >= this.autosaveMs) this.saveSlot(AUTOSAVE); }
    return ticks;
  }

  // ---- slots ----
  private record(name: string): SlotRecord {
    const d = this.found.detection;
    return { format: 'crawl-slot', version: 1, engine: d.engine, variant: d.variant, fingerprint: evidenceKey(d), name, savedAt: this.now(), tick: this.loop.ticks, seed: this.seed, data: b64encode(this.engine.save(this.loop.st)) };
  }
  saveSlot(name: string): SlotRecord { const r = this.record(name); this.slots.put(r); this.sinceAutosave = 0; return r; }
  exportSlot(name = 'export'): Uint8Array { return exportSlot(this.record(name)); }
  /** restore a record (from a slot or an imported file): checked against this install, world re-loaded, then engine.restore; on any failure the running game is untouched */
  async restoreRecord(r: SlotRecord): Promise<void> {
    this.lastError = null;
    try {
      const d = this.found.detection;
      if (r.engine !== d.engine) throw new SlotError(`this save is for ${r.engine}, not ${d.engine}`);
      if (r.variant !== d.variant) throw new SlotError(`this save is for the ${r.variant} version, not ${d.variant}`);
      if (r.fingerprint !== evidenceKey(d)) throw new SlotError('this save was made with different game files');
      const world = await this.loadWorld();
      let st: unknown;
      try { st = this.engine.restore(world, b64decode(r.data)); } catch (e) { throw new SlotError(`the save could not be restored: ${(e as Error).message}`); }
      this.world = world; this.seed = r.seed; this.makeLoop(st); this.logLines.length = 0;
    } catch (e) { this.lastError = (e as Error).message; throw e; }
  }
  async loadSlot(name: string): Promise<void> {
    const r = this.slots.get(this.found.detection.engine, name);
    if (!r) { this.lastError = `no slot ${name}`; throw new SlotError(this.lastError); }
    return this.restoreRecord(r);
  }
  async importFile(bytes: Uint8Array): Promise<void> {
    try { await this.restoreRecord(importSlot(bytes)); } catch (e) { this.lastError = (e as Error).message; throw e; }
  }
}
