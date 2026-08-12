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
  automapBank: PieceBank;
  unit: LevelUnit;
  startPose: Pose;
  onInteract?: (msg: string) => void;
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
  private readonly noclip: { on: boolean };

  constructor(opts: BlackCryptViewOptions) {
    this.unit = opts.unit;
    this.palette_ = opts.palette;
    this.noclip = { on: false };
    this.banks = opts.banks;
    this.slots = opts.slots;

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
    return this.walker.items;
  }
  get currentTick(): number {
    return this.walker.currentTick;
  }
  get palette(): RGBAColor[] {
    return this.palette_;
  }

  update(dtMs: number, keys: KeyStateLike): Pose | null {
    return this.walker.update(dtMs, keys);
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

  constructor(opts: Wizardry6ViewOptions) {
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
    this.items_ = buildViewItems(this.planes, opts.startPose.x, opts.startPose.y, opts.startPose.facing, this.slots);
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
      this.items_ = buildViewItems(this.planes, newPose.x, newPose.y, newPose.facing, this.slots);
    }
    return newPose;
  }
  setPose(pose: Pose): void {
    this.controller.setPose(pose);
    this.items_ = buildViewItems(this.planes, pose.x, pose.y, pose.facing, this.slots);
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
