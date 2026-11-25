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

## Status

First engine: Black Crypt (core under construction, see `docs/blackcrypt/remake-plan.md`). The contract is settled by that core and stays open to change when a second title (likely MM2 or W6) implements it.
