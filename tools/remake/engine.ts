/**
 * The shell <-> engine contract (docs/remake-architecture.md). Types only: no UI, no I/O, no game knowledge.
 * Settled by the Black Crypt engine (tools/blackcrypt/remake/engine.ts); a second title may still force changes.
 */

/** The user's own retail files, by relative name (e.g. 'bcdfs'). Bytes are read lazily by the shell (fs in node, fetch in the browser). */
export interface FileSet {
  has(name: string): boolean;
  /** undefined when absent */
  read(name: string): Uint8Array | undefined;
  size(name: string): number | undefined;
}
export const fileSetFromMap = (m: Map<string, Uint8Array>): FileSet => ({
  has: n => m.has(n), read: n => m.get(n), size: n => m.get(n)?.length,
});

export interface Detection { engine: string; variant: string; title: string; /** what was matched, for the launcher */ evidence: string[] }

/** One row of the rules coverage a shell can show (grades as in the game-rules status blocks) */
export interface CoverageRow { area: string; grade: 'harness' | 'code' | 'hyp' | 'open' | 'stub'; note?: string }

export interface Engine<World, State, Cmd, Ev, View> {
  readonly id: string;
  /**
   * `mode` 'realtime' (the default when absent; Black Crypt): `tickMs` is the real time one `step` covers (BC: 8 PAL vblanks = 160 ms) and the shell calls `step` on that clock.
   * `mode` 'turn' (Might & Magic II, 2026-11-27): time only passes when the player commands it. A shell must call `step` only with a non-empty `cmds`; `tickMs` is merely the polling
   * period for held-key repeat, and an engine must treat a `step` with no commands as a no-op (so a clock-driven shell that ignores `mode` is harmless).
   */
  readonly timing: { tickMs: number; mode?: 'realtime' | 'turn' };
  detect(files: FileSet): Detection | null;
  /** build the immutable per-install data (maps, tables). Pure given the bytes; may be async for shells that stream. */
  load(files: FileSet, variant: string): World | Promise<World>;
  /** a fresh game. The seed fully determines every random draw. */
  newGame(world: World, seed: number, opts?: unknown): State;
  /**
   * ONE tick with this tick's commands (zero or more). Mutates `state` in place and returns the events of this tick:
   * the verified rules run on large mutable images, so the draft's `(state) -> {state}` value semantics were dropped;
   * use save/restore for a snapshot.
   */
  step(state: State, cmds: Cmd[]): Ev[];   // a turn-based engine (`timing.mode === 'turn'`): one command = one step of play; `[]` = no-op
  /** everything a shell needs to draw and play this moment; no engine internals */
  view(state: State): View;
  /** JSON-serialisable snapshot, bytes via TextEncoder (stable key order). `restore` needs the same `world`. */
  save(state: State): Uint8Array;
  restore(world: World, bytes: Uint8Array): State;
  coverage(): CoverageRow[];
}
