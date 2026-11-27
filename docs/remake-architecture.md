# Remake architecture (decided 2026-11-26)

Home: `crawl`. Seer stays the cross-platform RE toolkit (formats, extractors); the remake shell and engines live here.
Model: a ScummVM-style host. Concept only; no code from ScummVM or any other GPL project is used (see AGENTS.md, no-ports rule).

## Shape

- **Host shell** (one app): launcher, game detection, input, video/canvas, audio, save slots, settings, event/message log, debug overlays. Knows nothing about any game's rules.
- **Engines** (one per title or family): implement the `Engine` contract below. Each wraps that title's harness-verified rules (`tools/<game>/rules*.ts`), which remain the ground truth and are not merged across titles.
- **Detection**: the user supplies their own retail files. Detection fingerprints files (names, sizes, hashes of structure, never committed retail data) and selects the engine and platform variant. No retail data is shipped or committed; tables and assets are generated at load from the user's data.
- **Data tables**: typed shared schema (monsters, spells, items, classes, map events) with title-specific extension fields, generated at load. Tables hold ids; strings are resolved from the user's files.
- **Shared primitives**: only what a parity test proves identical, or what is deliberately parameterised (grid/facing, bit helpers, event log, condition/effect model, vector-test runner). Each title keeps its own exact RNG behind a common interface.

## Engine contract (settled by the Black Crypt engine; code: `tools/remake/engine.ts`)

```ts
interface Engine<World, State, Cmd, Ev, View> {
  id: string;
  timing: { tickMs: number; mode?: 'realtime' | 'turn' };   // BC: 160 (8 PAL vblanks); MM2: mode 'turn'
  detect(files: FileSet): Detection | null;         // sync; FileSet = has/read/size by name, bytes supplied by the shell
  load(files: FileSet, variant: string): World | Promise<World>;   // immutable per-install data (maps, kit)
  newGame(world: World, seed: number, opts?: unknown): State;
  step(state: State, cmds: Cmd[]): Ev[];            // ONE tick, mutates state in place, returns this tick's events
  view(state: State): View;                         // plain data for the shell; no engine internals
  save(state: State): Uint8Array;  restore(world: World, bytes: Uint8Array): State;
  coverage(): CoverageRow[];                        // harness / code / hyp / open / stub per area, for the shell
}
```

Changes from the first draft, and why:

- **`step` mutates and takes `Cmd[]`** instead of `(state, cmd) -> {state, events}`. The verified rules run on one large mutable memory image (Black Crypt's A4 layout), so copying per tick is wrong in cost and in fidelity; snapshots are `save`/`restore`. A tick takes zero or more commands because the game processes a command batch per tick.
- **`step` returns the events array**, not `{state, events}`.
- **`restore(world, bytes)`** needs the `world` (the maps and tables are never in a save).
- **`load` takes extra engine-specific inputs without changing the shell side**: Black Crypt binds its rules tables (generated from the user's data, or the committed vector tables in tests) with `BcEngine.withRules(rules)`, so the shell still calls `load(files, variant)`. Variant-specific rule data therefore lives in the engine factory, not in `FileSet`.
- **`newGame` has optional engine-specific options** (map, pose) as a third argument; the shell may ignore them.
- **Seed is a number**; each engine maps it onto its own exact RNG (`seedToRng`).
- **`FileSet`, `Detection`, `CoverageRow` defined** (the draft left them open). `detect` is synchronous and needs file sizes and a structural check only.
- **`coverage()` added** per the "report coverage" rule.
- The core has **no UI knowledge**: `describeEvent` is a text helper beside the engine; `view` is data. The first shell piece is `tools/blackcrypt/remake/browser.ts` (tick clock + keys + HUD) on the walker page.

## Rules of the road

- Verified rule modules stay per title and untouched by shell work; engines call them, never copy them.
- A rule is shared across titles only after the same function passes both titles' vector sets.
- No rules DSL until 3-4 engines exist and real overlap is visible.
- Every engine reports its coverage (harness / code / hyp / open) from its game-rules status block, so the shell can show it.

## Shell (built 2026-11-27, `tools/remake/`)

One browser app: `tools/remake/index.html` (dev server: `npm run dev`, open `/tools/remake/index.html`; `?launch=<engine id>` starts a detected game directly). Logic is in DOM-free modules, tested by `tools/remake/shell.test.ts` with a fake engine; `shell.ts` is the thin DOM layer.

- `registry.ts` / `engines.ts`: the engine registry. An `EngineEntry` is data plus pure hooks: `{ id, title, dataDirs, assetBase?, engine, bind?, hints }`. `hints` = key map (`KeyMap`), help text, `describeEvent`, `hud(view)` lines, per-region tick ms, `newGameOptions`, optional `viewUrl`. `bind(assets)` returns the runtime engine when it needs more than `(files, variant)` (Black Crypt binds its rules tables). The shell imports no game rules.
- `detect.ts`: a `DataSource` (list + read) supplies names and sizes; a `LazyFileSet` per candidate directory answers `has`/`size` from the listing and fetches bytes only when `detect`/`load` call `read` (sync contract, retried after the fetch). A throwing `detect` counts as not detected. Nothing is hashed or copied. In the dev server the source is `/data-index.json` (names and sizes, `vite.config.ts`) plus the existing `/data/*` middleware.
- `session.ts`: `GameSession` = engine + world + state + `ShellLoop` + event log + slots + autosave. The world is re-loaded from the user's files on every restore.
- `loop.ts`: the generic pacing (tick clock, tap protection, held-key repeat, command budget, catch-up cap), generalised from Black Crypt's `PlayLoop`, which is now a thin subclass.
- `slots.ts`: save slots. Envelope (JSON, version 1): `{ format: 'crawl-slot', version, engine, variant, fingerprint, name, savedAt, tick, seed, data: base64(engine.save()) }`. `fingerprint` = `engine/variant/sorted detection evidence` (file names and sizes, no hashes). Stored in localStorage as `crawl.slot.<engine>.<name>` (autosave = slot `autosave`; IndexedDB would only be needed for very large saves). Export/import is the same envelope as a `.crawlsave` file. Restore checks engine, variant and fingerprint, re-loads the world, calls `engine.restore` and reports any throw as a `SlotError`, leaving the running game untouched.
- `settings.ts`: region (PAL/NTSC, applied where an entry declares `regions`), volume (placeholder), autosave interval; localStorage `crawl.shell.settings`.
- Coverage: the launcher shows a grade bar and per-area table from `engine.coverage()` for every registered engine, detected or not (missing-data games are greyed).

**Register an engine:** export an `EngineEntry` from the title's folder (Black Crypt: `tools/blackcrypt/remake/shell-entry.ts`) and add one line to the `Registry` list in `tools/remake/engines.ts`.

**In-shell 3D view (2026-11-28).** An entry may supply `hints.viewFactory(ctx) -> ViewSurface` (types in `registry.ts`). The shell owns the canvas (320x200 backing store, CSS-scaled, `image-rendering: pixelated`), a panel area beside it and the animation-frame loop; `ViewHost` (`viewhost.ts`, DOM-free, tested with a fake factory) runs the factory: it builds the surface lazily (async), calls `surface.render(view, { dtMs, ticks, events })` every frame with `engine.view(state)` now (events only on frames where ticks ran), and calls `dispose()` exactly once on exit and whenever the session's state is replaced (slot load, import, new game: it rebuilds a fresh surface on the new state). A factory or render that throws, or an entry without a factory, leaves the text HUD with the reason shown. The context hands the factory `canvas`, `side`, `assetBase`, `state()`, `command(c)` (click -> a command on the next tick) and `setStatus`. Layout (`shell.css`): picture | HUD + event log | slots and coverage at desktop; picture on top at 800-1250 px; one column on a phone.

How a title opts in: `viewFactory: async ctx => (await import('./view-factory')).createXView(ctx)` in its `shell-entry.ts` (the dynamic import keeps the registry light). The walker renderers are reused, not copied: `tools/remake/walker-surface.ts` (`createWalkerSurface`) mounts a walker `GameView` on the shell's canvases through `tools/walker/mount.ts` (`WalkerMount`: the same composite / `renderCanvas` pipeline, minimap and automap window as the walker page) and keeps it in step with the engine's pose (setPose on a move, a new load on a map change). A title supplies only `poseOf(view)`, `load(level, pose)` and optionally `attach(gameView)` (per-frame hook). Black Crypt (`tools/blackcrypt/remake/view-factory.ts`) loads `BlackCryptView` through `tools/walker/bc-loader.ts` (the loader moved out of `walker.ts` unchanged and is imported back; the walker page behaves as before) and attaches `createBcLive` (monsters, doors, floor items, hit effects, door click -> `openDoor`). MM2 (`tools/mm2/remake/view-factory.ts`) drives `MM2View` from `view().pose`. The walker pages `?game=blackcrypt&play=1` / `?game=mm2&play=1` still work as separate sessions; `viewUrl` is shown only for entries with no factory.

Not in the in-shell view yet: audio, touch controls (click on the picture only), the BC party / portrait / log panels (`bc-remake-ui-panel`: the walker draws only the 208x140 viewport), automap zoom, BC spell keys (walker page only), MM2 live scene (`mm2-remake-view`: static map, no monsters, doors not drawn open).

## What the second engine (Might & Magic II, 2026-11-27) taught the contract

`tools/mm2/remake/`, plan in `docs/mm2/remake-plan.md`. A turn-based title on a different memory layout (the 68k DATA hunk of the user's executable) with a rules core that is a set of single routines rather than one simulation. The contract held; three small, additive edits to `tools/remake/engine.ts` and some lessons that are not code:

- **Time is optional.** `timing` gained `mode?: 'realtime' | 'turn'` (absent = realtime, so Black Crypt is unchanged). A `'turn'` engine only advances when a command is given: one command = one `step`, `step(st, [])` is a no-op that returns `[]` and changes no byte, and `tickMs` is only a polling period. A shell must not drive such an engine from a clock (a clock-driven shell that ignores `mode` is harmless because empty steps do nothing). The event `tick` field then counts commands.
- **`newGame` takes `opts?: unknown`** in the contract type (Black Crypt already had it as an engine-specific third argument; the shell passes `hints.newGameOptions`). Typed as `unknown` so each engine narrows it.
- **The "tick" abstraction is a command batch, not a frame**: both engines take `Cmd[]` and return `Ev[]`; nothing else about real time leaked into the contract. Real-time pacing stays in the shell (`ShellLoop`), where it belongs; a turn-based session simply has none.
- **A state that is one memory image is the norm, not an accident.** Both engines run the verified rules on a mutable image of the game's own globals (BC's A4 sim, MM2's DATA hunk + BSS built at load from the user's executable, with its constant tables), so `step` mutates, `save` is the image plus a few engine fields, and `restore(world, bytes)` needs the immutable world. The "mutate in place" decision made for Black Crypt was right for the second title as well.
- **Rules cores come in two shapes, and the engine absorbs the difference.** BC's rules are one simulation (`bc-sim`); MM2's are ~100 harness-verified single routines whose UI-facing callees (the party command menu, the monster action leaves, key prompts) were stubbed in the oracle. The engine therefore owns a thin *action layer* that calls those routines in the order the game's own routines do. Two techniques worth reusing: (1) where a verified routine reports a callee as a logged call (`dmgMon`, `killMon`, `applyHit`), the engine answers it with the real verified rule (the `kills` list of `partyEffect` becomes an oracle backed by `damage_monster`; a write hook on the flag the routine sets becomes `monster_dies`); (2) where a verified loop is monolithic (`roundLoop`), the engine cuts it at the player-input boundary and **proves the cut equal** to the original with a byte-for-byte parity test (same memory, same scripted effects), instead of trusting a re-implementation.
- **Previewing a choice without paying for it.** A prompt that depends on a draw (MM2's encounter: monster list, surprise) can show its result before the player answers by running the verified routine on a *copy* of memory with a default answer, then replaying the real answer on the real memory from the same RNG state. This needed no new rule and no change to the rules code.
- **Coverage honesty matters more with a UI-less rules core.** About a third of MM2's coverage rows are `stub` / `hyp` / `open` because the game's glue (the menu, the step handler, event scripts) is not harnessed; the engine says so in `coverage()` and the plan, and its own policies (reward hand-over, retreat) are marked `hyp`.
- **Detection by names and sizes worked unchanged**, including a structural magic check (the AmigaDOS hunk header) on the one file that needs it.
- **Not forced yet:** a second engine is still too few to justify a shared rules DSL or shared parity helpers; the two parity tests (BC `BcSim`, MM2 `roundLoop` / direct rule calls) have the same shape and are the candidate for a shared test helper when a third engine arrives.

## Status

Engines: Black Crypt (`docs/blackcrypt/remake-plan.md`) and Might & Magic II (`docs/mm2/remake-plan.md`, turn based). The contract is settled by those two and stays open to change when a third title (likely W6) implements it.
