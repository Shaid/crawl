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
  timing: { tickMs: number };                       // BC: 160 (8 PAL vblanks)
  detect(files: FileSet): Detection | null;         // sync; FileSet = has/read/size by name, bytes supplied by the shell
  load(files: FileSet, variant: string): World | Promise<World>;   // immutable per-install data (maps, kit)
  newGame(world: World, seed: number): State;
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

Black Crypt in the shell: text HUD, event log, move/turn/open/attack keys, slots, coverage. The 3D view stays on the walker page (`?game=blackcrypt&play=1`), which now takes its rules binding from the same entry (`bcEngine`) and the same `ShellLoop`; the two front ends are separate sessions. Spell keys and the live scene are walker-page only for now.

## Status

First engine: Black Crypt (core under construction, see `docs/blackcrypt/remake-plan.md`). The contract is settled by that core and stays open to change when a second title (likely MM2 or W6) implements it.
