# `@seer/dungeon` — generic first-person dungeon walker, Black Crypt driving

## Context

`seer/docs/walker.md` (2026-08-02, untracked) specifies a reusable first-person
grid-dungeon renderer as a new package `@seer/dungeon`. It is written **Wizardry 6
first**, with Black Crypt as a second consumer that pressure-tests the design last.

This plan inverts that ordering, and widens the scope to a walker that can back a
real game reimplementation — not just a viewer.

**Why invert:**

- **Black Crypt has no blocking unknowns for the core walker.** W6's plan is gated
  on its `§10.1` — the wall-value → compose-list base index mapping is
  *undocumented* and blocks its M2. Black Crypt's equivalent is fully solved:
  index formulas, gating conditions and exact destination coordinates for every
  wall/ceiling/floor piece are already numeric in the docs.
- **Black Crypt exercises more of the generic surface.** Sub-levels inside a load
  unit, sparse row storage, entity-handle object records, a priority-based display
  list, per-frame click hotspots and multiple palette ramps per tileset are all
  things W6 does not have. Designing against the harder consumer first is what
  makes the abstraction real.

`crawl` today has extracted art, a verified map parser, and **zero renderer code**
(`src/main.ts` is still the untouched `createGame` template). This is its first
runtime.

**Decisions taken:** Black Crypt drives; Wizardry 6 validates the generalisation at
the end. The plan covers the crawl-side exporters. `@seer/dungeon` depends on
`@seer/engine-2d` for lifecycle and input but owns its own pose concept. The
engine-2d camera/input refactor lands **first**. The walker renders and picks; the
host owns behaviour.

---

## Corrections to `walker.md` that this plan supersedes

Verified against the current trees:

| walker.md says | Actually |
|---|---|
| `@seer/engine`, `packages/engine/` | Renamed to **`@seer/engine-2d`** (commits `f806791`, `2d379a1`) |
| `writeIndexedPNG` hardcodes `A = (v===0?0:255)`; propose an options param | **Already fixed** (`efb3cca`) — `io.ts:36-55` takes `{transparentIndex}`, 3 regression tests. Pass `{transparentIndex: null}` for opaque index 0 |
| Black Crypt viewport is at screen `(38,20)` | `(38,20)` is a **screenshot-capture** offset. Descriptor dest coords are screen coords with the **viewport at screen origin `(0,0)`**, 208×140; the equipment panel occupies x = 208…320 |
| Side-wall pieces are `near`/`far` | They are **left/right** (`:6924-6934`). `scripts/bclib/bcdfxyz.py:88-95` slugs are stale, and the extracted atlas frame names inherit the error |
| `bcdfs` at `:6243-6773` | That range is the display-list section; `bcdfs` is at **`:7748-8330`** |

`walker.md` §3.3's claims about `Camera`, `InputManager`, `Game.onUpdate`,
`sliceAtlas` and `loadAssets` were **all re-verified as still true**.

---

## Phase A — fix `@seer/engine-2d` first

Blast radius is small: only `middilgard/src/engine/Game.ts:98,109` constructs
`Camera`/`InputManager` directly. crawl and sorcery import `createGame` only and
never touch the camera. So this is a one-consumer migration.

**A1 — Camera becomes an interface with implementations.**

```ts
interface Camera {                    // what Game and renderers actually need
  readonly kind: string;
  applyTo(stage: Container): void;    // each camera decides what "view" means
  setViewSize(w: number, h: number): void;
}
class TopDownCamera implements Camera  // today's x/y/zoom — clamping now OPT-IN
class SideViewCamera implements Camera // middilgard's scene compositor view
```

The current `_clamp()` (`Camera.ts:173-188`) forces the world to fill the viewport
and is called unconditionally from all six mutators. It becomes
`clampToWorld?: boolean`, default `true` so existing behaviour is preserved.

`@seer/dungeon` supplies `FirstPersonCamera` — a thin adapter over `DungeonPose`
that satisfies the interface so hosts get one uniform API, while being explicit
that it is not an affine transform. It selects geometry; it does not pan or zoom.

**A2 — split input from camera control.** New dep-free subpath
`@seer/engine-2d/input` (mirroring the existing `./pixi-helpers` precedent),
exporting the primitive the framework currently lacks:

```ts
class KeyState   { isDown(code): boolean; consumePress(code): boolean; destroy(): void }
class PointerState { position; buttons; consumeClick(): {x,y} | null }
```

`InputManager` keeps its current behaviour but is re-expressed as a
`CameraController` built *on* `KeyState`, instead of hardwiring WASD into
`camera.pan()` at `InputManager.ts:93-96,110`.

**A3 — `Game` becomes camera-agnostic and passes delta time.** Today
`GameOptions` requires `worldWidth`/`worldHeight` and constructs a `Camera`
unconditionally (`Game.ts:58-69`) — meaningless for a first-person view. Change to
`camera?: Camera | CameraFactory` (defaulting to `TopDownCamera` for
compatibility), moving world bounds into that camera's own options. And
`onUpdate: (game, dtMs) => void` — the ticker's delta is currently discarded
(`Game.ts:75`), yet animation timing and step throttling both need it.

*Done when:* engine-2d's existing tests pass, middilgard's `Game.ts` is migrated,
and crawl/sorcery are untouched because `createGame` still defaults correctly.

---

## Phase B — `@seer/dungeon`

At `/home/ctemplet/Development/seer/packages/dungeon/`. Adding a package is
mechanical (`{package.json, tsconfig.json, src/index.ts}`); the root tsconfig
include-glob and `vite.config.ts` test glob pick it up automatically. Consumers
link it as `file:../seer/packages/dungeon`, as crawl already does for five others.

```jsonc
{
  "name": "@seer/dungeon", "version": "0.0.1", "type": "module",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" },
  "peerDependencies": { "pixi.js": "^8.9.0" },
  "dependencies": { "@seer/core": "*", "@seer/engine-2d": "*" }
}
```

`./schema` is a zero-dependency subpath so Node-side exporters can import the
types without pulling in PixiJS.

```
src/
  schema/   level.ts slots.ts semantics.ts bindings.ts validate.ts version.ts
  model/    CellQuery.ts FlatGridLevel.ts RegionGridLevel.ts Pose.ts Direction.ts
  view/     ViewSpec.ts buildViewList.ts DrawItem.ts Hotspot.ts order.ts
  raster/   IndexedSurface.ts PieceBank.ts composite.ts palette.ts anim.ts
  render/   PixiPresenter.ts CanvasPresenter.ts FirstPersonCamera.ts
  input/    WalkerController.ts keyLabels.ts
  automap/  AutomapState.ts AutomapRenderer.ts
  actors/   ActorLayer.ts
  debug/    Minimap.ts SlotInspector.ts
  __tests__/
```

### What is already solved for Black Crypt (no RE needed)

- Viewport 208×140 at screen origin; 12 squares = 4 depths × 3 laterals, visited
  depth 0→3, lateral `{0,+1,−1}`, `depthKey` 11→0 (`:6172-6196`).
- Front-wall row gated `depth < 3`; side walls gated `lateral == 0`
  (`:6214-6218`) — the source of the 3-vs-4 depth asymmetry.
- Wall bit for facing `f` = `1 << (12+f)`; left `(f+3)&3`, right `(f+1)&3`.
- Facing deltas `0=N ⇒ Y+1`, `1=E ⇒ X+1`, `2=S ⇒ Y−1`, `3=W ⇒ X−1` — **Y increases
  northward**, so `yAxisDown: false` is confirmed, not a guess.
- Index formulas: front `depth*3 + (lateral+1)` → 9; side `depth*2 + side` → 8
  (`:6055`, `:6900-6901`); saturation proved 9/9 and 8/8.
- **Exact placement already numeric in the doc** — 9 front pieces + ceiling + floor
  with `(x,y,w,h)` (`:5208-5224`), 8 side pieces likewise (`:5377-5389`). Tiling
  verified `16+176+16 = 48+112+48 = 64+80+64 = 208`, zero gap/overlap.
- Two compositing primitives: an opaque CPU copy (front walls, ceiling, floor,
  alcoves, plaques, stairs) and a mask blit, minterm `$0FCA` = `mask ? colour :
  screen` (side walls, doors, pillars, pits, buttons, chains, floor items).
  **Black Crypt never needs a bitwise-`or` blend** — that is W6-only.

### Key decision: indexed art, forced by evidence

`scripts/bclib/palette.py:139-155` — `tileset_ramps()` maps each tileset to the
*set* of accent ramps it renders under, but `read_dungeon_palette_for_tileset`
bakes only the **primary** ramp ("the lowest-numbered level that loads the
tileset"). **`bcdfx` serves ramps 0 and 3**, so the committed
`textures/dungeon-bcdfx.png` is right for levels 1–4 and **wrong for levels
12–13**. One baked-RGBA atlas cannot serve both.

Indexed art plus a runtime palette fixes this, makes all 12 accent ramps free,
keeps `@seer/core`'s existing `cyclePalette` usable, and makes the compositor
output a `Uint8Array` assertable byte-for-byte in Vitest — matching the
`packages/pipeline/src/__tests__/io.test.ts` house style (construct in-test,
compare arrays; the repo has no committed golden binaries).

Masks in Black Crypt are a **separate source plane** (side walls are 7 planes,
mask first), not an index-0 convention — the schema expresses this rather than
assuming transparent-index-0.

### Data model — files a game provides

Emitted to `public/assets/<game>/<platform>/dungeon/`, each with
`schemaVersion: 1`; the loader hard-fails on an unknown major version.

**`levels.json`**

```ts
interface DungeonLevelFile {
  schemaVersion: 1; game: string; platform: string;
  cellSpace: { kind:'flat'; width; height } | { kind:'regions'; regionCount; regionSize; … };
  wallStorage:
    | { kind:'bitflags'; plane: string; bits:[number,number,number,number] }   // BC
    | { kind:'shared-edge'; planes:[string,string]; planeDirs:[Dir4,Dir4]; offMapValue }
    | { kind:'per-cell-4'; planes:[string,string,string,string] };
  yAxisDown: boolean;
  units: LevelUnit[];                     // "load unit" — a BC map, a W6 level
  entities?: Record<string, EntityRecord>;
}
interface LevelUnit {
  id: number; name?: string;
  planes: Record<string, number[]>;       // BC: wallFlags, type, sublevel, handle
  sublevelPlane?: string;                 // BC: one unit holds many logical levels
  sublevels?: { id; label?; tileset; paletteRamp }[];
  tileset?: string; paletteRamp?: number;
}
```

The **load-unit / sublevel split is the main generalisation Black Crypt forces**
and W6 would never have surfaced: a `bcdfs` map is a load unit, not a level — 13
maps carry 28 levels, selected per-square by a 4-bit nibble, nibble 0 meaning
"belongs to no level" (`:4215-4229`). Tileset and ramp are chosen per map
(`:4855-4870`).

Sparse on-disk rows are **densified on export** to a flat 64×64 — which is what
the game itself does at runtime (`A4−0x37CA`, indexed `(row<<8)|(col<<2)`). Sparse
storage is a file detail, not a model.

`EntityRecord` keeps a typed core (`type`, `gfx`, `wallMask`, `slotNibble`,
`chainNext`, `flags`) plus an opaque `raw` byte array, so doors and props render
without the schema modelling all 36 action opcodes.

**`slots.json`**

```ts
interface SlotTableFile {
  schemaVersion: 1;
  surface:  { width: 320; height: 200 };
  viewport: { x: 0; y: 0; width: 208; height: 140 };
  depthCount: 4; lateralOffsets: [0,1,-1]; frontWallMaxDepth: 3;
  banks: PieceBankRef[];
  slots: Record<string, Slot | null>;   // "front:<lateral>:<depth>" | "side:<L|R>:<depth>"
  staticSlots?: Slot[];                 // ceiling, floor
}
interface PieceDraw {
  bank: string;
  frame: string | AnimRef;              // see "animated decorations"
  destX; destY; srcX?; srcY?; srcW?; srcH?;
  mirrorX?: boolean;
  blend: 'replace' | 'mask' | 'or';
  maskSource?: 'plane' | 'index'; maskIndex?: number;
  priority: number;                     // the game's own descriptor priority byte
  hotspot?: { code: number };           // makes this piece clickable
  origin?: string;                      // "FrontWallTableDirect[4] @ S_1+0x22CE2"
}
```

Draw order reproduces the game's display list rather than a naive far-to-near
sort: a stable sort on `(priority, depthKey)`, `priority & 0x80` meaning "draw
first" (`:6254-6260`). Documented priorities — `0x80` free-standing, `0x64` walls,
`0x5A/0x59` wall-mounted, `0x47` door slot, `0x3D/0x3C/0x3B` doors and props,
`0x1E` monsters.

**`semantics.json`** binds raw values to behaviour and piece kinds
(`blocksMovement`, `blocksSight`, `pieceKind`) and carries
`confidence: 'confirmed' | 'rendered' | 'hypothesis'`, surfaced in the debug
banner. For Black Crypt most entries are `confirmed` — wall bits and the type
nibble are independently cross-checked by the movement state machine
(`:8410-8419`) and by `automap_tiles.py`.

**`bindings.json`** — see input, below. All four files are config; nothing about a
specific game is compiled into the package.

### Runtime

- **`buildViewList(level, pose, spec, semantics, slots, tick) → {items, hotspots}`**
  — pure, no DOM, no PixiJS. Walks the game's own enumeration, tests the wall
  bits, applies the `depth<3` / `lateral==0` gates, emits slot lookups. Fully
  unit-testable; this is the layer middilgard never had and never tested.
- **`IndexedSurface`** — `Uint8Array` of palette indices, `blit(src,…,mirrorX,blend)`.
  `replace` writes; `mask` writes where the mask plane is set. Mirroring is exact
  pixel reversal in index space.
- **`palette.ts`** expands index → RGBA for the unit's accent ramp; presenters
  upload it — `PixiPresenter` via a v8 `BufferImageSource` behind one integer-scaled
  `nearest` `Sprite`, `CanvasPresenter` via `putImageData` for the harness and Node
  tests.
- The walker takes a **`Container`, never an `Application`**, so a host composes a
  HUD above it. It owns no game state beyond pose + visited set + entity patches,
  and exposes `serialize()` / `restore()` so a reimplementation can save games.

---

## Phase C — crawl-side exporters — **DONE**

Both in **Python**, under `scripts/`, where the verified parsers already live
(tilesets, monsters and screens are Python today; only portraits go through the
TypeScript pipeline). Output to `public/assets/blackcrypt/amiga/dungeon/`.

> **Status:** `scripts/export_dungeon_levels.py`, `scripts/export_dungeon_slots.py`
> and `scripts/export_dungeon_tileset_indexed.py` are real, independently-run
> scripts (matching the existing pattern of `extract_monsters.py`/
> `extract_clipper.py`, not folded into `render_all.py`'s single body, which
> already documents several asset types it deliberately excludes). Not wired
> into the `npm run extract-all` chain — run them directly. Full verification
> evidence, including the `bcdfs.read_dungeon_world` collision discovery and
> the slots.json re-verification result, is in
> `amiga/data-structure.md` § "`@seer/dungeon` walker exports (Phase C,
> confirmed)".

1. **Refactor first** — promote `automap_tiles.py:72-140`'s `load_world()` into
   `scripts/bclib/bcdfs.py` as public API returning `(squares, records)`, and have
   `automap_tiles.py` consume it instead of duplicating the walker and reaching
   into `bcdfs._Cursor` / `_signed` / `_word`.
2. **`export_dungeon_levels.py`** → `levels.json`. Densifies the 13 maps to 64×64,
   splits `wallFlags`/`type`/`sublevel`/`handle` planes, emits the 20-byte object
   records as `EntityRecord`s with chains resolved.
3. **`export_dungeon_slots.py`** → `slots.json`. Transcribes the already-numeric
   direct tables, then **verifies each value by re-reading the raw descriptors**
   from `data/blackcrypt/extracted/bcdft_decompressed.bin` at `S_1+0x22CE2`
   (front, 9×20 B) and `S_1+0x22E4A` (side, 8×28 B). The 28-byte record is
   self-validating (`bytesPerPlane == (w/8)*h`; `BLTSIZE == (h<<6)|(w/16+1)`;
   `modulo + blitBytes == 40`), so a mis-transcription cannot pass silently.
4. **Indexed tileset export** — emit palette indices with `{transparentIndex: null}`
   plus the mask plane, and emit every ramp a tileset serves, not just its primary.

---

## Phase D — the interactive layer

### Input and keybindings (config-driven, positional)

`KeyboardEvent.code` is **already positional** — it names the physical key, so an
AZERTY user pressing the key labelled *Z* reports `KeyW`. Defaulting bindings in
`code` space therefore gives layout independence for free, and AZERTY/QWERTZ users
get the same physical finger positions.

```ts
const DEFAULT_BINDINGS = {          // modern WASD + QE, all overridable
  forward:['KeyW','ArrowUp'],  back:['KeyS','ArrowDown'],
  strafeLeft:['KeyA'],         strafeRight:['KeyD'],
  turnLeft:['KeyQ','ArrowLeft'], turnRight:['KeyE','ArrowRight'],
  interact:['Space'],          automap:['Tab'],
};
```

Bindings load from `bindings.json` (or are passed in) and are validated by the
schema. For *displaying* a binding, `keyLabels.ts` uses
`navigator.keyboard.getLayoutMap()` where available (Chromium) and falls back to a
static table, so an AZERTY user sees "Z" for `KeyW` rather than a lie. Add
`mode: 'positional' | 'literal'` for anyone who genuinely wants letter matching.

`WalkerController.update(dtMs, keys) → Pose | null` stays pure w.r.t. time, so
step throttling is testable without a DOM. Motion is grid-quantised: the art *is*
the projection, and no half-step or 45° pieces exist in either game.

### Mouse interactivity

Black Crypt's hotspots are **written per-frame by the same handlers that draw each
piece** (`:6858-6871`) — two `{x,y,w,h}` + code blocks, reset every frame, covering
"pull the chain", "search the alcove", "read the plaque", "press the switch", "use
the fountain". So picking must come from hotspots carried on `DrawItem`s, not a
static table. Known codes: `0x6B` door lock, `0x64` door switch, `0x69` alcove,
`0x6A`/`0x6F` plaque, `0x6D` switch, `0x6E` fountain/panel.

`walker.pick(containerX, containerY)` maps through the presenter's integer scale
into surface space and hit-tests the frame's hotspots topmost-first, firing
`onInteract(hotspot, entity)`. **The host decides what happens.** The walker only
exposes `setEntityState(handle, patch)` to mark the view dirty — door open state is
bit 0 of record `+0x0F`, locked is bit 1 of word `+0x0E` (`:9264-9300`), and the
walker reports both without opining. Opening a locked door is therefore a host
policy; the debug harness ships it as an explicit cheat toggle.

### Animated decorations

`fire-animation.json` is **already extracted** — 15 frames, `ticksPerFrame: 4`,
`periodTicks: 60`, with per-instance `phaseTicks`. So the model is proven and needs
no new RE:

```ts
type AnimRef = { frames: string[]; ticksPerFrame: number; periodTicks?: number;
                 phase?: 'fixed' | 'cell' };  // 'cell' = seed from cell coords
```

The compositor takes a `tick`; `phase: 'cell'` derives the offset deterministically
from cell coordinates (middilgard's position-seeded pattern,
`bscene.ts:734-783`) so revisiting a corridor reproduces identically with zero
storage. This **changes the redraw model**: v1 recomposites on pose change only,
but animation needs a clock. Keep it cheap by recompositing only when a *visible*
animated piece crosses a frame boundary — a dirty flag, not an unconditional 60 Hz
loop. (320×200 = 64,000 bytes; a full recomposite is sub-millisecond regardless.)

### Automap

Black Crypt already has the data: automap tile indices live in square bits 27–20
(`0xFF` on disk, populated at runtime — verified across all 15,168 squares), there
is a 16-entry automap type dispatch in `automap_tiles.py:163-201`, and an
`automap.json` palette ships.

Generic design: `AutomapState` holds a per-unit visited bitset and is fed by the
walker's `onEnterCell`; `AutomapRenderer` maps cell planes → automap tile via a
`semantics`-bound function and composites into its own `IndexedSurface`, so it
reuses the exact same blit/palette code as the main view. Visited state is part of
`serialize()`. `CellQuery` stays the single read path, so fog-of-war is a decorator
rather than a special case.

### Actors (mobs) — hook only, no AI

`walker.setActors([{unit, x, y, facing, frame|anim, priority?}])`. The view builder
resolves each actor's cell to its `(depth, lateral)` slot and merges it into the
draw list at Black Crypt's documented monster priority (`0x1E`, kind 13). **No AI,
pathing or combat in this package** — behaviour lives in the host or a later
`@seer/mob`. This keeps the walker a view+input layer, which is what makes it
reusable and reimplementation-friendly.

---

## Phase E — documentation

The package must be portable by someone else without reading its source.

- `packages/dungeon/README.md` — quickstart, the three-file contract, the pre-1.0
  "interfaces change without notice" banner.
- **`docs/porting-guide.md`** — the load-bearing document. A worked example
  answering: what are my depths and laterals? where do slot keys come from? how do
  I express my wall storage? what if my art isn't atlas frames? Uses **EOB** as the
  worked case, since `docs/eotb/amiga/eotb-vmp-spec.md` gives a complete third
  model: a 22×15 block-grid view cone, 25 wall positions read from 17 map cells,
  tile indices carrying `z_mask:1 | mirror_x:1 | tile_index:14`. That is genuinely
  different from both driving games and is exactly the pressure the guide should
  document — reserved as a future `PieceDraw` variant
  `{kind:'blockGrid', indices, cols, rows, blockSize}`, **not built in v1**.
- `docs/schema-reference.md` — every field, with the confidence convention.
- A checklist for "is my walker correct?" — the invariants worth asserting
  (slot saturation, viewport tiling, mirror symmetry) generalised from how Black
  Crypt's were proved.

---

## Milestones

| | Milestone | Done when |
|---|---|---|
| **A** | engine-2d camera interface + input split + `Game` delta/camera-agnostic | engine-2d tests pass; middilgard migrated; crawl/sorcery untouched |
| **M0** | `@seer/dungeon` skeleton, four schemas, validators | Validators accept fixtures, reject a bad `schemaVersion`; `npm test` green |
| **M1** | ~~**Static corridor, zero new RE**~~ **DONE** — surface, bank, composite, palette, both presenters, fed by the doc's numeric tables | Browser shows a correct 208×140 corridor **and** a Node test asserts the `Uint8Array`. Do not proceed on a "close enough" render — the fault space is ~200 lines of blit/mirror/clip maths |
| **M2** | ~~Exporters C1–C3; `CellQuery`, `FlatGridLevel`, `Pose`, `buildViewList`~~ **DONE** — `scripts/export_dungeon_levels.py`/`export_dungeon_slots.py`/`export_dungeon_tileset_indexed.py`; `@seer/dungeon`'s `model/{CellQuery,FlatGridLevel,Pose,Direction}.ts`, `view/{ViewSpec,DrawItem,buildViewList}.ts`, `raster/composite.ts`'s `compositeDrawList` | A pose renders consistently with `automap_tiles.py`'s ASCII map for the same cell (confirmed: 3 real poses' `buildViewList` item counts — 3, 3, 1 — match hand-derived expectations from the same `wallFlags` bits automap itself reads); a sweep over 13 maps × 50 sampled cells × 4 facings (2,600 poses, `packages/dungeon/src/__tests__/sweep.test.ts`) gives zero exceptions, zero out-of-atlas frame refs, zero out-of-surface writes |
| **M3** | ~~Movement, collision, bindings, automap~~ **DONE** — `schema/bindings.ts` (positional defaults), `input/WalkerController.ts`, `model/collision.ts` (edge-checked, fail-closed), `automap/{AutomapState,AutomapRenderer}.ts`, `debug/Minimap.ts` | A circuit of a corridor returns to the start pose (confirmed: a real 4-cell open loop found in map 1, walked, returns to the exact starting pose); no pose crosses a cell the automap shows as walled; automap cone matches the view (screenshotted); rebinding works from config |
| **M4** | Interaction + animation: hotspot picking, entity state patches, `AnimRef` clock — **not started**. Indexed art with all ramps is **already done** (Phase C's `export_dungeon_tileset_indexed.py`), just not yet consumed per-pose by the presenters | Clicking an alcove/plaque/switch fires `onInteract` with the right code; levels 12–13 render with ramp 3; torches animate without a 60 Hz full redraw |
| **M5** | Props: **6 of 7 classes DONE** (alcove, plaque, stairs, door-switch, door-lock, floor-item — wired into `slots.json`/`buildViewList`; alcove/plaque/stairs' 8 angled-view descriptors now included via `srcX`/`srcW` crops). Only floor-plate/trap is undrawn — its art is identified (`sprites/ui-panel.json`'s Pressure Plate frames) but the per-square sub-tile position-index formula isn't derived yet (`blackcrypt-floorplate-placement-wiring` in `TODO.md`, lowest priority). `walker-front-wall-handedness` (front row was drawn in the wrong mirror state relative to the side walls) is **fixed**, M1's golden framebuffer regenerated and visually re-confirmed. `walker-mirror-flag-polarity` is **resolved** (the `$48F` flag does not correspond to bit-29 in general — demonstrated, not just hypothesised; simulating it fully is deferred, needs action-chain schema modelling). Actors layer not started | Doors, stairs, pillars, pits, alcoves, plaques, buttons appear at correct positions |
| **M6** | Generalise to Wizardry 6; porting guide | W6 renders with **zero Black-Crypt-specific paths** in the package (grep `blackcrypt`, `bcdf`, `wallFlags`, `0x1000` outside `__tests__/`); BC golden tests still pass |

---

## The one genuine gap, and how it is contained

Placement data for **non-wall props** is not in the docs — only addresses, strides
and index formulas. Missing: alcove index (`+0x24F90`), plaque (`+0x250F0`), stairs
(`+0x25232`), door-lock (`+0x25E12`/`+0x25E5A`), door-switch
(`+0x26070`/`+0x260B8`), floor-plate (`+0x21788`…), floor-item (`+0x27774`), and
the `+0x220CC` scatter table. Also missing: the two **mirrored** descriptor tables
(`+0x22D96`, `+0x22F2A` — 404 bytes located but never transcribed).

Contained because **M1–M4 need none of it**. It is a bounded pass over
`bcdft_decompressed.bin` with all addresses and strides known — scheduled before
M5 and suitable for a `re-codebreaker`.

> **Correction (2026-08-03): "always use the direct tables" is wrong, and the
> `$48F(A5)` write site is now confirmed.** It is `BCHG #2,$48F(A0)` at S_1
> `+0x2492E` (the candidate previously dismissed as a disassembly artefact —
> the instruction before it loads the graphics frame pointer into `A0`, which
> both fixes the boundary and aliases `A0` to `A5`). The flag is a pure toggle
> starting at 0, and on the walk path it flips only when the map square's bit
> `0x20000000` changes — it is **not** facing-derived, so there is no
> "opposite-facing view" to render here. `$48F = 0` is the default for 99.3 %
> of squares, and the `$48F = 0` front-wall branch is `+0x22D96` drawn
> **mirrored**, not `+0x22CE2` drawn direct. v1 therefore renders its
> front-wall row in the wrong handedness relative to its own side walls (which
> already come from the `$48F = 0` table `+0x22E4A`). Full derivation, byte
> evidence and the exact `slots.json` fix:
> `amiga/data-structure.md` § "3D Viewport Compositing" →
> "`ViewpointChanged` (S_1 `+0x2492A`)".

> **M5 status (2026-08-03): all seven placement tables decoded and verified.**
> `scripts/export_dungeon_props.py` transcribes alcove/plaque/stairs/door-lock/
> door-switch/floor-plate/floor-item, all invariant checks passing (see
> `amiga/data-structure.md` § "`scripts/export_dungeon_props.py` → M5 prop
> placement tables"). **Four of seven render**: alcove, plaque, stairs and
> door-switch are wired into `buildViewList`/`slots.json` as `prop:*` slots and
> covered by `packages/dungeon/src/__tests__/props.test.ts` against real
> `bcdfs` cells. The other three are decoded+verified but not wired — door-lock
> needs a per-map art template the current static `Slot` model doesn't support,
> floor-plate's pixel source (graphics-kernel slot `$00`) is still
> unidentified, and floor-item placement needs the entity's own `gfxNumber`
> threaded through three more tables. See `docs/blackcrypt/TODO.md` for the
> per-item rows. The mirror-flag fix above (`walker-front-wall-handedness`) is
> **not applied this pass** — a real, pre-existing handedness bug in the
> front-wall row, orthogonal to props, that needs its own regression pass over
> the M1 golden-framebuffer test.

> **Correction (2026-08-03, later pass): the front-wall fix is applied, and
> door-lock/floor-item/the 8 clipped descriptors are now wired.**
> `walker-front-wall-handedness` is fixed (`export_dungeon_slots.py` now
> reads `+0x22D96` mirrored); the M1 golden framebuffer was regenerated and
> visually re-confirmed (symmetric corridor, no gaps/bleed), with a byte-diff
> against the pre-fix golden showing exactly 9,827/64,000 bytes differ, all
> within the front-wall region. Door-lock renders via a new `FrameTemplate`
> `PieceDraw.frame` shape (`schema/slots.ts`) that `buildViewList`'s
> `resolveDoorLockFrame` substitutes from the pose's `LevelUnit.id` and the
> entity's `gfxNumber` — never reaches the compositor unresolved.
> Floor-item renders via a small `FloorItemPlacement` arithmetic table
> (`anchor(depth,lateral) − registration(group,depth)`, `group` from
> `gfxToGroup[gfxNumber]`) rather than enumerating 441 static slots. The 8
> clipped alcove/plaque/stairs descriptors resolve via `PieceDraw.srcX`/
> `srcW` (already-existing fields, no new compositor code) — `extraSrcOffset`
> is always edge-aligned (`0` or the full/clip width delta), confirmed 8/8.
> `blackcrypt-floorplate-art-source` is also resolved (slot `$00` is `bcdfa`'s
> own UI panel bank, its 4 "Pressure Plate" records byte-exact against the
> floor-plate descriptors) — only the per-square sub-tile position-index
> formula remains open (`blackcrypt-floorplate-placement-wiring`,
> lowest priority). `walker-mirror-flag-polarity` is resolved: the
> correspondence does **not** hold in general (demonstrated against the real
> `bcdfs` corpus, not just argued from code), though full toggle-state-machine
> simulation is deferred. See `docs/blackcrypt/TODO.md` and
> `amiga/data-structure.md`'s M5 sections for full evidence.

---

## Verification

- `npm test` at the seer root — Vitest auto-discovers
  `packages/dungeon/src/__tests__/`. Pure layers (`buildViewList`, `order`, `Pose`,
  `canStep`, `IndexedSurface`, `WalkerController`) get full coverage; assert
  framebuffers with `expect(Array.from(surface)).toEqual([…])` per the `io.test.ts`
  house style.
- Exporter self-checks: the 28-byte descriptor invariants (61/61 across the
  binary), front/side table byte-contiguity (`180, 180, 224, 224` — 4/4 exact), the
  `bcdfs` nibble invariant, the 3,948-byte inter-map padding assertion.
- Cross-check the rendered view against `scripts/automap_tiles.py`'s ASCII map for
  the same pose — an independent, already-verified oracle inside the repo.
- Compare a composited frame against the emulator screenshots already matched at
  `(38,20)`, 208×140, with 0 unmatched palette colours.
- `tools/walker/index.html` on the existing Vite dev server, reading
  `map`/`x`/`y`/`facing` from URL params so a broken pose is a shareable link,
  with the slot inspector, automap and `semantics.confidence` banner alongside.

---

## Also queued (unrelated, from mid-session)

Three `www/src/components/SpriteGallery.astro` changes, verified against
`item-names.json`, to apply once out of plan mode: add hover pairs FIRE WAND
(`item069`→`item070`) and STORM WAND (`item098`→`item099`); make the active icon
**replace** the base rather than crossfade over it; and give WATER SKIN
(`item133`→`item134`→`item135`) a click-to-empty easter egg that latches at empty.
