/**
 * Per-game walker views (`tools/walker/walker.ts`'s pluggable backends).
 *
 * A `GameView` is everything the generic harness shell needs to drive one
 * game: the level/pose/controller, the `DrawItem`s to composite, the palette
 * to present with, and (optionally) the automap/minimap backing (Black Crypt
 * only, for now). Black Crypt uses the `@seer-project/dungeon` `Walker`
 * facade + `buildViewList` (walls, M5 props, interaction hotspots,
 * ramp-aware tileset, torches, automap); Wizardry 6 uses the same
 * `WalkerController` input/pose layer but its own compose-list-driven
 * `buildViewItems` (`tools/wizardry6/view-model.ts`) — the W6 wall dispatch
 * (`EvalCellFace`) is game code, so the package stays generic. MM2 has no
 * walker renderer yet (data codecs only), so it isn't selectable here.
 */
import {
  Walker,
  WalkerController,
  FlatGridLevel,
  canStep as bcCanStep,
  AutomapState,
  type KeyStateLike,
} from '@seer-project/dungeon';
import type { CellQuery } from '@seer-project/dungeon';
import type { PieceBank, PieceBankLookup, RGBAColor, Pose, DrawItem } from '@seer-project/dungeon';
import type {
  SlotTableFile,
  SemanticsFile,
  BindingsFile,
  DungeonLevelFile,
  LevelUnit,
} from '@seer-project/dungeon/schema';
import { type CellPlanes } from '../wizardry6/evaluate-cell.ts';
import { buildViewItems, canStepDir } from '../wizardry6/view-model.ts';

/**
 * A data-derived "map entrance" start pose — the best available signal for
 * where the party arrives on a freshly-loaded map. Neither game encodes a
 * true per-map arrival tile (BC's map header is only a bounding box and its
 * cross-map arrival is set by the teleport/transition code; W6's arrivals
 * are stairs entities in the unexported `scenario.dbs` section 3), so this
 * returns a deterministic, guaranteed-walkable floor tile with an open
 * corridor ahead — never inside a wall. Both predicates are pure functions
 * of the exported planes, so they're testable and shared with the harness.
 */
export function bcEntrancePose(unit: LevelUnit): Pose {
  const width = 64;
  const height = 64;
  const type = unit.planes.type;
  const populated = unit.planes.populated;
  const isFloor = (i: number) => (populated?.[i] ?? 1) !== 0 && ((type?.[i] ?? 0) & 1) === 0;
  // Prefer a floor cell with an open neighbour ahead (a corridor view), then
  // any floor cell. Scan low->high so the result is stable per map.
  const facingDeltas: Array<[number, number, 0 | 1 | 2 | 3]> = [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isFloor(i)) continue;
      for (const [dx, dy, f] of facingDeltas) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (isFloor(ny * width + nx)) return { level: unit.id, x, y, facing: f };
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (isFloor(i)) return { level: unit.id, x: i % width, y: Math.floor(i / width), facing: 0 };
  }
  return { level: unit.id, x: 0, y: 0, facing: 0 };
}

export function w6EntrancePose(planes: CellPlanes, levelId: number): Pose {
  const { width, height, wallA, wallB } = planes;
  const idx = (x: number, y: number) => y * width + x;
  // Prefer an open corner with a clear corridor two-deep to the north (a
  // view that actually shows the corridor, not just a doorway); fall back
  // to any open corner, then any cell with the +Y approach open.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (wallA[i] !== 0 || wallB[i] !== 0) continue;
      if (y + 1 < height && wallA[idx(x, y + 1)] === 0) return { level: levelId, x, y, facing: 0 };
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (wallA[i] === 0 && wallB[i] === 0) return { level: levelId, x, y, facing: 0 };
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (wallA[i] === 0) return { level: levelId, x: i % width, y: Math.floor(i / width), facing: 0 };
  }
  return { level: levelId, x: 0, y: 0, facing: 0 };
}

export interface GameView {
  readonly id: string;
  readonly gameLabel: string;
  readonly levelId: number;
  readonly levelLabel: string;
  readonly pose: Pose;
  readonly items: DrawItem[];
  readonly currentTick: number;
  /** Palette used to present the composited `IndexedSurface`. */
  readonly palette: RGBAColor[];
  /** Piece banks + slot table the harness composites with (`compositeDrawList`). */
  readonly banks: PieceBankLookup;
  readonly slots: SlotTableFile;
  /** Black Crypt only for now — W6 has no automap renderer yet (the package's `AutomapRenderer.tileForCell` is still BC-specific). */
  readonly automap?: { level: CellQuery; bank: PieceBank; state: AutomapState; width: number; height: number };
  /**
   * Full-color canvas renderer (MM1/MM2 frustum walkers). When present the
   * harness calls this instead of the DrawItem composite path — the view
   * draws the whole main canvas (320x200 game-screen space) itself. Draws
   * only when the view reports it is dirty via `currentTick`/pose change;
   * the harness calls it every frame (cheap).
   */
  renderCanvas?(ctx: CanvasRenderingContext2D): void;
  /** Full-color minimap renderer (MM1/MM2). When present it replaces the package `Minimap`. */
  renderMinimap?(ctx: CanvasRenderingContext2D): void;
  update(dtMs: number, keys: KeyStateLike): Pose | null;
  setPose(pose: Pose): void;
  setNoclip(on: boolean): void;
  interactCodes(): string[];
  automapCodes(): string[];
  pick(containerX: number, containerY: number, scale?: number): void;
}

// ─────────────────────────────────────────────────────────────────────────
// Black Crypt — the `Walker` facade + `buildViewList` (walls, M5 props,
// interaction hotspots, ramp-aware tileset, animated torches, automap).
// ─────────────────────────────────────────────────────────────────────────

export interface BlackCryptViewOptions {
  levelFile: DungeonLevelFile;
  slots: SlotTableFile;
  semantics: SemanticsFile;
  bindings: BindingsFile;
  banks: PieceBankLookup;
  palette: RGBAColor[];
  /**
   * Accent ramp 4 ("cold blue-grey") for the unit's tileset, i.e.
   * `palettes/dungeon-<tileset>-ramp4.json` — the underwater/flooded-square
   * re-tint `S_1 +0x02D46` forces while the party stands on a "water"
   * square (type-nibble bit 3, `type & 0x8`), except on level 3, which is
   * exempt. `undefined` when the tileset's indexed-atlas ramp files aren't
   * available (falls back to the baked/default palette everywhere — see
   * `docs/blackcrypt/amiga/data-structure.md` "Selector 2 — per-square
   * override" and "Underwater/flooded-level rendering").
   */
  waterPalette?: RGBAColor[];
  automapBank: PieceBank;
  unit: LevelUnit;
  startPose: Pose;
  onInteract?: (msg: string) => void;
}

/** Type-nibble bit for a "water" square (`bcdfs` on-disk type byte `0x8F`; `docs/blackcrypt/amiga/data-structure.md` "bcdfs — Map / Dungeon Format" § "Square format"). */
const WATER_TYPE_BIT = 0x8;
/** Level 3 is explicitly exempted from the water re-tint by `S_1 +0x02D46` itself (`CMPI.W #$3,$1E5C(A4) / BEQ`), even though it has 5 water-typed squares of its own. */
const WATER_RETINT_EXEMPT_LEVEL = 3;

/**
 * Type-nibble bit for the "darkness" flag (`bcdfs` on-disk type byte
 * `0x2F`) — the map-square condition `MoveParty`'s success tail
 * (S_1 `+0x16F0A`) diffs to gate the `$48F(A5)` mirror-toggle (`ViewpointChanged`,
 * S_1 `+0x2492A`) on the *ordinary walk path only*. `docs/blackcrypt/amiga/
 * data-structure.md` "`ViewpointChanged`" + "`walker-mirror-flag-polarity`"
 * (`docs/blackcrypt/TODO.md`) — the other 9 `JSR $A4982.l` sites
 * (teleport/spell/command triggers) toggle unconditionally and have no
 * representation in this schema; only this one walk-path component is
 * modelled here, per that TODO row's explicit scoping.
 */
const DARKNESS_TYPE_BIT = 0x2;

/** A `front-direct:`/`side-direct:` slot's override for the `$48F != 0` branch (`slots.json`, `scripts/export_dungeon_slots.py`'s `blackcrypt-darkness-mirror-toggle` addition) — just enough of a `PieceDraw` to patch a resolved `DrawItem` post-hoc, without touching `@seer-project/dungeon`'s `buildViewList`/`compositeDrawList`. */
interface MirrorOverride {
  frame: string;
  mirrorX: boolean;
}

export class BlackCryptView implements GameView {
  readonly id = 'blackcrypt';
  readonly gameLabel = 'Black Crypt';
  readonly automap: { level: CellQuery; bank: PieceBank; state: AutomapState; width: number; height: number };
  readonly banks: PieceBankLookup;
  readonly slots: SlotTableFile;
  private readonly walker: Walker;
  private readonly unit: LevelUnit;
  private readonly palette_: RGBAColor[];
  private readonly waterPalette_: RGBAColor[] | undefined;
  private readonly noclip: { on: boolean };
  /** Session-tracked `$48F(A5)` state, seeded false (`AllocMem(...,MEMF_CLEAR)` + `CLR.W $48E(A5)`) — see `DARKNESS_TYPE_BIT` above. */
  private mirrorToggle = false;
  private readonly mirrorOverrides: Map<string, MirrorOverride>;
  private lastMirrorRawItems: DrawItem[] | null = null;
  private lastMirrorToggleApplied = false;
  private lastMirrorItems: DrawItem[] = [];

  constructor(opts: BlackCryptViewOptions) {
    this.unit = opts.unit;
    this.palette_ = opts.palette;
    this.waterPalette_ = opts.waterPalette;
    this.noclip = { on: false };
    this.banks = opts.banks;
    this.slots = opts.slots;
    this.mirrorOverrides = new Map();
    for (const [key, slot] of Object.entries(opts.slots.slots)) {
      if (!key.startsWith('front-direct:') && !key.startsWith('side-direct:')) continue;
      const draw = slot?.draws[0];
      if (!draw || typeof draw.frame !== 'string') continue; // defensive: only plain string frames are produced by export_dungeon_slots.py here
      this.mirrorOverrides.set(key, { frame: draw.frame, mirrorX: draw.mirrorX ?? false });
    }

    const level = new FlatGridLevel(opts.levelFile, opts.unit);
    const worldWidth = opts.levelFile.cellSpace.kind === 'flat' ? opts.levelFile.cellSpace.width : 64;
    const worldHeight = opts.levelFile.cellSpace.kind === 'flat' ? opts.levelFile.cellSpace.height : 64;
    const automapState = new AutomapState(() => ({ width: worldWidth, height: worldHeight }));
    automapState.onEnterCell(opts.startPose.level, opts.startPose.x, opts.startPose.y);
    this.automap = { level, bank: opts.automapBank, state: automapState, width: worldWidth, height: worldHeight };

    this.walker = new Walker(level, opts.slots, opts.semantics, opts.banks, opts.startPose, opts.bindings, {
      // noclip flips the movement gate; the closure reads a mutable flag so
      // the toggle doesn't need to rebuild the Walker.
      canStep: (pose, dir) => this.noclip.on || bcCanStep(level, opts.semantics, pose, dir),
    });
    this.walker.onInteract = (hotspot, entity, handle) => {
      if (entity && handle) {
        const before = { open: (entity.raw?.[0x0f] ?? 0) & 1 ? true : false };
        this.walker.setEntityState(handle, { open: !before.open });
        opts.onInteract?.(
          `interact: hotspot 0x${hotspot.code.toString(16)} on ${handle} — door ${JSON.stringify(before)} -> open:${!before.open}`,
        );
      } else {
        opts.onInteract?.(`interact: hotspot 0x${hotspot.code.toString(16)}`);
      }
    };
  }

  get levelId(): number {
    return this.unit.id;
  }
  get levelLabel(): string {
    return this.unit.name ?? `Map ${this.unit.id}`;
  }
  get pose(): Pose {
    return this.walker.pose;
  }
  get items(): DrawItem[] {
    const raw = this.walker.items;
    if (!this.mirrorToggle || this.mirrorOverrides.size === 0) return raw;
    if (raw === this.lastMirrorRawItems && this.lastMirrorToggleApplied === this.mirrorToggle) {
      return this.lastMirrorItems;
    }
    const mapped = raw.map((item) => {
      const override = this.mirrorOverrideFor(item);
      return override ? { ...item, frame: override.frame, mirrorX: override.mirrorX } : item;
    });
    this.lastMirrorRawItems = raw;
    this.lastMirrorToggleApplied = this.mirrorToggle;
    this.lastMirrorItems = mapped;
    return mapped;
  }
  get currentTick(): number {
    return this.walker.currentTick;
  }
  get palette(): RGBAColor[] {
    // S_1 +0x02D46: entering a "water" square (type-nibble bit 3) re-tints
    // the dungeon accent ramp to 4 (cold blue-grey); leaving restores the
    // level's default ramp. Level 3 is exempt (it has 5 water squares of
    // its own but the routine explicitly skips the retint there).
    if (this.waterPalette_ && this.unit.id !== WATER_RETINT_EXEMPT_LEVEL) {
      const { x, y } = this.walker.pose;
      const type = this.unit.planes.type?.[y * 64 + x] ?? 0;
      if ((type & WATER_TYPE_BIT) !== 0) return this.waterPalette_;
    }
    return this.palette_;
  }
  /** Debug/test visibility into the session-tracked `$48F` state (see `DARKNESS_TYPE_BIT`). Not part of `GameView`. */
  get mirrorToggleActive(): boolean {
    return this.mirrorToggle;
  }

  private mirrorOverrideFor(item: DrawItem): MirrorOverride | undefined {
    if (item.kind === 'front') return this.mirrorOverrides.get(`front-direct:${item.lateral}:${item.depth}`);
    if (item.kind === 'side' && item.side) return this.mirrorOverrides.get(`side-direct:${item.side}:${item.depth}`);
    return undefined;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    const before = this.walker.pose;
    const next = this.walker.update(dtMs, keys);
    // Only the ordinary walk path (an actual cell change) drives the
    // toggle here — see DARKNESS_TYPE_BIT's doc comment for why the other
    // 9 real trigger sites (teleport/spell/command) are out of scope.
    if (next && (next.x !== before.x || next.y !== before.y)) {
      const type = this.unit.planes.type;
      const oldDark = (type?.[before.y * 64 + before.x] ?? 0) & DARKNESS_TYPE_BIT;
      const newDark = (type?.[next.y * 64 + next.x] ?? 0) & DARKNESS_TYPE_BIT;
      if (oldDark !== newDark) this.mirrorToggle = !this.mirrorToggle;
    }
    return next;
  }
  setPose(pose: Pose): void {
    this.walker.setPose(pose);
  }
  setNoclip(on: boolean): void {
    this.noclip.on = on;
  }
  interactCodes(): string[] {
    return this.walker.interactCodes();
  }
  automapCodes(): string[] {
    return this.walker.automapCodes();
  }
  pick(containerX: number, containerY: number, scale = 1): void {
    this.walker.pick(containerX, containerY, scale);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wizardry 6 — `WalkerController` + `buildViewItems` through the package's
// raster layer (indexed atlas + compositeDrawList). No props/hotspots/
// automap yet.
// ─────────────────────────────────────────────────────────────────────────

export interface Wizardry6ViewOptions {
  planes: CellPlanes;
  slots: SlotTableFile;
  bank: PieceBank;
  palette: RGBAColor[];
  bindings: BindingsFile;
  levelId: number;
  levelLabel?: string;
  startPose: Pose;
  /** The level's `FlatGridLevel` (shared-edge walls) — backs the minimap + automap. */
  level?: FlatGridLevel;
  /** Automap tile atlas (reuses Black Crypt's generic wall/floor/facing tiles for now). */
  automapBank?: PieceBank;
  /** Absolute maze coordinate of grid (0,0) (level file `origin`) — phases the checkerboard parities (§4.7.8). */
  origin?: { x: number; y: number };
}

export class Wizardry6View implements GameView {
  readonly id = 'wizardry6';
  readonly gameLabel = 'Wizardry 6';
  readonly automap: { level: CellQuery; bank: PieceBank; state: AutomapState; width: number; height: number } | undefined;
  readonly banks: PieceBankLookup;
  readonly slots: SlotTableFile;
  private readonly controller: WalkerController;
  private readonly planes: CellPlanes;
  private readonly palette_: RGBAColor[];
  private readonly levelId_: number;
  private readonly levelLabel_: string;
  private noclip = false;
  private items_: DrawItem[] = [];
  private tick = 0;
  private readonly origin: { x: number; y: number };

  constructor(opts: Wizardry6ViewOptions) {
    this.origin = opts.origin ?? { x: 0, y: 0 };
    this.planes = opts.planes;
    this.palette_ = opts.palette;
    this.levelId_ = opts.levelId;
    this.levelLabel_ = opts.levelLabel ?? `Level ${String(opts.levelId).padStart(2, '0')}`;
    this.slots = opts.slots;
    this.banks = { [opts.slots.banks[0]!.id]: opts.bank };

    if (opts.level && opts.automapBank) {
      const worldWidth = opts.level.width;
      const worldHeight = opts.level.height;
      const automapState = new AutomapState(() => ({ width: worldWidth, height: worldHeight }));
      automapState.onEnterCell(opts.startPose.level, opts.startPose.x, opts.startPose.y);
      this.automap = { level: opts.level, bank: opts.automapBank, state: automapState, width: worldWidth, height: worldHeight };
    } else {
      this.automap = undefined;
    }
    this.controller = new WalkerController(opts.startPose, opts.bindings, {
      canStep: (pose, dir) =>
        this.noclip ||
        canStepDir(this.planes, pose.x, pose.y, dir, this.planes.width, this.planes.height),
    });
    this.items_ = buildViewItems(this.planes, opts.startPose.x, opts.startPose.y, opts.startPose.facing, this.slots, this.origin);
  }

  get levelId(): number {
    return this.levelId_;
  }
  get levelLabel(): string {
    return this.levelLabel_;
  }
  get pose(): Pose {
    return this.controller.pose;
  }
  get items(): DrawItem[] {
    return this.items_;
  }
  get currentTick(): number {
    return this.tick;
  }
  get palette(): RGBAColor[] {
    return this.palette_;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    const newPose = this.controller.update(dtMs, keys);
    this.tick += dtMs;
    if (newPose) {
      this.items_ = buildViewItems(this.planes, newPose.x, newPose.y, newPose.facing, this.slots, this.origin);
    }
    return newPose;
  }
  setPose(pose: Pose): void {
    this.controller.setPose(pose);
    this.items_ = buildViewItems(this.planes, pose.x, pose.y, pose.facing, this.slots, this.origin);
  }
  setNoclip(on: boolean): void {
    this.noclip = on;
  }
  interactCodes(): string[] {
    return this.controller.interactCodes();
  }
  automapCodes(): string[] {
    return this.controller.automapCodes();
  }
  pick(): void {
    // No hotspot/picking for W6 yet.
  }
}
