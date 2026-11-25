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
import { arrive, tryMove, W6TriggerState, type W6LevelLinks, type MoveResult } from '../wizardry6/movement.ts';
import { LiveEntityLevel, type LiveSource } from '../blackcrypt/remake/live-scene.ts';

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
  /** W6 only: a pending cross-level move (teleport/stairs) the harness must load; cleared on read. */
  takeLevelChange?(): Pose | null;
  /** W6 only: the last move-path message (bump, locked door, bounce, death, teleport); cleared on read. */
  takeMessage?(): string | null;
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

/** What the remake shell plugs into the view (`?play=1`): live entity lists for the package's prop pass and extra draw items (monsters, effects). */
export interface BlackCryptLive {
  source: LiveSource;
  /** extra items for the current pose (monsters, effects); called when the live scene is refreshed */
  overlay(pose: Pose, base: DrawItem[]): DrawItem[];
  /** a click on a hotspot while live: the shell turns it into an engine command instead of patching the static record */
  onHotspot?(hotspot: { code: number }, entity: import('@seer-project/dungeon').EntityRecord | null, handle: string | null): void;
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

/**
 * `ResolveTargetSquare` (S_1 `+0x27BCA`..`+0x27D20`) result codes for the
 * special-square structure records, as `MoveParty` (`+0x16D94`..`+0x16F08`)
 * consumes them. Every one of these *replaces* the ordinary bit-29-diff
 * gate with an unconditional `JSR $A4982.l` toggle (sites `+0x16DEA` pit,
 * `+0x16EB0` stairs, `+0x16EE8` spinner/teleport) — see data-structure.md
 * "`ViewpointChanged`" → "Non-walk trigger sites: triggers identified".
 */
const RESULT_FLOOR_PIT = 2;
const RESULT_STAIRS = 3;
const RESULT_SPINNER = 4;
const RESULT_TELEPORT = 9;
const BC_TYPE_STAIRS_TELEPORT_SPINNER = 0x12;
const BC_TYPE_PIT = 0x14;

/** The scripted-teleport action opcodes whose handlers contain a `JSR $A4982.l` (`bcdfs` action table, ExecuteAction S_1 `+0x0C4F6`). */
export const BC_ACTION_TELEPORTATION = 0x15; // `+0x0CA5C` — toggles only when the action's value byte is 0
export const BC_ACTION_TELEPORT_AND_COLOUR = 0x1e; // `+0x0CD16` — toggles unconditionally

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
  private readonly levelFile: DungeonLevelFile;
  private readonly palette_: RGBAColor[];
  private readonly waterPalette_: RGBAColor[] | undefined;
  private readonly noclip: { on: boolean };
  /** Session-tracked `$48F(A5)` state, seeded false (`AllocMem(...,MEMF_CLEAR)` + `CLR.W $48E(A5)`) — see `DARKNESS_TYPE_BIT` above. */
  private mirrorToggle = false;
  private readonly mirrorOverrides: Map<string, MirrorOverride>;
  private lastMirrorRawItems: DrawItem[] | null = null;
  private lastMirrorToggleApplied = false;
  private lastMirrorItems: DrawItem[] = [];
  private readonly liveLevel: LiveEntityLevel;
  private live: BlackCryptLive | null = null;
  private liveVersion = 0;
  private liveCache: { base: DrawItem[]; version: number; out: DrawItem[] } | null = null;

  constructor(opts: BlackCryptViewOptions) {
    this.unit = opts.unit;
    this.levelFile = opts.levelFile;
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

    this.liveLevel = new LiveEntityLevel(level);
    this.walker = new Walker(this.liveLevel, opts.slots, opts.semantics, opts.banks, opts.startPose, opts.bindings, {
      // noclip flips the movement gate; the closure reads a mutable flag so
      // the toggle doesn't need to rebuild the Walker.
      canStep: (pose, dir) => this.noclip.on || bcCanStep(level, opts.semantics, pose, dir),
    });
    this.walker.onInteract = (hotspot, entity, handle) => {
      if (this.live) { this.live.onHotspot?.(hotspot, entity, handle); return; }
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
    const base = this.baseItems();
    if (!this.live) return base;
    if (this.liveCache && this.liveCache.base === base && this.liveCache.version === this.liveVersion) return this.liveCache.out;
    const out = [...base, ...this.live.overlay(this.walker.pose, base)];
    this.liveCache = { base, version: this.liveVersion, out };
    return out;
  }
  /** plug the live scene in (or out with `null`); the next `items` read rebuilds from the engine's squares */
  setLive(live: BlackCryptLive | null): void {
    this.live = live;
    this.liveLevel.source = live ? live.source : null;
    this.refreshLive();
  }
  /** the engine state changed (a tick ran): rebuild the view list and the overlay on the next read */
  refreshLive(): void {
    this.liveVersion++;
    this.walker.setPose(this.walker.pose);
  }
  private baseItems(): DrawItem[] {
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
    // An actual cell change drives the toggle. Entering a floor pit /
    // stairs / spinner / teleport square (data-derived, no action chain)
    // takes MoveParty's special-code branch instead of the bit-29 gate:
    // relocate + unconditional toggle. Otherwise the ordinary bit-29 diff.
    if (next && (next.x !== before.x || next.y !== before.y)) {
      const special = this.resolveSpecialSquare(next.x, next.y);
      if (special) {
        const landed = this.applySpecialSquare(next, special);
        if (landed.toggle) this.mirrorToggle = !this.mirrorToggle;
        if (landed.pose.x !== next.x || landed.pose.y !== next.y || landed.pose.facing !== next.facing) {
          this.walker.setPose(landed.pose);
        }
        return landed.pose;
      }
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

  /**
   * Scripted teleport — the state transition of `ExecuteAction` opcodes
   * `0x15` (Teleportation, S_1 `+0x0CA5C`) and `0x1E` (Teleport + dungeon
   * colour change, `+0x0CD16`): the party's `$1742`/`$1740` are overwritten
   * with the action's `col`/`row`, then `$48F` is toggled unconditionally
   * (0x15 only when its value byte is 0; a non-zero value takes `+0x96CBA`
   * instead and skips the toggle). The walker has no action-chain
   * executor, so this is the hook a future one (or a test) calls. Facing is
   * unchanged (the handlers never write `$1744`).
   */
  applyScriptedTeleport(opcode: number, col: number, row: number, value = 0): void {
    const toggles = opcode === BC_ACTION_TELEPORT_AND_COLOUR || (opcode === BC_ACTION_TELEPORTATION && value === 0);
    if (opcode !== BC_ACTION_TELEPORT_AND_COLOUR && opcode !== BC_ACTION_TELEPORTATION) {
      throw new Error(`applyScriptedTeleport: opcode 0x${opcode.toString(16)} is not a teleport action`);
    }
    this.walker.setPose({ ...this.walker.pose, x: col, y: row });
    if (toggles) this.mirrorToggle = !this.mirrorToggle;
  }

  /** Words of the entity record at `(x,y)` chain, BE-word read of `raw`. */
  private bcWord(raw: number[], off: number): number {
    return ((raw[off] ?? 0) << 8) | (raw[off + 1] ?? 0);
  }

  private chainAt(x: number, y: number): number[][] {
    const handles = this.unit.planes.objectHandle;
    const ents = this.levelFile.entities;
    const out: number[][] = [];
    if (!handles || !ents) return out;
    let slot = handles[y * 64 + x] ?? 0;
    for (let guard = 0; slot !== 0 && guard < 64; guard++) {
      const rec = ents[`${this.unit.id}:${y}:${x}:${slot}`];
      if (!rec?.raw) break;
      out.push(rec.raw);
      slot = rec.chainNext ?? 0;
    }
    return out;
  }

  /**
   * `ResolveTargetSquare`'s special-square verdict for the chain at (x,y)
   * (S_1 `+0x27C0A`..`+0x27CA8`; the code written by the *last* record wins):
   * floor pit (type 0x14, passable word +0x0A = 0, word +0x10 != 1; the
   * `$B2586 == 1` global gate is assumed set) = 2; type 0x12 by word +0x10:
   * 2/3 stairs = 3, 4 spinner = 4, else teleport = 9. Returns null for any
   * other square (ceiling pits, plain squares, plates...).
   */
  private resolveSpecialSquare(x: number, y: number): { code: number; raw: number[] } | null {
    let found: { code: number; raw: number[] } | null = null;
    for (const raw of this.chainAt(x, y)) {
      const type = raw[5] ?? 0;
      const sub = this.bcWord(raw, 0x10);
      if (type === BC_TYPE_PIT) {
        if (this.bcWord(raw, 0x0a) === 0 && sub !== 1) found = { code: RESULT_FLOOR_PIT, raw };
      } else if (type === BC_TYPE_STAIRS_TELEPORT_SPINNER) {
        const code = sub === 2 || sub === 3 ? RESULT_STAIRS : sub === 4 ? RESULT_SPINNER : RESULT_TELEPORT;
        found = { code, raw };
      }
    }
    return found;
  }

  /**
   * `ResolveTargetSquare`'s commit tail + `MoveParty`'s code dispatch:
   * destination (words +0x0C col / +0x0E row, skipped for spinners),
   * facing += word +0x08 (mod 4), then the unconditional toggle. The one
   * exception: stairs whose *destination* square's type-0x12 record has a
   * non-zero byte +0x07 take `+0x16E64` (`JSR +0x16C62`, a resource/ramp
   * load) and branch to `+0x16ECE`, skipping the toggle.
   */
  private applySpecialSquare(entered: Pose, sp: { code: number; raw: number[] }): { pose: Pose; toggle: boolean } {
    let x = entered.x;
    let y = entered.y;
    if (sp.code !== RESULT_SPINNER) {
      x = this.bcWord(sp.raw, 0x0c);
      y = this.bcWord(sp.raw, 0x0e);
    }
    const facing = ((entered.facing + this.bcWord(sp.raw, 0x08)) & 3) as Pose['facing'];
    let toggle = true;
    if (sp.code === RESULT_STAIRS) {
      const dest = this.chainAt(x, y).find((r) => (r[5] ?? 0) === BC_TYPE_STAIRS_TELEPORT_SPINNER);
      if (dest && (dest[7] ?? 0) !== 0) toggle = false;
    }
    return { pose: { ...entered, x, y, facing }, toggle };
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
  /** Section-3 entity/teleport/trigger data (`level file w6.links`). Without it the view uses the static move rule (no doors locks, teleports or warps). */
  links?: W6LevelLinks;
  /** Session-wide entity trigger tables; shared across level loads so one-shot teleports stay spent. */
  triggers?: W6TriggerState;
  /** True when the start pose is a teleport arrival: run the game's arrival scan there (chained teleports, door states). */
  arrival?: boolean;
}

/** Human-readable text for the move path's message ids (`movement.ts` `W6_MSG`). */
const W6_MOVE_TEXT: Record<MoveResult['kind'], string> = {
  moved: '',
  bump: 'ouch (wall) — msg 0x7e4',
  locked: 'the door is locked — msg 0x7e5',
  bounce: 'bounced back (water/edge; needs the -18136 timed effect) — msg 0x805',
  death: 'the game kills the party here (pit/chasm/edge) — step refused by the walker',
  blocked: '',
};

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
  private readonly links: W6LevelLinks | undefined;
  private readonly triggers: W6TriggerState;
  /** `-18146(A4)`: per-direction door states set by the last arrival scan. */
  private doorState: number[] = [0, 0, 0, 0];
  /** Relocation (teleport / level-1 warp) to apply after the controller's plain step. */
  private pendingRelocation: Pose | null = null;
  private levelChange: Pose | null = null;
  private message: string | null = null;

  constructor(opts: Wizardry6ViewOptions) {
    this.origin = opts.origin ?? { x: 0, y: 0 };
    this.links = opts.links;
    this.triggers = opts.triggers ?? new W6TriggerState();
    if (this.links) this.triggers.enterLevel(opts.levelId, this.links.initialFlags);
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
      canStep: (pose, dir) => this.noclip || this.attemptStep(pose, dir),
    });
    let start = opts.startPose;
    if (opts.arrival && this.links) {
      const a = arrive(this.planes, this.links, this.triggers, start.x, start.y);
      this.doorState = a.doorState;
      if (a.levelChange) this.levelChange = { level: a.pose.level, x: a.pose.x, y: a.pose.y, facing: start.facing };
      else if (a.teleported) {
        start = { ...start, x: a.pose.x, y: a.pose.y };
        this.controller.setPose(start);
      }
    }
    this.items_ = buildViewItems(this.planes, start.x, start.y, start.facing, this.slots, this.origin);
  }

  /** The game's move path (`movement.ts`): returns true for a plain one-cell step; relocations are queued for `update`. */
  private attemptStep(pose: Pose, dir: number): boolean {
    if (!this.links) {
      const ok = canStepDir(this.planes, pose.x, pose.y, dir, this.planes.width, this.planes.height, pose.facing);
      if (!ok) this.message = W6_MOVE_TEXT.bump;
      return ok;
    }
    const r = tryMove(this.planes, this.links, pose.x, pose.y, dir, pose.facing, this.doorState);
    if (r.kind !== 'moved') {
      this.message = W6_MOVE_TEXT[r.kind] || null; // 'blocked': the game shows nothing
      return false;
    }
    if (r.doorOpened) this.message = 'door opens (forward through a closed door)';
    this.doorState = [0, 0, 0, 0]; // LAB_07A3 clears -18146 on every step
    const a = arrive(this.planes, this.links, this.triggers, r.x, r.y);
    this.doorState = a.doorState;
    if (a.levelChange) {
      this.levelChange = { level: a.pose.level, x: a.pose.x, y: a.pose.y, facing: pose.facing };
      this.message = `teleport -> level ${a.pose.level} (${a.pose.x},${a.pose.y})`;
    } else if (a.teleported || r.warped) {
      this.pendingRelocation = { ...pose, x: a.pose.x, y: a.pose.y };
      this.message = a.teleported ? `teleport -> (${a.pose.x},${a.pose.y})` : `fell through to (${a.pose.x},${a.pose.y})`;
    }
    return true;
  }

  /** A pending cross-level move (teleport/stairs) for the harness to load; cleared on read. */
  takeLevelChange(): Pose | null {
    const p = this.levelChange;
    this.levelChange = null;
    return p;
  }
  /** The last move-path message (bump/locked/bounce/death/teleport); cleared on read. */
  takeMessage(): string | null {
    const m = this.message;
    this.message = null;
    return m;
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
    let newPose = this.controller.update(dtMs, keys);
    this.tick += dtMs;
    if (newPose && this.pendingRelocation) {
      newPose = { ...this.pendingRelocation, facing: newPose.facing };
      this.pendingRelocation = null;
      this.controller.setPose(newPose);
    }
    if (newPose) {
      this.items_ = buildViewItems(this.planes, newPose.x, newPose.y, newPose.facing, this.slots, this.origin);
    }
    return newPose;
  }
  setPose(pose: Pose): void {
    this.controller.setPose(pose);
    this.doorState = [0, 0, 0, 0]; // a harness jump is not a game move: no arrival scan
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
